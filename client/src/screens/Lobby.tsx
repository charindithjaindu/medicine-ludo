import { useEffect, useRef, useState } from 'react'
import {
  DIFFICULTY_EMOJI,
  DIFFICULTY_NAMES,
  type PlayerProfile,
  type RoomView,
} from '@shared/types.js'
import { SEAT_COLORS, TEAM_NAMES } from '@shared/board.js'
import { AI_SKILLS, AI_SKILL_BLURBS, AI_SKILL_LABELS, type AiSkill } from '@shared/ai.js'
import { emit } from '../lib/socket.ts'
import { audio } from '../lib/audio.ts'
import { Button, Loader, Panel, Screen, SoundToggle } from '../components/ui.tsx'

export default function Lobby({
  player,
  room,
  onLeave,
}: {
  player: PlayerProfile
  room: RoomView
  onLeave: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [aiSkill, setAiSkill] = useState<AiSkill>('resident')
  const isHost = room.hostPlayerId === player.id
  const me = room.seats.find((s) => s.playerId === player.id)
  const canStart = room.mode === 'teams' ? room.seats.length === 4 : room.seats.length >= 2

  // A little chime whenever somebody new walks in.
  const seatCount = useRef(room.seats.length)
  useEffect(() => {
    if (room.seats.length > seatCount.current) audio.play('join')
    seatCount.current = room.seats.length
  }, [room.seats.length])

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    const ack = await fn()
    setError(ack.ok ? null : (ack.error ?? 'Something went wrong'))
  }

  async function copyCode() {
    audio.play('click')
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  }

  return (
    <Screen>
      <header className="mb-5 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onLeave}>
          ← Leave
        </Button>
        <SoundToggle />
      </header>

      <Panel className="mb-5 animate-pop-in p-5 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-ink/50">Room code</p>
        <button
          onClick={copyCode}
          title="Tap to copy"
          className="mt-1 font-mono text-5xl font-bold tracking-[0.2em] transition hover:text-amber-600"
        >
          {room.code}
        </button>
        <p className="mt-1 h-5 text-sm font-medium text-emerald-600">
          {copied ? 'Copied!' : ''}
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs font-semibold">
          <span className="rounded-full border-2 border-ink bg-amber-200 px-3 py-1">
            {room.mode === 'teams' ? '🤝 2 v 2' : '⚔️ Free for all'}
          </span>
          <span className="rounded-full border-2 border-ink bg-cyan-200 px-3 py-1">
            {room.preset === 'quick' ? '⚡ Quick board' : '🎯 Standard board'}
          </span>
          <span className="rounded-full border-2 border-ink bg-violet-200 px-3 py-1">
            {DIFFICULTY_EMOJI[room.difficulty]} {DIFFICULTY_NAMES[room.difficulty]} questions
          </span>
        </div>
      </Panel>

      {isHost && room.seats.length < 4 && (
        <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-white/50">
            Computer skill
          </span>
          {AI_SKILLS.map((skill) => (
            <button
              key={skill}
              onClick={() => {
                audio.play('click')
                setAiSkill(skill)
              }}
              title={AI_SKILL_BLURBS[skill]}
              className={`rounded-full border-2 px-3 py-1 text-xs font-semibold transition ${
                aiSkill === skill
                  ? 'border-ink bg-violet-300 text-ink'
                  : 'border-white/25 bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {AI_SKILL_LABELS[skill]}
            </button>
          ))}
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, seat) => {
          const s = room.seats[seat]
          return (
            <div
              key={seat}
              className={`relative animate-pop-in rounded-2xl border-[3px] p-3 ${
                s
                  ? 'border-ink bg-cream shadow-[4px_4px_0_0_var(--color-ink)]'
                  : 'border-dashed border-white/30 bg-white/5'
              }`}
              style={{ animationDelay: `${seat * 70}ms` }}
            >
              {s ? (
                <div className="flex items-center gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-ink text-lg font-bold text-white"
                    style={{ backgroundColor: SEAT_COLORS[seat] }}
                  >
                    {(s.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold leading-tight">
                      {s.ai && '🤖 '}
                      {s.name || 'Player'}
                      {s.playerId === player.id && (
                        <span className="ml-1 text-xs text-ink/50">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-ink/60">
                      {s.playerId === room.hostPlayerId && '👑 host · '}
                      {room.mode === 'teams' && `${TEAM_NAMES[seat % 2]} · `}
                      {s.ai ? (
                        <span className="font-semibold text-violet-600">
                          {AI_SKILL_LABELS[s.ai]}
                        </span>
                      ) : (
                        <span
                          className={
                            s.ready || s.playerId === room.hostPlayerId
                              ? 'font-semibold text-emerald-600'
                              : 'text-ink/50'
                          }
                        >
                          {s.ready || s.playerId === room.hostPlayerId ? 'ready' : 'waiting…'}
                        </span>
                      )}
                    </p>
                  </div>
                  {isHost && s.ai && (
                    <button
                      title="Remove this computer player"
                      onClick={() => {
                        audio.play('click')
                        act(() => emit('removeSeat', { seat }))
                      }}
                      className="rounded-lg border-2 border-ink bg-white px-2 py-0.5 text-sm hover:bg-rose-100"
                    >
                      ✕
                    </button>
                  )}
                  {isHost && !s.ai && seat > 0 && (
                    <button
                      title="Swap with the seat above"
                      onClick={() => {
                        audio.play('click')
                        act(() => emit('swapSeats', { a: seat, b: seat - 1 }))
                      }}
                      className="rounded-lg border-2 border-ink bg-white px-2 py-0.5 text-sm hover:bg-amber-100"
                    >
                      ↑
                    </button>
                  )}
                </div>
              ) : isHost ? (
                <button
                  onClick={() => {
                    audio.play('join')
                    act(() => emit('addAi', { skill: aiSkill }))
                  }}
                  className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  🤖 Add {AI_SKILL_LABELS[aiSkill]}
                </button>
              ) : (
                <div className="flex h-[52px] items-center justify-center gap-3">
                  <Loader />
                  <span className="text-sm font-medium text-white/50">Empty seat</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {room.mode === 'teams' && (
        <p className="mb-4 rounded-xl border-2 border-white/20 bg-white/5 px-4 py-2 text-center text-sm text-white/70">
          A team wins on <strong className="text-white">2 pieces home between the partners</strong>,
          so either of you can carry it — and you can't capture each other.
        </p>
      )}

      {error && (
        <p className="mb-4 animate-shake rounded-xl border-[3px] border-rose-500 bg-rose-50 px-4 py-2 font-medium text-rose-700">
          {error}
        </p>
      )}

      {isHost ? (
        <Button
          variant="green"
          size="xl"
          className="w-full"
          onClick={() => act(() => emit('startGame'))}
          disabled={!canStart}
        >
          {canStart
            ? '▶ Start the game'
            : room.mode === 'teams'
              ? `Waiting for ${4 - room.seats.length} more…`
              : 'Waiting for 1 more…'}
        </Button>
      ) : (
        <Button
          variant={me?.ready ? 'green' : 'plain'}
          size="xl"
          className="w-full"
          onClick={() => act(() => emit('setReady', { ready: !me?.ready }))}
        >
          {me?.ready ? "✓ I'm ready" : "Tap when you're ready"}
        </Button>
      )}

      <p className="mt-4 text-center text-sm text-white/60">
        Share <span className="font-mono font-bold text-white">{room.code}</span> so the others can
        join.
      </p>
    </Screen>
  )
}
