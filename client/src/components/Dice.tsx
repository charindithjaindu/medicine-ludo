import { useEffect, useRef, useState } from 'react'

/**
 * Pip positions on a 3x3 grid:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
const FACES: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/** First face change after the throw. Fast — the die is still travelling. */
const FIRST_FLICKER_MS = 40
/** Each change waits this much longer than the last, so the die visibly tires. */
const FLICKER_DECAY = 1.2
/** Slowest the faces ever change, so a long roll never looks frozen. */
const MAX_FLICKER_MS = 190
/** Length of the impact squash once it lands. Matches `dice-land` in index.css. */
const LAND_MS = 420

/**
 * A physical-looking die.
 *
 * While `rolling` it tumbles and flickers through faces; when rolling stops it
 * lands on `value` with an impact squash. The flicker *decelerates* rather than
 * running at a fixed interval — an even tick is what made the old die read as a
 * number being picked by a program instead of a throw losing its momentum.
 */
export default function Dice({
  value,
  rolling = false,
  land = false,
  size = 96,
  className = '',
}: {
  value: number | null
  rolling?: boolean
  /** Play the impact squash on mount, for a die that appears already landed. */
  land?: boolean
  size?: number
  /** The die is a fixed-width block, so centring is the caller's to ask for. */
  className?: string
}) {
  const [shown, setShown] = useState(value ?? 1)
  const [settling, setSettling] = useState(land)
  const shownRef = useRef(shown)
  const wasRolling = useRef(rolling)

  useEffect(() => {
    if (!rolling) {
      if (value) {
        setShown(value)
        shownRef.current = value
      }
      return
    }

    let timer: ReturnType<typeof setTimeout>
    let delay = FIRST_FLICKER_MS
    const step = () => {
      // Never show the same face twice running: a repeat reads as a stall rather
      // than a tumble.
      let next = shownRef.current
      while (next === shownRef.current) next = 1 + Math.floor(Math.random() * 6)
      shownRef.current = next
      setShown(next)
      delay = Math.min(delay * FLICKER_DECAY, MAX_FLICKER_MS)
      timer = setTimeout(step, delay)
    }
    timer = setTimeout(step, delay)
    return () => clearTimeout(timer)
  }, [rolling, value])

  // The moment it stops is the moment it hits the table.
  useEffect(() => {
    const landed = wasRolling.current && !rolling
    wasRolling.current = rolling
    if (!landed) return
    setSettling(true)
    const t = setTimeout(() => setSettling(false), LAND_MS)
    return () => clearTimeout(t)
  }, [rolling])

  const face = FACES[shown] ?? FACES[1]
  const motion = rolling ? 'animate-tumble' : settling ? 'animate-dice-land' : 'animate-pop-in'

  return (
    <div
      className={`grid shrink-0 grid-cols-3 grid-rows-3 rounded-2xl border-[3px] border-ink bg-cream shadow-[5px_5px_0_0_var(--color-ink)] ${motion} ${className}`}
      // Padding and gap are derived from `size` rather than written as
      // percentages: a percentage padding resolves against the *parent's* width,
      // not the die's, so in a wide panel it swallowed the die and left the pips
      // at zero width — a blank rounded square.
      style={{ width: size, height: size, padding: size * 0.12, gap: size * 0.08 }}
      aria-label={rolling ? 'Rolling the die' : `Die showing ${shown}`}
      role="img"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`rounded-full ${face.includes(i) ? 'bg-ink' : 'bg-transparent'}`}
        />
      ))}
    </div>
  )
}
