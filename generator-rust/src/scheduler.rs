//! Background task for daily puzzle pre-generation
//!
//! Runs at 10 PM ET daily (1 hour before Vercel cron at 11 PM ET) to ensure
//! puzzles are cached and ready when the Vercel cron requests them.

use crate::cache::PuzzleCache;
use crate::generators::ice;
use crate::types::GenerationConfig;
use chrono::{Duration as ChronoDuration, NaiveDate, NaiveTime, TimeZone};
use chrono_tz::America::New_York;
use log::info;
use std::sync::Arc;
use tokio::time;

/// Get current date in New York timezone
fn get_ny_date() -> NaiveDate {
    let ny_now = chrono::Utc::now().with_timezone(&New_York);
    ny_now.date_naive()
}

/// Get current time in New York timezone
fn get_ny_datetime() -> chrono::DateTime<chrono_tz::Tz> {
    chrono::Utc::now().with_timezone(&New_York)
}

/// Generate daily seed in format: "daily-YYYY-MM-DD"
/// Must match frontend: src/game/puzzleGenerator.ts:getDailySeed()
fn get_daily_seed(date: NaiveDate) -> String {
    format!("daily-{}", date.format("%Y-%m-%d"))
}

/// Calculate seconds until next 10 PM ET (1 hour before Vercel cron)
fn calculate_seconds_until_10pm_et() -> u64 {
    let now_et = get_ny_datetime();

    // Target: 10 PM ET today
    let mut target = now_et
        .date_naive()
        .and_hms_opt(22, 0, 0) // 22:00 = 10 PM
        .unwrap();

    // If we're past 10 PM already, target tomorrow
    if now_et.time() >= NaiveTime::from_hms_opt(22, 0, 0).unwrap() {
        target = (now_et.date_naive() + ChronoDuration::days(1))
            .and_hms_opt(22, 0, 0)
            .unwrap();
    }

    let target_et = New_York.from_local_datetime(&target).unwrap();

    let duration = target_et.signed_duration_since(now_et);
    duration.num_seconds().max(0) as u64
}

/// Generate today, tomorrow, and day-after-tomorrow puzzles
async fn generate_daily_puzzles(cache: &PuzzleCache, config: &GenerationConfig) {
    let ny_now = get_ny_date();

    info!(
        "Starting daily puzzle generation for 3 days starting {}",
        ny_now
    );

    // Generate 3 days: today, tomorrow, day after
    for offset in 0..=2 {
        let date = ny_now + ChronoDuration::days(offset);
        let seed = get_daily_seed(date);

        // Skip if already cached and not expired
        if cache.get(&seed).is_some() {
            info!("Puzzle {} already cached, skipping", seed);
            continue;
        }

        // If another request is already generating this seed, wait for it
        if cache.is_generating(&seed) {
            info!("⏳ Pre-gen waiting for in-progress generation of '{}'...", seed);
            if let Some(_) = cache.wait_for_generation(&seed).await {
                info!("✓ Pre-gen got '{}' from in-progress generation", seed);
                continue;
            }
            info!("⚠️ Pre-gen wait failed for '{}', will attempt to generate", seed);
        }

        // Mark as generating to prevent duplicate work
        let we_are_generating = cache.start_generating(&seed);
        if !we_are_generating {
            info!("⏳ Pre-gen race: waiting for '{}' generation...", seed);
            if let Some(_) = cache.wait_for_generation(&seed).await {
                info!("✓ Pre-gen got '{}' from parallel generation", seed);
                continue;
            }
            info!("⚠️ Pre-gen wait failed for '{}', proceeding to generate", seed);
        }

        info!(
            "Pre-generating puzzle for {} (offset: {} days)",
            seed, offset
        );
        let start = std::time::Instant::now();

        // Generate puzzle - spawn on blocking thread pool to avoid starving async runtime
        let seed_clone = seed.clone();
        let config_clone = config.clone();
        let puzzle_result = tokio::task::spawn_blocking(move || {
            ice::generate_puzzle(&seed_clone, &config_clone)
        })
        .await;

        let elapsed = start.elapsed().as_millis() as u64;

        match puzzle_result {
            Ok(puzzle) => {
                // Cache result
                cache.insert(seed.clone(), puzzle, elapsed);

                info!(
                    "✓ Pre-generated {} in {:.2}s",
                    seed,
                    elapsed as f64 / 1000.0
                );
            }
            Err(join_err) => {
                info!(
                    "⚠️ Pre-generation task panicked/cancelled for '{}': {:?}",
                    seed, join_err
                );
            }
        }

        // Ensure in-progress state is cleared and waiters are notified
        cache.finish_generating(&seed);
    }

    info!(
        "Daily puzzle generation complete. Cache now has {} entries",
        cache.len()
    );
}

/// Background task that pre-generates daily puzzles
/// Runs at 10 PM ET daily (1 hour before Vercel cron at 11 PM ET)
pub async fn pre_generation_loop(cache: Arc<PuzzleCache>) {
    info!("🚀 Starting puzzle pre-generation scheduler");

    let config = GenerationConfig::default();

    // Wait 5 seconds for server to stabilize
    time::sleep(time::Duration::from_secs(5)).await;

    // Initial generation on startup
    info!("Running initial puzzle generation on startup");
    generate_daily_puzzles(&cache, &config).await;

    // Main loop: generate at 10 PM ET daily (1 hour before Vercel cron)
    loop {
        let seconds_until_10pm = calculate_seconds_until_10pm_et();
        let hours = seconds_until_10pm / 3600;
        let minutes = (seconds_until_10pm % 3600) / 60;

        info!(
            "⏰ Next pre-generation in {}h {}m (at 10 PM ET, 1h before Vercel cron)",
            hours, minutes
        );

        // Sleep until 10 PM ET
        time::sleep(time::Duration::from_secs(seconds_until_10pm)).await;

        // Generate puzzles
        info!("⏰ Daily pre-generation trigger at 10 PM ET (1h before Vercel cron)");
        generate_daily_puzzles(&cache, &config).await;

        // Clean expired entries
        cache.remove_expired();
        info!("🧹 Cleaned expired cache entries");
    }
}
