import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** A query whose underlying statement is resolved through the shared cache. */
class Query {
  constructor(
    private statement: (sql: string) => StatementSync,
    private sql: string,
    private values: SQLInputValue[] = [],
  ) {}
  bind(...values: unknown[]) { return new Query(this.statement, this.sql, values as SQLInputValue[]) }
  first<T = Record<string, unknown>>(): T | null {
    return (this.statement(this.sql).get(...this.values) as T | undefined) ?? null
  }
  all<T>() { return { results: this.statement(this.sql).all(...this.values) as T[] } }
  run() { return this.statement(this.sql).run(...this.values) }
}

export class Sqlite {
  readonly raw: DatabaseSync
  // node:sqlite re-parses SQL on every prepare() call, so hot statements are
  // compiled once and reused. Query text is the cache key; the handful of
  // dynamically-built queries each have a bounded number of variants.
  private statements = new Map<string, StatementSync>()
  constructor(filename = process.env.DATABASE_PATH ?? 'data/medicine-ludo.sqlite') {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
    this.raw = new DatabaseSync(filename, { timeout: 5000 })
    // WAL keeps writes crash-safe against a process kill at commit cost; NORMAL
    // drops the fsync-per-commit that FULL costs. The trade is that an OS crash
    // or power loss may lose the last few commits — game rooms are 6h-expiring
    // state, so durability of recent milliseconds is not worth an fsync per
    // answer, let alone per broadcast.
    this.raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;')
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
  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql)
    if (!stmt) this.statements.set(sql, (stmt = this.raw.prepare(sql)))
    return stmt
  }
  prepare(sql: string) { return new Query(sql => this.statement(sql), sql) }
  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.raw.exec('COMMIT'); return result }
    catch (error) { this.raw.exec('ROLLBACK'); throw error }
  }
  batch(queries: Query[]) { return this.transaction(() => queries.map(q => q.run())) }
  close() { this.raw.close() }
}
