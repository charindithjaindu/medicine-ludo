import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AnswerLetter,
  GameSummaryRow,
  LeaderboardRow,
  PlayerProfile,
  Question,
  QuestionDraft,
  Tier,
} from '@shared/types.js'
import { TIERS } from '@shared/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '../../data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'medicine-ludo.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id           TEXT PRIMARY KEY,
    name         TEXT    NOT NULL DEFAULT '',
    total_score  INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    answered     INTEGER NOT NULL DEFAULT 0,
    correct      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    last_seen    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tier          INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 6),
    -- 1-90 for cards seeded from the PDF, NULL for admin-authored questions.
    -- UNIQUE is what makes re-importing the PDF an update rather than a duplicate.
    source_card   INTEGER UNIQUE,
    text          TEXT    NOT NULL,
    option_a      TEXT    NOT NULL,
    option_b      TEXT    NOT NULL,
    option_c      TEXT    NOT NULL,
    option_d      TEXT    NOT NULL,
    answer        TEXT    NOT NULL CHECK (answer IN ('A','B','C','D')),
    explanation   TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    times_asked   INTEGER NOT NULL DEFAULT 0,
    times_correct INTEGER NOT NULL DEFAULT 0,
    times_timeout INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_questions_tier_active ON questions(tier, active);
`)

const now = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

interface QuestionRow {
  id: number
  tier: number
  source_card: number | null
  text: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  answer: string
  explanation: string | null
  active: number
  times_asked: number
  times_correct: number
  times_timeout: number
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    tier: row.tier as Tier,
    sourceCard: row.source_card,
    text: row.text,
    options: [row.option_a, row.option_b, row.option_c, row.option_d],
    answer: row.answer as AnswerLetter,
    explanation: row.explanation,
    active: row.active === 1,
    timesAsked: row.times_asked,
    timesCorrect: row.times_correct,
    timesTimeout: row.times_timeout,
  }
}

export interface QuestionFilter {
  tier?: Tier
  active?: boolean
  search?: string
}

export function listQuestions(filter: QuestionFilter = {}): Question[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.tier !== undefined) {
    where.push('tier = @tier')
    params.tier = filter.tier
  }
  if (filter.active !== undefined) {
    where.push('active = @active')
    params.active = filter.active ? 1 : 0
  }
  if (filter.search) {
    where.push(
      '(text LIKE @q OR option_a LIKE @q OR option_b LIKE @q OR option_c LIKE @q OR option_d LIKE @q)',
    )
    params.q = `%${filter.search}%`
  }
  const sql = `SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY tier, COALESCE(source_card, 1000000), id`
  return db.prepare(sql).all(params).map((r) => toQuestion(r as QuestionRow))
}

export function getQuestion(id: number): Question | null {
  const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as QuestionRow | undefined
  return row ? toQuestion(row) : null
}

/** How many playable questions each tier has. Used to enforce the no-empty-tier rule. */
export function activeCountByTier(): Record<Tier, number> {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>
  const rows = db
    .prepare('SELECT tier, COUNT(*) AS n FROM questions WHERE active = 1 GROUP BY tier')
    .all() as Array<{ tier: number; n: number }>
  for (const r of rows) counts[r.tier as Tier] = r.n
  return counts
}

export function activeQuestionsByTier(): Record<Tier, Question[]> {
  const byTier = Object.fromEntries(TIERS.map((t) => [t, [] as Question[]])) as Record<
    Tier,
    Question[]
  >
  for (const q of listQuestions({ active: true })) byTier[q.tier].push(q)
  return byTier
}

const insertQuestion = db.prepare(`
  INSERT INTO questions
    (tier, source_card, text, option_a, option_b, option_c, option_d, answer, explanation, active, created_at, updated_at)
  VALUES
    (@tier, @source_card, @text, @option_a, @option_b, @option_c, @option_d, @answer, @explanation, @active, @ts, @ts)
`)

export function createQuestion(draft: QuestionDraft): Question {
  const info = insertQuestion.run({
    tier: draft.tier,
    source_card: draft.sourceCard ?? null,
    text: draft.text,
    option_a: draft.options[0],
    option_b: draft.options[1],
    option_c: draft.options[2],
    option_d: draft.options[3],
    answer: draft.answer,
    explanation: draft.explanation ?? null,
    active: draft.active === false ? 0 : 1,
    ts: now(),
  })
  return getQuestion(Number(info.lastInsertRowid))!
}

export function updateQuestion(id: number, patch: Partial<QuestionDraft>): Question | null {
  const existing = getQuestion(id)
  if (!existing) return null
  const merged = {
    tier: patch.tier ?? existing.tier,
    text: patch.text ?? existing.text,
    options: patch.options ?? existing.options,
    answer: patch.answer ?? existing.answer,
    explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
    active: patch.active !== undefined ? patch.active : existing.active,
  }
  db.prepare(
    `UPDATE questions SET tier=@tier, text=@text, option_a=@a, option_b=@b, option_c=@c,
     option_d=@d, answer=@answer, explanation=@explanation, active=@active, updated_at=@ts
     WHERE id=@id`,
  ).run({
    id,
    tier: merged.tier,
    text: merged.text,
    a: merged.options[0],
    b: merged.options[1],
    c: merged.options[2],
    d: merged.options[3],
    answer: merged.answer,
    explanation: merged.explanation,
    active: merged.active ? 1 : 0,
    ts: now(),
  })
  return getQuestion(id)
}

export function deleteQuestion(id: number): boolean {
  return db.prepare('DELETE FROM questions WHERE id = ?').run(id).changes > 0
}

/**
 * Insert or update by PDF card number, preserving the row's id and its accumulated
 * stats. Re-running the import corrects the seeded cards instead of duplicating them.
 */
export function upsertBySourceCard(draft: QuestionDraft & { sourceCard: number }): {
  question: Question
  created: boolean
} {
  const row = db.prepare('SELECT id FROM questions WHERE source_card = ?').get(draft.sourceCard) as
    | { id: number }
    | undefined
  if (row) {
    return { question: updateQuestion(row.id, draft)!, created: false }
  }
  return { question: createQuestion(draft), created: true }
}

export function recordAnswerStat(questionId: number, outcome: 'correct' | 'wrong' | 'timeout') {
  db.prepare(
    `UPDATE questions SET
       times_asked   = times_asked + 1,
       times_correct = times_correct + @correct,
       times_timeout = times_timeout + @timeout
     WHERE id = @id`,
  ).run({
    id: questionId,
    correct: outcome === 'correct' ? 1 : 0,
    timeout: outcome === 'timeout' ? 1 : 0,
  })
}

export function resetQuestionStats(id?: number) {
  const sql = 'UPDATE questions SET times_asked=0, times_correct=0, times_timeout=0'
  if (id === undefined) db.prepare(sql).run()
  else db.prepare(sql + ' WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function toProfile(row: Record<string, unknown>): PlayerProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    totalScore: row.total_score as number,
    gamesPlayed: row.games_played as number,
    wins: row.wins as number,
    answered: row.answered as number,
    correct: row.correct as number,
  }
}

/** Six digits, so it is easy to read aloud and type back in on another device. */
function generatePlayerId(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = String(100000 + Math.floor(Math.random() * 900000))
    const taken = db.prepare('SELECT 1 FROM players WHERE id = ?').get(id)
    if (!taken) return id
  }
  throw new Error('Could not allocate a player ID')
}

export function createPlayer(name: string): PlayerProfile {
  const id = generatePlayerId()
  const ts = now()
  db.prepare(
    'INSERT INTO players (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)',
  ).run(id, name.trim().slice(0, 24), ts, ts)
  return getPlayer(id)!
}

export function getPlayer(id: string): PlayerProfile | null {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? toProfile(row) : null
}

export function touchPlayer(id: string) {
  db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now(), id)
}

export function renamePlayer(id: string, name: string): PlayerProfile | null {
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name.trim().slice(0, 24), id)
  return getPlayer(id)
}

/** Fold a finished game's per-player results into the lifetime totals. */
export const recordGameResults = db.transaction((rows: GameSummaryRow[]) => {
  const stmt = db.prepare(
    `UPDATE players SET
       total_score  = total_score + @score,
       games_played = games_played + 1,
       wins         = wins + @won,
       answered     = answered + @answered,
       correct      = correct + @correct,
       last_seen    = @ts
     WHERE id = @id`,
  )
  const ts = now()
  for (const r of rows) {
    stmt.run({
      id: r.playerId,
      score: r.score,
      won: r.won ? 1 : 0,
      answered: r.answered,
      correct: r.correct,
      ts,
    })
  }
})

export function leaderboard(limit = 100): LeaderboardRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM players WHERE games_played > 0
       ORDER BY total_score DESC, wins DESC, correct DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>
  return rows.map((row, i) => {
    const p = toProfile(row)
    return {
      ...p,
      rank: i + 1,
      accuracy: p.answered > 0 ? p.correct / p.answered : 0,
    }
  })
}
