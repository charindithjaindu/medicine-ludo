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

/**
 * Seconds a player gets to answer, whatever the card.
 *
 * It used to scale with the tier, from 20s up to 45s, and the table could not keep
 * up — reading a clinical stem, weighing four options and tapping one is a minute's
 * work, so everyone gets a minute.
 */
export const ANSWER_SECONDS = 60

/**
 * How hard a question is, independent of its tier.
 *
 * The tier is a die face — it decides how far you move and how many points the card
 * is worth. The difficulty is about the medicine, and it is what a room is filtered
 * by: an Easy room only ever draws Easy questions.
 */
export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

export const DIFFICULTY_EMOJI: Record<Difficulty, string> = {
  easy: '🌱',
  medium: '⚖️',
  hard: '🔥',
}

/**
 * The label a question gets when nobody has classified it yet. The seeded deck is
 * already ordered by tier — EASY through VERY DIFFICULT — so its own ordering is the
 * best guess available.
 */
export function difficultyForTier(tier: Tier): Difficulty {
  if (tier <= 2) return 'easy'
  if (tier <= 4) return 'medium'
  return 'hard'
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && DIFFICULTIES.includes(value as Difficulty)
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
  difficulty: Difficulty
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
  difficulty: Difficulty
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
  /**
   * The answer the active player has locked in, held here for a moment before it
   * resolves. It exists so the rest of the table sees *what* was picked before they
   * are told whether it was right.
   */
  chosenAnswer: AnswerLetter | null
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
  /** null for a human; the skill level for a computer player. */
  ai: import('./ai.js').AiSkill | null
}

export interface RoomView {
  code: string
  hostPlayerId: string
  mode: GameMode
  preset: BoardPreset
  /** Every card drawn in this room carries this label. */
  difficulty: Difficulty
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
    p: { playerId: string; mode: GameMode; preset: BoardPreset; difficulty: Difficulty },
    ack: (r: Ack<{ code: string }>) => void,
  ) => void
  joinRoom: (p: { playerId: string; code: string }, ack: (r: Ack<{ code: string }>) => void) => void
  leaveRoom: (ack: (r: Ack) => void) => void
  setReady: (p: { ready: boolean }, ack: (r: Ack) => void) => void
  setMode: (
    p: { mode: GameMode; preset: BoardPreset; difficulty?: Difficulty },
    ack: (r: Ack) => void,
  ) => void
  swapSeats: (p: { a: number; b: number }, ack: (r: Ack) => void) => void
  addAi: (p: { skill: import('./ai.js').AiSkill }, ack: (r: Ack) => void) => void
  removeSeat: (p: { seat: number }, ack: (r: Ack) => void) => void
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
