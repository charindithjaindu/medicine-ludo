/**
 * The websocket envelope.
 *
 * Socket.IO cannot run on Cloudflare Workers, so the wire format is this small
 * hand-rolled protocol instead. It keeps Socket.IO's one genuinely useful feature —
 * request/response acknowledgements — so callers can still surface the server's
 * rejection reason rather than guessing why nothing happened.
 */

import type { GameState, GameSummaryRow, RoomView, Winner } from './types.js'

/** client -> server */
export interface CallMessage {
  t: 'call'
  id: number
  event: string
  payload?: unknown
}

/** server -> client, answering a call */
export interface AckMessage {
  t: 'ack'
  id: number
  ok: boolean
  error?: string
  data?: unknown
}

/** server -> client, unprompted */
export type ServerEvent =
  | { t: 'event'; event: 'room'; payload: RoomView }
  | { t: 'event'; event: 'game'; payload: GameState }
  | { t: 'event'; event: 'gameOver'; payload: { winner: Winner; summary: GameSummaryRow[] } }
  | { t: 'event'; event: 'roomClosed'; payload: { reason: string } }

export type ServerMessage = AckMessage | ServerEvent
export type ClientMessage = CallMessage

export function isCall(value: unknown): value is CallMessage {
  const m = value as CallMessage
  return !!m && m.t === 'call' && typeof m.id === 'number' && typeof m.event === 'string'
}
