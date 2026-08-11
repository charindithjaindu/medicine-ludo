import { useState } from 'react'
import type { PlayerProfile } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { audio } from '../lib/audio.ts'
import { Button, Logo, Panel, Screen, SoundToggle } from '../components/ui.tsx'

type Step = 'choose' | 'new' | 'returning'

/**
 * First screen. One decision at a time: pick who you are, then fill in the one
 * field that choice needs.
 */
export default function Identity({ onReady }: { onReady: (p: PlayerProfile) => void }) {
  const [step, setStep] = useState<Step>('choose')
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const player =
        step === 'new' ? await api.createPlayer(name.trim()) : await api.getPlayer(id.trim())
      audio.play('join')
      onReady(player)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <div className="absolute right-4 top-6">
        <SoundToggle />
      </div>

      <div className="mt-10 mb-8 animate-pop-in">
        <div className="mb-3 flex justify-center gap-2 text-4xl">
          <span className="animate-bob" style={{ animationDelay: '0ms' }}>
            🎲
          </span>
          <span className="animate-bob" style={{ animationDelay: '300ms' }}>
            🩺
          </span>
          <span className="animate-bob" style={{ animationDelay: '600ms' }}>
            🏆
          </span>
        </div>
        <Logo />
        <p className="mt-3 text-center text-lg font-medium text-white/80">
          Roll the die. Answer the card. Race home.
        </p>
      </div>

      {step === 'choose' ? (
        <div className="space-y-4">
          <Button
            variant="primary"
            size="xl"
            className="w-full animate-rise-in delay-1"
            onClick={() => setStep('new')}
          >
            ✨ I'm new here
          </Button>
          <Button
            variant="cyan"
            size="xl"
            className="w-full animate-rise-in delay-2"
            onClick={() => setStep('returning')}
          >
            🔑 I have a Player ID
          </Button>
        </div>
      ) : (
        <Panel className="animate-pop-in p-6">
          <button
            onClick={() => {
              audio.play('click')
              setStep('choose')
              setError(null)
            }}
            className="mb-3 text-sm font-semibold text-ink/50 hover:text-ink"
          >
            ← back
          </button>

          <form onSubmit={submit} className="space-y-4">
            {step === 'new' ? (
              <>
                <h2 className="text-2xl font-semibold">What should we call you?</h2>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder="e.g. Ana"
                  className="w-full rounded-xl border-[3px] border-ink bg-white px-4 py-3 text-xl font-medium outline-none focus:bg-amber-50"
                />
                <p className="text-sm text-ink/60">
                  Optional. You'll get a 6-digit Player ID — keep it, it's how your score follows
                  you to another device.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold">Welcome back</h2>
                <input
                  autoFocus
                  value={id}
                  onChange={(e) => setId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder="123456"
                  className="w-full rounded-xl border-[3px] border-ink bg-white px-4 py-3 text-center font-mono text-3xl tracking-[0.35em] outline-none focus:bg-cyan-50"
                />
                <p className="text-sm text-ink/60">Enter your 6-digit Player ID.</p>
              </>
            )}

            {error && (
              <p className="animate-shake rounded-xl border-[3px] border-rose-500 bg-rose-50 px-3 py-2 font-medium text-rose-700">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant={step === 'new' ? 'primary' : 'cyan'}
              size="lg"
              className="w-full"
              disabled={busy || (step === 'returning' && id.length !== 6)}
            >
              {busy ? 'One sec…' : step === 'new' ? "Let's play" : 'Continue'}
            </Button>
          </form>
        </Panel>
      )}
    </Screen>
  )
}
