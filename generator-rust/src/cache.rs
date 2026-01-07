//! Thread-safe in-memory puzzle cache with TTL and LRU eviction

use crate::types::PuzzleData;
use log::info;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use chrono::NaiveDate;
use chrono::Utc;

/// Cached puzzle with metadata
#[derive(Clone)]
pub struct CachedPuzzle {
    pub puzzle: PuzzleData,
    pub generated_at: Instant,
    pub generation_time_ms: u64,
}

/// Thread-safe puzzle cache with TTL and size limits
pub struct PuzzleCache {
    entries: RwLock<HashMap<String, CachedPuzzle>>,
    /// Seeds currently being generated (to prevent duplicate work)
    in_progress: RwLock<HashSet<String>>,
    /// Broadcast channels for waiting on in-progress generations
    waiters: RwLock<HashMap<String, broadcast::Sender<()>>>,
    /// Join handles for in-progress generations (for cancellation)
    handles: RwLock<HashMap<String, JoinHandle<()>>>,
    /// Cancellation flags per seed
    cancel_flags: RwLock<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
    max_entries: usize,
    ttl: Duration,
}

impl PuzzleCache {
    /// Identify daily seeds (never evict these before non-dailies)
    fn is_daily_seed(seed: &str) -> bool {
        Self::daily_seed_date(seed).is_some()
    }

    /// Parse the date portion of a daily seed: strict "YYYY-MM-DD"
    fn daily_seed_date(seed: &str) -> Option<NaiveDate> {
        if seed.len() != 10 {
            return None;
        }
        let date_str = seed.get(0..10)?;
        NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()
    }

    /// Whether the daily seed is strictly before today (UTC)
    fn is_past_daily(seed: &str, today: NaiveDate) -> bool {
        Self::daily_seed_date(seed)
            .map(|d| d < today)
            .unwrap_or(false)
    }

    fn oldest_key_matching<'a>(
        entries: &'a HashMap<String, CachedPuzzle>,
        predicate: impl Fn(&str) -> bool,
    ) -> Option<String> {
        entries
            .iter()
            .filter(|(k, _)| predicate(k))
            .min_by_key(|(_, v)| v.generated_at)
            .map(|(k, _)| k.clone())
    }

    /// Create new cache with capacity and TTL
    pub fn new(max_entries: usize, ttl: Duration) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            in_progress: RwLock::new(HashSet::new()),
            waiters: RwLock::new(HashMap::new()),
            handles: RwLock::new(HashMap::new()),
            cancel_flags: RwLock::new(HashMap::new()),
            max_entries,
            ttl,
        }
    }

    /// Get puzzle from cache if exists and not expired
    pub fn get(&self, seed: &str) -> Option<CachedPuzzle> {
        let entries = self.entries.read().ok()?;
        let cached = entries.get(seed)?;

        // Check if expired
        if cached.generated_at.elapsed() > self.ttl {
            drop(entries);
            self.remove(seed);
            return None;
        }

        // Clone to avoid holding read lock
        Some(cached.clone())
    }
    
    /// Check if a seed is currently being generated
    pub fn is_generating(&self, seed: &str) -> bool {
        self.in_progress.read().ok()
            .map(|s| s.contains(seed))
            .unwrap_or(false)
    }
    
    /// Mark a seed as being generated. Returns false if already generating.
    pub fn start_generating(&self, seed: &str) -> bool {
        let mut in_progress = match self.in_progress.write() {
            Ok(p) => p,
            Err(_) => return false,
        };

        if in_progress.contains(seed) {
            return false; // Already generating
        }

        // Create broadcast channel for waiters and register it before releasing the in_progress lock
        // to avoid a window where is_generating=true but no waiter exists.
        let (tx, _) = broadcast::channel(1);
        match self.waiters.write() {
            Ok(mut waiters) => {
                waiters.insert(seed.to_string(), tx);
                in_progress.insert(seed.to_string());
                true
            }
            Err(_) => false,
        }
    }

    /// Register a join handle for the seed's generation task (for cancellation)
    pub fn set_handle(&self, seed: &str, handle: JoinHandle<()>) {
        if let Ok(mut handles) = self.handles.write() {
            handles.insert(seed.to_string(), handle);
        }
    }

    /// Get or create a cancellation notifier for a seed
    pub fn cancel_flag(&self, seed: &str) -> Arc<std::sync::atomic::AtomicBool> {
        let mut map = self.cancel_flags.write().expect("cancel_flags poisoned");
        map.entry(seed.to_string())
            .or_insert_with(|| Arc::new(std::sync::atomic::AtomicBool::new(false)))
            .clone()
    }
    
    /// Fetch cancellation flag if present (non-creating)
    pub fn get_cancel_flag(&self, seed: &str) -> Option<Arc<std::sync::atomic::AtomicBool>> {
        self.cancel_flags
            .read()
            .ok()
            .and_then(|m| m.get(seed).cloned())
    }
    
    /// Mark generation as complete and notify waiters
    pub fn finish_generating(&self, seed: &str) {
        if let Ok(mut in_progress) = self.in_progress.write() {
            in_progress.remove(seed);
        }
        
        // Notify waiters
        if let Ok(mut waiters) = self.waiters.write() {
            if let Some(tx) = waiters.remove(seed) {
                let _ = tx.send(()); // Ignore error if no receivers
            }
        }
        if let Ok(mut handles) = self.handles.write() {
            handles.remove(seed);
        }
        if let Ok(mut cancels) = self.cancel_flags.write() {
            cancels.remove(seed);
        }
    }
    
    /// Wait for an in-progress generation to complete, then return cached result
    pub async fn wait_for_generation(&self, seed: &str) -> Option<CachedPuzzle> {
        // Get a receiver for the broadcast
        let mut rx = {
            let waiters = self.waiters.read().ok()?;
            let tx = waiters.get(seed)?;
            tx.subscribe()
        };
        
        // Wait for notification (with timeout)
        let timeout = tokio::time::timeout(Duration::from_secs(30 * 60), rx.recv()).await;
        
        match timeout {
            Ok(Ok(())) => self.get(seed),
            Ok(Err(_)) => self.get(seed), // Sender dropped; check cache anyway
            Err(_) => self.get(seed), // Timeout; check cache anyway
        }
    }

    /// Attempt to cancel an in-progress generation for a seed.
    /// Returns (cancelled, receiver_count_before_cancel, was_in_progress, skipped_due_to_waiters).
    /// Only cancels if no other waiters are present (i.e., <=1 receiver, typically the caller); otherwise leaves generation running.
    pub async fn cancel(&self, seed: &str) -> (bool, usize, bool, bool) {
        // Check waiters receiver count
        let receiver_count = {
            let waiters = self.waiters.read().ok();
            waiters
                .and_then(|w| w.get(seed).map(|tx| tx.receiver_count()))
                .unwrap_or(0)
        };

        let was_in_progress = self.is_generating(seed);
        // Do not cancel if other waiters exist
        if receiver_count > 1 {
            return (false, receiver_count, was_in_progress, true);
        }

        let mut cancelled = false;

        // Signal cancellation to any cooperative loops
        if let Some(flag) = self.cancel_flags.read().ok().and_then(|m| m.get(seed).cloned()) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }

        // Abort the generation handle if present
        if let Some(handle) = self.handles.write().ok().and_then(|mut h| h.remove(seed)) {
            handle.abort();
            cancelled = true;
        }

        // Cleanup state & notify any listeners so they can stop waiting
        if was_in_progress {
            self.finish_generating(seed);
        }

        (cancelled, receiver_count, was_in_progress, false)
    }

    /// Insert puzzle into cache with metadata
    /// Evicts oldest entry if at max capacity
    pub fn insert(&self, seed: String, puzzle: PuzzleData, generation_time_ms: u64) {
        let mut entries = match self.entries.write() {
            Ok(e) => e,
            Err(_) => return,
        };

        let today = Utc::now().date_naive();

        // Evict with priority: non-dailies first, then past dailies only.
        if entries.len() >= self.max_entries && !entries.contains_key(&seed) {
            let victim = Self::oldest_key_matching(&entries, |k| !Self::is_daily_seed(k))
                .or_else(|| Self::oldest_key_matching(&entries, |k| Self::is_past_daily(k, today)));

            if let Some(victim_key) = victim {
                entries.remove(&victim_key);
                info!("Evicted cache entry: {} (to insert {})", victim_key, seed);
            } else {
                // All entries are current/future daily; protect them by skipping insert
                info!(
                    "Skipped caching '{}' to preserve current/future daily entries (cache full of protected dailies)",
                    seed
                );
                return;
            }
        }

        entries.insert(
            seed,
            CachedPuzzle {
                puzzle,
                generated_at: Instant::now(),
                generation_time_ms,
            },
        );
    }

    /// Remove specific entry from cache
    pub fn remove(&self, seed: &str) {
        if let Ok(mut entries) = self.entries.write() {
            entries.remove(seed);
        }
    }

    /// Get number of cached entries
    pub fn len(&self) -> usize {
        self.entries.read().ok().map(|e| e.len()).unwrap_or(0)
    }

    /// Check if cache is empty
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get all cached seed keys
    pub fn keys(&self) -> Vec<String> {
        self.entries
            .read()
            .ok()
            .map(|e| e.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Remove all expired entries
    pub fn remove_expired(&self) {
        if let Ok(mut entries) = self.entries.write() {
            let ttl = self.ttl;
            entries.retain(|_, cached| cached.generated_at.elapsed() <= ttl);
        }
    }

}
