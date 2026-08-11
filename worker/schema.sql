-- D1 schema. Identical to the SQLite schema it replaced; D1 speaks SQLite.

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  name         TEXT    NOT NULL DEFAULT '',
  total_score  INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  answered     INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL,
  last_seen    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tier          INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 6),
  -- 1-90 for cards seeded from the PDF, NULL for admin-authored questions.
  -- UNIQUE is what makes re-importing the PDF an update rather than a duplicate.
  source_card   INTEGER UNIQUE,
  text          TEXT    NOT NULL,
  option_a      TEXT    NOT NULL,
  option_b      TEXT    NOT NULL,
  option_c      TEXT    NOT NULL,
  option_d      TEXT    NOT NULL,
  answer        TEXT    NOT NULL CHECK (answer IN ('A','B','C','D')),
  explanation   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  times_asked   INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,
  times_timeout INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_tier_active ON questions(tier, active);
