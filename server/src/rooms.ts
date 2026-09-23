import { randomInt, randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { RoomEngine, DEFAULT_TIMINGS, type RoomSnapshot, type RoomTimings } from '@shared/room-engine.js'
import { AI_SKILLS, isAiId } from '@shared/ai.js'
import { isCall, type ServerMessage } from '@shared/protocol.js'
import { SINGLE_LEVEL, isDifficulty, type AnswerLetter, type AnswerOutcome, type AnswerRecord, type BoardPreset, type GameMode, type PlayerProfile, type Difficulty } from '@shared/types.js'
import { parseTopicList } from '@shared/validate.js'
import type { Db } from './db.js'

interface Room {
  id: string
  engine: RoomEngine
  sockets: Map<WebSocket, string>
  idleSince: number | null
  paused: boolean
}
export class Rooms {
  readonly rooms = new Map<string, Room>()
  private sweep: ReturnType<typeof setInterval>
  private shuttingDown = false
  constructor(readonly db: Db, private timings: RoomTimings = DEFAULT_TIMINGS, private graceMs = 90_000) {
    db.sql.prepare('DELETE FROM rooms WHERE expires_at < ?').bind(Date.now()).run()
    const rows = db.sql.prepare('SELECT snapshot FROM rooms').all<{ snapshot: string }>().results
    for (const row of rows) {
      const state = JSON.parse(row.snapshot) as { id: string; engine: RoomSnapshot }
      const room = this.makeRoom(state.engine.code, state.id)
      room.engine = RoomEngine.restore(state.engine, this.hooks(room), timings)
      room.paused = true
      this.rooms.set(room.engine.code, room)
    }
    this.sweep = setInterval(() => this.prune(), 10_000)
    this.sweep.unref()
  }
  private makeRoom(code: string, id: string = randomUUID()): Room {
    return { id, engine: null as unknown as RoomEngine, sockets: new Map(), idleSince: Date.now(), paused: false }
  }
  private hooks(room: Room) {
    return {
      broadcast: (message: ServerMessage) => {
        if (this.shuttingDown) return
        this.save(room)
        const text = JSON.stringify(message)
        for (const ws of room.sockets.keys()) this.send(ws, text)
      },
      onStat: (id: number, outcome: AnswerOutcome) => this.db.recordAnswerStat(id, outcome),
      // The engine already skips computer players; the ID check is a second lock on
      // the research data.
      onAnswer: (record: AnswerRecord) => { if (!isAiId(record.playerId)) this.db.recordAnswer(record, room.id) },
      onFinished: (rows: Parameters<Db['recordGameResults']>[0]) => {
        // A recovered game can never award its scores twice.
        this.db.sql.transaction(() => {
          const result = this.db.sql.prepare('INSERT OR IGNORE INTO completed_games(id) VALUES (?)').bind(room.id).run()
          if (result.changes) this.db.recordGameResults(rows.filter(r => !isAiId(r.playerId)), false)
          this.save(room)
        })
      },
    }
  }
  private save(room: Room) {
    if (!room.engine) return
    this.db.sql.prepare('INSERT OR REPLACE INTO rooms(code,snapshot,expires_at) VALUES (?,?,?)')
      .bind(room.engine.code, JSON.stringify({ id: room.id, engine: room.engine.snapshot() }), Date.now() + 6 * 3600_000).run()
  }
  create(profile: PlayerProfile, mode: GameMode, preset: BoardPreset, difficulty: Difficulty, topics: string[] = []) {
    if (this.rooms.size >= 500) throw new Error('Room capacity reached. Please try again shortly.')
    let code: string
    do { code = String(randomInt(100000, 1000000)) } while (this.rooms.has(code))
    const room = this.makeRoom(code)
    room.engine = new RoomEngine(code, profile, mode, preset, difficulty, topics, this.hooks(room), this.timings)
    this.rooms.set(code, room)
    this.save(room)
    return code
  }
  connect(ws: WebSocket, code: string, playerId: string) {
    const room = this.rooms.get(code)
    if (!room) return ws.close(4004, 'No room with that code')
    const profile = this.db.getPlayer(playerId)
    if (!profile) return ws.close(4003, 'Unknown player')
    if (room.sockets.size >= 12) return ws.close(4003, 'Too many connections in this room')
    const joined = room.engine.join(profile)
    if (!joined.ok) return ws.close(4003, joined.error)
    room.sockets.set(ws, playerId)
    room.idleSince = null
    if (room.paused) { room.paused = false; room.engine.resume() }
    this.db.touchPlayer(playerId)
    this.send(ws, JSON.stringify({ t: 'event', event: 'room', payload: room.engine.view() }))
    if (room.engine.game) this.send(ws, JSON.stringify({ t: 'event', event: 'game', payload: room.engine.game }))
    const over = room.engine.gameOverPayload()
    if (over) this.send(ws, JSON.stringify({ t: 'event', event: 'gameOver', payload: over }))
    let windowStart = Date.now(), messages = 0
    ws.on('message', raw => {
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messages = 0 }
      if (++messages > 30) return ws.close(1008, 'Too many messages')
      try {
        const message: unknown = JSON.parse(raw.toString())
        if (!isCall(message)) return
        const p = (message.payload && typeof message.payload === 'object' ? message.payload : {}) as Record<string, unknown>
        const engine = room.engine
        let ack
        switch (message.event) {
          case 'setReady': ack = engine.setReady(playerId, p.ready === true); break
          case 'setMode': {
            // Omitting topics keeps the room's current ones.
            const topics = p.topics === undefined ? undefined : parseTopicList(p.topics)
            ack = (p.mode === 'ffa' || p.mode === 'teams') && (p.preset === 'quick' || p.preset === 'standard') && isDifficulty(p.difficulty) && topics !== null
              ? engine.setMode(playerId, p.mode, p.preset, SINGLE_LEVEL ?? p.difficulty, topics) : { ok: false, error: 'Invalid room settings' }; break
          }
          case 'swapSeats': ack = engine.swapSeats(playerId, Number(p.a), Number(p.b)); break
          case 'addAi': ack = AI_SKILLS.includes(p.skill as never) ? engine.addAi(playerId, p.skill as never) : { ok: false, error: 'Invalid AI skill' }; break
          case 'removeSeat': ack = engine.removeSeat(playerId, Number(p.seat)); break
          case 'startGame': ack = engine.start(playerId, this.db.activeQuestionsForPlay(engine.difficulty)); break
          case 'roll': ack = engine.roll(playerId); break
          case 'answer': ack = ['A', 'B', 'C', 'D'].includes(String(p.letter)) ? engine.answer(playerId, p.letter as AnswerLetter) : { ok: false, error: 'Invalid answer' }; break
          case 'choosePiece': ack = engine.choose(playerId, String(p.pieceId)); break
          case 'leaveRoom': engine.leave(playerId); ack = { ok: true }; break
          default: ack = { ok: false, error: 'Unknown event' }
        }
        this.send(ws, JSON.stringify({ t: 'ack', id: message.id, ...ack }))
        if (message.event === 'leaveRoom') ws.close(1000, 'left')
      } catch (error) { console.error('Room message failed', error); ws.close(1011, 'Server error') }
    })
    ws.on('close', () => {
      room.sockets.delete(ws)
      if (this.shuttingDown) return
      if (![...room.sockets.values()].includes(playerId)) room.engine.markDisconnected(playerId)
      if (!room.sockets.size) {
        room.idleSince = Date.now()
        room.engine.dispose()
        room.paused = true
        this.save(room)
      }
    })
    ws.on('error', () => ws.terminate())
  }
  private send(ws: WebSocket, text: string) {
    if (ws.readyState !== WebSocket.OPEN) return
    if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); return }
    ws.send(text, error => { if (error) ws.terminate() })
  }
  prune() {
    for (const [code, room] of this.rooms) {
      if (room.idleSince !== null && Date.now() - room.idleSince > this.graceMs) {
        room.engine.dispose()
        this.rooms.delete(code)
        this.db.sql.prepare('DELETE FROM rooms WHERE code=?').bind(code).run()
      }
    }
  }
  close() {
    this.shuttingDown = true
    clearInterval(this.sweep)
    for (const room of this.rooms.values()) {
      room.engine.dispose()
      this.save(room)
      for (const ws of room.sockets.keys()) ws.close(1012, 'Server restarting')
    }
  }
}
