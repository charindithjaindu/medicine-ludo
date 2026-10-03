import { useEffect, useState } from 'react'
import { audio } from '../lib/audio.ts'

/** The animated night-table backdrop. Rendered once behind every screen. */
export function Backdrop() {
  // Each blob fades itself out with a radial gradient — the cheap stand-in for
  // the blur() this decoration used to pay GPU time for on every frame.
  return (
    <div className="ml-backdrop" aria-hidden>
      <span
        className="ml-blob"
        style={{
          background: 'radial-gradient(circle, #f43f5e 0%, transparent 72%)',
          width: 420,
          height: 420,
          top: '-6%',
          left: '-4%',
        }}
      />
      <span
        className="ml-blob"
        style={{
          background: 'radial-gradient(circle, #06b6d4 0%, transparent 72%)',
          width: 380,
          height: 380,
          top: '55%',
          right: '-6%',
          animationDelay: '-8s',
        }}
      />
      <span
        className="ml-blob"
        style={{
          background: 'radial-gradient(circle, #f59e0b 0%, transparent 72%)',
          width: 340,
          height: 340,
          bottom: '-8%',
          left: '30%',
          animationDelay: '-15s',
        }}
      />
    </div>
  )
}

export function Screen({
  children,
  wide = false,
  center = false,
}: {
  children: React.ReactNode
  wide?: boolean
  /** Vertically centre the content — right for short screens like the menu. */
  center?: boolean
}) {
  return (
    <>
      <Backdrop />
      <div
        className={`relative flex min-h-full flex-col items-center px-4 py-6 ${
          center ? 'justify-center' : ''
        }`}
      >
        <div className={`w-full ${wide ? 'max-w-6xl' : 'max-w-lg'}`}>{children}</div>
      </div>
    </>
  )
}

/**
 * A dialog that is a bottom sheet on a phone and a centred card on a desktop —
 * where a thumb can reach it on one, and where the eye already is on the other.
 */
export function Sheet({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 sm:items-center sm:p-4">
      <div
        className={`animate-rise-in max-h-[92vh] w-full overflow-y-auto border-[3px] border-ink bg-cream
          rounded-t-3xl sm:max-w-lg sm:rounded-3xl sm:shadow-[6px_6px_0_0_var(--color-ink)] ${className}`}
      >
        {children}
      </div>
    </div>
  )
}

type Variant = 'primary' | 'cyan' | 'green' | 'rose' | 'plain' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-amber-400',
  cyan: 'bg-cyan-400',
  green: 'bg-emerald-400',
  rose: 'bg-rose-400',
  plain: 'bg-cream',
  ghost: 'border-transparent! bg-white/10 text-white shadow-none! hover:bg-white/20',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  onClick,
  sound = 'click',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg' | 'xl'
  sound?: 'click' | 'join' | null
}) {
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-base',
    lg: 'px-6 py-3.5 text-lg',
    xl: 'px-6 py-5 text-2xl',
  }
  return (
    <button
      {...rest}
      onClick={(e) => {
        if (sound) audio.play(sound)
        onClick?.(e)
      }}
      className={`btn ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    />
  )
}

export function Panel({
  children,
  className = '',
  flat = false,
}: {
  children: React.ReactNode
  className?: string
  flat?: boolean
}) {
  return <div className={`${flat ? 'panel-flat' : 'panel'} ${className}`}>{children}</div>
}

/** Bouncing dots — used whenever the game is waiting on the server or another player. */
export function Loader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-3.5 w-3.5 rounded-full bg-amber-400 animate-bob"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      {label && <p className="text-sm font-medium text-white/70">{label}</p>}
    </div>
  )
}

export function SoundToggle({ className = '' }: { className?: string }) {
  const [on, setOn] = useState(audio.enabled)
  useEffect(() => audio.subscribe(setOn), [])
  return (
    <button
      onClick={() => setOn(audio.toggle())}
      title={on ? 'Mute' : 'Unmute'}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      className={`grid h-10 w-10 place-items-center rounded-full border-2 border-white/25 bg-white/10 text-lg text-white transition hover:bg-white/25 ${className}`}
    >
      {on ? '🔊' : '🔇'}
    </button>
  )
}

/** The big wordmark. */
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <h1
      className={`ml-title text-center font-bold tracking-tight ${
        small ? 'text-2xl' : 'text-5xl sm:text-6xl'
      }`}
    >
      Medicine Ludo
    </h1>
  )
}

/** A points number that floats up and fades — used on scoring events. */
export function FloatingScore({ amount, tone = 'good' }: { amount: number; tone?: 'good' | 'bad' }) {
  if (amount === 0) return null
  return (
    <span
      className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 animate-float-up text-2xl font-bold ${
        tone === 'good' ? 'text-emerald-500' : 'text-rose-500'
      }`}
    >
      {amount > 0 ? `+${amount}` : amount}
    </span>
  )
}
