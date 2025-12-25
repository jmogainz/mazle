import { Redis } from '@upstash/redis';
import { env } from './env';

export function getKvRedis(): Redis | null {
  const redisUrl = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const redisToken = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) return null;
  return new Redis({ url: redisUrl, token: redisToken });
}

export function getLeaderboardRedis(): Redis | null {
  const url = env('UPSTASH_LB_REST_URL');
  const token = env('UPSTASH_LB_REST_TOKEN');
  if (!url || !token) return null;
  return new Redis({ url, token });
}

