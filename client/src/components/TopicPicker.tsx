import { useEffect, useState } from 'react'
import { topicLabel, type Difficulty, type TopicCount } from '@shared/types.js'
import { api } from '../lib/api.ts'
import { audio } from '../lib/audio.ts'

/** The topics a room can draw from at this difficulty, or null while loading. */
export function useTopics(difficulty: Difficulty): TopicCount[] | null {
  const [topics, setTopics] = useState<TopicCount[] | null>(null)
  useEffect(() => {
    let live = true
    api
      .topics(difficulty)
      .then((t) => live && setTopics(t))
      // Without the list the room simply plays every topic, which is the default anyway.
      .catch(() => live && setTopics([]))
    return () => {
      live = false
    }
  }, [difficulty])
  return topics
}

/**
 * Multi-select chips. An empty selection means every topic, and it is what "All
 * topics" selects — so there is never a state where nothing at all is picked.
 */
export default function TopicPicker({
  topics,
  value,
  onChange,
  disabled = false,
}: {
  topics: TopicCount[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const total = topics.reduce((n, t) => n + t.count, 0)

  function toggle(topic: string) {
    audio.play('click')
    const next = value.includes(topic) ? value.filter((t) => t !== topic) : [...value, topic]
    // Every topic ticked one by one is the same deck as "All topics"; say so.
    onChange(next.length === topics.length ? [] : next)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Chip
        active={value.length === 0}
        disabled={disabled}
        onClick={() => {
          audio.play('click')
          onChange([])
        }}
        label="All topics"
        count={total}
      />
      {topics.map((t) => (
        <Chip
          key={t.topic}
          active={value.includes(t.topic)}
          disabled={disabled}
          onClick={() => toggle(t.topic)}
          label={topicLabel(t.topic)}
          count={t.count}
        />
      ))}
    </div>
  )
}

function Chip({
  active,
  disabled,
  onClick,
  label,
  count,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border-[3px] border-ink px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
        active ? 'bg-amber-300 shadow-[3px_3px_0_0_var(--color-ink)]' : 'bg-white hover:bg-amber-50'
      }`}
    >
      {active && <span aria-hidden>✓</span>}
      {label}
      <span className="rounded-full bg-ink/10 px-1.5 text-xs tabular-nums">{count}</span>
    </button>
  )
}

/** "All topics", or the picked ones by name — for anyone who cannot change them. */
export function topicsSummary(topics: string[]): string {
  return topics.length === 0 ? 'All topics' : topics.map(topicLabel).join(', ')
}
