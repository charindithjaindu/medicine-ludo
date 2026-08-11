import { useEffect, useRef, useState } from 'react'
import {
  ANSWER_LETTERS,
  TIER_NAMES,
  TIER_POINTS,
  TIER_TIME_LIMITS,
  type AnswerLetter,
  type GameState,
  type GameSummaryRow,
  type PlayerProfile,
  type RoomView,
  type Winner,
} from '@shared/types.js'
import { boardConfig, SEAT_COLORS, TEAM_NAMES } from '@shared/board.js'
import Board from '../components/Board.tsx'
import Dice from '../components/Dice.tsx'
import Confetti from '../components/Confetti.tsx'
import { Backdrop, Button, Loader, Panel, Sheet, SoundToggle } from '../components/ui.tsx'
import { emit } from '../lib/socket.ts'
import { audio } from '../lib/audio.ts'

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
            <TurnPanel game={game} myTurn={myTurn} activeName={active?.name ?? ''} />
            <LogPanel game={game} />
          </div>
        </div>
      </div>

      <MobileTurnBar game={game} myTurn={myTurn} activeName={active?.name ?? ''} />

      {/* The question pops up over everything: on a phone the board would otherwise
          push it below the fold, and the clock is running. */}
      {game.phase === 'answering' && game.question && (
        <Sheet>
          <QuestionPanel game={game} myTurn={myTurn} activeName={active?.name ?? ''} />
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
 * matter. Results are de-duplicated by fingerprint because the same turn is
 * broadcast several times (resolve, then end of turn).
 */
function useGameFeedback(game: GameState, over: { winner: Winner } | null) {
  const [burst, setBurst] = useState(0)
  const [shower, setShower] = useState(0)
  const [flash, setFlash] = useState<'good' | 'bad' | null>(null)
  const seenResult = useRef<string>('')
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

  useEffect(() => {
    const r = game.lastResult
    if (!r) return
    const fingerprint = `${r.seat}-${r.questionId}-${r.chosen}-${r.movedPieceId}-${r.captured.length}`
    if (seenResult.current === fingerprint) return
    seenResult.current = fingerprint

    if (r.wasCorrect) {
      audio.play('correct')
      setBurst((n) => n + 1)
      setFlash('good')
    } else {
      audio.play('wrong')
      setFlash('bad')
    }
    if (r.captured.length > 0) setTimeout(() => audio.play('capture'), 260)
    if (r.reachedHome) setTimeout(() => audio.play('home'), 380)

    const clear = setTimeout(() => setFlash(null), 620)
    return () => clearTimeout(clear)
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
              <span className="shrink-0 text-lg font-bold tabular-nums">{p.score}</span>
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

function TurnPanel({
  game,
  myTurn,
  activeName,
}: {
  game: GameState
  myTurn: boolean
  activeName: string
}) {
  const [rolling, setRolling] = useState(false)

  // Tumble the die briefly whenever a new roll lands, for everyone watching.
  useEffect(() => {
    if (game.phase !== 'answering') return
    setRolling(true)
    const t = setTimeout(() => setRolling(false), 700)
    return () => clearTimeout(t)
  }, [game.phase, game.question?.id])

  async function roll() {
    setRolling(true)
    await emit('roll')
  }

  if (game.phase === 'awaiting-roll') {
    return (
      <Panel className="p-5 text-center">
        {myTurn ? (
          <>
            <Dice value={null} rolling={rolling} size={110} />
            <p className="mt-4 text-xl font-semibold">Your turn!</p>
            <p className="mt-1 text-sm text-ink/60">
              The number you roll is the difficulty. A 6 offers six squares — and the hardest card.
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
        <Dice value={game.roll} rolling={rolling} size={72} />
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
        <Dice value={game.roll} size={72} />
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
}: {
  game: GameState
  myTurn: boolean
  activeName: string
}) {
  const [rolling, setRolling] = useState(false)

  async function roll() {
    setRolling(true)
    await emit('roll')
    setTimeout(() => setRolling(false), 700)
  }

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

function QuestionPanel({
  game,
  myTurn,
  activeName,
}: {
  game: GameState
  myTurn: boolean
  activeName: string
}) {
  const q = game.question!
  const left = useCountdown(q.deadline)
  const [sent, setSent] = useState<AnswerLetter | null>(null)
  const seconds = Math.ceil(left / 1000)
  const totalMs = TIER_TIME_LIMITS[q.tier] * 1000
  const urgent = seconds <= 5 && seconds > 0

  useEffect(() => setSent(null), [q.id])

  // A rising tick in the last five seconds. Only for the person on the clock.
  const lastTick = useRef(0)
  useEffect(() => {
    if (!myTurn || !urgent || sent) return
    if (lastTick.current === seconds) return
    lastTick.current = seconds
    audio.play('tick')
  }, [seconds, urgent, myTurn, sent])

  return (
    <div className={`p-4 ${urgent && myTurn && !sent ? 'animate-throb' : ''}`}>
      <div className="flex items-center gap-3">
        <Dice value={game.roll} size={56} />
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-bold ${
              TIER_COLORS[q.tier]
            }`}
          >
            {TIER_NAMES[q.tier]}
          </span>
          <p className="mt-0.5 text-xs font-medium text-ink/60">
            {TIER_POINTS[q.tier]} pts · move {game.roll}
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
          const chosen = sent === letter
          return (
            <button
              key={letter}
              disabled={!myTurn || sent !== null}
              onClick={() => {
                audio.play('click')
                setSent(letter)
                emit('answer', { letter })
              }}
              className={`flex w-full items-start gap-2.5 rounded-xl border-[3px] border-ink px-3 py-2.5 text-left font-medium transition ${
                chosen
                  ? 'bg-amber-300 shadow-[3px_3px_0_0_var(--color-ink)]'
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

      {!myTurn && (
        <p className="mt-3 text-center text-sm font-medium text-ink/60">
          {activeName} is answering…
        </p>
      )}
      {myTurn && sent && (
        <p className="mt-3 text-center text-sm font-medium text-ink/60">Locked in 🔒</p>
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
