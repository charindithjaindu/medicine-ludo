import express from 'express'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Db } from './db.js'
import { Sqlite } from './sqlite.js'
import { Rooms } from './rooms.js'
import { handleAdmin } from './admin.js'
import { DEFAULT_TIMINGS } from '@shared/room-engine.js'
import { SINGLE_LEVEL, isDifficulty } from '@shared/types.js'
import { parseTopicList } from '@shared/validate.js'

function timing(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!raw.trim() || !Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`)
  return value
}

export function createApp(options: { databasePath?: string; adminPassword?: string; sessionSecret?: string } = {}) {
  const env = { ADMIN_PASSWORD: options.adminPassword ?? process.env.ADMIN_PASSWORD, SESSION_SECRET: options.sessionSecret ?? process.env.SESSION_SECRET }
  if (process.env.NODE_ENV === 'production' && (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new Error('Production requires ADMIN_PASSWORD and SESSION_SECRET (at least 32 characters)')
  }
  const db = new Db(new Sqlite(options.databasePath))
  const rooms = new Rooms(db, { ...DEFAULT_TIMINGS,
    revealMs: timing('REVEAL_MS', DEFAULT_TIMINGS.revealMs),
    answerLockMs: timing('ANSWER_LOCK_MS', DEFAULT_TIMINGS.answerLockMs),
    aiDelayScale: timing('AI_DELAY_SCALE', DEFAULT_TIMINGS.aiDelayScale),
  })
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable()
  app.get('/api/health', (_req, res) => res.json({ ok: true, questions: db.activeCountByDifficulty() }))
  // What a lobby can pick: topics with at least one active question at the room's
  // difficulty. A locked level wins over the query, exactly as it does for rooms.
  app.get('/api/topics', (req, res) => {
    const asked = req.query.difficulty
    const difficulty = SINGLE_LEVEL ?? (isDifficulty(asked) ? asked : undefined)
    res.json(db.listTopics({ difficulty }))
  })
  app.post('/api/players', (req, res) => {
    if (typeof req.body?.name !== 'string') return res.status(400).json({ error: 'Name is required' })
    res.status(201).json({ player: db.createPlayer(req.body.name) })
  })
  app.get('/api/players/:id', (req, res) => {
    const player = db.getPlayer(req.params.id)
    if (!player) return res.status(404).json({ error: 'No player with that ID' })
    db.touchPlayer(player.id)
    res.json({ player })
  })
  // The player ID is the only credential, exactly as for the profile above.
  app.get('/api/players/:id/progress', (req, res) => {
    const progress = db.playerProgress(req.params.id)
    if (!progress) return res.status(404).json({ error: 'No player with that ID' })
    res.json(progress)
  })
  app.patch('/api/players/:id', (req, res) => {
    if (typeof req.body?.name !== 'string') return res.status(400).json({ error: 'Name is required' })
    const player = db.renamePlayer(req.params.id, req.body.name)
    res.status(player ? 200 : 404).json(player ? { player } : { error: 'No player with that ID' })
  })
  app.get('/api/leaderboard', (_req, res) => res.json({ rows: db.leaderboard() }))
  app.post('/api/rooms', (req, res) => {
    const { playerId, mode = 'ffa', preset = 'standard', difficulty = 'medium' } = req.body ?? {}
    const topics = parseTopicList(req.body?.topics)
    if (typeof playerId !== 'string') return res.status(400).json({ error: 'Player ID is required' })
    const player = db.getPlayer(playerId)
    if (!player) return res.status(400).json({ error: 'Unknown player ID' })
    if (!['ffa', 'teams'].includes(mode) || !['quick', 'standard'].includes(preset) || !isDifficulty(difficulty) || !topics) return res.status(400).json({ error: 'Invalid room settings' })
    if (rooms.rooms.size >= 500) return res.status(503).json({ error: 'Room capacity reached. Please try again shortly.' })
    res.json({ code: rooms.create(player, mode, preset, SINGLE_LEVEL ?? difficulty, topics) })
  })
  // Bound admin login attempts without restricting a classroom sharing one IP.
  const logins = new Map<string, { count: number; until: number }>()
  app.use('/api/admin', async (req, res) => {
    if (req.path === '/login' && req.method === 'POST') {
      const now = Date.now()
      for (const [ip, entry] of logins) if (entry.until < now) logins.delete(ip)
      const ip = req.ip ?? 'unknown'
      const entry = logins.get(ip) ?? { count: 0, until: now + 60_000 }
      logins.set(ip, entry)
      if (++entry.count > 20) return res.status(429).json({ error: 'Try again in a minute' })
    }
    const request = new Request(`${req.protocol}://${req.get('host')}${req.originalUrl}`, {
      method: req.method, headers: { cookie: req.get('cookie') ?? '', 'content-type': 'application/json' },
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: JSON.stringify(req.body ?? {}) }),
    })
    const response = await handleAdmin(request, req.path, db, env)
    res.status(response.status)
    response.headers.forEach((value, key) => res.setHeader(key, value))
    res.send(await response.text())
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use(express.static(resolve('client/dist'), { index: false }))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('client/dist/index.html')))
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('HTTP request failed', err.message)
    res.status(err.status ?? 500).json({ error: err.status && err.status < 500 ? err.message : 'Server error' })
  })
  const server = createServer(app)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws' || wss.clients.size >= 2000) { socket.destroy(); return }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return } }
      catch { socket.destroy(); return }
    }
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req)
      ws.on('error', () => ws.terminate())
      try { rooms.connect(ws, url.searchParams.get('code') ?? '', url.searchParams.get('playerId') ?? '') }
      catch (error) { console.error('WebSocket connection failed', error); ws.close(1011, 'Server error') }
    })
  })
  const alive = new WeakMap<WebSocket, boolean>()
  wss.on('connection', ws => { alive.set(ws, true); ws.on('pong', () => alive.set(ws, true)) })
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue }
      if (!alive.has(ws)) ws.on('pong', () => alive.set(ws, true))
      alive.set(ws, false); ws.ping()
    }
  }, 30_000)
  heartbeat.unref()
  const metrics = setInterval(() => {
    console.log(JSON.stringify({ event: 'health', rooms: rooms.rooms.size, sockets: wss.clients.size,
      rssMB: Math.round(process.memoryUsage().rss / 1048576), loopP99Ms: Math.round(loop.percentile(99) / 1e6) }))
    loop.reset()
  }, 60_000)
  metrics.unref()
  async function close() {
    clearInterval(heartbeat); clearInterval(metrics); loop.disable()
    rooms.close()
    const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate() }, 2000)
    await new Promise<void>(resolve => server.close(() => resolve()))
    clearTimeout(force)
    wss.close()
    db.sql.close()
  }
  return { app, server, db, rooms, close }
}

if (process.env.NODE_ENV !== 'test') {
  const service = createApp()
  const port = Number(process.env.PORT ?? 8787)
  service.server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Medicine Ludo listening on ${port}`))
  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (stopping) return
    stopping = true
    void service.close().then(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
