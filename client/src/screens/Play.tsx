import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameState, GameSummaryRow, PlayerProfile, RoomView, Winner } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { emit, socket } from '../lib/socket.ts'
import { clearPlayerId, loadPlayerId, savePlayerId } from '../lib/session.ts'
import Identity from './Identity.tsx'
import Menu from './Menu.tsx'
import Lobby from './Lobby.tsx'
import Game from './Game.tsx'
import { Loader, Logo, Screen } from '../components/ui.tsx'

/**
 * Owns the whole player-facing flow. Which screen shows is derived from state
 * rather than routed, so a reconnect drops you back exactly where you were.
 */
export default function Play() {
  const [player, setPlayer] = useState<PlayerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [room, setRoom] = useState<RoomView | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [over, setOver] = useState<{ winner: Winner; summary: GameSummaryRow[] } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Kept in a ref so the reconnect handler always sees the current values.
  const rejoin = useRef<{ playerId: string; code: string } | null>(null)

  useEffect(() => {
    const stored = loadPlayerId()
    if (!stored) {
      setLoading(false)
      return
    }
    api
      .getPlayer(stored)
      .then(setPlayer)
      .catch(() => clearPlayerId())
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onRoom = (r: RoomView) => setRoom(r)
    const onGame = (g: GameState) => {
      setGame(g)
      if (g.phase !== 'game-over') setOver(null)
    }
    const onOver = (p: { winner: Winner; summary: GameSummaryRow[] }) => setOver(p)
    const onClosed = ({ reason }: { reason: string }) => {
      setNotice(reason)
      setRoom(null)
      setGame(null)
      rejoin.current = null
    }
    const onConnect = () => {
      // Socket.IO gives us a fresh socket id on reconnect, so re-announce ourselves.
      if (rejoin.current) {
        emit('joinRoom', rejoin.current)
      }
    }

    socket.on('room', onRoom)
    socket.on('game', onGame)
    socket.on('gameOver', onOver)
    socket.on('roomClosed', onClosed)
    socket.on('connect', onConnect)
    return () => {
      socket.off('room', onRoom)
      socket.off('game', onGame)
      socket.off('gameOver', onOver)
      socket.off('roomClosed', onClosed)
      socket.off('connect', onConnect)
    }
  }, [])

  const onIdentified = useCallback((p: PlayerProfile) => {
    savePlayerId(p.id)
    setPlayer(p)
  }, [])

  const switchPlayer = useCallback(() => {
    clearPlayerId()
    setPlayer(null)
    setRoom(null)
    setGame(null)
    rejoin.current = null
  }, [])

  const enterRoom = useCallback((code: string, playerId: string) => {
    rejoin.current = { playerId, code }
  }, [])

  const leave = useCallback(async () => {
    await emit('leaveRoom')
    rejoin.current = null
    setRoom(null)
    setGame(null)
    setOver(null)
    if (player) api.getPlayer(player.id).then(setPlayer).catch(() => {})
  }, [player])

  if (loading) {
    return (
      <Screen>
        <div className="grid min-h-[70vh] place-items-center">
          <div className="text-center">
            <p className="mb-4 text-6xl animate-bob">🎲</p>
            <Logo small />
            <div className="mt-6">
              <Loader label="Shuffling the deck…" />
            </div>
          </div>
        </div>
      </Screen>
    )
  }

  if (!player) {
    return <Identity onReady={onIdentified} />
  }

  if (!room) {
    return <Menu player={player} notice={notice} onEnterRoom={enterRoom} onSwitchPlayer={switchPlayer} />
  }

  if (!room.started || !game) {
    return <Lobby player={player} room={room} onLeave={leave} />
  }

  return <Game player={player} room={room} game={game} over={over} onLeave={leave} />
}
