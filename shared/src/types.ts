/**
 * Shared vocabulary for the whole app: the question bank, the game state, and the
 * socket contract. Both the server and the client import from here so there is a
 * single definition of every shape that crosses the wire.
 */

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * A tier is also a die face. Rolling a 4 draws a MID MEDIUM question and offers
 * 4 squares of movement. This coupling is the core mechanic of the game, which is
 * why tiers are numbered 1-6 rather than named.
 */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6

export const TIERS: Tier[] = [1, 2, 3, 4, 5, 6]

export const TIER_NAMES: Record<Tier, string> = {
  1: 'Easy',
  2: 'Mid Easy',
  3: 'Medium',
  4: 'Mid Medium',
  5: 'Difficult',
  6: 'Very Difficult',
}

/** Seconds a player gets to answer, by tier. Harder cards get more thinking time. */
export const TIER_TIME_LIMITS: Record<Tier, number> = {
  1: 20,
  2: 25,
  3: 30,
  4: 30,
  5: 40,
  6: 45,
}

/** Leaderboard points for a correct answer, by tier. */
export const TIER_POINTS: Record<Tier, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
}

export const CAPTURE_POINTS = 25
export const HOME_POINTS = 50
export const WIN_POINTS = 100

export type AnswerLetter = 'A' | 'B' | 'C' | 'D'
export const ANSWER_LETTERS: AnswerLetter[] = ['A', 'B', 'C', 'D']

export interface Question {
  id: number
  tier: Tier
  /** 1-90 for cards seeded from the PDF, null for admin-authored questions. */
  sourceCard: number | null
  text: string
  options: [string, string, string, string]
  answer: AnswerLetter
  explanation: string | null
  active: boolean
  timesAsked: number
  timesCorrect: number
  timesTimeout: number
}

/** A question as sent to players: no answer, no explanation. */
export interface QuestionForPlay {
  id: number
  tier: Tier
  text: string
  options: [string, string, string, string]
  /** Epoch ms. The server enforces this; the client only renders the countdown. */
  deadline: number
}

/** Draft shape used by the admin form and the bulk importer alike. */
export interface QuestionDraft {
  tier: Tier
  text: string
  options: [string, string, string, string]
  answer: AnswerLetter
  explanation?: string | null
  active?: boolean
  sourceCard?: number | null
}

// ---------------------------------------------------------------------------
// Players and identity
// ---------------------------------------------------------------------------

export interface PlayerProfile {
  id: string
  name: string
  totalScore: number
  gamesPlayed: number
  wins: number
  answered: number
  correct: number
}

export interface LeaderboardRow extends PlayerProfile {
  rank: number
  accuracy: number
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GameMode = 'ffa' | 'teams'
export type BoardPreset = 'quick' | 'standard'

export interface Piece {
  id: string
  seat: number
  /**
   * 0 .. ring-1        on the ring, counted from this seat's own start square
   * ring .. goal-1     in this seat's home column
   * goal               finished
   */
  progress: number
}

export interface PlayerState {
  seat: number
  playerId: string
  name: string
  /** In FFA every player is their own team, so team === seat. */
  team: number
  connected: boolean
  pieces: Piece[]
  score: number
  answered: number
  correct: number
}

export type TurnPhase =
  | 'awaiting-roll'
  | 'answering'
  | 'choosing-piece'
  | 'revealing'
  | 'game-over'

export interface CaptureInfo {
  seat: number
  pieceId: string
}

/** Everything needed to render the reveal after an answer resolves. */
export interface TurnResult {
  seat: number
  roll: number
  tier: Tier
  questionId: number
  questionText: string
  options: [string, string, string, string]
  /** null means the clock ran out. */
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  wasCorrect: boolean
  explanation: string | null
  /** Signed: positive on a correct answer, negative on a wrong one, 0 if nothing could move. */
  distance: number
  movedPieceId: string | null
  captured: CaptureInfo[]
  pointsEarned: number
  reachedHome: boolean
  extraTurn: boolean
}

export type Winner =
  | { type: 'player'; seat: number }
  | { type: 'team'; team: number }

export interface LogEntry {
  id: number
  text: string
}

export interface GameState {
  mode: GameMode
  preset: BoardPreset
  players: PlayerState[]
  turnSeat: number
  phase: TurnPhase
  roll: number | null
  question: QuestionForPlay | null
  /** Set once an answer resolves, cleared on the next roll. */
  lastResult: TurnResult | null
  /** Pieces the active player may pick between, when phase is 'choosing-piece'. */
  choices: string[]
  /** Signed distance the chosen piece will travel. */
  pendingDistance: number
  extraTurnsUsed: number
  winner: Winner | null
  log: LogEntry[]
  nextLogId: number
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface Seat {
  seat: number
  playerId: string
  name: string
  team: number
  ready: boolean
  connected: boolean
}

export interface RoomView {
  code: string
  hostPlayerId: string
  mode: GameMode
  preset: BoardPreset
  seats: Seat[]
  started: boolean
}

// ---------------------------------------------------------------------------
// Socket contract
// ---------------------------------------------------------------------------

export interface Ack<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

export interface ClientToServerEvents {
  createRoom: (
    p: { playerId: string; mode: GameMode; preset: BoardPreset },
    ack: (r: Ack<{ code: string }>) => void,
  ) => void
  joinRoom: (p: { playerId: string; code: string }, ack: (r: Ack<{ code: string }>) => void) => void
  leaveRoom: (ack: (r: Ack) => void) => void
  setReady: (p: { ready: boolean }, ack: (r: Ack) => void) => void
  setMode: (p: { mode: GameMode; preset: BoardPreset }, ack: (r: Ack) => void) => void
  swapSeats: (p: { a: number; b: number }, ack: (r: Ack) => void) => void
  startGame: (ack: (r: Ack) => void) => void
  roll: (ack: (r: Ack) => void) => void
  answer: (p: { letter: AnswerLetter }, ack: (r: Ack) => void) => void
  choosePiece: (p: { pieceId: string }, ack: (r: Ack) => void) => void
}

export interface ServerToClientEvents {
  room: (room: RoomView) => void
  game: (state: GameState) => void
  gameOver: (p: { winner: Winner; summary: GameSummaryRow[] }) => void
  roomClosed: (p: { reason: string }) => void
}

export interface GameSummaryRow {
  seat: number
  playerId: string
  name: string
  team: number
  score: number
  answered: number
  correct: number
  piecesHome: number
  won: boolean
}
