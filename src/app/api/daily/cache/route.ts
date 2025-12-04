import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getNewYorkDateString, getDailySeed } from '@/game/puzzleGenerator';

// Initialize Redis client (optional - gracefully disabled if not configured)
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null;

if (!redis) {
  console.warn('[/api/daily/cache] Redis not configured - cache backfill disabled');
}
import type { PuzzleData } from '@/game/types';
import { TileType } from '@/game/types';

/**
 * POST /api/daily/cache
 * 
 * Allows clients to backfill the KV cache after successful WASM generation.
 * This helps other users avoid slow WASM generation if the Rust backend is down.
 * 
 * Thread-safe: Uses NX (only set if not exists) so first write wins.
 * 
 * Request body:
 * {
 *   seed: string,    // Must match today's seed
 *   puzzle: PuzzleData
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { seed, puzzle } = body;
    
    if (!seed || !puzzle) {
      return NextResponse.json(
        { error: 'Missing seed or puzzle' },
        { status: 400 }
      );
    }
    
    // Verify the seed matches today's seed (prevent caching arbitrary puzzles)
    const today = new Date();
    const todaySeed = getDailySeed(today);
    
    if (seed !== todaySeed) {
      return NextResponse.json(
        { error: 'Seed does not match today\'s daily puzzle' },
        { status: 400 }
      );
    }
    
    // Basic puzzle validation
    if (!isValidPuzzle(puzzle)) {
      return NextResponse.json(
        { error: 'Invalid puzzle structure' },
        { status: 400 }
      );
    }
    
    // Store in KV with NX (only if not exists)
    // This ensures thread safety - first valid submission wins
    const dateStr = getNewYorkDateString(today);
    const kvKey = `puzzle:${dateStr}`;
    
    if (!redis) {
      return NextResponse.json({ 
        success: true, 
        cached: false,
        message: 'Redis not configured - caching skipped' 
      });
    }
    
    const wasSet = await redis.set(kvKey, puzzle, {
      ex: 7 * 24 * 60 * 60,  // 7 day TTL
      nx: true,              // Only set if key doesn't exist
    });
    
    if (wasSet) {
      console.log(`[/api/daily/cache] Client backfilled puzzle for ${dateStr}`);
      return NextResponse.json({ 
        success: true, 
        cached: true,
        message: 'Puzzle cached successfully' 
      });
    } else {
      // Already cached (by another request or cron)
      console.log(`[/api/daily/cache] Puzzle for ${dateStr} already cached`);
      return NextResponse.json({ 
        success: true, 
        cached: false,
        message: 'Puzzle already cached' 
      });
    }
    
  } catch (error) {
    console.error('[/api/daily/cache] Error:', error);
    return NextResponse.json(
      { error: 'Failed to cache puzzle' },
      { status: 500 }
    );
  }
}

/**
 * Basic validation that the puzzle has the expected structure
 */
function isValidPuzzle(puzzle: unknown): puzzle is PuzzleData {
  if (!puzzle || typeof puzzle !== 'object') return false;
  
  const p = puzzle as Record<string, unknown>;
  
  // Check required fields exist
  if (typeof p.width !== 'number' || p.width < 5 || p.width > 20) return false;
  if (typeof p.height !== 'number' || p.height < 5 || p.height > 20) return false;
  if (typeof p.optimalMoves !== 'number' || p.optimalMoves < 1) return false;
  
  // Check start/goal positions
  if (!isValidPosition(p.start, p.width, p.height)) return false;
  if (!isValidPosition(p.goal, p.width, p.height)) return false;
  
  // Check tiles array
  if (!Array.isArray(p.tiles)) return false;
  if (p.tiles.length !== p.height) return false;
  
  for (const row of p.tiles) {
    if (!Array.isArray(row)) return false;
    if (row.length !== p.width) return false;
    
    for (const tile of row) {
      if (typeof tile !== 'number') return false;
      if (tile < TileType.GROUND || tile > TileType.BOULDER) return false;
    }
  }
  
  return true;
}

function isValidPosition(pos: unknown, width: number, height: number): boolean {
  if (!pos || typeof pos !== 'object') return false;
  const p = pos as Record<string, unknown>;
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return false;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return false;
  return true;
}
