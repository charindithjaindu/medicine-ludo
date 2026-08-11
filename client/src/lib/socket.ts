import { io, type Socket } from 'socket.io-client'
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@shared/types.js'

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
})

/**
 * Every client->server event is acknowledged, so the caller can surface the
 * server's rejection reason instead of guessing why nothing happened.
 */
export function emit<T = undefined>(
  event: keyof ClientToServerEvents,
  payload?: unknown,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const done = (ack: Ack<T>) => resolve(ack ?? { ok: false, error: 'No response' })
    if (payload === undefined) {
      ;(socket.emit as (e: string, cb: unknown) => void)(event, done)
    } else {
      ;(socket.emit as (e: string, p: unknown, cb: unknown) => void)(event, payload, done)
    }
  })
}
