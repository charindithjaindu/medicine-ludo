import { Router } from 'express'
import { createPlayer, getPlayer, leaderboard, renamePlayer, touchPlayer } from './db.js'

/**
 * Identity is deliberately thin: a player is a 6-digit ID and an optional name.
 * The ID is the only unique key, so a player can come back on any device by typing
 * it in. There are no passwords here — nothing sensitive is behind a player ID.
 */
export function apiRouter(): Router {
  const router = Router()

  router.post('/players', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    res.status(201).json({ player: createPlayer(name) })
  })

  router.get('/players/:id', (req, res) => {
    const player = getPlayer(req.params.id)
    if (!player) {
      res.status(404).json({ error: 'No player with that ID' })
      return
    }
    touchPlayer(player.id)
    res.json({ player })
  })

  router.patch('/players/:id', (req, res) => {
    if (!getPlayer(req.params.id)) {
      res.status(404).json({ error: 'No player with that ID' })
      return
    }
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    res.json({ player: renamePlayer(req.params.id, name) })
  })

  router.get('/leaderboard', (_req, res) => {
    res.json({ rows: leaderboard(100) })
  })

  return router
}
