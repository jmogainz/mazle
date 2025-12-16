//! Thread-safe in-memory puzzle cache with TTL and LRU eviction

use crate::types::PuzzleData;
use log::info;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

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
    max_entries: usize,
    ttl: Duration,
}

impl PuzzleCache {
    /// Create new cache with capacity and TTL
    pub fn new(max_entries: usize, ttl: Duration) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
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

    /// Insert puzzle into cache with metadata
    /// Evicts oldest entry if at max capacity
    pub fn insert(&self, seed: String, puzzle: PuzzleData, generation_time_ms: u64) {
        let mut entries = match self.entries.write() {
            Ok(e) => e,
            Err(_) => return,
        };

        // Evict oldest if at capacity and this is a new key
        if entries.len() >= self.max_entries && !entries.contains_key(&seed) {
            Self::evict_oldest_from(&mut entries);
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

    /// Evict oldest entry (LRU eviction)
    fn evict_oldest_from(entries: &mut HashMap<String, CachedPuzzle>) {
        if let Some(oldest_key) = entries
            .iter()
            .min_by_key(|(_, cached)| cached.generated_at)
            .map(|(k, _)| k.clone())
        {
            entries.remove(&oldest_key);
            info!("Evicted oldest cache entry: {}", oldest_key);
        }
    }
}
