import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { BoardPreset, GameMode, PlayerProfile } from '@shared/types.js'
import { emit } from '../lib/socket.ts'
import { audio } from '../lib/audio.ts'
import { Button, Logo, Panel, Screen, SoundToggle } from '../components/ui.tsx'

type View = 'home' | 'create' | 'join'

/**
 * Home is two buttons and nothing else. The mode and board choices only appear
 * once you've said you want to create a room — no one should have to read six
 * options to answer "do you want to start a game or join one?".
 */
export default function Menu({
  player,
  notice,
  onEnterRoom,
  onSwitchPlayer,
}: {
  player: PlayerProfile
  notice: string | null
  onEnterRoom: (code: string, playerId: string) => void
  onSwitchPlayer: () => void
}) {
  const [view, setView] = useState<View>('home')
  const [mode, setMode] = useState<GameMode>('ffa')
  const [preset, setPreset] = useState<BoardPreset>('standard')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    const ack = await emit<{ code: string }>('createRoom', { playerId: player.id, mode, preset })
    setBusy(false)
    if (!ack.ok) return setError(ack.error ?? 'Could not create a room')
    audio.play('join')
    onEnterRoom(ack.data!.code, player.id)
  }

  async function join(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const ack = await emit<{ code: string }>('joinRoom', { playerId: player.id, code })
    setBusy(false)
    if (!ack.ok) return setError(ack.error ?? 'Could not join')
    audio.play('join')
    onEnterRoom(ack.data!.code, player.id)
  }

  const accuracy = player.answered > 0 ? Math.round((player.correct / player.answered) * 100) : null

  return (
    <Screen center>
      <header className="mb-6 flex items-center justify-between gap-2">
        <Link
          to="/leaderboard"
          onClick={() => audio.play('click')}
          className="rounded-full border-2 border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
        >
          🏆 Leaderboard
        </Link>
        <SoundToggle />
      </header>

      <div className="mb-6 animate-pop-in">
        <Logo />
      </div>

      {/* Player chip */}
      <Panel flat className="mb-6 flex animate-rise-in items-center gap-3 px-4 py-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-ink bg-amber-300 text-lg font-bold">
          {(player.name || '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{player.name || 'Unnamed player'}</p>
          <p className="text-xs text-ink/60">
            ID <span className="font-mono font-semibold">{player.id}</span> · {player.totalScore} pts
            {accuracy !== null && ` · ${accuracy}%`}
          </p>
        </div>
        <button
          onClick={() => {
            audio.play('click')
            onSwitchPlayer()
          }}
          className="text-xs font-semibold text-ink/50 underline underline-offset-2 hover:text-ink"
        >
          switch
        </button>
      </Panel>

      {notice && (
        <p className="mb-4 animate-shake rounded-xl border-[3px] border-amber-500 bg-amber-50 px-4 py-2 font-medium text-amber-900">
          {notice}
        </p>
      )}

      {view === 'home' && (
        <div className="space-y-4">
          <Button
            variant="primary"
            size="xl"
            className="w-full animate-rise-in delay-1"
            onClick={() => setView('create')}
          >
            🎲 Create a room
          </Button>
          <Button
            variant="cyan"
            size="xl"
            className="w-full animate-rise-in delay-2"
            onClick={() => setView('join')}
          >
            🚪 Join a room
          </Button>
        </div>
      )}

      {view === 'create' && (
        <Panel className="animate-pop-in p-5">
          <BackLink
            onClick={() => {
              setView('home')
              setError(null)
            }}
          />
          <h2 className="mb-4 text-2xl font-semibold">Set up the game</h2>

          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">Players</p>
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            <Choice
              active={mode === 'ffa'}
              onClick={() => setMode('ffa')}
              emoji="⚔️"
              title="Free for all"
              detail="2-4 players, every player for themselves"
            />
            <Choice
              active={mode === 'teams'}
              onClick={() => setMode('teams')}
              emoji="🤝"
              title="2 v 2"
              detail="4 players, partners share the win"
            />
          </div>

          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/50">Board</p>
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            <Choice
              active={preset === 'quick'}
              onClick={() => setPreset('quick')}
              emoji="⚡"
              title="Quick"
              detail="Short arms · ~25 min"
            />
            <Choice
              active={preset === 'standard'}
              onClick={() => setPreset('standard')}
              emoji="🎯"
              title="Standard"
              detail="Long arms · ~30 min"
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={create}
            disabled={busy}
          >
            {busy ? 'Creating…' : "Create room →"}
          </Button>
        </Panel>
      )}

      {view === 'join' && (
        <Panel className="animate-pop-in p-5">
          <BackLink
            onClick={() => {
              setView('home')
              setError(null)
            }}
          />
          <h2 className="mb-1 text-2xl font-semibold">Got a code?</h2>
          <p className="mb-4 text-sm text-ink/60">Ask the host for their 6 digits.</p>

          <form onSubmit={join} className="space-y-4">
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="w-full rounded-xl border-[3px] border-ink bg-white px-4 py-4 text-center font-mono text-4xl tracking-[0.3em] outline-none focus:bg-cyan-50"
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button
              type="submit"
              variant="cyan"
              size="lg"
              className="w-full"
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Joining…' : 'Join game →'}
            </Button>
          </form>
        </Panel>
      )}
    </Screen>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={() => {
        audio.play('click')
        onClick()
      }}
      className="mb-3 text-sm font-semibold text-ink/50 hover:text-ink"
    >
      ← back
    </button>
  )
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 animate-shake rounded-xl border-[3px] border-rose-500 bg-rose-50 px-3 py-2 font-medium text-rose-700">
      {children}
    </p>
  )
}

function Choice({
  active,
  onClick,
  emoji,
  title,
  detail,
}: {
  active: boolean
  onClick: () => void
  emoji: string
  title: string
  detail: string
}) {
  return (
    <button
      type="button"
      onClick={() => {
        audio.play('click')
        onClick()
      }}
      className={`rounded-xl border-[3px] border-ink px-3 py-3 text-left transition ${
        active
          ? 'bg-amber-300 shadow-[4px_4px_0_0_var(--color-ink)]'
          : 'bg-white hover:bg-amber-50'
      }`}
    >
      <span className="mb-0.5 block text-xl">{emoji}</span>
      <span className="block font-semibold leading-tight">{title}</span>
      <span className="block text-xs text-ink/60">{detail}</span>
    </button>
  )
}
