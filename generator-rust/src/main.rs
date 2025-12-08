use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};

// Import from library
use mazle_generator::{
    generate_ground_puzzle, generate_ice_puzzle, GenerationConfig, PuzzleData,
};

/// Application state
struct AppState {
    start_time: Instant,
}

/// Health check response
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    uptime_secs: u64,
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
    generation_time_ms: u128,
}

/// Query parameters for GET endpoint
#[derive(Deserialize)]
struct GenerateQuery {
    #[serde(default = "default_attempts")]
    attempts: usize,
    #[serde(default)]
    parallel: bool,
    #[serde(default = "default_map_type")]
    map_type: String,
}

fn default_attempts() -> usize {
    1000
}

/// Health check endpoint
async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        uptime_secs: state.start_time.elapsed().as_secs(),
    })
}

/// Generate puzzle by seed (GET)
async fn generate_by_seed(
    Path(seed): Path<String>,
    Query(query): Query<GenerateQuery>,
) -> Json<GenerateResponse> {
    let start = Instant::now();

    let config = GenerationConfig {
        traditional_attempts: query.attempts,
        parallel: query.parallel,
        ..Default::default()
    };

    let map_type = query.map_type.clone();
    
    // Spawn CPU-intensive work on blocking thread pool to avoid starving async runtime
    let puzzle = tokio::task::spawn_blocking(move || {
        generate_by_type(&seed, &config, &map_type)
    })
    .await
    .expect("Blocking task panicked");

    Json(GenerateResponse {
        puzzle,
        generation_time_ms: start.elapsed().as_millis(),
    })
}

/// Generate puzzle (POST with full config)
async fn generate_post(Json(request): Json<GenerateRequest>) -> Json<GenerateResponse> {
    let start = Instant::now();

    let seed = request.seed.clone();
    let config = request.config.clone();
    let map_type = request.map_type.clone();

    // Spawn CPU-intensive work on blocking thread pool
    let puzzle = tokio::task::spawn_blocking(move || {
        generate_by_type(&seed, &config, &map_type)
    })
    .await
    .expect("Blocking task panicked");

    Json(GenerateResponse {
        puzzle,
        generation_time_ms: start.elapsed().as_millis(),
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
fn build_router() -> Router {
    let state = Arc::new(AppState {
        start_time: Instant::now(),
    });

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
        .layer(cors)
        .with_state(state)
}

#[tokio::main]
async fn main() {
    println!("🧊 Mazle Generator Server starting...");

    let app = build_router();

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{}", port);

    println!("🚀 Server running at http://{}", addr);
    println!("");
    println!("Endpoints:");
    println!("  GET  /health                  - Health check");
    println!("  GET  /api/generate/:seed      - Generate puzzle by seed");
    println!("  POST /api/generate            - Generate with config");
    println!("  POST /api/generate/batch      - Generate multiple puzzles");
    println!("");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
