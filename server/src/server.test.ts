import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
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
