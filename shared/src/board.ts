import type { BoardPreset } from './types.js'

/**
 * The board is a square ring with a home column running inward from the middle of
 * each side, and a shared home area in the centre.
 *
 * A square of side S has exactly 4S-4 perimeter cells, so picking an odd S gives a
 * ring size and a clean midpoint for free:
 *
 *   S = 5  ->  ring 16, home column 1   (quick)
 *   S = 7  ->  ring 24, home column 2   (standard)
 *
 * Everything else in this file is derived from S. To retune pacing after a
 * playtest, change SIDES below and nothing else.
 */
export const SIDES: Record<BoardPreset, number> = {
  quick: 5,
  standard: 7,
}

export const PIECES_PER_PLAYER = 2

export interface BoardConfig {
  preset: BoardPreset
  /** Side length of the square, in cells. Always odd. */
  side: number
  /** Number of cells in the perimeter loop. */
  ring: number
  /** Cells in each player's private home column. */
  homeColumn: number
  /** progress value that means "finished". */
  goal: number
  /** Distance between adjacent players' start squares. */
  armLength: number
}

export function boardConfig(preset: BoardPreset): BoardConfig {
  const side = SIDES[preset]
  const ring = 4 * side - 4
  // The column runs from just inside the edge to just before the centre cell.
  const homeColumn = (side - 1) / 2 - 1
  return {
    preset,
    side,
    ring,
    homeColumn,
    goal: ring + homeColumn,
    armLength: ring / 4,
  }
}

export interface Cell {
  row: number
  col: number
}

/**
 * The perimeter walked clockwise starting from the top-left corner. Generated
 * rather than hand-written so the four sides can never drift out of sync.
 */
export function ringCells(b: BoardConfig): Cell[] {
  const S = b.side
  const cells: Cell[] = []
  for (let col = 0; col < S; col++) cells.push({ row: 0, col })
  for (let row = 1; row < S; row++) cells.push({ row, col: S - 1 })
  for (let col = S - 2; col >= 0; col--) cells.push({ row: S - 1, col })
  for (let row = S - 2; row >= 1; row--) cells.push({ row, col: 0 })
  return cells
}

/** Ring index of a seat's start square: the midpoint of its own side. */
export function startIndex(seat: number, b: BoardConfig): number {
  return (b.side - 1) / 2 + seat * b.armLength
}

/**
 * Safe squares are the four start squares. Nothing can be captured there, so every
 * player always has one square they can sit on without risk.
 */
export function isSafeSquare(ringIndex: number, b: BoardConfig): boolean {
  const offset = (b.side - 1) / 2
  return (ringIndex - offset + b.ring) % b.armLength === 0
}

/** Absolute ring index of a piece, or null when it has left the ring. */
export function ringIndexOf(seat: number, progress: number, b: BoardConfig): number | null {
  if (progress < 0 || progress >= b.ring) return null
  return (startIndex(seat, b) + progress) % b.ring
}

/**
 * The home column cells for a seat, ordered outermost first, running inward from
 * the seat's start square toward the centre.
 */
export function homeColumnCells(seat: number, b: BoardConfig): Cell[] {
  const mid = (b.side - 1) / 2
  const last = b.side - 1
  const cells: Cell[] = []
  for (let step = 1; step <= b.homeColumn; step++) {
    switch (seat) {
      case 0:
        cells.push({ row: step, col: mid })
        break
      case 1:
        cells.push({ row: mid, col: last - step })
        break
      case 2:
        cells.push({ row: last - step, col: mid })
        break
      default:
        cells.push({ row: mid, col: step })
        break
    }
  }
  return cells
}

export function centreCell(b: BoardConfig): Cell {
  const mid = (b.side - 1) / 2
  return { row: mid, col: mid }
}

/** Grid cell for a piece at a given progress, for rendering. */
export function cellFor(seat: number, progress: number, b: BoardConfig): Cell {
  if (progress >= b.goal) return centreCell(b)
  if (progress >= b.ring) return homeColumnCells(seat, b)[progress - b.ring]
  return ringCells(b)[ringIndexOf(seat, progress, b)!]
}

export const SEAT_COLORS = ['#e11d48', '#0891b2', '#16a34a', '#d97706'] as const
export const SEAT_NAMES = ['Rose', 'Cyan', 'Green', 'Amber'] as const
export const TEAM_NAMES = ['Team A', 'Team B'] as const

/** In 2v2, seats 0 & 2 face seats 1 & 3. In FFA everyone is their own team. */
export function teamOf(seat: number, mode: 'ffa' | 'teams'): number {
  return mode === 'teams' ? seat % 2 : seat
}
