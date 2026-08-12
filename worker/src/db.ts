/**
 * D1 queries. Same schema and same SQL as the SQLite build it replaced — D1 speaks
 * SQLite — but every call is async.
 */

import type {
  AnswerLetter,
  Difficulty,
  GameSummaryRow,
  LeaderboardRow,
  PlayerProfile,
  Question,
  QuestionDraft,
  Tier,
} from '@shared/types.js'
import { DIFFICULTIES, TIERS, difficultyForTier } from '@shared/types.js'

interface QuestionRow {
  id: number
  tier: number
  difficulty: string | null
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
    // A row written before the column existed reads as NULL; fall back to the tier.
    difficulty: DIFFICULTIES.includes(row.difficulty as Difficulty)
      ? (row.difficulty as Difficulty)
      : difficultyForTier(row.tier as Tier),
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

const now = () => new Date().toISOString()

/**
 * SQL mirror of `difficultyForTier`, so a row left unlabelled by an older write still
 * groups and filters as something rather than dropping out of every query.
 */
const DIFFICULTY_EXPR =
  "COALESCE(difficulty, CASE WHEN tier <= 2 THEN 'easy' WHEN tier <= 4 THEN 'medium' ELSE 'hard' END)"

export class Db {
  constructor(private d1: D1Database) {}

  // -- questions ------------------------------------------------------------

  async listQuestions(
    filter: { tier?: Tier; difficulty?: Difficulty; active?: boolean; search?: string } = {},
  ): Promise<Question[]> {
    const where: string[] = []
    const binds: unknown[] = []
    if (filter.tier !== undefined) {
      where.push('tier = ?')
      binds.push(filter.tier)
    }
    if (filter.difficulty !== undefined) {
      where.push(`${DIFFICULTY_EXPR} = ?`)
      binds.push(filter.difficulty)
    }
    if (filter.active !== undefined) {
      where.push('active = ?')
      binds.push(filter.active ? 1 : 0)
    }
    if (filter.search) {
      where.push(
        '(text LIKE ? OR option_a LIKE ? OR option_b LIKE ? OR option_c LIKE ? OR option_d LIKE ?)',
      )
      const like = `%${filter.search}%`
      binds.push(like, like, like, like, like)
    }
    const sql =
      `SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}` +
      ' ORDER BY tier, COALESCE(source_card, 1000000), id'
    const { results } = await this.d1
      .prepare(sql)
      .bind(...binds)
      .all<QuestionRow>()
    return results.map(toQuestion)
  }

  async getQuestion(id: number): Promise<Question | null> {
    const row = await this.d1
      .prepare('SELECT * FROM questions WHERE id = ?')
      .bind(id)
      .first<QuestionRow>()
    return row ? toQuestion(row) : null
  }

  async activeCountByTier(): Promise<Record<Tier, number>> {
    const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>
    const { results } = await this.d1
      .prepare('SELECT tier, COUNT(*) AS n FROM questions WHERE active = 1 GROUP BY tier')
      .all<{ tier: number; n: number }>()
    for (const r of results) counts[r.tier as Tier] = r.n
    return counts
  }

  async activeCountByDifficulty(): Promise<Record<Difficulty, number>> {
    const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>
    const { results } = await this.d1
      .prepare(
        `SELECT ${DIFFICULTY_EXPR} AS difficulty, COUNT(*) AS n
         FROM questions WHERE active = 1 GROUP BY 1`,
      )
      .all<{ difficulty: string; n: number }>()
    for (const r of results) {
      if (DIFFICULTIES.includes(r.difficulty as Difficulty)) counts[r.difficulty as Difficulty] = r.n
    }
    return counts
  }

  /** The decks a room starts with: active questions of its difficulty, split by tier. */
  async activeQuestionsByTier(difficulty?: Difficulty): Promise<Record<Tier, Question[]>> {
    const byTier = Object.fromEntries(TIERS.map((t) => [t, [] as Question[]])) as Record<
      Tier,
      Question[]
    >
    for (const q of await this.listQuestions({ active: true, difficulty })) byTier[q.tier].push(q)
    return byTier
  }

  async createQuestion(draft: QuestionDraft): Promise<Question> {
    const ts = now()
    const result = await this.d1
      .prepare(
        `INSERT INTO questions
           (tier, difficulty, source_card, text, option_a, option_b, option_c, option_d, answer, explanation, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        draft.tier,
        draft.difficulty ?? difficultyForTier(draft.tier),
        draft.sourceCard ?? null,
        draft.text,
        draft.options[0],
        draft.options[1],
        draft.options[2],
        draft.options[3],
        draft.answer,
        draft.explanation ?? null,
        draft.active === false ? 0 : 1,
        ts,
        ts,
      )
      .first<{ id: number }>()
    return (await this.getQuestion(result!.id))!
  }

  async updateQuestion(id: number, patch: Partial<QuestionDraft>): Promise<Question | null> {
    const existing = await this.getQuestion(id)
    if (!existing) return null
    const merged = {
      tier: patch.tier ?? existing.tier,
      difficulty: patch.difficulty ?? existing.difficulty,
      text: patch.text ?? existing.text,
      options: patch.options ?? existing.options,
      answer: patch.answer ?? existing.answer,
      explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
      active: patch.active !== undefined ? patch.active : existing.active,
    }
    await this.d1
      .prepare(
        `UPDATE questions SET tier=?, difficulty=?, text=?, option_a=?, option_b=?, option_c=?, option_d=?,
         answer=?, explanation=?, active=?, updated_at=? WHERE id=?`,
      )
      .bind(
        merged.tier,
        merged.difficulty,
        merged.text,
        merged.options[0],
        merged.options[1],
        merged.options[2],
        merged.options[3],
        merged.answer,
        merged.explanation,
        merged.active ? 1 : 0,
        now(),
        id,
      )
      .run()
    return this.getQuestion(id)
  }

  async deleteQuestion(id: number): Promise<void> {
    await this.d1.prepare('DELETE FROM questions WHERE id = ?').bind(id).run()
  }

  async upsertBySourceCard(
    draft: QuestionDraft & { sourceCard: number },
  ): Promise<{ created: boolean }> {
    const row = await this.d1
      .prepare('SELECT id FROM questions WHERE source_card = ?')
      .bind(draft.sourceCard)
      .first<{ id: number }>()
    if (row) {
      await this.updateQuestion(row.id, draft)
      return { created: false }
    }
    await this.createQuestion(draft)
    return { created: true }
  }

  async recordAnswerStat(
    questionId: number,
    outcome: 'correct' | 'wrong' | 'timeout',
  ): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE questions SET times_asked = times_asked + 1,
           times_correct = times_correct + ?, times_timeout = times_timeout + ?
         WHERE id = ?`,
      )
      .bind(outcome === 'correct' ? 1 : 0, outcome === 'timeout' ? 1 : 0, questionId)
      .run()
  }

  async resetQuestionStats(id?: number): Promise<void> {
    const sql = 'UPDATE questions SET times_asked=0, times_correct=0, times_timeout=0'
    if (id === undefined) await this.d1.prepare(sql).run()
    else await this.d1.prepare(`${sql} WHERE id = ?`).bind(id).run()
  }

  // -- players --------------------------------------------------------------

  async createPlayer(name: string): Promise<PlayerProfile> {
    const ts = now()
    for (let attempt = 0; attempt < 50; attempt++) {
      const id = String(100000 + Math.floor(Math.random() * 900000))
      const taken = await this.d1.prepare('SELECT 1 FROM players WHERE id = ?').bind(id).first()
      if (taken) continue
      await this.d1
        .prepare('INSERT INTO players (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .bind(id, name.trim().slice(0, 24), ts, ts)
        .run()
      return (await this.getPlayer(id))!
    }
    throw new Error('Could not allocate a player ID')
  }

  async getPlayer(id: string): Promise<PlayerProfile | null> {
    const row = await this.d1
      .prepare('SELECT * FROM players WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? toProfile(row) : null
  }

  async touchPlayer(id: string): Promise<void> {
    await this.d1.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(now(), id).run()
  }

  async renamePlayer(id: string, name: string): Promise<PlayerProfile | null> {
    await this.d1
      .prepare('UPDATE players SET name = ? WHERE id = ?')
      .bind(name.trim().slice(0, 24), id)
      .run()
    return this.getPlayer(id)
  }

  async recordGameResults(rows: GameSummaryRow[]): Promise<void> {
    if (rows.length === 0) return
    const ts = now()
    const stmt = this.d1.prepare(
      `UPDATE players SET total_score = total_score + ?, games_played = games_played + 1,
         wins = wins + ?, answered = answered + ?, correct = correct + ?, last_seen = ?
       WHERE id = ?`,
    )
    await this.d1.batch(
      rows.map((r) => stmt.bind(r.score, r.won ? 1 : 0, r.answered, r.correct, ts, r.playerId)),
    )
  }

  async leaderboard(limit = 100): Promise<LeaderboardRow[]> {
    const { results } = await this.d1
      .prepare(
        `SELECT * FROM players WHERE games_played > 0
         ORDER BY total_score DESC, wins DESC, correct DESC LIMIT ?`,
      )
      .bind(limit)
      .all<Record<string, unknown>>()
    return results.map((row, i) => {
      const p = toProfile(row)
      return { ...p, rank: i + 1, accuracy: p.answered > 0 ? p.correct / p.answered : 0 }
    })
  }
}
