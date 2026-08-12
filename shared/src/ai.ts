/**
 * Computer players — deliberately simple. They exist so you can test or play a
 * round without four humans, not to be a worthy opponent. This is a multiplayer
 * game first.
 *
 * Answering is a difficulty dial: each skill has a per-tier chance of being right.
 * Piece choice is a short priority list. That's the whole thing.
 */

import { boardConfig, isSafeSquare, ringIndexOf } from './board.js'
import type { AnswerLetter, GameState, Tier } from './types.js'
import { ANSWER_LETTERS } from './types.js'

export const AI_SKILLS = ['intern', 'resident', 'consultant'] as const
export type AiSkill = (typeof AI_SKILLS)[number]

export const AI_SKILL_LABELS: Record<AiSkill, string> = {
  intern: 'Intern',
  resident: 'Resident',
  consultant: 'Consultant',
}

export const AI_SKILL_BLURBS: Record<AiSkill, string> = {
  intern: 'Shaky on hard cards',
  resident: 'Solid, misses tricky ones',
  consultant: 'Hard to catch out',
}

/** Chance of answering correctly, by skill and tier. Everyone declines as it gets harder. */
export const AI_ACCURACY: Record<AiSkill, Record<Tier, number>> = {
  intern: { 1: 0.8, 2: 0.66, 3: 0.54, 4: 0.44, 5: 0.3, 6: 0.2 },
  resident: { 1: 0.92, 2: 0.85, 3: 0.76, 4: 0.66, 5: 0.52, 6: 0.42 },
  consultant: { 1: 0.98, 2: 0.95, 3: 0.9, 4: 0.84, 5: 0.74, 6: 0.64 },
}

export const AI_NAMES = ['Dr. Ada', 'Dr. Bodhi', 'Dr. Cruz', 'Dr. Okafor']

/**
 * AI player IDs are prefixed so they can never collide with a real 6-digit ID, and
 * so results can be filtered out before they touch the leaderboard.
 */
export const AI_ID_PREFIX = 'ai-'
export const isAiId = (id: string) => id.startsWith(AI_ID_PREFIX)

/** `correctLetter` is server-side knowledge and never leaves the server. */
export function chooseAnswer(
  skill: AiSkill,
  tier: Tier,
  correctLetter: AnswerLetter,
  rng: () => number = Math.random,
): AnswerLetter {
  if (rng() < AI_ACCURACY[skill][tier]) return correctLetter
  const wrong = ANSWER_LETTERS.filter((l) => l !== correctLetter)
  return wrong[Math.floor(rng() * wrong.length)]
}

/**
 * A pause before answering, so turns are watchable. Harder cards take longer.
 *
 * Roughly 5-10 seconds. The old 1.5-4s made a table of computers rattle through a
 * game faster than anyone could follow — a human is still reading the stem at four
 * seconds, and an opponent who has already answered by then reads as a script
 * rather than a player.
 */
export function thinkTimeMs(tier: Tier, rng: () => number = Math.random): number {
  return 5000 + tier * 350 + rng() * 2800
}

/** Before rolling. Long enough that a computer's turn does not start mid-blink. */
export function rollDelayMs(rng: () => number = Math.random): number {
  return 2200 + rng() * 1600
}

/** Before picking which piece moves — a real decision, so it deserves a beat. */
export function choiceDelayMs(rng: () => number = Math.random): number {
  return 1800 + rng() * 1400
}

/**
 * Rank a move. The priority list, highest first:
 *   reach home > capture > slip into the home column > land somewhere safe.
 * Ties go to the piece that is furthest along.
 *
 * Going backward the only question is which piece can most afford to lose ground,
 * so it retreats whichever is least far along.
 */
function scoreMove(state: GameState, seat: number, from: number, distance: number): number {
  const b = boardConfig(state.preset)
  const to = distance > 0 ? Math.min(from + distance, b.goal) : Math.max(from + distance, 0)

  if (distance < 0) return -from

  if (to >= b.goal) return 1000
  if (to >= b.ring) return 200 + to

  const landed = ringIndexOf(seat, to, b)!
  const me = state.players.find((p) => p.seat === seat)!
  let score = to

  if (isSafeSquare(landed, b)) {
    score += 50
  } else {
    for (const other of state.players) {
      if (other.team === me.team) continue
      for (const enemy of other.pieces) {
        if (ringIndexOf(other.seat, enemy.progress, b) === landed) score += 300
      }
    }
  }
  return score
}

/** Pick one of the pieces the engine says may move. Ties break randomly. */
export function choosePiece(
  state: GameState,
  seat: number,
  distance: number,
  choices: string[],
  rng: () => number = Math.random,
): string {
  const player = state.players.find((p) => p.seat === seat)
  if (!player || choices.length <= 1) return choices[0]

  let best: string[] = []
  let bestScore = -Infinity
  for (const id of choices) {
    const piece = player.pieces.find((p) => p.id === id)
    if (!piece) continue
    const score = scoreMove(state, seat, piece.progress, distance)
    if (score > bestScore) {
      bestScore = score
      best = [id]
    } else if (score === bestScore) {
      best.push(id)
    }
  }
  return best.length > 0 ? best[Math.floor(rng() * best.length)] : choices[0]
}
