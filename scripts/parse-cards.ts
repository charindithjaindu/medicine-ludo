/**
 * Turns `tiered qa cards.pdf` into question rows.
 *
 * The PDF is a deck of flashcards: 90 cards, each rendered as a question page
 * immediately followed by its answer page, so page 2n-1 and page 2n always belong
 * together. Layout is uniform, which makes a line-based parse reliable — but the
 * parser still validates everything it produces and reports problems rather than
 * quietly importing a card whose answer letter disagrees with its answer text.
 *
 * Used by `npm run import:pdf`, which turns the result into SQL for SQLite.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { difficultyForTier } from '@shared/types.js'
import type { AnswerLetter, QuestionDraft, Tier } from '@shared/types.js'

const TIER_BY_NAME: Record<string, Tier> = {
  EASY: 1,
  'MID EASY': 2,
  MEDIUM: 3,
  'MID MEDIUM': 4,
  DIFFICULT: 5,
  'VERY DIFFICULT': 6,
}

export const EXPECTED_CARDS = 90

export interface ParsedCard extends QuestionDraft {
  sourceCard: number
  tier: Tier
}

export interface ParseReport {
  cards: ParsedCard[]
  problems: string[]
}

function extractText(pdfPath: string): string {
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`)
  try {
    return execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    throw new Error(
      'pdftotext is required to import the PDF. Install it with `brew install poppler`.\n' +
        String(err),
    )
  }
}

const CARD_RE = /Q(\d+)\s*[•·]\s*Card\s*(\d+)\s*\/\s*(\d+)/
const TIER_RE = /^(.+?)\s+TIER\s*\(/

function lines(page: string): string[] {
  return page.split('\n').map((l) => l.trim())
}

/** Everything before the "Qn • Card m/90" line is the wrapped tier header. */
function parseHeader(pageLines: string[], cardLineIndex: number) {
  const header = pageLines.slice(0, cardLineIndex).join(' ').replace(/\s+/g, ' ').trim()
  const m = TIER_RE.exec(header)
  const tierName = m?.[1]?.trim().toUpperCase() ?? ''
  return { header, tier: TIER_BY_NAME[tierName], tierName }
}

function parseQuestionPage(page: string) {
  const raw = lines(page)
  const idx = raw.findIndex((l) => CARD_RE.test(l))
  if (idx === -1) return null

  const cardMatch = CARD_RE.exec(raw[idx])!
  const { tier, tierName } = parseHeader(raw, idx)
  const body = raw.slice(idx + 1).filter((l) => l.length > 0)

  const firstOption = body.findIndex((l) => /^A\)/.test(l))
  if (firstOption === -1) return null

  const text = body.slice(0, firstOption).join(' ').replace(/\s+/g, ' ').trim()

  // Options wrap across lines; a line only starts a new option if it opens with "X)".
  const options: Partial<Record<AnswerLetter, string>> = {}
  let current: AnswerLetter | null = null
  for (const line of body.slice(firstOption)) {
    const m = /^([A-D])\)\s*(.*)$/.exec(line)
    if (m) {
      current = m[1] as AnswerLetter
      options[current] = m[2].trim()
    } else if (current) {
      options[current] = `${options[current]} ${line}`.trim()
    }
  }

  return {
    cardNumber: Number(cardMatch[2]),
    questionNumber: Number(cardMatch[1]),
    tier,
    tierName,
    text,
    options,
  }
}

function parseAnswerPage(page: string) {
  const raw = lines(page)
  const idx = raw.findIndex((l) => CARD_RE.test(l))
  const markerIdx = raw.findIndex((l) => /^correct answer$/i.test(l))
  if (idx === -1 || markerIdx === -1) return null

  const cardMatch = CARD_RE.exec(raw[idx])!
  const after = raw.slice(markerIdx + 1).filter((l) => l.length > 0)
  const letter = after[0]
  if (!letter || !/^[A-D]$/.test(letter)) return null

  return {
    cardNumber: Number(cardMatch[2]),
    letter: letter as AnswerLetter,
    answerText: after.slice(1).join(' ').replace(/\s+/g, ' ').trim(),
  }
}

/** Loose comparison — the PDF re-wraps text, so only the characters matter. */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function parsePdf(pdfPath: string): ParseReport {
  const pages = extractText(pdfPath).split('\f')
  const cards: ParsedCard[] = []
  const problems: string[] = []

  const questions = new Map<number, ReturnType<typeof parseQuestionPage>>()
  const answers = new Map<number, ReturnType<typeof parseAnswerPage>>()

  for (const page of pages) {
    if (!page.trim()) continue
    if (/correct answer/i.test(page)) {
      const a = parseAnswerPage(page)
      if (a) answers.set(a.cardNumber, a)
    } else {
      const q = parseQuestionPage(page)
      if (q) questions.set(q.cardNumber, q)
    }
  }

  for (let card = 1; card <= EXPECTED_CARDS; card++) {
    const q = questions.get(card)
    const a = answers.get(card)
    if (!q) {
      problems.push(`Card ${card}: no question page found.`)
      continue
    }
    if (!a) {
      problems.push(`Card ${card}: no answer page found.`)
      continue
    }
    if (!q.tier) {
      problems.push(`Card ${card}: unrecognised tier "${q.tierName}".`)
      continue
    }
    const opts = [q.options.A, q.options.B, q.options.C, q.options.D]
    if (opts.some((o) => !o)) {
      problems.push(`Card ${card}: missing one or more options.`)
      continue
    }
    if (!q.text) {
      problems.push(`Card ${card}: empty question text.`)
      continue
    }

    // The answer page repeats the winning option's text. If it does not match the
    // option the letter points at, the parse has drifted and must not be trusted.
    const expected = opts[['A', 'B', 'C', 'D'].indexOf(a.letter)]!
    if (a.answerText && normalise(a.answerText) !== normalise(expected)) {
      problems.push(
        `Card ${card}: answer letter ${a.letter} says "${expected}" but the answer page reads "${a.answerText}".`,
      )
      continue
    }

    cards.push({
      sourceCard: card,
      tier: q.tier,
      // The PDF grades cards EASY through VERY DIFFICULT and nothing more, so its
      // own tiers are the starting classification. Admins refine it from there.
      difficulty: difficultyForTier(q.tier),
      text: q.text,
      options: opts as [string, string, string, string],
      answer: a.letter,
      explanation: null,
      active: true,
    })
  }

  const perTier = new Map<Tier, number>()
  for (const c of cards) perTier.set(c.tier, (perTier.get(c.tier) ?? 0) + 1)
  for (const [tier, n] of [...perTier].sort((x, y) => x[0] - y[0])) {
    if (n !== 15) problems.push(`Tier ${tier} parsed ${n} cards, expected 15.`)
  }

  return { cards, problems }
}
