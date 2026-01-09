/**
 * WASM Generator Bridge
 * 
 * Manages puzzle generation via two backends (both produce identical puzzles):
 * 
 * 1. 🦀 Rust HTTP Server - Runs on server with rayon parallelism (port 8080)
 * 2. 🔷 WASM - Runs in a dedicated web worker (single-threaded)
 * 
 * The WASM backend runs in a dedicated worker (generationWorker.ts) to
 * keep the main thread responsive during generation (~200-500ms).
 */

import type { PuzzleData } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GeneratorBackend = 'auto' | 'rust' | 'wasm';

export interface GenerationProgress {
  phase: 'kv' | 'rust-backend' | 'wasm';
  workersComplete: number;
  totalWorkers: number;
  bestScore: number;
}

export interface GeneratorStatus {
  rustAvailable: boolean;
  rustUrl: string | null;
  wasmLoaded: boolean;
  wasmVersion: string | null;
}

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof BackendConnectionError) {
    return !error.fatal;
  }
  if (error instanceof TypeError) {
    return true; // Most fetch network errors surface as TypeError
  }
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NetworkError')) {
    return true;
  }
  return false;
}

function computeBackoffMs(attempt: number): number {
  // Exponential backoff with cap
  const base = 200; // ms
  const max = 15000; // 15s
  return Math.min(max, base * Math.pow(2, attempt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// Get the Rust backend URL from environment (set at build time)
// Prefer DEV URL (Ngrok) if available, otherwise use standard URL
const RUST_BACKEND_URL = process.env.NEXT_PUBLIC_DEV_GENERATOR_URL || process.env.NEXT_PUBLIC_GENERATOR_URL || null;

// ─────────────────────────────────────────────────────────────────────────────
// WASM Generator with Dedicated Worker
// ─────────────────────────────────────────────────────────────────────────────

let generationWorker: Worker | null = null;
let workerReady = false;
let workerReadyPromise: Promise<void> | null = null;
let wasmVersion: string | null = null;
let requestId = 0;

interface PendingRequest {
  resolve: (puzzle: PuzzleData) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: GenerationProgress) => void;
}
const pendingRequests = new Map<number, PendingRequest>();

/**
 * Initialize the generation worker
 */
async function initGenerationWorker(): Promise<void> {
  if (workerReady) return;
  if (workerReadyPromise) return workerReadyPromise;
  
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
            workerReady = true;
            console.log(`[WASM] Worker ready (v${data.version})`);
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
        workerReady = false;
        reject(new Error(`Worker error: ${error.message}`));
      };
      
      // Worker auto-initializes, just wait for ready message
    } catch (error) {
      console.error('[WASM] Failed to create worker:', error);
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
 */
async function generateFromWasm(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void,
  closenessThreshold?: number
): Promise<PuzzleData> {
  // Ensure worker is ready
  await initGenerationWorker();

  if (!generationWorker || !workerReady) {
    throw new Error('WASM worker not available');
  }

  if (!workerReady) {
    throw new Error('WASM worker not initialized.');
  }

  const id = ++requestId;
  
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
      closenessThreshold,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rust Backend Generator
// ─────────────────────────────────────────────────────────────────────────────

let rustBackendTested = false;
let rustBackendWorking = false;
const rustInFlight = new Map<string, Set<AbortController>>();

function registerRustRequest(seed: string, controller: AbortController) {
  const existing = rustInFlight.get(seed) ?? new Set<AbortController>();
  existing.add(controller);
  rustInFlight.set(seed, existing);
}

function unregisterRustRequest(seed: string, controller: AbortController) {
  const existing = rustInFlight.get(seed);
  if (!existing) return;
  existing.delete(controller);
  if (existing.size === 0) {
    rustInFlight.delete(seed);
  } else {
    rustInFlight.set(seed, existing);
  }
}

export function cancelRustRequest(seed: string): boolean {
  const controllers = rustInFlight.get(seed);
  if (!controllers || controllers.size === 0) {
    console.log('[Rust] No in-flight request to cancel for seed', seed);
    return false;
  }

  // If multiple requests are waiting on the same seed, do not cancel to avoid
  // aborting other listeners.
  if (controllers.size > 1) {
    console.log('[Rust] Skipping cancel; another in-flight request for seed', seed);
    return false;
  }

  let cancelled = false;
  controllers.forEach((controller) => {
    if (!controller.signal.aborted) {
      controller.abort();
      cancelled = true;
    }
  });
  return cancelled;
}

async function testRustBackend(onProgress?: (progress: GenerationProgress) => void): Promise<boolean> {
  if (!RUST_BACKEND_URL) return false;
  if (rustBackendTested) return rustBackendWorking;
  
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${RUST_BACKEND_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      rustBackendWorking = response.ok;
      if (rustBackendWorking) break;
    } catch {
      rustBackendWorking = false;
    }

    if (!rustBackendWorking && attempt + 1 < maxAttempts) {
      if (onProgress) {
        onProgress({
          phase: 'rust-backend',
          workersComplete: Math.min(2, attempt + 1), // tiny bump to show activity
          totalWorkers: 100,
          bestScore: 0,
        });
      }
      const backoff = 300; // ms
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  
  rustBackendTested = true;
  return rustBackendWorking;
}

// Custom error class for backend connection issues
export class BackendConnectionError extends Error {
  constructor(
    message: string,
    public readonly fatal: boolean = false,
    public readonly isTimeout: boolean = false
  ) {
    super(message);
    this.name = 'BackendConnectionError';
  }
}

async function generateFromRustBackend(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void,
  startBatch?: number,
  abortController?: AbortController,
  closenessThreshold?: number
): Promise<PuzzleData> {
  if (!RUST_BACKEND_URL) {
    throw new Error('Rust backend URL not configured');
  }

  let url = `${RUST_BACKEND_URL}/api/generate/${encodeURIComponent(seed)}?parallel=true`;
  if (startBatch !== undefined && startBatch > 0) {
    url += `&start_batch=${startBatch}`;
  }
  if (closenessThreshold !== undefined) {
    url += `&closeness_threshold=${closenessThreshold}`;
  }
  
  console.log(`[Rust] Fetching puzzle from ${url}`);
  
  // Simulate progress based on expected generation time
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
  
  const controller = abortController ?? new AbortController();
  registerRustRequest(seed, controller);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new BackendConnectionError(
          `Server error (${response.status}). The puzzle generator is experiencing issues. Please try again.`,
          true
        );
      }
      // Other HTTP errors are treated as fatal (e.g., 4xx/edge cases)
      throw new BackendConnectionError(`HTTP ${response.status}: ${response.statusText}`, true);
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
    
    // Mark backend as working for future requests
    rustBackendWorking = true;
    
    return data.puzzle as PuzzleData;
  } catch (error) {
    if (progressInterval) clearInterval(progressInterval);
    
    // Handle specific error types with user-friendly messages
    if (error instanceof BackendConnectionError) {
      throw error;
    }
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      // Network error - backend temporarily unreachable (treat as transient)
      rustBackendWorking = false;
      throw new BackendConnectionError(
        'Unable to connect to puzzle server. The server may be temporarily unavailable.',
        false
      );
    }
    
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new BackendConnectionError('Generation cancelled by client.', false);
    }
    
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new BackendConnectionError(
        'Connection timed out. The puzzle server may be overloaded or unavailable.',
        true
      );
    }
    
    // Re-throw unknown errors
    throw error;
  } finally {
    if (progressInterval) clearInterval(progressInterval);
    unregisterRustRequest(seed, controller);
  }
}

// Shared retry wrapper used by both the general generator flow and daily flow
interface RustRetryOptions {
  seed: string;
  onProgress?: (progress: GenerationProgress) => void;
  startBatch?: number;
  abortController?: AbortController;
  logLabel: string; // e.g., '[Engine]' or '[Daily]'
  closenessThreshold?: number;
}

async function generateFromRustWithRetries({
  seed,
  onProgress,
  startBatch,
  abortController,
  logLabel,
  closenessThreshold,
}: RustRetryOptions): Promise<PuzzleData | null> {
  // Quick health preflight (cached after first success/fail)
  await testRustBackend(onProgress);

  const TRANSIENT_TIME_BUDGET_MS = 10 * 60 * 1000; // 10 minutes
  const TRANSIENT_MAX_ATTEMPTS = 8; // enough for multiple background resumes without spinning forever
  const startTime = performance.now();
  let attempt = 0;

  while (true) {
    try {
      return await generateFromRustBackend(seed, onProgress, startBatch, abortController, closenessThreshold);
    } catch (error) {
      console.warn(`${logLabel} Rust backend failed:`, error);

      // If the client explicitly cancelled, surface the error and don't fall back
      if (
        abortController?.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw error;
      }

      const transient = isTransientNetworkError(error);
      const elapsed = performance.now() - startTime;
      const attemptsExceeded = attempt >= TRANSIENT_MAX_ATTEMPTS;
      const timeExceeded = elapsed >= TRANSIENT_TIME_BUDGET_MS;

      if (transient && !attemptsExceeded && !timeExceeded) {
        const backoff = computeBackoffMs(attempt);
        attempt += 1;
        console.log(
          `${logLabel} Transient Rust failure, retry ${attempt}/${TRANSIENT_MAX_ATTEMPTS} after ${backoff}ms (elapsed ${(elapsed/1000).toFixed(1)}s)`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      // Non-transient or retries exhausted: signal caller to fall back
      return null;
    }
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
  };
}

/**
 * Pre-initialize WASM for faster first generation.
 * Call this early (e.g., on page load) to avoid delay on first puzzle.
 */
export async function preloadWasm(): Promise<void> {
  try {
    await initGenerationWorker();
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
 * @param forceBackend - Force a specific engine ('auto' uses priority: rust > wasm)
 * @param startBatch - Start generation at a specific batch number (for deterministic replay)
 * @param closenessThreshold - Threshold for puzzle closeness (0.97 - 1.0)
 */
export async function generatePuzzleParallel(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void,
  forceBackend: GeneratorBackend = 'auto',
  startBatch?: number,
  abortController?: AbortController,
  closenessThreshold?: number
): Promise<PuzzleData> {

  // ─────────────────────────────────────────────────────────────────────────
  // Force Rust backend
  // ─────────────────────────────────────────────────────────────────────────
  if (forceBackend === 'rust') {
    if (!RUST_BACKEND_URL) {
      throw new Error('Rust backend not configured');
    }

    // One quick health check; if it fails, surface error (no fallback in force mode)
    await testRustBackend(onProgress);
    return await generateFromRustBackend(seed, onProgress, startBatch, abortController, closenessThreshold);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Force WASM
  // ─────────────────────────────────────────────────────────────────────────
  if (forceBackend === 'wasm') {
    // Initialize WASM worker if not already done
    await initGenerationWorker();
    if (!workerReady) {
      throw new Error(
        'WASM worker failed to initialize. Check browser console for details.'
      );
    }

    // Progress is now tracked via worker messages
    // Note: WASM doesn't support startBatch yet
    const puzzle = await generateFromWasm(seed, onProgress, closenessThreshold);

    return puzzle;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto mode: Try Rust first, fall back to WASM if available
  // ─────────────────────────────────────────────────────────────────────────

  // Pre-check WASM availability for better error messages
  await initGenerationWorker();

  if (RUST_BACKEND_URL) {
    console.log(`[Engine] Rust backend configured at ${RUST_BACKEND_URL}`);
    const rustPuzzle = await generateFromRustWithRetries({
      seed,
      onProgress,
      startBatch,
      abortController,
      logLabel: '[Engine]',
      closenessThreshold,
    });

    if (rustPuzzle) {
      return rustPuzzle;
    }

    // Non-transient or retries exhausted: attempt WASM fallback if available
    if (!workerReady) {
      throw new Error(
        'Rust backend failed and WASM fallback unavailable.\n\n' +
        'Options:\n' +
        '1. Start the Rust backend (make up-backend)\n' +
        '2. Enable WASM: access via http://localhost:8080 or HTTPS'
      );
    }
    
    console.log('[Engine] Falling back to WASM...');
  }

  // Check if WASM is available
  if (!workerReady) {
    throw new Error(
      'No puzzle engine available.\n\n' +
      'Options:\n' +
      '1. Configure Rust backend (NEXT_PUBLIC_GENERATOR_URL)\n' +
      '2. Enable WASM: access via http://localhost:8080 or HTTPS'
    );
  }

  // Fall back to WASM
  console.log('[Engine] Using WASM engine...');

  // Progress is now tracked via worker messages
  // Note: WASM doesn't support startBatch yet
  const puzzle = await generateFromWasm(seed, onProgress, closenessThreshold);

  return puzzle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Puzzle Fetcher (with KV cache)
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyPuzzleResponse {
  puzzle: PuzzleData;
  source: 'kv' | 'rust' | 'wasm';  // 'kv' = from cache, 'rust' = client→backend, 'wasm' = client fallback
}

/**
 * Fetch the daily puzzle with fallback chain: KV Cache → Rust Backend → WASM
 * 
 * This is optimized for daily puzzles where we expect pre-generated puzzles
 * to be available in Vercel KV (generated at 11 PM ET via cron).
 * 
 * Fallback chain:
 * 1. /api/daily - Check KV cache only (fast, no serverless timeout risk)
 * 2. Rust backend - Direct client call (if configured)
 * 3. WASM (~45s) - Generate client-side as last resort
 * 
 * Both Rust and WASM fallbacks backfill the KV cache via POST /api/daily/cache.
 * 
 * @param seed - Daily seed (from getDailySeed())
 * @param onProgress - Progress callback for generation fallbacks
 */
export async function fetchDailyPuzzle(
  seed: string,
  onProgress?: (progress: GenerationProgress) => void
): Promise<DailyPuzzleResponse> {
  
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Check KV cache via /api/daily (cache-only, fast)
  // ─────────────────────────────────────────────────────────────────────────
  try {
    console.log('[Daily] Checking KV cache via /api/daily...');
    
    if (onProgress) {
      onProgress({
        phase: 'kv',
        workersComplete: 50,
        totalWorkers: 100,
        bestScore: 0,
      });
    }
    
    // Include date in query to bust CDN cache at midnight ET rollover
    const dateForCache = seed.split('-').slice(0, 3).join('-');
    const response = await fetch(`/api/daily?d=${dateForCache}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10s timeout (cache check should be fast)
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Validate seed matches to prevent stale CDN responses from poisoning cache
      if (data.puzzle && data.seed === seed) {
        console.log('[Daily] Loaded from KV cache (instant!)');
        
        if (onProgress) {
          onProgress({
            phase: 'kv',
            workersComplete: 100,
            totalWorkers: 100,
            bestScore: data.puzzle.difficultyScore || 0,
          });
        }
        
        return {
          puzzle: data.puzzle as PuzzleData,
          source: 'kv',
        };
      } else if (data.puzzle) {
        console.warn(`[Daily] Seed mismatch: expected ${seed}, got ${data.seed} - ignoring stale response`);
      }
    }
    
    // 404 = cache miss, continue to client-side generation
    console.log('[Daily] Cache miss, falling back to client-side generation...');
  } catch (error) {
    console.warn('[Daily] Cache check failed:', error);
    // Continue to client-side fallbacks
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 2. Try Rust backend directly from client (if configured)
  // ─────────────────────────────────────────────────────────────────────────
  if (RUST_BACKEND_URL) {
    const rustPuzzle = await generateFromRustWithRetries({
      seed,
      onProgress,
      logLabel: '[Daily]',
    });

    if (rustPuzzle) {
      console.log('[Daily] Generated via Rust backend');

      // Backfill KV cache so other users get instant load
      backfillKvCache(seed, rustPuzzle, 'rust').catch((error) => {
        console.warn('[Daily] Failed to backfill KV cache:', error);
      });

      return {
        puzzle: rustPuzzle,
        source: 'rust',
      };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 3. WASM fallback (slow but reliable)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[Daily] Falling back to WASM generation...');
  
  // Pre-initialize WASM
  await initGenerationWorker();
  
  if (!workerReady) {
    throw new Error(
      'Unable to load daily puzzle.\n\n' +
      'The puzzle server is temporarily unavailable and WASM fallback is not supported in this browser.\n\n' +
      'Please try:\n' +
      '1. Refreshing the page\n' +
      '2. Accessing via a different browser\n' +
      '3. Trying again in a few minutes'
    );
  }
  
  const puzzle = await generateFromWasm(seed, onProgress);
  
  // Backfill KV cache so other users don't have to wait for WASM
  // Fire-and-forget: don't block the user, don't fail if this errors
  backfillKvCache(seed, puzzle, 'wasm').catch((error) => {
    console.warn('[Daily] Failed to backfill KV cache:', error);
  });
  
  return {
    puzzle,
    source: 'wasm',
  };
}

/**
 * Backfill KV cache after successful client-side generation.
 * Uses NX so first submission wins (thread-safe).
 */
async function backfillKvCache(seed: string, puzzle: PuzzleData, source: 'rust' | 'wasm'): Promise<void> {
  try {
    console.log(`[Daily] Backfilling KV cache from ${source.toUpperCase()} generation...`);
    
    const response = await fetch('/api/daily/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed, puzzle }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.cached) {
        console.log('[Daily] Successfully backfilled KV cache');
      } else {
        console.log('[Daily] KV cache already populated');
      }
    } else {
      console.warn('[Daily] Backfill request failed:', response.status);
    }
  } catch (error) {
    // Don't throw - this is best-effort
    console.warn('[Daily] Backfill error:', error);
  }
}
