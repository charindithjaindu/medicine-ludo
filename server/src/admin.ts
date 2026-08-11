/**
 * Admin panel API.
 *
 * Deliberately not linked from anywhere in the player UI. Everything below the
 * login route sits behind `requireAdmin`, so an unauthenticated caller learns
 * nothing beyond "there is a login here".
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { TIERS, type Question, type Tier } from '@shared/types.js'
import { validateQuestionDraft } from '@shared/validate.js'
import {
  activeCountByTier,
  createQuestion,
  db,
  deleteQuestion,
  getQuestion,
  listQuestions,
  resetQuestionStats,
  updateQuestion,
  upsertBySourceCard,
} from './db.js'
import { parseCsvObjects, toCsv } from './csv.js'
import { importPdf } from './pdf-import.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PDF = path.resolve(here, '../../tiered qa cards.pdf')

const COOKIE_NAME = 'ml_admin'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function secret(): string {
  return process.env.SESSION_SECRET || 'insecure-dev-secret-change-me'
}

function signSession(expiresAt: number): string {
  const mac = crypto.createHmac('sha256', secret()).update(String(expiresAt)).digest('hex')
  return `${expiresAt}.${mac}`
}

function verifySession(token: unknown): boolean {
  if (typeof token !== 'string') return false
  const [expPart, mac] = token.split('.')
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !mac) return false
  const expected = crypto.createHmac('sha256', secret()).update(expPart).digest('hex')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function passwordMatches(supplied: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) return false
  if (typeof supplied !== 'string') return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  // Compare a fixed-size digest so length alone does not leak through timing.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest(),
  )
}

// A crude brute-force brake. Enough for a password that lives in a .env file.
const attempts = new Map<string, { count: number; first: number }>()
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

function throttled(ip: string): boolean {
  const entry = attempts.get(ip)
  if (!entry) return false
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.delete(ip)
    return false
  }
  return entry.count >= MAX_ATTEMPTS
}

function noteFailure(ip: string) {
  const entry = attempts.get(ip)
  if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { count: 1, first: Date.now() })
  } else {
    entry.count++
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!verifySession(req.cookies?.[COOKIE_NAME])) {
    res.status(401).json({ error: 'Not signed in' })
    return
  }
  next()
}

/**
 * The die face selects the tier, so a tier with no active questions is a roll the
 * game cannot answer. Every mutation is checked against this.
 */
function emptyTiersAfter(counts: Record<Tier, number>): Tier[] {
  return TIERS.filter((t) => counts[t] === 0)
}

function assertTierStaysStocked(mutation: () => void) {
  const before = activeCountByTier()
  const runAndCheck = db.transaction(() => {
    mutation()
    const after = activeCountByTier()
    const newlyEmpty = emptyTiersAfter(after).filter((t) => before[t] > 0)
    if (newlyEmpty.length > 0) {
      throw new Error(
        `That would leave tier ${newlyEmpty.join(', ')} with no active questions. ` +
          'Every tier needs at least one, because the die face picks the tier.',
      )
    }
  })
  runAndCheck()
}

function asRow(q: Question) {
  return {
    id: q.id,
    tier: q.tier,
    source_card: q.sourceCard,
    text: q.text,
    option_a: q.options[0],
    option_b: q.options[1],
    option_c: q.options[2],
    option_d: q.options[3],
    answer: q.answer,
    explanation: q.explanation ?? '',
    active: q.active ? 'true' : 'false',
  }
}

const EXPORT_HEADERS = [
  'id',
  'tier',
  'source_card',
  'text',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'answer',
  'explanation',
  'active',
]

export function adminRouter(): Router {
  const router = Router()

  // -- session ---------------------------------------------------------------

  router.post('/login', (req, res) => {
    const ip = req.ip ?? 'unknown'
    if (throttled(ip)) {
      res.status(429).json({ error: 'Too many attempts. Try again later.' })
      return
    }
    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server.' })
      return
    }
    if (!passwordMatches(req.body?.password)) {
      noteFailure(ip)
      res.status(401).json({ error: 'Incorrect password' })
      return
    }
    attempts.delete(ip)
    const expiresAt = Date.now() + SESSION_TTL_MS
    res.cookie(COOKIE_NAME, signSession(expiresAt), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      secure: process.env.NODE_ENV === 'production',
    })
    res.json({ ok: true })
  })

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME)
    res.json({ ok: true })
  })

  router.get('/session', (req, res) => {
    res.json({ authenticated: verifySession(req.cookies?.[COOKIE_NAME]) })
  })

  // -- everything below requires a session -----------------------------------

  router.use(requireAdmin)

  router.get('/questions', (req, res) => {
    const tier = req.query.tier ? (Number(req.query.tier) as Tier) : undefined
    const active =
      req.query.active === undefined || req.query.active === 'all'
        ? undefined
        : req.query.active === 'true'
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const questions = listQuestions({ tier, active, search })
    res.json({ questions, counts: activeCountByTier() })
  })

  router.post('/questions', (req, res) => {
    const result = validateQuestionDraft(req.body)
    if (!result.ok) {
      res.status(400).json({ error: result.errors.join(' ') })
      return
    }
    res.status(201).json({ question: createQuestion(result.draft!) })
  })

  router.patch('/questions/:id', (req, res) => {
    const id = Number(req.params.id)
    const existing = getQuestion(id)
    if (!existing) {
      res.status(404).json({ error: 'No such question' })
      return
    }

    // Merge onto the existing row so a partial patch (e.g. just `active`) validates.
    const merged = {
      tier: req.body.tier ?? existing.tier,
      text: req.body.text ?? existing.text,
      options: req.body.options ?? existing.options,
      answer: req.body.answer ?? existing.answer,
      explanation: req.body.explanation !== undefined ? req.body.explanation : existing.explanation,
      active: req.body.active !== undefined ? req.body.active : existing.active,
    }
    const result = validateQuestionDraft(merged)
    if (!result.ok) {
      res.status(400).json({ error: result.errors.join(' ') })
      return
    }

    try {
      let updated: Question | null = null
      assertTierStaysStocked(() => {
        updated = updateQuestion(id, result.draft!)
      })
      res.json({ question: updated })
    } catch (err) {
      res.status(409).json({ error: (err as Error).message })
    }
  })

  router.delete('/questions/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!getQuestion(id)) {
      res.status(404).json({ error: 'No such question' })
      return
    }
    try {
      assertTierStaysStocked(() => {
        deleteQuestion(id)
      })
      res.json({ ok: true })
    } catch (err) {
      res.status(409).json({ error: (err as Error).message })
    }
  })

  router.post('/questions/:id/stats/reset', (req, res) => {
    const id = Number(req.params.id)
    if (!getQuestion(id)) {
      res.status(404).json({ error: 'No such question' })
      return
    }
    resetQuestionStats(id)
    res.json({ question: getQuestion(id) })
  })

  router.post('/questions/stats/reset', (_req, res) => {
    resetQuestionStats()
    res.json({ ok: true })
  })

  // -- import / export -------------------------------------------------------

  router.get('/questions/export', (req, res) => {
    const rows = listQuestions().map(asRow)
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="medicine-ludo-questions.csv"')
      res.send(toCsv(EXPORT_HEADERS, rows))
      return
    }
    res.setHeader('Content-Disposition', 'attachment; filename="medicine-ludo-questions.json"')
    res.json({ questions: listQuestions() })
  })

  /**
   * Bulk import. Always reports what it *would* do; only writes when dryRun is off,
   * so an admin can look before they leap.
   */
  router.post('/questions/import', (req, res) => {
    const dryRun = req.body?.dryRun !== false
    let incoming: Array<Record<string, unknown>> = []

    try {
      if (typeof req.body?.csv === 'string') {
        incoming = parseCsvObjects(req.body.csv)
      } else if (typeof req.body?.json === 'string') {
        const parsed = JSON.parse(req.body.json)
        incoming = Array.isArray(parsed) ? parsed : (parsed.questions ?? [])
      } else if (Array.isArray(req.body?.questions)) {
        incoming = req.body.questions
      } else {
        res.status(400).json({ error: 'Provide `csv`, `json`, or a `questions` array.' })
        return
      }
    } catch (err) {
      res.status(400).json({ error: `Could not parse that: ${(err as Error).message}` })
      return
    }

    const plan: Array<{ row: number; action: 'create' | 'update' | 'reject'; detail: string }> = []
    const applies: Array<() => void> = []

    incoming.forEach((raw, i) => {
      const result = validateQuestionDraft(raw)
      if (!result.ok) {
        plan.push({ row: i + 1, action: 'reject', detail: result.errors.join(' ') })
        return
      }
      const draft = result.draft!
      const idRaw = raw.id ?? (raw as Record<string, unknown>).ID
      const id = idRaw === undefined || idRaw === null || idRaw === '' ? null : Number(idRaw)

      if (id !== null && Number.isFinite(id) && getQuestion(id)) {
        plan.push({ row: i + 1, action: 'update', detail: `#${id} ${draft.text.slice(0, 60)}` })
        applies.push(() => updateQuestion(id, draft))
        return
      }
      if (draft.sourceCard !== null && draft.sourceCard !== undefined) {
        const card = draft.sourceCard
        const exists = listQuestions().some((q) => q.sourceCard === card)
        plan.push({
          row: i + 1,
          action: exists ? 'update' : 'create',
          detail: `card ${card} ${draft.text.slice(0, 60)}`,
        })
        applies.push(() => upsertBySourceCard({ ...draft, sourceCard: card }))
        return
      }
      plan.push({ row: i + 1, action: 'create', detail: draft.text.slice(0, 60) })
      applies.push(() => createQuestion(draft))
    })

    const summary = {
      created: plan.filter((p) => p.action === 'create').length,
      updated: plan.filter((p) => p.action === 'update').length,
      rejected: plan.filter((p) => p.action === 'reject').length,
    }

    if (dryRun) {
      res.json({ dryRun: true, summary, plan })
      return
    }

    try {
      assertTierStaysStocked(() => {
        for (const apply of applies) apply()
      })
      res.json({ dryRun: false, summary, plan, counts: activeCountByTier() })
    } catch (err) {
      res.status(409).json({ error: (err as Error).message, summary, plan })
    }
  })

  /** Re-run the original PDF. Idempotent: matches on card number, keeps stats. */
  router.post('/questions/import-pdf', (req, res) => {
    const pdfPath =
      typeof req.body?.path === 'string' && req.body.path.trim()
        ? path.resolve(req.body.path.trim())
        : DEFAULT_PDF
    try {
      const result = importPdf(pdfPath)
      res.json({ ...result, counts: activeCountByTier() })
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  })

  return router
}
