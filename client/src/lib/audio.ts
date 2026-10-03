/**
 * All game audio, synthesised at runtime with the Web Audio API.
 *
 * There are no audio files to ship, host or cache — the background loop and every
 * sound effect are generated from oscillators and noise. That keeps the repo
 * asset-free, works offline, and lets effects react to game state (the countdown
 * tick rises in pitch as time runs out).
 *
 * Browsers block audio until a user gesture, so nothing starts until the first
 * click anywhere on the page.
 */

type Sfx =
  | 'click'
  | 'roll'
  | 'correct'
  | 'wrong'
  | 'capture'
  | 'home'
  | 'win'
  | 'tick'
  | 'join'

const STORAGE_KEY = 'medicine-ludo:sound'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let musicBus: GainNode | null = null
let sfxBus: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

let enabled = read()
let unlocked = false
let schedulerTimer: number | null = null
let nextNoteAt = 0
let step = 0

const listeners = new Set<(on: boolean) => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function write(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* ignore */
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null

  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)

  musicBus = ctx.createGain()
  musicBus.gain.value = 0.1
  musicBus.connect(master)

  sfxBus = ctx.createGain()
  sfxBus.gain.value = 0.32
  sfxBus.connect(master)

  // One second of white noise, reused for hats, dice rattle and impacts.
  const frames = ctx.sampleRate
  noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

  return ctx
}

interface ToneOptions {
  type?: OscillatorType
  gain?: number
  attack?: number
  bus?: GainNode | null
  glideTo?: number
}

function tone(freq: number, at: number, duration: number, opts: ToneOptions = {}) {
  const c = ctx
  if (!c) return
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.type = opts.type ?? 'triangle'
  osc.frequency.setValueAtTime(freq, at)
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.glideTo), at + duration)

  const peak = opts.gain ?? 0.5
  const attack = opts.attack ?? 0.008
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(peak, at + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  osc.connect(env)
  env.connect(opts.bus ?? sfxBus!)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

function noise(at: number, duration: number, filterHz: number, gain: number, bus?: GainNode | null) {
  const c = ctx
  if (!c || !noiseBuffer) return
  const src = c.createBufferSource()
  src.buffer = noiseBuffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(filterHz, at)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, at)
  env.gain.exponentialRampToValueAtTime(gain, at + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  src.connect(filter)
  filter.connect(env)
  env.connect(bus ?? sfxBus!)
  src.start(at)
  src.stop(at + duration + 0.02)
}

// ---------------------------------------------------------------------------
// Background loop
// ---------------------------------------------------------------------------

/** A minor-key vamp: Am - F - C - G. Warm, looping, deliberately unobtrusive. */
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
]
const STEP_SECONDS = 0.27
const STEPS_PER_BAR = 8
/**
 * A slower scheduler tick costs nothing audible as long as the loop always stays
 * ahead of the clock by more than one tick: 100ms wakeups instead of 25ms means
 * four times fewer wakeups for the same stream of scheduled notes.
 */
const SCHEDULER_INTERVAL_MS = 100
const SCHEDULER_LOOKAHEAD_SECONDS = 0.6

function scheduleStep(index: number, at: number) {
  const bar = Math.floor(index / STEPS_PER_BAR) % CHORDS.length
  const beat = index % STEPS_PER_BAR
  const chord = CHORDS[bar]

  // Bass on the downbeat and the half bar.
  if (beat === 0 || beat === 4) {
    tone(midi(chord[0] - 12), at, 0.42, { type: 'sine', gain: 0.5, bus: musicBus })
  }

  // Arpeggio walking up and back down the triad.
  const pattern = [0, 1, 2, 1, 2, 1, 0, 2]
  tone(midi(chord[pattern[beat]] + 12), at, 0.22, {
    type: 'triangle',
    gain: beat % 2 === 0 ? 0.24 : 0.15,
    bus: musicBus,
  })

  // Soft hat on the offbeats for a pulse to move to.
  if (beat % 2 === 1) noise(at, 0.045, 7000, 0.05, musicBus)
}

function scheduler() {
  const c = ctx
  if (!c) return
  while (nextNoteAt < c.currentTime + SCHEDULER_LOOKAHEAD_SECONDS) {
    scheduleStep(step, nextNoteAt)
    nextNoteAt += STEP_SECONDS
    step++
  }
}

function startMusic() {
  const c = ensureContext()
  if (!c || schedulerTimer !== null) return
  nextNoteAt = c.currentTime + 0.15
  step = 0
  schedulerTimer = window.setInterval(scheduler, SCHEDULER_INTERVAL_MS)
}

function stopMusic() {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function playSfx(name: Sfx) {
  const c = ctx
  if (!c) return
  const t = c.currentTime

  switch (name) {
    case 'click':
      tone(660, t, 0.07, { type: 'square', gain: 0.22 })
      break

    case 'join':
      tone(midi(69), t, 0.1, { type: 'triangle', gain: 0.3 })
      tone(midi(76), t + 0.08, 0.14, { type: 'triangle', gain: 0.3 })
      break

    case 'roll':
      // A rattle, then the die settling.
      for (let i = 0; i < 7; i++) {
        noise(t + i * 0.055, 0.04, 1200 + Math.random() * 2500, 0.28)
      }
      tone(220, t + 0.42, 0.16, { type: 'square', gain: 0.3, glideTo: 440 })
      break

    case 'correct': {
      const notes = [72, 76, 79, 84]
      notes.forEach((n, i) =>
        tone(midi(n), t + i * 0.075, 0.28, { type: 'triangle', gain: 0.42 }),
      )
      break
    }

    case 'wrong':
      tone(midi(58), t, 0.22, { type: 'sawtooth', gain: 0.26 })
      tone(midi(53), t + 0.13, 0.34, { type: 'sawtooth', gain: 0.26 })
      break

    case 'capture':
      noise(t, 0.18, 400, 0.4)
      tone(180, t, 0.28, { type: 'square', gain: 0.35, glideTo: 60 })
      break

    case 'home': {
      const sparkle = [84, 88, 91, 96, 100]
      sparkle.forEach((n, i) =>
        tone(midi(n), t + i * 0.055, 0.2, { type: 'triangle', gain: 0.3 }),
      )
      break
    }

    case 'win': {
      const fanfare = [
        [72, 0],
        [76, 0],
        [79, 0],
        [84, 0.18],
        [79, 0.36],
        [84, 0.5],
        [88, 0.5],
        [91, 0.68],
      ] as const
      fanfare.forEach(([n, delay]) =>
        tone(midi(n), t + delay, 0.55, { type: 'triangle', gain: 0.4 }),
      )
      noise(t, 0.5, 5000, 0.12)
      break
    }

    case 'tick':
      tone(1200, t, 0.04, { type: 'square', gain: 0.18 })
      break
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const audio = {
  get enabled() {
    return enabled
  },

  /** Called on the first user gesture; browsers refuse to start audio before one. */
  unlock() {
    if (unlocked) return
    unlocked = true
    const c = ensureContext()
    if (!c) return
    void c.resume()
    if (enabled) startMusic()
  },

  toggle(): boolean {
    enabled = !enabled
    write(enabled)
    if (enabled) {
      ensureContext()
      void ctx?.resume()
      startMusic()
      playSfx('click')
    } else {
      stopMusic()
    }
    listeners.forEach((fn) => fn(enabled))
    return enabled
  },

  play(name: Sfx) {
    if (!enabled || !unlocked) return
    ensureContext()
    playSfx(name)
  },

  subscribe(fn: (on: boolean) => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

// Any click anywhere counts as the gesture that lets audio start.
if (typeof window !== 'undefined') {
  const unlock = () => audio.unlock()
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
  // A hidden tab throttles timers to about 1Hz, so an unchecked scheduler would
  // catch up on return by firing every missed step at once. Pause instead — the
  // vamp restarts from its top when the tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopMusic()
    } else if (enabled && unlocked) {
      void ctx?.resume()
      startMusic()
    }
  })
}
