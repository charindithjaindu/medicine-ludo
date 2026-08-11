/**
 * One Durable Object per room.
 *
 * The DO is a thin shell: it owns the websockets and the D1 reads/writes, and
 * delegates every rule to the shared RoomEngine — the same engine the game has
 * always used. Cloudflare guarantees a single instance per room code, which is
 * exactly the coordination a turn-based game needs.
 *
 * Sockets are accepted the classic way rather than with hibernation, because the
 * turn loop runs on setTimeout and hibernating would discard those timers. A room
 * with a live connection keeps its DO in memory, which is what we want anyway.
 */

import { DEFAULT_TIMINGS, RoomEngine, type RoomTimings } from '@shared/room-engine.js'
import { isAiId } from '@shared/ai.js'
import { isCall, type ServerMessage } from '@shared/protocol.js'
import type { AnswerLetter, BoardPreset, GameMode } from '@shared/types.js'
import { Db } from './db.js'

interface Env {
  DB: D1Database
  ROOMS: DurableObjectNamespace
  AI_DELAY_SCALE?: string
  REVEAL_MS?: string
}

interface Meta {
  code: string
  mode: GameMode
  preset: BoardPreset
  hostPlayerId: string
  hostName: string
}

export class RoomDurableObject implements DurableObject {
  private engine: RoomEngine | null = null
  private sockets = new Map<WebSocket, string>()
  private db: Db

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.db = new Db(env.DB)
  }

  private timings(): RoomTimings {
    return {
      ...DEFAULT_TIMINGS,
      revealMs: Number(this.env.REVEAL_MS ?? DEFAULT_TIMINGS.revealMs),
      aiDelayScale: Number(this.env.AI_DELAY_SCALE ?? DEFAULT_TIMINGS.aiDelayScale),
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/init') return this.handleInit(request)
    if (url.pathname === '/ws') return this.handleSocket(request, url)
    return new Response('Not found', { status: 404 })
  }

  /** Called once by the Worker when a room is created. Refuses to reuse a code. */
  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.state.storage.get<Meta>('meta')
    if (existing) return new Response('Code in use', { status: 409 })

    const meta = (await request.json()) as Meta
    await this.state.storage.put('meta', meta)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  private async ensureEngine(): Promise<RoomEngine | null> {
    if (this.engine) return this.engine
    const meta = await this.state.storage.get<Meta>('meta')
    if (!meta) return null

    this.engine = new RoomEngine(
      meta.code,
      { id: meta.hostPlayerId, name: meta.hostName },
      meta.mode,
      meta.preset,
      {
        broadcast: (message) => this.broadcast(message),
        onStat: (questionId, outcome) => {
          void this.db.recordAnswerStat(questionId, outcome).catch(() => {})
        },
        onFinished: (summary) => {
          // Computer players never reach the leaderboard.
          void this.db
            .recordGameResults(summary.filter((row) => !isAiId(row.playerId)))
            .catch(() => {})
        },
      },
      this.timings(),
    )
    return this.engine
  }

  private async handleSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 })
    }

    const code = url.searchParams.get('code') ?? ''
    const playerId = url.searchParams.get('playerId') ?? ''

    const engine = await this.ensureEngine()
    // 4004 tells the client "no room with that code" without leaking anything else.
    if (!engine) return new Response('No such room', { status: 404 })

    const profile = await this.db.getPlayer(playerId)
    if (!profile) return new Response('Unknown player', { status: 403 })

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    server.accept()

    const joined = engine.join({ id: profile.id, name: profile.name })
    if (!joined.ok) {
      server.close(4003, joined.error ?? 'Cannot join')
      return new Response(null, { status: 101, webSocket: client })
    }

    this.sockets.set(server, playerId)
    void this.db.touchPlayer(playerId).catch(() => {})

    // Bring the newcomer up to date on their own connection.
    this.sendTo(server, { t: 'event', event: 'room', payload: engine.view() })
    if (engine.game) this.sendTo(server, { t: 'event', event: 'game', payload: engine.game })

    server.addEventListener('message', (event) => {
      void this.onMessage(server, playerId, event.data)
    })
    const drop = () => this.onClose(server, playerId)
    server.addEventListener('close', drop)
    server.addEventListener('error', drop)

    return new Response(null, { status: 101, webSocket: client })
  }

  private async onMessage(socket: WebSocket, playerId: string, raw: unknown) {
    let message: unknown
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!isCall(message)) return

    const engine = this.engine
    if (!engine) {
      this.sendTo(socket, { t: 'ack', id: message.id, ok: false, error: 'Room is gone' })
      return
    }

    const p = (message.payload ?? {}) as Record<string, unknown>
    let ack

    switch (message.event) {
      case 'setReady':
        ack = engine.setReady(playerId, Boolean(p.ready))
        break
      case 'setMode':
        ack = engine.setMode(playerId, p.mode as GameMode, p.preset as BoardPreset)
        break
      case 'swapSeats':
        ack = engine.swapSeats(playerId, Number(p.a), Number(p.b))
        break
      case 'addAi':
        ack = engine.addAi(playerId, p.skill as never)
        break
      case 'removeSeat':
        ack = engine.removeSeat(playerId, Number(p.seat))
        break
      case 'startGame': {
        const ready = engine.canStart()
        ack = ready.ok
          ? engine.start(playerId, await this.db.activeQuestionsByTier())
          : ready
        break
      }
      case 'roll':
        ack = engine.roll(playerId)
        break
      case 'answer':
        ack = engine.answer(playerId, p.letter as AnswerLetter)
        break
      case 'choosePiece':
        ack = engine.choose(playerId, String(p.pieceId))
        break
      case 'leaveRoom':
        engine.markDisconnected(playerId)
        ack = { ok: true }
        break
      default:
        ack = { ok: false, error: `Unknown event: ${message.event}` }
    }

    this.sendTo(socket, { t: 'ack', id: message.id, ...ack })
  }

  private onClose(socket: WebSocket, playerId: string) {
    if (!this.sockets.delete(socket)) return
    // Only mark them gone if this was their last connection (a reload opens a new
    // socket before the old one closes).
    const stillHere = [...this.sockets.values()].includes(playerId)
    if (!stillHere) this.engine?.markDisconnected(playerId)

    if (this.engine?.isAbandoned()) {
      this.engine.dispose()
      this.engine = null
      void this.state.storage.deleteAll()
    }
  }

  private sendTo(socket: WebSocket, message: ServerMessage) {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      /* socket already gone */
    }
  }

  private broadcast(message: ServerMessage) {
    const text = JSON.stringify(message)
    for (const socket of this.sockets.keys()) {
      try {
        socket.send(text)
      } catch {
        this.sockets.delete(socket)
      }
    }
  }
}
