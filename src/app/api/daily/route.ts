import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

// This route uses Redis - must be dynamic
export const dynamic = 'force-dynamic';
import { getNewYorkDateString, getDailySeed, getPuzzleNumber } from '@/game/puzzleGenerator';
import type { PuzzleData } from '@/game/types';

// Initialize Redis client (optional - gracefully disabled if not configured)
// Vercel's Upstash integration uses KV_REST_API_* variable names
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

/**
 * GET /api/daily
 * 
 * Cache-only endpoint for daily puzzles from Vercel KV.
 * 
 * DESIGN: This endpoint does NOT call the Rust backend to avoid Vercel's 
 * 10-second serverless timeout on hobby tier. Instead:
 * 
 * 1. Cron job pre-generates puzzles at 11 PM ET (can timeout, non-critical)
 * 2. This endpoint only checks KV cache
 * 3. On cache miss, client falls back to:
 *    - Rust backend (direct client call)
 *    - WASM (local generation)
 * 4. Client backfills cache via POST /api/daily/cache
 * 
 * Response:
 * - 200: { puzzle, puzzleNumber, date, seed, source: 'kv' }
 * - 404: { puzzleNumber, date, seed, source: 'not_found' } - triggers client fallback
 */
export async function GET() {
  const today = new Date();
  const dateStr = getNewYorkDateString(today);
  const puzzleNumber = getPuzzleNumber(today);
  const seed = getDailySeed(today);
  const kvKey = `puzzle:${dateStr}`;
  
  if (!redis) {
    console.warn('[/api/daily] Redis not configured (KV_REST_API_URL/TOKEN missing)');
    return NextResponse.json({
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'not_found',
      message: 'Cache not configured - use client-side generation',
    }, { 
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  
  try {
    // Check KV cache for pre-generated puzzle
    const cachedPuzzle = await redis.get<PuzzleData>(kvKey);
    
    if (cachedPuzzle) {
      console.log(`[/api/daily] Cache hit for ${dateStr}`);
      return NextResponse.json({
        puzzle: cachedPuzzle,
        puzzleNumber,
        date: dateStr,
        seed,
        source: 'kv',
      }, {
        headers: {
          // Cache for 5 minutes on CDN, stale-while-revalidate for 1 hour
          // This reduces KV reads while still allowing timely updates
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        },
      });
    }
    
    // Cache miss - return 404 so client falls back to Rust/WASM
    console.log(`[/api/daily] Cache miss for ${dateStr} - client will generate`);
    return NextResponse.json({
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'not_found',
      message: 'Puzzle not in cache - use client-side generation',
    }, { 
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
    
  } catch (error) {
    console.error('[/api/daily] KV read error:', error);
    
    // On KV error, return 404 so client falls back
    return NextResponse.json({
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'not_found',
      message: 'Cache read error - use client-side generation',
    }, { 
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
