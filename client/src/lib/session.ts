const KEY = 'medicine-ludo:player-id'

/**
 * The player ID is the only credential in the game, and nothing sensitive sits
 * behind it — it exists so a returning player keeps their leaderboard score.
 */
export function loadPlayerId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function savePlayerId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* private browsing — the player just re-enters their ID next time */
  }
}

export function clearPlayerId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
