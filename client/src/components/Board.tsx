import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
import type { BoardPreset, GameState } from '@shared/types.js'

const key = (c: Cell) => `${c.row},${c.col}`

/** How long a piece spends on each square it passes through. */
const STEP_MS = 190

/**
 * The largest jump that counts as walking. A die roll moves at most six; anything
 * bigger is a capture sending a piece home from across the board, and marching it
 * backwards around the whole ring would be nonsense.
 */
const MAX_WALK = 6

/**
 * Pieces travel their move one square at a time instead of sliding straight from
 * origin to destination.
 *
 * Interpolating position was cheap but wrong: a six sent the pawn diagonally across
 * the middle of the board, through the walls, arriving without ever having been on
 * the track. Walking it is what makes a move look like a move — and it is the beat
 * the rest of the turn is paced against.
 */
function useWalkingPieces(game: GameState): Map<string, number> {
  const target = useMemo(() => {
    const m = new Map<string, number>()
    for (const player of game.players) {
      for (const piece of player.pieces) m.set(piece.id, piece.progress)
    }
    return m
  }, [game.players])

  const [shown, setShown] = useState(() => new Map(target))
  const shownRef = useRef(shown)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const next = new Map<string, number>()
      let walking = false
      let changed = false
      for (const [id, want] of target) {
        const have = shownRef.current.get(id)
        if (have === undefined || have === want) {
          if (have === undefined) changed = true
          next.set(id, want)
          continue
        }
        const delta = want - have
        next.set(id, Math.abs(delta) <= MAX_WALK ? have + Math.sign(delta) : want)
        walking = true
        changed = true
      }
      // The effect re-runs on every game broadcast even when no piece moved;
      // repainting the whole board for an identical position is the one render
      // worth skipping.
      if (changed) {
        shownRef.current = next
        setShown(next)
      }
      if (walking) timer = setTimeout(tick, STEP_MS)
    }

    tick()
    return () => clearTimeout(timer)
  }, [target])

  return shown
}

/**
 * Rotate a cell a quarter turn clockwise, `times` times, within a square grid.
 * Positions only — pawns and text are placed afterwards, so nothing ends up
 * upside down the way a CSS transform on the whole board would leave it.
 */
function rotateCell(cell: Cell, times: number, side: number): Cell {
  let { row, col } = cell
  for (let i = 0; i < times; i++) {
    const previousRow = row
    row = col
    col = side - 1 - previousRow
  }
  return { row, col }
}

function rotateRect(
  rect: { row: number; col: number; size: number },
  times: number,
  side: number,
): { row: number; col: number; size: number } {
  const a = rotateCell({ row: rect.row, col: rect.col }, times, side)
  const b = rotateCell(
    { row: rect.row + rect.size - 1, col: rect.col + rect.size - 1 },
    times,
    side,
  )
  return { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col), size: rect.size }
}

type Painted =
  | { kind: 'path'; row: number; col: number; start?: number; tip?: number }
  | { kind: 'home'; row: number; col: number; seat: number }

/**
 * Everything on the board that cannot move: corner yards, the track, the home
 * columns and the centre triangles. It depends only on the preset, the seat the
 * board is drawn from and the players' initials, so memoising it keeps the walk
 * animation and each turn's game broadcasts from re-rendering the layer underneath
 * the pieces.
 */
const BoardStatic = memo(function BoardStatic({
  preset,
  quarter,
  highlightSeat,
  initials,
}: {
  preset: BoardPreset
  quarter: number
  /** The viewer's seat, whose yard gets the amber ring; negative for nobody. */
  highlightSeat: number
  /** One name per seat, joined with '|', so memo compares strings not arrays. */
  initials: string
}) {
  const b = boardConfig(preset)
  const step = 100 / b.side
  const pct = (n: number) => `${n * step}%`
  const spin = (cell: Cell) => rotateCell(cell, quarter, b.side)
  const names = initials.split('|')

  const painted: Painted[] = []

  const startAt = new Map<number, number>()
  for (let seat = 0; seat < 4; seat++) startAt.set(startIndex(seat, b), seat)

  ringCells(b).forEach((cell, index) => {
    const { row, col } = spin(cell)
    painted.push({
      kind: 'path',
      row,
      col,
      start: startAt.get(index),
      tip: tipOwner(index, b) ?? undefined,
    })
  })

  for (let seat = 0; seat < 4; seat++) {
    for (const cell of homeColumnCells(seat, b)) {
      const { row, col } = spin(cell)
      painted.push({ kind: 'home', row, col, seat })
    }
  }

  const centre = rotateRect(centreBlock(b), quarter, b.side)

  return (
    <>
      {/* Corner yards */}
      {[0, 1, 2, 3].map((seat) => {
        const rect = rotateRect(yardRect(seat, b), quarter, b.side)
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
              className={`grid h-full w-full place-items-center rounded-lg border-[3px] border-ink ${
                seat === highlightSeat ? 'ring-4 ring-amber-300' : ''
              }`}
              style={{ backgroundColor: SEAT_COLORS[seat] }}
            >
              <div className="grid h-[62%] w-[62%] place-items-center rounded-md bg-white/85">
                <span
                  className="text-[0.7rem] font-bold leading-none"
                  style={{ color: SEAT_COLORS[seat] }}
                >
                  {(names[seat] ?? '').slice(0, 1).toUpperCase() || '·'}
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
        <HomeTriangles quarter={quarter} />
      </div>
    </>
  )
})

/**
 * A cross-shaped Ludo board: four corner yards, a track running around the arms,
 * each player's colour running up the middle of their arm, and the four home
 * triangles meeting in the centre.
 *
 * Cells are laid out on a percentage grid and pieces are absolutely positioned on
 * top, so a move animates by transitioning left/top rather than jumping between
 * DOM parents.
 */
export default memo(function Board({
  game,
  viewSeat = 0,
  choices = [],
  onPick,
}: {
  game: GameState
  /** Whose point of view. That seat is always drawn in the bottom-left corner. */
  viewSeat?: number
  choices?: string[]
  onPick?: (pieceId: string) => void
}) {
  const b = boardConfig(game.preset)
  const step = 100 / b.side
  const pct = (n: number) => `${n * step}%`
  const walking = useWalkingPieces(game)

  // Yards run clockwise from the top-right: seat 0, 1, 2, 3. Bottom-left is the
  // third of those, so turn the board until the viewer's seat lands there.
  const quarter = (2 - (viewSeat < 0 ? 0 : viewSeat) + 4) % 4
  const spin = (cell: Cell) => rotateCell(cell, quarter, b.side)

  const tokens = game.players.flatMap((p) =>
    p.pieces.map((piece) => {
      const at = walking.get(piece.id) ?? piece.progress
      return {
        piece,
        seat: p.seat,
        cell: spin(cellFor(p.seat, at, b)),
        moving: at !== piece.progress,
      }
    }),
  )

  // Group pieces by cell so a stack fans out instead of hiding behind itself.
  const stacks = new Map<string, number>()
  const placed = tokens.map((t) => {
    const k = key(t.cell)
    const index = stacks.get(k) ?? 0
    stacks.set(k, index + 1)
    return { ...t, index }
  })

  return (
    <div className="panel relative aspect-square w-full select-none p-2.5">
      {/* No overflow-hidden: pawns are drawn standing slightly above their square,
          so the top row would otherwise be clipped by the board edge. */}
      <div className="relative h-full w-full rounded-lg bg-[#f2ede0]">
        <BoardStatic
          preset={game.preset}
          quarter={quarter}
          highlightSeat={viewSeat}
          initials={game.players.map((p) => p.name).join('|')}
        />

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
              // The position transition is tuned to the walk: any slower and each
              // square blurs into the next instead of reading as a step.
              className={`absolute transition-all duration-200 ease-linear ${
                t.moving
                  ? 'z-40'
                  : pickable
                    ? 'z-30 animate-bob cursor-pointer scale-125 hover:scale-140'
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
              {/* The hop lives on an inner wrapper: the button's own transform is
                  already spoken for by the bob, throb and pick-me scale. */}
              <span className={`block h-full w-full ${t.moving ? 'animate-step-hop' : ''}`}>
                <Pawn color={SEAT_COLORS[t.seat]} highlighted={pickable} />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})

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

/**
 * Unrotated, seat 0 arrives from the top, 1 from the right, 2 from the bottom and
 * 3 from the left. Turning the board moves which seat feeds which wedge.
 */
function HomeTriangles({ quarter }: { quarter: number }) {
  const seatAt = (side: number) => (side - quarter + 4) % 4
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <polygon points="0,0 100,0 50,50" fill={SEAT_COLORS[seatAt(0)]} />
      <polygon points="100,0 100,100 50,50" fill={SEAT_COLORS[seatAt(1)]} />
      <polygon points="100,100 0,100 50,50" fill={SEAT_COLORS[seatAt(2)]} />
      <polygon points="0,100 0,0 50,50" fill={SEAT_COLORS[seatAt(3)]} />
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
      {/* A pickable piece has to read instantly against a busy board: a solid amber
          disc, a hard ring, and a pulse — not a faint tint. */}
      {highlighted && (
        <>
          <circle cx="16" cy="25" r="22" fill="#fbbf24" opacity="0.55">
            <animate
              attributeName="opacity"
              values="0.55;0.15;0.55"
              dur="0.9s"
              repeatCount="indefinite"
            />
            <animate attributeName="r" values="20;25;20" dur="0.9s" repeatCount="indefinite" />
          </circle>
          <circle cx="16" cy="25" r="19" fill="#fde68a" opacity="0.9" />
          <circle
            cx="16"
            cy="25"
            r="19"
            fill="none"
            stroke="#16123a"
            strokeWidth="2.5"
            strokeDasharray="5 3"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 16 25"
              to="360 16 25"
              dur="4s"
              repeatCount="indefinite"
            />
          </circle>
        </>
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
