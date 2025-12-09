/**
 * Dedicated Web Worker for WASM puzzle generation.
 * 
 * This worker runs the WASM generation off the main thread to prevent UI freezing.
 * The main thread posts generation requests, and this worker posts back results.
 * 
 * Progress is tracked by polling wasm.getProgress() during generation.
 */

// Worker message types
interface GenerateRequest {
  type: 'generate';
  id: number;
  seed: string;
  mapType: string;
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
  threads: number;
}

type WorkerResponse = GenerateResponse | ErrorResponse | ReadyResponse;

// WASM module state
let wasm: typeof import('../wasm/generator/mazle_generator') | null = null;
let initialized = false;

/**
 * Initialize the WASM module and thread pool
 */
async function initialize(): Promise<void> {
  if (initialized) return;
  
  try {
    console.log('[Worker] Loading WASM module...');
    const loadStart = performance.now();
    
    // Dynamic import of the WASM module
    wasm = await import('../wasm/generator/mazle_generator');
    await wasm.default();
    
    console.log(`[Worker] WASM loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);
    
    // Get thread count (use all available cores)
    const threads = navigator.hardwareConcurrency || 4;
    
    console.log(`[Worker] Initializing rayon thread pool with ${threads} threads...`);
    console.log('[Worker] This creates Web Workers for parallel computation...');
    const poolStart = performance.now();
    
    await wasm.initThreadPool(threads);
    
    const poolElapsed = performance.now() - poolStart;
    console.log(`[Worker] Thread pool initialized in ${poolElapsed.toFixed(0)}ms`);
    
    // If pool init was very fast (<50ms), threads might not have actually spawned
    if (poolElapsed < 50) {
      console.warn('[Worker] Thread pool init was very fast - threads may not have spawned correctly');
    }
    
    initialized = true;
    
    const response: ReadyResponse = {
      type: 'ready',
      version: wasm.getVersion(),
      threads,
    };
    self.postMessage(response);
    
    console.log(`[Worker] Ready (v${response.version}, ${threads} threads)`);
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
 * Generate a puzzle.
 * 
 * Note: wasm.generate() is synchronous and blocks this worker thread.
 * Progress is simulated on the main thread side (wasmGenerator.ts) since
 * we can't poll during generation.
 */
async function generate(id: number, seed: string, mapType: string): Promise<void> {
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
    const puzzle = wasm.generate(seed, mapType);
    
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
      await generate(data.id, data.seed, data.mapType);
      break;
  }
};

// Auto-initialize when worker starts
initialize();
