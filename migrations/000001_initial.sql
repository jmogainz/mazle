-- 000001_initial.up.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS daily_puzzles (
  date date PRIMARY KEY,
  seed text NOT NULL,
  puzzle_blob jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

---- create above / drop below ----

-- 000001_initial.down.sql
DROP TABLE IF EXISTS daily_puzzles;
