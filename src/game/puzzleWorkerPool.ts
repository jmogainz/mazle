// Worker pool for TRUE parallel puzzle generation across multiple CPU cores
// With Rust backend (primary), WASM fallback (secondary), and web workers (tertiary)
import type { PuzzleData, MapType } from './types';

export interface WorkerRequest {
  type: 'generate';
  seed: string;
  workerId: number;
  constraintStart: number;
  constraintEnd: number;
  traditionalStart: number;
  traditionalEnd: number;
  forceMapType?: MapType;
}

export interface WorkerResponse {
  type: 'result' | 'error';
  workerId: number;
  puzzle?: PuzzleData;
  score?: number;
  error?: string;
}

export interface GenerationProgress {
  phase: 'generating' | 'rust-backend' | 'wasm';
  workersComplete: number;
  totalWorkers: number;
  bestScore: number;
}

// Get the Rust backend URL from environment (set at build time)
const RUST_BACKEND_URL = process.env.NEXT_PUBLIC_GENERATOR_URL;

// ─────────────────────────────────────────────────────────────────────────────
// WASM Generator (fallback when Rust backend is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

type WasmModule = typeof import('../wasm/generator/mazle_generator');
let wasmModule: WasmModule | null = null;
let wasmLoadPromise: Promise<WasmModule> | null = null;
let wasmLoadFailed = false;

/**
 * Lazy-load the WASM generator module
 */
async function loadWasmGenerator(): Promise<WasmModule | null> {
  if (wasmLoadFailed) return null;
  if (wasmModule) return wasmModule;
  
  if (wasmLoadPromise) return wasmLoadPromise;
  
  wasmLoadPromise = (async () => {
    try {
      console.log('[WASM] Loading generator module...');
      const startTime = performance.now();
      
      // Dynamic import of the WASM module
      const wasm = await import('../wasm/generator/mazle_generator');
      
      // Initialize the WASM module
      await wasm.default();
      
      const elapsed = performance.now() - startTime;
      console.log(`[WASM] Generator loaded in ${elapsed.toFixed(0)}ms (v${wasm.getVersion()})`);
      
      wasmModule = wasm;
      return wasm;
    } catch (error) {
      console.warn('[WASM] Failed to load generator:', error);
      wasmLoadFailed = true;
      return null;
    }
  })();
  
  return wasmLoadPromise;
}

/**
 * Generate puzzle using WASM (browser-side Rust)
 * Returns null if WASM is unavailable
 */
async function generateFromWasm(
  seed: string,
  forceMapType?: MapType
): Promise<PuzzleData | null> {
  const wasm = await loadWasmGenerator();
  if (!wasm) return null;
  
  try {
    console.log(`[WASM] Generating puzzle for seed: ${seed}`);
    const startTime = performance.now();
    
    const mapType = forceMapType || 'ice';
    const puzzle = wasm.generate(seed, mapType) as PuzzleData;
    
    const elapsed = performance.now() - startTime;
    console.log(`[WASM] Generated puzzle in ${elapsed.toFixed(0)}ms (optimal: ${puzzle.optimalMoves})`);
    
    return puzzle;
  } catch (error) {
    console.error('[WASM] Generation failed:', error);
    return null;
  }
}

/**
 * Generate puzzle using Rust backend
 * Returns null if backend is unavailable or fails
 */
async function generateFromRustBackend(
  seed: string,
  forceMapType?: MapType
): Promise<PuzzleData | null> {
  if (!RUST_BACKEND_URL) {
    return null;
  }

  try {
    const mapType = forceMapType || 'ice';
    const url = `${RUST_BACKEND_URL}/api/generate/${encodeURIComponent(seed)}?map_type=${mapType}&parallel=true`;
    
    console.log(`[RustBackend] Fetching puzzle from ${url}`);
    const startTime = performance.now();
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      // Timeout after 30 seconds
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn(`[RustBackend] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const elapsed = performance.now() - startTime;
    
    console.log(`[RustBackend] Received puzzle in ${elapsed.toFixed(0)}ms (server time: ${data.generationTimeMs}ms, optimal: ${data.puzzle.optimalMoves})`);
    
    return data.puzzle as PuzzleData;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        console.warn('[RustBackend] Request timed out');
      } else {
        console.warn('[RustBackend] Failed to fetch:', error.message);
      }
    }
    return null;
  }
}

// Constants for work distribution
const TOTAL_CONSTRAINT_ATTEMPTS = 160;
const TOTAL_TRADITIONAL_ATTEMPTS = 400;

class WorkerPool {
  private workers: Worker[] = [];
  private workerCount: number;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Use all available cores for maximum parallelism
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    // Use all cores, minimum 2, no maximum
    this.workerCount = Math.max(2, cores);
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (typeof window === 'undefined') return;

      try {
        console.log(`[WorkerPool] Initializing ${this.workerCount} workers...`);
        
        for (let i = 0; i < this.workerCount; i++) {
          const worker = new Worker(
            new URL('./puzzleWorker.ts', import.meta.url)
          );
          this.workers.push(worker);
        }
        
        this.initialized = true;
        console.log(`[WorkerPool] ${this.workerCount} workers ready`);
      } catch (error) {
        console.error('[WorkerPool] Failed to initialize workers:', error);
        this.workers = [];
      }
    })();

    return this.initPromise;
  }

  async generate(
    seed: string,
    onProgress?: (progress: GenerationProgress) => void,
    forceMapType?: MapType
  ): Promise<PuzzleData> {
    const startTime = performance.now();
    console.log(`[WorkerPool] Starting parallel generation for seed: ${seed}${forceMapType ? ` (forced: ${forceMapType})` : ''}`);

    await this.init();

    // Fallback to main thread if no workers
    if (this.workers.length === 0) {
      console.warn('[WorkerPool] No workers available, falling back to main thread');
      const { generatePuzzle } = await import('./puzzleGenerator');
      return generatePuzzle(seed, forceMapType);
    }

    const numWorkers = this.workers.length;
    console.log(`[WorkerPool] Distributing work across ${numWorkers} workers`);

    // Calculate work distribution
    const constraintPerWorker = Math.ceil(TOTAL_CONSTRAINT_ATTEMPTS / numWorkers);
    const traditionalPerWorker = Math.ceil(TOTAL_TRADITIONAL_ATTEMPTS / numWorkers);

    return new Promise((resolve, reject) => {
      let completedWorkers = 0;
      let bestPuzzle: PuzzleData | null = null;
      let bestScore = 0;
      const cleanupHandlers: (() => void)[] = [];

      const handleResult = (workerId: number, puzzle: PuzzleData | null, score: number) => {
        completedWorkers++;
        
        if (puzzle && score > bestScore) {
          bestScore = score;
          bestPuzzle = puzzle;
          console.log(`[WorkerPool] Worker ${workerId} found better puzzle (score: ${score})`);
        }

        onProgress?.({
          phase: 'generating',
          workersComplete: completedWorkers,
          totalWorkers: numWorkers,
          bestScore,
        });

        // All workers done
        if (completedWorkers === numWorkers) {
          const elapsed = performance.now() - startTime;
          console.log(`[WorkerPool] All workers complete in ${elapsed.toFixed(0)}ms (best score: ${bestScore})`);
          
          // Cleanup handlers
          cleanupHandlers.forEach(cleanup => cleanup());

          if (bestPuzzle) {
            resolve(bestPuzzle);
          } else {
            // Fallback if no puzzle found (shouldn't happen)
            console.warn('[WorkerPool] No puzzle found, using fallback');
            import('./puzzleGenerator').then(({ generatePuzzle }) => {
              resolve(generatePuzzle(seed));
            }).catch(reject);
          }
        }
      };

      // Dispatch work to each worker
      this.workers.forEach((worker, i) => {
        const constraintStart = i * constraintPerWorker;
        const constraintEnd = Math.min((i + 1) * constraintPerWorker, TOTAL_CONSTRAINT_ATTEMPTS);
        const traditionalStart = i * traditionalPerWorker;
        const traditionalEnd = Math.min((i + 1) * traditionalPerWorker, TOTAL_TRADITIONAL_ATTEMPTS);

        const handleMessage = (e: MessageEvent<WorkerResponse>) => {
          if (e.data.workerId !== i) return;
          
          if (e.data.type === 'result') {
            handleResult(i, e.data.puzzle || null, e.data.score || 0);
          } else if (e.data.type === 'error') {
            console.error(`[WorkerPool] Worker ${i} error:`, e.data.error);
            handleResult(i, null, 0);
          }
        };

        const handleError = (e: ErrorEvent) => {
          console.error(`[WorkerPool] Worker ${i} crashed:`, e);
          handleResult(i, null, 0);
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);
        
        cleanupHandlers.push(() => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
        });

        const request: WorkerRequest = {
          type: 'generate',
          seed,
          workerId: i,
          constraintStart,
          constraintEnd,
          traditionalStart,
          traditionalEnd,
          forceMapType,
        };

        console.log(`[WorkerPool] Worker ${i}: constraints ${constraintStart}-${constraintEnd}, traditional ${traditionalStart}-${traditionalEnd}`);
        worker.postMessage(request);
      });
    });
  }

  terminate(): void {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.initialized = false;
    this.initPromise = null;
  }
}

// Singleton pool
let pool: WorkerPool | null = null;

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool();
  }
  return pool;
}

// Main export - generate puzzle using Rust backend (primary), WASM (secondary), or web workers (tertiary)
export async function generatePuzzleParallel(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void,
  forceMapType?: MapType
): Promise<PuzzleData> {
  // ─────────────────────────────────────────────────────────────────────────
  // Priority 1: Try Rust backend (fastest, parallel server-side)
  // ─────────────────────────────────────────────────────────────────────────
  if (RUST_BACKEND_URL) {
    console.log(`[PuzzleGen] Rust backend configured at ${RUST_BACKEND_URL}`);
    
    onProgress?.({
      phase: 'rust-backend',
      workersComplete: 0,
      totalWorkers: 1,
      bestScore: 0,
    });

    const puzzle = await generateFromRustBackend(seed, forceMapType);
    
    if (puzzle) {
      onProgress?.({
        phase: 'rust-backend',
        workersComplete: 1,
        totalWorkers: 1,
        bestScore: puzzle.difficultyScore || 0,
      });
      return puzzle;
    }
    
    console.warn('[PuzzleGen] Rust backend failed, trying WASM fallback');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 2: Try WASM (same Rust algorithms, runs in browser)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[PuzzleGen] Trying WASM generator...');
  
  onProgress?.({
    phase: 'wasm',
    workersComplete: 0,
    totalWorkers: 1,
    bestScore: 0,
  });
  
  const wasmPuzzle = await generateFromWasm(seed, forceMapType);
  
  if (wasmPuzzle) {
    onProgress?.({
      phase: 'wasm',
      workersComplete: 1,
      totalWorkers: 1,
      bestScore: wasmPuzzle.difficultyScore || 0,
    });
    return wasmPuzzle;
  }
  
  console.warn('[PuzzleGen] WASM generation failed, falling back to web workers (TypeScript)');

  // ─────────────────────────────────────────────────────────────────────────
  // Priority 3: Fall back to web workers (TypeScript implementation)
  // ─────────────────────────────────────────────────────────────────────────
  return getPool().generate(seed, onProgress, forceMapType);
}

export function getWorkerPool() {
  return {
    terminate: () => {
      if (pool) {
        pool.terminate();
        pool = null;
      }
    }
  };
}
