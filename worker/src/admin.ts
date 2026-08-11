/**
 * Admin API on Workers.
 *
 * Same rules as before — password login, signed session cookie, questions CRUD,
 * bulk import with a dry run, and the invariant that a tier can never reach zero
 * active questions. Signing moves from node:crypto to Web Crypto.
 *
 * Re-importing the source PDF is not available here: it shells out to `pdftotext`,
 * which does not exist on Workers. Run `npm run import:pdf -- --remote` instead.
 */

import { TIERS, type Question, type Tier } from '@shared/types.js'
import { validateQuestionDraft } from '@shared/validate.js'
import { parseCsvObjects, toCsv } from './csv.js'
import type { Db } from './db.js'

const COOKIE_NAME = 'ml_admin'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

const encoder = new TextEncoder()

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function signSession(secret: string, expiresAt: number): Promise<string> {
  return `${expiresAt}.${await hmac(secret, String(expiresAt))}`
}

async function verifySession(secret: string, token: string | null): Promise<boolean> {
  if (!token) return false
  const [expPart, mac] = token.split('.')
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !mac) return false
  const expected = await hmac(secret, expPart)
  return timingSafeEqual(mac, expected)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

export interface AdminEnv {
  ADMIN_PASSWORD?: string
  SESSION_SECRET?: string
}

/**
 * The die face picks the tier, so a tier with no active questions is a roll the
 * game cannot answer. Every mutation is checked against this.
 */
async function guardTierStock(db: Db, before: Record<Tier, number>): Promise<string | null> {
  const after = await db.activeCountByTier()
  const newlyEmpty = TIERS.filter((t) => after[t] === 0 && before[t] > 0)
  if (newlyEmpty.length === 0) return null
  return (
    `That would leave tier ${newlyEmpty.join(', ')} with no active questions. ` +
    'Every tier needs at least one, because the die face picks the tier.'
  )
}

export async function handleAdmin(
  request: Request,
  path: string,
  db: Db,
  env: AdminEnv,
): Promise<Response> {
  const secret = env.SESSION_SECRET || 'insecure-dev-secret-change-me'
  const url = new URL(request.url)

  if (path === '/login' && request.method === 'POST') {
    if (!env.ADMIN_PASSWORD) {
      return json({ error: 'ADMIN_PASSWORD is not set on the server.' }, 500)
    }
    const body = (await request.json().catch(() => ({}))) as { password?: string }
    const supplied = await hmac('pw', body.password ?? '')
    const expected = await hmac('pw', env.ADMIN_PASSWORD)
    if (!timingSafeEqual(supplied, expected)) {
      return json({ error: 'Incorrect password' }, 401)
    }
    const token = await signSession(secret, Date.now() + SESSION_TTL_MS)
    const secure = url.protocol === 'https:' ? '; Secure' : ''
    return json(
      { ok: true },
      200,
      {
        'set-cookie': `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`,
      },
    )
  }

  if (path === '/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, {
      'set-cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    })
  }

  const authed = await verifySession(secret, readCookie(request, COOKIE_NAME))

  if (path === '/session') return json({ authenticated: authed })
  if (!authed) return json({ error: 'Not signed in' }, 401)

  // -- everything below requires a session ----------------------------------

  if (path === '/questions' && request.method === 'GET') {
    const tier = url.searchParams.get('tier')
    const active = url.searchParams.get('active')
    const questions = await db.listQuestions({
      tier: tier ? (Number(tier) as Tier) : undefined,
      active: active === null || active === 'all' ? undefined : active === 'true',
      search: url.searchParams.get('search') ?? undefined,
    })
    return json({ questions, counts: await db.activeCountByTier() })
  }

  if (path === '/questions' && request.method === 'POST') {
    const result = validateQuestionDraft(await request.json().catch(() => ({})))
    if (!result.ok) return json({ error: result.errors.join(' ') }, 400)
    return json({ question: await db.createQuestion(result.draft!) }, 201)
  }

  if (path === '/questions/export' && request.method === 'GET') {
    const questions = await db.listQuestions()
    if (url.searchParams.get('format') === 'csv') {
      const rows = questions.map((q) => ({
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
      }))
      return new Response(toCsv(Object.keys(rows[0] ?? {}), rows), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="medicine-ludo-questions.csv"',
        },
      })
    }
    return json({ questions }, 200, {
      'content-disposition': 'attachment; filename="medicine-ludo-questions.json"',
    })
  }

  if (path === '/questions/import' && request.method === 'POST') {
    return handleImport(request, db)
  }

  if (path === '/questions/import-pdf' && request.method === 'POST') {
    return json(
      {
        error:
          'The PDF importer needs pdftotext, which Workers cannot run. ' +
          'Run `npm run import:pdf -- --remote` from your machine instead.',
      },
      501,
    )
  }

  if (path === '/questions/stats/reset' && request.method === 'POST') {
    await db.resetQuestionStats()
    return json({ ok: true })
  }

  const statsMatch = path.match(/^\/questions\/(\d+)\/stats\/reset$/)
  if (statsMatch && request.method === 'POST') {
    const id = Number(statsMatch[1])
    if (!(await db.getQuestion(id))) return json({ error: 'No such question' }, 404)
    await db.resetQuestionStats(id)
    return json({ question: await db.getQuestion(id) })
  }

  const idMatch = path.match(/^\/questions\/(\d+)$/)
  if (idMatch) {
    const id = Number(idMatch[1])
    const existing = await db.getQuestion(id)
    if (!existing) return json({ error: 'No such question' }, 404)

    if (request.method === 'PATCH') {
      const patch = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const merged = {
        tier: patch.tier ?? existing.tier,
        text: patch.text ?? existing.text,
        options: patch.options ?? existing.options,
        answer: patch.answer ?? existing.answer,
        explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
        active: patch.active !== undefined ? patch.active : existing.active,
      }
      const result = validateQuestionDraft(merged)
      if (!result.ok) return json({ error: result.errors.join(' ') }, 400)

      const before = await db.activeCountByTier()
      const updated = await db.updateQuestion(id, result.draft!)
      const problem = await guardTierStock(db, before)
      if (problem) {
        await db.updateQuestion(id, existing) // D1 has no interactive rollback; put it back
        return json({ error: problem }, 409)
      }
      return json({ question: updated })
    }

    if (request.method === 'DELETE') {
      const before = await db.activeCountByTier()
      await db.deleteQuestion(id)
      const problem = await guardTierStock(db, before)
      if (problem) {
        await db.createQuestion(existing) // restore; it gets a new id
        return json({ error: problem }, 409)
      }
      return json({ ok: true })
    }
  }

  return json({ error: 'Not found' }, 404)
}

async function handleImport(request: Request, db: Db): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    csv?: string
    json?: string
    questions?: unknown[]
    dryRun?: boolean
  }
  const dryRun = body.dryRun !== false

  let incoming: Array<Record<string, unknown>> = []
  try {
    if (typeof body.csv === 'string') incoming = parseCsvObjects(body.csv)
    else if (typeof body.json === 'string') {
      const parsed = JSON.parse(body.json)
      incoming = Array.isArray(parsed) ? parsed : (parsed.questions ?? [])
    } else if (Array.isArray(body.questions)) {
      incoming = body.questions as Array<Record<string, unknown>>
    } else {
      return json({ error: 'Provide `csv`, `json`, or a `questions` array.' }, 400)
    }
  } catch (err) {
    return json({ error: `Could not parse that: ${(err as Error).message}` }, 400)
  }

  const existing = await db.listQuestions()
  const byId = new Map(existing.map((q) => [q.id, q]))
  const bySourceCard = new Set(existing.map((q) => q.sourceCard).filter((c) => c !== null))

  const plan: Array<{ row: number; action: 'create' | 'update' | 'reject'; detail: string }> = []
  const applies: Array<() => Promise<unknown>> = []

  incoming.forEach((raw, i) => {
    const result = validateQuestionDraft(raw)
    if (!result.ok) {
      plan.push({ row: i + 1, action: 'reject', detail: result.errors.join(' ') })
      return
    }
    const draft = result.draft!
    const rawId = raw.id ?? raw.ID
    const id = rawId === undefined || rawId === null || rawId === '' ? null : Number(rawId)

    if (id !== null && byId.has(id)) {
      plan.push({ row: i + 1, action: 'update', detail: `#${id} ${draft.text.slice(0, 60)}` })
      applies.push(() => db.updateQuestion(id, draft))
      return
    }
    if (draft.sourceCard !== null && draft.sourceCard !== undefined) {
      const card = draft.sourceCard
      plan.push({
        row: i + 1,
        action: bySourceCard.has(card) ? 'update' : 'create',
        detail: `card ${card} ${draft.text.slice(0, 60)}`,
      })
      applies.push(() => db.upsertBySourceCard({ ...draft, sourceCard: card }))
      return
    }
    plan.push({ row: i + 1, action: 'create', detail: draft.text.slice(0, 60) })
    applies.push(() => db.createQuestion(draft))
  })

  const summary = {
    created: plan.filter((p) => p.action === 'create').length,
    updated: plan.filter((p) => p.action === 'update').length,
    rejected: plan.filter((p) => p.action === 'reject').length,
  }

  if (dryRun) return json({ dryRun: true, summary, plan })

  const before = await db.activeCountByTier()
  for (const apply of applies) await apply()
  const problem = await guardTierStock(db, before)
  if (problem) return json({ error: problem, summary, plan }, 409)

  return json({ dryRun: false, summary, plan, counts: await db.activeCountByTier() })
}

export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith('/api/admin')
}
