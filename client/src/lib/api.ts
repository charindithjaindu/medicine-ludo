import type { LeaderboardRow, PlayerProfile, Question, Tier } from '@shared/types.js'

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
  counts?: Record<Tier, number>
}

export const adminApi = {
  session: () => request<{ authenticated: boolean }>('/api/admin/session'),

  login: (password: string) =>
    request<{ ok: true }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),

  questions: (params: { tier?: Tier | ''; active?: string; search?: string }) => {
    const qs = new URLSearchParams()
    if (params.tier) qs.set('tier', String(params.tier))
    if (params.active && params.active !== 'all') qs.set('active', params.active)
    if (params.search) qs.set('search', params.search)
    return request<{ questions: Question[]; counts: Record<Tier, number> }>(
      `/api/admin/questions?${qs}`,
    )
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
}
