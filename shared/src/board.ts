import type { BoardPreset } from './types.js'

/**
 * A proper cross-shaped Ludo board.
 *
 * The classic board is a plus sign three cells wide. Its track runs up one side of
 * an arm, across the tip, and back down the other side — 6 + 1 + 6 = 13 squares per
 * arm, 52 in total. That generalises: for an arm of length L,
 *
 *     grid        = 2L + 3          (arms 3 wide, plus an L-cell yard each side)
 *     track       = 4 × (2L + 1)
 *     home column = L - 1           (the middle of each arm, running to the centre)
 *
 * L = 6 gives the real 52-square board, which would take hours with two pieces
 * each. These presets keep the exact shape and shorten the arms.
 */
export const ARM_LENGTHS: Record<BoardPreset, number> = {
  quick: 2,
  standard: 3,
}

export const PIECES_PER_PLAYER = 2

export interface BoardConfig {
  preset: BoardPreset
  /** Cells along one side of an arm. */
  armLength: number
  /** Width and height of the square grid. */
  side: number
  /** Cells in the track loop. */
  ring: number
  /** Cells in each player's private run to the centre. */
  homeColumn: number
  /** progress value meaning "finished". */
  goal: number
  /** Squares of one corner yard, which is armLength on a side. */
  yard: number
}

export function boardConfig(preset: BoardPreset): BoardConfig {
  const armLength = ARM_LENGTHS[preset]
  const ring = 4 * (2 * armLength + 1)
  const homeColumn = armLength - 1
  return {
    preset,
    armLength,
    side: 2 * armLength + 3,
    ring,
    homeColumn,
    goal: ring + homeColumn,
    yard: armLength,
  }
}

export interface Cell {
  row: number
  col: number
}

/** Cells per arm: up one side, across the tip, back down the other. */
const perArm = (b: BoardConfig) => 2 * b.armLength + 1

/**
 * The track, clockwise. Generated rather than hand-written so the four arms can
 * never drift out of sync.
 */
export function ringCells(b: BoardConfig): Cell[] {
  const L = b.armLength
  const far = b.side - 1
  const cells: Cell[] = []

  // Top arm
  for (let row = L - 1; row >= 0; row--) cells.push({ row, col: L })
  cells.push({ row: 0, col: L + 1 })
  for (let row = 0; row <= L - 1; row++) cells.push({ row, col: L + 2 })

  // Right arm
  for (let col = L + 3; col <= far; col++) cells.push({ row: L, col })
  cells.push({ row: L + 1, col: far })
  for (let col = far; col >= L + 3; col--) cells.push({ row: L + 2, col })

  // Bottom arm
  for (let row = L + 3; row <= far; row++) cells.push({ row, col: L + 2 })
  cells.push({ row: far, col: L + 1 })
  for (let row = far; row >= L + 3; row--) cells.push({ row, col: L })

  // Left arm
  for (let col = L - 1; col >= 0; col--) cells.push({ row: L + 2, col })
  cells.push({ row: L + 1, col: 0 })
  for (let col = 0; col <= L - 1; col++) cells.push({ row: L, col })

  return cells
}

/**
 * Ring index of a seat's start square.
 *
 * Placed one past its arm's tip, so that after a full lap the square a piece
 * leaves the track from *is* that tip — and the home column then runs straight on
 * inward from it, exactly as on a real board.
 */
export function startIndex(seat: number, b: BoardConfig): number {
  return b.armLength + 1 + seat * perArm(b)
}

/** The tip a seat turns inward at, which is the square before its own start. */
function tipIndex(seat: number, b: BoardConfig): number {
  return b.armLength + seat * perArm(b)
}

/** Safe squares are the four start squares — one guaranteed rest stop each. */
export function isSafeSquare(ringIndex: number, b: BoardConfig): boolean {
  return (ringIndex - (b.armLength + 1) + b.ring) % perArm(b) === 0
}

/** Absolute ring index of a piece, or null once it has left the track. */
export function ringIndexOf(seat: number, progress: number, b: BoardConfig): number | null {
  if (progress < 0 || progress >= b.ring) return null
  return (startIndex(seat, b) + progress) % b.ring
}

/** A seat's home column, outermost first, running inward from its arm's tip. */
export function homeColumnCells(seat: number, b: BoardConfig): Cell[] {
  const L = b.armLength
  const far = b.side - 1
  const mid = L + 1
  const cells: Cell[] = []
  for (let step = 1; step <= b.homeColumn; step++) {
    switch (seat) {
      case 0:
        cells.push({ row: step, col: mid })
        break
      case 1:
        cells.push({ row: mid, col: far - step })
        break
      case 2:
        cells.push({ row: far - step, col: mid })
        break
      default:
        cells.push({ row: mid, col: step })
        break
    }
  }
  return cells
}

export function centreCell(b: BoardConfig): Cell {
  const mid = b.armLength + 1
  return { row: mid, col: mid }
}

/** The 3x3 block at the middle of the cross, which holds the four home triangles. */
export function centreBlock(b: BoardConfig): { row: number; col: number; size: number } {
  return { row: b.armLength, col: b.armLength, size: 3 }
}

/**
 * A seat's corner yard. Empty in this game — pieces start on the board rather than
 * waiting for a 6 — but it is what makes the board read as Ludo, and it gives each
 * player somewhere on the board that is visibly theirs.
 */
export function yardRect(seat: number, b: BoardConfig): { row: number; col: number; size: number } {
  const L = b.armLength
  const near = 0
  const farStart = L + 3
  switch (seat) {
    case 0:
      return { row: near, col: farStart, size: L } // top-right
    case 1:
      return { row: farStart, col: farStart, size: L } // bottom-right
    case 2:
      return { row: farStart, col: near, size: L } // bottom-left
    default:
      return { row: near, col: near, size: L } // top-left
  }
}

/** Grid cell for a piece at a given progress, for rendering. */
export function cellFor(seat: number, progress: number, b: BoardConfig): Cell {
  if (progress >= b.goal) return centreCell(b)
  if (progress >= b.ring) return homeColumnCells(seat, b)[progress - b.ring]
  return ringCells(b)[ringIndexOf(seat, progress, b)!]
}

/** Which seat's arm a tip belongs to, or null. Used to colour the tip squares. */
export function tipOwner(ringIndex: number, b: BoardConfig): number | null {
  for (let seat = 0; seat < 4; seat++) {
    if (tipIndex(seat, b) === ringIndex) return seat
  }
  return null
}

export const SEAT_COLORS = ['#e11d48', '#0891b2', '#16a34a', '#f59e0b'] as const
export const SEAT_NAMES = ['Red', 'Cyan', 'Green', 'Amber'] as const
export const TEAM_NAMES = ['Team A', 'Team B'] as const

/** In 2v2, seats 0 & 2 face seats 1 & 3. In FFA everyone is their own team. */
export function teamOf(seat: number, mode: 'ffa' | 'teams'): number {
  return mode === 'teams' ? seat % 2 : seat
}
