/**
 * End-to-end harness: four bots play a real game against the running server over
 * real sockets, and the result is checked against the database.
 *
 * Bots look the correct answer up locally (they are a test fixture, not a player)
 * and answer correctly with probability ACCURACY, so both the forward and the
 * backward paths get exercised on the way to a genuine win.
 *
 *   npm run playtest -- [ffa|teams] [quick|standard] [accuracy]
 */

import { io, type Socket } from 'socket.io-client'
import type {
  AnswerLetter,
  BoardPreset,
  GameMode,
  GameState,
  GameSummaryRow,
  Winner,
} from '../shared/src/types.js'
import { ANSWER_LETTERS } from '../shared/src/types.js'
import { getPlayer, getQuestion } from '../server/src/db.js'

const BASE = process.env.BASE ?? 'http://localhost:3001'
const mode = (process.argv[2] as GameMode) ?? 'ffa'
const preset = (process.argv[3] as BoardPreset) ?? 'quick'
const ACCURACY = Number(process.argv[4] ?? 0.75)

async function createPlayer(name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await res.json()
  return body.player.id
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'] })
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', reject)
  })
}

function ask<T = unknown>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve)
    else socket.emit(event, payload, resolve)
  })
}

async function main() {
  console.log(`Playtest: ${mode} / ${preset} board / ${Math.round(ACCURACY * 100)}% accuracy\n`)

  const names = ['Ana', 'Ben', 'Cleo', 'Dev']
  const ids = await Promise.all(names.map(createPlayer))
  const sockets = await Promise.all(names.map(() => connect()))
  const before = ids.map((id) => getPlayer(id)!)

  const created = await ask<{ ok: boolean; error?: string; data?: { code: string } }>(
    sockets[0],
    'createRoom',
    { playerId: ids[0], mode, preset },
  )
  if (!created.ok) throw new Error(`createRoom failed: ${created.error}`)
  const code = created.data!.code
  console.log(`room ${code}`)

  for (let i = 1; i < 4; i++) {
    const joined = await ask<{ ok: boolean; error?: string }>(sockets[i], 'joinRoom', {
      playerId: ids[i],
      code,
    })
    if (!joined.ok) throw new Error(`join failed for ${names[i]}: ${joined.error}`)
    await ask(sockets[i], 'setReady', { ready: true })
  }

  const finished = new Promise<{ winner: Winner; summary: GameSummaryRow[] }>((resolve) => {
    sockets[0].on('gameOver', resolve)
  })

  let turns = 0
  let rolls = 0
  let correctAnswers = 0
  let captures = 0
  const seen = new Set<number>()
  const tierCount = new Map<number, number>()

  // Every bot listens; each acts only when it is its own turn, exactly like a player.
  sockets.forEach((socket, seat) => {
    let handledQuestion = -1
    let handledChoice = ''

    socket.on('game', (game: GameState) => {
      if (game.turnSeat !== seat || game.phase === 'game-over') return

      if (game.phase === 'awaiting-roll') {
        turns++
        socket.emit('roll', () => {})
        return
      }

      if (game.phase === 'answering' && game.question && game.question.id !== handledQuestion) {
        handledQuestion = game.question.id
        rolls++
        seen.add(game.question.id)
        tierCount.set(game.question.tier, (tierCount.get(game.question.tier) ?? 0) + 1)

        const truth = getQuestion(game.question.id)!.answer
        const wantCorrect = Math.random() < ACCURACY
        const letter: AnswerLetter = wantCorrect
          ? truth
          : ANSWER_LETTERS.filter((l) => l !== truth)[Math.floor(Math.random() * 3)]
        if (wantCorrect) correctAnswers++
        setTimeout(() => socket.emit('answer', { letter }, () => {}), 20)
        return
      }

      if (game.phase === 'choosing-piece' && game.choices.length > 0) {
        const key = `${game.choices.join()}-${game.log.length}`
        if (key === handledChoice) return
        handledChoice = key
        const pick = game.choices[Math.floor(Math.random() * game.choices.length)]
        setTimeout(() => socket.emit('choosePiece', { pieceId: pick }, () => {}), 20)
      }
    })

  })

  // One observer counts captures, deduped by the serialised result: the same turn is
  // broadcast several times (resolve, then end-of-turn), but always identically.
  const countedResults = new Set<string>()
  sockets[0].on('game', (game: GameState) => {
    if (!game.lastResult) return
    const fingerprint = JSON.stringify(game.lastResult)
    if (countedResults.has(fingerprint)) return
    countedResults.add(fingerprint)
    captures += game.lastResult.captured.length
  })

  const started = await ask<{ ok: boolean; error?: string }>(sockets[0], 'startGame')
  if (!started.ok) throw new Error(`startGame failed: ${started.error}`)

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Game did not finish within 5 minutes')), 300000),
  )
  const result = await Promise.race([finished, timeout])

  console.log(`\nfinished after ${turns} turns, ${rolls} questions`)
  console.log(`distinct questions drawn: ${seen.size}`)
  console.log(
    `tier spread (die face -> times drawn): ${[...tierCount].sort().map(([t, n]) => `${t}:${n}`).join(' ')}`,
  )
  console.log(`captures: ${captures}`)
  console.log(
    `winner: ${result.winner.type === 'player' ? `seat ${result.winner.seat}` : `team ${result.winner.team}`}`,
  )
  console.table(
    result.summary.map((r) => ({
      name: r.name,
      team: r.team,
      score: r.score,
      correct: `${r.correct}/${r.answered}`,
      home: `${r.piecesHome}/2`,
      won: r.won,
    })),
  )

  // The leaderboard is the point of all this, so check it actually moved.
  console.log('\nleaderboard deltas:')
  let allGood = true
  ids.forEach((id, i) => {
    const after = getPlayer(id)!
    const row = result.summary.find((r) => r.playerId === id)!
    const scoreOk = after.totalScore - before[i].totalScore === row.score
    const gamesOk = after.gamesPlayed - before[i].gamesPlayed === 1
    const winsOk = after.wins - before[i].wins === (row.won ? 1 : 0)
    const answeredOk = after.answered - before[i].answered === row.answered
    if (!scoreOk || !gamesOk || !winsOk || !answeredOk) allGood = false
    console.log(
      `  ${names[i].padEnd(5)} score +${after.totalScore - before[i].totalScore} ` +
        `games +${after.gamesPlayed - before[i].gamesPlayed} ` +
        `wins +${after.wins - before[i].wins} ` +
        `answered +${after.answered - before[i].answered} ` +
        `${scoreOk && gamesOk && winsOk && answeredOk ? 'OK' : 'MISMATCH'}`,
    )
  })

  sockets.forEach((s) => s.close())
  console.log(allGood ? '\nPASS' : '\nFAIL: leaderboard did not match the game summary')
  process.exit(allGood ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
