import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  angle: number
  color: string
  life: number
}

const COLORS = ['#f43f5e', '#06b6d4', '#22c55e', '#f59e0b', '#a855f7', '#fde68a']

/**
 * A canvas confetti burst. Fires whenever `burstKey` changes, so a parent can
 * re-trigger it by bumping a counter. Sits on top of everything and ignores
 * pointer events.
 */
export default function Confetti({
  burstKey,
  intensity = 'burst',
}: {
  burstKey: number
  intensity?: 'burst' | 'shower'
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const frame = useRef<number>(0)

  useEffect(() => {
    if (burstKey === 0) return
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
    }
    resize()

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const count = intensity === 'shower' ? 160 : 70
    const w = window.innerWidth
    for (let i = 0; i < count; i++) {
      particles.current.push(
        intensity === 'shower'
          ? {
              x: Math.random() * w,
              y: -20 - Math.random() * 200,
              vx: (Math.random() - 0.5) * 1.6,
              vy: 2 + Math.random() * 3,
              size: 6 + Math.random() * 8,
              spin: (Math.random() - 0.5) * 0.3,
              angle: Math.random() * Math.PI,
              color: COLORS[i % COLORS.length],
              life: 1,
            }
          : {
              x: w / 2 + (Math.random() - 0.5) * 120,
              y: window.innerHeight * 0.42,
              vx: (Math.random() - 0.5) * 13,
              vy: -6 - Math.random() * 9,
              size: 6 + Math.random() * 7,
              spin: (Math.random() - 0.5) * 0.4,
              angle: Math.random() * Math.PI,
              color: COLORS[i % COLORS.length],
              life: 1,
            },
      )
    }

    const tick = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

      particles.current = particles.current.filter((p) => p.life > 0 && p.y < window.innerHeight + 60)
      for (const p of particles.current) {
        p.vy += 0.28 // gravity
        p.vx *= 0.995
        p.x += p.vx
        p.y += p.vy
        p.angle += p.spin
        p.life -= 0.006

        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life))
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      }

      if (particles.current.length > 0) {
        frame.current = requestAnimationFrame(tick)
      }
    }

    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(tick)

    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(frame.current)
      window.removeEventListener('resize', resize)
    }
  }, [burstKey, intensity])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
      aria-hidden
    />
  )
}
