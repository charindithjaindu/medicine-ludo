import { describe, expect, it } from 'vitest'
import {
  boardConfig,
  cellFor,
  homeColumnCells,
  isSafeSquare,
  ringCells,
  ringIndexOf,
  startIndex,
  yardRect,
} from './board.js'
import {
  applyRoll,
  choosePiece,
  createGame,
  detectWinner,
  eligiblePieces,
  endTurn,
  playerAt,
  resolveAnswer,
  rollDie,
  summarise,
} from './engine.js'
import type { AnswerLetter, BoardPreset, GameMode, GameState } from './types.js'

const PLAYERS = [
  { playerId: '100001', name: 'Ana' },
  { playerId: '100002', name: 'Ben' },
  { playerId: '100003', name: 'Cleo' },
  { playerId: '100004', name: 'Dev' },
]

function game(mode: GameMode = 'ffa', preset: BoardPreset = 'standard'): GameState {
  return createGame({ mode, preset, players: PLAYERS })
}

/** Place a specific piece, so a test can set up a board position directly. */
function place(s: GameState, seat: number, pieceIndex: number, progress: number): GameState {
  s.players[seat].pieces[pieceIndex].progress = progress
  return s
}

function rolled(s: GameState, seat: number, roll: number): GameState {
  s.turnSeat = seat
  return applyRoll(s, seat, roll, {
    id: 1,
    difficulty: 'easy',
    topic: '',
    text: 'q',
    options: ['a', 'b', 'c', 'd'],
    deadline: 0,
  })
}

function answer(s: GameState, chosen: AnswerLetter | null, correctLetter: AnswerLetter = 'A') {
  return resolveAnswer(s, {
    chosen,
    correctLetter,
    explanation: null,
    questionId: 1,
    questionText: 'q',
    options: ['a', 'b', 'c', 'd'],
  })
}

describe('board geometry', () => {
  it('builds a cross whose arms follow the classic up-tip-down pattern', () => {
    const std = boardConfig('standard')
    expect(std.armLength).toBe(3)
    expect(std.side).toBe(9)
    expect(std.ring).toBe(4 * (2 * 3 + 1)) // 28
    expect(std.homeColumn).toBe(2)
    expect(std.goal).toBe(30)
    expect(ringCells(std)).toHaveLength(28)

    const quick = boardConfig('quick')
    expect(quick.side).toBe(7)
    expect(quick.ring).toBe(20)
    expect(quick.homeColumn).toBe(1)
    expect(quick.goal).toBe(21)
    expect(ringCells(quick)).toHaveLength(20)
  })

  it('never visits the same track cell twice', () => {
    for (const preset of ['quick', 'standard'] as const) {
      const b = boardConfig(preset)
      const seen = new Set(ringCells(b).map((c) => `${c.row},${c.col}`))
      expect(seen.size).toBe(b.ring)
    }
  })

  it('walks between touching cells the whole way round', () => {
    for (const preset of ['quick', 'standard'] as const) {
      const b = boardConfig(preset)
      const cells = ringCells(b)
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i]
        const z = cells[(i + 1) % cells.length]
        // 1 for a step along an arm, 2 for the diagonal turn between arms.
        const gap = Math.abs(a.row - z.row) + Math.abs(a.col - z.col)
        expect(gap).toBeGreaterThanOrEqual(1)
        expect(gap).toBeLessThanOrEqual(2)
      }
    }
  })

  it('spaces the four start squares one arm apart', () => {
    const b = boardConfig('standard')
    expect([0, 1, 2, 3].map((s) => startIndex(s, b))).toEqual([4, 11, 18, 25])
  })

  it('marks exactly the four start squares as safe', () => {
    const b = boardConfig('standard')
    const safe = Array.from({ length: b.ring }, (_, i) => i).filter((i) => isSafeSquare(i, b))
    expect(safe).toEqual([4, 11, 18, 25])
  })

  it('turns inward at its own arm tip after a full lap', () => {
    const b = boardConfig('standard')
    expect(cellFor(0, 0, b)).toEqual({ row: 0, col: 5 }) // start, top arm
    expect(cellFor(0, b.ring - 1, b)).toEqual({ row: 0, col: 4 }) // its own arm tip
    expect(ringIndexOf(0, b.ring, b)).toBeNull() // off the track
    expect(cellFor(0, b.ring, b)).toEqual({ row: 1, col: 4 }) // home column
    expect(cellFor(0, b.ring + 1, b)).toEqual({ row: 2, col: 4 })
    expect(cellFor(0, b.goal, b)).toEqual({ row: 4, col: 4 }) // centre
  })

  it('gives each seat a corner yard and a home column that meet the centre', () => {
    const b = boardConfig('standard')
    expect(yardRect(0, b)).toEqual({ row: 0, col: 6, size: 3 })
    expect(yardRect(2, b)).toEqual({ row: 6, col: 0, size: 3 })
    for (let seat = 0; seat < 4; seat++) {
      expect(homeColumnCells(seat, b)).toHaveLength(b.homeColumn)
    }
  })
})

describe('setup', () => {
  it('gives every player two pieces already on the board', () => {
    const s = game()
    expect(s.players).toHaveLength(4)
    for (const p of s.players) {
      expect(p.pieces).toHaveLength(2)
      expect(p.pieces.every((pc) => pc.progress === 0)).toBe(true)
    }
    expect(s.phase).toBe('awaiting-roll')
  })

  it('pairs seats 0/2 against 1/3 in team mode, and nobody in FFA', () => {
    expect(game('teams').players.map((p) => p.team)).toEqual([0, 1, 0, 1])
    expect(game('ffa').players.map((p) => p.team)).toEqual([0, 1, 2, 3])
  })

  it('rolls only ever produce 1-6', () => {
    expect(rollDie(() => 0)).toBe(1)
    expect(rollDie(() => 0.999999)).toBe(6)
  })
})

describe('answering', () => {
  it('moves forward by the roll on a correct answer', () => {
    let s = rolled(game(), 0, 3)
    s = answer(s, 'A', 'A')
    // Both pieces sit on the start square, so the player picks which one goes.
    expect(s.phase).toBe('choosing-piece')
    expect(s.choices).toHaveLength(2)
    expect(s.pendingDistance).toBe(3)
    s = choosePiece(s, 0, s.choices[0])
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(3)
    expect(s.lastResult!.wasCorrect).toBe(true)
    expect(s.lastResult!.pointsEarned).toBe(30) // tier 3
  })

  it('moves back half the roll, rounded down, on a wrong answer', () => {
    let s = place(game(), 0, 0, 10)
    s = place(s, 0, 1, 30) // already home, so only one piece can take the penalty
    s = rolled(s, 0, 5)
    s = answer(s, 'B', 'A')
    expect(s.lastResult!.wasCorrect).toBe(false)
    expect(s.lastResult!.distance).toBe(-2)
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(8)
    expect(s.lastResult!.pointsEarned).toBe(0)
  })

  it('treats a timeout as a wrong answer', () => {
    let s = place(game(), 0, 0, 10)
    s = place(s, 0, 1, 30)
    s = rolled(s, 0, 4)
    s = answer(s, null, 'A')
    expect(s.lastResult!.wasCorrect).toBe(false)
    expect(s.lastResult!.chosen).toBeNull()
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(8)
  })

  it('never pushes a piece back past its own start square', () => {
    let s = place(game(), 0, 0, 2)
    s = place(s, 0, 1, 30)
    s = rolled(s, 0, 6)
    s = answer(s, 'B', 'A') // -3 from progress 2
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(0)
  })

  it('costs nothing but the turn when no piece can take the penalty', () => {
    // Both pieces on the start square: there is nowhere further back to go.
    let s = rolled(game(), 0, 6)
    s = answer(s, 'B', 'A')
    expect(s.phase).toBe('revealing')
    expect(s.lastResult!.distance).toBe(0)
    expect(s.lastResult!.movedPieceId).toBeNull()
    expect(playerAt(s, 0)!.pieces.every((p) => p.progress === 0)).toBe(true)
  })

  it('protects pieces in the home column from the backward penalty', () => {
    let s = place(game(), 0, 0, 29) // home column
    s = place(s, 0, 1, 30) // finished
    s = rolled(s, 0, 4)
    expect(eligiblePieces(s, 0, -2)).toEqual([])
    s = answer(s, 'B', 'A')
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(29)
  })

  it('moves without asking when only one piece is eligible', () => {
    let s = place(game(), 0, 1, 30)
    s = rolled(s, 0, 2)
    s = answer(s, 'A', 'A')
    expect(s.phase).toBe('revealing')
    expect(s.lastResult!.movedPieceId).toBe('0-0')
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(2)
  })

  it('records accuracy for the leaderboard', () => {
    let s = rolled(game(), 0, 1)
    s = answer(s, 'A', 'A')
    s = choosePiece(s, 0, s.choices[0])
    s = rolled(s, 0, 1)
    s = answer(s, 'C', 'A')
    expect(playerAt(s, 0)!.answered).toBe(2)
    expect(playerAt(s, 0)!.correct).toBe(1)
  })
})

describe('capture', () => {
  it('sends an opponent home when landing on them off a safe square', () => {
    // Seat 0 at progress 1 rolling 4 lands on absolute square 9.
    // Seat 1 at progress 26 also sits on absolute square 9.
    let s = place(game(), 0, 0, 1)
    s = place(s, 0, 1, 30)
    s = place(s, 1, 0, 26)
    const b = boardConfig('standard')
    expect(ringIndexOf(0, 5, b)).toBe(9)
    expect(ringIndexOf(1, 26, b)).toBe(9)
    expect(isSafeSquare(9, b)).toBe(false)

    s = rolled(s, 0, 4)
    s = answer(s, 'A', 'A')
    expect(playerAt(s, 1)!.pieces[0].progress).toBe(0)
    expect(s.lastResult!.captured).toEqual([{ seat: 1, pieceId: '1-0' }])
    expect(s.lastResult!.pointsEarned).toBe(40 + 25) // tier 4 + capture
  })

  it('does not capture on a safe square', () => {
    let s = place(game(), 0, 0, 3)
    s = place(s, 0, 1, 30)
    s = place(s, 1, 0, 0) // sitting on its own start, which is safe
    const b = boardConfig('standard')
    expect(ringIndexOf(0, 7, b)).toBe(11)
    expect(isSafeSquare(11, b)).toBe(true)

    s = rolled(s, 0, 4)
    s = answer(s, 'A', 'A')
    expect(playerAt(s, 1)!.pieces[0].progress).toBe(0)
    expect(s.lastResult!.captured).toEqual([])
  })

  it('never captures a teammate', () => {
    // Seat 0 lands on absolute 9; seat 2 sits there too. In teams mode they are partners.
    let s = place(game('teams'), 0, 0, 1)
    s = place(s, 0, 1, 30)
    s = place(s, 2, 0, 19) // (18 + 19) % 28 = 9
    const b = boardConfig('standard')
    expect(ringIndexOf(2, 19, b)).toBe(9)

    s = rolled(s, 0, 4)
    s = answer(s, 'A', 'A')
    expect(playerAt(s, 2)!.pieces[0].progress).toBe(19)
    expect(s.lastResult!.captured).toEqual([])
  })

  it('does not capture when moving backward', () => {
    // Seat 0 retreats from progress 8 to 5, which is absolute square 9 — exactly
    // where seat 1 is sitting. Retreating must not take the piece.
    let s = place(game(), 0, 0, 8)
    s = place(s, 0, 1, 30)
    s = place(s, 1, 0, 26) // also absolute square 9
    s = rolled(s, 0, 6) // wrong answer -> -3
    s = answer(s, 'B', 'A')
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(5)
    expect(playerAt(s, 1)!.pieces[0].progress).toBe(26)
  })
})

describe('reaching home', () => {
  it('lets a piece overshoot into home rather than stalling on an exact count', () => {
    let s = place(game(), 0, 0, 29)
    s = place(s, 0, 1, 30)
    s = rolled(s, 0, 6)
    s = answer(s, 'A', 'A')
    expect(playerAt(s, 0)!.pieces[0].progress).toBe(30)
    expect(s.lastResult!.reachedHome).toBe(true)
  })

  it('awards the home bonus once', () => {
    let s = place(game(), 0, 0, 28)
    s = place(s, 0, 1, 0)
    s = rolled(s, 0, 2)
    s = answer(s, 'A', 'A')
    s = choosePiece(s, 0, '0-0')
    expect(s.lastResult!.pointsEarned).toBe(20 + 50) // tier 2 + home
  })
})

describe('turn order', () => {
  it('hands the dice on after an ordinary turn', () => {
    let s = rolled(game(), 0, 2)
    s = answer(s, 'A', 'A')
    s = choosePiece(s, 0, s.choices[0])
    s = endTurn(s)
    expect(s.turnSeat).toBe(1)
    expect(s.phase).toBe('awaiting-roll')
    expect(s.question).toBeNull()
  })

  it('grants another turn for a correct answer on a 6', () => {
    let s = rolled(game(), 0, 6)
    s = answer(s, 'A', 'A')
    s = choosePiece(s, 0, s.choices[0])
    expect(s.lastResult!.extraTurn).toBe(true)
    s = endTurn(s)
    expect(s.turnSeat).toBe(0)
    expect(s.extraTurnsUsed).toBe(1)
  })

  it('does not grant an extra turn for a wrong answer on a 6', () => {
    let s = place(game(), 0, 0, 5)
    s = place(s, 0, 1, 30)
    s = rolled(s, 0, 6)
    s = answer(s, 'B', 'A')
    expect(s.lastResult!.extraTurn).toBe(false)
    s = endTurn(s)
    expect(s.turnSeat).toBe(1)
  })

  it('caps consecutive extra turns so one player cannot lock the table out', () => {
    let s = game()
    for (let i = 0; i < 3; i++) {
      s = rolled(s, 0, 6)
      s = answer(s, 'A', 'A')
      if (s.phase === 'choosing-piece') s = choosePiece(s, 0, s.choices[0])
      s = endTurn(s)
    }
    expect(s.extraTurnsUsed).toBe(0)
    expect(s.turnSeat).toBe(1)
  })
})

describe('winning', () => {
  it('ends the game in FFA when one player gets both pieces home', () => {
    let s = place(game(), 0, 0, 30)
    s = place(s, 0, 1, 29)
    s = rolled(s, 0, 1)
    s = answer(s, 'A', 'A')
    expect(s.winner).toEqual({ type: 'player', seat: 0 })
    s = endTurn(s)
    expect(s.phase).toBe('game-over')
  })

  it('lets a team win on two pieces home between the partners', () => {
    let s = game('teams')
    s = place(s, 0, 0, 30)
    expect(detectWinner(s)).toBeNull() // one piece is not enough

    s = place(s, 2, 0, 30) // partner brings the second one home
    expect(detectWinner(s)).toEqual({ type: 'team', team: 0 })
  })

  it('lets one partner carry the team alone', () => {
    let s = game('teams')
    s = place(s, 0, 0, 30)
    s = place(s, 0, 1, 30)
    expect(detectWinner(s)).toEqual({ type: 'team', team: 0 })
  })

  it('counts only pieces belonging to the same team', () => {
    let s = game('teams')
    s = place(s, 0, 0, 30) // team 0
    s = place(s, 1, 0, 30) // team 1
    expect(detectWinner(s)).toBeNull()
  })

  it('gives the win bonus to both partners', () => {
    let s = game('teams')
    s = place(s, 0, 0, 30)
    s = place(s, 2, 0, 29)
    s = rolled(s, 2, 1)
    s = answer(s, 'A', 'A')
    s = choosePiece(s, 2, '2-0') // both of seat 2's pieces can move, so it picks
    expect(s.winner).toEqual({ type: 'team', team: 0 })
    expect(playerAt(s, 0)!.score).toBe(100)
    expect(playerAt(s, 2)!.score).toBeGreaterThanOrEqual(100)
    expect(playerAt(s, 1)!.score).toBe(0)
    expect(playerAt(s, 3)!.score).toBe(0)
  })

  it('summarises the table with the winners flagged', () => {
    let s = place(game(), 0, 0, 30)
    s = place(s, 0, 1, 29)
    s = rolled(s, 0, 1)
    s = answer(s, 'A', 'A')
    const rows = summarise(s)
    expect(rows[0].seat).toBe(0)
    expect(rows[0].won).toBe(true)
    expect(rows[0].piecesHome).toBe(2)
    expect(rows.filter((r) => r.won)).toHaveLength(1)
  })
})

describe('guards', () => {
  it('refuses a piece choice from the wrong player', () => {
    let s = rolled(game(), 0, 3)
    s = answer(s, 'A', 'A')
    expect(() => choosePiece(s, 1, s.choices[0])).toThrow(/not your turn/i)
  })

  it('refuses a piece that cannot make the pending move', () => {
    let s = rolled(game(), 0, 3)
    s = answer(s, 'A', 'A')
    expect(() => choosePiece(s, 0, '1-0')).toThrow(/cannot make this move/i)
  })

  it('refuses a piece choice outside the choosing phase', () => {
    const s = rolled(game(), 0, 3)
    expect(() => choosePiece(s, 0, '0-0')).toThrow(/not choosing/i)
  })
})
