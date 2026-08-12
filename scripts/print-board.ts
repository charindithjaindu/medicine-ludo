/**
 * Print artwork for a physical Medicine Ludo board.
 *
 *   npm run print:board
 *
 * The geometry comes from shared/src/board.ts — the same module the digital game
 * renders from — so the printed board is guaranteed to match the one on screen
 * rather than being a hand-drawn approximation that quietly drifts.
 *
 * Everything is laid out in millimetres, so printing at 100% (no "fit to page")
 * gives cells of exactly the stated size.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boardConfig,
  centreCell,
  homeColumnCells,
  isSafeSquare,
  ringCells,
  SEAT_COLORS,
  SEAT_NAMES,
  startIndex,
  tipOwner,
  yardRect,
  type BoardConfig,
  type Cell,
} from '../shared/src/board.js'
import { ANSWER_SECONDS, TIER_NAMES, TIER_POINTS, TIERS } from '../shared/src/types.js'
import type { BoardPreset } from '../shared/src/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(here, '..', 'print')

interface Page {
  name: string
  width: number
  height: number
  margin: number
}

const A4: Page = { name: 'A4', width: 210, height: 297, margin: 14 }
const A3: Page = { name: 'A3', width: 297, height: 420, margin: 18 }

const INK = '#16123a'
const CREAM = '#fffdf5'

const n = (v: number) => Number(v.toFixed(2))

/** A five-pointed star, drawn as a path so it does not depend on font glyphs. */
function star(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.42
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    points.push(`${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`)
  }
  return points.join(' ')
}

/** A chevron pointing along (dx, dy), used to show the direction of travel. */
function chevron(cx: number, cy: number, size: number, dx: number, dy: number): string {
  const angle = Math.atan2(dy, dx)
  const pt = (dist: number, side: number) => {
    const a = angle + side
    return `${n(cx + dist * Math.cos(a))},${n(cy + dist * Math.sin(a))}`
  }
  return `${pt(size, 0)} ${pt(size, 2.4)} ${pt(size * 0.35, Math.PI)} ${pt(size, -2.4)}`
}

function boardArtwork(b: BoardConfig, cell: number, ox: number, oy: number): string {
  const parts: string[] = []
  const x = (col: number) => ox + col * cell
  const y = (row: number) => oy + row * cell
  const mid = cell / 2

  // -- corner yards ---------------------------------------------------------
  for (let seat = 0; seat < 4; seat++) {
    const r = yardRect(seat, b)
    const size = r.size * cell
    const px = x(r.col)
    const py = y(r.row)
    parts.push(
      `<rect x="${n(px)}" y="${n(py)}" width="${n(size)}" height="${n(size)}" rx="${n(cell * 0.18)}"
         fill="${SEAT_COLORS[seat]}" stroke="${INK}" stroke-width="0.9"/>`,
      `<rect x="${n(px + size * 0.17)}" y="${n(py + size * 0.17)}" width="${n(size * 0.66)}"
         height="${n(size * 0.66)}" rx="${n(cell * 0.12)}" fill="${CREAM}" stroke="${INK}" stroke-width="0.6"/>`,
    )
    // Two resting circles: one per piece, for parking them before the game starts.
    // Sized against the yard rather than the cell — the quick board has a smaller
    // yard but larger cells, and cell-sized circles collided there.
    for (let i = 0; i < 2; i++) {
      const cx = px + size * (i === 0 ? 0.36 : 0.64)
      parts.push(
        `<circle cx="${n(cx)}" cy="${n(py + size * 0.42)}" r="${n(size * 0.105)}"
           fill="none" stroke="${SEAT_COLORS[seat]}" stroke-width="0.8" stroke-dasharray="1.6 1.2"/>`,
      )
    }
    parts.push(
      `<text x="${n(px + size / 2)}" y="${n(py + size * 0.76)}" text-anchor="middle"
         font-family="Helvetica,Arial,sans-serif" font-size="${n(cell * 0.3)}" font-weight="bold"
         fill="${SEAT_COLORS[seat]}">${SEAT_NAMES[seat].toUpperCase()}</text>`,
    )
  }

  // -- track ---------------------------------------------------------------
  const cells = ringCells(b)
  const startOwner = new Map<number, number>()
  for (let seat = 0; seat < 4; seat++) startOwner.set(startIndex(seat, b), seat)

  cells.forEach((c: Cell, index) => {
    const px = x(c.col)
    const py = y(c.row)
    const owner = startOwner.get(index)
    const tip = tipOwner(index, b)

    let fill = '#ffffff'
    if (owner !== undefined) fill = SEAT_COLORS[owner]
    parts.push(
      `<rect x="${n(px)}" y="${n(py)}" width="${n(cell)}" height="${n(cell)}"
         fill="${fill}" stroke="${INK}" stroke-width="0.7"/>`,
    )

    // A tip is where that colour turns inward for home; tint it faintly.
    if (tip !== null && owner === undefined) {
      parts.push(
        `<rect x="${n(px)}" y="${n(py)}" width="${n(cell)}" height="${n(cell)}"
           fill="${SEAT_COLORS[tip]}" fill-opacity="0.28" stroke="${INK}" stroke-width="0.7"/>`,
      )
    }

    // Start squares are the safe squares.
    if (owner !== undefined && isSafeSquare(index, b)) {
      parts.push(
        `<polygon points="${star(px + mid, py + mid * 0.92, cell * 0.3)}" fill="#ffffff" fill-opacity="0.95"/>`,
        `<text x="${n(px + mid)}" y="${n(py + cell * 0.88)}" text-anchor="middle"
           font-family="Helvetica,Arial,sans-serif" font-size="${n(cell * 0.17)}" font-weight="bold"
           fill="#ffffff">START</text>`,
      )
      return
    }

    // Nobody enforces the route on paper, and the track turns each corner
    // diagonally, so every square says which way it flows.
    if (tip !== null) {
      // A tip is a fork: carry on round, or — if it is your colour — turn inward.
      const first = homeColumnCells(tip, b)[0]
      parts.push(
        `<polygon points="${chevron(px + mid, py + mid, cell * 0.3, first.col - c.col, first.row - c.row)}"
           fill="${SEAT_COLORS[tip]}"/>`,
      )
    } else {
      const next = cells[(index + 1) % b.ring]
      parts.push(
        `<polygon points="${chevron(px + mid, py + mid, cell * 0.26, next.col - c.col, next.row - c.row)}"
           fill="${INK}" fill-opacity="0.3"/>`,
      )
    }
  })

  // -- home columns ---------------------------------------------------------
  for (let seat = 0; seat < 4; seat++) {
    const column = homeColumnCells(seat, b)
    column.forEach((c, i) => {
      parts.push(
        `<rect x="${n(x(c.col))}" y="${n(y(c.row))}" width="${n(cell)}" height="${n(cell)}"
           fill="${SEAT_COLORS[seat]}" stroke="${INK}" stroke-width="0.7"/>`,
      )
      // Keep pointing inward; the last cell aims at the centre block.
      const next = column[i + 1] ?? centreCell(b)
      parts.push(
        `<polygon points="${chevron(x(c.col) + mid, y(c.row) + mid, cell * 0.26, next.col - c.col, next.row - c.row)}"
           fill="#ffffff" fill-opacity="0.75"/>`,
      )
    })
  }

  // -- centre: four home triangles -----------------------------------------
  const c0 = b.armLength
  const cx = x(c0)
  const cy = y(c0)
  const size = 3 * cell
  const mx = cx + size / 2
  const my = cy + size / 2
  const wedges: Array<[number, string]> = [
    [0, `${n(cx)},${n(cy)} ${n(cx + size)},${n(cy)} ${n(mx)},${n(my)}`],
    [1, `${n(cx + size)},${n(cy)} ${n(cx + size)},${n(cy + size)} ${n(mx)},${n(my)}`],
    [2, `${n(cx + size)},${n(cy + size)} ${n(cx)},${n(cy + size)} ${n(mx)},${n(my)}`],
    [3, `${n(cx)},${n(cy + size)} ${n(cx)},${n(cy)} ${n(mx)},${n(my)}`],
  ]
  for (const [seat, points] of wedges) {
    parts.push(`<polygon points="${points}" fill="${SEAT_COLORS[seat]}" stroke="${INK}" stroke-width="0.7"/>`)
  }
  // A plain white plate behind the word, rather than relying on stroke paint-order.
  parts.push(
    `<rect x="${n(mx - cell * 0.85)}" y="${n(my - cell * 0.3)}" width="${n(cell * 1.7)}"
       height="${n(cell * 0.6)}" rx="${n(cell * 0.14)}" fill="#ffffff" stroke="${INK}" stroke-width="0.8"/>`,
    `<text x="${n(mx)}" y="${n(my + cell * 0.13)}" text-anchor="middle"
       font-family="Helvetica,Arial,sans-serif" font-size="${n(cell * 0.32)}" font-weight="bold"
       fill="${INK}">HOME</text>`,
  )

  // Board outline last, so it sits above every edge.
  parts.push(
    `<rect x="${n(ox)}" y="${n(oy)}" width="${n(b.side * cell)}" height="${n(b.side * cell)}"
       fill="none" stroke="${INK}" stroke-width="1.6"/>`,
  )
  return parts.join('\n')
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Greedy word wrap. Helvetica averages a shade under half the font size per
 * character for mixed-case text, which is close enough to keep lines inside the
 * margin without measuring glyphs.
 */
function wrap(text: string, widthMm: number, fontSize: number): string[] {
  const perChar = fontSize * 0.5
  const max = Math.floor(widthMm / perChar)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

function legend(b: BoardConfig, page: Page, top: number, cell: number): string {
  const left = page.margin
  const width = page.width - page.margin * 2
  const parts: string[] = []

  parts.push(
    `<text x="${n(left)}" y="${n(top)}" font-family="Helvetica,Arial,sans-serif"
       font-size="4" font-weight="bold" fill="${INK}">THE NUMBER YOU ROLL IS ALSO THE DIFFICULTY OF THE CARD</text>`,
  )

  const colWidth = width / 6
  const tileWidth = colWidth - 2.5
  TIERS.forEach((tier, i) => {
    const x = left + i * colWidth
    const y = top + 5
    const mid = x + tileWidth / 2
    parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(tileWidth)}" height="16" rx="1.8"
         fill="none" stroke="${INK}" stroke-width="0.7"/>`,
      `<text x="${n(mid)}" y="${n(y + 7)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
         font-size="6" font-weight="bold" fill="${INK}">${tier}</text>`,
      `<text x="${n(mid)}" y="${n(y + 11.2)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
         font-size="2.9" fill="${INK}">${escape(TIER_NAMES[tier])}</text>`,
      `<text x="${n(mid)}" y="${n(y + 14.6)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
         font-size="2.6" fill="${INK}" fill-opacity="0.65">${TIER_POINTS[tier]} pts · ${ANSWER_SECONDS}s</text>`,
    )
  })

  const rules = [
    'ROLL — the die gives both your distance and your card. Answer right and move forward by the roll; answer wrong and move back half the roll, rounded down, never past your own START.',
    'PIECES — both of yours begin on your START square. Land on a square holding only opponents and they go back to their own START. The four ★ START squares are safe: nothing is captured there.',
    'WINNING — roll a 6 and answer correctly to go again, at most twice running. First player to get both pieces HOME wins; in 2v2 it is the first team with two pieces home between the partners.',
  ]
  let y = top + 28
  for (const rule of rules) {
    for (const line of wrap(rule, width, 3.2)) {
      parts.push(
        `<text x="${n(left)}" y="${n(y)}" font-family="Helvetica,Arial,sans-serif"
           font-size="3.2" fill="${INK}">${escape(line)}</text>`,
      )
      y += 4.3
    }
    y += 1.6
  }

  parts.push(
    `<text x="${n(left)}" y="${n(y + 1)}" font-family="Helvetica,Arial,sans-serif"
       font-size="2.7" fill="${INK}" fill-opacity="0.55">${b.side}x${b.side} · track ${b.ring} squares · home column ${b.homeColumn} · ${n(cell)}mm cells — print at 100%, do NOT "fit to page" · medicine-ludo.charindith.workers.dev</text>`,
  )
  return parts.join('\n')
}

function buildPage(preset: BoardPreset, page: Page): string {
  const b = boardConfig(preset)
  const titleBand = 18
  const legendBand = 50
  const available = Math.min(
    page.width - page.margin * 2,
    page.height - page.margin * 2 - titleBand - legendBand,
  )
  const cell = available / b.side
  const boardSize = cell * b.side
  const ox = (page.width - boardSize) / 2
  const oy = page.margin + titleBand

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm"
     viewBox="0 0 ${page.width} ${page.height}">
  <rect width="${page.width}" height="${page.height}" fill="#ffffff"/>
  <text x="${n(page.width / 2)}" y="${n(page.margin + 7)}" text-anchor="middle"
        font-family="Helvetica,Arial,sans-serif" font-size="7.5" font-weight="bold"
        fill="${INK}">MEDICINE LUDO</text>
  <text x="${n(page.width / 2)}" y="${n(page.margin + 12.5)}" text-anchor="middle"
        font-family="Helvetica,Arial,sans-serif" font-size="3.4" fill="${INK}" fill-opacity="0.65">
    Roll the die · answer the card · race home — ${preset} board, ${page.name}
  </text>
${boardArtwork(b, cell, ox, oy)}
${legend(b, page, oy + boardSize + 12, cell)}
</svg>`
}

fs.mkdirSync(outDir, { recursive: true })

const targets: Array<[BoardPreset, Page]> = [
  ['standard', A3],
  ['standard', A4],
  ['quick', A4],
]

console.log('Generating printable boards…\n')
for (const [preset, page] of targets) {
  const b = boardConfig(preset)
  const svg = buildPage(preset, page)
  const base = `medicine-ludo-board-${preset}-${page.name}`
  fs.writeFileSync(path.join(outDir, `${base}.svg`), svg)

  const available = Math.min(
    page.width - page.margin * 2,
    page.height - page.margin * 2 - 18 - 50,
  )
  console.log(
    `  ${base}.svg   ${b.side}x${b.side} grid, ${n(available / b.side)}mm cells, ` +
      `board ${n(available)}mm square`,
  )
}
console.log(`\nWrote to ${path.relative(process.cwd(), outDir)}/`)
