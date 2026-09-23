-- Persistent SQLite schema for the Node backend.

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
  -- How hard the medicine is, independent of the tier. A room is filtered by this:
  -- an Easy room only ever draws Easy cards.
  difficulty    TEXT    NOT NULL DEFAULT 'medium'
                        CHECK (difficulty IN ('easy','medium','hard')),
  -- 1-90 for cards seeded from the PDF, NULL for admin-authored questions.
  -- UNIQUE is what makes re-importing the PDF an update rather than a duplicate.
  source_card   INTEGER UNIQUE,
  -- Free-text label managed by admins; '' = uncategorised ("General"). Databases
  -- created before topics get this column from the migration in sqlite.ts.
  topic         TEXT    NOT NULL DEFAULT '',
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

CREATE INDEX IF NOT EXISTS idx_questions_difficulty_active ON questions(difficulty, active);

-- One row per question answered by a human player: the research data. Computer
-- players never write here. question_id is deliberately not a foreign key, so
-- deleting a question keeps the attempts that were made at it; topic and difficulty
-- are copied as they were when the question was asked.
CREATE TABLE IF NOT EXISTS answer_log (
  id             INTEGER PRIMARY KEY,
  player_id      TEXT    NOT NULL,
  question_id    INTEGER NOT NULL,
  topic          TEXT    NOT NULL DEFAULT '',
  difficulty     TEXT    NOT NULL,
  room_code      TEXT    NOT NULL,
  -- The room's UUID, so two games in the same room stay distinguishable.
  game_id        TEXT    NOT NULL,
  -- NULL when the clock ran out: the team's "skipped" question.
  chosen         TEXT,
  correct_letter TEXT    NOT NULL,
  outcome        TEXT    NOT NULL CHECK (outcome IN ('correct','wrong','timeout')),
  time_ms        INTEGER NOT NULL,
  answered_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answer_log_player ON answer_log(player_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_answer_log_question ON answer_log(question_id);
