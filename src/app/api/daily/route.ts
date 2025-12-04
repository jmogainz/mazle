import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getNewYorkDateString, getDailySeed, getPuzzleNumber } from '@/game/puzzleGenerator';
import type { PuzzleData } from '@/game/types';

// Initialize Redis client (optional - gracefully disabled if not configured)
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null;

if (!redis) {
  console.warn('[/api/daily] Redis not configured (UPSTASH_REDIS_REST_URL/TOKEN missing) - KV caching disabled');
}

// Rust generator server URL
const GENERATOR_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || null;

/**
 * GET /api/daily
 * 
 * Serves the daily puzzle from Vercel KV, with on-demand generation fallback.
 * 
 * Flow:
 * 1. Check KV for today's puzzle
 * 2. If not found, generate via Rust backend and store in KV
 * 3. Return puzzle
 * 
 * IMPORTANT: Never overwrites existing puzzles (uses NX flag) to prevent
 * intraday puzzle changes if the generation algorithm changes.
 * 
 * Response:
 * {
 *   puzzle: PuzzleData,
 *   puzzleNumber: number,
 *   date: string,
 *   source: 'kv' | 'generated'
 * }
 */
export async function GET() {
  const today = new Date();
  const dateStr = getNewYorkDateString(today);
  const puzzleNumber = getPuzzleNumber(today);
  const seed = getDailySeed(today);
  const kvKey = `puzzle:${dateStr}`;
  
  if (redis) {
    try {
      // Try to get pre-generated puzzle from KV
      const cachedPuzzle = await redis.get<PuzzleData>(kvKey);
      
      if (cachedPuzzle) {
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
      
      console.log(`[/api/daily] Cache miss for ${dateStr}, generating on-demand...`);
      
    } catch (error) {
      console.error('[/api/daily] KV read error:', error);
      // Continue to generation fallback
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // KV miss: Generate on-demand and cache (self-healing)
  // ─────────────────────────────────────────────────────────────────────────
  
  if (!GENERATOR_URL) {
    // No backend configured - client will fall back to WASM
    return NextResponse.json({
      error: 'Daily puzzle not available (no generator configured)',
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'not_found',
    }, { 
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  
  try {
    // Generate via Rust backend
    const puzzle = await generateFromRust(seed);
    
    if (!puzzle) {
      return NextResponse.json({
        error: 'Failed to generate puzzle',
        puzzleNumber,
        date: dateStr,
        seed,
        source: 'not_found',
      }, { 
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    
    // Store in KV with NX (only if not exists) to prevent overwrites
    // This handles race conditions where multiple requests try to generate simultaneously
    if (redis) {
      try {
        const wasSet = await redis.set(kvKey, puzzle, { 
          ex: 7 * 24 * 60 * 60,  // 7 day TTL
          nx: true,              // Only set if key doesn't exist
        });
        
        if (wasSet) {
          console.log(`[/api/daily] Generated and cached puzzle for ${dateStr}`);
        } else {
          // Another request already stored it - that's fine, puzzles are deterministic
          console.log(`[/api/daily] Puzzle for ${dateStr} was already cached by another request`);
        }
      } catch (kvError) {
        // KV write failed - still return the puzzle, just log the error
        console.error('[/api/daily] Failed to cache puzzle:', kvError);
      }
    }
    
    return NextResponse.json({
      puzzle,
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'generated',
    }, {
      headers: {
        // Cache the generated response too
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
    
  } catch (error) {
    console.error('[/api/daily] Generation error:', error);
    
    return NextResponse.json({
      error: 'Failed to generate daily puzzle',
      details: error instanceof Error ? error.message : 'Unknown error',
      puzzleNumber,
      date: dateStr,
      seed,
      source: 'not_found',
    }, { 
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

/**
 * Generate puzzle from Rust backend
 */
async function generateFromRust(seed: string): Promise<PuzzleData | null> {
  if (!GENERATOR_URL) return null;
  
  try {
    const url = `${GENERATOR_URL}/api/generate/${encodeURIComponent(seed)}?parallel=true`;
    console.log(`[/api/daily] Calling Rust backend: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(120000), // 2 min timeout
    });
    
    if (!response.ok) {
      console.error(`[/api/daily] Rust backend error: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`[/api/daily] Generated in ${data.generationTimeMs}ms (optimal: ${data.puzzle.optimalMoves} moves)`);
    
    return data.puzzle as PuzzleData;
  } catch (error) {
    console.error('[/api/daily] Failed to call Rust backend:', error);
    return null;
  }
}
