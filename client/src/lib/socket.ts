/** One acknowledged WebSocket connection per player, with automatic reconnection. */

import type { Ack, BoardPreset, Difficulty, GameMode } from '@shared/types.js'
import type { AckMessage, ServerMessage } from '@shared/protocol.js'

type Handler = (payload: never) => void

const handlers = new Map<string, Set<Handler>>()
const pending = new Map<number, (ack: Ack) => void>()

let ws: WebSocket | null = null
let current: { code: string; playerId: string } | null = null
let nextCallId = 1
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function fire(event: string, payload: unknown) {
  for (const handler of handlers.get(event) ?? []) (handler as (p: unknown) => void)(payload)
}

function socketUrl(code: string, playerId: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const params = new URLSearchParams({ code, playerId })
  return `${scheme}://${location.host}/ws?${params}`
}

function open(code: string, playerId: string): Promise<Ack<{ code: string }>> {
  // Replace the previous socket before opening another. Its callbacks cannot reconnect it.
  for (const done of pending.values()) done({ ok: false, error: 'Connection replaced' })
  pending.clear()
  const previous = ws
  ws = null
  previous?.close(1000, 'replaced')
  return new Promise((resolve) => {
    let settled = false
    const connection = new WebSocket(socketUrl(code, playerId))
    ws = connection
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ ok: false, error: 'Could not reach the game server' })
      connection.close()
    }, 10000)
    const settle = (result: Ack<{ code: string }>) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    connection.onmessage = (raw) => {
      if (ws !== connection) return
      let message: ServerMessage
      try { message = JSON.parse(String(raw.data)) } catch { return }
      // The first room event, rather than the TCP handshake, confirms admission.
      if (message.t === 'event' && message.event === 'room' && !settled) {
        reconnectAttempts = 0
        current = { code, playerId }
        settle({ ok: true, data: { code } })
        fire('connect', undefined)
      }
      if (message.t === 'ack') {
        const done = pending.get(message.id)
        pending.delete(message.id)
        done?.(message as Ack)
      } else fire(message.event, message.payload)
    }
    connection.onclose = (event) => {
      clearTimeout(timeout)
      settle({ ok: false, error: event.reason || refusalReason(event.code) })
      if (ws !== connection) return
      ws = null
      for (const done of pending.values()) done({ ok: false, error: 'Connection interrupted' })
      pending.clear()
      if (event.code === 4003 || event.code === 4004) {
        current = null
        fire('roomClosed', { reason: event.reason || refusalReason(event.code) })
      } else if (current) scheduleReconnect()
    }
    connection.onerror = () => {
      settle({ ok: false, error: 'Could not reach the game server' })
    }
  })
}

function refusalReason(closeCode: number): string {
  if (closeCode === 4004) return 'No room with that code'
  if (closeCode === 4003) return 'That room is full or already playing'
  return 'Could not join that room'
}

function scheduleReconnect() {
  if (reconnectTimer || !current) return
  const delay = Math.min(8000, 400 * 2 ** reconnectAttempts++) + Math.random() * 500
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (!current) return
    const result = await open(current.code, current.playerId)
    if (!result.ok && current) scheduleReconnect()
  }, delay)
}

function send(event: string, payload?: unknown): Promise<Ack> {
  const socket = ws
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ ok: false, error: 'Not connected' })
  }
  const id = nextCallId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    socket.send(JSON.stringify({ t: 'call', id, event, payload }))
    // Never leave a caller hanging on a dropped connection.
    setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, error: 'The server did not respond' })
    }, 10000)
  })
}

function disconnect() {
  current = null
  reconnectAttempts = 0
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  ws?.close(1000, 'left')
  ws = null
}

export const socket = {
  on(event: string, handler: Handler) {
    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event)!.add(handler)
  },
  off(event: string, handler: Handler) {
    handlers.get(event)?.delete(handler)
  },
}

export async function emit<T = undefined>(
  event: string,
  payload?: unknown,
): Promise<Ack<T>> {
  if (event === 'createRoom') {
    const p = payload as {
      playerId: string
      mode: GameMode
      preset: BoardPreset
      difficulty: Difficulty
    }
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body.error ?? 'Could not create a room' } as Ack<T>
    return (await open(body.code, p.playerId)) as Ack<T>
  }

  if (event === 'joinRoom') {
    const p = payload as { playerId: string; code: string }
    return (await open(p.code.trim(), p.playerId)) as Ack<T>
  }

  if (event === 'leaveRoom') {
    await send('leaveRoom')
    disconnect()
    return { ok: true } as Ack<T>
  }

  return (await send(event, payload)) as Ack<T>
}

export type { AckMessage }
