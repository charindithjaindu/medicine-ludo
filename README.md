# Medicine Ludo

A stripped-down Ludo where movement is earned by answering medical questions.
Players join a room with a 6-digit code, take turns rolling, and each roll draws a
question. Two pieces each, not four.

**The die face is the question tier.** Six tiers, six faces. Roll a 6 and you are
offered six squares — and the hardest card in the deck. Roll a 1 and it's an easy
question for one square. That single rule gives the game its risk and reward, with
nothing extra to explain.

---

## Running it

```bash
npm install
npm run import:pdf     # seeds the 90 questions from "tiered qa cards.pdf"
npm run dev            # server on :3001, client on :5173
```

Open http://localhost:5173.

`npm run import:pdf` needs `pdftotext` (`brew install poppler`). It is idempotent —
re-running it corrects the seeded cards rather than duplicating them.

### Playing without four humans

In the lobby, the host can drop a computer player into any empty seat — pick
**Intern**, **Resident** or **Consultant**, then tap the empty seat. Start with one
human and three AI if you like.

They're deliberately simple; this is a multiplayer game first. Answering is a
difficulty dial (a per-tier chance of being right, declining as cards get harder,
so a Consultant rarely misses an easy one and still fumbles the hardest). Piece
choice is a short priority list: reach home > capture > home column > safe square,
ties to the piece furthest along; going backward it retreats whichever piece can
most afford it. That lives in `shared/src/ai.ts` as pure functions with tests.

**Computer players never reach the leaderboard.** Their IDs are prefixed `ai-`, so
they create no player rows and are filtered out before results are recorded. They
still appear in the end-of-game table.

There is also `npm run playtest -- ffa quick` — four scripted clients that play a
full game over real sockets as *real* players, which is how the leaderboard write
path gets tested. That one is a test harness, not a way to play.

---

## Look and feel

A board-game table at night: deep animated indigo behind warm cream panels with
thick ink borders and hard offset shadows. Buttons press *into* the page — the
shadow collapses and the element shifts down-right — so every tap has weight.

Menus disclose progressively. Home is **two buttons**; the mode and board options
only appear once you've said you want to create a room. Nobody should have to read
six options to answer "start a game or join one?".

**All audio is synthesised at runtime** with the Web Audio API — there are no
sound files in this repo. `client/src/lib/audio.ts` generates the looping
background vamp (Am–F–C–G, bass + arpeggio + soft hats) and every effect: the dice
rattle, a rising arpeggio for correct, a descending one for wrong, a thud for a
capture, sparkles for a piece reaching home, and a fanfare for the win. The
countdown tick only plays for the player actually on the clock. Browsers block
audio until a user gesture, so nothing starts until the first click; the 🔊 toggle
persists to `localStorage`.

Motion is used to mark what changed: the die tumbles and settles, pieces slide
between squares and the active player's pulse, a right answer flashes the screen
green and fires confetti, a wrong one flashes red and shakes, and the winner gets
a confetti shower. Everything is disabled under `prefers-reduced-motion`.

---

## The rules

**Identity.** A player is a 6-digit ID plus an optional name. The ID is the only
unique key and the only credential — it exists so a returning player keeps their
score on the global leaderboard. There are no passwords; nothing sensitive sits
behind a player ID.

**Board.** A square ring with a home column running inward from the middle of each
side, and a shared home in the centre.

| Preset | Ring | Home column | Steps per piece | Measured length |
|---|---|---|---|---|
| Quick | 16 (5×5) | 1 | 17 | ~40–56 turns |
| Standard | 24 (7×7) | 2 | 26 | ~75 turns |

Both pieces start **on the board**, on your start square. Waiting to roll a 6 just
to enter play is the least fun part of Ludo and adds nothing to a question game.

**A turn.**
1. Roll. The face picks the tier and the maximum distance.
2. Answer within the time limit (20s easy → 45s very difficult). A timeout counts
   as wrong.
3. Correct → move a piece **forward by the roll**. Wrong → move one **back
   `floor(roll/2)`**, never past your own start. If only one piece can make the
   move, it just moves; if both can, you pick.
4. Landing on an opponent off a safe square sends them back to their start.
5. A correct answer on a 6 earns another turn, capped at two in a row.

**Safe squares** are the four start squares, marked ★. Nothing is captured there,
so everyone always has one square they can sit on without risk.

**Winning** — two pieces home, in both modes. In free-for-all that means your own
two. In 2v2 it means any two between the partners, so either partner can carry the
team, and partners can neither capture nor be captured by each other.

> Requiring all four of a team's pieces would double the target: measured at 81
> turns against 42–56 for free-for-all on the same board. Two pieces keeps a team
> game the same length as a solo one.

**Scoring** (feeds the leaderboard): 10/20/30/40/50/60 for a correct answer by
tier, +25 per capture, +50 per piece home, +100 for the win. A wrong answer is
worth 0 — never negative, so the leaderboard stays encouraging.

---

## Admin

At **`/admin`**, behind `ADMIN_PASSWORD` from `.env`. Nothing in the player UI links
there — players use `/`, admins type `/admin`. An unauthenticated visit shows a bare
password box, and every `/api/admin/*` route returns 401 without a session.

- Browse, search and filter the bank; create, edit, retire and delete questions.
- **Retiring** is the default over deleting: it keeps a question's stats and pulls
  it from future games.
- Per-question **asked / correct-rate / timeouts**, sortable worst-first. A 0%
  card is probably wrong or ambiguous; a 100% card on a hard tier belongs lower.
- Bulk CSV/JSON import with a **dry-run preview** before anything is written, plus
  export. An export re-imported updates the same rows, so it doubles as a backup.
- Re-run the source PDF, matching on card number so stats survive.

**One invariant matters more than the rest: a tier can never reach zero active
questions.** The die face *is* the tier, so an empty tier would be a roll the game
cannot answer. Retire, delete and import all refuse the last active card in a tier.

Decks are snapshotted when a game starts, so editing the bank mid-session cannot
disturb a game already in progress.

---

## Layout

```
shared/src/      types · board geometry · engine (pure rules) · engine.test.ts
server/src/      index · rooms (turn loop) · admin · api · db · questions · pdf-import
client/src/      screens/ (Play · Identity · Menu · Lobby · Game · Leaderboard · admin/)
scripts/         import-pdf · playtest · bots
```

Every rule lives in `shared/src/engine.ts` as pure `(state, action) => newState`
functions — no sockets, no clocks, no database. `server/src/rooms.ts` owns all of
that and is the only place that knows a question's answer before the reveal, which
is why broadcasting the whole game state to the room is safe.

That split is also what keeps a later Cloudflare port cheap: replacing
`server/src/index.ts` with a Worker + Durable Object and SQLite with D1 leaves the
engine and the entire client untouched.

## Tests

```bash
npm test                              # 34 engine tests: movement, capture, home, win
npm run playtest -- ffa quick 0.75    # 4 bots play a real game over sockets,
npm run playtest -- teams standard    # then the leaderboard is checked against the result
```

`REVEAL_MS`, `ROLL_TIMEOUT_MS`, `CHOICE_TIMEOUT_MS` and `AI_DELAY_SCALE` are
env-overridable, which is how a full game runs in seconds under test.
`AI_DELAY_SCALE=0.02` collapses the computer players' deliberate thinking pauses.

## Tuning

Pacing assumes roughly 70–75% accuracy. If real games run long: switch to the Quick
preset, then shrink the wrong-answer penalty. Board size is a single constant —
`SIDES` in `shared/src/board.ts` — and everything else is derived from it.
