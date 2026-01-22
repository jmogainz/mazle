-- 000002_add_attempts_json.up.sql
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS attempt_scores jsonb;
ALTER TABLE daily_results ADD COLUMN IF NOT EXISTS attempts_json jsonb;
DROP TABLE IF EXISTS guest_user_links;
DROP TABLE IF EXISTS guest_profiles;

---- create above / drop below ----

-- 000002_add_attempts_json.down.sql
ALTER TABLE daily_results DROP COLUMN IF EXISTS attempts_json;
ALTER TABLE daily_results DROP COLUMN IF EXISTS attempt_scores;
CREATE TABLE IF NOT EXISTS guest_profiles (
  guest_id uuid PRIMARY KEY,
  display_name text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_user_links (
  guest_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  migrated_at timestamptz
);
CREATE INDEX IF NOT EXISTS guest_user_links_user_id_idx ON guest_user_links(user_id);
