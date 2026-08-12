/**
 * Worker entry: the REST API, the websocket route, and the static client.
 *
 * Rooms live in Durable Objects keyed by their 6-digit code, which is what gives
 * a turn-based game the single authoritative instance it needs.
 */

import { handleAdmin } from './admin.js'
import { Db } from './db.js'
import { isDifficulty, type BoardPreset, type Difficulty, type GameMode } from '@shared/types.js'

export { RoomDurableObject } from './room.js'

interface Env {
  DB: D1Database
  ROOMS: DurableObjectNamespace
  ASSETS: Fetcher
  ADMIN_PASSWORD?: string
  SESSION_SECRET?: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const db = new Db(env.DB)

    try {
      // -- realtime --------------------------------------------------------
      if (path === '/ws') {
        const code = url.searchParams.get('code')
        if (!code) return new Response('Missing room code', { status: 400 })
        return roomStub(env, code).fetch(request)
      }

      // -- rooms -----------------------------------------------------------
      if (path === '/api/rooms' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          playerId?: string
          mode?: GameMode
          preset?: BoardPreset
          difficulty?: Difficulty
        }
        const profile = body.playerId ? await db.getPlayer(body.playerId) : null
        if (!profile) return json({ error: 'Unknown player ID' }, 400)

        // Ask for codes until one is free. The DO refuses a code already in use.
        for (let attempt = 0; attempt < 12; attempt++) {
          const code = String(100000 + Math.floor(Math.random() * 900000))
          const res = await roomStub(env, code).fetch('https://room/init', {
            method: 'POST',
            body: JSON.stringify({
              code,
              mode: body.mode ?? 'ffa',
              preset: body.preset ?? 'standard',
              difficulty: isDifficulty(body.difficulty) ? body.difficulty : 'medium',
              hostPlayerId: profile.id,
              hostName: profile.name,
            }),
          })
          if (res.ok) return json({ code })
        }
        return json({ error: 'Could not allocate a room code' }, 503)
      }

      // -- admin -----------------------------------------------------------
      if (path.startsWith('/api/admin')) {
        return handleAdmin(request, path.slice('/api/admin'.length) || '/', db, env)
      }

      // -- players & leaderboard -------------------------------------------
      if (path === '/api/players' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { name?: string }
        return json({ player: await db.createPlayer(body.name ?? '') }, 201)
      }

      const playerMatch = path.match(/^\/api\/players\/([^/]+)$/)
      if (playerMatch) {
        const id = decodeURIComponent(playerMatch[1])
        const player = await db.getPlayer(id)
        if (!player) return json({ error: 'No player with that ID' }, 404)
        if (request.method === 'GET') {
          await db.touchPlayer(id)
          return json({ player })
        }
        if (request.method === 'PATCH') {
          const body = (await request.json().catch(() => ({}))) as { name?: string }
          return json({ player: await db.renamePlayer(id, body.name ?? '') })
        }
      }

      if (path === '/api/leaderboard') {
        return json({ rows: await db.leaderboard(100) })
      }

      if (path === '/api/health') {
        return json({ ok: true, questions: await db.activeCountByTier() })
      }

      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404)

      // -- the app ---------------------------------------------------------
      return env.ASSETS.fetch(request)
    } catch (err) {
      console.error('Unhandled error', err)
      return json({ error: (err as Error).message ?? 'Server error' }, 500)
    }
  },
}
