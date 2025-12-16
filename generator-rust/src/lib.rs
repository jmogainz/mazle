//! Mazle Puzzle Generator Library
//!
//! This library provides puzzle generation for the Mazle game.
//! It can be compiled to:
//! - Native binary (server with parallel generation via rayon)
//! - WebAssembly (browser with parallel generation via wasm-bindgen-rayon)
//!
//! Both targets produce **identical puzzles** for the same seed and config.

pub mod cache;
pub mod generators;
#[cfg(not(target_arch = "wasm32"))]
pub mod scheduler;
pub mod types;

// Re-export main types for convenience
pub use generators::ground::generate_puzzle as generate_ground_puzzle;
pub use generators::ice::generate_puzzle as generate_ice_puzzle;
pub use types::{GenerationConfig, MapType, Position, PuzzleData, TileType};

// ─────────────────────────────────────────────────────────────────────────────
// WASM Bindings (only compiled for wasm32 target)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use serde_wasm_bindgen;

// Re-export thread pool initializer from wasm-bindgen-rayon
// This MUST be called from JS before any generate* functions
#[cfg(target_arch = "wasm32")]
pub use wasm_bindgen_rayon::init_thread_pool;

/// Initialize WASM module (sets up panic hook and logger for better error messages)
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn wasm_init() {
    console_error_panic_hook::set_once();
    // Initialize console_log with default level (info)
    // Can be adjusted in browser devtools
    console_log::init_with_level(log::Level::Info).ok();
}

/// Generate an ice puzzle with default configuration (same as Rust server).
/// Thread pool must be initialized first via initThreadPool().
///
/// # Arguments
/// * `seed` - The seed string for deterministic generation
///
/// # Returns
/// A JavaScript object containing the puzzle data
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generateIce)]
pub fn wasm_generate_ice(seed: &str) -> Result<JsValue, JsValue> {
    let config = GenerationConfig::default();
    let puzzle = generate_ice_puzzle(seed, &config);
    serde_wasm_bindgen::to_value(&puzzle).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate an ice puzzle with custom configuration.
///
/// # Arguments
/// * `seed` - The seed string for deterministic generation
/// * `config_js` - JavaScript object with generation configuration
///
/// # Returns
/// A JavaScript object containing the puzzle data
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generateIceWithConfig)]
pub fn wasm_generate_ice_with_config(seed: &str, config_js: JsValue) -> Result<JsValue, JsValue> {
    let config: GenerationConfig = serde_wasm_bindgen::from_value(config_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid config: {}", e)))?;
    let puzzle = generate_ice_puzzle(seed, &config);
    serde_wasm_bindgen::to_value(&puzzle).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a ground puzzle with default configuration (same as Rust server).
/// Thread pool must be initialized first via initThreadPool().
///
/// # Arguments
/// * `seed` - The seed string for deterministic generation
///
/// # Returns
/// A JavaScript object containing the puzzle data
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generateGround)]
pub fn wasm_generate_ground(seed: &str) -> Result<JsValue, JsValue> {
    let config = GenerationConfig::default();
    let puzzle = generate_ground_puzzle(seed, &config);
    serde_wasm_bindgen::to_value(&puzzle).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a ground puzzle with custom configuration.
///
/// # Arguments
/// * `seed` - The seed string for deterministic generation
/// * `config_js` - JavaScript object with generation configuration
///
/// # Returns
/// A JavaScript object containing the puzzle data
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generateGroundWithConfig)]
pub fn wasm_generate_ground_with_config(
    seed: &str,
    config_js: JsValue,
) -> Result<JsValue, JsValue> {
    let config: GenerationConfig = serde_wasm_bindgen::from_value(config_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid config: {}", e)))?;
    let puzzle = generate_ground_puzzle(seed, &config);
    serde_wasm_bindgen::to_value(&puzzle).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a puzzle by map type with default configuration (same as Rust server).
/// Thread pool must be initialized first via initThreadPool().
///
/// # Arguments
/// * `seed` - The seed string for deterministic generation
/// * `map_type` - "ice" or "ground"
///
/// # Returns
/// A JavaScript object containing the puzzle data
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generate)]
pub fn wasm_generate(seed: &str, map_type: &str) -> Result<JsValue, JsValue> {
    let config = GenerationConfig::default();
    let puzzle = match map_type {
        "ground" => generate_ground_puzzle(seed, &config),
        _ => generate_ice_puzzle(seed, &config),
    };
    serde_wasm_bindgen::to_value(&puzzle).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Get the library version.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = getVersion)]
pub fn wasm_get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
