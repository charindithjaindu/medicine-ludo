import { useEffect, useRef, useState } from 'react'
import {
  ANSWER_LETTERS,
  ANSWER_SECONDS,
  DIFFICULTY_EMOJI,
  DIFFICULTY_NAMES,
  TIER_NAMES,
  TIER_POINTS,
  type AnswerLetter,
  type Difficulty,
  type GameState,
  type GameSummaryRow,
  type PlayerProfile,
  type RoomView,
  type Tier,
  type Winner,
} from '@shared/types.js'
import { boardConfig, SEAT_COLORS, TEAM_NAMES } from '@shared/board.js'
import { answerBeat, moveBeat } from '@shared/feedback.js'
import Board from '../components/Board.tsx'
import Dice from '../components/Dice.tsx'
import Confetti from '../components/Confetti.tsx'
import { Backdrop, Button, Loader, Panel, Sheet, SoundToggle } from '../components/ui.tsx'
import { emit } from '../lib/socket.ts'
import { audio } from '../lib/audio.ts'

/**
 * How long the die tumbles before its question appears.
 *
 * The old 700ms was over before anyone had looked at it — and on a phone the
 * question sheet covered the die almost immediately, so the throw was never really
 * seen. Holding the question back costs a second and a half of a sixty-second
 * clock, which is worth it for a roll that looks thrown rather than computed.
 */
const DICE_ROLL_MS = 1500

/**
 * True while a freshly-landed roll is still in the air — for everyone at the
 * table, not just whoever threw it, so the whole room watches the same die.
 */
function useRollAnimation(game: GameState): boolean {
  const [animating, setAnimating] = useState(false)
  const seen = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A string, so this effect is driven by *which* roll rather than by every
  // re-broadcast of the same game state.
  const rollId =
    game.phase === 'answering' && game.question ? `${game.turnSeat}:${game.question.id}` : ''

  useEffect(() => {
    if (!rollId) {
      seen.current = ''
      setAnimating(false)
      return
    }
    if (seen.current === rollId) return
    seen.current = rollId
    setAnimating(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAnimating(false), DICE_ROLL_MS)
  }, [rollId])

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  return animating
}

const TIER_COLORS: Record<number, string> = {
  1: 'bg-emerald-300',
  2: 'bg-lime-300',
  3: 'bg-amber-300',
  4: 'bg-orange-300',
  5: 'bg-rose-300',
  6: 'bg-fuchsia-300',
}

export default function Game({
  player,
  room,
  game,
  over,
  onLeave,
}: {
  player: PlayerProfile
  room: RoomView
  game: GameState
  over: { winner: Winner; summary: GameSummaryRow[] } | null
  onLeave: () => void
}) {
  const mySeat = game.players.findIndex((p) => p.playerId === player.id)
  const myTurn = mySeat >= 0 && mySeat === game.turnSeat
  const active = game.players[game.turnSeat]
  const b = boardConfig(game.preset)

  const { burst, shower, flash } = useGameFeedback(game, over)
  const throwing = useRollAnimation(game)

  return (
    <div className="relative min-h-full">
      <Backdrop />
      <Confetti burstKey={burst} intensity="burst" />
      <Confetti burstKey={shower} intensity="shower" />

      {/* Full-screen tint on a right or wrong answer. */}
      {flash && (
        <div
          className={`pointer-events-none fixed inset-0 z-40 animate-pop-in ${
            flash === 'good' ? 'bg-emerald-400/25' : 'bg-rose-500/25'
          }`}
        />
      )}

      <div
        className={`relative mx-auto w-full max-w-6xl px-4 py-4 pb-28 lg:pb-4 ${
          flash === 'bad' ? 'animate-shake' : ''
        }`}
      >
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-white">
            <span className="rounded-full border-2 border-white/25 bg-white/10 px-3 py-1 font-mono text-sm font-bold tracking-widest">
              {room.code}
            </span>
            <span className="rounded-full border-2 border-white/25 bg-white/10 px-3 py-1 text-sm font-semibold">
              {game.mode === 'teams' ? '🤝 2 v 2' : '⚔️ Free for all'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SoundToggle />
            <Button variant="ghost" size="sm" onClick={onLeave}>
              Leave
            </Button>
          </div>
        </header>

        <PlayerStrip game={game} mySeat={mySeat} room={room} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* The board is square, so cap it by viewport height — otherwise it pushes
              the question panel below the fold on short screens. */}
          <div className="mx-auto w-full" style={{ maxWidth: 'min(100%, 58vh)' }}>
            <Board
              game={game}
              viewSeat={mySeat}
              choices={myTurn && game.phase === 'choosing-piece' ? game.choices : []}
              onPick={(pieceId) => {
                audio.play('click')
                emit('choosePiece', { pieceId })
              }}
            />
            <p className="mt-2 text-center text-xs font-medium text-white/60">
              {game.mode === 'teams'
                ? 'First team with 2 pieces home wins'
                : 'First player with both pieces home wins'}{' '}
              · ★ squares are safe · ring of {b.ring}
            </p>
          </div>

          {/* On a phone the turn controls move to a fixed bar at the bottom, where a
              thumb can reach them and where they cost no vertical space. */}
          <div className="hidden space-y-3 lg:block">
            <TurnPanel
              game={game}
              myTurn={myTurn}
              activeName={active?.name ?? ''}
              throwing={throwing}
            />
            <LogPanel game={game} />
          </div>
        </div>
      </div>

      <MobileTurnBar
        game={game}
        myTurn={myTurn}
        activeName={active?.name ?? ''}
        throwing={throwing}
      />

      {/* The question pops up over everything: on a phone the board would otherwise
          push it below the fold, and the clock is running. The die gets the sheet to
          itself first — it is the same beat, so it belongs in the same place. */}
      {game.phase === 'answering' && game.question && (
        <Sheet>
          {throwing ? (
            <ThrowPanel game={game} myTurn={myTurn} activeName={active?.name ?? ''} />
          ) : (
            <QuestionPanel
              game={game}
              difficulty={room.difficulty}
              myTurn={myTurn}
              activeName={active?.name ?? ''}
            />
          )}
        </Sheet>
      )}

      {game.phase === 'revealing' && game.lastResult && !over && (
        <Sheet>
          <RevealPanel game={game} />
        </Sheet>
      )}

      {over && <GameOverOverlay over={over} game={game} player={player} onLeave={onLeave} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sound + confetti reactions
// ---------------------------------------------------------------------------

/**
 * Watches the game state and fires audio/visual feedback on the transitions that
 * matter. One turn is broadcast several times, so each reaction is de-duplicated
 * against the beat it belongs to — see shared/src/feedback.ts.
 */
function useGameFeedback(game: GameState, over: { winner: Winner } | null) {
  const [burst, setBurst] = useState(0)
  const [shower, setShower] = useState(0)
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null)
  const seenAnswer = useRef<string>('')
  const seenMove = useRef<string>('')
  const seenRoll = useRef<string>('')
  const wonRef = useRef(false)

  useEffect(() => {
    // A new roll: everyone at the table hears the dice.
    if (game.phase === 'answering' && game.question) {
      const id = `${game.turnSeat}-${game.question.id}`
      if (seenRoll.current !== id) {
        seenRoll.current = id
        audio.play('roll')
      }
    }
  }, [game.phase, game.question, game.turnSeat])

  /**
   * The celebration belongs to the *answer*, so it is keyed on the answer alone —
   * keying it on the whole result fired a second, identical celebration once the
   * player picked a piece.
   *
   * It also waits for the reveal. When a turn needs a piece chosen, the verdict
   * arrives one broadcast early, alongside `choosing-piece`: celebrating there and
   * then opening a reveal sheet that says "Correct!" again announced the same thing
   * twice, side by side with the move the player had just made. The direction in
   * "move forward 4" already tells them how they did; the fanfare belongs with the
   * sheet that explains it.
   */
  useEffect(() => {
    const r = game.lastResult
    if (!r || game.phase !== 'revealing') return
    const answered = answerBeat(r)
    if (seenAnswer.current === answered) return
    seenAnswer.current = answered

    if (r.wasCorrect) {
      audio.play('correct')
      setBurst((n) => n + 1)
      setFlash('good')
    } else {
      audio.play('wrong')
      setFlash('bad')
    }
    const clear = setTimeout(() => setFlash(null), 620)
    return () => clearTimeout(clear)
  }, [game.lastResult, game.phase])

  /** What the move earned is a separate beat, and only lands once a piece has moved. */
  useEffect(() => {
    const r = game.lastResult
    const moved = r ? moveBeat(r) : null
    if (!r || !moved) return
    if (seenMove.current === moved) return
    seenMove.current = moved

    if (r.captured.length > 0) audio.play('capture')
    if (r.reachedHome) setTimeout(() => audio.play('home'), 200)
  }, [game.lastResult])

  useEffect(() => {
    if (!over || wonRef.current) return
    wonRef.current = true
    audio.play('win')
    setShower((n) => n + 1)
  }, [over])

  return { burst, shower, flash }
}

// ---------------------------------------------------------------------------

function PlayerStrip({
  game,
  mySeat,
  room,
}: {
  game: GameState
  mySeat: number
  room: RoomView
}) {
  const b = boardConfig(game.preset)
  const teamHome = (team: number) =>
    game.players
      .filter((p) => p.team === team)
      .reduce((n, p) => n + p.pieces.filter((pc) => pc.progress >= b.goal).length, 0)

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {game.players.map((p) => {
        const home = p.pieces.filter((pc) => pc.progress >= b.goal).length
        const isTurn = p.seat === game.turnSeat
        return (
          <div
            key={p.seat}
            className={`relative overflow-hidden rounded-2xl border-[3px] border-ink bg-cream p-2.5 transition-all ${
              isTurn
                ? 'shadow-[0_0_0_4px_rgba(251,191,36,0.9),5px_5px_0_0_var(--color-ink)]'
                : 'opacity-80 shadow-[3px_3px_0_0_var(--color-ink)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-[3px] border-ink text-sm font-bold text-white ${
                  isTurn ? 'animate-throb' : ''
                }`}
                style={{ backgroundColor: SEAT_COLORS[p.seat] }}
              >
                {(p.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">
                  {room.seats.find((s) => s.playerId === p.playerId)?.ai && '🤖 '}
                  {p.name || 'Player'}
                  {p.seat === mySeat && <span className="ml-1 text-xs text-ink/45">(you)</span>}
                </p>
                <p className="text-[0.7rem] text-ink/60">
                  {p.correct}/{p.answered} correct
                  {game.mode === 'teams' && ` · ${TEAM_NAMES[p.team]} ${teamHome(p.team)}/2`}
                </p>
              </div>
              {/* Keyed on the score so React remounts it and the pop replays: a
                  number that quietly changes is a number nobody notices. */}
              <span
                key={p.score}
                className="shrink-0 animate-score-pop text-lg font-bold tabular-nums"
              >
                {p.score}
              </span>
            </div>

            <div className="mt-2 flex gap-1">
              {p.pieces.map((pc) => (
                <span key={pc.id} className="h-2 flex-1 rounded-full bg-ink/10">
                  <span
                    className="block h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (pc.progress / b.goal) * 100)}%`,
                      backgroundColor: SEAT_COLORS[p.seat],
                    }}
                  />
                </span>
              ))}
            </div>
            <p className="mt-1 text-[0.65rem] font-medium text-ink/45">
              {home > 0 ? '★'.repeat(home) + ' ' : ''}
              {home}/2 home {!p.connected && '· away'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

function useCountdown(deadline: number | null): number {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!deadline) {
      setLeft(0)
      return
    }
    const tick = () => setLeft(Math.max(0, deadline - Date.now()))
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [deadline])
  return left
}

/**
 * The gap between tapping Roll and the server's answer coming back. Tumbling
 * through it means the die never waits on the network in a dead pose.
 */
function useThrow(game: GameState, throwing: boolean) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (game.phase !== 'awaiting-roll') setPending(false)
  }, [game.phase])

  async function roll() {
    setPending(true)
    const ack = await emit('roll')
    if (!ack.ok) setPending(false)
  }

  return { rolling: pending || throwing, roll }
}

function TurnPanel({
  game,
  myTurn,
  activeName,
  throwing,
}: {
  game: GameState
  myTurn: boolean
  activeName: string
  throwing: boolean
}) {
  const { rolling, roll } = useThrow(game, throwing)

  if (game.phase === 'awaiting-roll') {
    return (
      <Panel className="p-5 text-center">
        {myTurn ? (
          <>
            <Dice value={null} rolling={rolling} size={110} className="mx-auto" />
            <p className="mt-4 text-xl font-semibold">Your turn!</p>
            <p className="mt-1 text-sm text-ink/60">
              The number you roll is what's at stake. A 6 offers six squares — and 60 points.
            </p>
            <Button variant="primary" size="xl" className="mt-4 w-full" onClick={roll} sound={null}>
              🎲 Roll the die
            </Button>
          </>
        ) : (
          <div className="py-6">
            <Loader label={`Waiting for ${activeName} to roll…`} />
          </div>
        )}
      </Panel>
    )
  }

  // The question itself is a sheet over the board; this is just the status behind it.
  if (game.phase === 'answering' && game.question) {
    return (
      <Panel className="p-5 text-center">
        <Dice value={game.roll} rolling={rolling} size={72} className="mx-auto" />
        <p className="mt-3 font-semibold">
          {myTurn ? 'Answer the question…' : `${activeName} is answering…`}
        </p>
      </Panel>
    )
  }

  if (game.phase === 'choosing-piece') {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-3">
          <Dice value={game.roll} size={64} />
          <p
            className={`text-2xl font-bold ${
              game.lastResult?.wasCorrect ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {game.lastResult?.wasCorrect ? 'Correct! 🎉' : 'Not quite.'}
          </p>
        </div>
        <p className="mt-3 font-medium">
          {myTurn ? (
            <>
              Pick the piece to move{' '}
              <strong>
                {game.pendingDistance > 0
                  ? `forward ${game.pendingDistance}`
                  : `back ${-game.pendingDistance}`}
              </strong>{' '}
              — tap a glowing piece on the board.
            </>
          ) : (
            `${activeName} is choosing which piece to move…`
          )}
        </p>
      </Panel>
    )
  }

  if (game.lastResult) {
    return (
      <Panel className="p-5 text-center">
        <Dice value={game.roll} size={72} className="mx-auto" />
        <p
          className={`mt-3 text-xl font-bold ${
            game.lastResult.wasCorrect ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {game.lastResult.wasCorrect ? 'Correct!' : 'Wrong'}
        </p>
      </Panel>
    )
  }

  return (
    <Panel className="p-6">
      <Loader />
    </Panel>
  )
}

/**
 * The phone's turn controls: pinned to the bottom, always within thumb reach, and
 * costing the board no vertical space.
 */
function MobileTurnBar({
  game,
  myTurn,
  activeName,
  throwing,
}: {
  game: GameState
  myTurn: boolean
  activeName: string
  throwing: boolean
}) {
  const { rolling, roll } = useThrow(game, throwing)

  let content: React.ReactNode
  if (game.phase === 'awaiting-roll' && myTurn) {
    content = (
      <Button variant="primary" size="lg" className="w-full" onClick={roll} sound={null}>
        🎲 Roll the die
      </Button>
    )
  } else if (game.phase === 'choosing-piece' && myTurn) {
    content = (
      <p className="py-1 text-center font-semibold">
        Tap a glowing piece to move{' '}
        {game.pendingDistance > 0 ? `forward ${game.pendingDistance}` : `back ${-game.pendingDistance}`}
      </p>
    )
  } else {
    content = (
      <p className="py-1 text-center text-sm font-medium text-ink/70">
        {game.phase === 'awaiting-roll'
          ? `Waiting for ${activeName} to roll…`
          : `${activeName}'s turn`}
      </p>
    )
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t-[3px] border-ink bg-cream px-3 pt-2.5 lg:hidden"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <Dice value={game.roll} rolling={rolling} size={48} />
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    </div>
  )
}

/**
 * The sheet while the die is still in the air. It shows nothing about the roll —
 * the value is already known to the client, and revealing it early would give the
 * tumble away.
 */
function ThrowPanel({
  game,
  myTurn,
  activeName,
}: {
  game: GameState
  myTurn: boolean
  activeName: string
}) {
  return (
    <div className="grid place-items-center px-4 py-10 text-center">
      <Dice value={game.roll} rolling size={112} />
      <p className="mt-6 text-xl font-semibold">
        {myTurn ? 'Rolling…' : `${activeName} is rolling…`}
      </p>
    </div>
  )
}

function QuestionPanel({
  game,
  difficulty,
  myTurn,
  activeName,
}: {
  game: GameState
  difficulty: Difficulty
  myTurn: boolean
  activeName: string
}) {
  const q = game.question!
  // The die face, not the card's own tier: it is what the move and the points are
  // worth, and in a difficulty-filtered room the card may come from another tier.
  const tier = (game.roll ?? q.tier) as Tier
  const left = useCountdown(q.deadline)
  // Local state so the tap responds instantly; the server's `chosenAnswer` is what
  // everyone *else* at the table sees, and it is the one that locks the buttons.
  const [sent, setSent] = useState<AnswerLetter | null>(null)
  const locked = game.chosenAnswer ?? sent
  const seconds = Math.ceil(left / 1000)
  const totalMs = ANSWER_SECONDS * 1000
  const urgent = seconds <= 5 && seconds > 0

  useEffect(() => setSent(null), [q.id])

  // A rising tick in the last five seconds. Only for the person on the clock.
  const lastTick = useRef(0)
  useEffect(() => {
    if (!myTurn || !urgent || locked) return
    if (lastTick.current === seconds) return
    lastTick.current = seconds
    audio.play('tick')
  }, [seconds, urgent, myTurn, locked])

  return (
    <div className={`p-4 ${urgent && myTurn && !locked ? 'animate-throb' : ''}`}>
      <div className="flex items-center gap-3">
        {/* The sheet has just swapped out the tumbling die, so this one picks the
            throw up where it left off and takes the impact. */}
        <Dice value={game.roll} land size={56} />
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold ${
              TIER_COLORS[tier]
            }`}
          >
            {TIER_NAMES[tier]}
          </span>
          <p className="mt-0.5 text-xs font-medium text-ink/60">
            {TIER_POINTS[tier]} pts · move {game.roll} ·{' '}
            {/* "deck", because the tier badge above is also named Easy…Very Difficult
                and the two mean different things. */}
            <span title="Every card in this room comes from this level">
              {DIFFICULTY_EMOJI[difficulty]} {DIFFICULTY_NAMES[difficulty]} deck
            </span>
          </p>
        </div>
        <span
          className={`font-mono text-3xl font-bold tabular-nums ${
            urgent ? 'text-rose-600' : 'text-ink'
          }`}
        >
          {seconds}
        </span>
      </div>

      <div className="mt-3 h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white">
        <div
          className={`h-full transition-all duration-200 ${urgent ? 'bg-rose-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.max(0, Math.min(100, (left / totalMs) * 100))}%` }}
        />
      </div>

      <p className="mt-3 text-lg font-medium leading-snug">{q.text}</p>

      <div className="mt-3 space-y-2">
        {q.options.map((opt, i) => {
          const letter = ANSWER_LETTERS[i]
          const chosen = locked === letter
          return (
            <button
              key={letter}
              disabled={!myTurn || locked !== null}
              onClick={() => {
                audio.play('click')
                setSent(letter)
                emit('answer', { letter })
              }}
              className={`flex w-full items-start gap-2.5 rounded-xl border-[3px] border-ink px-3 py-2.5 text-left font-medium transition ${
                chosen
                  ? 'animate-score-pop bg-amber-300 shadow-[3px_3px_0_0_var(--color-ink)]'
                  : locked
                    ? 'bg-white/60 text-ink/45'
                    : myTurn
                    ? 'bg-white hover:-translate-y-0.5 hover:bg-amber-50 hover:shadow-[3px_3px_0_0_var(--color-ink)]'
                      : 'bg-white/70 text-ink/60'
              }`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-ink bg-cream font-mono text-sm font-bold">
                {letter}
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
            </button>
          )
        })}
      </div>

      {locked ? (
        <p className="mt-3 text-center text-sm font-medium text-ink/60">
          {myTurn ? 'Locked in 🔒' : `${activeName} answered ${locked} 🔒`}
        </p>
      ) : (
        !myTurn && (
          <p className="mt-3 text-center text-sm font-medium text-ink/60">
            {activeName} is answering…
          </p>
        )
      )}
    </div>
  )
}

function RevealPanel({ game }: { game: GameState }) {
  const r = game.lastResult!
  const moved =
    r.distance === 0
      ? 'No piece could move.'
      : r.distance > 0
        ? `Moved forward ${r.distance}`
        : `Moved back ${-r.distance}`

  return (
    <div className={`p-5 ${r.wasCorrect ? 'bg-emerald-50' : 'bg-rose-50'}`}>
      <div className="flex items-center gap-3">
        <Dice value={r.roll} size={56} />
        <div>
          <p className={`text-2xl font-bold ${r.wasCorrect ? 'text-emerald-600' : 'text-rose-600'}`}>
            {r.chosen === null ? "⏱ Time's up" : r.wasCorrect ? 'Correct! 🎉' : 'Wrong ✗'}
          </p>
          {r.pointsEarned > 0 && (
            <p className="text-sm font-bold text-emerald-700">+{r.pointsEarned} points</p>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-snug text-ink/70">{r.questionText}</p>

      <div className="mt-2 flex items-start gap-2 rounded-xl border-[3px] border-ink bg-white px-3 py-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-ink bg-emerald-300 font-mono text-sm font-bold">
          {r.correctLetter}
        </span>
        <span className="font-medium">{r.options[ANSWER_LETTERS.indexOf(r.correctLetter)]}</span>
      </div>
      {r.explanation && <p className="mt-2 text-xs text-ink/60">{r.explanation}</p>}

      <ul className="mt-3 space-y-1 text-sm font-medium">
        <li>{moved}</li>
        {r.captured.length > 0 && (
          <li className="text-rose-600">
            💥 Sent {r.captured.length} opponent piece{r.captured.length > 1 ? 's' : ''} home!
          </li>
        )}
        {r.reachedHome && <li className="text-amber-600">★ A piece reached home!</li>}
        {r.extraTurn && <li className="text-emerald-700">🎲 Rolled a 6 — go again!</li>}
      </ul>
    </div>
  )
}

function LogPanel({ game }: { game: GameState }) {
  const recent = [...game.log].slice(-6).reverse()
  return (
    <Panel flat className="p-3">
      <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink/40">Recent</p>
      <ul className="space-y-0.5 text-xs text-ink/70">
        {recent.length === 0 && <li className="text-ink/35">Nothing yet.</li>}
        {recent.map((entry, i) => (
          <li key={entry.id} className={i === 0 ? 'font-semibold text-ink' : ''}>
            {entry.text}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function GameOverOverlay({
  over,
  game,
  player,
  onLeave,
}: {
  over: { winner: Winner; summary: GameSummaryRow[] }
  game: GameState
  player: PlayerProfile
  onLeave: () => void
}) {
  const winner = over.winner
  const label =
    winner.type === 'player'
      ? (game.players.find((p) => p.seat === winner.seat)?.name ?? 'Winner')
      : game.players
          .filter((p) => p.team === winner.team)
          .map((p) => p.name || 'Player')
          .join(' & ')
  const iWon = over.summary.find((r) => r.playerId === player.id)?.won

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/80 p-4">
      <Panel className="my-8 w-full max-w-lg animate-pop-in p-6">
        <p className="text-center text-6xl animate-bob">{iWon ? '🏆' : '🎲'}</p>
        <p className="mt-2 text-center text-sm font-bold uppercase tracking-widest text-ink/40">
          Game over
        </p>
        <h2 className="text-center text-4xl font-bold">{label} wins!</h2>
        {iWon && <p className="mt-1 text-center font-semibold text-emerald-600">That's you! 🎉</p>}

        <div className="mt-5 space-y-2">
          {over.summary.map((row, i) => (
            <div
              key={row.playerId}
              className={`flex animate-rise-in items-center gap-3 rounded-xl border-[3px] border-ink px-3 py-2 ${
                row.won ? 'bg-amber-200' : 'bg-white'
              }`}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="w-5 text-center font-bold text-ink/40">{i + 1}</span>
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink text-xs font-bold text-white"
                style={{ backgroundColor: SEAT_COLORS[row.seat] }}
              >
                {(row.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {row.name || 'Player'}
                {row.playerId === player.id && (
                  <span className="ml-1 text-xs text-ink/45">(you)</span>
                )}
              </span>
              <span className="text-xs text-ink/60">
                {row.correct}/{row.answered} · {'★'.repeat(row.piecesHome) || '–'}
              </span>
              <span className="text-lg font-bold tabular-nums">{row.score}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-ink/50">
          Scores have been added to the global leaderboard.
        </p>

        <Button variant="primary" size="lg" className="mt-4 w-full" onClick={onLeave}>
          Back to menu
        </Button>
      </Panel>
    </div>
  )
}
