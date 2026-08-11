import { ANSWER_LETTERS, TIERS, type AnswerLetter, type QuestionDraft, type Tier } from './types.js'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  draft?: QuestionDraft
}

/**
 * One definition of "a valid question", shared by the admin form, the REST layer
 * and the bulk importer, so all three agree on what they will accept.
 */
export function validateQuestionDraft(input: unknown): ValidationResult {
  const errors: string[] = []
  const raw = (input ?? {}) as Record<string, unknown>

  const tier = Number(raw.tier)
  if (!TIERS.includes(tier as Tier)) errors.push('Tier must be a number from 1 to 6.')

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) errors.push('Question text is required.')

  const optionsIn = Array.isArray(raw.options)
    ? raw.options
    : [raw.option_a, raw.option_b, raw.option_c, raw.option_d]
  const options = (optionsIn ?? []).map((o) => (typeof o === 'string' ? o.trim() : ''))
  if (options.length !== 4 || options.some((o) => !o)) {
    errors.push('All four options (A-D) are required.')
  }

  const answer = typeof raw.answer === 'string' ? raw.answer.trim().toUpperCase() : ''
  if (!ANSWER_LETTERS.includes(answer as AnswerLetter)) {
    errors.push('Answer must be A, B, C or D.')
  }

  if (errors.length > 0) return { ok: false, errors }

  const explanationRaw = raw.explanation
  const explanation =
    typeof explanationRaw === 'string' && explanationRaw.trim() ? explanationRaw.trim() : null

  const sourceCardRaw = raw.sourceCard ?? raw.source_card
  const sourceCard =
    sourceCardRaw === undefined || sourceCardRaw === null || sourceCardRaw === ''
      ? null
      : Number(sourceCardRaw)

  return {
    ok: true,
    errors: [],
    draft: {
      tier: tier as Tier,
      text,
      options: options as [string, string, string, string],
      answer: answer as AnswerLetter,
      explanation,
      active: parseBoolean(raw.active, true),
      sourceCard: Number.isFinite(sourceCard) ? sourceCard : null,
    },
  }
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const s = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'active'].includes(s)) return true
  if (['0', 'false', 'no', 'n', 'inactive', 'retired'].includes(s)) return false
  return fallback
}
