export type EnvName =
  | 'DB_URL'
  | 'KV_REST_API_URL'
  | 'KV_REST_API_TOKEN'
  | 'UPSTASH_REDIS_REST_URL'
  | 'UPSTASH_REDIS_REST_TOKEN'
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
  const publicEnv = env('NEXT_PUBLIC_ENV');
  if (!publicEnv) return false;
  return publicEnv === 'dev' || publicEnv === 'dev-test' || publicEnv === 'dev-local';
}
