import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/server/identity';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { jsonError, readJsonBody } from '@/lib/server/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  signedTransaction?: unknown;
};

type AppleConfig = {
  environment: Environment;
  bundleId: string;
  appAppleId?: number;
  lifetimeProductId: string;
  monthlyProductId: string;
  rootCertificates: Buffer[];
};

function getAppleConfig(): AppleConfig | null {
  const configuredEnvironment = env('APPLE_APP_STORE_ENVIRONMENT');
  const bundleId = env('APPLE_APP_STORE_BUNDLE_ID');
  const roots = env('APPLE_APP_STORE_ROOT_CERTS_BASE64');
  const appAppleIdRaw = env('APPLE_APP_STORE_APP_ID');
  if (!configuredEnvironment || !bundleId || !roots) return null;

  const environment = configuredEnvironment.toLowerCase() === 'production'
    ? Environment.PRODUCTION
    : configuredEnvironment.toLowerCase() === 'sandbox'
      ? Environment.SANDBOX
      : null;
  if (!environment) return null;

  const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined;
  if (environment === Environment.PRODUCTION && (!appAppleId || !Number.isInteger(appAppleId))) {
    return null;
  }

  const rootCertificates = roots
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((value) => Buffer.from(value, 'base64'))
    .filter((value) => value.length > 128);
  if (rootCertificates.length === 0) return null;

  return {
    environment,
    bundleId,
    appAppleId,
    lifetimeProductId: env('APPLE_APP_STORE_LIFETIME_PRODUCT_ID') ?? 'com.mazle.archive.lifetime',
    monthlyProductId: env('APPLE_APP_STORE_MONTHLY_PRODUCT_ID') ?? 'com.mazle.archive.monthly',
    rootCertificates,
  };
}

function isActiveTransaction(expiresDate: number | undefined, revocationDate: number | undefined): boolean {
  if (revocationDate != null) return false;
  return expiresDate == null || expiresDate > Date.now();
}

export async function POST(request: Request) {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, 'AUTH_REQUIRED', 'Sign in before syncing an Apple purchase.');

  const config = getAppleConfig();
  if (!config) {
    return jsonError(503, 'APPLE_ENTITLEMENT_NOT_CONFIGURED', 'Apple entitlement verification is not configured on this server.');
  }

  const body = await readJsonBody<Body>(request).catch(() => ({} as Body));
  const signedTransaction = typeof body.signedTransaction === 'string' ? body.signedTransaction : '';
  if (!signedTransaction) return jsonError(400, 'SIGNED_TRANSACTION_REQUIRED', 'A StoreKit signed transaction is required.');

  try {
    const verifier = new SignedDataVerifier(
      config.rootCertificates,
      true,
      config.environment,
      config.bundleId,
      config.appAppleId
    );
    const transaction = await verifier.verifyAndDecodeTransaction(signedTransaction);
    const transactionId = transaction.transactionId;
    const originalTransactionId = transaction.originalTransactionId ?? transactionId;
    const productId = transaction.productId;
    if (!transactionId || !originalTransactionId || !productId) {
      return jsonError(400, 'APPLE_TRANSACTION_INCOMPLETE', 'Apple returned an incomplete transaction.');
    }

    const expectedProducts = new Set([config.lifetimeProductId, config.monthlyProductId]);
    if (!expectedProducts.has(productId)) {
      return jsonError(400, 'APPLE_PRODUCT_NOT_ALLOWED', 'This Apple product is not an archive entitlement.');
    }
    if (transaction.bundleId && transaction.bundleId !== config.bundleId) {
      return jsonError(400, 'APPLE_BUNDLE_MISMATCH', 'Apple transaction bundle does not match this app.');
    }
    if (transaction.environment && transaction.environment !== config.environment) {
      return jsonError(400, 'APPLE_ENVIRONMENT_MISMATCH', 'Apple transaction environment does not match this server.');
    }

    await ensureDbSchema();
    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ id: string; user_id: string }>(
        `select id, user_id
           from purchases
          where apple_transaction_id=$1 or apple_original_transaction_id=$2
          limit 1
          for update`,
        [transactionId, originalTransactionId]
      );
      if (existing.rowCount && existing.rows[0].user_id !== userId) {
        await client.query('ROLLBACK');
        return jsonError(409, 'APPLE_TRANSACTION_ALREADY_CLAIMED', 'This Apple purchase is linked to another account.');
      }

      const active = isActiveTransaction(transaction.expiresDate, transaction.revocationDate);
      const storedExpiry = active
        ? (transaction.expiresDate ? new Date(transaction.expiresDate) : null)
        : new Date(0);
      if (existing.rowCount) {
        await client.query(
          `update purchases
              set apple_transaction_id=$2,
                  apple_original_transaction_id=$3,
                  apple_product_id=$4,
                  apple_environment=$5,
                  apple_expires_at=$6
            where id=$1`,
          [existing.rows[0].id, transactionId, originalTransactionId, productId, config.environment, storedExpiry]
        );
      } else {
        await client.query(
          `insert into purchases
             (user_id, apple_transaction_id, apple_original_transaction_id, apple_product_id, apple_environment, apple_expires_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [userId, transactionId, originalTransactionId, productId, config.environment, storedExpiry]
        );
      }

      const activePurchases = await client.query<{ apple_product_id: string; apple_expires_at: Date | null }>(
        `select apple_product_id, apple_expires_at
           from purchases
          where user_id=$1
            and apple_product_id is not null
            and (apple_expires_at is null or apple_expires_at > now())`,
        [userId]
      );
      const hasLifetime = activePurchases.rows.some((row) => row.apple_product_id === config.lifetimeProductId && row.apple_expires_at == null);
      const monthlyExpiries = activePurchases.rows
        .filter((row) => row.apple_product_id === config.monthlyProductId && row.apple_expires_at)
        .map((row) => new Date(row.apple_expires_at as Date).getTime());
      const latestMonthlyExpiry = monthlyExpiries.length ? new Date(Math.max(...monthlyExpiries)) : null;
      const archiveAccess = hasLifetime || monthlyExpiries.length > 0;

      await client.query("delete from entitlements where user_id=$1 and key in ('archive_access', 'ads_removed')", [userId]);
      if (archiveAccess) {
        const expiry = hasLifetime ? null : latestMonthlyExpiry;
        await client.query(
          `insert into entitlements (user_id, key, source, expires_at)
           values ($1, 'archive_access', $2, $3), ($1, 'ads_removed', $2, $3)
           on conflict (user_id, key) do update set source=excluded.source, expires_at=excluded.expires_at`,
          [userId, `apple:${config.environment}`, expiry]
        );
      }
      await client.query('COMMIT');

      return NextResponse.json({
        archiveAccess,
        adsRemoved: archiveAccess,
        productId,
        transactionId,
        expiresAt: hasLifetime ? null : latestMonthlyExpiry?.toISOString() ?? null,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Apple transaction verification failed';
    console.error('[APPLE_ENTITLEMENTS] verification failed', message);
    return jsonError(400, 'APPLE_TRANSACTION_INVALID', 'Apple transaction verification failed.');
  }
}
