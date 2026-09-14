-- 000008_adventure_mode.up.sql
-- Adventure players are intentionally separate from daily Mazle results. Guests
-- are keyed by the durable guest cookie; signed-in players retain normal FK
-- cleanup through users. Exactly one identity column is populated per row.
CREATE TABLE IF NOT EXISTS adventure_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  guest_id uuid UNIQUE,
  claimed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  hearts smallint NOT NULL DEFAULT 3 CHECK (hearts >= 0 AND hearts <= 100),
  max_hearts smallint NOT NULL DEFAULT 3 CHECK (max_hearts >= 1 AND max_hearts <= 100),
  next_heart_at timestamptz,
  refill_tickets integer NOT NULL DEFAULT 0 CHECK (refill_tickets >= 0),
  last_daily_refill_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adventure_players_one_identity_check
    CHECK ((user_id IS NOT NULL AND guest_id IS NULL) OR (user_id IS NULL AND guest_id IS NOT NULL)),
  CONSTRAINT adventure_players_guest_claim_check
    CHECK (user_id IS NULL OR claimed_by_user_id IS NULL)
);

CREATE TABLE IF NOT EXISTS adventure_level_progress (
  player_id uuid NOT NULL REFERENCES adventure_players(id) ON DELETE CASCADE,
  level_id smallint NOT NULL CHECK (level_id BETWEEN 1 AND 50),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 3),
  best_moves integer NOT NULL CHECK (best_moves > 0),
  best_time_ms integer NOT NULL CHECK (best_time_ms > 0),
  catalog_version text NOT NULL,
  completed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, level_id)
);
CREATE INDEX IF NOT EXISTS adventure_level_progress_player_level_idx
  ON adventure_level_progress(player_id, level_id);

-- A heart is reserved when an attempt starts and is returned only on a win.
-- The unique active-attempt index prevents two devices spending the same heart.
CREATE TABLE IF NOT EXISTS adventure_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES adventure_players(id) ON DELETE CASCADE,
  level_id smallint NOT NULL CHECK (level_id BETWEEN 1 AND 50),
  catalog_version text NOT NULL,
  start_idempotency_key text NOT NULL CHECK (char_length(start_idempotency_key) BETWEEN 8 AND 128),
  finish_idempotency_key text CHECK (finish_idempotency_key IS NULL OR char_length(finish_idempotency_key) BETWEEN 8 AND 128),
  outcome text NOT NULL DEFAULT 'active' CHECK (outcome IN ('active', 'won', 'failed', 'abandoned')),
  energy_reserved boolean NOT NULL DEFAULT false,
  moves integer CHECK (moves IS NULL OR moves >= 0),
  time_ms integer CHECK (time_ms IS NULL OR time_ms > 0),
  stars smallint CHECK (stars IS NULL OR stars BETWEEN 1 AND 3),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (player_id, start_idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS adventure_attempts_player_finish_key_uidx
  ON adventure_attempts(player_id, finish_idempotency_key)
  WHERE finish_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS adventure_attempts_one_active_uidx
  ON adventure_attempts(player_id)
  WHERE outcome = 'active';
CREATE INDEX IF NOT EXISTS adventure_attempts_player_started_idx
  ON adventure_attempts(player_id, started_at DESC);

-- Refill use is independently idempotent from purchases. This prevents double
-- spending when a mobile client retries after losing a response.
CREATE TABLE IF NOT EXISTS adventure_energy_operations (
  player_id uuid NOT NULL REFERENCES adventure_players(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  kind text NOT NULL CHECK (kind IN ('daily_refill', 'ticket_refill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, idempotency_key)
);

-- Verified provider transaction IDs are the fulfillment idempotency boundary.
-- Only signed-in users can own purchased refill tickets.
CREATE TABLE IF NOT EXISTS adventure_purchase_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'apple')),
  external_transaction_id text NOT NULL,
  provider_payment_id text,
  product_id text NOT NULL,
  ticket_count integer NOT NULL CHECK (ticket_count > 0),
  remaining_tickets integer NOT NULL CHECK (remaining_tickets >= 0 AND remaining_tickets <= ticket_count),
  status text NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'revoked')),
  provider_event_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_transaction_id)
);
CREATE INDEX IF NOT EXISTS adventure_purchase_ledger_user_created_idx
  ON adventure_purchase_ledger(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS adventure_purchase_ledger_provider_payment_uidx
  ON adventure_purchase_ledger(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- Provider events are not ordered. A refund can arrive before its checkout or
-- client claim, so durable tombstones must suppress any later grant.
CREATE TABLE IF NOT EXISTS adventure_purchase_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'apple')),
  external_transaction_id text,
  provider_payment_id text,
  provider_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adventure_purchase_revocations_identifier_check
    CHECK (external_transaction_id IS NOT NULL OR provider_payment_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS adventure_purchase_revocations_external_uidx
  ON adventure_purchase_revocations(provider, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS adventure_purchase_revocations_payment_uidx
  ON adventure_purchase_revocations(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

---- create above / drop below ----

-- 000008_adventure_mode.down.sql
DROP TABLE IF EXISTS adventure_purchase_revocations;
DROP TABLE IF EXISTS adventure_purchase_ledger;
DROP TABLE IF EXISTS adventure_energy_operations;
DROP TABLE IF EXISTS adventure_attempts;
DROP TABLE IF EXISTS adventure_level_progress;
DROP TABLE IF EXISTS adventure_players;
