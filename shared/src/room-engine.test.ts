import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TIMINGS, RoomEngine, type RoomHooks } from './room-engine.js'
import type { ServerMessage } from './protocol.js'
import {
  ANSWER_SECONDS,
  QUESTION_SHOW_DELAY_MS,
  type AnswerRecord,
  type Difficulty,
  type GameOverPayload,
  type Question,
} from './types.js'

const HOST = { id: '100001', name: 'Ana' }
const GUEST = { id: '100002', name: 'Ben' }

function question(id: number, topic: string, difficulty: Difficulty = 'easy'): Question {
  return {
    id,
    difficulty,
    topic,
    sourceCard: null,
    text: `Question ${id}`,
    options: ['one', 'two', 'three', 'four'],
    answer: 'A',
    explanation: `Because ${id}`,
    active: true,
    timesAsked: 0,
    timesCorrect: 0,
    timesTimeout: 0,
  }
}

function harness(opts: { topics?: string[]; difficulty?: Difficulty } = {}) {
  const answers: AnswerRecord[] = []
  const stats: string[] = []
  const messages: ServerMessage[] = []
  const hooks: RoomHooks = {
    broadcast: (m) => messages.push(m),
    onStat: (_id, outcome) => stats.push(outcome),
    onAnswer: (r) => answers.push(r),
    onFinished: () => {},
  }
  const engine = new RoomEngine('123456', HOST, 'ffa', 'quick', opts.difficulty ?? 'easy',
    opts.topics ?? [], hooks, DEFAULT_TIMINGS)
  return { engine, answers, stats, messages, hooks }
}

/** Host plus a human guest, started, host to roll. */
function twoHumans(questions: Question[], opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts)
  h.engine.join(GUEST)
  h.engine.setReady(GUEST.id, true)
  expect(h.engine.start(HOST.id, questions)).toEqual({ ok: true })
  return h
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-01T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('topics', () => {
  it('builds the deck only from the room topics', () => {
    const bank = [question(1, 'Jaundice'), question(2, 'Cardiac Biomarkers'), question(3, '')]
    const { engine } = twoHumans(bank, { topics: ['Jaundice', ''] })
    const ids = engine.snapshot().deck!.source.map((q) => q.id).sort()
    expect(ids).toEqual([1, 3])
  })

  it('uses every topic when none are chosen', () => {
    const bank = [question(1, 'Jaundice'), question(2, 'Cardiac Biomarkers')]
    const { engine } = twoHumans(bank)
    expect(engine.snapshot().deck!.source).toHaveLength(2)
  })

  it('refuses to start with no matching questions, naming the topics', () => {
    const h = harness({ topics: ['Renal'] })
    h.engine.join(GUEST)
    h.engine.setReady(GUEST.id, true)
    const ack = h.engine.start(HOST.id, [question(1, 'Jaundice')])
    expect(ack.ok).toBe(false)
    expect(ack.error).toMatch(/Renal/)
    expect(h.engine.game).toBeNull()
  })

  it('lets the host change topics in the lobby and shows them in the room view', () => {
    const { engine } = harness()
    expect(engine.setMode(GUEST.id, 'ffa', 'quick', 'easy', ['Jaundice']).ok).toBe(false)
    expect(engine.setMode(HOST.id, 'ffa', 'quick', 'easy', ['Jaundice']).ok).toBe(true)
    expect(engine.view().topics).toEqual(['Jaundice'])
    // Omitting topics keeps them.
    engine.setMode(HOST.id, 'teams', 'quick', 'easy')
    expect(engine.view().topics).toEqual(['Jaundice'])
  })

  it('restores a snapshot saved before topics existed as "all topics"', () => {
    const { engine, hooks } = harness({ topics: ['Jaundice'] })
    const old = engine.snapshot()
    delete old.topics
    delete old.review
    delete old.pendingAskedAt
    expect(RoomEngine.restore(old, hooks).view().topics).toEqual([])
  })

  it('carries the topic on the question in play and on the result', () => {
    const { engine } = twoHumans([question(1, 'Jaundice')])
    engine.roll(HOST.id)
    expect(engine.game!.question!.topic).toBe('Jaundice')
    engine.answer(HOST.id, 'A')
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(engine.game!.lastResult!.topic).toBe('Jaundice')
  })
})

describe('answer log', () => {
  it('records a correct answer with the time since the question appeared', () => {
    const { engine, answers } = twoHumans([question(7, 'Jaundice')])
    engine.roll(HOST.id)
    vi.advanceTimersByTime(QUESTION_SHOW_DELAY_MS + 4200)
    engine.answer(HOST.id, 'A')
    // The lock-in pause is not the player's time.
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatchObject({
      playerId: HOST.id, questionId: 7, topic: 'Jaundice', difficulty: 'easy',
      roomCode: '123456', chosen: 'A', correctLetter: 'A', outcome: 'correct', timeMs: 4200,
    })
    expect(new Date(answers[0].answeredAt).toISOString()).toBe(answers[0].answeredAt)
    expect(engine.game!.lastResult!.timeMs).toBe(4200)
  })

  it('records a wrong answer with the chosen letter', () => {
    const { engine, answers } = twoHumans([question(7, '')])
    engine.roll(HOST.id)
    vi.advanceTimersByTime(QUESTION_SHOW_DELAY_MS + 900)
    engine.answer(HOST.id, 'C')
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(answers[0]).toMatchObject({ outcome: 'wrong', chosen: 'C', correctLetter: 'A', timeMs: 900 })
  })

  it('records a timeout with no choice and the full allowance for the difficulty', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      const { engine, answers } = twoHumans([question(7, '', difficulty)], { difficulty })
      engine.roll(HOST.id)
      const allowed = ANSWER_SECONDS[difficulty] * 1000
      expect(engine.game!.question!.deadline - Date.now()).toBe(allowed)
      vi.advanceTimersByTime(allowed + DEFAULT_TIMINGS.answerGraceMs)
      expect(answers).toEqual([expect.objectContaining({ outcome: 'timeout', chosen: null, timeMs: allowed })])
      engine.dispose()
    }
    expect(ANSWER_SECONDS.hard).toBe(90)
  })

  it('never records computer players, while still counting their question stats', () => {
    const h = harness()
    h.engine.addAi(HOST.id, 'consultant')
    h.engine.start(HOST.id, [question(1, 'Jaundice'), question(2, 'Jaundice')])
    h.engine.roll(HOST.id)
    h.engine.answer(HOST.id, 'A')
    // Long enough for several computer turns, and for the host to time out too.
    vi.advanceTimersByTime(10 * 60_000)
    expect(h.answers.length).toBeGreaterThan(0)
    expect(h.answers.every((r) => r.playerId === HOST.id)).toBe(true)
    expect(h.stats.length).toBeGreaterThan(h.answers.length)
    expect(h.engine.snapshot().review!.every((r) => r.playerId === HOST.id)).toBe(true)
    h.engine.dispose()
  })

  it('restarts the measured time when a restored game restarts the clock', () => {
    const { engine, answers, hooks } = twoHumans([question(7, '')])
    engine.roll(HOST.id)
    const saved = engine.snapshot()
    engine.dispose()
    vi.advanceTimersByTime(30 * 60_000) // server down for half an hour
    const restored = RoomEngine.restore(saved, hooks)
    restored.join(HOST)
    restored.resume()
    vi.advanceTimersByTime(QUESTION_SHOW_DELAY_MS + 2500)
    restored.answer(HOST.id, 'A')
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(answers.at(-1)).toMatchObject({ outcome: 'correct', timeMs: 2500 })
    restored.dispose()
  })

  it('never puts the answer or explanation in the broadcast state before the reveal', () => {
    const { engine, messages } = twoHumans([question(7, '')])
    engine.roll(HOST.id)
    engine.answer(HOST.id, 'B')
    const beforeReveal = messages.filter((m) => m.t === 'event' && m.event === 'game')
    for (const m of beforeReveal) {
      const text = JSON.stringify(m)
      expect(text).not.toContain('Because 7')
      expect(text).not.toContain('correctLetter')
    }
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(engine.game!.lastResult!.correctLetter).toBe('A')
  })

  it('offers each human answer for review once the game is over', () => {
    const { engine } = twoHumans([question(7, 'Jaundice')])
    engine.roll(HOST.id)
    vi.advanceTimersByTime(QUESTION_SHOW_DELAY_MS + 1000)
    engine.answer(HOST.id, 'B')
    vi.advanceTimersByTime(DEFAULT_TIMINGS.answerLockMs)
    expect(engine.gameOverPayload()).toBeNull()
    engine.game!.phase = 'game-over'
    engine.game!.winner = { type: 'player', seat: 1 }
    const payload = engine.gameOverPayload() as GameOverPayload
    expect(payload.review).toEqual([expect.objectContaining({
      playerId: HOST.id, questionId: 7, chosen: 'B', correctLetter: 'A', outcome: 'wrong',
      explanation: 'Because 7', timeMs: 1000, topic: 'Jaundice',
    })])
    engine.dispose()
  })
})
