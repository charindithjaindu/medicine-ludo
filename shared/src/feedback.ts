/**
 * What counts as a *new* thing worth reacting to.
 *
 * A single turn is broadcast several times: once when the answer resolves, again
 * once a piece has been chosen and moved, and again at end of turn. The result
 * object is not identical across those — `movedPieceId` and `captured` fill in
 * later — so "has this result changed?" is the wrong question to ask. Asking it
 * that way made the game celebrate a second time after the player moved a piece.
 *
 * Instead there are two separate beats, each with its own identity:
 *   the answer  — right or wrong, fires once when the question resolves
 *   the move    — captures and reaching home, fires once when a piece has moved
 */

import type { TurnResult } from './types.js'

/** Stable from the moment the answer resolves, through the piece choice. */
export function answerBeat(result: TurnResult): string {
  return `${result.seat}:${result.questionId}:${result.chosen ?? 'timeout'}`
}

/** null until a piece has actually moved, so the move beat cannot fire early. */
export function moveBeat(result: TurnResult): string | null {
  return result.movedPieceId ? `${result.seat}:${result.questionId}:${result.movedPieceId}` : null
}
