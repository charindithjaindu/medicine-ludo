import { Sqlite } from './sqlite.js'
import type {
  AdminPlayerRow,
  AdminQuestion,
  AnswerLetter,
  AnswerOutcome,
  AnswerRecord,
  AnswerStats,
  Difficulty,
  GameSummaryRow,
  LeaderboardRow,
  PlayerProfile,
  PlayerProgress,
  ProgressAttempt,
  ProgressMistake,
  ProgressTrendPoint,
  Question,
  QuestionDraft,
  TopicCount,
} from '@shared/types.js'
import { DIFFICULTIES } from '@shared/types.js'

interface QuestionRow {
  id: number
  difficulty: string | null
  topic: string | null
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
    topic: row.topic ?? '',
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

/** A raw answer_log row, as the export and the stats read it. */
export interface AnswerLogExportRow {
  id: number
  answered_at: string
  game_id: string
  room_code: string
  player_id: string
  player_name: string
  question_id: number
  topic: string
  difficulty: string
  question_text: string
  chosen: string | null
  correct_letter: string
  outcome: AnswerOutcome
  time_ms: number
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Accuracy counts timeouts as misses. Times cover real answers only: a timeout's
 * time_ms is just the clock length, and would drag every average towards it.
 */
function statsOf(rows: Array<{ outcome: AnswerOutcome; time_ms: number }>): AnswerStats {
  const correct = rows.filter((r) => r.outcome === 'correct').length
  const timeouts = rows.filter((r) => r.outcome === 'timeout').length
  const times = rows
    .filter((r) => r.outcome !== 'timeout')
    .map((r) => r.time_ms)
    .sort((a, b) => a - b)
  return {
    answered: rows.length,
    correct,
    wrong: rows.length - correct - timeouts,
    timeouts,
    accuracy: rows.length ? correct / rows.length : 0,
    medianTimeMs: median(times),
    meanTimeMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

const DIFFICULTY_EXPR =
  "COALESCE(difficulty, 'medium')"

export class Db {
  constructor(readonly sql: Sqlite) {}

  // -- questions ------------------------------------------------------------

  listQuestions(
    filter: { difficulty?: Difficulty; topic?: string; active?: boolean; search?: string } = {},
  ): Question[] {
    const where: string[] = []
    const binds: unknown[] = []
    if (filter.difficulty !== undefined) {
      where.push(`${DIFFICULTY_EXPR} = ?`)
      binds.push(filter.difficulty)
    }
    if (filter.topic !== undefined) {
      where.push('topic = ?')
      binds.push(filter.topic)
    }
    if (filter.active !== undefined) {
      where.push('active = ?')
      binds.push(filter.active ? 1 : 0)
    }
    if (filter.search) {
      where.push(
        '(text LIKE ? OR option_a LIKE ? OR option_b LIKE ? OR option_c LIKE ? OR option_d LIKE ? OR topic LIKE ?)',
      )
      const like = `%${filter.search}%`
      binds.push(like, like, like, like, like, like)
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

  /**
   * Topics with their question counts. `activeOnly` is what a lobby may pick from;
   * the admin filter wants retired questions' topics too.
   */
  listTopics(filter: { difficulty?: Difficulty; activeOnly?: boolean } = {}): TopicCount[] {
    const where: string[] = []
    const binds: unknown[] = []
    if (filter.activeOnly !== false) where.push('active = 1')
    if (filter.difficulty !== undefined) {
      where.push(`${DIFFICULTY_EXPR} = ?`)
      binds.push(filter.difficulty)
    }
    return this.sql
      .prepare(
        `SELECT topic, COUNT(*) AS count FROM questions
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         GROUP BY topic ORDER BY topic = '', topic COLLATE NOCASE`,
      )
      .bind(...binds)
      .all<TopicCount>().results
  }

  /** The admin list: questions plus timing from the answer log. */
  listQuestionsWithTiming(filter: Parameters<Db['listQuestions']>[0] = {}): AdminQuestion[] {
    const { results } = this.sql
      .prepare(
        `SELECT question_id, COUNT(*) AS answers, SUM(outcome = 'timeout') AS timeouts,
           AVG(CASE WHEN outcome <> 'timeout' THEN time_ms END) AS avg_ms
         FROM answer_log GROUP BY question_id`,
      )
      .all<{ question_id: number; answers: number; timeouts: number; avg_ms: number | null }>()
    const timing = new Map(results.map((r) => [r.question_id, r]))
    return this.listQuestions(filter).map((q) => {
      const t = timing.get(q.id)
      return {
        ...q,
        loggedAnswers: t?.answers ?? 0,
        loggedTimeouts: t?.timeouts ?? 0,
        avgTimeMs: t?.avg_ms == null ? null : Math.round(t.avg_ms),
      }
    })
  }

  createQuestion(draft: QuestionDraft): Question {
    const ts = now()
    const result = this.sql
      .prepare(
        `INSERT INTO questions
           (difficulty, topic, source_card, text, option_a, option_b, option_c, option_d, answer, explanation, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        draft.difficulty,
        draft.topic ?? '',
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
      topic: patch.topic ?? existing.topic,
      text: patch.text ?? existing.text,
      options: patch.options ?? existing.options,
      answer: patch.answer ?? existing.answer,
      explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
      active: patch.active !== undefined ? patch.active : existing.active,
    }
    this.sql
      .prepare(
        `UPDATE questions SET difficulty=?, topic=?, text=?, option_a=?, option_b=?, option_c=?, option_d=?,
         answer=?, explanation=?, active=?, updated_at=? WHERE id=?`,
      )
      .bind(
        merged.difficulty,
        merged.topic,
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

  recordAnswer(record: AnswerRecord, gameId: string): void {
    this.sql
      .prepare(
        `INSERT INTO answer_log (player_id, question_id, topic, difficulty, room_code, game_id,
           chosen, correct_letter, outcome, time_ms, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.playerId,
        record.questionId,
        record.topic,
        record.difficulty,
        record.roomCode,
        gameId,
        record.chosen,
        record.correctLetter,
        record.outcome,
        Math.round(record.timeMs),
        record.answeredAt,
      )
      .run()
  }

  /** Raw attempts for the researchers, oldest first. Bounds are ISO strings. */
  exportAnswers(filter: { from?: string; to?: string; topic?: string } = {}): AnswerLogExportRow[] {
    const where: string[] = []
    const binds: unknown[] = []
    if (filter.from) { where.push('a.answered_at >= ?'); binds.push(filter.from) }
    if (filter.to) { where.push('a.answered_at < ?'); binds.push(filter.to) }
    if (filter.topic !== undefined) { where.push('a.topic = ?'); binds.push(filter.topic) }
    return this.sql
      .prepare(
        `SELECT a.id, a.answered_at, a.game_id, a.room_code, a.player_id,
           COALESCE(p.name, '') AS player_name, a.question_id, a.topic, a.difficulty,
           COALESCE(q.text, '') AS question_text, a.chosen, a.correct_letter, a.outcome, a.time_ms
         FROM answer_log a
         LEFT JOIN players p ON p.id = a.player_id
         LEFT JOIN questions q ON q.id = a.question_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY a.id`,
      )
      .bind(...binds)
      .all<AnswerLogExportRow>().results
  }

  /**
   * Everything the "my scoreboard" view needs, from the answer log alone — so it
   * starts from the first game played after the log existed. Row ids are insertion
   * order, which is answer order, so they double as the timeline.
   */
  playerProgress(id: string): PlayerProgress | null {
    const player = this.getPlayer(id)
    if (!player) return null

    const rows = this.sql
      .prepare(
        `SELECT game_id, topic, outcome, time_ms, answered_at FROM answer_log
         WHERE player_id = ? ORDER BY id`,
      )
      .bind(id)
      .all<{ game_id: string; topic: string; outcome: AnswerOutcome; time_ms: number; answered_at: string }>()
      .results

    const byTopic = [...groupBy(rows, (r) => r.topic)]
      .map(([topic, list]) => ({ topic, ...statsOf(list) }))
      .sort((a, b) => (a.topic === '' ? 1 : b.topic === '' ? -1 : a.topic.localeCompare(b.topic)))

    const trend: ProgressTrendPoint[] = []
    for (const [gameId, list] of groupBy(rows, (r) => r.game_id)) {
      const playedAt = list[0].answered_at
      for (const [topic, answers] of groupBy(list, (r) => r.topic)) {
        trend.push({
          gameId,
          playedAt,
          topic,
          answered: answers.length,
          correct: answers.filter((r) => r.outcome === 'correct').length,
        })
      }
    }

    const mistakes = this.sql
      .prepare(
        `WITH mine AS (SELECT * FROM answer_log WHERE player_id = ?),
         missed AS (SELECT question_id, MAX(id) AS wrong_id FROM mine
                    WHERE outcome <> 'correct' GROUP BY question_id),
         latest AS (SELECT question_id, MAX(id) AS last_id, COUNT(*) AS seen FROM mine
                    GROUP BY question_id)
         SELECT m.question_id, w.chosen, w.answered_at, la.outcome AS latest_outcome, l.seen,
           q.text, q.option_a, q.option_b, q.option_c, q.option_d, q.answer, q.explanation,
           q.topic, q.difficulty
         FROM missed m
         JOIN latest l ON l.question_id = m.question_id
         JOIN answer_log w ON w.id = m.wrong_id
         JOIN answer_log la ON la.id = l.last_id
         JOIN questions q ON q.id = m.question_id
         ORDER BY m.wrong_id DESC LIMIT 50`,
      )
      .bind(id)
      .all<{
        question_id: number; chosen: string | null; answered_at: string; latest_outcome: string
        seen: number; text: string; option_a: string; option_b: string; option_c: string
        option_d: string; answer: string; explanation: string | null; topic: string; difficulty: string
      }>()
      .results.map((r): ProgressMistake => ({
        questionId: r.question_id,
        questionText: r.text,
        options: [r.option_a, r.option_b, r.option_c, r.option_d],
        topic: r.topic,
        difficulty: DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : 'medium',
        lastWrongChoice: r.chosen as AnswerLetter | null,
        lastWrongAt: r.answered_at,
        // The bank's current answer, in case an admin has corrected the card since.
        correctLetter: r.answer as AnswerLetter,
        explanation: r.explanation,
        timesSeen: r.seen,
        nowCorrect: r.latest_outcome === 'correct',
      }))

    const recent = this.sql
      .prepare(
        `SELECT a.question_id, COALESCE(q.text, '') AS text, a.topic, a.chosen, a.correct_letter,
           a.outcome, a.time_ms, a.answered_at
         FROM answer_log a LEFT JOIN questions q ON q.id = a.question_id
         WHERE a.player_id = ? ORDER BY a.id DESC LIMIT 20`,
      )
      .bind(id)
      .all<{
        question_id: number; text: string; topic: string; chosen: string | null
        correct_letter: string; outcome: AnswerOutcome; time_ms: number; answered_at: string
      }>()
      .results.map((r): ProgressAttempt => ({
        questionId: r.question_id,
        questionText: r.text,
        topic: r.topic,
        chosen: r.chosen as AnswerLetter | null,
        correctLetter: r.correct_letter as AnswerLetter,
        outcome: r.outcome,
        timeMs: r.time_ms,
        answeredAt: r.answered_at,
      }))

    return { player, totals: statsOf(rows), byTopic, trend, mistakes, recent }
  }

  /** Every player who has played, with answer figures from the log. Most recent first. */
  adminPlayers(): AdminPlayerRow[] {
    const log = this.sql
      .prepare('SELECT player_id, outcome, time_ms FROM answer_log')
      .all<{ player_id: string; outcome: AnswerOutcome; time_ms: number }>().results
    const byPlayer = groupBy(log, (r) => r.player_id)
    const { results } = this.sql
      .prepare(
        `SELECT * FROM players
         WHERE games_played > 0 OR id IN (SELECT DISTINCT player_id FROM answer_log)
         ORDER BY last_seen DESC`,
      )
      .all<Record<string, unknown>>()
    return results.map((row) => {
      const p = toProfile(row)
      return {
        id: p.id,
        name: p.name,
        gamesPlayed: p.gamesPlayed,
        totalScore: p.totalScore,
        lastSeen: row.last_seen as string,
        ...statsOf(byPlayer.get(p.id) ?? []),
      }
    })
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
