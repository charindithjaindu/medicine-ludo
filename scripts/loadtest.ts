/** Real HTTP + WebSocket load; use a disposable database because this creates players. */
import WebSocket from 'ws'
import { performance } from 'node:perf_hooks'
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787'
const count = Number(process.env.PLAYERS ?? 200)
const perRoom = Number(process.env.PER_ROOM ?? 4)
const duration = Number(process.env.DURATION_SECONDS ?? 30)
const sockets: WebSocket[] = []
const pending = new Map<string, { start: number; resolve: (ack: any) => void }>()
const latencies: number[] = []
let running = true
let nextId = 0, events = 0, errors = 0, calls = 0
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}
function call(index: number, event: string, payload?: unknown): Promise<any> {
  const id = ++nextId, key = `${index}:${id}`
  calls++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('ACK timeout')) }, 10_000)
    pending.set(key, { start: performance.now(), resolve: ack => { clearTimeout(timer); resolve(ack) } })
    sockets[index].send(JSON.stringify({ t: 'call', id, event, payload }))
  })
}
async function connect(index: number, code: string, playerId: string) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?code=${code}&playerId=${playerId}`)
  sockets[index] = ws
  return new Promise<void>((resolve, reject) => {
    let admitted = false
    const timer = setTimeout(() => reject(new Error(`Join timeout: client ${index}, state ${ws.readyState}, events ${events}`)), 10000)
    ws.on('error', reject)
    ws.on('close', () => { if (!admitted) reject(new Error('Join refused')) })
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString())
      if (message.t === 'ack') {
        const key = `${index}:${message.id}`, item = pending.get(key)
        if (item) { latencies.push(performance.now() - item.start); pending.delete(key); item.resolve(message) }
      } else {
        events++
        if (message.event === 'room' && !admitted) { admitted = true; clearTimeout(timer); resolve() }
        if (message.event === 'game' && running) {
          const g = message.payload
          if (g.players[g.turnSeat]?.playerId !== playerId) return
          let action: Promise<any> | undefined
          if (g.phase === 'awaiting-roll') action = call(index, 'roll')
          else if (g.phase === 'answering' && g.chosenAnswer === null) action = call(index, 'answer', { letter: 'A' })
          else if (g.phase === 'choosing-piece') action = call(index, 'choosePiece', { pieceId: g.choices[0] })
          action?.then(ack => { if (!ack.ok) errors++ }).catch(() => errors++)
        }
      }
    })
  })
}
try {
  const start = performance.now()
  const players = await Promise.all(Array.from({ length: count }, (_, i) => post('/api/players', { name: `Load ${i}` })))
  const hosts: number[] = []
  const groups = Math.ceil(count / perRoom)
  // Model a classroom arrival burst while bounding the load generator TCP backlog.
  for (let offset = 0; offset < groups; offset += 10) await Promise.all(Array.from({ length: Math.min(10, groups - offset) }, async (_, slot) => {
    const group = offset + slot
    const first = group * perRoom
    const { code } = await post('/api/rooms', { playerId: players[first].player.id, preset: 'quick' })
    for (let i = first; i < Math.min(first + perRoom, count); i++) {
      await connect(i, code, players[i].player.id)
      if (i !== first) { const ack = await call(i, 'setReady', { ready: true }); if (!ack.ok) throw new Error(ack.error) }
    }
    if (perRoom === 1) for (let i = 0; i < 3; i++) {
      const ack = await call(first, 'addAi', { skill: 'consultant' }); if (!ack.ok) throw new Error(ack.error)
    }
    hosts.push(first)
  }))
  await Promise.all(hosts.map(async first => {
    const ack = await call(first, 'startGame'); if (!ack.ok) throw new Error(ack.error)
  }))
  const connectMs = Math.round(performance.now() - start)
  await wait(duration * 1000)
  running = false
  await wait(500)
  const healthStart = performance.now()
  const health = await fetch(BASE + '/api/health')
  const healthMs = Math.round(performance.now() - healthStart)
  latencies.sort((a, b) => a - b)
  const report = { players: count, rooms: Math.ceil(count / perRoom), connected: sockets.filter(s => s.readyState === WebSocket.OPEN).length,
    duration, connectMs, calls, events, errors, pending: pending.size, ackP95Ms: Math.round(latencies[Math.floor(latencies.length * .95)] ?? 0),
    ackMaxMs: Math.round(latencies.at(-1) ?? 0), healthStatus: health.status, healthMs }
  console.log(JSON.stringify(report, null, 2))
  if (errors || report.connected !== count || !health.ok || pending.size) process.exitCode = 1
} catch (error) { console.error(error); process.exitCode = 1 }
finally { running = false; for (const ws of sockets) ws?.terminate() }
