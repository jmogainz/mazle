/* tslint:disable */
/* eslint-disable */

/**
 * Generate a puzzle by map type.
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
 * Generate a ground puzzle with default configuration.
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
 * Generate an ice puzzle with default configuration.
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

/**
 * Initialize WASM module (sets up panic hook for better error messages)
 */
export function wasm_init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly generate: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly generateGround: (a: number, b: number) => [number, number, number];
  readonly generateGroundWithConfig: (a: number, b: number, c: any) => [number, number, number];
  readonly generateIce: (a: number, b: number) => [number, number, number];
  readonly generateIceWithConfig: (a: number, b: number, c: any) => [number, number, number];
  readonly getVersion: () => [number, number];
  readonly wasm_init: () => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
