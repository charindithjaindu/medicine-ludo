import type { Question, Tier } from '@shared/types.js'
import { TIERS } from '@shared/types.js'
import { activeQuestionsByTier } from './db.js'

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Six decks, one per tier, drawn without replacement so a game never repeats a
 * question until that tier is exhausted.
 *
 * The deck is a snapshot taken when the game starts, so an admin editing the bank
 * mid-session cannot disturb a game already in progress.
 */
export class Deck {
  private remaining: Record<Tier, Question[]>
  private source: Record<Tier, Question[]>

  private constructor(source: Record<Tier, Question[]>) {
    this.source = source
    this.remaining = Object.fromEntries(
      TIERS.map((t) => [t, shuffle(source[t])]),
    ) as Record<Tier, Question[]>
  }

  static snapshot(): Deck {
    return new Deck(activeQuestionsByTier())
  }

  /** Empty tiers are impossible via the admin panel, but a deck must never crash. */
  hasAny(): boolean {
    return TIERS.some((t) => this.source[t].length > 0)
  }

  emptyTiers(): Tier[] {
    return TIERS.filter((t) => this.source[t].length === 0)
  }

  draw(tier: Tier): Question | null {
    if (this.remaining[tier].length === 0) {
      if (this.source[tier].length === 0) return this.drawFallback()
      this.remaining[tier] = shuffle(this.source[tier])
    }
    return this.remaining[tier].pop() ?? null
  }

  /** Last resort if a tier somehow has no questions: use the nearest tier that does. */
  private drawFallback(): Question | null {
    for (const t of TIERS) {
      if (this.remaining[t].length > 0) return this.remaining[t].pop()!
      if (this.source[t].length > 0) {
        this.remaining[t] = shuffle(this.source[t])
        return this.remaining[t].pop()!
      }
    }
    return null
  }
}
