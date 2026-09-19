import { describe, expect, it } from 'vitest'
import { parseDifficulty, validateQuestionDraft } from './validate.js'

const base = {
  difficulty: 'medium',
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

  it('requires an explicit difficulty', () => {
    expect(validateQuestionDraft({ ...base, difficulty: undefined }).ok).toBe(false)
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
