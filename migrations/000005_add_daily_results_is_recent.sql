-- 000005_add_daily_results_is_recent.up.sql
ALTER TABLE daily_results
  ADD COLUMN IF NOT EXISTS is_recent boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS daily_results_user_recent_date_idx
  ON daily_results(user_id, is_recent, date desc);

---- create above / drop below ----

-- 000005_add_daily_results_is_recent.down.sql
DROP INDEX IF EXISTS daily_results_user_recent_date_idx;

ALTER TABLE daily_results
  DROP COLUMN IF EXISTS is_recent;
