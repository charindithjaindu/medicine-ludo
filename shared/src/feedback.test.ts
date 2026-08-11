import { describe, expect, it } from 'vitest'
import { answerBeat, moveBeat } from './feedback.js'
import type { TurnResult } from './types.js'

/** A correct answer that still needs a piece choice — movedPieceId is not set yet. */
const resolved: TurnResult = {
  seat: 0,
  roll: 3,
  tier: 3,
  questionId: 42,
  questionText: 'q',
  options: ['a', 'b', 'c', 'd'],
  chosen: 'B',
  correctLetter: 'B',
  wasCorrect: true,
  explanation: null,
  distance: 3,
  movedPieceId: null,
  captured: [],
  pointsEarned: 30,
  reachedHome: false,
  extraTurn: false,
}

/** The same turn after the player picked a piece, which also took an opponent. */
const afterMoving: TurnResult = {
  ...resolved,
  movedPieceId: '0-1',
  captured: [{ seat: 2, pieceId: '2-0' }],
  pointsEarned: 55,
}

describe('turn feedback beats', () => {
  it('treats the answer as the same beat before and after the piece moves', () => {
    // This is the repeat-celebration bug: keying on the whole result made these differ.
    expect(answerBeat(resolved)).toBe(answerBeat(afterMoving))
  })

  it('separates answers from different turns', () => {
    expect(answerBeat(resolved)).not.toBe(answerBeat({ ...resolved, questionId: 43 }))
    expect(answerBeat(resolved)).not.toBe(answerBeat({ ...resolved, seat: 1 }))
  })

  it('distinguishes a timeout from an answered letter', () => {
    expect(answerBeat({ ...resolved, chosen: null })).not.toBe(answerBeat(resolved))
  })

  it('withholds the move beat until a piece has actually moved', () => {
    expect(moveBeat(resolved)).toBeNull()
    expect(moveBeat(afterMoving)).toBe('0:42:0-1')
  })

  it('gives each moved piece its own beat', () => {
    expect(moveBeat(afterMoving)).not.toBe(moveBeat({ ...afterMoving, movedPieceId: '0-0' }))
  })
})
