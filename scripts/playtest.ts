/**
 * End-to-end harness: four clients play a real game against a running server over
 * real websockets, and the result is checked against the database.
 *
 *   npm run playtest                      # against `npm run dev`
 *   npm run playtest -- teams standard    # mode and board
 *   BASE=https://… npm run playtest       # against the deployed server
 *
 * The answer key comes from the admin export, so this exercises the admin API too.
 * Real players, not the in-game AI — this is what verifies the leaderboard path
 * that computer players deliberately bypass.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnswerLetter, BoardPreset, GameMode, GameState, Question } from '../shared/src/types.js'
import { ANSWER_LETTERS } from '../shared/src/types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const BASE = process.env.BASE ?? 'http://localhost:8787'
const mode = (process.argv[2] as GameMode) ?? 'ffa'
const preset = (process.argv[3] as BoardPreset) ?? 'quick'
const ACCURACY = Number(process.argv[4] ?? 0.75)

function adminPassword(): string {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  for (const file of ['.env']) {
    const p = path.join(root, file)
    if (!fs.existsSync(p)) continue
    const m = /^ADMIN_PASSWORD=(.*)$/m.exec(fs.readFileSync(p, 'utf8'))
    if (m) return m[1].trim()
  }
  throw new Error('No ADMIN_PASSWORD found in env or .env')
}

/** The answer key, so the harness can hit a target accuracy on purpose. */
async function fetchAnswerKey(): Promise<Map<number, AnswerLetter>> {
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: adminPassword() }),
  })
  if (!login.ok) throw new Error(`Admin login failed: ${login.status}`)
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

  const res = await fetch(`${BASE}/api/admin/questions/export?format=json`, {
    headers: { cookie },
  })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const { questions } = (await res.json()) as { questions: Question[] }
  return new Map(questions.map((q) => [q.id, q.answer]))
}

async function createPlayer(name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return ((await res.json()) as { player: { id: string } }).player.id
}

async function getPlayer(id: string) {
  const res = await fetch(`${BASE}/api/players/${id}`)
  return ((await res.json()) as { player: import("../shared/src/types.js").PlayerProfile }).player
}

/** A thin client speaking the same envelope the browser uses. */
class Client {
  private ws!: WebSocket
  private nextId = 1
  private pending = new Map<number, (ack: unknown) => void>()
  onGame?: (game: GameState) => void
  onGameOver?: (payload: never) => void

  constructor(
    readonly name: string,
    readonly playerId: string,
  ) {}

  connect(code: string): Promise<void> {
    const url = `${BASE.replace(/^http/, 'ws')}/ws?code=${code}&playerId=${this.playerId}`
    this.ws = new WebSocket(url)
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error(`${this.name} could not connect`)))
      this.ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data))
        if (msg.t === 'ack') {
          this.pending.get(msg.id)?.(msg)
          this.pending.delete(msg.id)
        } else if (msg.event === 'game') {
          this.onGame?.(msg.payload)
        } else if (msg.event === 'gameOver') {
          this.onGameOver?.(msg.payload as never)
        }
      })
    })
  }

  call<T = { ok: boolean; error?: string }>(event: string, payload?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (ack: unknown) => void)
      this.ws.send(JSON.stringify({ t: 'call', id, event, payload }))
    })
  }

  close() {
    this.ws.close()
  }
}

async function main() {
  console.log(`Playtest: ${mode} / ${preset} board / ${Math.round(ACCURACY * 100)}% accuracy`)
  console.log(`Target: ${BASE}\n`)

  const answerKey = await fetchAnswerKey()
  console.log(`answer key: ${answerKey.size} questions`)

  const names = ['Ana', 'Ben', 'Cleo', 'Dev']
  const ids = await Promise.all(names.map(createPlayer))
  const before = await Promise.all(ids.map(getPlayer))

  const roomRes = await fetch(`${BASE}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: ids[0], mode, preset }),
  })
  const { code, error } = (await roomRes.json()) as { code?: string; error?: string }
  if (!code) throw new Error(`createRoom failed: ${error}`)
  console.log(`room ${code}`)

  const clients = names.map((n, i) => new Client(n, ids[i]))
  for (const client of clients) await client.connect(code)
  for (const client of clients.slice(1)) await client.call('setReady', { ready: true })

  let turns = 0
  let rolls = 0
  const seen = new Set<number>()
  const tierCount = new Map<number, number>()

  const finished = new Promise<never>((resolve) => {
    clients[0].onGameOver = resolve
  })

  clients.forEach((client, seat) => {
    let handledQuestion = -1
    let handledChoice = ''
    client.onGame = (game) => {
      if (game.turnSeat !== seat || game.phase === 'game-over') return

      if (game.phase === 'awaiting-roll') {
        handledQuestion = -1
        handledChoice = ''
        turns++
        if (turns % 15 === 0) console.log(`  …${turns} turns`)
        void client.call('roll')
        return
      }
      if (game.phase === 'answering' && game.question && game.question.id !== handledQuestion) {
        handledQuestion = game.question.id
        rolls++
        seen.add(game.question.id)
        tierCount.set(game.roll!, (tierCount.get(game.roll!) ?? 0) + 1)
        const truth = answerKey.get(game.question.id)!
        const letter: AnswerLetter =
          Math.random() < ACCURACY
            ? truth
            : ANSWER_LETTERS.filter((l) => l !== truth)[Math.floor(Math.random() * 3)]
        setTimeout(() => void client.call('answer', { letter }), 20)
        return
      }
      if (game.phase === 'choosing-piece' && game.choices.length > 0) {
        const key = `${game.choices.join()}-${game.log.length}`
        if (key === handledChoice) return
        handledChoice = key
        const pick = game.choices[Math.floor(Math.random() * game.choices.length)]
        setTimeout(() => void client.call('choosePiece', { pieceId: pick }), 20)
      }
    }
  })

  const started = await clients[0].call<{ ok: boolean; error?: string }>('startGame')
  if (!started.ok) throw new Error(`startGame failed: ${started.error}`)

  const result: never = await Promise.race([
    finished,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Game did not finish within 15 minutes')), 900000),
    ),
  ])
  const { winner, summary } = result as unknown as {
    winner: { type: string; seat?: number; team?: number }
    summary: Array<{ playerId: string; name: string; score: number; answered: number; correct: number; piecesHome: number; won: boolean }>
  }

  console.log(`\nfinished after ${turns} turns, ${rolls} questions`)
  console.log(`distinct questions drawn: ${seen.size}`)
  console.log(
    `tier spread: ${[...tierCount].sort().map(([t, n]) => `${t}:${n}`).join(' ')}`,
  )
  console.log(`winner: ${JSON.stringify(winner)}`)
  console.table(
    summary.map((r) => ({
      name: r.name,
      score: r.score,
      correct: `${r.correct}/${r.answered}`,
      home: `${r.piecesHome}/2`,
      won: r.won,
    })),
  )

  // Wait a beat for the database write, then check the leaderboard actually moved.
  await new Promise((r) => setTimeout(r, 800))
  console.log('\nleaderboard deltas:')
  let allGood = true
  for (const [i, id] of ids.entries()) {
    const after = await getPlayer(id)
    const row = summary.find((r) => r.playerId === id)!
    const ok =
      after.totalScore - before[i].totalScore === row.score &&
      after.gamesPlayed - before[i].gamesPlayed === 1 &&
      after.wins - before[i].wins === (row.won ? 1 : 0) &&
      after.answered - before[i].answered === row.answered
    if (!ok) allGood = false
    console.log(
      `  ${names[i].padEnd(5)} score +${after.totalScore - before[i].totalScore}` +
        ` games +${after.gamesPlayed - before[i].gamesPlayed}` +
        ` wins +${after.wins - before[i].wins}` +
        ` answered +${after.answered - before[i].answered}  ${ok ? 'OK' : 'MISMATCH'}`,
    )
  }

  clients.forEach((c) => c.close())
  console.log(allGood ? '\nPASS' : '\nFAIL: leaderboard did not match the game summary')
  process.exit(allGood ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
