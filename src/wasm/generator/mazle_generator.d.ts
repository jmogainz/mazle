/* tslint:disable */
/* eslint-disable */

/**
 * Generate a puzzle by map type with default configuration (same as Rust server).
 * Thread pool must be initialized first via initThreadPool().
 *
 * # Arguments
 * * `seed` - The seed string for deterministic generation
 * * `map_type` - "ice" or "ground"
 *
 * # Returns
 * A JavaScript object containing the puzzle data
 */
export function generate(seed: string, map_type: string): any;

/**
 * Generate a ground puzzle with default configuration (same as Rust server).
 * Thread pool must be initialized first via initThreadPool().
 *
 * # Arguments
 * * `seed` - The seed string for deterministic generation
 *
 * # Returns
 * A JavaScript object containing the puzzle data
 */
export function generateGround(seed: string): any;

/**
 * Generate a ground puzzle with custom configuration.
 *
 * # Arguments
 * * `seed` - The seed string for deterministic generation
 * * `config_js` - JavaScript object with generation configuration
 *
 * # Returns
 * A JavaScript object containing the puzzle data
 */
export function generateGroundWithConfig(seed: string, config_js: any): any;

/**
 * Generate an ice puzzle with default configuration (same as Rust server).
 * Thread pool must be initialized first via initThreadPool().
 *
 * # Arguments
 * * `seed` - The seed string for deterministic generation
 *
 * # Returns
 * A JavaScript object containing the puzzle data
 */
export function generateIce(seed: string): any;

/**
 * Generate an ice puzzle with custom configuration.
 *
 * # Arguments
 * * `seed` - The seed string for deterministic generation
 * * `config_js` - JavaScript object with generation configuration
 *
 * # Returns
 * A JavaScript object containing the puzzle data
 */
export function generateIceWithConfig(seed: string, config_js: any): any;

/**
 * Get the library version.
 */
export function getVersion(): string;

export function initThreadPool(num_threads: number): Promise<any>;

/**
 * Initialize WASM module (sets up panic hook for better error messages)
 */
export function wasm_init(): void;

export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  numThreads(): number;
  build(): void;
  receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly generate: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly generateGround: (a: number, b: number) => [number, number, number];
  readonly generateGroundWithConfig: (a: number, b: number, c: any) => [number, number, number];
  readonly generateIce: (a: number, b: number) => [number, number, number];
  readonly generateIceWithConfig: (a: number, b: number, c: any) => [number, number, number];
  readonly getVersion: () => [number, number];
  readonly wasm_init: () => void;
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
