import {
  ANSWER_LETTERS,
  DIFFICULTIES,
  TIERS,
  difficultyForTier,
  type AnswerLetter,
  type Difficulty,
  type QuestionDraft,
  type Tier,
} from './types.js'

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

  const difficultyRaw = raw.difficulty
  const difficulty = parseDifficulty(difficultyRaw)
  if (difficultyRaw !== undefined && difficultyRaw !== null && difficultyRaw !== '' && !difficulty) {
    errors.push(`Difficulty must be one of ${DIFFICULTIES.join(', ')}.`)
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
      // An unlabelled question is not an error: the tier ordering is a good enough
      // first guess, and an admin can correct it later.
      difficulty: difficulty ?? difficultyForTier(tier as Tier),
      text,
      options: options as [string, string, string, string],
      answer: answer as AnswerLetter,
      explanation,
      active: parseBoolean(raw.active, true),
      sourceCard: Number.isFinite(sourceCard) ? sourceCard : null,
    },
  }
}

/**
 * Lenient on purpose: a spreadsheet exported by hand is as likely to say "Difficult"
 * or "MED" as it is to say "hard".
 */
export function parseDifficulty(value: unknown): Difficulty | null {
  if (typeof value !== 'string') return null
  const s = value.trim().toLowerCase()
  if (['easy', 'simple', 'basic', 'e'].includes(s)) return 'easy'
  if (['medium', 'mid', 'med', 'moderate', 'm'].includes(s)) return 'medium'
  if (['hard', 'difficult', 'very difficult', 'advanced', 'h', 'd'].includes(s)) return 'hard'
  return null
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const s = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'active'].includes(s)) return true
  if (['0', 'false', 'no', 'n', 'inactive', 'retired'].includes(s)) return false
  return fallback
}
