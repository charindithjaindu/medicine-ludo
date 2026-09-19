import { DIFFICULTIES, isDifficulty, type Difficulty, type Question } from '@shared/types.js'
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

function guardStock(db: Db, before: Record<Difficulty, number>): string | null {
  const after = db.activeCountByDifficulty()
  const newlyEmpty = DIFFICULTIES.filter((t) => after[t] === 0 && before[t] > 0)
  if (newlyEmpty.length === 0) return null
  return (
    `That would leave difficulty ${newlyEmpty.join(', ')} with no active questions. ` +
    'Each available difficulty needs at least one active question.'
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
    const active = url.searchParams.get('active')
    const difficulty = url.searchParams.get('difficulty')
    const questions = db.listQuestions({
      difficulty: isDifficulty(difficulty) ? (difficulty as Difficulty) : undefined,
      active: active === null || active === 'all' ? undefined : active === 'true',
      search: url.searchParams.get('search') ?? undefined,
    })
    return json({
      questions,
      counts: db.activeCountByDifficulty(),
      difficultyCounts: db.activeCountByDifficulty(),
    })
  }

  if (path === '/questions' && request.method === 'POST') {
    const result = validateQuestionDraft(await request.json().catch(() => ({})))
    if (!result.ok) return json({ error: result.errors.join(' ') }, 400)
    return json({ question: db.createQuestion(result.draft!) }, 201)
  }

  if (path === '/questions/export' && request.method === 'GET') {
    const questions = db.listQuestions()
    if (url.searchParams.get('format') === 'csv') {
      const rows = questions.map((q) => ({
        id: q.id,
        difficulty: q.difficulty,
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
          'Run `npm run import:pdf` on the server with DATABASE_PATH set to the production database.',
      },
      501,
    )
  }

  if (path === '/questions/stats/reset' && request.method === 'POST') {
    db.resetQuestionStats()
    return json({ ok: true })
  }

  const statsMatch = path.match(/^\/questions\/(\d+)\/stats\/reset$/)
  if (statsMatch && request.method === 'POST') {
    const id = Number(statsMatch[1])
    if (!(db.getQuestion(id))) return json({ error: 'No such question' }, 404)
    db.resetQuestionStats(id)
    return json({ question: db.getQuestion(id) })
  }

  const idMatch = path.match(/^\/questions\/(\d+)$/)
  if (idMatch) {
    const id = Number(idMatch[1])
    const existing = db.getQuestion(id)
    if (!existing) return json({ error: 'No such question' }, 404)

    if (request.method === 'PATCH') {
      const patch = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const merged = {
        difficulty: patch.difficulty ?? existing.difficulty,
        text: patch.text ?? existing.text,
        options: patch.options ?? existing.options,
        answer: patch.answer ?? existing.answer,
        explanation: patch.explanation !== undefined ? patch.explanation : existing.explanation,
        active: patch.active !== undefined ? patch.active : existing.active,
      }
      const result = validateQuestionDraft(merged)
      if (!result.ok) return json({ error: result.errors.join(' ') }, 400)

      return db.sql.transaction(() => {
        const before = db.activeCountByDifficulty()
        const updated = db.updateQuestion(id, result.draft!)
        const problem = guardStock(db, before)
        if (problem) { db.updateQuestion(id, existing); return json({ error: problem }, 409) }
        return json({ question: updated })
      })
    }

    if (request.method === 'DELETE') {
      const counts = db.activeCountByDifficulty()
      if (existing.active && counts[existing.difficulty] <= 1) return json({ error: 'Keep at least one active question in this difficulty.' }, 409)
      db.deleteQuestion(id)
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

  const existing = db.listQuestions()
  const byId = new Map(existing.map((q) => [q.id, q]))
  const bySourceCard = new Set(existing.map((q) => q.sourceCard).filter((c) => c !== null))

  const plan: Array<{ row: number; action: 'create' | 'update' | 'reject'; detail: string }> = []
  const applies: Array<() => unknown> = []

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

  try {
    return db.sql.transaction(() => {
      const before = db.activeCountByDifficulty()
      for (const apply of applies) apply()
      const problem = guardStock(db, before)
      if (problem) throw new Error(problem)
      return json({ dryRun: false, summary, plan, counts: db.activeCountByDifficulty() })
    })
  } catch (error) { return json({ error: (error as Error).message, summary, plan }, 409) }
}
