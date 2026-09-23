import { useState } from 'react'
import type { TopicCount } from '@shared/types.js'
import { adminApi, type ImportResponse } from '../../lib/api.ts'
import AnswerExport from './AnswerExport.tsx'

/**
 * Bulk import always previews first. The dry run reports exactly what would be
 * created, updated and rejected, and writes nothing — so an admin can look before
 * they leap.
 */
export default function ImportExport({
  onChanged,
  topics,
}: {
  onChanged: () => void
  topics: TopicCount[]
}) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [payload, setPayload] = useState('')
  const [preview, setPreview] = useState<ImportResponse | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(dryRun: boolean) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const body = format === 'csv' ? { csv: payload, dryRun } : { json: payload, dryRun }
      const result = await adminApi.importText(body)
      setPreview(result)
      if (!dryRun) {
        setMessage(
          `Imported: ${result.summary.created} created, ${result.summary.updated} updated, ${result.summary.rejected} rejected.`,
        )
        onChanged()
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function reimportPdf() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await adminApi.importPdf()
      setMessage(
        `PDF: parsed ${r.parsed}, created ${r.created}, updated ${r.updated}.` +
          (r.problems.length ? ` ${r.problems.length} card(s) skipped.` : ' No problems.'),
      )
      if (r.problems.length) setError(r.problems.join('\n'))
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPayload(await file.text())
    setFormat(file.name.endsWith('.json') ? 'json' : 'csv')
    setPreview(null)
  }

  return (
    <div className="space-y-4">
      <AnswerExport topics={topics} />

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Export questions</h2>
        <p className="mt-1 text-sm text-slate-600">
          Download the whole bank, topics included. Re-importing an export updates the same rows rather than
          duplicating them, so it doubles as a backup.
        </p>
        <div className="mt-3 flex gap-2">
          <a
            href={adminApi.exportUrl('csv')}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Download CSV
          </a>
          <a
            href={adminApi.exportUrl('json')}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Download JSON
          </a>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Bulk import</h2>
        <p className="mt-1 text-sm text-slate-600">
          Columns: <code className="text-xs">difficulty, text, option_a, option_b, option_c, option_d,
          answer</code> — difficulty is one of (
          <code className="text-xs">easy</code> / <code className="text-xs">medium</code> /{' '}
          <code className="text-xs">hard</code>). Optional:{' '}
          <code className="text-xs">topic</code> (free text, up to 40 characters — match an
          existing topic's spelling; blank means General, and leaving the column out keeps
          existing topics),{' '}
          <code className="text-xs">id</code>, <code className="text-xs">source_card</code>,{' '}
          <code className="text-xs">explanation</code>, <code className="text-xs">active</code>. A
          row with a matching <code className="text-xs">id</code> or{' '}
          <code className="text-xs">source_card</code> updates that question; anything else is
          created.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={onFile}
            className="text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>

        <textarea
          value={payload}
          onChange={(e) => {
            setPayload(e.target.value)
            setPreview(null)
          }}
          rows={8}
          placeholder={
            format === 'csv'
              ? 'difficulty,topic,text,option_a,option_b,option_c,option_d,answer\neasy,Jaundice,What is…,First,Second,Third,Fourth,B'
              : '[{"difficulty":"easy","topic":"Jaundice","text":"What is…","options":["a","b","c","d"],"answer":"B"}]'
          }
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-slate-900"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy || !payload.trim()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
          >
            Preview (dry run)
          </button>
          <button
            onClick={() => run(false)}
            disabled={busy || !preview || preview.summary.created + preview.summary.updated === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Apply import
          </button>
        </div>

        {preview && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
            <p className="font-medium">
              {preview.dryRun ? 'Dry run — nothing written.' : 'Applied.'} {preview.summary.created}{' '}
              create, {preview.summary.updated} update, {preview.summary.rejected} rejected.
            </p>
            <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto text-xs">
              {preview.plan.map((p) => (
                <li
                  key={p.row}
                  className={p.action === 'reject' ? 'text-rose-700' : 'text-slate-600'}
                >
                  <span className="inline-block w-10 text-slate-400">#{p.row}</span>
                  <span className="inline-block w-16 font-medium">{p.action}</span>
                  {p.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Re-import the source PDF</h2>
        <p className="mt-1 text-sm text-slate-600">
          Re-reads <code className="text-xs">tiered qa cards.pdf</code> and matches on card number,
          so edits to the original 90 are corrected in place and their stats are kept. Cards you
          authored here are untouched.
        </p>
        <button
          onClick={reimportPdf}
          disabled={busy}
          className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
        >
          Re-import PDF
        </button>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold">Statistics</h2>
        <p className="mt-1 text-sm text-slate-600">
          Clear every question's asked / correct / timeout counters — useful at the start of a new
          cohort. Question content is not touched.
        </p>
        <button
          onClick={() => {
            if (confirm("Reset every question's statistics?")) {
              adminApi.resetAllStats().then(onChanged).catch((e) => setError(e.message))
            }
          }}
          className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-300 hover:bg-rose-50"
        >
          Reset all statistics
        </button>
      </section>

      {message && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200">
          {message}
        </p>
      )}
      {error && (
        <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 px-4 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200">
          {error}
        </pre>
      )}
    </div>
  )
}
