import {
  boardConfig,
  cellFor,
  centreBlock,
  homeColumnCells,
  isSafeSquare,
  ringCells,
  SEAT_COLORS,
  startIndex,
  tipOwner,
  yardRect,
  type BoardConfig,
  type Cell,
} from '@shared/board.js'
import type { GameState } from '@shared/types.js'

const key = (c: Cell) => `${c.row},${c.col}`

type Painted =
  | { kind: 'path'; row: number; col: number; start?: number; tip?: number }
  | { kind: 'home'; row: number; col: number; seat: number }

/**
 * A cross-shaped Ludo board: four corner yards, a track running around the arms,
 * each player's colour running up the middle of their arm, and the four home
 * triangles meeting in the centre.
 *
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
  const pct = (n: number) => `${n * step}%`

  const painted: Painted[] = []

  const startAt = new Map<number, number>()
  for (let seat = 0; seat < 4; seat++) startAt.set(startIndex(seat, b), seat)

  ringCells(b).forEach((cell, index) => {
    painted.push({
      kind: 'path',
      row: cell.row,
      col: cell.col,
      start: startAt.get(index),
      tip: tipOwner(index, b) ?? undefined,
    })
  })

  for (let seat = 0; seat < 4; seat++) {
    for (const cell of homeColumnCells(seat, b)) {
      painted.push({ kind: 'home', row: cell.row, col: cell.col, seat })
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

  const centre = centreBlock(b)

  return (
    <div className="panel relative aspect-square w-full select-none p-2.5">
      {/* No overflow-hidden: pawns are drawn standing slightly above their square,
          so the top row would otherwise be clipped by the board edge. */}
      <div className="relative h-full w-full rounded-lg bg-[#f2ede0]">
        {/* Corner yards */}
        {[0, 1, 2, 3].map((seat) => {
          const rect = yardRect(seat, b)
          return (
            <div
              key={`yard-${seat}`}
              className="absolute p-[1.5%]"
              style={{
                left: pct(rect.col),
                top: pct(rect.row),
                width: pct(rect.size),
                height: pct(rect.size),
              }}
            >
              <div
                className="grid h-full w-full place-items-center rounded-lg border-[3px] border-ink"
                style={{ backgroundColor: SEAT_COLORS[seat] }}
              >
                <div className="grid h-[62%] w-[62%] place-items-center rounded-md bg-white/85">
                  <span
                    className="text-[0.7rem] font-bold leading-none"
                    style={{ color: SEAT_COLORS[seat] }}
                  >
                    {(game.players[seat]?.name ?? '').slice(0, 1).toUpperCase() || '·'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}

        {/* Track and home columns */}
        {painted.map((cell) => (
          <div
            key={`${cell.kind}-${cell.row},${cell.col}`}
            className="absolute p-[0.35%]"
            style={{ left: pct(cell.col), top: pct(cell.row), width: pct(1), height: pct(1) }}
          >
            <CellFace cell={cell} />
          </div>
        ))}

        {/* The four home triangles at the middle of the cross */}
        <div
          className="absolute p-[0.4%]"
          style={{
            left: pct(centre.col),
            top: pct(centre.row),
            width: pct(centre.size),
            height: pct(centre.size),
          }}
        >
          <HomeTriangles />
        </div>

        {/* Pieces */}
        {placed.map((t) => {
          const n = stacks.get(key(t.cell)) ?? 1
          const spread = n > 1 ? (t.index - (n - 1) / 2) * (step * 0.32) : 0
          const pickable = choices.includes(t.piece.id)
          const isActive = t.seat === game.turnSeat
          return (
            <button
              key={t.piece.id}
              disabled={!pickable}
              onClick={() => onPick?.(t.piece.id)}
              aria-label={`${game.players[t.seat]?.name ?? 'Player'} piece`}
              className={`absolute transition-all duration-500 ease-out ${
                pickable
                  ? 'z-30 cursor-pointer hover:scale-115'
                  : isActive
                    ? 'z-20 animate-throb'
                    : 'z-10 cursor-default'
              }`}
              style={{
                left: `calc(${pct(t.cell.col)} + ${spread}% + ${step * 0.1}%)`,
                top: `${t.cell.row * step - step * 0.22}%`,
                width: `${step * 0.8}%`,
                height: `${step * 1.15}%`,
              }}
            >
              <Pawn color={SEAT_COLORS[t.seat]} highlighted={pickable} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CellFace({ cell }: { cell: Painted }) {
  if (cell.kind === 'home') {
    return (
      <div
        className="h-full w-full border-[1.5px] border-ink/45"
        style={{ backgroundColor: SEAT_COLORS[cell.seat] }}
      />
    )
  }

  // A start square is where a player's pieces begin and is safe from capture.
  if (cell.start !== undefined) {
    return (
      <div
        className="grid h-full w-full place-items-center border-[1.5px] border-ink/60"
        style={{ backgroundColor: SEAT_COLORS[cell.start] }}
      >
        <span className="text-[0.6rem] leading-none text-white/90">★</span>
      </div>
    )
  }

  // The tip square is where that player turns inward, so tint it faintly.
  if (cell.tip !== undefined) {
    return (
      <div
        className="h-full w-full border-[1.5px] border-ink/30"
        style={{ backgroundColor: SEAT_COLORS[cell.tip], opacity: 0.3 }}
      />
    )
  }

  return <div className="h-full w-full border-[1.5px] border-ink/30 bg-white" />
}

/** Seat 0 arrives from the top, 1 from the right, 2 from the bottom, 3 from the left. */
function HomeTriangles() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <polygon points="0,0 100,0 50,50" fill={SEAT_COLORS[0]} />
      <polygon points="100,0 100,100 50,50" fill={SEAT_COLORS[1]} />
      <polygon points="100,100 0,100 50,50" fill={SEAT_COLORS[2]} />
      <polygon points="0,100 0,0 50,50" fill={SEAT_COLORS[3]} />
      <rect
        x="1"
        y="1"
        width="98"
        height="98"
        fill="none"
        stroke="#16123a"
        strokeWidth="3"
        rx="3"
      />
    </svg>
  )
}

/** A Ludo token: round base, tapered body, domed head. */
function Pawn({ color, highlighted }: { color: string; highlighted: boolean }) {
  return (
    <svg viewBox="0 0 32 44" className="h-full w-full overflow-visible">
      {highlighted && (
        <circle cx="16" cy="24" r="19" fill="#fbbf24" opacity="0.45">
          <animate attributeName="r" values="16;21;16" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Contact shadow on the square below */}
      <ellipse cx="16" cy="39.5" rx="11" ry="3.4" fill="#16123a" opacity="0.28" />
      {/* Base */}
      <ellipse
        cx="16"
        cy="35"
        rx="11"
        ry="4.6"
        fill={color}
        stroke="#16123a"
        strokeWidth="2.2"
      />
      {/* Body */}
      <path
        d="M10.4 34.4 C10.4 26.5 13.6 24 14.2 19.5 L17.8 19.5 C18.4 24 21.6 26.5 21.6 34.4 Z"
        fill={color}
        stroke="#16123a"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      {/* Head */}
      <circle cx="16" cy="13.5" r="7.6" fill={color} stroke="#16123a" strokeWidth="2.2" />
      {/* Specular highlight */}
      <ellipse cx="13.2" cy="10.8" rx="2.4" ry="1.8" fill="#fff" opacity="0.5" />
    </svg>
  )
}
