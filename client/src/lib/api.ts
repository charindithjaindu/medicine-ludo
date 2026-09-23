import type {
  AdminPlayerRow,
  AdminQuestion,
  Difficulty,
  LeaderboardRow,
  PlayerProfile,
  PlayerProgress,
  Question,
  TopicCount,
} from '@shared/types.js'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body as T
}

export const api = {
  createPlayer: (name: string) =>
    request<{ player: PlayerProfile }>('/api/players', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }).then((r) => r.player),

  getPlayer: (id: string) =>
    request<{ player: PlayerProfile }>(`/api/players/${encodeURIComponent(id)}`).then(
      (r) => r.player,
    ),

  renamePlayer: (id: string, name: string) =>
    request<{ player: PlayerProfile }>(`/api/players/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }).then((r) => r.player),

  leaderboard: () => request<{ rows: LeaderboardRow[] }>('/api/leaderboard').then((r) => r.rows),

  progress: (id: string) =>
    request<PlayerProgress>(`/api/players/${encodeURIComponent(id)}/progress`),

  /** Topics with at least one active question at this difficulty. */
  topics: (difficulty: Difficulty) =>
    request<TopicCount[]>(`/api/topics?difficulty=${encodeURIComponent(difficulty)}`),
}

export interface ImportPlanRow {
  row: number
  action: 'create' | 'update' | 'reject'
  detail: string
}

export interface ImportResponse {
  dryRun: boolean
  summary: { created: number; updated: number; rejected: number }
  plan: ImportPlanRow[]
  counts?: Record<Difficulty, number>
}

export const adminApi = {
  session: () => request<{ authenticated: boolean }>('/api/admin/session'),

  login: (password: string) =>
    request<{ ok: true }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),

  questions: (params: {
    difficulty?: Difficulty | ''
    active?: string
    search?: string
    /** null = every topic; '' = uncategorised ("General"). */
    topic?: string | null
  }) => {
    const qs = new URLSearchParams()
    if (params.difficulty) qs.set('difficulty', params.difficulty)
    if (params.topic !== undefined && params.topic !== null) qs.set('topic', params.topic)
    if (params.active && params.active !== 'all') qs.set('active', params.active)
    if (params.search) qs.set('search', params.search)
    return request<{
      questions: AdminQuestion[]
      counts: Record<Difficulty, number>
      difficultyCounts: Record<Difficulty, number>
      topics: TopicCount[]
    }>(`/api/admin/questions?${qs}`)
  },

  create: (body: unknown) =>
    request<{ question: Question }>('/api/admin/questions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: number, body: unknown) =>
    request<{ question: Question }>(`/api/admin/questions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  remove: (id: number) =>
    request<{ ok: true }>(`/api/admin/questions/${id}`, { method: 'DELETE' }),

  resetStats: (id: number) =>
    request<{ question: Question }>(`/api/admin/questions/${id}/stats/reset`, { method: 'POST' }),

  resetAllStats: () =>
    request<{ ok: true }>('/api/admin/questions/stats/reset', { method: 'POST' }),

  importText: (payload: { csv?: string; json?: string; dryRun: boolean }) =>
    request<ImportResponse>('/api/admin/questions/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importPdf: () =>
    request<{ created: number; updated: number; parsed: number; problems: string[] }>(
      '/api/admin/questions/import-pdf',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  exportUrl: (format: 'json' | 'csv') => `/api/admin/questions/export?format=${format}`,

  players: () =>
    request<{ players: AdminPlayerRow[] }>('/api/admin/players').then((r) => r.players),

  playerProgress: (id: string) =>
    request<PlayerProgress>(`/api/admin/players/${encodeURIComponent(id)}/progress`),

  /** The raw answer log — one row per attempt — which is what the researchers analyse. */
  answersExportUrl: (params: {
    format: 'csv' | 'json'
    from?: string
    to?: string
    topic?: string | null
  }) => {
    const qs = new URLSearchParams({ format: params.format })
    if (params.from) qs.set('from', params.from)
    if (params.to) qs.set('to', params.to)
    if (params.topic !== undefined && params.topic !== null) qs.set('topic', params.topic)
    return `/api/admin/answers/export?${qs}`
  },
}
