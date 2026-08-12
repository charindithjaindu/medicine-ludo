import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DIFFICULTIES,
  DIFFICULTY_EMOJI,
  DIFFICULTY_NAMES,
  TIER_NAMES,
  TIERS,
  type Difficulty,
  type Question,
  type Tier,
} from '@shared/types.js'
import { adminApi } from '../../lib/api.ts'
import QuestionEditor from './QuestionEditor.tsx'
import ImportExport from './ImportExport.tsx'

/**
 * The admin panel. Reached only by typing /admin — nothing in the player UI links
 * here, and an unauthenticated visitor sees a bare password box with no hint of
 * what is behind it.
 */
export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    adminApi
      .session()
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) return <div className="grid min-h-full place-items-center" />
  if (!authed) return <Login onIn={() => setAuthed(true)} />
  return <Console onOut={() => setAuthed(false)} />
}

function Login({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi.login(password)
      onIn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-slate-900 p-6">
      <form onSubmit={submit} className="w-full max-w-xs">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border-0 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-slate-500"
        />
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-3 w-full rounded-lg bg-white px-4 py-2.5 font-semibold text-slate-900 disabled:opacity-40"
        >
          {busy ? '…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

type SortKey = 'default' | 'rate' | 'asked'

function Console({ onOut }: { onOut: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [counts, setCounts] = useState<Record<Tier, number> | null>(null)
  const [difficultyCounts, setDifficultyCounts] = useState<Record<Difficulty, number> | null>(null)
  const [tier, setTier] = useState<Tier | ''>('')
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('default')
  const [editing, setEditing] = useState<Question | 'new' | null>(null)
  const [tab, setTab] = useState<'questions' | 'import'>('questions')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await adminApi.questions({ tier, difficulty, active: activeFilter, search })
      setQuestions(r.questions)
      setCounts(r.counts)
      setDifficultyCounts(r.difficultyCounts)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [tier, difficulty, activeFilter, search])

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const rows = useMemo(() => {
    const withRate = questions.map((q) => ({
      q,
      rate: q.timesAsked > 0 ? q.timesCorrect / q.timesAsked : null,
    }))
    if (sort === 'rate') {
      // Unasked questions have no signal, so they sort to the bottom.
      withRate.sort((a, z) => (a.rate ?? 2) - (z.rate ?? 2))
    } else if (sort === 'asked') {
      withRate.sort((a, z) => z.q.timesAsked - a.q.timesAsked)
    }
    return withRate
  }, [questions, sort])

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      setError(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <h1 className="font-bold">Medicine Ludo · Admin</h1>
          <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <TabButton active={tab === 'questions'} onClick={() => setTab('questions')}>
              Questions
            </TabButton>
            <TabButton active={tab === 'import'} onClick={() => setTab('import')}>
              Import / Export
            </TabButton>
          </nav>
          <span className="flex-1" />
          <button
            onClick={() => adminApi.logout().then(onOut)}
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-5">
        {counts && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => setTier(tier === t ? '' : t)}
                className={`rounded-lg px-2 py-2 text-left text-xs ring-1 transition ${
                  tier === t
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : counts[t] === 0
                      ? 'bg-rose-50 ring-rose-300'
                      : 'bg-white ring-slate-200 hover:ring-slate-400'
                }`}
              >
                <span className="block font-semibold">{TIER_NAMES[t]}</span>
                <span className={tier === t ? 'text-slate-300' : 'text-slate-500'}>
                  die {t} · {counts[t]} active
                </span>
              </button>
            ))}
          </div>
        )}

        {difficultyCounts && (
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(difficulty === d ? '' : d)}
                className={`rounded-lg px-2 py-2 text-left text-xs ring-1 transition ${
                  difficulty === d
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : difficultyCounts[d] === 0
                      ? 'bg-rose-50 ring-rose-300'
                      : 'bg-white ring-slate-200 hover:ring-slate-400'
                }`}
              >
                <span className="block font-semibold">
                  {DIFFICULTY_EMOJI[d]} {DIFFICULTY_NAMES[d]}
                </span>
                <span className={difficulty === d ? 'text-slate-300' : 'text-slate-500'}>
                  {difficultyCounts[d]} active · a room can pick this
                </span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </p>
        )}

        {tab === 'import' ? (
          <ImportExport onChanged={load} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search question or option text…"
                className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
              <select
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="true">Active only</option>
                <option value="false">Retired only</option>
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="default">Sort: tier order</option>
                <option value="rate">Sort: worst correct-rate first</option>
                <option value="asked">Sort: most asked</option>
              </select>
              <button
                onClick={() => setEditing('new')}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                New question
              </button>
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Tier</th>
                    <th className="px-3 py-2.5">Difficulty</th>
                    <th className="px-3 py-2.5">Question</th>
                    <th className="px-3 py-2.5 text-center">Ans</th>
                    <th className="px-3 py-2.5 text-center">Asked</th>
                    <th className="px-3 py-2.5 text-center">Correct</th>
                    <th className="px-3 py-2.5 text-center">Timeouts</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                        Loading…
                      </td>
                    </tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                        No questions match.
                      </td>
                    </tr>
                  )}
                  {rows.map(({ q, rate }) => (
                    <tr
                      key={q.id}
                      className={`border-t border-slate-100 ${q.active ? '' : 'bg-slate-50 text-slate-400'}`}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                          {q.tier} · {TIER_NAMES[q.tier]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800">
                          {DIFFICULTY_EMOJI[q.difficulty]} {DIFFICULTY_NAMES[q.difficulty]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={() => setEditing(q)}
                          className="text-left hover:underline"
                          title={q.text}
                        >
                          {q.text.length > 90 ? q.text.slice(0, 90) + '…' : q.text}
                        </button>
                        {!q.active && <span className="ml-2 text-xs">(retired)</span>}
                        {q.sourceCard && (
                          <span className="ml-2 text-xs text-slate-400">card {q.sourceCard}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono font-bold">{q.answer}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{q.timesAsked}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        {rate === null ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <span
                            className={
                              rate <= 0.15
                                ? 'font-semibold text-rose-600'
                                : rate >= 0.95
                                  ? 'font-semibold text-amber-600'
                                  : ''
                            }
                          >
                            {Math.round(rate * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{q.timesTimeout}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => act(() => adminApi.update(q.id, { active: !q.active }))}
                          className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          {q.active ? 'Retire' : 'Restore'}
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete this question permanently?\n\n${q.text}`)) {
                              act(() => adminApi.remove(q.id))
                            }
                          }}
                          className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              A low correct-rate usually means the card is ambiguous or the answer is wrong. A
              correct-rate near 100% on a hard tier means it belongs in an easier one. Retiring
              keeps a question's stats and pulls it out of future games.
            </p>
          </>
        )}
      </main>

      {editing && (
        <QuestionEditor
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 font-medium transition ${
        active ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  )
}
