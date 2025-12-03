import { NextRequest, NextResponse } from 'next/server';

const RUST_GENERATOR_URL = process.env.RUST_GENERATOR_URL || 'http://localhost:3001';

interface BatchRequest {
  seeds: string[];
  config?: {
    traditionalAttempts?: number;
    targetPsychologyScore?: number;
  };
}

/**
 * POST /api/generate/batch
 * 
 * Generate multiple puzzles in parallel using the Rust server.
 * Ideal for pre-generating puzzles or development iteration.
 * 
 * Request body:
 * {
 *   "seeds": ["2024-12-01", "2024-12-02", "2024-12-03"],
 *   "config": {
 *     "traditionalAttempts": 400
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();
    const { seeds, config } = body;

    if (!seeds || !Array.isArray(seeds) || seeds.length === 0) {
      return NextResponse.json(
        { error: 'Seeds array is required' },
        { status: 400 }
      );
    }

    if (seeds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 seeds per batch' },
        { status: 400 }
      );
    }

    // Try Rust generator first (it handles batches in parallel)
    try {
      const rustResponse = await fetch(`${RUST_GENERATOR_URL}/api/generate/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds, config }),
        signal: AbortSignal.timeout(120000), // 2 min for batches
      });

      if (rustResponse.ok) {
        const data = await rustResponse.json();
        return NextResponse.json({
          ...data,
          generator: 'rust',
        });
      }
    } catch (rustError) {
      console.log('Rust generator unavailable for batch, falling back to JS');
    }

    // Fallback to JS generator (sequential, slower)
    const { generatePuzzle } = await import('@/game/maps/ice/generator');
    
    const startTime = Date.now();
    const puzzles = [];
    
    for (const seed of seeds) {
      puzzles.push(generatePuzzle(seed));
    }
    
    const totalTimeMs = Date.now() - startTime;

    return NextResponse.json({
      puzzles,
      totalTimeMs,
      avgTimeMs: Math.round(totalTimeMs / seeds.length),
      generator: 'javascript',
    });

  } catch (error) {
    console.error('Batch generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate puzzles' },
      { status: 500 }
    );
  }
}
