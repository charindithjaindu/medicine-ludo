/**
 * The rules of Medicine Ludo, as pure functions.
 *
 * Nothing here touches sockets, timers, the database or the clock. Every function
 * takes a state and returns a new one. That keeps the rules exhaustively testable
 * without standing up a server or depending on its transport layer.
 */

import {
  boardConfig,
  isSafeSquare,
  PIECES_PER_PLAYER,
  ringIndexOf,
  teamOf,
  type BoardConfig,
} from './board.js'
import {
  CAPTURE_POINTS,
  HOME_POINTS,
  TIER_POINTS,
  WIN_POINTS,
  type AnswerLetter,
  type BoardPreset,
  type CaptureInfo,
  type GameMode,
  type GameState,
  type GameSummaryRow,
  type Piece,
  type PlayerState,
  type Tier,
  type TurnResult,
  type Winner,
} from './types.js'

export const MAX_CONSECUTIVE_EXTRA_TURNS = 2

export interface CreateGameOptions {
  mode: GameMode
  preset: BoardPreset
  players: Array<{ playerId: string; name: string }>
  /** Seat that takes the first turn. Defaults to 0. */
  firstSeat?: number
}

export function createGame(opts: CreateGameOptions): GameState {
  const players: PlayerState[] = opts.players.map((p, seat) => ({
    seat,
    playerId: p.playerId,
    name: p.name,
    team: teamOf(seat, opts.mode),
    connected: true,
    pieces: Array.from({ length: PIECES_PER_PLAYER }, (_, i): Piece => ({
      id: `${seat}-${i}`,
      seat,
      // Both pieces start on the board. Waiting to roll a 6 just to enter play is
      // the least fun part of Ludo and adds nothing to a question game.
      progress: 0,
    })),
    score: 0,
    answered: 0,
    correct: 0,
  }))

  return {
    mode: opts.mode,
    preset: opts.preset,
    players,
    turnSeat: opts.firstSeat ?? 0,
    phase: 'awaiting-roll',
    roll: null,
    question: null,
    chosenAnswer: null,
    lastResult: null,
    choices: [],
    pendingDistance: 0,
    extraTurnsUsed: 0,
    winner: null,
    log: [],
    nextLogId: 1,
  }
}

export function rollDie(rng: () => number = Math.random): number {
  return 1 + Math.floor(rng() * 6)
}

/** The die face is the tier. Rolling high offers more squares but a harder card. */
export function tierForRoll(roll: number): Tier {
  return roll as Tier
}

export function configOf(state: GameState): BoardConfig {
  return boardConfig(state.preset)
}

export function playerAt(state: GameState, seat: number): PlayerState | undefined {
  return state.players.find((p) => p.seat === seat)
}

function log(state: GameState, text: string): void {
  state.log.push({ id: state.nextLogId++, text })
  if (state.log.length > 40) state.log.shift()
}

/**
 * Which of a seat's pieces can actually make a move of the given signed distance.
 *
 * Forward: anything not already home.
 * Backward: only pieces still out on the ring and not already sitting on their own
 * start square. A piece that has reached the home column is safe from the penalty.
 */
export function eligiblePieces(state: GameState, seat: number, distance: number): string[] {
  const b = configOf(state)
  const player = playerAt(state, seat)
  if (!player || distance === 0) return []
  return player.pieces
    .filter((piece) =>
      distance > 0
        ? piece.progress < b.goal
        : piece.progress > 0 && piece.progress < b.ring,
    )
    .map((piece) => piece.id)
}

interface MoveEffects {
  captured: CaptureInfo[]
  reachedHome: boolean
  points: number
}

function performMove(state: GameState, pieceId: string, distance: number): MoveEffects {
  const b = configOf(state)
  const owner = state.players.find((p) => p.pieces.some((pc) => pc.id === pieceId))!
  const piece = owner.pieces.find((pc) => pc.id === pieceId)!
  const before = piece.progress

  piece.progress =
    distance > 0
      ? Math.min(before + distance, b.goal)
      : Math.max(before + distance, 0)

  const effects: MoveEffects = { captured: [], reachedHome: false, points: 0 }

  // Only forward moves capture, and only out on the ring.
  const landedOn = ringIndexOf(owner.seat, piece.progress, b)
  if (distance > 0 && landedOn !== null && !isSafeSquare(landedOn, b)) {
    for (const other of state.players) {
      if (other.team === owner.team) continue
      for (const enemy of other.pieces) {
        if (ringIndexOf(other.seat, enemy.progress, b) !== landedOn) continue
        enemy.progress = 0
        effects.captured.push({ seat: other.seat, pieceId: enemy.id })
      }
    }
  }

  if (effects.captured.length > 0) {
    effects.points += CAPTURE_POINTS * effects.captured.length
    log(
      state,
      `${owner.name} captured ${effects.captured.length} piece${effects.captured.length > 1 ? 's' : ''}.`,
    )
  }

  if (before < b.goal && piece.progress >= b.goal) {
    effects.reachedHome = true
    effects.points += HOME_POINTS
    log(state, `${owner.name} brought a piece home.`)
  }

  owner.score += effects.points
  return effects
}

/**
 * Start a turn: the server has rolled and drawn a card, so record both and open
 * the answering window.
 */
export function applyRoll(
  state: GameState,
  seat: number,
  roll: number,
  question: GameState['question'],
): GameState {
  const next = structuredClone(state)
  next.roll = roll
  next.question = question
  next.chosenAnswer = null
  next.lastResult = null
  next.choices = []
  next.pendingDistance = 0
  next.phase = 'answering'
  const player = playerAt(next, seat)
  log(next, `${player?.name ?? `Seat ${seat}`} rolled a ${roll}.`)
  return next
}

/**
 * Lock in the active player's answer without resolving it yet.
 *
 * The turn pauses here for a beat so everyone at the table can see which option was
 * chosen. Going straight from the question to "Wrong" told spectators the verdict
 * on a choice they never saw.
 */
export function markAnswer(state: GameState, letter: AnswerLetter): GameState {
  const next = structuredClone(state)
  next.chosenAnswer = letter
  return next
}

export interface ResolveAnswerInput {
  difficulty?: import("./types.js").Difficulty
  topic?: string
  /** Measured by the caller, which owns the clock. */
  timeMs?: number
  /** null means the clock ran out. */
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  explanation: string | null
  questionId: number
  questionText: string
  options: [string, string, string, string]
}

/**
 * Resolve the answer and work out the move it earns.
 *
 * Correct  -> move forward by the roll.
 * Wrong    -> move back floor(roll/2), never past your own start square.
 *
 * If exactly one piece can make that move we just make it, rather than asking the
 * player to "choose" between one option.
 */
export function resolveAnswer(state: GameState, input: ResolveAnswerInput): GameState {
  const next = structuredClone(state)
  const seat = next.turnSeat
  const roll = next.roll ?? 0
  const tier = tierForRoll(roll)
  const player = playerAt(next, seat)!

  const wasCorrect = input.chosen !== null && input.chosen === input.correctLetter
  const distance = wasCorrect ? roll : -Math.floor(roll / 2)

  player.answered += 1
  if (wasCorrect) {
    player.correct += 1
    player.score += TIER_POINTS[tier]
  }

  log(
    next,
    input.chosen === null
      ? `${player.name} ran out of time.`
      : wasCorrect
        ? `${player.name} answered ${input.chosen} — correct.`
        : `${player.name} answered ${input.chosen} — the answer was ${input.correctLetter}.`,
  )

  const result: TurnResult = {
    seat,
    roll,
    difficulty: input.difficulty ?? state.question?.difficulty ?? 'medium',
    topic: input.topic ?? state.question?.topic ?? '',
    questionId: input.questionId,
    questionText: input.questionText,
    options: input.options,
    chosen: input.chosen,
    correctLetter: input.correctLetter,
    wasCorrect,
    explanation: input.explanation,
    timeMs: input.timeMs ?? 0,
    distance,
    movedPieceId: null,
    captured: [],
    pointsEarned: wasCorrect ? TIER_POINTS[tier] : 0,
    reachedHome: false,
    extraTurn: false,
  }

  const choices = eligiblePieces(next, seat, distance)

  if (choices.length === 0) {
    result.distance = 0
    next.lastResult = result
    next.phase = 'revealing'
    finishTurnResolution(next)
    return next
  }

  if (choices.length === 1) {
    const effects = performMove(next, choices[0], distance)
    result.movedPieceId = choices[0]
    result.captured = effects.captured
    result.pointsEarned += effects.points
    result.reachedHome = effects.reachedHome
    next.lastResult = result
    next.phase = 'revealing'
    finishTurnResolution(next)
    return next
  }

  next.lastResult = result
  next.choices = choices
  next.pendingDistance = distance
  next.phase = 'choosing-piece'
  return next
}

/** The active player picks which of their pieces takes the move. */
export function choosePiece(state: GameState, seat: number, pieceId: string): GameState {
  if (state.phase !== 'choosing-piece') throw new Error('Not choosing a piece right now')
  if (seat !== state.turnSeat) throw new Error('Not your turn')
  if (!state.choices.includes(pieceId)) throw new Error('That piece cannot make this move')

  const next = structuredClone(state)
  const effects = performMove(next, pieceId, next.pendingDistance)
  const result = next.lastResult!
  result.movedPieceId = pieceId
  result.captured = effects.captured
  result.pointsEarned += effects.points
  result.reachedHome = effects.reachedHome
  next.choices = []
  next.pendingDistance = 0
  next.phase = 'revealing'
  finishTurnResolution(next)
  return next
}

/** Shared tail of both resolution paths: check for a winner, then for an extra turn. */
function finishTurnResolution(state: GameState): void {
  const winner = detectWinner(state)
  if (winner) {
    state.winner = winner
    awardWinBonus(state, winner)
    state.phase = 'revealing'
    log(state, winnerLabel(state, winner) + ' wins!')
    return
  }
  const result = state.lastResult!
  result.extraTurn =
    result.roll === 6 &&
    result.wasCorrect &&
    state.extraTurnsUsed < MAX_CONSECUTIVE_EXTRA_TURNS
}

/**
 * The target is the same in both modes: two pieces home.
 *
 * In FFA that means your own two. In 2v2 it means any two between the partners,
 * so either partner can carry the team. Requiring all four of a team's pieces
 * would double the target and make team games run twice as long as free-for-all
 * ones — measured at 81 turns against 42-56 on the same board.
 */
export const PIECES_TO_WIN = PIECES_PER_PLAYER

export function detectWinner(state: GameState): Winner | null {
  const b = configOf(state)
  const piecesHome = (p: PlayerState) => p.pieces.filter((pc) => pc.progress >= b.goal).length

  if (state.mode === 'ffa') {
    const done = state.players.find((p) => piecesHome(p) >= PIECES_TO_WIN)
    return done ? { type: 'player', seat: done.seat } : null
  }

  for (const team of [0, 1]) {
    const members = state.players.filter((p) => p.team === team)
    if (members.length === 0) continue
    const home = members.reduce((total, p) => total + piecesHome(p), 0)
    if (home >= PIECES_TO_WIN) return { type: 'team', team }
  }
  return null
}

function awardWinBonus(state: GameState, winner: Winner): void {
  for (const p of state.players) {
    const won = winner.type === 'player' ? p.seat === winner.seat : p.team === winner.team
    if (won) p.score += WIN_POINTS
  }
}

function winnerLabel(state: GameState, winner: Winner): string {
  if (winner.type === 'player') return playerAt(state, winner.seat)?.name ?? 'Someone'
  const members = state.players.filter((p) => p.team === winner.team).map((p) => p.name)
  return members.join(' & ')
}

/**
 * Close out the turn and hand over. A correct answer on a 6 keeps the dice, capped
 * so a lucky streak cannot lock everyone else out.
 */
export function endTurn(state: GameState): GameState {
  const next = structuredClone(state)

  if (next.winner) {
    next.phase = 'game-over'
    next.question = null
    next.choices = []
    return next
  }

  if (next.lastResult?.extraTurn) {
    next.extraTurnsUsed += 1
    log(next, `${playerAt(next, next.turnSeat)?.name} rolled a 6 and goes again.`)
  } else {
    next.extraTurnsUsed = 0
    next.turnSeat = (next.turnSeat + 1) % next.players.length
  }

  next.phase = 'awaiting-roll'
  next.roll = null
  next.question = null
  next.choices = []
  next.pendingDistance = 0
  return next
}

export function summarise(state: GameState): GameSummaryRow[] {
  const b = configOf(state)
  return state.players
    .map((p) => ({
      seat: p.seat,
      playerId: p.playerId,
      name: p.name,
      team: p.team,
      score: p.score,
      answered: p.answered,
      correct: p.correct,
      piecesHome: p.pieces.filter((pc) => pc.progress >= b.goal).length,
      won:
        state.winner?.type === 'player'
          ? state.winner.seat === p.seat
          : state.winner?.type === 'team'
            ? state.winner.team === p.team
            : false,
    }))
    .sort((a, z) => z.score - a.score)
}
