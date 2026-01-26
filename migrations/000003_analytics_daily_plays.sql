-- 000003_analytics_daily_plays.up.sql
-- Guest-inclusive analytics keyed by the guest cookie UUID ("player_id") + NY date.
-- This is intentionally compact: one row per player per day, updated as the player starts/finishes/shares.

CREATE TABLE IF NOT EXISTS analytics_daily_plays (
  date date NOT NULL,
  player_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  completed boolean,
  time_ms integer CHECK (time_ms is null or time_ms > 0),
  attempts_used integer CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 3)),
  share_count integer NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  shared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, player_id)
);

CREATE INDEX IF NOT EXISTS analytics_daily_plays_date_idx ON analytics_daily_plays(date);
CREATE INDEX IF NOT EXISTS analytics_daily_plays_player_date_idx ON analytics_daily_plays(player_id, date);
CREATE INDEX IF NOT EXISTS analytics_daily_plays_user_date_idx ON analytics_daily_plays(user_id, date) WHERE user_id IS NOT NULL;

---- create above / drop below ----

-- 000003_analytics_daily_plays.down.sql
DROP TABLE IF EXISTS analytics_daily_plays;

