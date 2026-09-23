import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from './index.js'
const dirs: string[] = []
const services: ReturnType<typeof createApp>[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
async function start(file: string) {
  const service = createApp({ databasePath: file, adminPassword: 'test-password', sessionSecret: 'test-secret'.repeat(4) })
  services.push(service)
  await new Promise<void>(resolve => service.server.listen(0, '127.0.0.1', resolve))
  const port = (service.server.address() as { port: number }).port
  return { ...service, base: `http://127.0.0.1:${port}`, port }
}
async function connect(port: number, code: string, playerId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${code}&playerId=${playerId}`)
  await new Promise<void>((resolve, reject) => { ws.on('message', raw => { if (JSON.parse(raw.toString()).event === 'room') resolve() }); ws.on('error', reject) })
  return ws
}
function call(ws: WebSocket, event: string, payload?: unknown): Promise<any> {
  return new Promise(resolve => {
    const handler = (raw: WebSocket.RawData) => { const msg = JSON.parse(raw.toString()); if (msg.t === 'ack') { ws.off('message', handler); resolve(msg) } }
    ws.on('message', handler); ws.send(JSON.stringify({ t: 'call', id: 1, event, payload }))
  })
}
describe('VM backend', () => {
  it('restores an answering game, host and deck after a restart; persists players and scores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ludo-')); dirs.push(dir)
    const file = join(dir, 'db.sqlite')
    const first = await start(file)
    for (let tier = 1; tier <= 6; tier++) first.db.createQuestion({ difficulty: 'medium', text: `Question ${tier}`, options: ['A', 'B', 'C', 'D'], answer: 'A', explanation: 'Correct' })
    const player = first.db.createPlayer('Host')
    const code = first.rooms.create(player, 'ffa', 'quick', 'medium')
    const ws = await connect(first.port, code, player.id)
    expect((await call(ws, 'addAi', { skill: 'consultant' })).ok).toBe(true)
    expect((await call(ws, 'startGame')).ok).toBe(true)
    expect((await call(ws, 'roll')).ok).toBe(true)
    const before = first.rooms.rooms.get(code)!.engine.snapshot()
    await first.close(); services.pop()
    const second = await start(file)
    const recovered = second.rooms.rooms.get(code)!.engine.snapshot()
    expect(recovered.game?.phase).toBe('answering')
    expect(recovered.pendingQuestion).toEqual(before.pendingQuestion)
    expect(recovered.deck).toEqual(before.deck)
    expect(second.db.getPlayer(player.id)?.name).toBe('Host')
    const ws2 = await connect(second.port, code, player.id)
    expect((await call(ws2, 'answer', { letter: 'A' })).ok).toBe(true)
    ws2.close()
  })
  it('rejects unknown rooms without allocating state and authenticates admin cookies', async () => {
    const service = await start(':memory:')
    const ws = new WebSocket(`ws://127.0.0.1:${service.port}/ws?code=999999&playerId=123456`)
    const close = await new Promise<number>(resolve => ws.on('close', resolve))
    expect(close).toBe(4004)
    expect(service.rooms.rooms.size).toBe(0)
    expect((await fetch(service.base + '/api/admin/questions')).status).toBe(401)
    const login = await fetch(service.base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await fetch(service.base + '/api/admin/questions', { headers: { cookie } })).status).toBe(200)
  })
})

async function adminCookie(base: string) {
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
  return login.headers.get('set-cookie')!.split(';')[0]
}
const record = (playerId: string, questionId: number, topic: string, outcome: 'correct' | 'wrong' | 'timeout', chosen: 'A' | 'B' | 'C' | 'D' | null, timeMs: number, answeredAt: string) =>
  ({ playerId, questionId, topic, difficulty: 'easy' as const, roomCode: '123456', chosen, correctLetter: 'A' as const, outcome, timeMs, answeredAt })

describe('v2 learning data', () => {
  it('migrates a database created before topics in place, keeping questions and statistics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ludo-')); dirs.push(dir)
    const file = join(dir, 'old.sqlite')
    // The questions table exactly as the previous schema.sql created it.
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
      source_card INTEGER UNIQUE, text TEXT NOT NULL, option_a TEXT NOT NULL, option_b TEXT NOT NULL,
      option_c TEXT NOT NULL, option_d TEXT NOT NULL, answer TEXT NOT NULL CHECK (answer IN ('A','B','C','D')),
      explanation TEXT, active INTEGER NOT NULL DEFAULT 1, times_asked INTEGER NOT NULL DEFAULT 0,
      times_correct INTEGER NOT NULL DEFAULT 0, times_timeout INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO questions (difficulty, source_card, text, option_a, option_b, option_c, option_d, answer, explanation, active, times_asked, times_correct, times_timeout, created_at, updated_at)
      VALUES ('easy', 12, 'Old card', 'a', 'b', 'c', 'd', 'C', 'Why', 1, 40, 31, 3, '2026-01-01', '2026-01-01');`)
    old.close()
    for (let run = 0; run < 2; run++) {
      const service = await start(file)
      const [q] = service.db.listQuestions()
      expect(q).toMatchObject({ sourceCard: 12, text: 'Old card', answer: 'C', topic: run === 0 ? '' : 'Jaundice', timesAsked: 40, timesCorrect: 31, timesTimeout: 3 })
      const columns = service.db.sql.raw.prepare('PRAGMA table_info(questions)').all() as Array<{ name: string }>
      expect(columns.filter(c => c.name === 'topic')).toHaveLength(1)
      service.db.updateQuestion(q.id, { topic: 'Jaundice' })
      expect(service.db.sql.prepare('SELECT COUNT(*) AS n FROM answer_log').first<{ n: number }>()!.n).toBe(0)
      await service.close(); services.pop()
    }
  })

  it('lists topics for the lobby and builds rooms from chosen topics', async () => {
    const service = await start(':memory:')
    service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'J1', options: ['A', 'B', 'C', 'D'], answer: 'A' })
    service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'J2', options: ['A', 'B', 'C', 'D'], answer: 'A' })
    service.db.createQuestion({ difficulty: 'easy', text: 'G1', options: ['A', 'B', 'C', 'D'], answer: 'A' })
    service.db.createQuestion({ difficulty: 'easy', topic: 'Retired', text: 'R1', options: ['A', 'B', 'C', 'D'], answer: 'A', active: false })
    const topics = await (await fetch(service.base + '/api/topics?difficulty=easy')).json()
    expect(topics).toEqual([{ topic: 'Jaundice', count: 2 }, { topic: '', count: 1 }])
    const player = service.db.createPlayer('Host')
    const bad = await fetch(service.base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: player.id, topics: 'Jaundice' }) })
    expect(bad.status).toBe(400)
    const res = await fetch(service.base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerId: player.id, preset: 'quick', topics: [' Jaundice '] }) })
    const { code } = await res.json()
    expect(service.rooms.rooms.get(code)!.engine.view().topics).toEqual(['Jaundice'])
  })

  it('logs a human answer over a real socket against the room UUID', async () => {
    const service = await start(':memory:')
    service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'J1', options: ['A', 'B', 'C', 'D'], answer: 'A' })
    const player = service.db.createPlayer('Host')
    const code = service.rooms.create(player, 'ffa', 'quick', 'easy', ['Jaundice'])
    const ws = await connect(service.port, code, player.id)
    expect((await call(ws, 'addAi', { skill: 'intern' })).ok).toBe(true)
    expect((await call(ws, 'startGame')).ok).toBe(true)
    expect((await call(ws, 'roll')).ok).toBe(true)
    expect((await call(ws, 'answer', { letter: 'B' })).ok).toBe(true)
    const deadline = Date.now() + 5000
    let rows: any[] = []
    while (Date.now() < deadline && rows.length === 0) {
      await new Promise(r => setTimeout(r, 50))
      rows = service.db.exportAnswers()
    }
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      player_id: player.id, player_name: 'Host', room_code: code, game_id: service.rooms.rooms.get(code)!.id,
      topic: 'Jaundice', difficulty: 'easy', question_text: 'J1', chosen: 'B', correct_letter: 'A', outcome: 'wrong',
    })
    expect(rows[0].time_ms).toBeGreaterThanOrEqual(0)
    expect(rows[0].time_ms).toBeLessThanOrEqual(60_000)
    ws.close()
  })

  it('reports a player\'s progress by topic, trend and mistakes', async () => {
    const service = await start(':memory:')
    const q1 = service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'Q1', options: ['a', 'b', 'c', 'd'], answer: 'A', explanation: 'E1' })
    const q2 = service.db.createQuestion({ difficulty: 'easy', topic: 'Cardiac Biomarkers', text: 'Q2', options: ['a', 'b', 'c', 'd'], answer: 'A' })
    const q3 = service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'Q3', options: ['a', 'b', 'c', 'd'], answer: 'A' })
    const me = service.db.createPlayer('Me')
    service.db.recordAnswer(record(me.id, q1.id, 'Jaundice', 'wrong', 'B', 4000, '2026-09-01T10:00:00.000Z'), 'game-1')
    service.db.recordAnswer(record(me.id, q2.id, 'Cardiac Biomarkers', 'timeout', null, 60000, '2026-09-01T10:01:00.000Z'), 'game-1')
    service.db.recordAnswer(record(me.id, q3.id, 'Jaundice', 'correct', 'A', 2000, '2026-09-01T10:02:00.000Z'), 'game-1')
    service.db.recordAnswer(record(me.id, q1.id, 'Jaundice', 'correct', 'A', 3000, '2026-09-02T10:00:00.000Z'), 'game-2')
    service.db.recordAnswer(record('999999', q1.id, 'Jaundice', 'wrong', 'D', 1000, '2026-09-02T10:00:00.000Z'), 'game-2')

    expect((await fetch(service.base + '/api/players/000000/progress')).status).toBe(404)
    const progress = await (await fetch(service.base + `/api/players/${me.id}/progress`)).json()
    expect(progress.player.id).toBe(me.id)
    expect(progress.totals).toEqual({ answered: 4, correct: 2, wrong: 1, timeouts: 1, accuracy: 0.5, medianTimeMs: 3000, meanTimeMs: 3000 })
    expect(progress.byTopic.map((t: any) => [t.topic, t.answered, t.correct])).toEqual([['Cardiac Biomarkers', 1, 0], ['Jaundice', 3, 2]])
    expect(progress.trend).toEqual([
      { gameId: 'game-1', playedAt: '2026-09-01T10:00:00.000Z', topic: 'Jaundice', answered: 2, correct: 1 },
      { gameId: 'game-1', playedAt: '2026-09-01T10:00:00.000Z', topic: 'Cardiac Biomarkers', answered: 1, correct: 0 },
      { gameId: 'game-2', playedAt: '2026-09-02T10:00:00.000Z', topic: 'Jaundice', answered: 1, correct: 1 },
    ])
    expect(progress.mistakes).toEqual([
      expect.objectContaining({ questionId: q2.id, lastWrongChoice: null, timesSeen: 1, nowCorrect: false, topic: 'Cardiac Biomarkers' }),
      expect.objectContaining({ questionId: q1.id, questionText: 'Q1', lastWrongChoice: 'B', correctLetter: 'A', explanation: 'E1', timesSeen: 2, nowCorrect: true, options: ['a', 'b', 'c', 'd'] }),
    ])
    expect(progress.recent.map((r: any) => r.questionId)).toEqual([q1.id, q3.id, q2.id, q1.id])

    const cookie = await adminCookie(service.base)
    const players = await (await fetch(service.base + '/api/admin/players', { headers: { cookie } })).json()
    expect(players.players.find((p: any) => p.id === me.id)).toMatchObject({ name: 'Me', answered: 4, timeouts: 1, accuracy: 0.5, meanTimeMs: 3000 })
    const list = await (await fetch(service.base + '/api/admin/questions?topic=Jaundice', { headers: { cookie } })).json()
    expect(list.questions.map((q: any) => q.id)).toEqual([q1.id, q3.id])
    expect(list.questions[0]).toMatchObject({ loggedAnswers: 3, loggedTimeouts: 0, avgTimeMs: 2667 })
    expect(list.topics.map((t: any) => t.topic)).toEqual(['Cardiac Biomarkers', 'Jaundice'])
  })

  it('exports the answer log as CSV only to a signed-in admin, with filters', async () => {
    const service = await start(':memory:')
    const q = service.db.createQuestion({ difficulty: 'easy', topic: 'Jaundice', text: 'Is it "yellow", then?', options: ['a', 'b', 'c', 'd'], answer: 'A' })
    const me = service.db.createPlayer('Me')
    service.db.recordAnswer(record(me.id, q.id, 'Jaundice', 'correct', 'A', 1234, '2026-09-01T10:00:00.000Z'), 'game-1')
    service.db.recordAnswer(record(me.id, q.id, 'Other', 'timeout', null, 60000, '2026-09-03T10:00:00.000Z'), 'game-2')

    expect((await fetch(service.base + '/api/admin/answers/export?format=csv')).status).toBe(401)
    const cookie = await adminCookie(service.base)
    const res = await fetch(service.base + '/api/admin/answers/export?format=csv', { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    const lines = (await res.text()).trim().split('\n')
    expect(lines[0]).toBe('id,answered_at,game_id,room_code,player_id,player_name,question_id,topic,difficulty,question_text,chosen,correct_letter,outcome,time_ms')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain(`${me.id},Me,${q.id},Jaundice,easy,"Is it ""yellow"", then?",A,A,correct,1234`)
    expect(lines[2]).toMatch(/,,A,timeout,60000$/)

    const filtered = await (await fetch(service.base + '/api/admin/answers/export?format=csv&topic=Jaundice&from=2026-09-01&to=2026-09-01', { headers: { cookie } })).text()
    expect(filtered.trim().split('\n')).toHaveLength(2)
    const later = await (await fetch(service.base + '/api/admin/answers/export?format=csv&from=2026-09-02', { headers: { cookie } })).text()
    expect(later).toContain('timeout')
    expect(later).not.toContain('correct,1234')
    expect((await fetch(service.base + '/api/admin/answers/export?from=yesterday', { headers: { cookie } })).status).toBe(400)
  })

  it('carries topic through question create, edit, import and export', async () => {
    const service = await start(':memory:')
    const cookie = await adminCookie(service.base)
    const post = (path: string, body: unknown, method = 'POST') => fetch(service.base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const created = await (await post('/api/admin/questions', { difficulty: 'easy', topic: '  Jaundice ', text: 'T', options: ['a', 'b', 'c', 'd'], answer: 'A' })).json()
    expect(created.question.topic).toBe('Jaundice')
    expect((await post('/api/admin/questions', { difficulty: 'easy', topic: 'x'.repeat(41), text: 'T', options: ['a', 'b', 'c', 'd'], answer: 'A' })).status).toBe(400)
    const general = await (await post('/api/admin/questions', { difficulty: 'easy', topic: 'General', text: 'G', options: ['a', 'b', 'c', 'd'], answer: 'A' })).json()
    expect(general.question.topic).toBe('')
    const edited = await (await post(`/api/admin/questions/${created.question.id}`, { topic: 'Cardiac Biomarkers' }, 'PATCH')).json()
    expect(edited.question.topic).toBe('Cardiac Biomarkers')
    // An import without a topic column leaves topics alone; with one, it sets them.
    await post('/api/admin/questions/import', { dryRun: false, csv: `id,difficulty,text,option_a,option_b,option_c,option_d,answer\n${created.question.id},easy,T2,a,b,c,d,A\n` })
    expect(service.db.getQuestion(created.question.id)!.topic).toBe('Cardiac Biomarkers')
    await post('/api/admin/questions/import', { dryRun: false, csv: `id,difficulty,topic,text,option_a,option_b,option_c,option_d,answer\n${created.question.id},easy,Jaundice,T3,a,b,c,d,A\n` })
    expect(service.db.getQuestion(created.question.id)!.topic).toBe('Jaundice')
    const csv = await (await fetch(service.base + '/api/admin/questions/export?format=csv', { headers: { cookie } })).text()
    expect(csv.split('\n')[0]).toBe('id,difficulty,topic,source_card,text,option_a,option_b,option_c,option_d,answer,explanation,active')
    expect(csv).toContain(',easy,Jaundice,,T3,')
  })
})
