-- 000006_add_viewed_at_to_analytics_daily_plays.up.sql
ALTER TABLE analytics_daily_plays
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

---- create above / drop below ----

-- 000006_add_viewed_at_to_analytics_daily_plays.down.sql
ALTER TABLE analytics_daily_plays
  DROP COLUMN IF EXISTS viewed_at;
