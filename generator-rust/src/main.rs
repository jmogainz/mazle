use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::{get, post},
    Router,
};
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::cors::{Any, CorsLayer};

// Import from library
use mazle_generator::{
    cache::PuzzleCache, generate_ground_puzzle, generate_ice_puzzle, scheduler, GenerationConfig,
    PuzzleData,
};

/// Application state
#[derive(Clone)]
struct AppState {
    start_time: Instant,
    cache: Arc<PuzzleCache>,
}

/// Health check response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    uptime_secs: u64,
    cache_entries: usize,
}

/// Generation request body
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateRequest {
    seed: String,
    #[serde(default)]
    config: GenerationConfig,
    #[serde(default = "default_map_type")]
    map_type: String,
}

fn default_map_type() -> String {
    "ice".to_string()
}

/// Helper to generate puzzle based on map type
fn generate_by_type(seed: &str, config: &GenerationConfig, map_type: &str) -> PuzzleData {
    match map_type {
        "ground" => generate_ground_puzzle(seed, config),
        _ => generate_ice_puzzle(seed, config), // Default to ice
    }
}

/// Generation response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateResponse {
    puzzle: PuzzleData,
    generation_time_ms: u64,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    cached: bool,
}

/// Query parameters for GET endpoint
#[derive(Deserialize)]
struct GenerateQuery {
    #[serde(default)]
    parallel: bool,
    #[serde(default = "default_map_type")]
    map_type: String,
    #[serde(default)]
    start_batch: usize,
    #[serde(default)]
    no_cache: bool,
}

/// Health check endpoint
async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        uptime_secs: state.start_time.elapsed().as_secs(),
        cache_entries: state.cache.len(),
    })
}

/// Cache status endpoint
async fn cache_status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let seeds = state.cache.keys();
    Json(json!({
        "cachedSeeds": seeds,
        "count": seeds.len(),
        "maxEntries": 100,
        "ttlHours": 48,
    }))
}

/// Generate puzzle by seed (GET)
async fn generate_by_seed(
    Path(seed): Path<String>,
    Query(query): Query<GenerateQuery>,
    State(state): State<AppState>,
) -> Json<GenerateResponse> {
    let request_start = Instant::now();

    // 1. Check cache first (unless bypassed)
    if query.no_cache {
        info!("⏭️ Cache bypass for '{}' (no_cache=true)", seed);
    } else if let Some(cached) = state.cache.get(&seed) {
        let request_time = request_start.elapsed().as_millis() as u64;
        info!(
            "✓ Cache HIT for '{}' (generated in {}ms, served in {}ms)",
            seed, cached.generation_time_ms, request_time
        );

        return Json(GenerateResponse {
            puzzle: cached.puzzle,
            generation_time_ms: cached.generation_time_ms,
            cached: true,
        });
    } else {
        info!("✗ Cache MISS for '{}', generating on-demand...", seed);
    }

    // 2. Generate on-demand
    let gen_start = Instant::now();
    let config = GenerationConfig {
        parallel: query.parallel,
        start_batch: query.start_batch,
        ..Default::default()
    };

    let map_type = query.map_type.clone();
    let seed_clone = seed.clone();

    // Spawn CPU-intensive work on blocking thread pool to avoid starving async runtime
    let puzzle =
        tokio::task::spawn_blocking(move || generate_by_type(&seed_clone, &config, &map_type))
            .await
            .expect("Blocking task panicked");

    let generation_time = gen_start.elapsed().as_millis() as u64;

    // 3. Cache the result for future requests
    state
        .cache
        .insert(seed.clone(), puzzle.clone(), generation_time);

    let total_time = request_start.elapsed().as_millis() as u64;
    info!(
        "✓ Generated '{}' in {}ms (total request: {}ms)",
        seed, generation_time, total_time
    );

    Json(GenerateResponse {
        puzzle,
        generation_time_ms: generation_time,
        cached: false,
    })
}

/// Generate puzzle (POST with full config)
async fn generate_post(
    State(state): State<AppState>,
    Json(request): Json<GenerateRequest>,
) -> Json<GenerateResponse> {
    let start = Instant::now();

    let seed = request.seed.clone();
    let config = request.config.clone();
    let map_type = request.map_type.clone();

    // Spawn CPU-intensive work on blocking thread pool
    let puzzle = tokio::task::spawn_blocking(move || generate_by_type(&seed, &config, &map_type))
        .await
        .expect("Blocking task panicked");

    let generation_time = start.elapsed().as_millis() as u64;

    // Cache the result
    state
        .cache
        .insert(request.seed.clone(), puzzle.clone(), generation_time);

    Json(GenerateResponse {
        puzzle,
        generation_time_ms: generation_time,
        cached: false,
    })
}

/// Batch generate multiple puzzles
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchRequest {
    seeds: Vec<String>,
    #[serde(default)]
    config: GenerationConfig,
    #[serde(default = "default_map_type")]
    map_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchResponse {
    puzzles: Vec<PuzzleData>,
    total_time_ms: u128,
    avg_time_ms: u128,
}

async fn generate_batch(Json(request): Json<BatchRequest>) -> Json<BatchResponse> {
    let start = Instant::now();

    let map_type = request.map_type.clone();
    let config = request.config.clone();
    let seeds = request.seeds.clone();

    // Spawn CPU-intensive work on blocking thread pool
    let puzzles = tokio::task::spawn_blocking(move || {
        use rayon::prelude::*;
        seeds
            .par_iter()
            .map(|seed| generate_by_type(seed, &config, &map_type))
            .collect::<Vec<PuzzleData>>()
    })
    .await
    .expect("Blocking task panicked");

    let total_time = start.elapsed().as_millis();
    let count = puzzles.len() as u128;

    Json(BatchResponse {
        puzzles,
        total_time_ms: total_time,
        avg_time_ms: if count > 0 { total_time / count } else { 0 },
    })
}

/// Build the application router
fn build_router(cache: Arc<PuzzleCache>) -> Router {
    let state = AppState {
        start_time: Instant::now(),
        cache,
    };

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    Router::new()
        .route("/health", get(health))
        .route("/api/generate/:seed", get(generate_by_seed))
        .route("/api/generate", post(generate_post))
        .route("/api/generate/batch", post(generate_batch))
        .route("/api/cache/status", get(cache_status))
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() {
    // Initialize env_logger - defaults to info level, configurable via RUST_LOG env var
    // Examples: RUST_LOG=debug, RUST_LOG=mazle_generator=trace, RUST_LOG=warn
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    info!("🧊 Mazle Generator Server starting...");

    // Initialize puzzle cache: 100 max entries, 48 hour TTL
    let cache = Arc::new(PuzzleCache::new(100, Duration::from_secs(48 * 3600)));
    info!("💾 Initialized puzzle cache (max: 100 entries, TTL: 48h)");

    // Spawn background pre-generation task (only in production)
    let env_mode = std::env::var("ENV").unwrap_or_else(|_| "dev".to_string());
    if std::env::var("DISABLE_PRE_GENERATION").is_ok() {
        info!("⚠️ Pre-generation disabled via DISABLE_PRE_GENERATION env var");
    } else if env_mode != "prod" {
        info!(
            "⏸️ Pre-generation scheduler disabled (ENV={}, only runs in prod)",
            env_mode
        );
    } else {
        let cache_clone = cache.clone();
        tokio::spawn(async move {
            scheduler::pre_generation_loop(cache_clone).await;
        });
    }

    let app = build_router(cache);

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{}", port);

    info!("🚀 Server running at http://{}", addr);
    info!("Endpoints:");
    info!("  GET  /health                  - Health check with cache stats");
    info!("  GET  /api/generate/:seed      - Generate puzzle by seed (cached)");
    info!("  POST /api/generate            - Generate with config");
    info!("  POST /api/generate/batch      - Generate multiple puzzles");
    info!("  GET  /api/cache/status        - View cached seeds");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
