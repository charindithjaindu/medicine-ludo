# Deploying to Cloudflare

Everything is built and verified locally. Three commands are left, and the first
one needs a browser, so it has to be you.

```bash
npx wrangler login      # opens a browser
npm run cf:init         # creates D1, writes its id, pushes schema + secrets
npm run deploy          # builds the client and deploys the Worker
```

`cf:init` prints the admin password it uploaded (taken from `.env`, or generated if
that file is missing). `deploy` prints the live URL, something like
`https://medicine-ludo.<your-subdomain>.workers.dev`.

Then seed the question bank into the deployed database:

```bash
npm run import:pdf -- --remote
```

## Migrating a database that is already live

`schema.sql` only creates tables that do not exist, so a database deployed before
question difficulty existed will not pick up the new column from it. Run the
migration once, before deploying the new Worker:

```bash
npm run db:migrate:remote
```

It adds `questions.difficulty` and labels every question already in there from its
tier — tiers 1–2 Easy, 3–4 Medium, 5–6 Hard — which is the same ordering the source
PDF uses. Re-classify from `/admin` afterwards. Running it a second time fails on
the duplicate column, which is the migration saying it has nothing left to do.

## What runs where

| Piece | Cloudflare |
|---|---|
| The app (React build) | Workers static assets, SPA routing so `/admin` works |
| REST API + websocket routing | the Worker |
| A room in progress | one Durable Object per 6-digit code |
| Players, leaderboard, questions | D1 |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Worker secrets |

A Durable Object gives each room the single authoritative instance a turn-based
game needs — every player in a room is served by the same object, so there is no
cross-instance state to reconcile.

All of it fits the free plan: the DO class is SQLite-backed, which is the kind the
free tier allows.

## Local development

`npm run dev` runs the same Worker through `wrangler dev` with a local D1 and local
Durable Objects, plus Vite for the client with hot reload. Local and deployed run
identical server code.

Local secrets live in `worker/.dev.vars` (gitignored). `REVEAL_MS` and
`AI_DELAY_SCALE` can go in there too, to speed the game up while testing.

## Two things to know

**Rooms are in memory.** A Durable Object stays alive while anyone is connected, so
a game in progress is safe, but a room is not durable across an eviction. That is
fine for testing and matches the old behaviour, where rooms lived in the server's
memory. Making games survive would mean persisting `GameState` to DO storage on
each turn.

**Re-importing the PDF is not available in the admin panel when deployed.** It
shells out to `pdftotext`, which Workers cannot run — the button returns a message
saying so. Use `npm run import:pdf -- --remote` from your machine instead.
Everything else in the admin panel works normally.
