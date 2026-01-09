/**
 * Dedicated Web Worker for WASM puzzle generation.
 *
 * Runs WASM generation off the main thread to prevent UI freezing.
 * WASM runs single-threaded (no rayon thread pool) for optimal performance.
 */

// Worker message types
interface GenerateRequest {
  type: 'generate';
  id: number;
  seed: string;
  closenessThreshold?: number;
}

interface InitRequest {
  type: 'init';
}

type WorkerRequest = GenerateRequest | InitRequest;

interface GenerateResponse {
  type: 'generated';
  id: number;
  puzzle: unknown;
  elapsed: number;
}

interface ErrorResponse {
  type: 'error';
  id: number;
  error: string;
}

interface ReadyResponse {
  type: 'ready';
  version: string;
}

type WorkerResponse = GenerateResponse | ErrorResponse | ReadyResponse;

// WASM module state
let wasm: typeof import('../wasm/generator/mazle_generator') | null = null;
let initialized = false;

/**
 * Initialize the WASM module (single-threaded, no rayon thread pool)
 */
async function initialize(): Promise<void> {
  if (initialized) return;

  try {
    console.log('[Worker] Loading WASM module...');
    const loadStart = performance.now();

    // Dynamic import of the WASM module
    wasm = await import('../wasm/generator/mazle_generator');
    await wasm.default();

    const loadElapsed = performance.now() - loadStart;
    console.log(`[Worker] WASM loaded in ${loadElapsed.toFixed(0)}ms`);
    console.log('[Worker] Running single-threaded (no rayon thread pool - faster for puzzle generation)');

    initialized = true;

    const response: ReadyResponse = {
      type: 'ready',
      version: wasm.getVersion(),
    };
    self.postMessage(response);

    console.log(`[Worker] Ready (v${response.version})`);
  } catch (error) {
    console.error('[Worker] Initialization failed:', error);
    const response: ErrorResponse = {
      type: 'error',
      id: -1,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
}

/**
 * Generate a puzzle (synchronous, blocks this worker thread).
 */
async function generate(id: number, seed: string, closenessThreshold?: number): Promise<void> {
  if (!wasm || !initialized) {
    const response: ErrorResponse = {
      type: 'error',
      id,
      error: 'Worker not initialized',
    };
    self.postMessage(response);
    return;
  }

  try {
    console.log(`[Worker] Generating puzzle for seed: ${seed}`);
    const startTime = performance.now();

    // Generate puzzle (this blocks until complete)
    let puzzle;
    if (closenessThreshold !== undefined) {
      // Create config object matching Rust's GenerationConfig
      const config = {
        closenessThreshold,
        // Default other values as they aren't exposed yet
        targetPsychologyScore: 2000,
        parallel: false, // Worker is single-threaded
        startBatch: 0,
      };
      puzzle = wasm.generateWithConfig(seed, config);
    } else {
      puzzle = wasm.generate(seed);
    }

    const elapsed = performance.now() - startTime;
    console.log(`[Worker] Generated in ${elapsed.toFixed(0)}ms`);

    const response: GenerateResponse = {
      type: 'generated',
      id,
      puzzle,
      elapsed,
    };
    self.postMessage(response);
  } catch (error) {
    console.error('[Worker] Generation failed:', error);
    const response: ErrorResponse = {
      type: 'error',
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { data } = event;

  switch (data.type) {
    case 'init':
      await initialize();
      break;
    case 'generate':
      await generate(data.id, data.seed, data.closenessThreshold);
      break;
  }
};

// Auto-initialize when worker starts
initialize();
