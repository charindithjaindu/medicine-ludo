import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types.js'
import { adminRouter } from './admin.js'
import { apiRouter } from './api.js'
import { activeCountByTier } from './db.js'
import { RoomManager } from './rooms.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../.env') })

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '8mb' }))
app.use(cookieParser())

app.use('/api/admin', adminRouter())
app.use('/api', apiRouter())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, questions: activeCountByTier() })
})

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: true, credentials: true },
})

const rooms = new RoomManager(io)

io.on('connection', (socket) => {
  socket.on('createRoom', ({ playerId, mode, preset }, ack) =>
    ack(rooms.createRoom(socket, playerId, mode, preset)),
  )
  socket.on('joinRoom', ({ playerId, code }, ack) => ack(rooms.joinRoom(socket, playerId, code)))
  socket.on('leaveRoom', (ack) => ack(rooms.leaveRoom(socket)))
  socket.on('setReady', ({ ready }, ack) => ack(rooms.setReady(socket, ready)))
  socket.on('setMode', ({ mode, preset }, ack) => ack(rooms.setMode(socket, mode, preset)))
  socket.on('swapSeats', ({ a, b }, ack) => ack(rooms.swapSeats(socket, a, b)))
  socket.on('startGame', (ack) => ack(rooms.startGame(socket)))
  socket.on('roll', (ack) => ack(rooms.roll(socket)))
  socket.on('answer', ({ letter }, ack) => ack(rooms.answer(socket, letter)))
  socket.on('choosePiece', ({ pieceId }, ack) => ack(rooms.choosePiece(socket, pieceId)))
  socket.on('disconnect', () => rooms.handleDisconnect(socket))
})

const port = Number(process.env.PORT ?? 3001)
server.listen(port, () => {
  const counts = activeCountByTier()
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`Medicine Ludo server on http://localhost:${port}`)
  console.log(`  ${total} active questions  (${Object.values(counts).join(' / ')} by tier)`)
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('  WARNING: ADMIN_PASSWORD is not set — /admin cannot be used.')
  }
})
