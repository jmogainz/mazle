-- 000007_add_apple_purchase_fields.up.sql
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS apple_transaction_id text,
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id text,
  ADD COLUMN IF NOT EXISTS apple_product_id text,
  ADD COLUMN IF NOT EXISTS apple_environment text,
  ADD COLUMN IF NOT EXISTS apple_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS purchases_apple_transaction_id_uidx
  ON purchases(apple_transaction_id)
  WHERE apple_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchases_apple_original_transaction_id_uidx
  ON purchases(apple_original_transaction_id)
  WHERE apple_original_transaction_id IS NOT NULL;

---- create above / drop below ----

-- 000007_add_apple_purchase_fields.down.sql
DROP INDEX IF EXISTS purchases_apple_original_transaction_id_uidx;
DROP INDEX IF EXISTS purchases_apple_transaction_id_uidx;
ALTER TABLE purchases
  DROP COLUMN IF EXISTS apple_expires_at,
  DROP COLUMN IF EXISTS apple_environment,
  DROP COLUMN IF EXISTS apple_product_id,
  DROP COLUMN IF EXISTS apple_original_transaction_id,
  DROP COLUMN IF EXISTS apple_transaction_id;
