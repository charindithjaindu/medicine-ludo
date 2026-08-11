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
}: {
  value: number | null
  rolling?: boolean
  size?: number
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
      className={`grid shrink-0 grid-cols-3 grid-rows-3 gap-[8%] rounded-2xl border-[3px] border-ink bg-cream p-[12%] shadow-[5px_5px_0_0_var(--color-ink)] ${
        rolling ? 'animate-tumble' : 'animate-pop-in'
      }`}
      style={{ width: size, height: size }}
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
