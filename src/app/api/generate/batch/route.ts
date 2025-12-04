import { NextRequest, NextResponse } from 'next/server';

// Rust generator server URL (set via NEXT_PUBLIC_GENERATOR_URL, falls back to localhost for dev)
const GENERATOR_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || 'http://localhost:3001';

interface BatchRequest {
  seeds: string[];
  mapType?: string;
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
 *   "mapType": "ice",
 *   "config": {
 *     "traditionalAttempts": 400
 *   }
 * }
 * 
 * Note: This endpoint requires the Rust backend.
 * Batch generation is not supported via WASM (single-threaded).
 */
export async function POST(request: NextRequest) {
  try {
    const body: BatchRequest = await request.json();
    const { seeds, mapType = 'ice', config } = body;

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

    try {
      const rustResponse = await fetch(`${GENERATOR_URL}/api/generate/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds, mapType, config }),
        signal: AbortSignal.timeout(120000), // 2 min for batches
      });

      if (rustResponse.ok) {
        const data = await rustResponse.json();
        return NextResponse.json({
          ...data,
          generator: 'rust',
        });
      }
      
      return NextResponse.json(
        { error: `Rust backend error: ${rustResponse.status} ${rustResponse.statusText}` },
        { status: 502 }
      );
    } catch (rustError) {
      console.error('Rust generator unavailable for batch:', rustError);
      return NextResponse.json(
        { 
          error: 'Rust backend unavailable. Batch generation requires the Rust server.',
          hint: 'Start the Rust server with: cd generator-rust && cargo run --release'
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('Batch generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate puzzles' },
      { status: 500 }
    );
  }
}
