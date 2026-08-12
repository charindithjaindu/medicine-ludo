-- Adds the `difficulty` column to a database created before it existed, and labels
-- every question already in there.
--
--   npm run db:migrate         # local D1 (what `npm run dev` uses)
--   npm run db:migrate:remote  # the deployed database
--
-- Run it once. `ALTER TABLE ... ADD COLUMN` fails on a second run because the column
-- is already there — that error is the migration telling you it has nothing to do.

ALTER TABLE questions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'medium';

-- The seeded deck is ordered EASY through VERY DIFFICULT, so its own tiers are the
-- best label available for cards nobody has classified by hand.
UPDATE questions SET difficulty = CASE
  WHEN tier <= 2 THEN 'easy'
  WHEN tier <= 4 THEN 'medium'
  ELSE 'hard'
END;

CREATE INDEX IF NOT EXISTS idx_questions_difficulty_active ON questions(difficulty, active);
