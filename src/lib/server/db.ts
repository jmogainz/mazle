import { Pool } from 'pg';
import { env, requireEnv } from './env';
import { ensureSchema } from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __mazleDbPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __mazleSchemaEnsured: boolean | undefined;
}

export function getDbPool(): Pool {
  if (global.__mazleDbPool) return global.__mazleDbPool;
  const connectionString = requireEnv('DATABASE_URL');
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
  if (!env('DATABASE_URL')) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = getDbPool();
  await ensureSchema(pool);
  global.__mazleSchemaEnsured = true;
}

