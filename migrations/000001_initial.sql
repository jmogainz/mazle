-- 000001_initial.up.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  name text,
  image_url text,
  display_name text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
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

---- create above / drop below ----

-- 000001_initial.down.sql
DROP TABLE IF EXISTS leaderboard_submissions;
DROP TABLE IF EXISTS daily_puzzles;
DROP TABLE IF EXISTS stripe_events;
DROP TABLE IF EXISTS purchases;
DROP TABLE IF EXISTS entitlements;
DROP TABLE IF EXISTS oidc_accounts;
DROP TABLE IF EXISTS users;
