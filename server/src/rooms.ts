/**
 * Rooms, lobbies, and the turn loop.
 *
 * This module owns everything the pure engine deliberately does not: sockets,
 * clocks, the question bank, and persistence. It is the only place that knows a
 * question's correct answer before the reveal — that value never enters GameState,
 * so broadcasting the whole state to every player in the room is safe.
 */

import type { Server, Socket } from 'socket.io'
import {
  applyRoll,
  choosePiece,
  createGame,
  endTurn,
  resolveAnswer,
  rollDie,
  summarise,
  tierForRoll,
} from '@shared/engine.js'
import {
  AI_NAMES,
  AI_ID_PREFIX,
  chooseAnswer,
  choosePiece as aiChoosePiece,
  isAiId,
  thinkTimeMs,
  type AiSkill,
} from '@shared/ai.js'
import {
  TIER_TIME_LIMITS,
  type Ack,
  type AnswerLetter,
  type BoardPreset,
  type ClientToServerEvents,
  type GameMode,
  type GameState,
  type Question,
  type RoomView,
  type ServerToClientEvents,
} from '@shared/types.js'
import { getPlayer, recordAnswerStat, recordGameResults, touchPlayer } from './db.js'
import { Deck } from './questions.js'

type IO = Server<ClientToServerEvents, ServerToClientEvents>
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>

const envMs = (name: string, fallback: number) => Number(process.env[name] ?? fallback)

/** Extra seconds allowed past the displayed deadline, to absorb network latency. */
const ANSWER_GRACE_MS = 1500
/** How long the reveal stays up before the dice pass on. Lowered by the playtest harness. */
const REVEAL_MS = envMs('REVEAL_MS', 6000)
/** A player who stalls on the roll or the piece choice gets moved along. */
const ROLL_TIMEOUT_MS = envMs('ROLL_TIMEOUT_MS', 45000)
const CHOICE_TIMEOUT_MS = envMs('CHOICE_TIMEOUT_MS', 20000)
/** Shorter, so a disconnected player does not hold the table up. */
const DISCONNECTED_TIMEOUT_MS = 3000
/** A room with nobody connected is dropped after this. */
const EMPTY_ROOM_MS = 120000
/**
 * Multiplier on the AI's deliberate pauses. 1 is the human-watchable pace; test
 * harnesses turn it right down to play a whole game in seconds.
 */
const AI_DELAY_SCALE = Number(process.env.AI_DELAY_SCALE ?? 1)

interface SeatEntry {
  playerId: string
  name: string
  ready: boolean
  connected: boolean
  socketId: string | null
  /** null for a human. AI seats have no socket and always count as ready. */
  ai: AiSkill | null
}

interface Room {
  code: string
  hostPlayerId: string
  mode: GameMode
  preset: BoardPreset
  seats: SeatEntry[]
  game: GameState | null
  deck: Deck | null
  /** Server-only: holds the correct answer for the question currently in play. */
  pendingQuestion: Question | null
  timer: NodeJS.Timeout | null
  /** Separate from `timer` so an AI's move never cancels a real deadline. */
  aiTimer: NodeJS.Timeout | null
  /** What the pending AI action was scheduled for, to avoid re-arming on every emit. */
  aiKey: string
  emptySince: NodeJS.Timeout | null
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private socketToRoom = new Map<string, string>()
  private socketToPlayer = new Map<string, string>()

  constructor(private io: IO) {}

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  createRoom(socket: Sock, playerId: string, mode: GameMode, preset: BoardPreset): Ack<{ code: string }> {
    const profile = getPlayer(playerId)
    if (!profile) return { ok: false, error: 'Unknown player ID' }

    const code = this.generateCode()
    const room: Room = {
      code,
      hostPlayerId: playerId,
      mode,
      preset,
      seats: [
        {
          playerId,
          name: profile.name || 'Player',
          ready: false,
          connected: true,
          socketId: socket.id,
          ai: null,
        },
      ],
      game: null,
      deck: null,
      pendingQuestion: null,
      timer: null,
      aiTimer: null,
      aiKey: '',
      emptySince: null,
    }
    this.rooms.set(code, room)
    this.bind(socket, room, playerId)
    this.emitRoom(room)
    return { ok: true, data: { code } }
  }

  joinRoom(socket: Sock, playerId: string, rawCode: string): Ack<{ code: string }> {
    const code = rawCode.trim()
    const room = this.rooms.get(code)
    if (!room) return { ok: false, error: 'No room with that code' }

    const profile = getPlayer(playerId)
    if (!profile) return { ok: false, error: 'Unknown player ID' }

    const existing = room.seats.find((s) => s.playerId === playerId)
    if (existing) {
      // Reconnect, or a second tab for the same player: take over the seat.
      if (existing.socketId && existing.socketId !== socket.id) {
        this.io.sockets.sockets.get(existing.socketId)?.leave(code)
      }
      existing.connected = true
      existing.socketId = socket.id
      existing.name = profile.name || existing.name
    } else if (room.game) {
      return { ok: false, error: 'That game has already started' }
    } else if (room.seats.length >= 4) {
      return { ok: false, error: 'That room is full' }
    } else {
      room.seats.push({
        playerId,
        name: profile.name || 'Player',
        ready: false,
        connected: true,
        socketId: socket.id,
        ai: null,
      })
    }

    this.bind(socket, room, playerId)
    this.cancelEmptyTimer(room)
    this.emitRoom(room)
    if (room.game) this.emitGame(room)
    return { ok: true, data: { code } }
  }

  setReady(socket: Sock, ready: boolean): Ack {
    const { room, seat } = this.locate(socket)
    if (!room || !seat) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'The game has already started' }
    seat.ready = ready
    this.emitRoom(room)
    return { ok: true }
  }

  setMode(socket: Sock, mode: GameMode, preset: BoardPreset): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'The game has already started' }
    if (playerId !== room.hostPlayerId) return { ok: false, error: 'Only the host can change this' }
    room.mode = mode
    room.preset = preset
    this.emitRoom(room)
    return { ok: true }
  }

  swapSeats(socket: Sock, a: number, b: number): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'The game has already started' }
    if (playerId !== room.hostPlayerId) return { ok: false, error: 'Only the host can move seats' }
    if (!room.seats[a] || !room.seats[b]) return { ok: false, error: 'No such seat' }
    ;[room.seats[a], room.seats[b]] = [room.seats[b], room.seats[a]]
    this.emitRoom(room)
    return { ok: true }
  }

  /** Host fills an empty seat with a computer player. */
  addAi(socket: Sock, skill: AiSkill): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'The game has already started' }
    if (playerId !== room.hostPlayerId) return { ok: false, error: 'Only the host can add players' }
    if (room.seats.length >= 4) return { ok: false, error: 'That room is full' }

    const taken = new Set(room.seats.map((s) => s.name))
    const name = AI_NAMES.find((n) => !taken.has(n)) ?? `Dr. ${room.seats.length + 1}`
    room.seats.push({
      playerId: `${AI_ID_PREFIX}${room.code}-${room.seats.length}`,
      name,
      ready: true,
      connected: true,
      socketId: null,
      ai: skill,
    })
    this.emitRoom(room)
    return { ok: true }
  }

  /** Host removes a seat. Only AI seats can be removed this way. */
  removeSeat(socket: Sock, seat: number): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'The game has already started' }
    if (playerId !== room.hostPlayerId) return { ok: false, error: 'Only the host can do that' }
    const entry = room.seats[seat]
    if (!entry) return { ok: false, error: 'No such seat' }
    if (!entry.ai) return { ok: false, error: 'That seat belongs to a player' }
    room.seats.splice(seat, 1)
    this.emitRoom(room)
    return { ok: true }
  }

  startGame(socket: Sock): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room) return { ok: false, error: 'You are not in a room' }
    if (room.game) return { ok: false, error: 'Already started' }
    if (playerId !== room.hostPlayerId) return { ok: false, error: 'Only the host can start' }

    if (room.mode === 'teams' && room.seats.length !== 4) {
      return { ok: false, error: '2v2 needs exactly 4 players' }
    }
    if (room.seats.length < 2) return { ok: false, error: 'Need at least 2 players' }
    if (!room.seats.every((s) => s.ai || s.ready || s.playerId === room.hostPlayerId)) {
      return { ok: false, error: 'Everyone needs to be ready' }
    }

    const deck = Deck.snapshot()
    if (!deck.hasAny()) {
      return { ok: false, error: 'There are no active questions. Ask an admin to add some.' }
    }

    room.deck = deck
    room.game = createGame({
      mode: room.mode,
      preset: room.preset,
      players: room.seats.map((s) => ({ playerId: s.playerId, name: s.name })),
    })
    for (const s of room.seats) touchPlayer(s.playerId)

    this.emitRoom(room)
    this.emitGame(room)
    this.armRollTimer(room)
    return { ok: true }
  }

  leaveRoom(socket: Sock): Ack {
    const { room, playerId } = this.locate(socket)
    if (!room || !playerId) return { ok: true }
    socket.leave(room.code)
    this.socketToRoom.delete(socket.id)

    if (room.game) {
      // Mid-game seats are held so the player can come back.
      const seat = room.seats.find((s) => s.playerId === playerId)
      if (seat) {
        seat.connected = false
        seat.socketId = null
      }
      this.syncConnectionFlags(room)
    } else {
      room.seats = room.seats.filter((s) => s.playerId !== playerId)
      // A lobby of nothing but computer players is over.
      const humans = room.seats.filter((s) => !s.ai)
      if (humans.length === 0) {
        this.destroy(room)
        return { ok: true }
      }
      if (room.hostPlayerId === playerId) room.hostPlayerId = humans[0].playerId
    }

    this.emitRoom(room)
    if (room.game) this.emitGame(room)
    this.checkEmpty(room)
    return { ok: true }
  }

  handleDisconnect(socket: Sock) {
    const code = this.socketToRoom.get(socket.id)
    this.socketToRoom.delete(socket.id)
    this.socketToPlayer.delete(socket.id)
    if (!code) return
    const room = this.rooms.get(code)
    if (!room) return

    const seat = room.seats.find((s) => s.socketId === socket.id)
    if (!seat) return
    seat.connected = false
    seat.socketId = null

    if (!room.game) {
      room.seats = room.seats.filter((s) => s.playerId !== seat.playerId)
      const humans = room.seats.filter((s) => !s.ai)
      if (humans.length === 0) {
        this.destroy(room)
        return
      }
      if (room.hostPlayerId === seat.playerId) room.hostPlayerId = humans[0].playerId
    } else {
      this.syncConnectionFlags(room)
      this.emitGame(room)
      // If it is their turn, shorten the clock rather than making everyone wait.
      if (room.game.turnSeat === room.seats.indexOf(seat) && room.game.phase === 'awaiting-roll') {
        this.armRollTimer(room)
      }
    }

    this.emitRoom(room)
    this.checkEmpty(room)
  }

  // -------------------------------------------------------------------------
  // Turn loop
  // -------------------------------------------------------------------------

  roll(socket: Sock): Ack {
    const { room, seatIndex } = this.locate(socket)
    if (!room?.game) return { ok: false, error: 'No game in progress' }
    if (room.game.phase !== 'awaiting-roll') return { ok: false, error: 'Not time to roll' }
    if (seatIndex !== room.game.turnSeat) return { ok: false, error: 'Not your turn' }
    this.performRoll(room)
    return { ok: true }
  }

  answer(socket: Sock, letter: AnswerLetter): Ack {
    const { room, seatIndex } = this.locate(socket)
    if (!room?.game) return { ok: false, error: 'No game in progress' }
    if (room.game.phase !== 'answering') return { ok: false, error: 'Not time to answer' }
    if (seatIndex !== room.game.turnSeat) return { ok: false, error: 'Not your question' }
    this.performAnswer(room, letter)
    return { ok: true }
  }

  choosePiece(socket: Sock, pieceId: string): Ack {
    const { room, seatIndex } = this.locate(socket)
    if (!room?.game) return { ok: false, error: 'No game in progress' }
    if (room.game.phase !== 'choosing-piece') return { ok: false, error: 'Not time to choose' }
    if (seatIndex !== room.game.turnSeat) return { ok: false, error: 'Not your turn' }
    try {
      this.performChoice(room, pieceId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private performRoll(room: Room) {
    this.clearTimer(room)
    const game = room.game!
    const roll = rollDie()
    const tier = tierForRoll(roll)
    const question = room.deck!.draw(tier)

    if (!question) {
      // Cannot happen while the no-empty-tier rule holds, but never hang the game.
      room.game = endTurn({ ...game, phase: 'revealing', lastResult: null })
      this.emitGame(room)
      this.armRollTimer(room)
      return
    }

    room.pendingQuestion = question
    const deadline = Date.now() + TIER_TIME_LIMITS[tier] * 1000
    room.game = applyRoll(game, game.turnSeat, roll, {
      id: question.id,
      tier: question.tier,
      text: question.text,
      options: question.options,
      deadline,
    })
    this.emitGame(room)

    // Everyone sees the real deadline, but a player who has dropped is not going to
    // answer — don't make the rest of the table sit through 45 seconds of nothing.
    const seat = room.seats[game.turnSeat]
    const waitMs =
      seat && !seat.ai && !seat.connected
        ? DISCONNECTED_TIMEOUT_MS
        : deadline - Date.now() + ANSWER_GRACE_MS
    room.timer = setTimeout(() => this.performAnswer(room, null), waitMs)
  }

  private performAnswer(room: Room, letter: AnswerLetter | null) {
    this.clearTimer(room)
    const game = room.game
    const question = room.pendingQuestion
    if (!game || !question) return

    room.game = resolveAnswer(game, {
      chosen: letter,
      correctLetter: question.answer,
      explanation: question.explanation,
      questionId: question.id,
      questionText: question.text,
      options: question.options,
    })
    room.pendingQuestion = null

    recordAnswerStat(
      question.id,
      letter === null ? 'timeout' : letter === question.answer ? 'correct' : 'wrong',
    )

    this.emitGame(room)
    this.afterResolution(room)
  }

  private performChoice(room: Room, pieceId: string) {
    this.clearTimer(room)
    const game = room.game!
    room.game = choosePiece(game, game.turnSeat, pieceId)
    this.emitGame(room)
    this.afterResolution(room)
  }

  private afterResolution(room: Room) {
    const game = room.game!
    if (game.phase === 'choosing-piece') {
      room.timer = setTimeout(() => {
        // Stalling picks for you rather than freezing the table.
        try {
          this.performChoice(room, room.game!.choices[0])
        } catch {
          /* state moved on */
        }
      }, this.timeoutFor(room, CHOICE_TIMEOUT_MS))
      return
    }
    room.timer = setTimeout(() => this.finishTurn(room), REVEAL_MS)
  }

  private finishTurn(room: Room) {
    this.clearTimer(room)
    if (!room.game) return
    room.game = endTurn(room.game)
    this.emitGame(room)

    if (room.game.phase === 'game-over') {
      this.finishGame(room)
      return
    }
    this.armRollTimer(room)
  }

  private finishGame(room: Room) {
    const game = room.game!
    const summary = summarise(game)
    // Computer players appear in the end-of-game table but never on the leaderboard.
    recordGameResults(summary.filter((row) => !isAiId(row.playerId)))
    this.io.to(room.code).emit('gameOver', { winner: game.winner!, summary })
    // The room stays alive so everyone can read the summary; it is dropped once empty.
  }

  private armRollTimer(room: Room) {
    this.clearTimer(room)
    room.timer = setTimeout(() => this.performRoll(room), this.timeoutFor(room, ROLL_TIMEOUT_MS))
  }

  /** Disconnected players get a much shorter clock so the table keeps moving. */
  private timeoutFor(room: Room, normalMs: number): number {
    const seat = room.seats[room.game?.turnSeat ?? 0]
    return seat && !seat.connected ? DISCONNECTED_TIMEOUT_MS : normalMs
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer)
    room.timer = null
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private bind(socket: Sock, room: Room, playerId: string) {
    const previous = this.socketToRoom.get(socket.id)
    if (previous && previous !== room.code) socket.leave(previous)
    socket.join(room.code)
    this.socketToRoom.set(socket.id, room.code)
    this.socketToPlayer.set(socket.id, playerId)
    this.syncConnectionFlags(room)
  }

  private locate(socket: Sock) {
    const code = this.socketToRoom.get(socket.id)
    const playerId = this.socketToPlayer.get(socket.id)
    const room = code ? this.rooms.get(code) : undefined
    const seatIndex = room && playerId ? room.seats.findIndex((s) => s.playerId === playerId) : -1
    return {
      room,
      playerId,
      seatIndex,
      seat: seatIndex >= 0 ? room!.seats[seatIndex] : undefined,
    }
  }

  /** Mirror lobby connection flags onto the game state so the board can grey people out. */
  private syncConnectionFlags(room: Room) {
    if (!room.game) return
    for (const player of room.game.players) {
      const seat = room.seats.find((s) => s.playerId === player.playerId)
      player.connected = seat?.connected ?? false
    }
  }

  private checkEmpty(room: Room) {
    // AI seats are always "connected", so only humans keep a room alive.
    if (room.seats.some((s) => !s.ai && s.connected)) {
      this.cancelEmptyTimer(room)
      return
    }
    if (room.emptySince) return
    room.emptySince = setTimeout(() => this.destroy(room), EMPTY_ROOM_MS)
  }

  private cancelEmptyTimer(room: Room) {
    if (room.emptySince) clearTimeout(room.emptySince)
    room.emptySince = null
  }

  private destroy(room: Room) {
    this.clearTimer(room)
    this.clearAiTimer(room)
    this.cancelEmptyTimer(room)
    this.rooms.delete(room.code)
  }

  private generateCode(): string {
    for (let i = 0; i < 100; i++) {
      const code = String(100000 + Math.floor(Math.random() * 900000))
      if (!this.rooms.has(code)) return code
    }
    throw new Error('Could not allocate a room code')
  }

  private view(room: Room): RoomView {
    return {
      code: room.code,
      hostPlayerId: room.hostPlayerId,
      mode: room.mode,
      preset: room.preset,
      started: room.game !== null,
      seats: room.seats.map((s, seat) => ({
        seat,
        playerId: s.playerId,
        name: s.name,
        team: room.mode === 'teams' ? seat % 2 : seat,
        ready: s.ready,
        connected: s.connected,
        ai: s.ai,
      })),
    }
  }

  private emitRoom(room: Room) {
    this.io.to(room.code).emit('room', this.view(room))
  }

  private emitGame(room: Room) {
    if (room.game) this.io.to(room.code).emit('game', room.game)
    this.maybeScheduleAi(room)
  }

  /**
   * If the seat on turn is a computer player, queue its move.
   *
   * Keyed on (seat, phase, question) so repeated state broadcasts don't keep
   * pushing the timer back — otherwise an AI could be perpetually "about to
   * answer" while other events churn the state.
   */
  private maybeScheduleAi(room: Room) {
    const game = room.game
    if (!game || game.winner || game.phase === 'game-over') return

    const seat = room.seats[game.turnSeat]
    if (!seat?.ai) {
      this.clearAiTimer(room)
      return
    }

    const key = `${game.turnSeat}:${game.phase}:${game.question?.id ?? '-'}`
    if (key === room.aiKey && room.aiTimer) return
    this.clearAiTimer(room)
    room.aiKey = key

    const run = (fn: () => void, baseDelay: number) => {
      const delay = Math.max(10, baseDelay * AI_DELAY_SCALE)
      room.aiTimer = setTimeout(() => {
        room.aiTimer = null
        room.aiKey = ''
        try {
          fn()
        } catch {
          /* the game moved on without us */
        }
      }, delay)
    }

    if (game.phase === 'awaiting-roll') {
      run(() => this.performRoll(room), 1100)
      return
    }

    if (game.phase === 'answering' && room.pendingQuestion) {
      const question = room.pendingQuestion
      const letter = chooseAnswer(seat.ai, question.tier, question.answer)
      run(() => this.performAnswer(room, letter), thinkTimeMs(question.tier))
      return
    }

    if (game.phase === 'choosing-piece' && game.choices.length > 0) {
      const pick = aiChoosePiece(game, game.turnSeat, game.pendingDistance, game.choices)
      run(() => this.performChoice(room, pick), 850)
    }
  }

  private clearAiTimer(room: Room) {
    if (room.aiTimer) clearTimeout(room.aiTimer)
    room.aiTimer = null
    room.aiKey = ''
  }
}
