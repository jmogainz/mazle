import { NextRequest, NextResponse } from 'next/server';

// Rust generator server URL (configurable via environment)
const RUST_GENERATOR_URL = process.env.RUST_GENERATOR_URL || 'http://localhost:3001';

interface GenerateRequest {
  seed: string;
  config?: {
    constraintAttempts?: number;
    traditionalAttempts?: number;
    targetPsychologyScore?: number;
    parallel?: boolean;
  };
}

interface RustGenerateResponse {
  puzzle: {
    width: number;
    height: number;
    tiles: number[][];
    start: { x: number; y: number };
    goal: { x: number; y: number };
    optimalMoves: number;
    mapType: string;
    difficultyScore: number;
    counterIntuitiveMoves?: number;
    attractiveDecoys?: number;
    commitmentGates?: number;
    falseProgressPaths?: number;
  };
  generationTimeMs: number;
}

/**
 * POST /api/generate
 * 
 * Generate a puzzle using the Rust server (fast) with fallback to JS generator.
 * 
 * Request body:
 * {
 *   "seed": "2024-12-03",
 *   "config": {
 *     "traditionalAttempts": 400,
 *     "targetPsychologyScore": 2000,
 *     "parallel": true
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { seed, config } = body;

    if (!seed) {
      return NextResponse.json(
        { error: 'Seed is required' },
        { status: 400 }
      );
    }

    // Try Rust generator first
    try {
      const rustResponse = await fetch(`${RUST_GENERATOR_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, config }),
        // Short timeout - if Rust server is down, fail fast
        signal: AbortSignal.timeout(30000),
      });

      if (rustResponse.ok) {
        const data: RustGenerateResponse = await rustResponse.json();
        return NextResponse.json({
          ...data,
          generator: 'rust',
        });
      }
    } catch (rustError) {
      // Rust server unavailable - will fall back to JS
      console.log('Rust generator unavailable, falling back to JS');
    }

    // Fallback to JS generator (dynamic import to avoid loading if not needed)
    const { generatePuzzle } = await import('@/game/maps/ice/generator');
    
    const startTime = Date.now();
    const puzzle = generatePuzzle(seed);
    const generationTimeMs = Date.now() - startTime;

    return NextResponse.json({
      puzzle,
      generationTimeMs,
      generator: 'javascript',
    });

  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate puzzle' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/generate?seed=2024-12-03
 * 
 * Simple GET endpoint for easy testing
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seed = searchParams.get('seed') || new Date().toISOString().split('T')[0];
  const attempts = parseInt(searchParams.get('attempts') || '400', 10);

  // Create a synthetic POST request
  const syntheticRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seed,
      config: { traditionalAttempts: attempts },
    }),
  });

  return POST(syntheticRequest);
}
