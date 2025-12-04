/**
 * WASM Generator Bridge
 * 
 * Manages puzzle generation via two backends (both produce identical puzzles):
 * 
 * 1. 🦀 Rust HTTP Server - Runs on server with rayon parallelism (port 3001)
 * 2. 🔷 WASM - Runs in a dedicated web worker with rayon via wasm-bindgen-rayon
 * 
 * The WASM backend runs in a single dedicated worker (generationWorker.ts) to:
 * - Keep the main thread responsive during generation (~200-500ms)
 * - Provide SharedArrayBuffer context for rayon thread pool
 * - Enable progress reporting back to UI
 * 
 * Parallelism happens inside Rust/WASM via rayon, NOT via multiple JS workers.
 */

import type { PuzzleData, MapType } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GeneratorBackend = 'auto' | 'rust' | 'wasm';

export interface GenerationProgress {
  phase: 'rust-backend' | 'wasm';
  workersComplete: number;
  totalWorkers: number;
  bestScore: number;
}

export interface GeneratorStatus {
  rustAvailable: boolean;
  rustUrl: string | null;
  wasmLoaded: boolean;
  wasmVersion: string | null;
  wasmThreadsInitialized: boolean;
  wasmThreadsAvailable: boolean;
  sharedArrayBufferAvailable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// Get the Rust backend URL from environment (set at build time)
const RUST_BACKEND_URL = process.env.NEXT_PUBLIC_GENERATOR_URL || null;

// ─────────────────────────────────────────────────────────────────────────────
// WASM Generator with Dedicated Worker
// ─────────────────────────────────────────────────────────────────────────────
// 
// IMPORTANT: WASM generation runs in a dedicated web worker to prevent UI freezing.
// The worker initializes its own WASM instance and rayon thread pool.
// ─────────────────────────────────────────────────────────────────────────────

let generationWorker: Worker | null = null;
let workerReady = false;
let workerReadyPromise: Promise<void> | null = null;
let wasmVersion: string | null = null;
let wasmThreadCount = 0;
let wasmThreadsAvailable = false;
let requestId = 0;

interface PendingRequest {
  resolve: (puzzle: PuzzleData) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: GenerationProgress) => void;
}
const pendingRequests = new Map<number, PendingRequest>();

/**
 * Check if SharedArrayBuffer is available (required for WASM threads)
 */
function isSharedArrayBufferAvailable(): boolean {
  try {
    if (typeof SharedArrayBuffer === 'undefined') {
      return false;
    }
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
      console.warn('[WASM] Page is not cross-origin isolated. COOP/COEP headers may be missing.');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the generation worker
 */
async function initGenerationWorker(): Promise<void> {
  if (workerReady) return;
  if (workerReadyPromise) return workerReadyPromise;
  
  // Check prerequisites
  if (!isSharedArrayBufferAvailable()) {
    console.error('[WASM] SharedArrayBuffer not available - WASM threading disabled');
    wasmThreadsAvailable = false;
    return;
  }
  
  workerReadyPromise = new Promise((resolve, reject) => {
    try {
      console.log('[WASM] Starting generation worker...');
      
      // Create worker using webpack's worker syntax
      generationWorker = new Worker(
        new URL('./generationWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      generationWorker.onmessage = (event) => {
        const data = event.data;
        
        switch (data.type) {
          case 'ready':
            wasmVersion = data.version;
            wasmThreadCount = data.threads;
            wasmThreadsAvailable = true;
            workerReady = true;
            console.log(`[WASM] Worker ready (v${data.version}, ${data.threads} threads)`);
            resolve();
            break;
            
          case 'generated': {
            const pending = pendingRequests.get(data.id);
            if (pending) {
              pendingRequests.delete(data.id);
              console.log(`[WASM] Generated puzzle in ${data.elapsed.toFixed(0)}ms`);
              pending.resolve(data.puzzle as PuzzleData);
            }
            break;
          }
          
          case 'error': {
            if (data.id === -1) {
              // Initialization error
              wasmThreadsAvailable = false;
              workerReady = false;
              reject(new Error(data.error));
            } else {
              const pending = pendingRequests.get(data.id);
              if (pending) {
                pendingRequests.delete(data.id);
                pending.reject(new Error(data.error));
              }
            }
            break;
          }
        }
      };
      
      generationWorker.onerror = (error) => {
        console.error('[WASM] Worker error:', error);
        wasmThreadsAvailable = false;
        workerReady = false;
        reject(new Error(`Worker error: ${error.message}`));
      };
      
      // Worker auto-initializes, just wait for ready message
    } catch (error) {
      console.error('[WASM] Failed to create worker:', error);
      wasmThreadsAvailable = false;
      reject(error);
    }
  });
  
  return workerReadyPromise;
}

/**
 * Generate puzzle using WASM in dedicated worker (non-blocking to main thread)
 * 
 * Progress tracking:
 * - Real progress IS tracked in Rust via atomics (getProgress())
 * - BUT: wasm.generate() blocks the worker thread, preventing real-time polling
 * - SO: We simulate progress based on typical generation time (~300-600ms)
 * - The simulation uses an ease-out curve for natural-feeling feedback
 * 
 * Future improvement: Use SharedArrayBuffer to share progress counter between
 * Rust and main thread, allowing real-time polling without blocking.
 */
async function generateFromWasm(
  seed: string,
  mapType?: MapType,
  onProgress?: (progress: GenerationProgress) => void
): Promise<PuzzleData> {
  // Ensure worker is ready
  await initGenerationWorker();
  
  if (!generationWorker || !workerReady) {
    throw new Error('WASM worker not available');
  }
  
  if (!wasmThreadsAvailable) {
    throw new Error('WASM threads not available. SharedArrayBuffer requires COOP/COEP headers.');
  }
  
  const id = ++requestId;
  const type = mapType || 'ice';
  
  console.log(`[WASM] Requesting puzzle generation for seed: ${seed}`);
  
  // Send initial progress
  if (onProgress) {
    onProgress({
      phase: 'wasm',
      workersComplete: 0,
      totalWorkers: 100,
      bestScore: 0,
    });
  }
  
  // Simulate progress based on expected generation time
  // WASM generation typically takes ~45 seconds
  const EXPECTED_DURATION_MS = 45000;
  const startTime = performance.now();
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  
  if (onProgress) {
    progressInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      // Ease-out curve: progress = 1 - e^(-elapsed/tau)
      // At elapsed = EXPECTED_DURATION_MS, we want ~90% progress
      // tau = -EXPECTED_DURATION_MS / ln(0.1) ≈ EXPECTED_DURATION_MS / 2.3
      const tau = EXPECTED_DURATION_MS / 2.3;
      const progress = Math.min(95, (1 - Math.exp(-elapsed / tau)) * 100);
      
      onProgress({
        phase: 'wasm',
        workersComplete: Math.round(progress),
        totalWorkers: 100,
        bestScore: 0,
      });
    }, 100);
  }
  
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (progressInterval) clearInterval(progressInterval);
    };
    
    pendingRequests.set(id, { 
      resolve: (puzzle) => {
        cleanup();
        // Send 100% progress on completion
        if (onProgress) {
          onProgress({
            phase: 'wasm',
            workersComplete: 100,
            totalWorkers: 100,
            bestScore: puzzle.difficultyScore || 0,
          });
        }
        resolve(puzzle);
      }, 
      reject: (error) => {
        cleanup();
        reject(error);
      }, 
      onProgress 
    });
    
    generationWorker!.postMessage({
      type: 'generate',
      id,
      seed,
      mapType: type,
    });
  });
}

// For backwards compatibility
async function initWasmThreadPool(): Promise<void> {
  return initGenerationWorker();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rust Backend Generator
// ─────────────────────────────────────────────────────────────────────────────

let rustBackendTested = false;
let rustBackendWorking = false;

async function testRustBackend(): Promise<boolean> {
  if (!RUST_BACKEND_URL) return false;
  if (rustBackendTested) return rustBackendWorking;
  
  try {
    const response = await fetch(`${RUST_BACKEND_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    rustBackendWorking = response.ok;
  } catch {
    rustBackendWorking = false;
  }
  
  rustBackendTested = true;
  return rustBackendWorking;
}

async function generateFromRustBackend(
  seed: string,
  mapType?: MapType,
  onProgress?: (progress: GenerationProgress) => void
): Promise<PuzzleData> {
  if (!RUST_BACKEND_URL) {
    throw new Error('Rust backend URL not configured');
  }

  const type = mapType || 'ice';
  const url = `${RUST_BACKEND_URL}/api/generate/${encodeURIComponent(seed)}?map_type=${type}&parallel=true`;
  
  console.log(`[Rust] Fetching puzzle from ${url}`);
  
  // Simulate progress based on expected generation time
  // Rust backend typically takes 1-5 seconds, expect ~3 seconds
  const EXPECTED_DURATION_MS = 3000;
  const startTime = performance.now();
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  
  if (onProgress) {
    onProgress({
      phase: 'rust-backend',
      workersComplete: 0,
      totalWorkers: 100,
      bestScore: 0,
    });
    
    progressInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const tau = EXPECTED_DURATION_MS / 2.3;
      const progress = Math.min(95, (1 - Math.exp(-elapsed / tau)) * 100);
      
      onProgress({
        phase: 'rust-backend',
        workersComplete: Math.round(progress),
        totalWorkers: 100,
        bestScore: 0,
      });
    }, 50); // Faster updates for shorter duration
  }
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const elapsed = performance.now() - startTime;
    
    console.log(`[Rust] Received puzzle in ${elapsed.toFixed(0)}ms (server: ${data.generationTimeMs}ms, optimal: ${data.puzzle.optimalMoves}, score: ${data.puzzle.difficultyScore})`);
    
    // Send 100% progress
    if (onProgress) {
      onProgress({
        phase: 'rust-backend',
        workersComplete: 100,
        totalWorkers: 100,
        bestScore: data.puzzle.difficultyScore || 0,
      });
    }
    
    return data.puzzle as PuzzleData;
  } finally {
    if (progressInterval) clearInterval(progressInterval);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function isRustBackendConfigured(): boolean {
  return !!RUST_BACKEND_URL;
}

export function getRustBackendUrl(): string | null {
  return RUST_BACKEND_URL;
}

export async function getGeneratorStatus(): Promise<GeneratorStatus> {
  // Try to initialize worker if not already done
  try {
    await initGenerationWorker();
  } catch {
    // Ignore - status will reflect failure
  }
  
  return {
    rustAvailable: await testRustBackend(),
    rustUrl: RUST_BACKEND_URL,
    wasmLoaded: workerReady,
    wasmVersion: wasmVersion,
    wasmThreadsInitialized: workerReady,
    wasmThreadsAvailable,
    sharedArrayBufferAvailable: isSharedArrayBufferAvailable(),
  };
}

/**
 * Pre-initialize WASM for faster first generation.
 * Call this early (e.g., on page load) to avoid delay on first puzzle.
 */
export async function preloadWasm(): Promise<void> {
  try {
    await initWasmThreadPool();
  } catch {
    // Ignore errors - will be handled during generation
  }
}

/**
 * Generate a puzzle using the specified engine.
 * 
 * Both Rust and WASM produce **identical puzzles** for the same seed.
 * 
 * @param seed - Seed string for deterministic generation
 * @param onProgress - Progress callback
 * @param forceMapType - Force a specific map type
 * @param forceBackend - Force a specific engine ('auto' uses priority: rust > wasm)
 */
export async function generatePuzzleParallel(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void,
  forceMapType?: MapType,
  forceBackend: GeneratorBackend = 'auto'
): Promise<PuzzleData> {
  
  // ─────────────────────────────────────────────────────────────────────────
  // Force Rust backend
  // ─────────────────────────────────────────────────────────────────────────
  if (forceBackend === 'rust') {
    if (!RUST_BACKEND_URL) {
      throw new Error('Rust backend not configured');
    }
    
    return await generateFromRustBackend(seed, forceMapType, onProgress);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Force WASM
  // ─────────────────────────────────────────────────────────────────────────
  if (forceBackend === 'wasm') {
    // Check if WASM threads are available first
    await initWasmThreadPool();
    if (!wasmThreadsAvailable) {
      throw new Error(
        'WASM engine unavailable: SharedArrayBuffer requires cross-origin isolation.\n\n' +
        'To fix in development:\n' +
        '1. Access via http://localhost:3000 (NOT an IP address like 10.x.x.x or 127.0.0.1)\n' +
        '2. Browsers only allow SharedArrayBuffer on localhost or HTTPS origins\n' +
        '3. Ensure server.js is running (npm run dev)\n\n' +
        'For LAN access, you need HTTPS (use mkcert to generate local certs).\n' +
        'Or use the Rust backend instead.'
      );
    }
    
    // Progress is now tracked via worker messages
    const puzzle = await generateFromWasm(seed, forceMapType, onProgress);
    
    return puzzle;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Auto mode: Try Rust first, fall back to WASM if available
  // ─────────────────────────────────────────────────────────────────────────
  
  // Pre-check WASM availability for better error messages
  await initWasmThreadPool();
  
  if (RUST_BACKEND_URL) {
    console.log(`[Engine] Rust backend configured at ${RUST_BACKEND_URL}`);

    try {
      return await generateFromRustBackend(seed, forceMapType, onProgress);
    } catch (error) {
      console.warn('[Engine] Rust backend failed:', error);
      
      // Check if WASM fallback is available
      if (!wasmThreadsAvailable) {
        throw new Error(
          'Rust backend failed and WASM fallback unavailable.\n\n' +
          'Options:\n' +
          '1. Start the Rust backend (make up-backend)\n' +
          '2. Enable WASM: access via http://localhost:3000 (NOT an IP address)\n' +
          '   Browsers only allow SharedArrayBuffer on localhost or HTTPS'
        );
      }
      
      console.log('[Engine] Falling back to WASM...');
    }
  }

  // Check if WASM is available
  if (!wasmThreadsAvailable) {
    throw new Error(
      'No puzzle engine available.\n\n' +
      'Options:\n' +
      '1. Configure Rust backend (NEXT_PUBLIC_GENERATOR_URL)\n' +
      '2. Enable WASM: access via http://localhost:3000 (NOT an IP address)\n' +
      '   Browsers only allow SharedArrayBuffer on localhost or HTTPS'
    );
  }

  // Fall back to WASM
  console.log('[Engine] Using WASM engine...');
  
  // Progress is now tracked via worker messages
  const puzzle = await generateFromWasm(seed, forceMapType, onProgress);
  
  return puzzle;
}

// Legacy export for compatibility
export function getWorkerPool() {
  return {
    terminate: () => {
      // No-op: WASM threads are managed by the runtime
    }
  };
}
