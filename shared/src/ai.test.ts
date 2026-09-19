import { describe, expect, it } from 'vitest'
import { createGame } from './engine.js'
import { AI_ACCURACY, AI_SKILLS, chooseAnswer, choosePiece } from './ai.js'
import type { GameState, Difficulty } from './types.js'

const PLAYERS = [
  { playerId: '1', name: 'Ana' },
  { playerId: '2', name: 'Ben' },
  { playerId: '3', name: 'Cleo' },
  { playerId: '4', name: 'Dev' },
]

const game = (mode: 'ffa' | 'teams' = 'ffa'): GameState =>
  createGame({ mode, preset: 'standard', players: PLAYERS })

function place(s: GameState, seat: number, idx: number, progress: number): GameState {
  s.players[seat].pieces[idx].progress = progress
  return s
}

const rng = () => 0

describe('ai answering', () => {
  it('is right when it passes its accuracy check and wrong when it fails', () => {
    expect(chooseAnswer('resident', 'easy', 'C', () => 0.1)).toBe('C')
    expect(chooseAnswer('resident', 'easy', 'C', () => 0.999)).not.toBe('C')
  })

  it('gets worse on harder difficulties, and better at higher skill', () => {
    for (const skill of AI_SKILLS) {
      const byTier = (['easy', 'medium', 'hard'] as Difficulty[]).map((t) => AI_ACCURACY[skill][t])
      for (let i = 1; i < byTier.length; i++) expect(byTier[i]).toBeLessThan(byTier[i - 1])
    }
    expect(AI_ACCURACY.intern['medium']).toBeLessThan(AI_ACCURACY.resident['medium'])
    expect(AI_ACCURACY.resident['medium']).toBeLessThan(AI_ACCURACY.consultant['medium'])
  })
})

describe('ai piece choice', () => {
  it('takes a capture over a plain advance', () => {
    let s = place(game(), 0, 0, 1) // +4 lands on absolute 9, where seat 1 sits
    s = place(s, 0, 1, 10)
    s = place(s, 1, 0, 26)
    expect(choosePiece(s, 0, 4, ['0-0', '0-1'], rng)).toBe('0-0')
  })

  it('goes home rather than capturing', () => {
    let s = place(game(), 0, 0, 28) // +2 reaches home (goal 30)
    s = place(s, 0, 1, 1) // +2 would capture on absolute 7
    s = place(s, 1, 0, 24)
    expect(choosePiece(s, 0, 2, ['0-0', '0-1'], rng)).toBe('0-0')
  })

  it('does not treat a teammate as a capture', () => {
    let s = place(game('teams'), 0, 0, 1) // +4 -> absolute 9
    s = place(s, 0, 1, 10)
    s = place(s, 2, 0, 19) // partner on absolute 9
    expect(choosePiece(s, 0, 4, ['0-0', '0-1'], rng)).toBe('0-1')
  })

  it('retreats the piece that can most afford it', () => {
    let s = place(game(), 0, 0, 4)
    s = place(s, 0, 1, 26) // nearly home, protect it
    expect(choosePiece(s, 0, -3, ['0-0', '0-1'], rng)).toBe('0-0')
  })

  it('always returns one of the offered pieces', () => {
    let s = place(game(), 0, 0, 5)
    s = place(s, 0, 1, 9)
    for (let i = 0; i < 20; i++) {
      expect(['0-0', '0-1']).toContain(choosePiece(s, 0, 3, ['0-0', '0-1']))
    }
    expect(choosePiece(s, 0, 3, ['0-1'], rng)).toBe('0-1')
  })
})
