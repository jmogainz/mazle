-- 000001_initial.up.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  name text,
  image_url text,
  display_name text,
  display_name_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Ensure columns exist if the users table pre-dates this migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_updated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_lower_uidx ON users (lower(display_name));

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  character_id text NOT NULL DEFAULT 'default',
  skin_id text NOT NULL DEFAULT 'default',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  leaderboard_auto_submit boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oidc_accounts (
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS oidc_accounts_user_id_idx ON oidc_accounts(user_id);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  source text NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  stripe_price_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS purchases_stripe_subscription_id_uidx ON purchases(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_puzzles (
  date date PRIMARY KEY,
  seed text NOT NULL,
  puzzle_blob jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_results (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now(),
  completed boolean NOT NULL,
  time_ms integer CHECK (time_ms is null or time_ms > 0),
  attempts_used integer CHECK (attempts_used is null or (attempts_used >= 1 and attempts_used <= 3)),
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS daily_results_user_date_idx ON daily_results(user_id, date desc);

-- guest_daily_results is now stored in Redis with 10-day TTL, not PostgreSQL

CREATE TABLE IF NOT EXISTS guest_user_links (
  guest_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  migrated_at timestamptz
);
CREATE INDEX IF NOT EXISTS guest_user_links_user_id_idx ON guest_user_links(user_id);

CREATE TABLE IF NOT EXISTS leaderboard_submissions (
  date date NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('guest','user')),
  subject_id uuid NOT NULL,
  time_ms integer NOT NULL,
  attempts_used integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS leaderboard_submissions_date_idx ON leaderboard_submissions(date);

CREATE TABLE IF NOT EXISTS leaderboard_podium (
  date date NOT NULL,
  rank integer NOT NULL CHECK (rank IN (1,2,3)),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_ms integer NOT NULL CHECK (time_ms > 0),
  attempts_used integer NOT NULL CHECK (attempts_used >= 1 and attempts_used <= 3),
  display_name_at_time text NOT NULL,
  character_id_at_time text NOT NULL,
  skin_id_at_time text NOT NULL,
  PRIMARY KEY (date, rank),
  UNIQUE (date, user_id)
);
CREATE INDEX IF NOT EXISTS leaderboard_podium_date_idx ON leaderboard_podium(date);

---- create above / drop below ----

-- 000001_initial.down.sql
DROP TABLE IF EXISTS leaderboard_podium;
DROP TABLE IF EXISTS leaderboard_submissions;
DROP TABLE IF EXISTS daily_results;
DROP TABLE IF EXISTS user_links;
DROP TABLE IF EXISTS guest_user_links;
DROP TABLE IF EXISTS daily_puzzles;
DROP TABLE IF EXISTS stripe_events;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS entitlements;
DROP TABLE IF EXISTS oidc_accounts;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS users;
