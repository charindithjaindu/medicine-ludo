import { useEffect, useState } from 'react'

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

/** A physical-looking die. While `rolling` it flickers through faces, then settles. */
export default function Dice({
  value,
  rolling = false,
  size = 96,
  className = '',
}: {
  value: number | null
  rolling?: boolean
  size?: number
  /** The die is a fixed-width block, so centring is the caller's to ask for. */
  className?: string
}) {
  const [shown, setShown] = useState(value ?? 1)

  useEffect(() => {
    if (!rolling) {
      if (value) setShown(value)
      return
    }
    const timer = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 70)
    return () => clearInterval(timer)
  }, [rolling, value])

  const face = FACES[shown] ?? FACES[1]

  return (
    <div
      className={`grid shrink-0 grid-cols-3 grid-rows-3 rounded-2xl border-[3px] border-ink bg-cream shadow-[5px_5px_0_0_var(--color-ink)] ${
        rolling ? 'animate-tumble' : 'animate-pop-in'
      } ${className}`}
      // Padding and gap are derived from `size` rather than written as
      // percentages: a percentage padding resolves against the *parent's* width,
      // not the die's, so in a wide panel it swallowed the die and left the pips
      // at zero width — a blank rounded square.
      style={{ width: size, height: size, padding: size * 0.12, gap: size * 0.08 }}
      aria-label={`Die showing ${shown}`}
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
