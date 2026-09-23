import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlayerProgress } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { loadPlayerId } from '../lib/session.ts'
import { audio } from '../lib/audio.ts'
import ProgressView from '../components/ProgressView.tsx'
import { Loader, Panel, Screen, SoundToggle } from '../components/ui.tsx'

/** "My progress": the device's remembered player, read from the answer log. */
export default function Progress() {
  const id = loadPlayerId()
  const [progress, setProgress] = useState<PlayerProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api
      .progress(id)
      .then(setProgress)
      .catch((err) => setError((err as Error).message))
  }, [id])

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

      <h1 className="ml-title mb-1 text-center text-4xl font-bold">📈 My progress</h1>
      <p className="mb-6 text-center text-sm font-medium text-white/60">
        {progress
          ? `${progress.player.name || 'Unnamed player'} · ID ${progress.player.id}`
          : 'Every answer you give is saved to your ID.'}
      </p>

      {!id && (
        <Panel className="p-6 text-center">
          <p className="font-semibold">This device doesn't know who you are yet.</p>
          <p className="mt-1 text-sm text-ink/60">
            Go back and enter your 6-digit ID (or make a new one) to see your progress.
          </p>
        </Panel>
      )}

      {error && (
        <Panel className="p-5">
          <p className="font-medium text-rose-600">{error}</p>
        </Panel>
      )}

      {id && !progress && !error && (
        <div className="py-10">
          <Loader label="Adding up your answers…" />
        </div>
      )}

      {progress && <ProgressView progress={progress} />}
    </Screen>
  )
}
