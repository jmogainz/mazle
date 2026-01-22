-- 000002_add_attempts_json.up.sql
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS attempt_scores jsonb;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS attempts_json jsonb;

---- create above / drop below ----

-- 000002_add_attempts_json.down.sql
ALTER TABLE daily_results DROP COLUMN IF EXISTS attempts_json;
ALTER TABLE daily_results DROP COLUMN IF EXISTS attempt_scores;
