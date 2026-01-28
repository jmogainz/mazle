-- 000004_allow_five_attempts.up.sql
ALTER TABLE daily_results DROP CONSTRAINT IF EXISTS daily_results_attempts_used_check;
ALTER TABLE daily_results
  ADD CONSTRAINT daily_results_attempts_used_check
  CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 5));

ALTER TABLE leaderboard_podium DROP CONSTRAINT IF EXISTS leaderboard_podium_attempts_used_check;
ALTER TABLE leaderboard_podium
  ADD CONSTRAINT leaderboard_podium_attempts_used_check
  CHECK (attempts_used >= 1 and attempts_used <= 5);

ALTER TABLE analytics_daily_plays DROP CONSTRAINT IF EXISTS analytics_daily_plays_attempts_used_check;
ALTER TABLE analytics_daily_plays
  ADD CONSTRAINT analytics_daily_plays_attempts_used_check
  CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 5));

ALTER TABLE user_settings ALTER COLUMN theme SET DEFAULT 'light';

---- create above / drop below ----

-- 000004_allow_five_attempts.down.sql
ALTER TABLE analytics_daily_plays DROP CONSTRAINT IF EXISTS analytics_daily_plays_attempts_used_check;
ALTER TABLE analytics_daily_plays
  ADD CONSTRAINT analytics_daily_plays_attempts_used_check
  CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 3));

ALTER TABLE leaderboard_podium DROP CONSTRAINT IF EXISTS leaderboard_podium_attempts_used_check;
ALTER TABLE leaderboard_podium
  ADD CONSTRAINT leaderboard_podium_attempts_used_check
  CHECK (attempts_used >= 1 and attempts_used <= 3);

ALTER TABLE daily_results DROP CONSTRAINT IF EXISTS daily_results_attempts_used_check;
ALTER TABLE daily_results
  ADD CONSTRAINT daily_results_attempts_used_check
  CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 3));

ALTER TABLE user_settings ALTER COLUMN theme SET DEFAULT 'system';
