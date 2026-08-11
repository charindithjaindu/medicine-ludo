import {
  boardConfig,
  cellFor,
  centreCell,
  homeColumnCells,
  isSafeSquare,
  ringCells,
  SEAT_COLORS,
  startIndex,
  type Cell,
} from '@shared/board.js'
import type { GameState } from '@shared/types.js'

type CellKind = 'ring' | 'home' | 'centre' | 'void'

interface Painted {
  row: number
  col: number
  kind: CellKind
  seat?: number
  isStart?: boolean
}

const key = (c: Cell) => `${c.row},${c.col}`

/**
 * A square ring with a home column running inward from the middle of each side.
 * Cells are laid out on a percentage grid and pieces are absolutely positioned on
 * top, so a move animates by transitioning left/top rather than jumping between
 * DOM parents.
 */
export default function Board({
  game,
  choices = [],
  onPick,
}: {
  game: GameState
  choices?: string[]
  onPick?: (pieceId: string) => void
}) {
  const b = boardConfig(game.preset)
  const step = 100 / b.side

  const ring = ringCells(b)
  const ringAt = new Map<string, number>()
  ring.forEach((c, i) => ringAt.set(key(c), i))

  const homeAt = new Map<string, number>()
  for (let seat = 0; seat < 4; seat++) {
    for (const c of homeColumnCells(seat, b)) homeAt.set(key(c), seat)
  }

  const centre = centreCell(b)
  const startOwner = new Map<number, number>()
  for (let seat = 0; seat < 4; seat++) startOwner.set(startIndex(seat, b), seat)

  const painted: Painted[] = []
  for (let row = 0; row < b.side; row++) {
    for (let col = 0; col < b.side; col++) {
      const k = `${row},${col}`
      if (ringAt.has(k)) {
        const idx = ringAt.get(k)!
        painted.push({
          row,
          col,
          kind: 'ring',
          seat: startOwner.get(idx),
          isStart: isSafeSquare(idx, b),
        })
      } else if (homeAt.has(k)) {
        painted.push({ row, col, kind: 'home', seat: homeAt.get(k) })
      } else if (row === centre.row && col === centre.col) {
        painted.push({ row, col, kind: 'centre' })
      } else {
        painted.push({ row, col, kind: 'void' })
      }
    }
  }

  // Group pieces by cell so a stack fans out instead of hiding behind itself.
  const tokens = game.players.flatMap((p) =>
    p.pieces.map((piece) => ({ piece, seat: p.seat, cell: cellFor(p.seat, piece.progress, b) })),
  )
  const stacks = new Map<string, number>()
  const placed = tokens.map((t) => {
    const k = key(t.cell)
    const index = stacks.get(k) ?? 0
    stacks.set(k, index + 1)
    return { ...t, index }
  })

  return (
    <div className="panel relative aspect-square w-full select-none p-3">
      <div className="relative h-full w-full">
        {painted.map((c) => (
          <div
            key={`${c.row},${c.col}`}
            className="absolute p-[2.5px]"
            style={{
              left: `${c.col * step}%`,
              top: `${c.row * step}%`,
              width: `${step}%`,
              height: `${step}%`,
            }}
          >
            <CellFace cell={c} />
          </div>
        ))}

        {placed.map((t) => {
          const n = stacks.get(key(t.cell)) ?? 1
          const spread = n > 1 ? (t.index - (n - 1) / 2) * (step * 0.3) : 0
          const pickable = choices.includes(t.piece.id)
          const isActive = t.seat === game.turnSeat
          const home = t.piece.progress >= b.goal
          return (
            <button
              key={t.piece.id}
              disabled={!pickable}
              onClick={() => onPick?.(t.piece.id)}
              aria-label={`${game.players[t.seat]?.name ?? 'Player'} piece`}
              className={`absolute grid place-items-center rounded-full border-[3px] border-ink text-[0.7rem] font-bold text-white transition-all duration-500 ease-out ${
                pickable
                  ? 'z-30 animate-glow-ring cursor-pointer hover:scale-125'
                  : isActive
                    ? 'z-20 animate-throb'
                    : 'z-10 cursor-default'
              }`}
              style={{
                left: `calc(${t.cell.col * step}% + ${spread}% + ${step * 0.16}%)`,
                top: `${t.cell.row * step + step * 0.16}%`,
                width: `${step * 0.68}%`,
                height: `${step * 0.68}%`,
                backgroundColor: SEAT_COLORS[t.seat],
                boxShadow: '0 3px 0 0 rgba(22,18,58,0.45)',
              }}
            >
              {home ? '★' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CellFace({ cell }: { cell: Painted }) {
  if (cell.kind === 'void') return null

  if (cell.kind === 'centre') {
    return (
      <div className="grid h-full w-full place-items-center rounded-lg border-[3px] border-ink bg-ink text-lg">
        🏆
      </div>
    )
  }

  if (cell.kind === 'home') {
    return (
      <div
        className="h-full w-full rounded-lg border-2 border-ink/25"
        style={{ backgroundColor: SEAT_COLORS[cell.seat!], opacity: 0.35 }}
      />
    )
  }

  // Start squares double as the safe squares, tinted with their owner's colour.
  if (cell.isStart) {
    return (
      <div
        className="grid h-full w-full place-items-center rounded-lg border-[3px] border-ink text-xs text-white"
        style={{ backgroundColor: SEAT_COLORS[cell.seat ?? 0] }}
      >
        ★
      </div>
    )
  }

  return <div className="h-full w-full rounded-lg border-2 border-ink/15 bg-white" />
}
