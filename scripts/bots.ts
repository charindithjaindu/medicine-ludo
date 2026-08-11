/**
 * Fill a room with bots so you can test — or just play — without four humans.
 *
 *   npm run bots -- <room-code> [count] [accuracy]
 *
 * Bots join an existing room, mark themselves ready, and play their own turns.
 * You stay the host: you still press Start and take your own turns in the browser.
 * They look answers up locally, which is why this is a dev tool and not a feature.
 */

import { io, type Socket } from 'socket.io-client'
import type { AnswerLetter, GameState } from '../shared/src/types.js'
import { ANSWER_LETTERS } from '../shared/src/types.js'
import { getQuestion } from '../server/src/db.js'

const BASE = process.env.BASE ?? 'http://localhost:3001'
const code = process.argv[2]
const count = Math.min(3, Number(process.argv[3] ?? 3))
const accuracy = Number(process.argv[4] ?? 0.7)

if (!code) {
  console.error('Usage: npm run bots -- <room-code> [count] [accuracy]')
  process.exit(1)
}

const NAMES = ['Bot Ben', 'Bot Cleo', 'Bot Dev']

async function createPlayer(name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return (await res.json()).player.id
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'] })
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', reject)
  })
}

async function main() {
  for (let i = 0; i < count; i++) {
    const name = NAMES[i]
    const playerId = await createPlayer(name)
    const socket = await connect()

    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.emit('joinRoom', { playerId, code }, resolve),
    )
    if (!ack.ok) {
      console.error(`${name} could not join: ${ack.error}`)
      process.exit(1)
    }
    socket.emit('setReady', { ready: true }, () => {})
    console.log(`${name} joined room ${code} (id ${playerId})`)

    let lastQuestion = -1
    let lastChoice = ''
    let seat = -1

    socket.on('game', (game: GameState) => {
      if (seat < 0) {
        seat = game.players.findIndex((p) => p.playerId === playerId)
        if (seat < 0) return
      }
      if (game.turnSeat !== seat || game.phase === 'game-over') return

      if (game.phase === 'awaiting-roll') {
        setTimeout(() => socket.emit('roll', () => {}), 900)
        return
      }

      if (game.phase === 'answering' && game.question && game.question.id !== lastQuestion) {
        lastQuestion = game.question.id
        const truth = getQuestion(game.question.id)!.answer
        const letter: AnswerLetter =
          Math.random() < accuracy
            ? truth
            : ANSWER_LETTERS.filter((l) => l !== truth)[Math.floor(Math.random() * 3)]
        // A human-ish pause, so watching the game does not feel like a machine gun.
        setTimeout(() => socket.emit('answer', { letter }, () => {}), 1800)
        return
      }

      if (game.phase === 'choosing-piece' && game.choices.length > 0) {
        const key = `${game.choices.join()}-${game.log.length}`
        if (key === lastChoice) return
        lastChoice = key
        const pick = game.choices[Math.floor(Math.random() * game.choices.length)]
        setTimeout(() => socket.emit('choosePiece', { pieceId: pick }, () => {}), 900)
      }
    })

    socket.on('gameOver', () => {
      console.log(`${name}: game over`)
    })
  }

  console.log(`\n${count} bot(s) ready in room ${code}. Press Start in your browser.`)
  console.log('Ctrl-C to stop them.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
