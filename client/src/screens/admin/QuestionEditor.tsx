import { useState } from 'react'
import {
  ANSWER_LETTERS,
  DIFFICULTIES,
  DIFFICULTY_EMOJI,
  DIFFICULTY_NAMES,
  type AnswerLetter,
  type Difficulty,
  type Question,
} from '@shared/types.js'
import { adminApi } from '../../lib/api.ts'

export default function QuestionEditor({
  question,
  onClose,
  onSaved,
}: {
  question: Question | null
  onClose: () => void
  onSaved: () => void
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>(
    question?.difficulty ?? 'easy',
  )
  const [text, setText] = useState(question?.text ?? '')
  const [options, setOptions] = useState<string[]>(question?.options ?? ['', '', '', ''])
  const [answer, setAnswer] = useState<AnswerLetter>(question?.answer ?? 'A')
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [active, setActive] = useState(question?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      difficulty,
      text,
      options,
      answer,
      explanation: explanation || null,
      active,
    }
    try {
      if (question) await adminApi.update(question.id, body)
      else await adminApi.create(body)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resetStats() {
    if (!question) return
    try {
      await adminApi.resetStats(question.id)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const rate =
    question && question.timesAsked > 0
      ? Math.round((question.timesCorrect / question.timesAsked) * 100)
      : null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/60 p-4">
      <form
        onSubmit={save}
        className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{question ? 'Edit question' : 'New question'}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900">
            ✕
          </button>
        </div>

        {question && (
          <p className="mt-1 text-xs text-slate-500">
            #{question.id}
            {question.sourceCard && ` · PDF card ${question.sourceCard}`} · asked{' '}
            {question.timesAsked}×
            {rate !== null && ` · ${rate}% correct`} · {question.timesTimeout} timeouts
            {question.timesAsked > 0 && (
              <button
                type="button"
                onClick={resetStats}
                className="ml-2 underline underline-offset-2 hover:text-slate-900"
              >
                reset stats
              </button>
            )}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">
              Difficulty{' '}
              <span className="text-slate-400">
                — rooms are filtered by this, so it decides who ever sees this card
              </span>
            </label>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  className={`rounded-lg px-2 py-1.5 text-sm ring-1 transition ${
                    difficulty === d
                      ? 'bg-slate-900 text-white ring-slate-900'
                      : 'bg-white ring-slate-200 hover:ring-slate-400'
                  }`}
                >
                  {DIFFICULTY_EMOJI[d]} {DIFFICULTY_NAMES[d]}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Question</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">
              Options — click the letter to mark the correct one
            </span>
            <div className="mt-1 space-y-2">
              {ANSWER_LETTERS.map((letter, i) => (
                <div key={letter} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAnswer(letter)}
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-mono font-bold transition ${
                      answer === letter
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title={answer === letter ? 'Correct answer' : 'Mark as correct'}
                  >
                    {letter}
                  </button>
                  <input
                    value={options[i]}
                    onChange={(e) => {
                      const next = [...options]
                      next[i] = e.target.value
                      setOptions(next)
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
                  />
                </div>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Explanation <span className="text-slate-400">(optional, shown on reveal)</span>
            </span>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Active — include in future games</span>
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-white px-4 py-2.5 font-medium ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
