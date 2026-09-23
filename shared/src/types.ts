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
 * How hard a question is, independent of its tier.
 *
 * The tier is a die face — it decides how far you move and how many points the card
 * is worth. The difficulty is about the medicine, and it is what a room is filtered
 * by: an Easy room only ever draws Easy questions.
 */
export type Difficulty = 'easy' | 'medium' | 'hard'

export const SINGLE_LEVEL: Difficulty | null = 'easy'

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

/**
 * Seconds a player gets to answer, by the room's difficulty.
 *
 * It used to scale with the tier, from 20s up to 45s, and the table could not keep
 * up — reading a clinical stem, weighing four options and tapping one is a minute's
 * work. Hard cards are longer stems, so the research team asked for half as much
 * again.
 */
export const ANSWER_SECONDS: Record<Difficulty, number> = {
  easy: 60,
  medium: 60,
  hard: 90,
}

/**
 * How long the die tumbles on screen before its question appears. The server
 * starts a player's answer time after it, so recorded response times measure
 * the player rather than the animation.
 */
export const QUESTION_SHOW_DELAY_MS = 1500

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

/**
 * Topics are free-text labels admins manage, not an enum. The empty string means
 * uncategorised and is shown as this.
 */
export const GENERAL_TOPIC_NAME = 'General'
export const TOPIC_MAX_LENGTH = 40

export function topicLabel(topic: string): string {
  return topic || GENERAL_TOPIC_NAME
}

export interface TopicCount {
  topic: string
  count: number
}

export interface Question {
  id: number
  difficulty: Difficulty
  /** '' = uncategorised ("General"). */
  topic: string
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
  difficulty: Difficulty
  topic: string
  id: number
  text: string
  options: [string, string, string, string]
  /** Epoch ms. The server enforces this; the client only renders the countdown. */
  deadline: number
}

/** Draft shape used by the admin form and the bulk importer alike. */
export interface QuestionDraft {
  difficulty: Difficulty
  /** Omitted = leave an existing question's topic alone ('' when creating). */
  topic?: string
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
  difficulty: Difficulty
  topic: string
  questionId: number
  questionText: string
  options: [string, string, string, string]
  /** null means the clock ran out. */
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  wasCorrect: boolean
  explanation: string | null
  /**
   * How long the player took, from the question appearing to their answer arriving;
   * the full allowed time on a timeout.
   */
  timeMs: number
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
  /** Topics the deck is drawn from; empty means every topic. */
  topics: string[]
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
    p: {
      playerId: string
      mode: GameMode
      preset: BoardPreset
      difficulty: Difficulty
      /** Omitted or empty = every topic. */
      topics?: string[]
    },
    ack: (r: Ack<{ code: string }>) => void,
  ) => void
  joinRoom: (p: { playerId: string; code: string }, ack: (r: Ack<{ code: string }>) => void) => void
  leaveRoom: (ack: (r: Ack) => void) => void
  setReady: (p: { ready: boolean }, ack: (r: Ack) => void) => void
  setMode: (
    p: { mode: GameMode; preset: BoardPreset; difficulty?: Difficulty; topics?: string[] },
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
  gameOver: (p: GameOverPayload) => void
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

/** One answered question, for the end-of-game review. Only exists after its reveal. */
export interface ReviewItem {
  seat: number
  playerId: string
  questionId: number
  topic: string
  difficulty: Difficulty
  questionText: string
  options: [string, string, string, string]
  /** null means the clock ran out. */
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  outcome: AnswerOutcome
  explanation: string | null
  timeMs: number
}

export interface GameOverPayload {
  winner: Winner
  summary: GameSummaryRow[]
  /** Every human player's answered questions, in play order. Filter by playerId. */
  review: ReviewItem[]
}

// ---------------------------------------------------------------------------
// Answer log and progress (research data)
// ---------------------------------------------------------------------------

export type AnswerOutcome = 'correct' | 'wrong' | 'timeout'

/** One attempt at one question by a human player, as the room engine reports it. */
export interface AnswerRecord {
  playerId: string
  questionId: number
  topic: string
  difficulty: Difficulty
  roomCode: string
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  outcome: AnswerOutcome
  timeMs: number
  /** ISO timestamp. */
  answeredAt: string
}

/**
 * Accuracy counts a timeout as a miss, like the leaderboard does. The time figures
 * only cover questions actually answered: a timeout's time is just the clock length.
 */
export interface AnswerStats {
  answered: number
  correct: number
  wrong: number
  timeouts: number
  /** 0..1, correct / answered. 0 when nothing has been answered. */
  accuracy: number
  medianTimeMs: number | null
  meanTimeMs: number | null
}

export interface TopicStats extends AnswerStats {
  topic: string
}

export interface ProgressTrendPoint {
  gameId: string
  /** ISO timestamp of the first answer in that game. */
  playedAt: string
  topic: string
  answered: number
  correct: number
}

export interface ProgressMistake {
  questionId: number
  questionText: string
  options: [string, string, string, string]
  topic: string
  difficulty: Difficulty
  /** The player's most recent wrong choice; null if that attempt timed out. */
  lastWrongChoice: AnswerLetter | null
  lastWrongAt: string
  correctLetter: AnswerLetter
  explanation: string | null
  timesSeen: number
  /** Their latest attempt at this question was correct. */
  nowCorrect: boolean
}

export interface ProgressAttempt {
  questionId: number
  questionText: string
  topic: string
  chosen: AnswerLetter | null
  correctLetter: AnswerLetter
  outcome: AnswerOutcome
  timeMs: number
  answeredAt: string
}

export interface PlayerProgress {
  player: PlayerProfile
  totals: AnswerStats
  byTopic: TopicStats[]
  trend: ProgressTrendPoint[]
  mistakes: ProgressMistake[]
  recent: ProgressAttempt[]
}

/** Admin "Players" tab. Answer figures come from the answer log. */
export interface AdminPlayerRow extends AnswerStats {
  id: string
  name: string
  gamesPlayed: number
  totalScore: number
  lastSeen: string
}

/** Admin question list row: the question plus timing from the answer log. */
export interface AdminQuestion extends Question {
  loggedAnswers: number
  loggedTimeouts: number
  /** Mean over non-timeout answers; null when there are none. */
  avgTimeMs: number | null
}
