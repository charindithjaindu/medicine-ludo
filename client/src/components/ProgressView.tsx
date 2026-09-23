import { useMemo, useState } from 'react'
import {
  ANSWER_LETTERS,
  topicLabel,
  type AnswerOutcome,
  type PlayerProgress,
  type ProgressMistake,
  type ProgressTrendPoint,
  type TopicStats,
} from '@shared/types.js'
import { formatDate, formatDateTime, formatDuration, formatPercent } from '../lib/format.ts'
import { Panel } from './ui.tsx'

/** The most games a topic's trend shows; older ones are still in the totals. */
const TREND_GAMES = 12

/**
 * One player's learning record. Used by the player's own "My progress" screen and
 * by the admin Players tab, so both see exactly the same thing.
 *
 * Every heading sits inside a panel, so this reads the same on the night-table
 * backdrop and on the admin's white page.
 */
export default function ProgressView({ progress }: { progress: PlayerProgress }) {
  const { totals, byTopic, trend, mistakes, recent } = progress

  const trendByTopic = useMemo(() => {
    const map = new Map<string, ProgressTrendPoint[]>()
    for (const point of trend) {
      if (!map.has(point.topic)) map.set(point.topic, [])
      map.get(point.topic)!.push(point)
    }
    for (const points of map.values()) points.sort((a, z) => a.playedAt.localeCompare(z.playedAt))
    return map
  }, [trend])

  if (totals.answered === 0) {
    return (
      <Panel className="animate-pop-in p-8 text-center">
        <p className="text-5xl animate-bob">📚</p>
        <p className="mt-3 text-lg font-semibold">Nothing to show yet</p>
        <p className="mt-1 text-sm text-ink/60">
          Play a game and answer a few questions — your accuracy, your topics and the questions
          worth another look will show up here.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <Panel className="animate-rise-in p-4">
        <SectionTitle>Overall</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Accuracy" value={formatPercent(totals.accuracy)} tone="amber" />
          <Stat label="Answered" value={String(totals.answered)} />
          <Stat
            label="Skipped (time ran out)"
            value={String(totals.timeouts)}
            tone={totals.timeouts > 0 ? 'rose' : undefined}
          />
          <Stat label="Median time" value={formatDuration(totals.medianTimeMs)} />
        </div>
        <p className="mt-2 text-xs text-ink/55">
          {totals.correct} right · {totals.wrong} wrong · {totals.timeouts} skipped. A skipped
          question counts as a miss. Times only cover questions you answered.
        </p>
      </Panel>

      {byTopic.length > 0 && (
        <Panel className="animate-rise-in p-4 delay-1">
          <SectionTitle>By topic</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {byTopic.map((t) => (
              <TopicCard key={t.topic} stats={t} points={trendByTopic.get(t.topic) ?? []} />
            ))}
          </div>
        </Panel>
      )}

      <Panel className="animate-rise-in p-4 delay-2">
        <SectionTitle>Questions to revisit</SectionTitle>
        {mistakes.length === 0 ? (
          <p className="text-sm text-ink/60">
            None — you have not missed a question yet. 🎉
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink/55">
              Questions you got wrong or ran out of time on, newest first. Tap one to see the
              answer.
            </p>
            <ul className="space-y-2">
              {mistakes.map((m) => (
                <MistakeItem key={m.questionId} mistake={m} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {recent.length > 0 && (
        <Panel className="animate-rise-in p-4 delay-3">
          <SectionTitle>Recent answers</SectionTitle>
          <ul className="divide-y-2 divide-ink/10">
            {recent.map((a, i) => (
              <li key={`${a.answeredAt}-${i}`} className="flex items-start gap-2.5 py-2">
                <OutcomeIcon outcome={a.outcome} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{a.questionText}</p>
                  <p className="mt-0.5 text-xs text-ink/55">
                    {topicLabel(a.topic)} ·{' '}
                    {a.outcome === 'timeout'
                      ? 'Skipped (time ran out)'
                      : a.outcome === 'correct'
                        ? `You: ${a.chosen} ✓`
                        : `You: ${a.chosen} · Correct: ${a.correctLetter}`}
                    {a.outcome !== 'timeout' && ` · ${formatDuration(a.timeMs)}`} ·{' '}
                    {formatDateTime(a.answeredAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-sm font-bold uppercase tracking-wide text-ink/50">{children}</h2>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'amber' | 'rose'
}) {
  const bg = tone === 'amber' ? 'bg-amber-200' : tone === 'rose' ? 'bg-rose-100' : 'bg-white'
  return (
    <div className={`rounded-xl border-[3px] border-ink px-3 py-2 ${bg}`}>
      <p className="text-2xl font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-xs font-medium leading-tight text-ink/60">{label}</p>
    </div>
  )
}

function TopicCard({ stats, points }: { stats: TopicStats; points: ProgressTrendPoint[] }) {
  return (
    <div className="rounded-xl border-[3px] border-ink bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate font-semibold">{topicLabel(stats.topic)}</p>
        <p className="text-xl font-bold tabular-nums">{formatPercent(stats.accuracy)}</p>
      </div>
      <p className="text-xs text-ink/60">
        {stats.correct}/{stats.answered} right
        {stats.timeouts > 0 && ` · ${stats.timeouts} skipped`} · median{' '}
        {formatDuration(stats.medianTimeMs)}
      </p>
      <Trend points={points} />
    </div>
  )
}

/**
 * Accuracy per game as a row of bars, oldest on the left. It answers the one
 * question the page exists for — "am I getting better at this?" — without a chart
 * library.
 */
function Trend({ points }: { points: ProgressTrendPoint[] }) {
  const shown = points.slice(-TREND_GAMES)
  if (shown.length < 2) {
    return (
      <p className="mt-2 text-xs text-ink/45">
        {shown.length === 1 ? 'Play this topic again to see a trend.' : ''}
      </p>
    )
  }
  const bar = 10
  const gap = 4
  const height = 36
  const width = shown.length * (bar + gap) - gap
  const rates = shown.map((p) => (p.answered > 0 ? p.correct / p.answered : 0))
  const label = `Accuracy over your last ${shown.length} games: ${rates
    .map((r) => formatPercent(r))
    .join(', ')}`

  return (
    <div className="mt-2">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
      >
        <line
          x1={0}
          x2={width}
          y1={height - 0.5}
          y2={height - 0.5}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        {shown.map((p, i) => {
          const r = rates[i]
          // A sliver even at 0%, so a game you played never looks like one you didn't.
          const h = Math.max(2, r * (height - 2))
          return (
            <rect
              key={p.gameId}
              x={i * (bar + gap)}
              y={height - h}
              width={bar}
              height={h}
              rx={2}
              className={r >= 0.7 ? 'fill-emerald-500' : r >= 0.4 ? 'fill-amber-400' : 'fill-rose-400'}
            >
              <title>{`${formatDate(p.playedAt)}: ${p.correct}/${p.answered} right`}</title>
            </rect>
          )
        })}
      </svg>
      <p className="mt-0.5 text-[0.7rem] text-ink/45">
        Last {shown.length} games, oldest first
      </p>
    </div>
  )
}

function MistakeItem({ mistake: m }: { mistake: ProgressMistake }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border-[3px] border-ink bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium leading-snug ${open ? '' : 'line-clamp-2'}`}>
            {m.questionText}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink/55">
            <TopicTag topic={m.topic} />
            <span>
              seen {m.timesSeen}× · last missed {formatDate(m.lastWrongAt)}
            </span>
            {m.nowCorrect && (
              <span className="rounded-full border-2 border-emerald-600 bg-emerald-100 px-2 font-semibold text-emerald-800">
                Now correct ✓
              </span>
            )}
          </p>
        </div>
        <span aria-hidden className={`mt-0.5 text-ink/40 transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t-2 border-ink/10 px-3 pb-3 pt-2">
          <AnswerLine
            tone="bad"
            letter={m.lastWrongChoice}
            text={
              m.lastWrongChoice
                ? m.options[ANSWER_LETTERS.indexOf(m.lastWrongChoice)]
                : 'Skipped (time ran out)'
            }
            caption="Your answer"
          />
          <AnswerLine
            tone="good"
            letter={m.correctLetter}
            text={m.options[ANSWER_LETTERS.indexOf(m.correctLetter)]}
            caption="Correct answer"
          />
          {m.explanation && <Explanation text={m.explanation} />}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Pieces shared with the in-game reveal and the end-of-game review.
// ---------------------------------------------------------------------------

export function TopicTag({ topic, className = '' }: { topic: string; className?: string }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-ink bg-sky-100 px-2 text-xs font-semibold text-ink ${className}`}
    >
      {topicLabel(topic)}
    </span>
  )
}

/** One option, marked as the right one or the one that was picked instead. */
export function AnswerLine({
  tone,
  letter,
  text,
  caption,
}: {
  tone: 'good' | 'bad'
  letter: string | null
  text: string
  caption?: string
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border-[3px] px-3 py-2 ${
        tone === 'good' ? 'border-emerald-600 bg-emerald-50' : 'border-rose-400 bg-rose-50'
      }`}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border-2 border-ink font-mono text-sm font-bold ${
          tone === 'good' ? 'bg-emerald-300' : 'bg-rose-200'
        }`}
      >
        {letter ?? '⏱'}
      </span>
      <div className="min-w-0 flex-1">
        {caption && (
          <p
            className={`text-[0.7rem] font-bold uppercase tracking-wide ${
              tone === 'good' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {caption}
          </p>
        )}
        <p className="font-medium leading-snug">{text}</p>
      </div>
    </div>
  )
}

export function Explanation({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-ink/30 bg-amber-50 px-3 py-2">
      <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink/50">Why</p>
      <p className="text-[0.95rem] leading-snug text-ink/85">{text}</p>
    </div>
  )
}

export function OutcomeIcon({ outcome }: { outcome: AnswerOutcome }) {
  const map = {
    correct: { icon: '✓', cls: 'bg-emerald-300', label: 'Correct' },
    wrong: { icon: '✗', cls: 'bg-rose-300', label: 'Wrong' },
    timeout: { icon: '⏱', cls: 'bg-slate-200', label: 'Skipped (time ran out)' },
  }[outcome]
  return (
    <span
      title={map.label}
      aria-label={map.label}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-bold ${map.cls}`}
    >
      {map.icon}
    </span>
  )
}
