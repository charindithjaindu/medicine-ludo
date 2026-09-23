import { useEffect } from 'react'
import {
  ANSWER_SECONDS,
  CAPTURE_POINTS,
  HOME_POINTS,
  TIER_POINTS,
  WIN_POINTS,
} from '@shared/types.js'
import { AI_SKILLS, AI_SKILL_LABELS } from '@shared/ai.js'
import { audio } from '../lib/audio.ts'
import { Button, Sheet } from './ui.tsx'

/**
 * The rules in plain language, for people who have never played Ludo. Numbers come
 * from the shared constants so this page cannot drift from what the server does.
 */
export default function HowToPlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const normal = ANSWER_SECONDS.easy
  const hard = ANSWER_SECONDS.hard

  return (
    <Sheet className="sm:max-w-xl">
      <div role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b-[3px] border-ink bg-cream px-5 py-3">
          <h2 id="how-to-play-title" className="text-2xl font-bold">
            How to play
          </h2>
          <button
            onClick={() => {
              audio.play('click')
              onClose()
            }}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-white text-lg hover:bg-amber-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-[0.95rem] leading-snug">
          <Section emoji="🎯" title="The goal">
            Get <strong>both of your pieces</strong> all the way round the board and into your
            home triangle in the middle. In 2 v 2, any two pieces between you and your partner
            will do.
          </Section>

          <Section emoji="🎲" title="Your turn">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Roll the die. The number is how far you can move — and what the question is worth.</li>
              <li>
                A question appears. Tap an answer within <strong>{normal} seconds</strong> (
                {hard} on Hard).
              </li>
              <li>
                <strong className="text-emerald-700">Right</strong> → move a piece{' '}
                <strong>forward</strong> by the roll.
              </li>
              <li>
                <strong className="text-rose-700">Wrong</strong>, or the clock runs out → move a
                piece <strong>back</strong> half the roll (rounded down). You never go back past
                your start.
              </li>
              <li>If either piece could move, tap the glowing one you want.</li>
            </ol>
            <p className="mt-1.5 text-sm text-ink/60">
              After each answer everyone sees the correct option and the explanation.
            </p>
          </Section>

          <Section emoji="💥" title="Captures and safe squares">
            Land exactly on an opponent and they go back to their start. The{' '}
            <strong>★ squares</strong> — everyone's start square — are safe: nobody can be
            captured there. Partners in 2 v 2 never capture each other.
          </Section>

          <Section emoji="6️⃣" title="Rolling a six">
            Answer a 6 correctly and you roll again — up to two turns in a row. Both pieces start
            on the board, so you never need a 6 to get going.
          </Section>

          <Section emoji="🏆" title="Points">
            A right answer scores {TIER_POINTS[1]}–{TIER_POINTS[6]} (ten times the roll), +
            {CAPTURE_POINTS} for a capture, +{HOME_POINTS} for each piece home and +{WIN_POINTS}{' '}
            for the win. A wrong answer scores nothing but never takes points away. Scores go on
            the leaderboard.
          </Section>

          <Section emoji="🤖" title="Computer players">
            The host can fill empty seats with computer doctors (
            {AI_SKILLS.map((s) => AI_SKILL_LABELS[s]).join(', ')}). They answer questions too,
            and get some wrong, so you can play on your own.
          </Section>

          <Section emoji="📈" title="Your progress">
            Every answer is saved to your <strong>6-digit ID</strong>. Use the same ID on any
            device to keep your score and see <em>My progress</em>: how you are doing by topic,
            and the questions worth another look. There is no password, so keep your ID to
            yourself if you want your record to be yours.
          </Section>
        </div>

        <div
          className="px-5 pb-5"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          <Button variant="primary" size="lg" className="w-full" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <span aria-hidden>{emoji}</span>
        {title}
      </h3>
      <div className="text-ink/80">{children}</div>
    </section>
  )
}

/** The round "?" that opens the rules — sized to sit beside the sound toggle. */
export function HowToPlayButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={() => {
        audio.play('click')
        onClick()
      }}
      title="How to play"
      aria-label="How to play"
      className={`grid h-10 w-10 place-items-center rounded-full border-2 border-white/25 bg-white/10 text-lg font-bold text-white transition hover:bg-white/25 ${className}`}
    >
      ?
    </button>
  )
}
