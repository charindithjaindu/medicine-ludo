import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LeaderboardRow } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { loadPlayerId } from '../lib/session.ts'
import { audio } from '../lib/audio.ts'
import { Loader, Panel, Screen, SoundToggle } from '../components/ui.tsx'

const MEDALS = ['🥇', '🥈', '🥉']

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const me = loadPlayerId()

  useEffect(() => {
    api
      .leaderboard()
      .then(setRows)
      .catch((err) => setError((err as Error).message))
  }, [])

  return (
    <Screen>
      <header className="mb-5 flex items-center justify-between">
        <Link
          to="/"
          onClick={() => audio.play('click')}
          className="rounded-full border-2 border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
        >
          ← Back
        </Link>
        <SoundToggle />
      </header>

      <h1 className="ml-title mb-1 text-center text-4xl font-bold">🏆 Leaderboard</h1>
      <p className="mb-6 text-center text-sm font-medium text-white/60">
        Every finished game adds to your total.
      </p>

      {error && (
        <Panel className="p-5">
          <p className="font-medium text-rose-600">{error}</p>
        </Panel>
      )}

      {!rows && !error && (
        <div className="py-10">
          <Loader label="Loading scores…" />
        </div>
      )}

      {rows?.length === 0 && (
        <Panel className="animate-pop-in p-8 text-center">
          <p className="text-5xl animate-bob">🎲</p>
          <p className="mt-3 text-lg font-semibold">Nobody on the board yet</p>
          <p className="mt-1 text-sm text-ink/60">
            Finish a game and you'll be the first name here.
          </p>
        </Panel>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const isMe = row.id === me
            return (
              <div
                key={row.id}
                className={`flex animate-rise-in items-center gap-3 rounded-2xl border-[3px] border-ink px-3 py-2.5 shadow-[4px_4px_0_0_var(--color-ink)] ${
                  isMe ? 'bg-amber-200' : i < 3 ? 'bg-cream' : 'bg-cream/90'
                }`}
                style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
              >
                <span className="w-8 text-center text-lg font-bold">
                  {MEDALS[i] ?? <span className="text-sm text-ink/40">{row.rank}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold leading-tight">
                    {row.name || 'Unnamed'}
                    {isMe && <span className="ml-1 text-xs text-ink/50">(you)</span>}
                  </p>
                  <p className="text-xs text-ink/55">
                    <span className="font-mono">{row.id}</span> · {row.gamesPlayed} games ·{' '}
                    {row.wins} wins · {Math.round(row.accuracy * 100)}% accurate
                  </p>
                </div>
                <span className="text-xl font-bold tabular-nums">{row.totalScore}</span>
              </div>
            )
          })}
        </div>
      )}
    </Screen>
  )
}
