import { Sqlite } from './sqlite.js'
import type {
  AnswerLetter,
  Difficulty,
  GameSummaryRow,
  LeaderboardRow,
  PlayerProfile,
  Question,
  QuestionDraft,
} from '@shared/types.js'
import { DIFFICULTIES } from '@shared/types.js'

interface QuestionRow {
  id: number
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
    // Older unlabelled rows use the default difficulty.
    difficulty: DIFFICULTIES.includes(row.difficulty as Difficulty)
      ? (row.difficulty as Difficulty)
      : 'medium',
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

const DIFFICULTY_EXPR =
  "COALESCE(difficulty, 'medium')"

export class Db {
  constructor(readonly sql: Sqlite) {}

  // -- questions ------------------------------------------------------------

  listQuestions(
    filter: { difficulty?: Difficulty; active?: boolean; search?: string } = {},
  ): Question[] {
    const where: string[] = []
    const binds: unknown[] = []
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
      ' ORDER BY COALESCE(source_card, 1000000), id'
    const { results } = this.sql
      .prepare(sql)
      .bind(...binds)
      .all<QuestionRow>()
    return results.map(toQuestion)
  }

  getQuestion(id: number): Question | null {
    const row = this.sql
      .prepare('SELECT * FROM questions WHERE id = ?')
      .bind(id)
      .first<QuestionRow>()
    return row ? toQuestion(row) : null
  }

  activeCountByDifficulty(): Record<Difficulty, number> {
    const counts = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>
    const { results } = this.sql
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

  activeQuestionsForPlay(difficulty?: Difficulty): Question[] {
    return this.listQuestions({ active: true, difficulty })
  }

  createQuestion(draft: QuestionDraft): Question {
    const ts = now()
    const result = this.sql
      .prepare(
        `INSERT INTO questions
           (difficulty, source_card, text, option_a, option_b, option_c, option_d, answer, explanation, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        draft.difficulty,
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
    return (this.getQuestion(result!.id))!
  }

  updateQuestion(id: number, patch: Partial<QuestionDraft>): Question | null {
    const existing = this.getQuestion(id)
    if (!existing) return null
    const merged = {
      difficulty: patch.difficulty ?? existing.difficulty,
      text: patch.text ?? existing.text,
      options: patch.options ?? existing.options,
      answer: patch.answer ?? existing.answer,
      explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
      active: patch.active !== undefined ? patch.active : existing.active,
    }
    this.sql
      .prepare(
        `UPDATE questions SET difficulty=?, text=?, option_a=?, option_b=?, option_c=?, option_d=?,
         answer=?, explanation=?, active=?, updated_at=? WHERE id=?`,
      )
      .bind(
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

  deleteQuestion(id: number): void {
    this.sql.prepare('DELETE FROM questions WHERE id = ?').bind(id).run()
  }

  upsertBySourceCard(
    draft: QuestionDraft & { sourceCard: number },
  ): { created: boolean } {
    const row = this.sql
      .prepare('SELECT id FROM questions WHERE source_card = ?')
      .bind(draft.sourceCard)
      .first<{ id: number }>()
    if (row) {
      this.updateQuestion(row.id, draft)
      return { created: false }
    }
    this.createQuestion(draft)
    return { created: true }
  }

  recordAnswerStat(
    questionId: number,
    outcome: 'correct' | 'wrong' | 'timeout',
  ): void {
    this.sql
      .prepare(
        `UPDATE questions SET times_asked = times_asked + 1,
           times_correct = times_correct + ?, times_timeout = times_timeout + ?
         WHERE id = ?`,
      )
      .bind(outcome === 'correct' ? 1 : 0, outcome === 'timeout' ? 1 : 0, questionId)
      .run()
  }

  resetQuestionStats(id?: number): void {
    const sql = 'UPDATE questions SET times_asked=0, times_correct=0, times_timeout=0'
    if (id === undefined) this.sql.prepare(sql).run()
    else this.sql.prepare(`${sql} WHERE id = ?`).bind(id).run()
  }

  // -- players --------------------------------------------------------------

  createPlayer(name: string): PlayerProfile {
    const ts = now()
    for (let attempt = 0; attempt < 50; attempt++) {
      const id = String(100000 + Math.floor(Math.random() * 900000))
      const taken = this.sql.prepare('SELECT 1 FROM players WHERE id = ?').bind(id).first()
      if (taken) continue
      this.sql
        .prepare('INSERT INTO players (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .bind(id, name.trim().slice(0, 24), ts, ts)
        .run()
      return (this.getPlayer(id))!
    }
    throw new Error('Could not allocate a player ID')
  }

  getPlayer(id: string): PlayerProfile | null {
    const row = this.sql
      .prepare('SELECT * FROM players WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>()
    return row ? toProfile(row) : null
  }

  touchPlayer(id: string): void {
    this.sql.prepare('UPDATE players SET last_seen = ? WHERE id = ?').bind(now(), id).run()
  }

  renamePlayer(id: string, name: string): PlayerProfile | null {
    this.sql
      .prepare('UPDATE players SET name = ? WHERE id = ?')
      .bind(name.trim().slice(0, 24), id)
      .run()
    return this.getPlayer(id)
  }

  recordGameResults(rows: GameSummaryRow[], transaction = true): void {
    if (rows.length === 0) return
    const ts = now()
    const stmt = this.sql.prepare(
      `UPDATE players SET total_score = total_score + ?, games_played = games_played + 1,
         wins = wins + ?, answered = answered + ?, correct = correct + ?, last_seen = ?
       WHERE id = ?`,
    )
    const queries = rows.map((r) => stmt.bind(r.score, r.won ? 1 : 0, r.answered, r.correct, ts, r.playerId))
    if (transaction) this.sql.batch(queries)
    else for (const query of queries) query.run()
  }

  leaderboard(limit = 100): LeaderboardRow[] {
    const { results } = this.sql
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
