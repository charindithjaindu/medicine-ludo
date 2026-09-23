import { useEffect, useMemo, useState } from 'react'
import type { AdminPlayerRow, PlayerProgress } from '@shared/types.js'
import { adminApi } from '../../lib/api.ts'
import { formatDateTime, formatDuration, formatPercent } from '../../lib/format.ts'
import ProgressView from '../../components/ProgressView.tsx'

type SortKey = 'seen' | 'answered' | 'accuracy' | 'name'

/**
 * Per-player figures from the answer log. Clicking a row opens the same progress
 * view the player sees for themselves, so a researcher and a student are always
 * looking at the same numbers.
 */
export default function Players() {
  const [players, setPlayers] = useState<AdminPlayerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('seen')
  const [open, setOpen] = useState<AdminPlayerRow | null>(null)

  useEffect(() => {
    adminApi
      .players()
      .then(setPlayers)
      .catch((err) => setError((err as Error).message))
  }, [])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (players ?? []).filter(
      (p) => !needle || p.id.includes(needle) || p.name.toLowerCase().includes(needle),
    )
    const by: Record<SortKey, (a: AdminPlayerRow, z: AdminPlayerRow) => number> = {
      seen: (a, z) => z.lastSeen.localeCompare(a.lastSeen),
      answered: (a, z) => z.answered - a.answered,
      // Players with nothing answered have no accuracy to speak of; keep them last.
      accuracy: (a, z) =>
        (z.answered ? z.accuracy : -1) - (a.answered ? a.accuracy : -1),
      name: (a, z) => a.name.localeCompare(z.name),
    }
    return [...list].sort(by[sort])
  }, [players, search, sort])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID or name…"
          className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="seen">Sort: last seen</option>
          <option value="answered">Sort: most answered</option>
          <option value="accuracy">Sort: highest accuracy</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5 text-center">Games</th>
              <th className="px-3 py-2.5 text-center">Answered</th>
              <th className="px-3 py-2.5 text-center">Accuracy</th>
              <th className="px-3 py-2.5 text-center">Avg / median</th>
              <th className="px-3 py-2.5 text-center">Timeouts</th>
              <th className="px-3 py-2.5">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {!players && !error && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {players && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  {players.length === 0 ? 'No players yet.' : 'No players match.'}
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr
                key={p.id}
                onClick={() => setOpen(p)}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2.5 font-mono">
                  <button className="hover:underline">{p.id}</button>
                </td>
                <td className="px-3 py-2.5">
                  {p.name || <span className="text-slate-400">Unnamed</span>}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums">{p.gamesPlayed}</td>
                <td className="px-3 py-2.5 text-center tabular-nums">{p.answered}</td>
                <td className="px-3 py-2.5 text-center tabular-nums">
                  {p.answered ? formatPercent(p.accuracy) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-center whitespace-nowrap tabular-nums">
                  {p.meanTimeMs === null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    `${formatDuration(p.meanTimeMs)} / ${formatDuration(p.medianTimeMs)}`
                  )}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums">{p.timeouts}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                  {formatDateTime(p.lastSeen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Figures come from the answer log, so they start with the first game played on v2. Accuracy
        counts a timeout as a miss; times leave timeouts out. The raw log is on the Import / Export
        tab.
      </p>

      {open && <ProgressModal row={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ProgressModal({ row, onClose }: { row: AdminPlayerRow; onClose: () => void }) {
  const [progress, setProgress] = useState<PlayerProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminApi
      .playerProgress(row.id)
      .then(setProgress)
      .catch((err) => setError((err as Error).message))
  }, [row.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-auto my-8 w-full max-w-3xl rounded-2xl bg-slate-100 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{row.name || 'Unnamed player'}</h2>
            <p className="font-mono text-xs text-slate-500">{row.id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            ✕
          </button>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {!progress && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {progress && <ProgressView progress={progress} />}
      </div>
    </div>
  )
}
