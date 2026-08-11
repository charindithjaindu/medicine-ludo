/**
 * One-time Cloudflare setup: `npm run cf:init`
 *
 * Creates the D1 database, writes its id into wrangler.jsonc, pushes the schema and
 * the question bank, and uploads ADMIN_PASSWORD / SESSION_SECRET from .env as
 * Worker secrets. Safe to re-run.
 *
 * Requires `npx wrangler login` first — that opens a browser, so it cannot be done
 * for you.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const workerDir = path.join(root, 'worker')
const configPath = path.join(workerDir, 'wrangler.jsonc')
const DB_NAME = 'medicine-ludo'

const wrangler = (args: string[], opts: { capture?: boolean } = {}) =>
  execFileSync('npx', ['wrangler', ...args], {
    cwd: workerDir,
    encoding: 'utf8',
    stdio: opts.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })

function requireLogin() {
  try {
    const who = wrangler(['whoami'], { capture: true })
    const email = /([\w.+-]+@[\w.-]+)/.exec(who)?.[1]
    console.log(`Signed in to Cloudflare${email ? ` as ${email}` : ''}.\n`)
  } catch {
    console.error('Not signed in to Cloudflare.\n\n  npx wrangler login\n')
    process.exit(1)
  }
}

/** Find the database id, creating the database if this is the first run. */
function ensureDatabase(): string {
  let listing = ''
  try {
    listing = wrangler(['d1', 'list', '--json'], { capture: true })
  } catch {
    listing = '[]'
  }
  const existing = (JSON.parse(listing || '[]') as Array<{ name: string; uuid: string }>).find(
    (d) => d.name === DB_NAME,
  )
  if (existing) {
    console.log(`Using existing D1 database ${DB_NAME} (${existing.uuid})`)
    return existing.uuid
  }

  console.log(`Creating D1 database ${DB_NAME}…`)
  const created = wrangler(['d1', 'create', DB_NAME], { capture: true })
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(created)?.[1]
  if (!uuid) {
    console.error('Could not read the database id from wrangler output:\n' + created)
    process.exit(1)
  }
  return uuid
}

function writeDatabaseId(uuid: string) {
  const config = fs.readFileSync(configPath, 'utf8')
  const updated = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${uuid}"`)
  fs.writeFileSync(configPath, updated)
  console.log('Wrote the database id into worker/wrangler.jsonc')
}

function readEnv(): Record<string, string> {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

function putSecret(name: string, value: string) {
  execFileSync('npx', ['wrangler', 'secret', 'put', name], {
    cwd: workerDir,
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
}

requireLogin()
writeDatabaseId(ensureDatabase())

console.log('\nApplying schema to the deployed database…')
wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=schema.sql', '--yes'])

const seed = path.join(workerDir, 'seed-questions.sql')
if (fs.existsSync(seed)) {
  console.log('Seeding questions…')
  wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=seed-questions.sql', '--yes'])
} else {
  console.log('No seed file yet — run `npm run import:pdf -- --remote` after deploying.')
}

const env = readEnv()
const adminPassword = env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url')
const sessionSecret = env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')

console.log('\nUploading secrets…')
putSecret('ADMIN_PASSWORD', adminPassword)
putSecret('SESSION_SECRET', sessionSecret)

console.log(`\nReady. Admin password: ${adminPassword}`)
console.log('\nNow run:  npm run deploy')
