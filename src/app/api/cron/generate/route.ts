import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// This route uses request.headers, Redis, and external API calls - must be dynamic
export const dynamic = 'force-dynamic';
import { getNewYorkDateString, getDailySeed, getPuzzleNumber } from '@/game/puzzleGenerator';

// Initialize Redis client (required for cron - should error if not configured in prod)
// Vercel's Upstash integration uses KV_REST_API_* variable names
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;
import type { PuzzleData } from '@/game/types';

// Rust generator server URL
const GENERATOR_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || 'http://localhost:3001';

// Secret to verify cron requests (set in Vercel environment variables)
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/generate
 * 
 * Cron endpoint that pre-generates tomorrow's daily puzzle.
 * Called at 11 PM ET daily via Vercel Cron.
 * 
 * Security: Requires CRON_SECRET header (Vercel adds this automatically for cron jobs)
 * 
 * Flow:
 * 1. Calculate tomorrow's date (since we run at 11 PM, generate for next day)
 * 2. Call Rust backend to generate puzzle
 * 3. Store in Vercel KV with 7-day TTL
 */
export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel Cron (or has valid secret for manual trigger)
    const authHeader = request.headers.get('authorization');
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';
    
    if (!isVercelCron && authHeader !== `Bearer ${CRON_SECRET}`) {
      console.warn('[cron/generate] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Calculate tomorrow's date in New York timezone
    // We run at 11 PM ET, so "tomorrow" is the puzzle that goes live at midnight
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowDateStr = getNewYorkDateString(tomorrow);
    const tomorrowSeed = getDailySeed(tomorrow);
    const tomorrowPuzzleNumber = getPuzzleNumber(tomorrow);
    
    console.log(`[cron/generate] Generating puzzle for ${tomorrowDateStr} (puzzle #${tomorrowPuzzleNumber})`);
    
    if (!redis) {
      console.warn('[cron/generate] Redis not configured (KV_REST_API_URL/TOKEN missing) - will generate but cannot cache');
    }
    
    // Also generate today's puzzle if it doesn't exist (safety net)
    const todayDateStr = getNewYorkDateString(now);
    const todaySeed = getDailySeed(now);
    const todayKey = `puzzle:${todayDateStr}`;
    const existingToday = redis ? await redis.get(todayKey) : null;
    
    const results: { date: string; status: string; puzzleNumber?: number; cached?: boolean }[] = [];
    
    // Generate today's if missing (or if we can't check cache)
    if (!existingToday) {
      console.log(`[cron/generate] Today's puzzle missing, generating for ${todayDateStr}`);
      const todayPuzzle = await generateFromRust(todaySeed);
      if (todayPuzzle) {
        let cached = false;
        if (redis) {
          await redis.set(todayKey, todayPuzzle, { ex: 7 * 24 * 60 * 60 }); // 7 day TTL
          cached = true;
        }
        results.push({ 
          date: todayDateStr, 
          status: 'generated', 
          puzzleNumber: getPuzzleNumber(now),
          cached,
        });
      } else {
        results.push({ date: todayDateStr, status: 'generation_failed' });
      }
    } else {
      results.push({ date: todayDateStr, status: 'exists' });
    }
    
    // Generate tomorrow's puzzle
    const tomorrowKey = `puzzle:${tomorrowDateStr}`;
    const existingTomorrow = redis ? await redis.get(tomorrowKey) : null;
    
    if (!existingTomorrow) {
      const tomorrowPuzzle = await generateFromRust(tomorrowSeed);
      if (tomorrowPuzzle) {
        let cached = false;
        if (redis) {
          await redis.set(tomorrowKey, tomorrowPuzzle, { ex: 7 * 24 * 60 * 60 }); // 7 day TTL
          cached = true;
        }
        results.push({ 
          date: tomorrowDateStr, 
          status: 'generated', 
          puzzleNumber: tomorrowPuzzleNumber,
          cached,
        });
        console.log(`[cron/generate] Successfully generated puzzle #${tomorrowPuzzleNumber}${cached ? ' (cached)' : ' (not cached - Redis unavailable)'}`);
      } else {
        results.push({ date: tomorrowDateStr, status: 'generation_failed' });
        console.error(`[cron/generate] Failed to generate puzzle for ${tomorrowDateStr}`);
      }
    } else {
      results.push({ date: tomorrowDateStr, status: 'exists' });
      console.log(`[cron/generate] Puzzle for ${tomorrowDateStr} already exists`);
    }
    
    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      results,
    });
    
  } catch (error) {
    console.error('[cron/generate] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * Generate puzzle from Rust backend
 */
async function generateFromRust(seed: string): Promise<PuzzleData | null> {
  try {
    const url = `${GENERATOR_URL}/api/generate/${encodeURIComponent(seed)}?parallel=true`;
    console.log(`[cron/generate] Calling Rust backend: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });
    
    if (!response.ok) {
      console.error(`[cron/generate] Rust backend error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[cron/generate] Generated in ${data.generationTimeMs}ms (optimal: ${data.puzzle.optimalMoves} moves)`);
    
    return data.puzzle as PuzzleData;
  } catch (error) {
    console.error('[cron/generate] Failed to call Rust backend:', error);
    return null;
  }
}
