export type EnvName =
  | 'DATABASE_URL'
  | 'KV_REST_API_URL'
  | 'KV_REST_API_TOKEN'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
  | 'UPSTASH_LB_REST_URL'
  | 'UPSTASH_LB_REST_TOKEN'
  | 'GENERATOR_URL'
  | 'NEXT_PUBLIC_GENERATOR_URL'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'STRIPE_ARCHIVE_PRICE_ID'
  | 'STRIPE_ARCHIVE_PRICE_ID_MONTHLY'
  | 'STRIPE_ARCHIVE_PRICE_ID_LIFETIME'
  | 'CRON_SECRET'
  | 'AUTH_SECRET'
  | 'AUTH_URL'
  | 'NEXTAUTH_SECRET'
  | 'NEXTAUTH_URL'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'APPLE_CLIENT_ID'
  | 'APPLE_CLIENT_SECRET'
  | 'APPLE_TEAM_ID'
  | 'APPLE_KEY_ID'
  | 'APPLE_PRIVATE_KEY'
  | 'ADMIN_SECRET'
  | 'MAZLE_DEV_MODE'
  | 'NEXT_PUBLIC_ENV';

export function env(name: EnvName): string | undefined {
  return process.env[name];
}

export function requireEnv(name: EnvName): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function isDevMode(): boolean {
  if (env('MAZLE_DEV_MODE') === '1') return true;
  const publicEnv = env('NEXT_PUBLIC_ENV');
  if (!publicEnv) return false;
  return publicEnv === 'dev' || publicEnv === 'dev-test' || publicEnv === 'dev-local';
}
