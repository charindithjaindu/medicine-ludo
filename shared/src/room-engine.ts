/**
 * One room: its lobby, its game, and its clocks.
 *
 * Transport-agnostic on purpose. It never touches a socket or a database — it
 * broadcasts through a callback and asks its host to fetch anything it needs
 * (a player profile, the question decks) before calling in. That is what lets the
 * same turn loop run in tests and behind the Node WebSocket server.
 *
 * It is also the only place that knows a question's correct answer before the
 * reveal; that value never enters GameState, so broadcasting the whole state to
 * everyone in the room is safe.
 */

import {
  AI_ID_PREFIX,
  AI_NAMES,
  choiceDelayMs,
  chooseAnswer,
  choosePiece as aiChoosePiece,
  rollDelayMs,
  thinkTimeMs,
  type AiSkill,
} from './ai.js'
import {
  applyRoll,
  choosePiece,
  createGame,
  endTurn,
  markAnswer,
  resolveAnswer,
  rollDie,
  summarise,
} from './engine.js'
import type { ServerMessage } from './protocol.js'
import {
  ANSWER_SECONDS,
  DIFFICULTY_NAMES,
  type Ack,
  type AnswerLetter,
  type BoardPreset,
  type Difficulty,
  type GameMode,
  type GameState,
  type GameSummaryRow,
  type Question,
  type RoomView,
  type Winner,
} from './types.js'

export interface RoomTimings {
  answerGraceMs: number
  revealMs: number
  rollTimeoutMs: number
  choiceTimeoutMs: number
  disconnectedTimeoutMs: number
  /** How long a dropped socket keeps its lobby seat before the seat is given up. */
  lobbyGraceMs: number
  /** How long the chosen answer sits on screen before the verdict. */
  answerLockMs: number
  aiDelayScale: number
}

export const DEFAULT_TIMINGS: RoomTimings = {
  answerGraceMs: 1500,
  revealMs: 6000,
  rollTimeoutMs: 45000,
  choiceTimeoutMs: 20000,
  disconnectedTimeoutMs: 3000,
  lobbyGraceMs: 15000,
  answerLockMs: 1000,
  aiDelayScale: 1,
}

export interface RoomHooks {
  broadcast(message: ServerMessage): void
  /** Per-question statistics, for the admin panel. Fire and forget. */
  onStat(questionId: number, outcome: 'correct' | 'wrong' | 'timeout'): void
  /** Final results, for the leaderboard. AI seats are already filtered out. */
  onFinished(summary: GameSummaryRow[], winner: Winner): void
}

export interface Profile {
  id: string
  name: string
}

interface SeatEntry {
  playerId: string
  name: string
  ready: boolean
  connected: boolean
  ai: AiSkill | null
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** One shuffled question deck per difficulty, drawn without replacement. */
class Deck {
  private remaining: Question[]
  constructor(private source: Question[]) { this.remaining = shuffle(source) }
  snapshot() { return { source: this.source, remaining: this.remaining } }
  static restore(snapshot: { source: Question[]; remaining: Question[] }) {
    const deck = new Deck(snapshot.source)
    deck.remaining = snapshot.remaining
    return deck
  }
  hasAny() { return this.source.length > 0 }
  draw(): Question | null {
    if (!this.remaining.length) this.remaining = shuffle(this.source)
    return this.remaining.pop() ?? null
  }
}

/** Private server state, including answer keys. Never send this to clients. */
export interface RoomSnapshot {
  version: 1
  code: string
  hostPlayerId: string
  mode: GameMode
  preset: BoardPreset
  difficulty: Difficulty
  seats: SeatEntry[]
  game: GameState | null
  deck: ReturnType<Deck['snapshot']> | null
  pendingQuestion: Question | null
}

export class RoomEngine {
  readonly code: string
  hostPlayerId: string
  mode: GameMode
  preset: BoardPreset
  difficulty: Difficulty
  private seats: SeatEntry[] = []
  game: GameState | null = null
  private deck: Deck | null = null
  private pendingQuestion: Question | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private aiTimer: ReturnType<typeof setTimeout> | null = null
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null
  private aiKey = ''

  constructor(
    code: string,
    host: Profile,
    mode: GameMode,
    preset: BoardPreset,
    difficulty: Difficulty,
    private hooks: RoomHooks,
    private timings: RoomTimings = DEFAULT_TIMINGS,
  ) {
    this.code = code
    this.hostPlayerId = host.id
    this.mode = mode
    this.preset = preset
    this.difficulty = difficulty
    this.seats.push({
      playerId: host.id,
      name: host.name || 'Player',
      ready: false,
      connected: true,
      ai: null,
    })
  }

  snapshot(): RoomSnapshot {
    return {
      version: 1, code: this.code, hostPlayerId: this.hostPlayerId,
      mode: this.mode, preset: this.preset, difficulty: this.difficulty,
      seats: this.seats, game: this.game, deck: this.deck?.snapshot() ?? null,
      pendingQuestion: this.pendingQuestion,
    }
  }

  static restore(state: RoomSnapshot, hooks: RoomHooks, timings = DEFAULT_TIMINGS): RoomEngine {
    if (state.version !== 1) throw new Error('Unsupported room snapshot')
    const engine = new RoomEngine(state.code, { id: state.hostPlayerId, name: '' },
      state.mode, state.preset, state.difficulty, hooks, timings)
    engine.seats = state.seats.map(s => ({ ...s, connected: Boolean(s.ai) }))
    engine.game = state.game
    engine.deck = state.deck ? Deck.restore(state.deck) : null
    engine.pendingQuestion = state.pendingQuestion
    engine.syncConnectionFlags()
    // Resume clocks once a human reconnects; downtime must not play an entire game.
    return engine
  }

  resume() {
    const game = this.game
    if (!game) { this.armLobbyPrune(); return }
    if (game.phase === 'game-over') return
    if (game.phase === 'awaiting-roll') this.armRollTimer()
    else if (game.phase === 'answering') {
      if (game.chosenAnswer !== null) {
        this.timer = setTimeout(() => this.resolveAnswerNow(game.chosenAnswer), this.timings.answerLockMs)
      } else {
        if (game.question) game.question.deadline = Date.now() + ANSWER_SECONDS * 1000
        this.timer = setTimeout(() => this.performAnswer(null), ANSWER_SECONDS * 1000 + this.timings.answerGraceMs)
      }
    } else this.afterResolution()
    this.emitGame()
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  join(profile: Profile): Ack<{ code: string }> {
    const existing = this.seats.find((s) => s.playerId === profile.id)
    if (existing) {
      existing.connected = true
      existing.name = profile.name || existing.name
    } else if (this.game) {
      return { ok: false, error: 'That game has already started' }
    } else if (this.seats.length >= 4) {
      return { ok: false, error: 'That room is full' }
    } else {
      this.seats.push({
        playerId: profile.id,
        name: profile.name || 'Player',
        ready: false,
        connected: true,
        ai: null,
      })
    }
    this.syncConnectionFlags()
    this.emitRoom()
    if (this.game) this.emitGame()
    return { ok: true, data: { code: this.code } }
  }

  setReady(playerId: string, ready: boolean): Ack {
    const seat = this.seats.find((s) => s.playerId === playerId)
    if (!seat) return { ok: false, error: 'You are not in this room' }
    if (this.game) return { ok: false, error: 'The game has already started' }
    seat.ready = ready
    this.emitRoom()
    return { ok: true }
  }

  setMode(playerId: string, mode: GameMode, preset: BoardPreset, difficulty?: Difficulty): Ack {
    const guard = this.hostGuard(playerId)
    if (guard) return guard
    this.mode = mode
    this.preset = preset
    if (difficulty) this.difficulty = difficulty
    this.emitRoom()
    return { ok: true }
  }

  swapSeats(playerId: string, a: number, b: number): Ack {
    const guard = this.hostGuard(playerId)
    if (guard) return guard
    if (!this.seats[a] || !this.seats[b]) return { ok: false, error: 'No such seat' }
    ;[this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]]
    this.emitRoom()
    return { ok: true }
  }

  addAi(playerId: string, skill: AiSkill): Ack {
    const guard = this.hostGuard(playerId)
    if (guard) return guard
    if (this.seats.length >= 4) return { ok: false, error: 'That room is full' }
    const taken = new Set(this.seats.map((s) => s.name))
    const name = AI_NAMES.find((n) => !taken.has(n)) ?? `Dr. ${this.seats.length + 1}`
    this.seats.push({
      playerId: `${AI_ID_PREFIX}${this.code}-${this.seats.length}`,
      name,
      ready: true,
      connected: true,
      ai: skill,
    })
    this.emitRoom()
    return { ok: true }
  }

  removeSeat(playerId: string, seat: number): Ack {
    const guard = this.hostGuard(playerId)
    if (guard) return guard
    const entry = this.seats[seat]
    if (!entry) return { ok: false, error: 'No such seat' }
    if (!entry.ai) return { ok: false, error: 'That seat belongs to a player' }
    this.seats.splice(seat, 1)
    this.emitRoom()
    return { ok: true }
  }

  /** Whether the room still has any question decks to draw from. */
  canStart(): Ack {
    if (this.game) return { ok: false, error: 'Already started' }
    if (this.mode === 'teams' && this.seats.length !== 4) {
      return { ok: false, error: '2v2 needs exactly 4 players' }
    }
    if (this.seats.length < 2) return { ok: false, error: 'Need at least 2 players' }
    if (!this.seats.every((s) => s.ai || s.ready || s.playerId === this.hostPlayerId)) {
      return { ok: false, error: 'Everyone needs to be ready' }
    }
    return { ok: true }
  }

  start(playerId: string, questions: Question[]): Ack {
    const guard = this.hostGuard(playerId)
    if (guard) return guard
    const ready = this.canStart()
    if (!ready.ok) return ready

    const deck = new Deck(questions)
    if (!deck.hasAny()) {
      return {
        ok: false,
        error:
          `There are no active ${DIFFICULTY_NAMES[this.difficulty]} questions. ` +
          'Pick another difficulty, or ask an admin to add some.',
      }
    }

    this.deck = deck
    this.game = createGame({
      mode: this.mode,
      preset: this.preset,
      players: this.seats.map((s) => ({ playerId: s.playerId, name: s.name })),
    })
    this.emitRoom()
    this.emitGame()
    this.armRollTimer()
    return { ok: true }
  }

  private hostGuard(playerId: string): Ack | null {
    if (this.game && playerId !== this.hostPlayerId) {
      return { ok: false, error: 'The game has already started' }
    }
    if (this.game) return { ok: false, error: 'The game has already started' }
    if (playerId !== this.hostPlayerId) return { ok: false, error: 'Only the host can do that' }
    return null
  }

  // -------------------------------------------------------------------------
  // Connection state
  // -------------------------------------------------------------------------

  /**
   * The socket went away. Not necessarily the player: a reload, a locked phone or a
   * tunnel all look like this, and a mid-game seat is held for good. In the lobby the
   * seat is held for a few seconds too, so coming straight back puts you in the same
   * chair — still the host, if you were.
   */
  markDisconnected(playerId: string) {
    const seat = this.seats.find((s) => s.playerId === playerId)
    if (!seat) return
    seat.connected = false

    if (!this.game) {
      this.armLobbyPrune()
    } else {
      this.syncConnectionFlags()
      this.emitGame()
      if (this.game.phase === 'awaiting-roll' && this.seats[this.game.turnSeat] === seat) {
        this.armRollTimer()
      }
    }
    this.emitRoom()
  }

  /** They tapped Leave. No grace — they meant it. */
  leave(playerId: string) {
    const seat = this.seats.find((s) => s.playerId === playerId)
    if (!seat) return
    seat.connected = false
    if (this.game) {
      this.markDisconnected(playerId)
      return
    }
    this.seats = this.seats.filter((s) => s.playerId !== playerId)
    this.reassignHost()
    this.emitRoom()
  }

  private armLobbyPrune() {
    if (this.lobbyTimer) return
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null
      if (this.game) return
      const before = this.seats.length
      this.seats = this.seats.filter((s) => s.ai || s.connected)
      if (this.seats.length === before) return
      this.reassignHost()
      this.emitRoom()
    }, this.timings.lobbyGraceMs)
  }

  private reassignHost() {
    if (this.seats.some((s) => s.playerId === this.hostPlayerId)) return
    const humans = this.seats.filter((s) => !s.ai)
    if (humans.length > 0) this.hostPlayerId = humans[0].playerId
  }

  /** True once nobody human is connected, so the host can drop the room. */
  isAbandoned(): boolean {
    return !this.seats.some((s) => !s.ai && s.connected)
  }

  dispose() {
    this.clearTimer()
    this.clearAiTimer()
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer)
    this.lobbyTimer = null
  }

  // -------------------------------------------------------------------------
  // Turn loop
  // -------------------------------------------------------------------------

  roll(playerId: string): Ack {
    const seat = this.seatIndex(playerId)
    if (!this.game) return { ok: false, error: 'No game in progress' }
    if (this.game.phase !== 'awaiting-roll') return { ok: false, error: 'Not time to roll' }
    if (seat !== this.game.turnSeat) return { ok: false, error: 'Not your turn' }
    this.performRoll()
    return { ok: true }
  }

  answer(playerId: string, letter: AnswerLetter): Ack {
    const seat = this.seatIndex(playerId)
    if (!this.game) return { ok: false, error: 'No game in progress' }
    if (this.game.phase !== 'answering') return { ok: false, error: 'Not time to answer' }
    if (seat !== this.game.turnSeat) return { ok: false, error: 'Not your question' }
    // Locked in already: the answer is sitting on screen waiting to resolve.
    if (this.game.chosenAnswer !== null) return { ok: false, error: 'You have already answered' }
    this.performAnswer(letter)
    return { ok: true }
  }

  choose(playerId: string, pieceId: string): Ack {
    const seat = this.seatIndex(playerId)
    if (!this.game) return { ok: false, error: 'No game in progress' }
    if (this.game.phase !== 'choosing-piece') return { ok: false, error: 'Not time to choose' }
    if (seat !== this.game.turnSeat) return { ok: false, error: 'Not your turn' }
    try {
      this.performChoice(pieceId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private performRoll() {
    this.clearTimer()
    const game = this.game!
    const roll = rollDie()
    const question = this.deck!.draw()
    if (!question) {
      this.game = endTurn({ ...game, phase: 'revealing', lastResult: null })
      this.emitGame()
      this.armRollTimer()
      return
    }

    this.pendingQuestion = question
    const deadline = Date.now() + ANSWER_SECONDS * 1000
    this.game = applyRoll(game, game.turnSeat, roll, {
      id: question.id,
      difficulty: question.difficulty,
      text: question.text,
      options: question.options,
      deadline,
    })
    this.emitGame()

    // Everyone sees the real deadline, but a player who has dropped is not going to
    // answer — don't make the rest of the table sit through it.
    const seat = this.seats[game.turnSeat]
    const waitMs =
      seat && !seat.ai && !seat.connected
        ? this.timings.disconnectedTimeoutMs
        : deadline - Date.now() + this.timings.answerGraceMs
    this.timer = setTimeout(() => this.performAnswer(null), waitMs)
  }

  /**
   * Two beats, not one. First the chosen option is locked in and shown to the whole
   * table; a second later it resolves. Jumping straight to the verdict meant the
   * other players were told an answer was wrong without ever seeing which answer it
   * was. A timeout skips the pause — there is no choice to look at.
   */
  private performAnswer(letter: AnswerLetter | null) {
    this.clearTimer()
    const game = this.game
    if (!game || !this.pendingQuestion) return

    if (letter !== null && game.phase === 'answering' && game.chosenAnswer === null) {
      this.game = markAnswer(game, letter)
      this.emitGame()
      this.timer = setTimeout(() => this.resolveAnswerNow(letter), this.timings.answerLockMs)
      return
    }
    this.resolveAnswerNow(letter)
  }

  private resolveAnswerNow(letter: AnswerLetter | null) {
    this.clearTimer()
    const game = this.game
    const question = this.pendingQuestion
    if (!game || !question) return

    this.game = resolveAnswer(game, {
      chosen: letter,
      correctLetter: question.answer,
      explanation: question.explanation,
      questionId: question.id,
      questionText: question.text,
      options: question.options,
      difficulty: question.difficulty,
    })
    this.pendingQuestion = null

    this.hooks.onStat(
      question.id,
      letter === null ? 'timeout' : letter === question.answer ? 'correct' : 'wrong',
    )
    this.emitGame()
    this.afterResolution()
  }

  private performChoice(pieceId: string) {
    this.clearTimer()
    const game = this.game!
    this.game = choosePiece(game, game.turnSeat, pieceId)
    this.emitGame()
    this.afterResolution()
  }

  private afterResolution() {
    const game = this.game!
    if (game.phase === 'choosing-piece') {
      this.timer = setTimeout(() => {
        try {
          this.performChoice(this.game!.choices[0])
        } catch {
          /* state moved on */
        }
      }, this.stallTimeout(this.timings.choiceTimeoutMs))
      return
    }
    this.timer = setTimeout(() => this.finishTurn(), this.timings.revealMs)
  }

  private finishTurn() {
    this.clearTimer()
    if (!this.game) return
    this.game = endTurn(this.game)

    if (this.game.phase === 'game-over') {
      const summary = summarise(this.game)
      this.hooks.onFinished(summary, this.game.winner!)
      this.emitGame()
      this.hooks.broadcast({
        t: 'event',
        event: 'gameOver',
        payload: { winner: this.game.winner!, summary },
      })
      return
    }
    this.emitGame()
    this.armRollTimer()
  }

  private armRollTimer() {
    this.clearTimer()
    this.timer = setTimeout(() => this.performRoll(), this.stallTimeout(this.timings.rollTimeoutMs))
  }

  private stallTimeout(normalMs: number): number {
    const seat = this.seats[this.game?.turnSeat ?? 0]
    return seat && !seat.ai && !seat.connected ? this.timings.disconnectedTimeoutMs : normalMs
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  // -------------------------------------------------------------------------
  // Computer players
  // -------------------------------------------------------------------------

  private maybeScheduleAi() {
    const game = this.game
    if (!game || game.winner || game.phase === 'game-over') return
    const seat = this.seats[game.turnSeat]
    if (!seat?.ai) {
      this.clearAiTimer()
      return
    }

    const key = `${game.turnSeat}:${game.phase}:${game.question?.id ?? '-'}`
    if (key === this.aiKey && this.aiTimer) return
    this.clearAiTimer()
    this.aiKey = key

    const run = (fn: () => void, baseDelay: number) => {
      const delay = Math.max(10, baseDelay * this.timings.aiDelayScale)
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null
        this.aiKey = ''
        try {
          fn()
        } catch {
          /* the game moved on without us */
        }
      }, delay)
    }

    if (game.phase === 'awaiting-roll') {
      run(() => this.performRoll(), rollDelayMs())
    } else if (game.phase === 'answering' && this.pendingQuestion && game.chosenAnswer === null) {
      // The `chosenAnswer` guard matters: locking an answer re-broadcasts the game
      // still in 'answering', and without it a computer would queue a second answer
      // during the pause before its first one resolves.
      const q = this.pendingQuestion
      const letter = chooseAnswer(seat.ai, q.difficulty, q.answer)
      run(() => this.performAnswer(letter), thinkTimeMs(q.difficulty))
    } else if (game.phase === 'choosing-piece' && game.choices.length > 0) {
      const pick = aiChoosePiece(game, game.turnSeat, game.pendingDistance, game.choices)
      run(() => this.performChoice(pick), choiceDelayMs())
    }
  }

  private clearAiTimer() {
    if (this.aiTimer) clearTimeout(this.aiTimer)
    this.aiTimer = null
    this.aiKey = ''
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private seatIndex(playerId: string): number {
    return this.seats.findIndex((s) => s.playerId === playerId)
  }

  private syncConnectionFlags() {
    if (!this.game) return
    for (const player of this.game.players) {
      const seat = this.seats.find((s) => s.playerId === player.playerId)
      player.connected = seat?.connected ?? false
    }
  }

  view(): RoomView {
    return {
      code: this.code,
      hostPlayerId: this.hostPlayerId,
      mode: this.mode,
      preset: this.preset,
      difficulty: this.difficulty,
      started: this.game !== null,
      seats: this.seats.map((s, seat) => ({
        seat,
        playerId: s.playerId,
        name: s.name,
        team: this.mode === 'teams' ? seat % 2 : seat,
        ready: s.ready,
        connected: s.connected,
        ai: s.ai,
      })),
    }
  }

  emitRoom() {
    this.hooks.broadcast({ t: 'event', event: 'room', payload: this.view() })
  }

  emitGame() {
    if (this.game) this.hooks.broadcast({ t: 'event', event: 'game', payload: this.game })
    this.maybeScheduleAi()
  }
}
