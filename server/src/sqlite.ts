import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Small synchronous query wrapper. Bound statements are immutable and safe to reuse. */
class Query {
  constructor(private db: DatabaseSync, private sql: string, private values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) { return new Query(this.db, this.sql, values as SQLInputValue[]) }
  first<T = Record<string, unknown>>(): T | null {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null
  }
  all<T>() { return { results: this.db.prepare(this.sql).all(...this.values) as T[] } }
  run() { return this.db.prepare(this.sql).run(...this.values) }
}

export class Sqlite {
  readonly raw: DatabaseSync
  constructor(filename = process.env.DATABASE_PATH ?? 'data/medicine-ludo.sqlite') {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
    this.raw = new DatabaseSync(filename, { timeout: 5000 })
    this.raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    this.raw.exec(readFileSync(resolve('server/schema.sql'), 'utf8'))
    this.raw.exec(`CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY, snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS completed_games (id TEXT PRIMARY KEY);`)
    this.migrate()
  }
  /**
   * In-place upgrades for databases created by an older schema.sql, which only ever
   * runs CREATE ... IF NOT EXISTS. Each step checks before it alters, so running it
   * on every start is safe, and it only adds columns: existing rows keep their data.
   */
  private migrate() {
    const columns = this.raw.prepare('PRAGMA table_info(questions)').all() as Array<{ name: string }>
    if (!columns.some(c => c.name === 'topic')) {
      this.raw.exec("ALTER TABLE questions ADD COLUMN topic TEXT NOT NULL DEFAULT ''")
    }
  }
  prepare(sql: string) { return new Query(this.raw, sql) }
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.raw.exec('COMMIT'); return result }
    catch (error) { this.raw.exec('ROLLBACK'); throw error }
  }
  batch(queries: Query[]) { return this.transaction(() => queries.map(q => q.run())) }
  close() { this.raw.close() }
}
