import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// This route uses request.headers, Redis, and external API calls - must be dynamic
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { getNewYorkDateString, getDailySeed, getPuzzleNumber } from '@/game/puzzleGenerator';

// Initialize Redis client (required for cron - should error if not configured in prod)
// Vercel's Upstash integration uses KV_REST_API_* variable names
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;
import type { PuzzleData } from '@/game/types';

// Rust generator server URL (use server-side env var, not NEXT_PUBLIC_)
const GENERATOR_URL = process.env.GENERATOR_URL || process.env.NEXT_PUBLIC_GENERATOR_URL || 'http://localhost:8080';

/**
 * GET /api/cron/generate
 * 
 * Cron endpoint that pre-generates tomorrow's daily puzzle.
 * Called at 3 AM UTC daily via Vercel Cron (11 PM ET).
 * 
 * Security: If CRON_SECRET env var is set, Vercel automatically sends
 * "Authorization: Bearer <CRON_SECRET>" for cron invocations.
 * We enforce auth only when CRON_SECRET is configured (allows local dev without it).
 * 
 * Flow:
 * 1. Calculate tomorrow's date (since we run at 11 PM ET, generate for next day)
 * 2. Call Rust backend to generate puzzle
 * 3. Store in Vercel KV with no TTL (supports archive calendar)
 */
export async function GET(request: NextRequest) {
  try {
    // Security: Only enforce auth if CRON_SECRET is configured
    // - On Vercel with CRON_SECRET set: cron requests get the header and pass; random callers get 401
    // - Locally or without CRON_SECRET: no auth enforced, can hit from browser/curl
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/generate] Unauthorized request - invalid or missing Authorization header');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!cronSecret) {
      console.warn('[cron/generate] CRON_SECRET not set - auth not enforced (ok for local dev)');
    }
    
    // Calculate tomorrow's date in New York timezone
    // We run at 11 PM ET, so "tomorrow" is the puzzle that goes live at midnight
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const tomorrowDateStr = getNewYorkDateString(tomorrow);
    const tomorrowSeed = getDailySeed(tomorrow);
    const tomorrowPuzzleNumber = getPuzzleNumber(tomorrow);
    const dayAfterDateStr = getNewYorkDateString(dayAfterTomorrow);
    const dayAfterSeed = getDailySeed(dayAfterTomorrow);
    const dayAfterPuzzleNumber = getPuzzleNumber(dayAfterTomorrow);
    
    console.log(`[cron/generate] Generating puzzles for ${tomorrowDateStr} (puzzle #${tomorrowPuzzleNumber}) and ${dayAfterDateStr} (puzzle #${dayAfterPuzzleNumber})`);
    
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
      const result = await generateFromRust(todaySeed);
      if (result) {
        let cached = false;
        if (redis) {
          await redis.set(todayKey, result.puzzle);
          cached = true;
        }
        results.push({ 
          date: todayDateStr, 
          status: result.backendCached ? 'from_backend_cache' : 'generated', 
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
      const result = await generateFromRust(tomorrowSeed);
      if (result) {
        let cached = false;
        if (redis) {
          await redis.set(tomorrowKey, result.puzzle);
          cached = true;
        }
        results.push({ 
          date: tomorrowDateStr, 
          status: result.backendCached ? 'from_backend_cache' : 'generated', 
          puzzleNumber: tomorrowPuzzleNumber,
          cached,
        });
        console.log(`[cron/generate] Successfully ${result.backendCached ? 'fetched' : 'generated'} puzzle #${tomorrowPuzzleNumber}${cached ? ' (stored in KV)' : ' (KV unavailable)'}`);
      } else {
        results.push({ date: tomorrowDateStr, status: 'generation_failed' });
        console.error(`[cron/generate] Failed to generate puzzle for ${tomorrowDateStr}`);
      }
    } else {
      results.push({ date: tomorrowDateStr, status: 'exists' });
      console.log(`[cron/generate] Puzzle for ${tomorrowDateStr} already exists in KV`);
    }

    // Generate day-after-tomorrow's puzzle
    const dayAfterKey = `puzzle:${dayAfterDateStr}`;
    const existingDayAfter = redis ? await redis.get(dayAfterKey) : null;

    if (!existingDayAfter) {
      const result = await generateFromRust(dayAfterSeed);
      if (result) {
        let cached = false;
        if (redis) {
          await redis.set(dayAfterKey, result.puzzle);
          cached = true;
        }
        results.push({ 
          date: dayAfterDateStr, 
          status: result.backendCached ? 'from_backend_cache' : 'generated', 
          puzzleNumber: dayAfterPuzzleNumber,
          cached,
        });
        console.log(`[cron/generate] Successfully ${result.backendCached ? 'fetched' : 'generated'} puzzle #${dayAfterPuzzleNumber}${cached ? ' (stored in KV)' : ' (KV unavailable)'}`);
      } else {
        results.push({ date: dayAfterDateStr, status: 'generation_failed' });
        console.error(`[cron/generate] Failed to generate puzzle for ${dayAfterDateStr}`);
      }
    } else {
      results.push({ date: dayAfterDateStr, status: 'exists' });
      console.log(`[cron/generate] Puzzle for ${dayAfterDateStr} already exists in KV`);
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
 * Returns puzzle data and whether it was served from backend cache
 */
async function generateFromRust(seed: string): Promise<{ puzzle: PuzzleData; backendCached: boolean } | null> {
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
    const backendCached = data.cached === true;
    console.log(`[cron/generate] ${backendCached ? '⚡ Cache HIT' : '🔧 Generated'} in ${data.generationTimeMs}ms (optimal: ${data.puzzle.optimalMoves} moves)`);
    
    return { puzzle: data.puzzle as PuzzleData, backendCached };
  } catch (error) {
    console.error('[cron/generate] Failed to call Rust backend:', error);
    return null;
  }
}
