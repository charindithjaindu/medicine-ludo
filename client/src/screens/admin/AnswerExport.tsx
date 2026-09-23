import { useState } from 'react'
import { topicLabel, type TopicCount } from '@shared/types.js'
import { adminApi } from '../../lib/api.ts'

/**
 * The research export: one row per attempt, straight from the answer log. A plain
 * link rather than a fetch, so the browser's own download handles a large file and
 * the session cookie goes along with it.
 */
export default function AnswerExport({ topics }: { topics: TopicCount[] }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // null = every topic; '' = General.
  const [topic, setTopic] = useState<string | null>(null)
  const backwards = from !== '' && to !== '' && from > to
  const url = (format: 'csv' | 'json') =>
    adminApi.answersExportUrl({ format, from, to, topic })

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="font-semibold">Export answer log (research data)</h2>
      <p className="mt-1 text-sm text-slate-600">
        Every answer by a human player: who, which question, topic, difficulty, the option
        chosen, the correct one, outcome (<code className="text-xs">correct</code> /{' '}
        <code className="text-xs">wrong</code> / <code className="text-xs">timeout</code>) and
        time in milliseconds. Computer players are never logged. Dates are whole days in UTC and
        both ends are included.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-500">Topic</span>
          <select
            value={topic === null ? 'all' : `t:${topic}`}
            onChange={(e) => setTopic(e.target.value === 'all' ? null : e.target.value.slice(2))}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="all">All topics</option>
            {topics.map((t) => (
              <option key={t.topic} value={`t:${t.topic}`}>
                {topicLabel(t.topic)}
              </option>
            ))}
          </select>
        </label>
        <a
          href={backwards ? undefined : url('csv')}
          aria-disabled={backwards}
          className={`rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 ${
            backwards ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          Export answer log (CSV)
        </a>
        <a
          href={backwards ? undefined : url('json')}
          aria-disabled={backwards}
          className={`rounded-lg bg-white px-4 py-2 font-semibold ring-1 ring-slate-300 hover:bg-slate-50 ${
            backwards ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          JSON
        </a>
      </div>
      {backwards && (
        <p className="mt-2 text-sm text-rose-700">"From" is after "To" — nothing would match.</p>
      )}
    </section>
  )
}
