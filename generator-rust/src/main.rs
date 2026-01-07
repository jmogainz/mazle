use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use axum::http::StatusCode;
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::cors::{Any, CorsLayer};

// Import from library
use mazle_generator::{
    cache::PuzzleCache, generate_ground_puzzle, generate_ice_puzzle_with_cancel, scheduler,
    GenerationConfig, PuzzleData,
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
            info!("⚠️ Wait failed for '{}', attempting to claim generation...", seed);
        }
        
        info!("✗ Cache MISS for '{}', generating on-demand...", seed);
    }

    // 2. Mark as generating (prevent duplicate work)
    let mut we_are_generating = state.cache.start_generating(&seed);
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

        // Generation may have finished after wait; check cache before giving up.
        if let Some(cached) = state.cache.get(&seed) {
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

        // Try to claim generation if no longer in progress.
        we_are_generating = state.cache.start_generating(&seed);
        if !we_are_generating {
            if state.cache.is_generating(&seed) {
                info!("⏳ Generation still in progress for '{}' after wait timeout", seed);
                return (
                    StatusCode::REQUEST_TIMEOUT,
                    Json(json!({
                        "error": "generation_in_progress"
                    })),
                )
                    .into_response();
            }

            info!("⚠️ Wait failed and no generation in progress for '{}'", seed);
            return (
                StatusCode::REQUEST_TIMEOUT,
                Json(json!({
                    "error": "generation_in_progress"
                })),
            )
                .into_response();
        }
    }

    // If we won the generation race but a cache entry appeared meanwhile, return it and clear state.
    if let Some(cached) = state.cache.get(&seed) {
        state.cache.finish_generating(&seed);
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
    }

    // Generation didn't complete within wait window. It might still be running.
    if let Some(cached) = state.cache.get(&seed) {
        let total_time = request_start.elapsed().as_millis() as u64;
        info!(
            "✓ Returning '{}' after timeout (generated in {}ms, total request: {}ms)",
            seed, cached.generation_time_ms, total_time
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
    }

    if state.cache.is_generating(&seed) {
        info!("⏳ Generation still in progress for '{}' after wait timeout", seed);
        return (
            StatusCode::REQUEST_TIMEOUT, // best available match for client-cancelled semantics
            Json(json!({
                "error": "generation_in_progress"
            })),
        )
            .into_response();
    }

    // Cancelled or failed; ensure state cleanup
    state.cache.finish_generating(&seed);
    return (
        StatusCode::REQUEST_TIMEOUT, // best available match for client-cancelled semantics
        Json(json!({
            "error": "generation_cancelled"
        })),
    )
        .into_response();

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
