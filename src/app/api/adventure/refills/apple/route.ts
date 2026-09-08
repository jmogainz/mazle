import { Environment, SignedDataVerifier, Type } from '@apple/app-store-server-library';
import type { JWSTransactionDecodedPayload } from '@apple/app-store-server-library';
import { NextResponse } from 'next/server';
import type { AdventureAppleRefillRequest, AdventureAppleRefillResponse } from '@/lib/adventureApi';
import { AdventureError, getAdventureState, grantAdventureRefillPurchase } from '@/lib/server/adventure';
import { appleAdventureRefillPackByProductId } from '@/lib/server/adventurePurchases';
import { adventureMutationRequestError } from '@/lib/server/adventureResponses';
import { ensureDbSchema, getDbPool } from '@/lib/server/db';
import { env } from '@/lib/server/env';
import { resolveMeIdentity } from '@/lib/server/identity';
import { jsonError, readJsonBody } from '@/lib/server/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AppleVerifierConfig = {
  environment: Environment;
  bundleId: string;
  appAppleId?: number;
  rootCertificates: Buffer[];
};

function appleVerifierConfig(): AppleVerifierConfig | null {
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
  if (environment === Environment.PRODUCTION && (!appAppleId || !Number.isInteger(appAppleId))) return null;
  const rootCertificates = roots
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((value) => Buffer.from(value, 'base64'))
    .filter((value) => value.length > 128);
  if (rootCertificates.length === 0) return null;
  return { environment, bundleId, appAppleId, rootCertificates };
}

export async function POST(request: Request) {
  const requestError = adventureMutationRequestError(request);
  if (requestError) return requestError;

  const me = await resolveMeIdentity(request);
  const userId = me.userId;
  if (!userId) return jsonError(401, 'AUTH_REQUIRED', 'Sign in before syncing an Apple refill purchase.');

  const config = appleVerifierConfig();
  if (!config) {
    return jsonError(503, 'APPLE_PURCHASE_NOT_CONFIGURED', 'Apple purchase verification is not configured.');
  }

  let body: AdventureAppleRefillRequest;
  try {
    body = await readJsonBody<AdventureAppleRefillRequest>(request);
  } catch {
    return jsonError(400, 'INVALID_REQUEST', 'Invalid JSON body.');
  }
  if (typeof body.signedTransaction !== 'string' || !body.signedTransaction) {
    return jsonError(400, 'SIGNED_TRANSACTION_REQUIRED', 'A StoreKit signed transaction is required.');
  }

  let transaction: JWSTransactionDecodedPayload;
  try {
    const verifier = new SignedDataVerifier(
      config.rootCertificates,
      true,
      config.environment,
      config.bundleId,
      config.appAppleId
    );
    transaction = await verifier.verifyAndDecodeTransaction(body.signedTransaction);
  } catch (error) {
    console.error('[ADVENTURE_APPLE_REFILL] verification failed', error);
    return jsonError(400, 'APPLE_TRANSACTION_INVALID', 'Apple transaction verification failed.');
  }

  const transactionId = transaction.transactionId;
  const productId = transaction.productId;
  if (!transactionId || !productId) {
    return jsonError(400, 'APPLE_TRANSACTION_INCOMPLETE', 'Apple returned an incomplete transaction.');
  }
  const pack = appleAdventureRefillPackByProductId(productId);
  if (!pack) return jsonError(400, 'APPLE_PRODUCT_NOT_ALLOWED', 'This Apple product is not a refill pack.');
  if (transaction.type !== Type.CONSUMABLE) {
    return jsonError(400, 'APPLE_PRODUCT_TYPE_INVALID', 'The Apple refill product is not consumable.');
  }
  if (transaction.revocationDate != null) {
    return jsonError(409, 'APPLE_TRANSACTION_REVOKED', 'This Apple transaction was refunded or revoked.');
  }
  if (transaction.bundleId && transaction.bundleId !== config.bundleId) {
    return jsonError(400, 'APPLE_BUNDLE_MISMATCH', 'Apple transaction bundle does not match this app.');
  }
  if (transaction.environment && transaction.environment !== config.environment) {
    return jsonError(400, 'APPLE_ENVIRONMENT_MISMATCH', 'Apple transaction environment does not match this server.');
  }
  if (!transaction.appAccountToken || transaction.appAccountToken.toLowerCase() !== userId.toLowerCase()) {
    return jsonError(409, 'APPLE_ACCOUNT_MISMATCH', 'This Apple purchase belongs to a different Mazle account.');
  }

  const quantity = transaction.quantity == null ? 1 : transaction.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return jsonError(400, 'APPLE_QUANTITY_INVALID', 'Apple returned an invalid purchase quantity.');
  }

  try {
    await ensureDbSchema();
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const fulfillment = await grantAdventureRefillPurchase(client, {
        userId,
        provider: 'apple',
        externalTransactionId: transactionId,
        providerPaymentId: transaction.originalTransactionId ?? transactionId,
        productId,
        ticketCount: pack.ticketCount * quantity,
        metadata: {
          environment: config.environment,
          purchaseDate: transaction.purchaseDate ?? null,
          quantity,
        },
      });
      await client.query('COMMIT');
      const state = await getAdventureState(me);
      return NextResponse.json({
        ok: true,
        energy: state.energy,
        granted: fulfillment.granted,
        refillTickets: fulfillment.refillTickets,
        productId,
        transactionId,
      } satisfies AdventureAppleRefillResponse, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[ADVENTURE_APPLE_REFILL] fulfillment failed', error);
    if (error instanceof AdventureError) return jsonError(error.status, error.code, error.message);
    return jsonError(500, 'APPLE_FULFILLMENT_FAILED', 'Apple purchase fulfillment failed. Please try again.');
  }
}
