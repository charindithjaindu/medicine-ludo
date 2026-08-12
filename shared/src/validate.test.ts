import { describe, expect, it } from 'vitest'
import { parseDifficulty, validateQuestionDraft } from './validate.js'

const base = {
  tier: 3,
  text: 'Which enzyme conjugates bilirubin?',
  options: ['UGT1A1', 'Heme oxygenase', 'Biliverdin reductase', 'G6PD'],
  answer: 'A',
}

describe('question difficulty', () => {
  it('takes the difficulty it is given', () => {
    const result = validateQuestionDraft({ ...base, difficulty: 'hard' })
    expect(result.ok).toBe(true)
    expect(result.draft!.difficulty).toBe('hard')
  })

  it('falls back to the tier when nobody has classified it', () => {
    // The seeded deck runs EASY (tier 1) through VERY DIFFICULT (tier 6).
    expect(validateQuestionDraft({ ...base, tier: 1 }).draft!.difficulty).toBe('easy')
    expect(validateQuestionDraft({ ...base, tier: 2 }).draft!.difficulty).toBe('easy')
    expect(validateQuestionDraft({ ...base, tier: 3 }).draft!.difficulty).toBe('medium')
    expect(validateQuestionDraft({ ...base, tier: 4 }).draft!.difficulty).toBe('medium')
    expect(validateQuestionDraft({ ...base, tier: 5 }).draft!.difficulty).toBe('hard')
    expect(validateQuestionDraft({ ...base, tier: 6 }).draft!.difficulty).toBe('hard')
  })

  it('rejects a difficulty it cannot make sense of', () => {
    const result = validateQuestionDraft({ ...base, difficulty: 'spicy' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/difficulty/i)
  })

  it('reads the spellings a hand-made spreadsheet actually contains', () => {
    expect(parseDifficulty('Easy')).toBe('easy')
    expect(parseDifficulty(' MED ')).toBe('medium')
    expect(parseDifficulty('Very Difficult')).toBe('hard')
    expect(parseDifficulty('')).toBe(null)
    expect(parseDifficulty(undefined)).toBe(null)
  })
})
