/**
 * What this device remembers between page loads: who you are, and which room you
 * were last in.
 *
 * Both live in a cookie *and* in localStorage. The cookie is what survives the cases
 * that actually bite on a phone — a browser that clears site storage between
 * sessions, or a tab restored from a cold start — and localStorage is the fallback
 * when cookies are blocked. Neither is a credential: the player ID exists so your
 * leaderboard score follows you, and the room code so that pressing back, reloading,
 * or letting the screen sleep drops you into the same room in the same seat instead
 * of at the main menu.
 */

const PLAYER_KEY = 'medicine-ludo:player-id'
const ROOM_KEY = 'medicine-ludo:room'

/** Long enough that a phone left overnight still knows you; short enough to expire. */
const PLAYER_TTL_DAYS = 180
/** A room is a single sitting. If you come back tomorrow, it is long gone anyway. */
const ROOM_TTL_DAYS = 0.5

function writeCookie(name: string, value: string, days: number): void {
  try {
    const expires = new Date(Date.now() + days * 86400_000).toUTCString()
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax${secure}`
  } catch {
    /* cookies blocked — localStorage is the fallback */
  }
}

function readCookie(name: string): string | null {
  try {
    for (const part of document.cookie.split(';')) {
      const [k, ...v] = part.trim().split('=')
      if (k === name) return decodeURIComponent(v.join('=')) || null
    }
  } catch {
    /* ignore */
  }
  return null
}

function dropCookie(name: string): void {
  try {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
  } catch {
    /* ignore */
  }
}

function remember(key: string, value: string, days: number): void {
  writeCookie(key, value, days)
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private browsing — the cookie is doing the work */
  }
}

function recall(key: string): string | null {
  const fromCookie = readCookie(key)
  if (fromCookie) return fromCookie
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function forget(key: string): void {
  dropCookie(key)
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function loadPlayerId(): string | null {
  return recall(PLAYER_KEY)
}

export function savePlayerId(id: string): void {
  remember(PLAYER_KEY, id, PLAYER_TTL_DAYS)
}

export function clearPlayerId(): void {
  forget(PLAYER_KEY)
  clearRoomCode()
}

/** The room to walk back into on the next load, if it is still there. */
export function loadRoomCode(): string | null {
  const code = recall(ROOM_KEY)
  return code && /^\d{6}$/.test(code) ? code : null
}

export function saveRoomCode(code: string): void {
  remember(ROOM_KEY, code, ROOM_TTL_DAYS)
}

export function clearRoomCode(): void {
  forget(ROOM_KEY)
}
