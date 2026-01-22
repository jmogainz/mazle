import { Pool } from 'pg';
import { env, requireEnv } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __mazleDbPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mazleSchemaEnsured: boolean | undefined;
}

export function getDbPool(): Pool {
  if (global.__mazleDbPool) return global.__mazleDbPool;
  const connectionString = requireEnv('DB_URL');
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  global.__mazleDbPool = pool;
  return pool;
}

export async function ensureDbSchema(): Promise<void> {
  if (global.__mazleSchemaEnsured) return;
  if (!env('DB_URL')) {
    throw new Error('DB_URL is not set');
  }
  const pool = getDbPool();
  try {
    await pool.query('select 1 from schema_version limit 1');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Database schema not initialized. Run migrations. (${message})`);
  }
  global.__mazleSchemaEnsured = true;
}
