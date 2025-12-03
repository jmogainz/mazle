/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const generate: (a: number, b: number, c: number, d: number) => [number, number, number];
export const generateGround: (a: number, b: number) => [number, number, number];
export const generateGroundWithConfig: (a: number, b: number, c: any) => [number, number, number];
export const generateIce: (a: number, b: number) => [number, number, number];
export const generateIceWithConfig: (a: number, b: number, c: any) => [number, number, number];
export const getVersion: () => [number, number];
export const wasm_init: () => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
