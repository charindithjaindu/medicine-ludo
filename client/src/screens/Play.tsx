import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameOverPayload, GameState, PlayerProfile, RoomView } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { emit, socket } from '../lib/socket.ts'
import {
  clearPlayerId,
  clearRoomCode,
  loadPlayerId,
  loadRoomCode,
  savePlayerId,
  saveRoomCode,
} from '../lib/session.ts'
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
  const [over, setOver] = useState<GameOverPayload | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // True from the first render when this device remembers a room, so a reload goes
  // straight to a loader rather than flashing the main menu on the way back in.
  const [resuming, setResuming] = useState(() => loadRoomCode() !== null)

  // Kept in a ref so the reconnect handler always sees the current values.
  const rejoin = useRef<{ playerId: string; code: string } | null>(null)
  const resumeTried = useRef(false)

  useEffect(() => {
    const stored = loadPlayerId()
    if (!stored) {
      setLoading(false)
      setResuming(false)
      return
    }
    api
      .getPlayer(stored)
      .then(setPlayer)
      .catch(() => {
        clearPlayerId()
        setResuming(false)
      })
      .finally(() => setLoading(false))
  }, [])

  /**
   * Walk back into the room this device was last in. The server matches on player
   * ID, so a returning player lands back in their own seat — which is the point: a
   * stray back gesture or a locked screen should not cost you your game.
   */
  useEffect(() => {
    if (!player || resumeTried.current) return
    resumeTried.current = true
    const code = loadRoomCode()
    if (!code) {
      setResuming(false)
      return
    }
    emit<{ code: string }>('joinRoom', { playerId: player.id, code }).then((ack) => {
      // The room is gone, full, or mid-game without us. Forget it and show the menu.
      if (ack.ok) rejoin.current = { playerId: player.id, code }
      else clearRoomCode()
      setResuming(false)
    })
  }, [player])

  useEffect(() => {
    const onRoom = (r: RoomView) => setRoom(r)
    const onGame = (g: GameState) => {
      setGame(g)
      if (g.phase !== 'game-over') setOver(null)
    }
    const onOver = (p: GameOverPayload) => setOver(p)
    const onClosed = ({ reason }: { reason: string }) => {
      setNotice(reason)
      setRoom(null)
      setGame(null)
      rejoin.current = null
      clearRoomCode()
    }
    socket.on('room', onRoom)
    socket.on('game', onGame)
    socket.on('gameOver', onOver)
    socket.on('roomClosed', onClosed)
    return () => {
      socket.off('room', onRoom)
      socket.off('game', onGame)
      socket.off('gameOver', onOver)
      socket.off('roomClosed', onClosed)
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
    saveRoomCode(code)
  }, [])

  const leave = useCallback(async () => {
    await emit('leaveRoom')
    rejoin.current = null
    clearRoomCode()
    setRoom(null)
    setGame(null)
    setOver(null)
    if (player) api.getPlayer(player.id).then(setPlayer).catch(() => {})
  }, [player])

  if (loading || (resuming && !room)) {
    return (
      <Screen>
        <div className="grid min-h-[70vh] place-items-center">
          <div className="text-center">
            <p className="mb-4 text-6xl animate-bob">🎲</p>
            <Logo small />
            <div className="mt-6">
              <Loader label={resuming && !loading ? 'Taking you back…' : 'Shuffling the deck…'} />
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
