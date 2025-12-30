use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use axum::http::StatusCode;
use log::{error, info};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::cors::{Any, CorsLayer};

// Import from library
use mazle_generator::{
    cache::PuzzleCache, generate_ground_puzzle, generate_ice_puzzle_with_cancel, scheduler,
    GenerationConfig, MapType, Position, PuzzleData, TileType,
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
fn generate_by_type(
    seed: &str,
    config: &GenerationConfig,
    map_type: &str,
    cancel_flag: Option<Arc<std::sync::atomic::AtomicBool>>,
) -> Result<PuzzleData, ()> {
    if cancel_flag
        .as_ref()
        .map(|f| f.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(false)
    {
        return Err(());
    }

    match map_type {
        "ground" => Ok(generate_ground_puzzle(seed, config)),
        _ => generate_ice_puzzle_with_cancel(seed, config, cancel_flag), // Default to ice
    }
}

// =============================================================================
// DATASET GENERATION (IMPLICIT PRETRAIN DATA)
// =============================================================================

const DEFAULT_DATASET_COUNT: usize = 100_000;
const DEFAULT_DATASET_SEED_PREFIX: &str = "train";
const DEFAULT_DATASET_MAP_TYPE: &str = "ice";
const DEFAULT_DATASET_SIZE: usize = 15;
const DEFAULT_DATASET_CLOSENESS_THRESHOLD: f64 = 0.90;
const DATASET_PROGRESS_EVERY: usize = 1_000;
const DATASET_SEED_MIN_WIDTH: usize = 6;

#[derive(Clone, Debug)]
struct DatasetConfig {
    out_path: String,
    count: usize,
    seed_prefix: String,
    map_type: String,
    size: usize,
    closeness_threshold: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetRecord {
    seed: String,
    width: usize,
    height: usize,
    map_type: MapType,
    tiles_interior: Vec<Vec<u8>>,
    start: Position,
    goal: Position,
}

fn dataset_config_from_env() -> Result<Option<DatasetConfig>, String> {
    let out_path = match std::env::var("DATASET_OUT") {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };

    let count = match std::env::var("DATASET_COUNT") {
        Ok(value) => value
            .parse::<usize>()
            .map_err(|_| format!("Invalid DATASET_COUNT: {}", value))?,
        Err(_) => DEFAULT_DATASET_COUNT,
    };

    let seed_prefix = std::env::var("DATASET_SEED_PREFIX")
        .unwrap_or_else(|_| DEFAULT_DATASET_SEED_PREFIX.to_string());

    let map_type =
        std::env::var("DATASET_MAP_TYPE").unwrap_or_else(|_| DEFAULT_DATASET_MAP_TYPE.to_string());

    let size = match std::env::var("DATASET_SIZE") {
        Ok(value) => value
            .parse::<usize>()
            .map_err(|_| format!("Invalid DATASET_SIZE: {}", value))?,
        Err(_) => DEFAULT_DATASET_SIZE,
    };

    Ok(Some(DatasetConfig {
        out_path,
        count,
        seed_prefix,
        map_type,
        size,
        closeness_threshold: DEFAULT_DATASET_CLOSENESS_THRESHOLD,
    }))
}

fn dataset_record_from_puzzle(seed: &str, puzzle: &PuzzleData) -> DatasetRecord {
    let width = puzzle.width;
    let height = puzzle.height;

    let mut tiles_interior = Vec::with_capacity(height.saturating_sub(2));
    for y in 1..height.saturating_sub(1) {
        let mut row = Vec::with_capacity(width.saturating_sub(2));
        for x in 1..width.saturating_sub(1) {
            let mut tile = puzzle.tiles[y][x];
            if tile == TileType::Start as u8 || tile == TileType::Goal as u8 {
                tile = TileType::Ice as u8;
            }
            row.push(tile);
        }
        tiles_interior.push(row);
    }

    DatasetRecord {
        seed: seed.to_string(),
        width,
        height,
        map_type: puzzle.map_type,
        tiles_interior,
        // Store interior coordinates (13x13) to match tilesInterior indexing.
        start: Position {
            x: puzzle.start.x - 1,
            y: puzzle.start.y - 1,
        },
        goal: Position {
            x: puzzle.goal.x - 1,
            y: puzzle.goal.y - 1,
        },
    }
}

fn run_dataset_generation(config: DatasetConfig) -> Result<(), Box<dyn std::error::Error>> {
    if config.count == 0 {
        return Err("DATASET_COUNT must be > 0".into());
    }

    if config.size != DEFAULT_DATASET_SIZE {
        return Err(format!(
            "DATASET_SIZE={} not supported (only {} supported)",
            config.size, DEFAULT_DATASET_SIZE
        )
        .into());
    }

    if config.map_type != "ice" && config.map_type != "ground" {
        return Err(format!(
            "DATASET_MAP_TYPE='{}' not supported (use 'ice' or 'ground')",
            config.map_type
        )
        .into());
    }

    let mut gen_config = GenerationConfig::default();
    gen_config.closeness_threshold = config.closeness_threshold;

    info!("📦 Dataset generation mode enabled");
    info!(
        "📦 out={} count={} seed_prefix={} map_type={} closeness_threshold={:.2}",
        config.out_path,
        config.count,
        config.seed_prefix,
        config.map_type,
        config.closeness_threshold
    );

    let file = File::create(&config.out_path)?;
    let mut writer = BufWriter::new(file);

    let seed_width = std::cmp::max(DATASET_SEED_MIN_WIDTH, config.count.to_string().len());
    let start_time = Instant::now();

    for idx in 1..=config.count {
        let seed = format!(
            "{}-{:0width$}",
            config.seed_prefix,
            idx,
            width = seed_width
        );

        let puzzle =
            generate_by_type(&seed, &gen_config, &config.map_type, None).map_err(|_| {
                format!("generation cancelled for seed '{}'", seed)
            })?;
        let record = dataset_record_from_puzzle(&seed, &puzzle);

        serde_json::to_writer(&mut writer, &record)?;
        writer.write_all(b"\n")?;

        if idx % DATASET_PROGRESS_EVERY == 0 || idx == config.count {
            let elapsed = start_time.elapsed();
            let avg_ms = (elapsed.as_secs_f64() * 1000.0) / idx as f64;
            let remaining_s = avg_ms * (config.count - idx) as f64 / 1000.0;

            info!(
                "📦 progress {}/{} avg={:.1}ms eta={:.1}m",
                idx,
                config.count,
                avg_ms,
                remaining_s / 60.0
            );
        }
    }

    writer.flush()?;
    info!(
        "✅ Dataset generation complete ({} samples) -> {}",
        config.count, config.out_path
    );

    Ok(())
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
    #[serde(default)]
    closeness_threshold: Option<f64>,
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
) -> impl IntoResponse {
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

        return (
            StatusCode::OK,
            Json(GenerateResponse {
                puzzle: cached.puzzle,
                generation_time_ms: cached.generation_time_ms,
                cached: true,
            }),
        )
            .into_response();
    } else {
        // Check if another request is already generating this seed
        if state.cache.is_generating(&seed) {
            info!("⏳ Waiting for in-progress generation of '{}'...", seed);
            
            if let Some(cached) = state.cache.wait_for_generation(&seed).await {
                let request_time = request_start.elapsed().as_millis() as u64;
                info!(
                    "✓ Got '{}' from parallel request (generated in {}ms, waited {}ms)",
                    seed, cached.generation_time_ms, request_time
                );
                
                return (
                    StatusCode::OK,
                    Json(GenerateResponse {
                        puzzle: cached.puzzle,
                        generation_time_ms: cached.generation_time_ms,
                        cached: true, // Treat as cached since we didn't generate it
                    }),
                )
                    .into_response();
            }
            // If wait failed, fall through to generate ourselves
            info!("⚠️ Wait failed for '{}', generating ourselves...", seed);
        }
        
        info!("✗ Cache MISS for '{}', generating on-demand...", seed);
    }

    // 2. Mark as generating (prevent duplicate work)
    let we_are_generating = state.cache.start_generating(&seed);
    if !we_are_generating {
        // Another request started generating between our check and now - wait for it
        info!("⏳ Race condition: waiting for '{}' generation...", seed);
        if let Some(cached) = state.cache.wait_for_generation(&seed).await {
            return (
                StatusCode::OK,
                Json(GenerateResponse {
                    puzzle: cached.puzzle,
                    generation_time_ms: cached.generation_time_ms,
                    cached: true,
                }),
            )
                .into_response();
        }
    }
    
    // 3. Spawn generation as a detached task so it completes even if client disconnects
    let gen_start = Instant::now();
    let mut config = GenerationConfig {
        parallel: query.parallel,
        start_batch: query.start_batch,
        ..Default::default()
    };
    if let Some(threshold) = query.closeness_threshold {
        config.closeness_threshold = threshold;
    }

    let map_type = query.map_type.clone();
    let seed_for_task = seed.clone();
    let cache_for_task = state.cache.clone();
    let cancel_flag = state.cache.cancel_flag(&seed);
    
    // Spawn generation task and keep a handle for cancellation
    let generation_handle = tokio::spawn({
        let seed_clone = seed_for_task.clone();
        let map_type_clone = map_type.clone();
        let cancel_clone = cancel_flag.clone();
        async move {
            let result = tokio::task::spawn_blocking(move || {
                generate_by_type(&seed_clone, &config, &map_type_clone, Some(cancel_clone))
            })
            .await;

            let generation_time = gen_start.elapsed().as_millis() as u64;

            let puzzle = match result {
                Ok(Ok(p)) => Some(p),
                Ok(Err(())) => {
                    info!(
                        "[DEBUG] spawn_blocking for '{}' noticed cancellation after {}ms",
                        seed_for_task, generation_time
                    );
                    None
                }
                Err(join_err) => {
                    info!(
                        "[DEBUG] spawn_blocking for '{}' panicked/cancelled: {:?}",
                        seed_for_task, join_err
                    );
                    None
                }
            };

            if let Some(puzzle) = puzzle {
                info!(
                    "[DEBUG] spawn_blocking returned for '{}' after {}ms",
                    seed_for_task, generation_time
                );
                // Cache the result and notify waiters
                cache_for_task.insert(seed_for_task.clone(), puzzle.clone(), generation_time);
                info!("✓ Generated '{}' in {}ms", seed_for_task, generation_time);
            } else {
                info!(
                    "[DEBUG] generation for '{}' ended without puzzle (likely cancelled)",
                    seed_for_task
                );
            }

            cache_for_task.finish_generating(&seed_for_task);
        }
    });

    state.cache.set_handle(&seed, generation_handle);
    
    // Wait for generation to complete (via cache notification)
    if let Some(cached) = state.cache.wait_for_generation(&seed).await {
        let total_time = request_start.elapsed().as_millis() as u64;
        info!(
            "✓ Returning '{}' (generated in {}ms, total request: {}ms)",
            seed, cached.generation_time_ms, total_time
        );

        return (
            StatusCode::OK,
            Json(GenerateResponse {
                puzzle: cached.puzzle,
                generation_time_ms: cached.generation_time_ms,
                cached: cached.generated_at.elapsed() == Duration::from_millis(0),
            }),
        )
            .into_response();
    } else {
        // Cancelled or failed; ensure state cleanup
        state.cache.finish_generating(&seed);
        return (
            StatusCode::REQUEST_TIMEOUT, // best available match for client-cancelled semantics
            Json(json!({
                "error": "generation_cancelled"
            })),
        )
            .into_response();
    }

    // Unreachable
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
    let puzzle = tokio::task::spawn_blocking(move || generate_by_type(&seed, &config, &map_type, None))
        .await
        .expect("Blocking task panicked")
        .expect("generation should not cancel in POST");

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

/// Cancel an in-flight generation if no other waiters are present
async fn cancel_generation(
    Path(seed): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let (cancelled, receiver_count, was_in_progress, skipped_waiters) =
        state.cache.cancel(&seed).await;

    info!(
        "🚫 Cancel request for '{}' (in_progress={}, receiver_count={}, cancelled={}, skipped_waiters={})",
        seed, was_in_progress, receiver_count, cancelled, skipped_waiters
    );

    Json(json!({
        "seed": seed,
        "cancelled": cancelled,
        "receiverCount": receiver_count,
        "wasInProgress": was_in_progress,
        "reason": if cancelled {
            "aborted"
        } else if skipped_waiters {
            "waiters_present"
        } else {
            "not_found_or_already_done"
        }
    }))
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
            .map(|seed| generate_by_type(seed, &config, &map_type, None).expect("generation should not cancel in batch"))
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
        .route("/api/generate/:seed/cancel", post(cancel_generation))
        .route("/api/generate", post(generate_post))
        .route("/api/generate/batch", post(generate_batch))
        .route("/api/cache/status", get(cache_status))
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() {
    // Initialize env_logger - uses LOG_LEVEL env var (consistent with devops-toolkit pattern)
    // Falls back to RUST_LOG if set, otherwise defaults to "info"
    // Examples: LOG_LEVEL=debug, LOG_LEVEL=trace, LOG_LEVEL=warn
    let log_level = std::env::var("LOG_LEVEL")
        .or_else(|_| std::env::var("RUST_LOG"))
        .unwrap_or_else(|_| "info".to_string());
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(&log_level)).init();

    let dataset_config = match dataset_config_from_env() {
        Ok(config) => config,
        Err(err) => {
            error!("❌ Dataset config error: {}", err);
            std::process::exit(1);
        }
    };
    if let Some(config) = dataset_config {
        if let Err(err) = run_dataset_generation(config) {
            error!("❌ Dataset generation failed: {}", err);
            std::process::exit(1);
        }
        return;
    }

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
