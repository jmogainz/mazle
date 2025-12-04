import { NextRequest, NextResponse } from 'next/server';

// This route proxies to external Rust backend - must be dynamic
export const dynamic = 'force-dynamic';

// Rust generator server URL (set via NEXT_PUBLIC_GENERATOR_URL, falls back to localhost for dev)
const GENERATOR_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || 'http://localhost:3001';

interface GenerateRequest {
  seed: string;
  mapType?: string;
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
 * Generate a puzzle using the Rust server.
 * 
 * Request body:
 * {
 *   "seed": "2024-12-03",
 *   "mapType": "ice",
 *   "config": {
 *     "traditionalAttempts": 400,
 *     "targetPsychologyScore": 2000,
 *     "parallel": true
 *   }
 * }
 * 
 * Note: Client-side generation uses WASM as fallback.
 * This endpoint requires the Rust backend to be available.
 */
export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { seed, mapType = 'ice', config } = body;

    if (!seed) {
      return NextResponse.json(
        { error: 'Seed is required' },
        { status: 400 }
      );
    }

    try {
      const rustResponse = await fetch(`${GENERATOR_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, mapType, config }),
        signal: AbortSignal.timeout(120000), // 2 min timeout for server generation
      });

      if (rustResponse.ok) {
        const data: RustGenerateResponse = await rustResponse.json();
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
      console.error('Rust generator unavailable:', rustError);
      return NextResponse.json(
        { 
          error: 'Rust backend unavailable. Use client-side WASM generation instead.',
          hint: 'The frontend automatically falls back to WASM when the backend is unavailable.'
        },
        { status: 503 }
      );
    }
  } catch (error) {
    console.error('Generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate puzzle' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/generate?seed=2024-12-03&map_type=ice
 * 
 * Simple GET endpoint for easy testing
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const seed = searchParams.get('seed') || new Date().toISOString().split('T')[0];
  const mapType = searchParams.get('map_type') || 'ice';
  const attempts = parseInt(searchParams.get('attempts') || '400', 10);

  // Create a synthetic POST request
  const syntheticRequest = new NextRequest(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seed,
      mapType,
      config: { traditionalAttempts: attempts },
    }),
  });

  return POST(syntheticRequest);
}
