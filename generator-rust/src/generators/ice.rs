// Fast, deterministic hashing for tight puzzle loops
use rustc_hash::{FxHashMap as HashMap, FxHashSet as HashSet};

// Rayon for parallel processing (works on both native and WASM with wasm-bindgen-rayon)
use crate::types::{Direction, GenerationConfig, MapType, Position, PuzzleData, TileType};
use log::{info, debug};
use rayon::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

// =============================================================================
// GENERATION CONTEXT - Per-run state for isolated tracking
// =============================================================================

const TRAP_COUNT: usize = 14;

/// Tracks the closest puzzle to passing all thresholds
/// Stores a single metric's value and threshold for closest puzzle tracking
#[derive(Clone)]
struct MetricInfo {
    name: String,
    value: f64,
    threshold: f64,
    threshold_max: Option<f64>,  // For range thresholds like locality
    is_max_threshold: bool,      // true if threshold is a maximum (value should be <=)
}

struct ClosestPuzzleInfo {
    closeness: f64,
    metrics: Vec<MetricInfo>,
    traps: Vec<String>,
}

/// Per-generation context for isolated tracking (not shared between runs)
struct GenerationContext {
    /// Short identifier for this run (first 8 chars of seed or truncated)
    run_id: String,
    /// Diagnostic counters
    fail_ci: AtomicU64,
    fail_dec: AtomicU64,
    fail_gate: AtomicU64,
    fail_fp: AtomicU64,
    fail_loc: AtomicU64,
    fail_dir: AtomicU64,
    fail_bt: AtomicU64,
    fail_amb: AtomicU64,
    fail_paths: AtomicU64,
    fail_olap_best: AtomicU64,
    fail_olap_avg: AtomicU64,
    fail_ediv: AtomicU64,
    fail_unique_opt: AtomicU64,
    total_checked: AtomicU64,
    /// Timing counters (microseconds)
    time_base_maze_us: AtomicU64,
    time_traps_us: AtomicU64,
    time_psych_score_us: AtomicU64,
    time_find_path_us: AtomicU64,
    time_count_paths_us: AtomicU64,
    time_overlap_us: AtomicU64,
    trap_time_us: [AtomicU64; TRAP_COUNT],
    trap_calls: [AtomicU64; TRAP_COUNT],
    /// Closest puzzle to passing all thresholds
    closest: Mutex<Option<ClosestPuzzleInfo>>,
}

impl GenerationContext {
    fn new(seed: &str) -> Self {
        // Use full seed for log prefixing unless it's very long.
        let run_id = {
            const MAX_LEN: usize = 80;
            let seed_len = seed.chars().count();
            if seed_len > MAX_LEN {
                let mut shortened: String = seed.chars().take(MAX_LEN - 3).collect();
                shortened.push_str("...");
                shortened
            } else {
                seed.to_string()
            }
        };

        Self {
            run_id,
            fail_ci: AtomicU64::new(0),
            fail_dec: AtomicU64::new(0),
            fail_gate: AtomicU64::new(0),
            fail_fp: AtomicU64::new(0),
            fail_loc: AtomicU64::new(0),
            fail_dir: AtomicU64::new(0),
            fail_bt: AtomicU64::new(0),
            fail_amb: AtomicU64::new(0),
            fail_paths: AtomicU64::new(0),
            fail_olap_best: AtomicU64::new(0),
            fail_olap_avg: AtomicU64::new(0),
            fail_ediv: AtomicU64::new(0),
            fail_unique_opt: AtomicU64::new(0),
            total_checked: AtomicU64::new(0),
            time_base_maze_us: AtomicU64::new(0),
            time_traps_us: AtomicU64::new(0),
            time_psych_score_us: AtomicU64::new(0),
            time_find_path_us: AtomicU64::new(0),
            time_count_paths_us: AtomicU64::new(0),
            time_overlap_us: AtomicU64::new(0),
            trap_time_us: std::array::from_fn(|_| AtomicU64::new(0)),
            trap_calls: std::array::from_fn(|_| AtomicU64::new(0)),
            closest: Mutex::new(None),
        }
    }

    /// Update closest puzzle if this one is better
    fn update_closest(&self, info: ClosestPuzzleInfo) {
        if let Ok(mut closest) = self.closest.lock() {
            let should_update = match &*closest {
                None => true,
                Some(current) => info.closeness > current.closeness,
            };
            if should_update {
                *closest = Some(info);
            }
        }
    }

    /// Get fail rates as formatted string (only enabled filters)
    fn format_fail_rates(&self, thresholds: &PrefilterThresholds) -> String {
        let total = self.total_checked.load(Ordering::Relaxed);
        if total == 0 {
            return String::from("n=0");
        }
        let pct = |counter: &AtomicU64| -> f64 {
            counter.load(Ordering::Relaxed) as f64 / total as f64 * 100.0
        };
        
        let mut parts = Vec::new();
        
        // Always show unique optimal (required for all puzzles)
        parts.push(format!("uopt={:.0}%", pct(&self.fail_unique_opt)));
        
        // Only show enabled filters
        if thresholds.ci_enabled { parts.push(format!("ci={:.0}%", pct(&self.fail_ci))); }
        if thresholds.dec_enabled { parts.push(format!("dec={:.0}%", pct(&self.fail_dec))); }
        if thresholds.gate_enabled { parts.push(format!("gate={:.0}%", pct(&self.fail_gate))); }
        if thresholds.fp_enabled { parts.push(format!("fp={:.0}%", pct(&self.fail_fp))); }
        if thresholds.loc_enabled { parts.push(format!("loc={:.0}%", pct(&self.fail_loc))); }
        if thresholds.dir_enabled { parts.push(format!("dir={:.0}%", pct(&self.fail_dir))); }
        if thresholds.bt_enabled { parts.push(format!("bt={:.0}%", pct(&self.fail_bt))); }
        if thresholds.amb_enabled { parts.push(format!("amb={:.0}%", pct(&self.fail_amb))); }
        if thresholds.paths_enabled { parts.push(format!("paths={:.0}%", pct(&self.fail_paths))); }
        if thresholds.olap_best_enabled { parts.push(format!("olap_best={:.0}%", pct(&self.fail_olap_best))); }
        if thresholds.olap_avg_enabled { parts.push(format!("olap_avg={:.0}%", pct(&self.fail_olap_avg))); }
        if thresholds.ediv_enabled { parts.push(format!("ediv={:.0}%", pct(&self.fail_ediv))); }
        
        parts.push(format!("(n={})", total));
        parts.join(" ")
    }

    /// Get closest puzzle info as formatted string (only enabled filters)
    fn format_closest(&self, _thresholds: &PrefilterThresholds) -> Option<String> {
        if let Ok(closest) = self.closest.lock() {
            if let Some(info) = &*closest {
                let mut parts = Vec::new();
                
                parts.push(format!("score={:.4}", info.closeness));
                
                for m in &info.metrics {
                    if let Some(max_thresh) = m.threshold_max {
                        // Range threshold (like locality)
                        parts.push(format!("{}={:.2}/({:.2}-{:.2})", m.name, m.value, m.threshold, max_thresh));
                    } else if m.is_max_threshold {
                        // Max threshold (value should be <=)
                        parts.push(format!("{}={:.2}/{:.2}", m.name, m.value, m.threshold));
                    } else if m.value.fract() == 0.0 && m.threshold.fract() == 0.0 {
                        // Integer values
                        parts.push(format!("{}={}/{}", m.name, m.value as i32, m.threshold as i32));
                    } else {
                        // Float values
                        parts.push(format!("{}={:.2}/{:.2}", m.name, m.value, m.threshold));
                    }
                }
                
                let traps_str = if info.traps.is_empty() {
                    String::from("-")
                } else {
                    info.traps.join(",")
                };
                parts.push(format!("traps=[{}]", traps_str));
                
                return Some(parts.join(" "));
            }
        }
        None
    }

    /// Format timing stats as string (milliseconds per attempt)
    fn format_timing(&self) -> String {
        let total = self.total_checked.load(Ordering::Relaxed);
        if total == 0 {
            return String::from("no timing data");
        }
        let avg_us = |counter: &AtomicU64| -> f64 {
            counter.load(Ordering::Relaxed) as f64 / total as f64
        };
        
        format!(
            "base={:.2}ms traps={:.2}ms psych={:.2}ms (path={:.2}ms cnt={:.2}ms olap={:.2}ms)",
            avg_us(&self.time_base_maze_us) / 1000.0,
            avg_us(&self.time_traps_us) / 1000.0,
            avg_us(&self.time_psych_score_us) / 1000.0,
            avg_us(&self.time_find_path_us) / 1000.0,
            avg_us(&self.time_count_paths_us) / 1000.0,
            avg_us(&self.time_overlap_us) / 1000.0,
        )
    }

    fn record_trap_time(&self, trap: TrapFunction, elapsed_us: u64) {
        let idx = trap.index();
        self.trap_time_us[idx].fetch_add(elapsed_us, Ordering::Relaxed);
        self.trap_calls[idx].fetch_add(1, Ordering::Relaxed);
    }

    fn format_trap_timing(&self) -> String {
        let total = self.total_checked.load(Ordering::Relaxed);
        if total == 0 {
            return String::from("no trap timing data");
        }

        let mut parts: Vec<String> = Vec::new();
        for trap in ALL_TRAPS {
            let idx = trap.index();
            let time_us = self.trap_time_us[idx].load(Ordering::Relaxed);
            let calls = self.trap_calls[idx].load(Ordering::Relaxed);
            if calls == 0 || time_us == 0 {
                continue;
            }

            let per_attempt_ms = time_us as f64 / total as f64 / 1000.0;
            let per_call_ms = time_us as f64 / calls as f64 / 1000.0;
            parts.push(format!(
                "{}={:.2}ms ({:.2}ms/call)",
                trap.short_name(),
                per_attempt_ms,
                per_call_ms
            ));
        }

        if parts.is_empty() {
            return String::from("traps=none");
        }

        parts.join(" ")
    }
}

// =============================================================================
// PARALLEL ITERATION HELPERS
// =============================================================================
// Rayon works on both native and WASM (via wasm-bindgen-rayon thread pool).
// Both produce identical results for the same seed.

/// Process a range in parallel and find the best result.
/// Uses attempt index as a deterministic tiebreaker when scores are equal,
/// ensuring identical results regardless of CPU count or thread scheduling.
fn find_best_in_range<F, T>(_label: &str, range: std::ops::Range<usize>, f: F) -> Option<(T, f64)>
where
    F: Fn(usize) -> Option<(T, f64)> + Sync + Send,
    T: Send,
{
    // Include attempt index in tuple for deterministic tie-breaking
    let result = range
        .into_par_iter()
        .filter_map(|i| f(i).map(|(puzzle, score)| (puzzle, score, i)))
        .max_by(|a, b| {
            match a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal) {
                std::cmp::Ordering::Equal => a.2.cmp(&b.2), // Tiebreaker: lower attempt index wins
                other => other,
            }
        })
        .map(|(puzzle, score, _)| (puzzle, score)); // Strip the index

    result
}

// =============================================================================
// CONSTANTS (match src/game/maps/ice/generator.ts)
// =============================================================================

const BATCH_SIZE: usize = 10000;  // Attempts per batch

const SIZE_OPTIONS: [(usize, usize); 1] = [(15, 15)];

// =============================================================================
// PSYCHOLOGY SCORING WEIGHTS - Tuned for binary lives game mechanic
// =============================================================================

// TIER 1: Core difficulty (what actually makes puzzles hard)
const WEIGHT_NEAR_OPTIMAL_PATHS: f64 = 40.0;  // RAISED - more paths = more confusion
const WEIGHT_PATH_OVERLAP: f64 = 150.0;       // ADJUSTED - uses avg overlap now
const WEIGHT_EARLY_DIVERGENCE: f64 = 180.0;   // RAISED - early confusion is critical

// TIER 2: Per-move confusion (secondary difficulty)
const WEIGHT_DIRECTION_CHANGES: f64 = 80.0;   // RAISED - zigzags harder to visualize
const WEIGHT_DECISION_AMBIGUITY: f64 = 140.0; // RAISED - more choices per move

// TIER 3: Low priority (irrelevant with binary lives or overlaps with TIER 1)
const WEIGHT_COUNTER_INTUITIVE: f64 = 150.0;  // RAISED - critical for complexity (winding/backtracking)
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 80.0;   // RAISED - need more visual confusion
const WEIGHT_COMMITMENT_GATES: f64 = 0.0;     // DISABLED - backtrack cost irrelevant
const WEIGHT_FALSE_PROGRESS: f64 = 80.0;      // RAISED - need more false leads
const WEIGHT_PATH_LOCALITY: f64 = 0.0;        // DISABLED - irrelevant
const WEIGHT_BACKTRACK_DEPTH: f64 = 0.0;      // DISABLED - backtrack cost irrelevant

// Diversity bonus for non-standard placements
const DIVERSITY_BONUS: f64 = 150.0;
// Extra bonus for Adjacent strategy (visually close, long path - very tricky!)
const ADJACENT_BONUS: f64 = 300.0;

// =============================================================================
// PREFILTER BASE THRESHOLDS (reference 35x35, scaled for smaller maps)
// =============================================================================

// Original thresholds (RELAXED - let variety through, difficulty comes from Phase 2)
// Base thresholds tuned for 15x15 map (REFERENCE_SIZE)
const BASE_PREFILTER_MIN_COUNTER_INTUITIVE: i32 = 4;      // Moves away from goal (RAISED to 4)
const BASE_PREFILTER_MIN_PATH_LOCALITY: f64 = 0.45;       // Lower = more concentrated = harder
const BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS: i32 = 4;
const BASE_PREFILTER_MIN_COMMITMENT_GATES: i32 = 1;
const BASE_PREFILTER_MIN_FALSE_PROGRESS: i32 = 3;         // "I was so close!" paths (ENABLED)

// Phase 1 thresholds (for 15x15)
const BASE_PREFILTER_MAX_PATH_LOCALITY: f64 = 0.85;       // RELAXED to 0.85 to allow winding snake paths
const BASE_PREFILTER_MIN_DIRECTION_CHANGES: i32 = 8;      // Reasonable floor (LOWERED from 9)
const BASE_PREFILTER_MIN_BACKTRACK_DEPTH: i32 = 2;
const BASE_PREFILTER_MIN_DECISION_AMBIGUITY: f64 = 3.0;   // RELAXED from 3.2 to increase success rate

// Phase 2 thresholds (key difficulty metrics for 15x15)
const BASE_PREFILTER_MIN_NEAR_OPTIMAL_PATHS: i32 = 60;    // Alternative paths within optimal+2 (ADJUSTED per user request)
const BASE_PREFILTER_MAX_PATH_OVERLAP: f64 = 0.30;        // Best alternative must differ by 70%+
const BASE_PREFILTER_MAX_PATH_OVERLAP_AVG: f64 = 0.60;    // Average alternative overlap cap
const BASE_PREFILTER_MIN_EARLY_DIVERGENCE: f64 = 0.55;    // Want early confusion (RAISED from 0.48)

// Absolute minimum floors after scaling (safety nets)
const PREFILTER_FLOOR_COUNTER_INTUITIVE: i32 = 2;
const PREFILTER_FLOOR_ATTRACTIVE_DECOYS: i32 = 3;
const PREFILTER_FLOOR_COMMITMENT_GATES: i32 = 1;
const PREFILTER_FLOOR_FALSE_PROGRESS: i32 = 3;
const PREFILTER_FLOOR_DIRECTION_CHANGES: i32 = 4;
const PREFILTER_FLOOR_BACKTRACK_DEPTH: i32 = 2;
const PREFILTER_FLOOR_NEAR_OPTIMAL_PATHS: i32 = 4;

// Prefilter enable flags (base 15x15 configuration)
const PREFILTER_ENABLE_CI: bool = true;
const PREFILTER_ENABLE_DEC: bool = false;
const PREFILTER_ENABLE_GATE: bool = false;
const PREFILTER_ENABLE_FP: bool = false;
const PREFILTER_ENABLE_LOC: bool = true;
const PREFILTER_ENABLE_DIR: bool = true;
const PREFILTER_ENABLE_BT: bool = false;
const PREFILTER_ENABLE_AMB: bool = true;
const PREFILTER_ENABLE_PATHS: bool = true;
const PREFILTER_ENABLE_OLAP_BEST: bool = true;
const PREFILTER_ENABLE_OLAP_AVG: bool = true;
const PREFILTER_ENABLE_EDIV: bool = true;

// Reference map size for scaling calculations
const REFERENCE_SIZE: f64 = 15.0;

// =============================================================================
// START/GOAL PLACEMENT STRATEGIES
// =============================================================================

/// Placement strategy for start/goal positions
#[derive(Clone, Copy, Debug, PartialEq)]
enum PlacementStrategy {
    /// Traditional: Start left, Goal right
    LeftToRight,
    /// Inverted: Start right, Goal left
    RightToLeft,
    /// Top to bottom
    TopToBottom,
    /// Bottom to top
    BottomToTop,
    /// Diagonal: top-left to bottom-right
    DiagonalTLBR,
    /// Diagonal: bottom-right to top-left
    DiagonalBRTL,
    /// Diagonal: top-right to bottom-left
    DiagonalTRBL,
    /// Diagonal: bottom-left to top-right
    DiagonalBLTR,
    /// Adjacent: Start and goal within close proximity but solution requires long detour
    Adjacent,
    /// Random: Fully random placement with minimum distance
    Random,
}

/// All available placement strategies for random selection
const PLACEMENT_STRATEGIES: [PlacementStrategy; 10] = [
    PlacementStrategy::LeftToRight,
    PlacementStrategy::RightToLeft,
    PlacementStrategy::TopToBottom,
    PlacementStrategy::BottomToTop,
    PlacementStrategy::DiagonalTLBR,
    PlacementStrategy::DiagonalBRTL,
    PlacementStrategy::DiagonalTRBL,
    PlacementStrategy::DiagonalBLTR,
    PlacementStrategy::Adjacent,
    PlacementStrategy::Random,
];

/// Helper to scale a range based on map size relative to reference (35x35)
/// Returns (scaled_min, scaled_max) ensuring min >= absolute_min and max > min
fn scale_range_for_map(
    min: i32,
    max: i32,
    width: usize,
    height: usize,
    absolute_min: i32,
) -> (i32, i32) {
    let scale = (width.min(height) as f64) / REFERENCE_SIZE;
    let scaled_min = ((min as f64 * scale).round() as i32).max(absolute_min);
    let scaled_max = ((max as f64 * scale).round() as i32).max(scaled_min + 1);
    (scaled_min, scaled_max)
}

/// Scale a single value based on map size, with a minimum floor
fn scale_value_for_map(val: i32, width: usize, height: usize, absolute_min: i32) -> i32 {
    let scale = (width.min(height) as f64) / REFERENCE_SIZE;
    ((val as f64 * scale).round() as i32).max(absolute_min)
}

// =============================================================================
// SEEDED RANDOM (Alea, matches seedrandom default)
// =============================================================================

#[derive(Clone)]
struct SeededRandom {
    s0: f64,
    s1: f64,
    s2: f64,
    c: f64,
}

impl SeededRandom {
    fn mash(data: &str, n: &mut f64) -> f64 {
        for ch in data.chars() {
            *n += ch as u32 as f64;
            let mut h = 0.025_196_032_824_169_38 * *n;
            let hi = h.floor();
            h -= hi;
            *n = hi;
            h *= *n;
            let hi = h.floor();
            h -= hi;
            *n += h * 4_294_967_296.0; // 0x100000000
        }
        *n %= 4_294_967_296.0;
        (*n as u32 as f64) * 2.328_306_436_538_696_3e-10
    }

    fn new(seed: &str) -> Self {
        let mut n = 0xefc8249du32 as f64;
        let mut s0 = Self::mash(" ", &mut n);
        let mut s1 = Self::mash(" ", &mut n);
        let mut s2 = Self::mash(" ", &mut n);

        s0 -= Self::mash(seed, &mut n);
        if s0 < 0.0 {
            s0 += 1.0;
        }

        s1 -= Self::mash(seed, &mut n);
        if s1 < 0.0 {
            s1 += 1.0;
        }

        s2 -= Self::mash(seed, &mut n);
        if s2 < 0.0 {
            s2 += 1.0;
        }

        Self { s0, s1, s2, c: 1.0 }
    }

    fn random(&mut self) -> f64 {
        let t = 2_091_639.0 * self.s0 + self.c * 2.328_306_436_538_696_3e-10;
        self.s0 = self.s1;
        self.s1 = self.s2;
        self.c = t.floor();
        self.s2 = t - self.c;
        self.s2
    }

    fn random_int(&mut self, min: i32, max: i32) -> i32 {
        (self.random() * (max - min) as f64).floor() as i32 + min
    }

    fn random_choice<T: Clone>(&mut self, arr: &[T]) -> T {
        let idx = self.random_int(0, arr.len() as i32) as usize;
        arr[idx].clone()
    }

    fn shuffle<T: Clone>(&mut self, arr: &[T]) -> Vec<T> {
        let mut result = arr.to_vec();
        if result.is_empty() {
            return result;
        }
        for i in (1..result.len()).rev() {
            let j = self.random_int(0, (i + 1) as i32) as usize;
            result.swap(i, j);
        }
        result
    }
}

// =============================================================================
// POSITION UTILITIES
// =============================================================================

fn is_valid(x: i32, y: i32, width: usize, height: usize) -> bool {
    x >= 0 && x < width as i32 && y >= 0 && y < height as i32
}

fn is_inner(x: i32, y: i32, width: usize, height: usize) -> bool {
    x > 0 && x < width as i32 - 1 && y > 0 && y < height as i32 - 1
}

fn get_delta(dir: Direction) -> (i32, i32) {
    match dir {
        Direction::Up => (0, -1),
        Direction::Down => (0, 1),
        Direction::Left => (-1, 0),
        Direction::Right => (1, 0),
    }
}

fn get_all_dirs() -> [Direction; 4] {
    [
        Direction::Up,
        Direction::Down,
        Direction::Left,
        Direction::Right,
    ]
}

fn new_pos_set(capacity: usize) -> HashSet<Position> {
    let mut set = HashSet::with_hasher(Default::default());
    set.reserve(capacity);
    set
}

fn new_pos_map<V>(capacity: usize) -> HashMap<Position, V> {
    let mut map = HashMap::with_hasher(Default::default());
    map.reserve(capacity);
    map
}

fn pos_index(pos: &Position, width: usize) -> usize {
    (pos.y as usize) * width + (pos.x as usize)
}

fn index_to_pos(idx: usize, width: usize) -> Position {
    Position {
        x: (idx % width) as i32,
        y: (idx / width) as i32,
    }
}




fn pos_eq(a: &Position, b: &Position) -> bool {
    a.x == b.x && a.y == b.y
}

#[derive(Clone)]
struct MoveResult {
    pos: Position,
    valid: bool,
}

// =============================================================================
// START/GOAL PLACEMENT SELECTION
// =============================================================================

/// Select start/goal positions based on placement strategy
fn select_start_goal(
    ice_tiles: &[Position],
    width: usize,
    height: usize,
    strategy: PlacementStrategy,
    rng: &mut SeededRandom,
) -> Option<(Position, Position)> {
    if ice_tiles.len() < 2 {
        return None;
    }

    let inner_max_x = (width - 2) as i32;
    let inner_max_y = (height - 2) as i32;

    // Zone thresholds (1/3 divisions)
    let left_threshold = (width as i32 / 3).max(2);
    let right_threshold = (2 * width as i32 / 3).min(inner_max_x);
    let top_threshold = (height as i32 / 3).max(2);
    let bottom_threshold = (2 * height as i32 / 3).min(inner_max_y);

    match strategy {
        PlacementStrategy::LeftToRight => {
            let left: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold).cloned().collect();
            let right: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold).cloned().collect();
            if left.is_empty() || right.is_empty() { return None; }
            Some((rng.random_choice(&left), rng.random_choice(&right)))
        }

        PlacementStrategy::RightToLeft => {
            let left: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold).cloned().collect();
            let right: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold).cloned().collect();
            if left.is_empty() || right.is_empty() { return None; }
            Some((rng.random_choice(&right), rng.random_choice(&left)))
        }

        PlacementStrategy::TopToBottom => {
            let top: Vec<_> = ice_tiles.iter().filter(|p| p.y < top_threshold).cloned().collect();
            let bottom: Vec<_> = ice_tiles.iter().filter(|p| p.y > bottom_threshold).cloned().collect();
            if top.is_empty() || bottom.is_empty() { return None; }
            Some((rng.random_choice(&top), rng.random_choice(&bottom)))
        }

        PlacementStrategy::BottomToTop => {
            let top: Vec<_> = ice_tiles.iter().filter(|p| p.y < top_threshold).cloned().collect();
            let bottom: Vec<_> = ice_tiles.iter().filter(|p| p.y > bottom_threshold).cloned().collect();
            if top.is_empty() || bottom.is_empty() { return None; }
            Some((rng.random_choice(&bottom), rng.random_choice(&top)))
        }

        PlacementStrategy::DiagonalTLBR => {
            let tl: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold && p.y < top_threshold).cloned().collect();
            let br: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold && p.y > bottom_threshold).cloned().collect();
            if tl.is_empty() || br.is_empty() { return None; }
            Some((rng.random_choice(&tl), rng.random_choice(&br)))
        }

        PlacementStrategy::DiagonalBRTL => {
            let tl: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold && p.y < top_threshold).cloned().collect();
            let br: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold && p.y > bottom_threshold).cloned().collect();
            if tl.is_empty() || br.is_empty() { return None; }
            Some((rng.random_choice(&br), rng.random_choice(&tl)))
        }

        PlacementStrategy::DiagonalTRBL => {
            let tr: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold && p.y < top_threshold).cloned().collect();
            let bl: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold && p.y > bottom_threshold).cloned().collect();
            if tr.is_empty() || bl.is_empty() { return None; }
            Some((rng.random_choice(&tr), rng.random_choice(&bl)))
        }

        PlacementStrategy::DiagonalBLTR => {
            let tr: Vec<_> = ice_tiles.iter().filter(|p| p.x > right_threshold && p.y < top_threshold).cloned().collect();
            let bl: Vec<_> = ice_tiles.iter().filter(|p| p.x < left_threshold && p.y > bottom_threshold).cloned().collect();
            if tr.is_empty() || bl.is_empty() { return None; }
            Some((rng.random_choice(&bl), rng.random_choice(&tr)))
        }

        PlacementStrategy::Adjacent => {
            select_adjacent_start_goal(ice_tiles, width, height, rng)
        }

        PlacementStrategy::Random => {
            select_random_start_goal(ice_tiles, width, height, rng)
        }
    }
}

/// Select adjacent start/goal positions (close visually, requiring long detour)
fn select_adjacent_start_goal(
    ice_tiles: &[Position],
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) -> Option<(Position, Position)> {
    // Start and goal 1-4 tiles apart (manhattan distance)
    let min_proximity = 1;
    let max_proximity = 4;

    for _ in 0..50 {
        let start = rng.random_choice(ice_tiles);

        let nearby: Vec<_> = ice_tiles.iter()
            .filter(|p| {
                let dist = (start.x - p.x).abs() + (start.y - p.y).abs();
                dist >= min_proximity && dist <= max_proximity
            })
            .cloned()
            .collect();

        if nearby.is_empty() {
            continue;
        }

        let goal = rng.random_choice(&nearby);

        if is_inner(start.x, start.y, width, height)
            && is_inner(goal.x, goal.y, width, height)
        {
            return Some((start, goal));
        }
    }

    None
}

/// Select random start/goal with minimum distance requirement
fn select_random_start_goal(
    ice_tiles: &[Position],
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) -> Option<(Position, Position)> {
    // Minimum manhattan distance scales with map size
    let min_distance = ((width.min(height) as f64) * 0.3) as i32;

    for _ in 0..50 {
        let start = rng.random_choice(ice_tiles);

        let far_enough: Vec<_> = ice_tiles.iter()
            .filter(|p| {
                let dist = (start.x - p.x).abs() + (start.y - p.y).abs();
                dist >= min_distance
            })
            .cloned()
            .collect();

        if far_enough.is_empty() {
            continue;
        }

        let goal = rng.random_choice(&far_enough);

        if is_inner(start.x, start.y, width, height)
            && is_inner(goal.x, goal.y, width, height)
        {
            return Some((start, goal));
        }
    }

    None
}

/// Select a random placement strategy with weighted distribution
fn select_placement_strategy(rng: &mut SeededRandom) -> PlacementStrategy {
    let roll = rng.random();
    // 30% traditional (LeftToRight + DiagonalTLBR) for backwards compatibility
    // 70% distributed across all strategies
    if roll < 0.15 {
        PlacementStrategy::LeftToRight
    } else if roll < 0.30 {
        PlacementStrategy::DiagonalTLBR
    } else {
        // Remaining 70% split among all 10 strategies
        rng.random_choice(&PLACEMENT_STRATEGIES)
    }
}

/// Try multiple placement strategies and pick the candidate most likely to hit target moves
/// while providing multiple early goal-directed branches.

/// Calculate diversity bonus for a placement strategy
fn get_strategy_bonus(strategy: PlacementStrategy) -> f64 {
    match strategy {
        PlacementStrategy::LeftToRight | PlacementStrategy::DiagonalTLBR => 0.0,
        PlacementStrategy::Adjacent => ADJACENT_BONUS,
        _ => DIVERSITY_BONUS,
    }
}

// =============================================================================
// MOVEMENT + PATHFINDING (ice sliding logic)
// =============================================================================

fn simulate_move(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    dir: Direction,
    width: usize,
    height: usize,
) -> MoveResult {
    let (dx, dy) = get_delta(dir);
    let mut x = start.x + dx;
    let mut y = start.y + dy;

    if !is_valid(x, y, width, height) {
        return MoveResult {
            pos: *start,
            valid: false,
        };
    }

    let target_tile = tiles[y as usize][x as usize];
    if target_tile == TileType::Wall {
        return MoveResult {
            pos: *start,
            valid: false,
        };
    }

    // Check ledge entry rules
    if (TileType::LedgeUp as u8..=TileType::LedgeRight as u8).contains(&(target_tile as u8)) {
        let ledge_dir = (target_tile as u8) - (TileType::LedgeUp as u8);
        let allowed_dirs = [
            Direction::Down,
            Direction::Up,
            Direction::Left,
            Direction::Right,
        ];
        if dir != allowed_dirs[ledge_dir as usize] {
            return MoveResult {
                pos: *start,
                valid: false,
            };
        }
    }

    if target_tile == TileType::Ice {
        let mut steps = 0;
        while steps < 100 {
            steps += 1;
            let next_x = x + dx;
            let next_y = y + dy;

            if !is_valid(next_x, next_y, width, height) {
                break;
            }

            let next_tile = tiles[next_y as usize][next_x as usize];
            if next_tile == TileType::Wall {
                break;
            }

            if (TileType::LedgeUp as u8..=TileType::LedgeRight as u8).contains(&(next_tile as u8)) {
                let ledge_dir = (next_tile as u8) - (TileType::LedgeUp as u8);
                let allowed_dirs = [
                    Direction::Down,
                    Direction::Up,
                    Direction::Left,
                    Direction::Right,
                ];
                if dir != allowed_dirs[ledge_dir as usize] {
                    break;
                }
                x = next_x;
                y = next_y;
                break;
            }

            x = next_x;
            y = next_y;

            if next_tile != TileType::Ice {
                break;
            }
        }
    }

    MoveResult {
        pos: Position { x, y },
        valid: true,
    }
}

fn find_path(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> Option<i32> {
    let mut queue: Vec<(Position, i32)> = Vec::with_capacity(width * height);
    let mut visited = vec![false; width * height];
    let start_idx = pos_index(start, width);
    visited[start_idx] = true;
    queue.push((*start, 0));
    let mut head = 0;

    while head < queue.len() {
        let (pos, moves) = queue[head];
        head += 1;

        if pos_eq(&pos, goal) {
            return Some(moves);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid {
                let idx = pos_index(&result.pos, width);
                if !visited[idx] {
                    visited[idx] = true;
                    queue.push((result.pos, moves + 1));
                }
            }
        }
    }

    None
}

fn get_reachable_mask(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    width: usize,
    height: usize,
) -> Vec<bool> {
    let mut reachable = vec![false; width * height];
    let mut queue: Vec<Position> = Vec::with_capacity(width * height);
    reachable[pos_index(start, width)] = true;
    queue.push(*start);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid {
                let idx = pos_index(&result.pos, width);
                if !reachable[idx] {
                    reachable[idx] = true;
                    queue.push(result.pos);
                }
            }
        }
    }

    reachable
}

fn is_solvable(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> bool {
    find_path(tiles, start, goal, width, height).is_some()
}

fn build_reverse_graph_indices(
    tiles: &Vec<Vec<TileType>>,
    width: usize,
    height: usize,
) -> Vec<Vec<usize>> {
    let mut reverse_graph: Vec<Vec<usize>> = vec![Vec::new(); width * height];

    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == TileType::Wall {
                continue;
            }
            let pos = Position {
                x: x as i32,
                y: y as i32,
            };
            let pos_idx = pos_index(&pos, width);
            for dir in get_all_dirs() {
                let result = simulate_move(tiles, &pos, dir, width, height);
                if result.valid && !pos_eq(&result.pos, &pos) {
                    let dest_idx = pos_index(&result.pos, width);
                    reverse_graph[dest_idx].push(pos_idx);
                }
            }
        }
    }

    reverse_graph
}

fn get_can_reach_goal_mask(
    tiles: &Vec<Vec<TileType>>,
    goal: &Position,
    width: usize,
    height: usize,
) -> Vec<bool> {
    let reverse_graph = build_reverse_graph_indices(tiles, width, height);

    let mut can_reach_goal = vec![false; width * height];
    let mut queue: Vec<usize> = Vec::with_capacity(width * height);
    let goal_idx = pos_index(goal, width);
    can_reach_goal[goal_idx] = true;
    queue.push(goal_idx);
    let mut head = 0;

    while head < queue.len() {
        let current_idx = queue[head];
        head += 1;

        for &source_idx in &reverse_graph[current_idx] {
            if !can_reach_goal[source_idx] {
                can_reach_goal[source_idx] = true;
                queue.push(source_idx);
            }
        }
    }

    can_reach_goal
}

fn build_reverse_graph(
    tiles: &Vec<Vec<TileType>>,
    width: usize,
    height: usize,
) -> HashMap<Position, Vec<Position>> {
    let mut reverse_graph: HashMap<Position, Vec<Position>> = new_pos_map(width * height);

    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == TileType::Wall {
                continue;
            }
            let pos = Position {
                x: x as i32,
                y: y as i32,
            };
            for dir in get_all_dirs() {
                let result = simulate_move(tiles, &pos, dir, width, height);
                if result.valid && !pos_eq(&result.pos, &pos) {
                    reverse_graph
                        .entry(result.pos)
                        .or_insert_with(Vec::new)
                        .push(pos);
                }
            }
        }
    }

    reverse_graph
}

fn has_no_stuck_states(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> bool {
    let reachable = get_reachable_mask(tiles, start, width, height);
    let can_reach_goal = get_can_reach_goal_mask(tiles, goal, width, height);

    for idx in 0..reachable.len() {
        if reachable[idx] && !can_reach_goal[idx] {
            return false;
        }
    }
    true
}

// =============================================================================
// PUBLIC VALIDATION (for Python bridge)
// =============================================================================

#[derive(Debug, Clone, Copy)]
pub struct ValidationResult {
    pub valid_tiles: bool,
    pub solvable: bool,
    pub optimal_moves: i32,
    pub unique_optimal: bool,
    pub no_stuck: bool,
    pub meets_target_moves: bool,
}

/// Validate an ice puzzle from interior tiles (no border), using interior start/goal coords.
pub fn validate_ice_puzzle_interior(
    tiles_interior: &Vec<Vec<u8>>,
    start: Position,
    goal: Position,
    target_moves: Option<i32>,
) -> ValidationResult {
    if tiles_interior.is_empty() || tiles_interior[0].is_empty() {
        return ValidationResult {
            valid_tiles: false,
            solvable: false,
            optimal_moves: -1,
            unique_optimal: false,
            no_stuck: false,
            meets_target_moves: false,
        };
    }

    let interior_h = tiles_interior.len();
    let interior_w = tiles_interior[0].len();
    if tiles_interior.iter().any(|row| row.len() != interior_w) {
        return ValidationResult {
            valid_tiles: false,
            solvable: false,
            optimal_moves: -1,
            unique_optimal: false,
            no_stuck: false,
            meets_target_moves: false,
        };
    }

    let mut valid_tiles = true;
    let width = interior_w + 2;
    let height = interior_h + 2;
    let mut tiles = vec![vec![TileType::Wall; width]; height];

    for y in 0..interior_h {
        for x in 0..interior_w {
            match TileType::from_u8(tiles_interior[y][x]) {
                Some(tile) => tiles[y + 1][x + 1] = tile,
                None => {
                    valid_tiles = false;
                    tiles[y + 1][x + 1] = TileType::Wall;
                }
            }
        }
    }

    if start.x < 0
        || start.y < 0
        || goal.x < 0
        || goal.y < 0
        || start.x >= interior_w as i32
        || start.y >= interior_h as i32
        || goal.x >= interior_w as i32
        || goal.y >= interior_h as i32
    {
        return ValidationResult {
            valid_tiles: false,
            solvable: false,
            optimal_moves: -1,
            unique_optimal: false,
            no_stuck: false,
            meets_target_moves: false,
        };
    }

    let start_full = Position {
        x: start.x + 1,
        y: start.y + 1,
    };
    let goal_full = Position {
        x: goal.x + 1,
        y: goal.y + 1,
    };

    tiles[start_full.y as usize][start_full.x as usize] = TileType::Start;
    tiles[goal_full.y as usize][goal_full.x as usize] = TileType::Goal;

    let optimal_path = find_optimal_path(&tiles, &start_full, &goal_full, width, height);
    let solvable = optimal_path.is_some();
    let optimal_moves = if let Some(ref path) = optimal_path {
        (path.len() as i32) - 1
    } else {
        -1
    };
    let no_stuck = solvable && has_no_stuck_states(&tiles, &start_full, &goal_full, width, height);
    let unique_optimal = solvable
        && has_unique_optimal_path(&tiles, &start_full, &goal_full, width, height, optimal_moves);
    let meets_target_moves = target_moves.map_or(solvable, |t| optimal_moves == t);

    ValidationResult {
        valid_tiles,
        solvable,
        optimal_moves,
        unique_optimal,
        no_stuck,
        meets_target_moves,
    }
}

/// Public wrapper to get the optimal path for a puzzle.
/// Returns None if not solvable, otherwise returns the list of stop positions.
pub fn find_optimal_path_public(
    tiles_interior: &Vec<Vec<u8>>,
    start: Position,
    goal: Position,
) -> Option<Vec<Position>> {
    if tiles_interior.is_empty() || tiles_interior[0].is_empty() {
        return None;
    }

    let height = tiles_interior.len();
    let width = tiles_interior[0].len();

    // Convert to TileType with border
    let full_width = width + 2;
    let full_height = height + 2;
    let mut tiles: Vec<Vec<TileType>> = Vec::with_capacity(full_height);

    // Top border
    tiles.push(vec![TileType::Wall; full_width]);

    // Interior rows with side borders
    for row in tiles_interior {
        let mut tile_row = Vec::with_capacity(full_width);
        tile_row.push(TileType::Wall);
        for &tile_id in row {
            tile_row.push(TileType::from_u8(tile_id).unwrap_or(TileType::Ground));
        }
        tile_row.push(TileType::Wall);
        tiles.push(tile_row);
    }

    // Bottom border
    tiles.push(vec![TileType::Wall; full_width]);

    // Convert interior coords to full coords
    let start_full = Position { x: start.x + 1, y: start.y + 1 };
    let goal_full = Position { x: goal.x + 1, y: goal.y + 1 };

    // Set start/goal tile types (matches validate_ice_puzzle_interior behavior)
    tiles[start_full.y as usize][start_full.x as usize] = TileType::Start;
    tiles[goal_full.y as usize][goal_full.x as usize] = TileType::Goal;

    // Find path and convert back to interior coords
    find_optimal_path(&tiles, &start_full, &goal_full, full_width, full_height)
        .map(|path| {
            path.into_iter()
                .map(|p| Position { x: p.x - 1, y: p.y - 1 })
                .collect()
        })
}

// =============================================================================
// INTUITIVE DIRECTION HELPERS
// =============================================================================

fn get_intuitive_direction(from: &Position, to: &Position) -> Vec<Direction> {
    let mut dirs = Vec::new();
    if to.x > from.x {
        dirs.push(Direction::Right);
    }
    if to.x < from.x {
        dirs.push(Direction::Left);
    }
    if to.y > from.y {
        dirs.push(Direction::Down);
    }
    if to.y < from.y {
        dirs.push(Direction::Up);
    }
    dirs
}

fn get_opposite_dir(dir: Direction) -> Direction {
    match dir {
        Direction::Up => Direction::Down,
        Direction::Down => Direction::Up,
        Direction::Left => Direction::Right,
        Direction::Right => Direction::Left,
    }
}

fn manhattan_dist(a: &Position, b: &Position) -> i32 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

fn get_direct_path_zone(
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    thickness: i32,
) -> HashSet<Position> {
    let mut zone = new_pos_set(width * height);
    let dx = goal.x - start.x;
    let dy = goal.y - start.y;
    let steps = dx.abs().max(dy.abs());

    for i in 0..=steps {
        let t = if steps > 0 {
            i as f64 / steps as f64
        } else {
            0.0
        };
        let cx = (start.x as f64 + dx as f64 * t).round() as i32;
        let cy = (start.y as f64 + dy as f64 * t).round() as i32;

        for ox in -thickness..=thickness {
            for oy in -thickness..=thickness {
                let x = cx + ox;
                let y = cy + oy;
                if is_valid(x, y, width, height) {
                    zone.insert(Position { x, y });
                }
            }
        }
    }

    zone
}

fn find_optimal_path(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> Option<Vec<Position>> {
    let mut queue: Vec<Position> = Vec::with_capacity(width * height);
    let mut parent: Vec<usize> = vec![usize::MAX; width * height];
    let start_idx = pos_index(start, width);
    parent[start_idx] = start_idx;
    queue.push(*start);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        if pos_eq(&current, goal) {
            let mut path = Vec::new();
            let mut idx = pos_index(&current, width);
            loop {
                path.push(index_to_pos(idx, width));
                if idx == start_idx {
                    break;
                }
                idx = parent[idx];
            }
            path.reverse();
            return Some(path);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid {
                let idx = pos_index(&result.pos, width);
                if parent[idx] == usize::MAX {
                    parent[idx] = pos_index(&current, width);
                    queue.push(result.pos);
                }
            }
        }
    }

    None
}

// =============================================================================
// GENIUS-LEVEL DECEPTION ENGINE HELPERS
// =============================================================================

fn engineer_counter_intuitive_path(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    _rng: &mut SeededRandom,
) {
    let zone_thickness = scale_value_for_map(4, width, height, 1);
    let _intuitive_zone = get_direct_path_zone(start, goal, width, height, zone_thickness);
    let intuitive_dirs = get_intuitive_direction(start, goal);

    let max_range = scale_value_for_map(6, width, height, 2);
    let mut goal_approaches: Vec<Position> = Vec::new();
    for r in 1..=max_range {
        for dir in &intuitive_dirs {
            let (dx, dy) = get_delta(*dir);
            let x = goal.x - dx * r;
            let y = goal.y - dy * r;
            if is_inner(x, y, width, height) {
                goal_approaches.push(Position { x, y });
            }
        }
    }

    for pos in goal_approaches {
        if tiles[pos.y as usize][pos.x as usize] == TileType::Ice
            && !pos_eq(&pos, start)
            && !pos_eq(&pos, goal)
        {
            tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
            if !is_solvable(tiles, start, goal, width, height) {
                tiles[pos.y as usize][pos.x as usize] = TileType::Ice;
            }
        }
    }
}

fn create_almost_there_traps(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let (runway_min, runway_max) = scale_range_for_map(4, 8, width, height, 1);
    let (end_min, end_max) = scale_range_for_map(3, 6, width, height, 1);

    for _ in 0..count {
        let approach_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(approach_dir);
        let (odx, ody) = get_delta(get_opposite_dir(approach_dir));

        let runway_start = Position {
            x: goal.x + odx * rng.random_int(runway_min, runway_max),
            y: goal.y + ody * rng.random_int(runway_min, runway_max),
        };
        let runway_end = Position {
            x: goal.x + dx * rng.random_int(end_min, end_max),
            y: goal.y + dy * rng.random_int(end_min, end_max),
        };

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let mut valid = true;

        let mut rx = runway_start.x;
        let mut ry = runway_start.y;
        while (dx != 0 && rx != runway_end.x) || (dy != 0 && ry != runway_end.y) {
            if !is_inner(rx, ry, width, height) {
                valid = false;
                break;
            }

            if !pos_eq(&Position { x: rx, y: ry }, goal)
                && !pos_eq(&Position { x: rx, y: ry }, start)
                && tiles[ry as usize][rx as usize] == TileType::Wall
            {
                backup.push((Position { x: rx, y: ry }, tiles[ry as usize][rx as usize]));
                tiles[ry as usize][rx as usize] = TileType::Ice;
            }

            rx += dx;
            ry += dy;
        }

        let perp_dirs = if approach_dir == Direction::Up || approach_dir == Direction::Down {
            vec![Direction::Left, Direction::Right]
        } else {
            vec![Direction::Up, Direction::Down]
        };

        for perp_dir in perp_dirs {
            let (px, py) = get_delta(perp_dir);
            let adj_x = goal.x + px;
            let adj_y = goal.y + py;
            if is_inner(adj_x, adj_y, width, height)
                && tiles[adj_y as usize][adj_x as usize] == TileType::Wall
                && !pos_eq(&Position { x: adj_x, y: adj_y }, start)
            {
                // Keep walls on sides - this makes them slide past!
            }
        }

        if !valid || !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_decoy_open_areas(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let intuitive_dirs = get_intuitive_direction(start, goal);
    let (dist_min, dist_max) = scale_range_for_map(6, 12, width, height, 2);
    let (area_min, area_max) = scale_range_for_map(4, 7, width, height, 1);
    let offset_range = scale_value_for_map(3, width, height, 1);

    for _ in 0..count {
        let primary_dir = rng.random_choice(&intuitive_dirs);
        let (dx, dy) = get_delta(primary_dir);

        let dist_from_start = rng.random_int(dist_min, dist_max);
        let cx = start.x + dx * dist_from_start + rng.random_int(-offset_range, offset_range + 1);
        let cy = start.y + dy * dist_from_start + rng.random_int(-offset_range, offset_range + 1);

        if !is_inner(cx, cy, width, height) {
            continue;
        }

        let area_size = rng.random_int(area_min, area_max);
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        for dy2 in -area_size..=area_size {
            for dx2 in -area_size..=area_size {
                if (dx2).abs() + (dy2).abs() > area_size + 2 {
                    continue;
                }
                let x = cx + dx2;
                let y = cy + dy2;
                if !is_inner(x, y, width, height) {
                    continue;
                }
                if pos_eq(&Position { x, y }, start) || pos_eq(&Position { x, y }, goal) {
                    continue;
                }
                if tiles[y as usize][x as usize] == TileType::Wall {
                    backup.push((Position { x, y }, tiles[y as usize][x as usize]));
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }

        let block_dist = area_size + 2;
        for i in -area_size..=area_size {
            let bx = cx + dx * block_dist + if dx == 0 { i } else { 0 };
            let by = cy + dy * block_dist + if dy == 0 { i } else { 0 };

            if is_inner(bx, by, width, height)
                && tiles[by as usize][bx as usize] == TileType::Ice
                && !pos_eq(&Position { x: bx, y: by }, start)
                && !pos_eq(&Position { x: bx, y: by }, goal)
            {
                backup.push((Position { x: bx, y: by }, tiles[by as usize][bx as usize]));
                tiles[by as usize][bx as usize] = TileType::Wall;
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_hidden_choke_points(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let zone_thickness = scale_value_for_map(5, width, height, 2);
    let margin = scale_value_for_map(4, width, height, 2);
    let (barrier_min, barrier_max) = scale_range_for_map(8, 14, width, height, 3);

    for _ in 0..count {
        let direct_zone = get_direct_path_zone(start, goal, width, height, zone_thickness);

        let mut cx;
        let mut cy;
        let mut attempts = 0;
        let min_coord = margin;
        let max_coord_x = (width as i32 - margin).max(min_coord + 1);
        let max_coord_y = (height as i32 - margin).max(min_coord + 1);
        loop {
            cx = rng.random_int(min_coord, max_coord_x);
            cy = rng.random_int(min_coord, max_coord_y);
            attempts += 1;
            let candidate = Position { x: cx, y: cy };
            if !direct_zone.contains(&candidate) || attempts >= 50 {
                break;
            }
        }
        if attempts >= 50 {
            continue;
        }

        let is_horizontal = rng.random() < 0.5;
        let barrier_length = rng.random_int(barrier_min, barrier_max);
        let gap_pos = rng.random_int(1, (barrier_length - 1).max(2));

        let mut backup: Vec<(Position, TileType)> = Vec::new();

        for i in 0..barrier_length {
            let x = if is_horizontal {
                cx + i - barrier_length / 2
            } else {
                cx
            };
            let y = if is_horizontal {
                cy
            } else {
                cy + i - barrier_length / 2
            };

            if i == gap_pos || !is_inner(x, y, width, height) {
                continue;
            }
            let pos = Position { x, y };
            if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                continue;
            }

            if tiles[y as usize][x as usize] == TileType::Ice {
                backup.push((pos, tiles[y as usize][x as usize]));
                tiles[y as usize][x as usize] = TileType::Wall;
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        } else if !has_no_stuck_states(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_momentum_traps(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let optimal_path = find_optimal_path(tiles, start, goal, width, height);
    let min_path_len = scale_value_for_map(5, width, height, 3);
    if optimal_path.is_none() || optimal_path.as_ref().unwrap().len() < min_path_len as usize {
        return;
    }
    let optimal_path = optimal_path.unwrap();
    let (runway_min, runway_max) = scale_range_for_map(8, 15, width, height, 2);
    let (offset_min, offset_max) = scale_range_for_map(2, 5, width, height, 1);
    let max_path_idx = scale_value_for_map(10, width, height, 3);

    for _ in 0..count {
        let path_idx = rng.random_int(
            1,
            (optimal_path.len() - 1).min(max_path_idx as usize) as i32,
        );
        let key_pos = optimal_path[path_idx as usize];

        let runway_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(runway_dir);
        let runway_length = rng.random_int(runway_min, runway_max);
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        let offset_dist = rng.random_int(offset_min, offset_max);
        let runway_start_x = key_pos.x - dx * offset_dist;
        let runway_start_y = key_pos.y - dy * offset_dist;

        for i in 0..runway_length {
            let x = runway_start_x + dx * i;
            let y = runway_start_y + dy * i;
            if !is_inner(x, y, width, height) {
                continue;
            }
            let pos = Position { x, y };
            if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                continue;
            }

            let tile = tiles[y as usize][x as usize];
            if tile == TileType::Wall || tile == TileType::Ground {
                backup.push((pos, tile));
                tiles[y as usize][x as usize] = TileType::Ice;
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_anti_gradient_zones(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let intuitive_dirs = get_intuitive_direction(start, goal);
    let (radius_min, radius_max) = scale_range_for_map(3, 6, width, height, 1);

    for _ in 0..count {
        let t = rng.random() * 0.6 + 0.2;
        let zone_x = (start.x as f64 + (goal.x - start.x) as f64 * t).round() as i32;
        let zone_y = (start.y as f64 + (goal.y - start.y) as f64 * t).round() as i32;

        if !is_inner(zone_x, zone_y, width, height) {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let zone_radius = rng.random_int(radius_min, radius_max);

        for dy in -zone_radius..=zone_radius {
            for dx in -zone_radius..=zone_radius {
                let x = zone_x + dx;
                let y = zone_y + dy;

                if !is_inner(x, y, width, height) {
                    continue;
                }
                if pos_eq(&Position { x, y }, start) || pos_eq(&Position { x, y }, goal) {
                    continue;
                }

                let is_intuitive = intuitive_dirs.iter().any(|dir| {
                    let (ddx, ddy) = get_delta(*dir);
                    (ddx > 0 && dx > 0)
                        || (ddx < 0 && dx < 0)
                        || (ddy > 0 && dy > 0)
                        || (ddy < 0 && dy < 0)
                });

                if is_intuitive
                    && tiles[y as usize][x as usize] == TileType::Ice
                    && rng.random() < 0.4
                {
                    backup.push((Position { x, y }, tiles[y as usize][x as usize]));
                    tiles[y as usize][x as usize] = TileType::Wall;
                } else if !is_intuitive
                    && tiles[y as usize][x as usize] == TileType::Wall
                    && rng.random() < 0.3
                {
                    backup.push((Position { x, y }, tiles[y as usize][x as usize]));
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_parallel_path_illusion(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    for _ in 0..count {
        let original_moves = find_path(tiles, start, goal, width, height);
        if original_moves.is_none() {
            continue;
        }
        let original_moves = original_moves.unwrap();

        let mut candidates: Vec<Position> = Vec::new();

        for y in 4..(height as i32 - 4) {
            for x in 4..(width as i32 - 4) {
                if tiles[y as usize][x as usize] != TileType::Wall {
                    continue;
                }
                let mut ice_neighbors = 0;
                for dir in get_all_dirs() {
                    let (dx, dy) = get_delta(dir);
                    let nx = x + dx;
                    let ny = y + dy;
                    if is_valid(nx, ny, width, height)
                        && tiles[ny as usize][nx as usize] == TileType::Ice
                    {
                        ice_neighbors += 1;
                    }
                }
                if ice_neighbors >= 2 {
                    candidates.push(Position { x, y });
                }
            }
        }

        if candidates.is_empty() {
            continue;
        }

        let shuffled = rng.shuffle(&candidates);
        for pos in shuffled.into_iter().take(20) {
            tiles[pos.y as usize][pos.x as usize] = TileType::Ice;
            let new_moves = find_path(tiles, start, goal, width, height);

            if let Some(new_moves) = new_moves {
                if new_moves >= original_moves {
                    break;
                }
            }
            tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
        }
    }
}

fn create_ledge_misdirection(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let intuitive_dirs = get_intuitive_direction(start, goal);
    let (dist_min, dist_max) = scale_range_for_map(5, 12, width, height, 2);
    let offset_range = scale_value_for_map(2, width, height, 1);

    for _ in 0..count {
        let dir = rng.random_choice(&intuitive_dirs);
        let (dx, dy) = get_delta(dir);
        let dist = rng.random_int(dist_min, dist_max);
        let lx = start.x + dx * dist + rng.random_int(-offset_range, offset_range + 1);
        let ly = start.y + dy * dist + rng.random_int(-offset_range, offset_range + 1);

        if !is_inner(lx, ly, width, height) {
            continue;
        }
        if tiles[ly as usize][lx as usize] != TileType::Ice {
            continue;
        }
        let pos = Position { x: lx, y: ly };
        if pos_eq(&pos, start) || pos_eq(&pos, goal) {
            continue;
        }

        let before_moves = find_path(tiles, start, goal, width, height);
        if before_moves.is_none() {
            continue;
        }

        let ledge_type = match dir {
            Direction::Right => TileType::LedgeRight,
            Direction::Left => TileType::LedgeLeft,
            Direction::Down => TileType::LedgeDown,
            Direction::Up => TileType::LedgeUp,
        };

        let old_tile = tiles[ly as usize][lx as usize];
        tiles[ly as usize][lx as usize] = ledge_type;

        let after_moves = find_path(tiles, start, goal, width, height);
        if after_moves.is_none() || !has_no_stuck_states(tiles, start, goal, width, height) {
            tiles[ly as usize][lx as usize] = old_tile;
        } else if let Some(after_moves) = after_moves {
            if let Some(before_moves) = before_moves {
                if after_moves < before_moves {
                    tiles[ly as usize][lx as usize] = old_tile;
                }
            }
        }
    }
}

fn create_goal_proximity_dead_ends(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let (dist_min, dist_max) = scale_range_for_map(2, 5, width, height, 1);
    let pocket_size = scale_value_for_map(2, width, height, 1);

    for _ in 0..count {
        let dist = rng.random_int(dist_min, dist_max);
        let angle = rng.random() * std::f64::consts::PI * 2.0;
        let pocket_x = (goal.x as f64 + angle.cos() * dist as f64).round() as i32;
        let pocket_y = (goal.y as f64 + angle.sin() * dist as f64).round() as i32;
        if !is_inner(pocket_x, pocket_y, width, height) {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        for dy in -pocket_size..=pocket_size {
            for dx in -pocket_size..=pocket_size {
                let x = pocket_x + dx;
                let y = pocket_y + dy;
                if !is_inner(x, y, width, height) {
                    continue;
                }
                let pos = Position { x, y };
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }
                if tiles[y as usize][x as usize] == TileType::Wall {
                    backup.push((pos, tiles[y as usize][x as usize]));
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }

        let dir_to_goal = Position {
            x: (goal.x - pocket_x).signum(),
            y: (goal.y - pocket_y).signum(),
        };

        for i in 1..dist {
            let block_x = pocket_x + dir_to_goal.x * i;
            let block_y = pocket_y + dir_to_goal.y * i;
            if is_inner(block_x, block_y, width, height)
                && tiles[block_y as usize][block_x as usize] == TileType::Ice
                && !pos_eq(
                    &Position {
                        x: block_x,
                        y: block_y,
                    },
                    goal,
                )
            {
                backup.push((
                    Position {
                        x: block_x,
                        y: block_y,
                    },
                    tiles[block_y as usize][block_x as usize],
                ));
                tiles[block_y as usize][block_x as usize] = TileType::Wall;
            }
        }

        if !is_solvable(tiles, start, goal, width, height)
            || !has_no_stuck_states(tiles, start, goal, width, height)
        {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn create_commitment_traps(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    for _ in 0..count {
        let mut decision_points: Vec<Position> = Vec::new();

        for y in 3..(height as i32 - 3) {
            for x in 3..(width as i32 - 3) {
                let pos = Position { x, y };
                if (tiles[y as usize][x as usize] == TileType::Ground
                    || tiles[y as usize][x as usize] == TileType::Ice)
                    && !pos_eq(&pos, start)
                    && !pos_eq(&pos, goal)
                {
                    let mut valid_moves = 0;
                    for dir in get_all_dirs() {
                        let result = simulate_move(tiles, &pos, dir, width, height);
                        if result.valid && !pos_eq(&result.pos, &pos) {
                            valid_moves += 1;
                        }
                    }
                    if valid_moves >= 3 {
                        decision_points.push(pos);
                    }
                }
            }
        }

        if decision_points.is_empty() {
            continue;
        }

        let dp = rng.random_choice(&decision_points);
        let mut path_costs: Vec<(Direction, i32)> = Vec::new();
        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &dp, dir, width, height);
            if result.valid && !pos_eq(&result.pos, &dp) {
                if let Some(cost_from_there) = find_path(tiles, &result.pos, goal, width, height) {
                    path_costs.push((dir, cost_from_there));
                }
            }
        }

        if path_costs.len() < 2 {
            continue;
        }
        path_costs.sort_by_key(|(_, cost)| *cost);

        let optimal_dir = path_costs[0].0;
        let (dx, dy) = get_delta(optimal_dir);
        let ledge_x = dp.x + dx * 2;
        let ledge_y = dp.y + dy * 2;

        if is_inner(ledge_x, ledge_y, width, height)
            && tiles[ledge_y as usize][ledge_x as usize] == TileType::Ice
        {
            let opp_dir = get_opposite_dir(optimal_dir);
            let ledge_type = match opp_dir {
                Direction::Down => TileType::LedgeUp,
                Direction::Up => TileType::LedgeDown,
                Direction::Right => TileType::LedgeLeft,
                Direction::Left => TileType::LedgeRight,
            };

            let old_tile = tiles[ledge_y as usize][ledge_x as usize];
            tiles[ledge_y as usize][ledge_x as usize] = ledge_type;

            if !is_solvable(tiles, start, goal, width, height)
                || !has_no_stuck_states(tiles, start, goal, width, height)
            {
                tiles[ledge_y as usize][ledge_x as usize] = old_tile;
            }
        }
    }
}

// =============================================================================
// PSYCHOLOGY-BASED DIFFICULTY SCORING SYSTEM
// =============================================================================

#[derive(Clone, Debug)]
struct PsychMetrics {
    // Original metrics (Phase 0)
    counter_intuitive_moves: i32,
    attractive_decoys: i32,
    commitment_gates: i32,
    false_progress_paths: i32,

    // Path structure metrics (Phase 1)
    path_locality: f64,           // 0.0-1.0, lower = more concentrated
    direction_changes: i32,       // Count of direction changes in optimal path
    backtrack_depth: i32,         // How far "wrong way" the path goes
    decision_ambiguity: f64,      // Average valid moves at each decision point

    // Path diversity metrics (Phase 2)
    near_optimal_paths: i32,      // Count of paths within tolerance of optimal
    #[allow(dead_code)]
    optimal_path_count: i32,      // Count of paths at exactly optimal length
    path_overlap: f64,            // MINIMUM overlap - disabled in filtering/scoring
    path_overlap_avg: f64,        // AVERAGE overlap - how similar alternatives are on average
    early_divergence: f64,        // 0.0-1.0, how early alternatives diverge

    // Final computed score
    psychology_score: f64,
}

fn get_direction_between(from: &Position, to: &Position) -> Option<Direction> {
    let dx = to.x - from.x;
    let dy = to.y - from.y;

    if dx > 0 && dy == 0 {
        Some(Direction::Right)
    } else if dx < 0 && dy == 0 {
        Some(Direction::Left)
    } else if dy > 0 && dx == 0 {
        Some(Direction::Down)
    } else if dy < 0 && dx == 0 {
        Some(Direction::Up)
    } else if dx.abs() > dy.abs() {
        Some(if dx > 0 {
            Direction::Right
        } else {
            Direction::Left
        })
    } else if dy.abs() > dx.abs() {
        Some(if dy > 0 {
            Direction::Down
        } else {
            Direction::Up
        })
    } else {
        None
    }
}

fn count_counter_intuitive_moves(goal: &Position, optimal_path: &[Position]) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }
    let mut count = 0;
    for i in 0..optimal_path.len() - 1 {
        let current = &optimal_path[i];
        let next = &optimal_path[i + 1];

        if let Some(move_dir) = get_direction_between(current, next) {
            let intuitive_dirs = get_intuitive_direction(current, goal);
            if !intuitive_dirs.contains(&move_dir) {
                count += 1;
            }
        }
    }
    count
}

fn is_move_attractive(
    tiles: &Vec<Vec<TileType>>,
    from: &Position,
    alternative_pos: &Position,
    optimal_pos: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> bool {
    let alt_dist_to_goal = manhattan_dist(alternative_pos, goal);
    let opt_dist_to_goal = manhattan_dist(optimal_pos, goal);

    if alt_dist_to_goal < opt_dist_to_goal {
        return true;
    }

    if alt_dist_to_goal == opt_dist_to_goal {
        let intuitive_dirs = get_intuitive_direction(from, goal);
        if let Some(alt_dir) = get_direction_between(from, alternative_pos) {
            if intuitive_dirs.contains(&alt_dir) {
                return true;
            }
        }
    }

    let mut alt_options = 0;
    let mut opt_options = 0;
    for dir in get_all_dirs() {
        let alt_result = simulate_move(tiles, alternative_pos, dir, width, height);
        if alt_result.valid && !pos_eq(&alt_result.pos, alternative_pos) {
            alt_options += 1;
        }
        let opt_result = simulate_move(tiles, optimal_pos, dir, width, height);
        if opt_result.valid && !pos_eq(&opt_result.pos, optimal_pos) {
            opt_options += 1;
        }
    }

    alt_options > opt_options + 1
}

fn count_attractive_decoys(
    tiles: &Vec<Vec<TileType>>,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_path: &[Position],
) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }

    let mut count = 0;
    for i in 0..optimal_path.len() - 1 {
        let current = &optimal_path[i];
        let optimal_next = &optimal_path[i + 1];

        let optimal_dir = match get_direction_between(current, optimal_next) {
            Some(d) => d,
            None => continue,
        };

        for dir in get_all_dirs() {
            if dir == optimal_dir {
                continue;
            }
            let result = simulate_move(tiles, current, dir, width, height);
            if !result.valid || pos_eq(&result.pos, current) {
                continue;
            }
            if is_move_attractive(
                tiles,
                current,
                &result.pos,
                optimal_next,
                goal,
                width,
                height,
            ) {
                count += 1;
            }
        }
    }
    count
}

fn compute_distance_to_goal(
    tiles: &Vec<Vec<TileType>>,
    goal: &Position,
    width: usize,
    height: usize,
) -> HashMap<Position, i32> {
    let mut distances: HashMap<Position, i32> = new_pos_map(width * height);
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut queue: Vec<(Position, i32)> = vec![(*goal, 0)];
    distances.insert(*goal, 0);
    let mut head = 0;

    while head < queue.len() {
        let (current, dist) = queue[head];
        head += 1;

        if let Some(sources) = reverse_graph.get(&current) {
            for source in sources {
                if !distances.contains_key(source) {
                    distances.insert(*source, dist + 1);
                    queue.push((*source, dist + 1));
                }
            }
        }
    }

    distances
}

fn count_commitment_gates(
    tiles: &Vec<Vec<TileType>>,
    _goal: &Position,
    width: usize,
    height: usize,
    optimal_path: &[Position],
    distance_to_goal: &HashMap<Position, i32>,
) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }

    let optimal_moves = (optimal_path.len() - 1) as i32;
    let mut gate_count = 0;

    for i in 0..optimal_path.len() - 1 {
        let current = &optimal_path[i];
        let optimal_next = &optimal_path[i + 1];
        let optimal_dir = match get_direction_between(current, optimal_next) {
            Some(d) => d,
            None => continue,
        };

        let mut max_wrong_move_cost = 0;
        for dir in get_all_dirs() {
            if dir == optimal_dir {
                continue;
            }
            let result = simulate_move(tiles, current, dir, width, height);
            if !result.valid || pos_eq(&result.pos, current) {
                continue;
            }
            if let Some(wrong_path_length) = distance_to_goal.get(&result.pos) {
                let remaining_optimal = optimal_moves - i as i32;
                let wrong_move_cost = (wrong_path_length + 1) - remaining_optimal;
                max_wrong_move_cost = max_wrong_move_cost.max(wrong_move_cost);
            }
        }

        // Graduated commitment gate scoring:
        // - Severe gates (cost 5+): worth 2 points
        // - Moderate gates (cost 3-4): worth 1 point
        if max_wrong_move_cost >= 5 {
            gate_count += 2;
        } else if max_wrong_move_cost >= 3 {
            gate_count += 1;
        }
    }

    gate_count
}

fn count_false_progress_paths(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_moves: i32,
    distance_to_goal: &HashMap<Position, i32>,
) -> i32 {
    let mut false_path_count = 0;
    let mut checked = new_pos_set(width * height);

    let start_dist = manhattan_dist(start, goal);
    let mut queue: Vec<(Position, i32, i32)> = vec![(*start, 0, start_dist)];
    checked.insert(*start);
    let mut head = 0;

    while head < queue.len() {
        let (pos, dist_from_start, min_dist_seen) = queue[head];
        head += 1;
        if dist_from_start > optimal_moves + 10 {
            continue;
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if !result.valid || pos_eq(&result.pos, &pos) {
                continue;
            }
            if !checked.insert(result.pos) {
                continue;
            }

            let new_dist_to_goal = manhattan_dist(&result.pos, goal);
            let new_dist_from_start = dist_from_start + 1;
            let is_progress = new_dist_to_goal < min_dist_seen;

            if is_progress {
                if let Some(path_from_here) = distance_to_goal.get(&result.pos) {
                    let total_path = new_dist_from_start + path_from_here;
                    if total_path > optimal_moves + 3 {
                        false_path_count += 1;
                    }
                }
            }

            queue.push((
                result.pos,
                new_dist_from_start,
                min_dist_seen.min(new_dist_to_goal),
            ));
        }
    }

    false_path_count
}

// =============================================================================
// NEW PSYCHOLOGY METRICS - Better predictors of human-perceived difficulty
// =============================================================================

/// Calculate how concentrated the solution path is within the puzzle grid.
/// Returns 0.0-1.0 where LOWER = more concentrated = HARDER for humans.
/// A path that zigzags in a small area is much harder than one that sweeps across the map.
fn calculate_path_locality(
    optimal_path: &[Position],
    width: usize,
    height: usize,
) -> f64 {
    if optimal_path.len() < 2 {
        return 1.0; // Default to "easy" if no real path
    }

    // Calculate bounding box of the solution path
    let min_x = optimal_path.iter().map(|p| p.x).min().unwrap_or(0);
    let max_x = optimal_path.iter().map(|p| p.x).max().unwrap_or(0);
    let min_y = optimal_path.iter().map(|p| p.y).min().unwrap_or(0);
    let max_y = optimal_path.iter().map(|p| p.y).max().unwrap_or(0);

    let bbox_width = (max_x - min_x + 1) as f64;
    let bbox_height = (max_y - min_y + 1) as f64;
    let bbox_area = bbox_width * bbox_height;

    // Inner playable area (excluding walls)
    let inner_width = (width - 2) as f64;
    let inner_height = (height - 2) as f64;
    let inner_area = inner_width * inner_height;

    if inner_area <= 0.0 {
        return 1.0;
    }

    // Return ratio: what fraction of the playable area does the path span?
    (bbox_area / inner_area).min(1.0)
}

/// Count how many times the optimal path changes direction.
/// More direction changes = harder to discover the pattern.
/// Example: RIGHT → DOWN → RIGHT → UP → LEFT = 4 changes
fn count_direction_changes(optimal_path: &[Position]) -> i32 {
    if optimal_path.len() < 3 {
        return 0;
    }

    let mut changes = 0;
    let mut prev_dir: Option<Direction> = None;

    for i in 0..optimal_path.len() - 1 {
        let current = &optimal_path[i];
        let next = &optimal_path[i + 1];

        let current_dir = get_direction_between(current, next);

        if let (Some(prev), Some(curr)) = (prev_dir, current_dir) {
            if prev != curr {
                changes += 1;
            }
        }
        prev_dir = current_dir;
    }

    changes
}

/// Calculate how far "backwards" the solution path goes before reaching the goal.
/// If goal is to the right but solution goes far left first, that's a deep backtrack.
/// Returns the maximum extra distance from goal compared to the starting distance.
fn calculate_backtrack_depth(
    start: &Position,
    goal: &Position,
    optimal_path: &[Position],
) -> i32 {
    if optimal_path.is_empty() {
        return 0;
    }

    let start_dist = manhattan_dist(start, goal);
    let mut max_dist_from_goal = start_dist;

    for pos in optimal_path {
        let dist = manhattan_dist(pos, goal);
        max_dist_from_goal = max_dist_from_goal.max(dist);
    }

    // How much further from goal did we go compared to where we started?
    (max_dist_from_goal - start_dist).max(0)
}

/// Calculate average number of valid moves at each decision point along the optimal path.
/// Higher ambiguity = more choices that look equally valid = harder to pick the right one.
/// Only counts positions where player has 2+ valid moves (actual decision points).
fn calculate_decision_ambiguity(
    tiles: &Vec<Vec<TileType>>,
    optimal_path: &[Position],
    width: usize,
    height: usize,
) -> f64 {
    if optimal_path.len() < 2 {
        return 0.0;
    }

    let mut total_options = 0;
    let mut decision_points = 0;

    // Check each position on the path except the last (goal)
    for pos in optimal_path.iter().take(optimal_path.len() - 1) {
        let mut valid_moves = 0;

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, pos, dir, width, height);
            if result.valid && !pos_eq(&result.pos, pos) {
                valid_moves += 1;
            }
        }

        // Only count as decision point if there are 2+ options
        if valid_moves >= 2 {
            decision_points += 1;
            total_options += valid_moves;
        }
    }

    if decision_points == 0 {
        return 0.0;
    }

    // Return average number of options per decision point
    total_options as f64 / decision_points as f64
}

// =============================================================================
// PHASE 2: PATH DIVERSITY METRICS
// =============================================================================

/// Count distinct paths that reach the goal within `tolerance` moves of optimal.
/// Returns (total_near_optimal_count, exactly_optimal_count, min_overlap, avg_overlap).
/// min_overlap is computed across alternative paths only (excludes the exact optimal path).
/// avg_overlap is computed across alternative paths only (excludes the exact optimal path).
/// Paths are restricted to no revisits (simple paths).
///
/// More near-optimal paths = more "this could be right" confusion = harder puzzle.
fn count_near_optimal_paths(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_path: &[Position],
    optimal_moves: i32,
    tolerance: i32,
) -> (i32, i32, f64, f64) {
    const MAX_PATHS: i64 = 1000;
    const MAX_OPT_PATHS: i64 = 100;
    let max_moves = optimal_moves + tolerance;

    let node_count = width * height;
    let mut neighbors: Vec<Vec<usize>> = vec![Vec::new(); node_count];
    let mut reverse_neighbors: Vec<Vec<usize>> = vec![Vec::new(); node_count];

    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == TileType::Wall {
                continue;
            }
            let pos = Position { x: x as i32, y: y as i32 };
            let idx = pos_index(&pos, width);
            for dir in get_all_dirs() {
                let result = simulate_move(tiles, &pos, dir, width, height);
                if result.valid && !pos_eq(&result.pos, &pos) {
                    let next_idx = pos_index(&result.pos, width);
                    neighbors[idx].push(next_idx);
                    reverse_neighbors[next_idx].push(idx);
                }
            }
        }
    }

    let start_idx = pos_index(start, width);
    let goal_idx = pos_index(goal, width);

    // Shortest distance to goal for pruning
    let mut dist_to_goal = vec![-1; node_count];
    let mut queue: Vec<usize> = Vec::with_capacity(node_count);
    dist_to_goal[goal_idx] = 0;
    queue.push(goal_idx);
    let mut head = 0;
    while head < queue.len() {
        let current = queue[head];
        head += 1;
        let next_dist = dist_to_goal[current] + 1;
        for &src in &reverse_neighbors[current] {
            if dist_to_goal[src] == -1 {
                dist_to_goal[src] = next_dist;
                queue.push(src);
            }
        }
    }

    let mut optimal_mask = vec![false; node_count];
    let mut optimal_indices: Vec<usize> = Vec::with_capacity(optimal_path.len());
    for pos in optimal_path {
        let idx = pos_index(pos, width);
        optimal_mask[idx] = true;
        optimal_indices.push(idx);
    }

    let mut total_paths: i64 = 0;
    let mut optimal_paths: i64 = 0;
    let mut sum_overlap_ratios = 0.0;
    let mut optimal_path_seen: i64 = 0;
    let mut min_overlap = 1.0;

    let mut visited = vec![false; node_count];
    visited[start_idx] = true;
    let start_overlap = if optimal_mask[start_idx] { 1 } else { 0 };

    fn dfs(
        idx: usize,
        moves: i32,
        overlap_count: i32,
        matches_optimal: bool,
        visited: &mut [bool],
        neighbors: &[Vec<usize>],
        dist_to_goal: &[i32],
        goal_idx: usize,
        optimal_moves: i32,
        max_moves: i32,
        optimal_mask: &[bool],
        optimal_indices: &[usize],
        total_paths: &mut i64,
        optimal_paths: &mut i64,
        sum_overlap_ratios: &mut f64,
        optimal_path_seen: &mut i64,
        min_overlap: &mut f64,
    ) {
        if *total_paths >= MAX_PATHS {
            return;
        }

        let dist = dist_to_goal[idx];
        if dist < 0 || moves + dist > max_moves {
            return;
        }

        if idx == goal_idx {
            *total_paths += 1;
            if moves == optimal_moves {
                *optimal_paths += 1;
            }
            let overlap_ratio = overlap_count as f64 / (moves as f64 + 1.0);
            *sum_overlap_ratios += overlap_ratio;
            if matches_optimal && moves == optimal_moves {
                *optimal_path_seen += 1;
            } else if overlap_ratio < *min_overlap {
                *min_overlap = overlap_ratio;
            }
            return;
        }

        if moves >= max_moves {
            return;
        }

        let mut visited_opt_first = false;
        if matches_optimal && (moves as usize + 1) < optimal_indices.len() {
            let opt_next = optimal_indices[moves as usize + 1];
            if !visited[opt_next] && neighbors[idx].contains(&opt_next) {
                visited[opt_next] = true;
                let next_overlap = overlap_count + if optimal_mask[opt_next] { 1 } else { 0 };
                dfs(
                    opt_next,
                    moves + 1,
                    next_overlap,
                    true,
                    visited,
                    neighbors,
                    dist_to_goal,
                    goal_idx,
                    optimal_moves,
                    max_moves,
                    optimal_mask,
                    optimal_indices,
                    total_paths,
                    optimal_paths,
                    sum_overlap_ratios,
                    optimal_path_seen,
                    min_overlap,
                );
                visited[opt_next] = false;
                visited_opt_first = true;
            }
        }

        for &next in &neighbors[idx] {
            if visited[next] {
                continue;
            }
            if visited_opt_first && matches_optimal && (moves as usize + 1) < optimal_indices.len() {
                if next == optimal_indices[moves as usize + 1] {
                    continue;
                }
            }
            visited[next] = true;
            let next_overlap = overlap_count + if optimal_mask[next] { 1 } else { 0 };
            let next_matches = matches_optimal
                && (moves as usize + 1) < optimal_indices.len()
                && next == optimal_indices[moves as usize + 1];
            dfs(
                next,
                moves + 1,
                next_overlap,
                next_matches,
                visited,
                neighbors,
                dist_to_goal,
                goal_idx,
                optimal_moves,
                max_moves,
                optimal_mask,
                optimal_indices,
                total_paths,
                optimal_paths,
                sum_overlap_ratios,
                optimal_path_seen,
                min_overlap,
            );
            visited[next] = false;
            if *total_paths >= MAX_PATHS {
                return;
            }
        }
    }

    dfs(
        start_idx,
        0,
        start_overlap,
        optimal_indices.first().copied() == Some(start_idx),
        &mut visited,
        &neighbors,
        &dist_to_goal,
        goal_idx,
        optimal_moves,
        max_moves,
        &optimal_mask,
        &optimal_indices,
        &mut total_paths,
        &mut optimal_paths,
        &mut sum_overlap_ratios,
        &mut optimal_path_seen,
        &mut min_overlap,
    );

    let mut avg_overlap = 1.0;
    if total_paths > 0 {
        let mut alt_paths = total_paths;
        let mut alt_ratio_sum = sum_overlap_ratios;
        if optimal_path_seen > 0 {
            alt_paths -= optimal_path_seen;
            alt_ratio_sum -= optimal_path_seen as f64;
        }
        if alt_paths > 0 {
            avg_overlap = alt_ratio_sum / alt_paths as f64;
        }
    }

    (
        total_paths.min(MAX_PATHS) as i32,
        optimal_paths.min(MAX_OPT_PATHS) as i32,
        min_overlap,
        avg_overlap,
    )
}

/// Fast check for whether there's exactly one optimal path.
/// More efficient than count_near_optimal_paths when we only need to know if unique.
fn has_unique_optimal_path(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_moves: i32,
) -> bool {
    // Track number of ways to reach each (position, move_count) state
    let mut ways_to_reach: HashMap<(Position, i32), i64> = HashMap::default();
    ways_to_reach.insert((*start, 0), 1);

    let mut current_positions: Vec<Position> = vec![*start];

    for moves in 0..optimal_moves {
        let mut next_positions: HashSet<Position> = HashSet::default();

        for pos in &current_positions {
            let ways_here = *ways_to_reach.get(&(*pos, moves)).unwrap_or(&0);
            if ways_here == 0 {
                continue;
            }
            if pos_eq(pos, goal) {
                continue;
            }

            for dir in get_all_dirs() {
                let result = simulate_move(tiles, pos, dir, width, height);
                if result.valid && !pos_eq(&result.pos, pos) {
                    let next_state = (result.pos, moves + 1);
                    *ways_to_reach.entry(next_state).or_insert(0) += ways_here;
                    next_positions.insert(result.pos);
                }
            }
        }

        current_positions = next_positions.into_iter().collect();
    }

    // Check if exactly 1 path reaches goal at optimal move count
    ways_to_reach.get(&(*goal, optimal_moves)).copied().unwrap_or(0) == 1
}

/// Calculate overlap metrics between near-optimal paths and the optimal path.
/// Returns (min_overlap, avg_overlap) where:
/// - min_overlap: the BEST alternative (lowest overlap with optimal)
/// - avg_overlap: average overlap across all alternatives
///
/// For filtering:
/// - min_overlap <= 0.70 ensures at least one truly different path exists
/// - avg_overlap <= 0.90 ensures alternatives aren't all nearly identical
#[allow(dead_code)]
fn calculate_path_overlap(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    optimal_path: &[Position],
    width: usize,
    height: usize,
    optimal_moves: i32,
) -> (f64, f64) {
    if optimal_path.len() < 2 {
        return (1.0, 1.0);
    }

    let optimal_set: HashSet<Position> = optimal_path.iter().cloned().collect();
    let tolerance = 2;
    let max_moves = optimal_moves + tolerance;

    // Use parent pointers for path reconstruction - much faster than cloning
    const MAX_PATHS: usize = 30;
    const MAX_STATES: usize = 10000;

    // Each state: (position, moves, parent_index)
    let mut states: Vec<(Position, i32, usize)> = Vec::with_capacity(MAX_STATES);
    states.push((*start, 0, usize::MAX));
    
    // Track visited (position, moves) to avoid duplicate explorations
    let mut visited: HashSet<(Position, i32)> = HashSet::default();
    visited.insert((*start, 0));
    
    let mut head = 0;
    let mut min_overlap = 1.0;
    let mut total_overlap = 0.0;
    let mut alt_count = 0;
    let mut paths_found = 0;

    while head < states.len() && paths_found < MAX_PATHS && states.len() < MAX_STATES {
        let (pos, moves, _) = states[head];
        head += 1;

        if moves > max_moves {
            continue;
        }

        if pos_eq(&pos, goal) {
            paths_found += 1;
            
            // Reconstruct path to check if it's the optimal path
            let mut path: Vec<Position> = Vec::new();
            let mut idx = head - 1; // Current state index
            while idx != usize::MAX {
                path.push(states[idx].0);
                idx = states[idx].2;
            }
            path.reverse();
            
            // Check if this is exactly the optimal path
            let is_optimal = path.len() == optimal_path.len()
                && path.iter().zip(optimal_path.iter()).all(|(a, b)| pos_eq(a, b));
            
            if is_optimal {
                continue;
            }
            
            // Calculate overlap for this alternative path
            let overlap_count = path.iter().filter(|p| optimal_set.contains(p)).count();
            let overlap_ratio = overlap_count as f64 / path.len() as f64;
            
            if overlap_ratio < min_overlap {
                min_overlap = overlap_ratio;
            }
            total_overlap += overlap_ratio;
            alt_count += 1;
            continue;
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid && !pos_eq(&result.pos, &pos) {
                let state_key = (result.pos, moves + 1);
                if !visited.contains(&state_key) {
                    visited.insert(state_key);
                    states.push((result.pos, moves + 1, head - 1));
                }
            }
        }
    }

    if alt_count == 0 {
        return (1.0, 1.0);
    }

    let avg_overlap = total_overlap / alt_count as f64;
    (min_overlap, avg_overlap)
}

/// Calculate how early in the solution alternatives diverge from optimal path.
/// Returns 0.0-1.0 where:
/// - 1.0 = many alternatives available from the very first moves
/// - 0.0 = alternatives only appear near the end
///
/// Higher values = player confused from the start = harder puzzle.
fn calculate_early_divergence(
    tiles: &Vec<Vec<TileType>>,
    optimal_path: &[Position],
    width: usize,
    height: usize,
) -> f64 {
    if optimal_path.len() < 3 {
        return 0.0;
    }

    let path_len = optimal_path.len();
    let mut weighted_divergence = 0.0;
    let mut max_possible = 0.0;

    for (i, pos) in optimal_path.iter().enumerate().take(path_len - 1) {
        let optimal_next = &optimal_path[i + 1];
        let optimal_dir = get_direction_between(pos, optimal_next);

        // Count valid alternative moves
        let mut alt_count = 0;
        for dir in get_all_dirs() {
            if Some(dir) == optimal_dir {
                continue;
            }
            let result = simulate_move(tiles, pos, dir, width, height);
            if result.valid && !pos_eq(&result.pos, pos) {
                alt_count += 1;
            }
        }

        // Weight earlier positions exponentially higher
        // Position 0 weight = 1.0, Position 4 weight ≈ 0.37, Position 9 weight ≈ 0.14
        let position_weight = (-0.2 * i as f64).exp();

        weighted_divergence += alt_count as f64 * position_weight;
        max_possible += 3.0 * position_weight; // Max 3 alternatives per position
    }

    if max_possible == 0.0 {
        return 0.0;
    }

    (weighted_divergence / max_possible).min(1.0)
}

/// Convert path overlap ratio to a score (avg overlap).
/// Peaks at ~0.4 overlap (sweet spot of structure + variety).
/// Returns 0 at extremes (0.0 or 1.0 overlap).
fn overlap_score(overlap: f64) -> f64 {
    let ideal = 0.4;
    let deviation = (overlap - ideal).abs();
    // Score decreases linearly from peak, bottoms at 0
    (1.0 - deviation * 1.8).max(0.0)
}

#[allow(dead_code)]
fn calculate_psychology_score(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> PsychMetrics {
    let optimal_path = find_optimal_path(tiles, start, goal, width, height);
    if optimal_path.is_none() || optimal_path.as_ref().unwrap().len() < 2 {
        return PsychMetrics {
            counter_intuitive_moves: 0,
            attractive_decoys: 0,
            commitment_gates: 0,
            false_progress_paths: 0,
            path_locality: 1.0,
            direction_changes: 0,
            backtrack_depth: 0,
            decision_ambiguity: 0.0,
            near_optimal_paths: 0,
            optimal_path_count: 0,
            path_overlap: 1.0,
            path_overlap_avg: 1.0,
            early_divergence: 0.0,
            psychology_score: 0.0,
        };
    }
    let optimal_path = optimal_path.unwrap();
    let optimal_moves = (optimal_path.len() - 1) as i32;
    let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);

    // Original metrics (Phase 0)
    let counter_intuitive_moves = count_counter_intuitive_moves(goal, &optimal_path);
    let attractive_decoys = count_attractive_decoys(tiles, goal, width, height, &optimal_path);
    let commitment_gates =
        count_commitment_gates(tiles, goal, width, height, &optimal_path, &distance_to_goal);
    let false_progress_paths = count_false_progress_paths(
        tiles,
        start,
        goal,
        width,
        height,
        optimal_moves,
        &distance_to_goal,
    );

    // Path structure metrics (Phase 1)
    let path_locality = calculate_path_locality(&optimal_path, width, height);
    let direction_changes = count_direction_changes(&optimal_path);
    let backtrack_depth = calculate_backtrack_depth(start, goal, &optimal_path);
    let decision_ambiguity = calculate_decision_ambiguity(tiles, &optimal_path, width, height);

    // Path diversity metrics (Phase 2 - NEW)
    let tolerance = 2; // Count paths within optimal+2 moves
    let (near_optimal_paths, optimal_path_count, path_overlap, path_overlap_avg) = count_near_optimal_paths(
        tiles,
        start,
        goal,
        width,
        height,
        &optimal_path,
        optimal_moves,
        tolerance,
    );
    let early_divergence = calculate_early_divergence(tiles, &optimal_path, width, height);

    // Calculate final psychology score
    let psychology_score =
        // Original metrics
        (counter_intuitive_moves as f64 * WEIGHT_COUNTER_INTUITIVE)
        + (attractive_decoys as f64 * WEIGHT_ATTRACTIVE_DECOYS)
        + (commitment_gates as f64 * WEIGHT_COMMITMENT_GATES)
        + (false_progress_paths as f64 * WEIGHT_FALSE_PROGRESS)
        // Path structure metrics (locality inverted: low = hard = high score)
        + ((1.0 - path_locality) * WEIGHT_PATH_LOCALITY)
        + (direction_changes as f64 * WEIGHT_DIRECTION_CHANGES)
        + (backtrack_depth as f64 * WEIGHT_BACKTRACK_DEPTH)
        + (decision_ambiguity * WEIGHT_DECISION_AMBIGUITY)
        // Path diversity metrics (NEW)
        + (near_optimal_paths as f64 * WEIGHT_NEAR_OPTIMAL_PATHS)
        + (overlap_score(path_overlap_avg) * WEIGHT_PATH_OVERLAP)
        + (early_divergence * WEIGHT_EARLY_DIVERGENCE);

    PsychMetrics {
        counter_intuitive_moves,
        attractive_decoys,
        commitment_gates,
        false_progress_paths,
        path_locality,
        direction_changes,
        backtrack_depth,
        decision_ambiguity,
        near_optimal_paths,
        optimal_path_count,
        path_overlap,
        path_overlap_avg,
        early_divergence,
        psychology_score,
    }
}

/// Timing data for psychology score calculation
struct PsychTiming {
    find_path_us: u64,
    count_paths_us: u64,
    overlap_us: u64,
}

/// Calculate psychology score with timing instrumentation
fn calculate_psychology_score_timed(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> (PsychMetrics, PsychTiming) {
    use std::time::Instant;
    
    let t0 = Instant::now();
    let optimal_path = find_optimal_path(tiles, start, goal, width, height);
    let find_path_us = t0.elapsed().as_micros() as u64;
    
    if optimal_path.is_none() || optimal_path.as_ref().unwrap().len() < 2 {
        return (PsychMetrics {
            counter_intuitive_moves: 0,
            attractive_decoys: 0,
            commitment_gates: 0,
            false_progress_paths: 0,
            path_locality: 1.0,
            direction_changes: 0,
            backtrack_depth: 0,
            decision_ambiguity: 0.0,
            near_optimal_paths: 0,
            optimal_path_count: 0,
            path_overlap: 1.0,
            path_overlap_avg: 1.0,
            early_divergence: 0.0,
            psychology_score: 0.0,
        }, PsychTiming { find_path_us, count_paths_us: 0, overlap_us: 0 });
    }
    let optimal_path = optimal_path.unwrap();
    let optimal_moves = (optimal_path.len() - 1) as i32;
    let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);

    // Original metrics (Phase 0)
    let counter_intuitive_moves = count_counter_intuitive_moves(goal, &optimal_path);
    let attractive_decoys = count_attractive_decoys(tiles, goal, width, height, &optimal_path);
    let commitment_gates =
        count_commitment_gates(tiles, goal, width, height, &optimal_path, &distance_to_goal);
    let false_progress_paths = count_false_progress_paths(
        tiles,
        start,
        goal,
        width,
        height,
        optimal_moves,
        &distance_to_goal,
    );

    // Path structure metrics (Phase 1)
    let path_locality = calculate_path_locality(&optimal_path, width, height);
    let direction_changes = count_direction_changes(&optimal_path);
    let backtrack_depth = calculate_backtrack_depth(start, goal, &optimal_path);
    let decision_ambiguity = calculate_decision_ambiguity(tiles, &optimal_path, width, height);

    // Path diversity metrics (Phase 2 - NEW) - TIMED
    let tolerance = 2;
    let t1 = Instant::now();
    let (near_optimal_paths, optimal_path_count, path_overlap, path_overlap_avg) = count_near_optimal_paths(
        tiles,
        start,
        goal,
        width,
        height,
        &optimal_path,
        optimal_moves,
        tolerance,
    );
    let count_paths_us = t1.elapsed().as_micros() as u64;

    let overlap_us = 0;
    
    let early_divergence = calculate_early_divergence(tiles, &optimal_path, width, height);

    // Calculate final psychology score
    let psychology_score =
        (counter_intuitive_moves as f64 * WEIGHT_COUNTER_INTUITIVE)
        + (attractive_decoys as f64 * WEIGHT_ATTRACTIVE_DECOYS)
        + (commitment_gates as f64 * WEIGHT_COMMITMENT_GATES)
        + (false_progress_paths as f64 * WEIGHT_FALSE_PROGRESS)
        + ((1.0 - path_locality) * WEIGHT_PATH_LOCALITY)
        + (direction_changes as f64 * WEIGHT_DIRECTION_CHANGES)
        + (backtrack_depth as f64 * WEIGHT_BACKTRACK_DEPTH)
        + (decision_ambiguity * WEIGHT_DECISION_AMBIGUITY)
        + (near_optimal_paths as f64 * WEIGHT_NEAR_OPTIMAL_PATHS)
        + (overlap_score(path_overlap_avg) * WEIGHT_PATH_OVERLAP)
        + (early_divergence * WEIGHT_EARLY_DIVERGENCE);

    (PsychMetrics {
        counter_intuitive_moves,
        attractive_decoys,
        commitment_gates,
        false_progress_paths,
        path_locality,
        direction_changes,
        backtrack_depth,
        decision_ambiguity,
        near_optimal_paths,
        optimal_path_count,
        path_overlap,
        path_overlap_avg,
        early_divergence,
        psychology_score,
    }, PsychTiming { find_path_us, count_paths_us, overlap_us })
}

/// Prefilter thresholds scaled to map size
#[derive(Clone, Copy)]
struct PrefilterThresholds {
    // Original thresholds
    min_counter_intuitive: i32,
    min_attractive_decoys: i32,
    min_commitment_gates: i32,
    min_false_progress: i32,

    // Phase 1 thresholds
    min_path_locality: f64,
    max_path_locality: f64,
    min_direction_changes: i32,
    min_backtrack_depth: i32,
    min_decision_ambiguity: f64,

    // Phase 2 thresholds
    min_near_optimal_paths: i32,  // Minimum alternative paths required
    max_path_overlap_best: f64,   // Maximum overlap for BEST alternative (must be different enough)
    max_path_overlap_avg: f64,    // Maximum AVG overlap - alternatives can't all be the same
    min_early_divergence: f64,    // Minimum early divergence score

    // Enabled flags - determines what gets logged and filtered
    ci_enabled: bool,
    dec_enabled: bool,
    gate_enabled: bool,
    fp_enabled: bool,
    loc_enabled: bool,
    dir_enabled: bool,
    bt_enabled: bool,
    amb_enabled: bool,
    paths_enabled: bool,
    olap_best_enabled: bool,
    olap_avg_enabled: bool,
    ediv_enabled: bool,
}

impl PrefilterThresholds {
    /// Format thresholds for logging (only enabled filters)
    fn format_thresholds(&self) -> String {
        let mut parts = Vec::new();
        
        if self.ci_enabled { parts.push(format!("ci≥{}", self.min_counter_intuitive)); }
        if self.dec_enabled { parts.push(format!("dec≥{}", self.min_attractive_decoys)); }
        if self.gate_enabled { parts.push(format!("gate≥{}", self.min_commitment_gates)); }
        if self.fp_enabled { parts.push(format!("fp≥{}", self.min_false_progress)); }
        if self.loc_enabled { parts.push(format!("loc={:.2}-{:.2}", self.min_path_locality, self.max_path_locality)); }
        if self.dir_enabled { parts.push(format!("dir≥{}", self.min_direction_changes)); }
        if self.bt_enabled { parts.push(format!("bt≥{}", self.min_backtrack_depth)); }
        if self.amb_enabled { parts.push(format!("amb≥{:.1}", self.min_decision_ambiguity)); }
        if self.paths_enabled { parts.push(format!("paths≥{}", self.min_near_optimal_paths)); }
        if self.olap_best_enabled { parts.push(format!("olap_best≤{:.2}", self.max_path_overlap_best)); }
        if self.olap_avg_enabled { parts.push(format!("olap_avg≤{:.2}", self.max_path_overlap_avg)); }
        if self.ediv_enabled { parts.push(format!("ediv≥{:.2}", self.min_early_divergence)); }
        
        parts.join(" ")
    }

    /// Format puzzle metrics for selected puzzle logging (ALL metrics, not just enabled)
    fn format_puzzle(&self, puzzle: &PuzzleData, traps: &[String]) -> String {
        let mut parts = Vec::new();
        
        parts.push(format!("score={}", puzzle.difficulty_score.unwrap_or(0)));
        
        // Always show all metrics for selected puzzle (for debugging/analysis)
        if let Some(v) = puzzle.counter_intuitive_moves { parts.push(format!("ci={}", v)); }
        if let Some(v) = puzzle.attractive_decoys { parts.push(format!("dec={}", v)); }
        if let Some(v) = puzzle.commitment_gates { parts.push(format!("gate={}", v)); }
        if let Some(v) = puzzle.false_progress_paths { parts.push(format!("fp={}", v)); }
        if let Some(v) = puzzle.path_locality { parts.push(format!("loc={:.2}", v)); }
        if let Some(v) = puzzle.direction_changes { parts.push(format!("dir={}", v)); }
        if let Some(v) = puzzle.backtrack_depth { parts.push(format!("bt={}", v)); }
        if let Some(v) = puzzle.decision_ambiguity { parts.push(format!("amb={:.1}", v)); }
        if let Some(v) = puzzle.near_optimal_paths { parts.push(format!("paths={}", v)); }
        if let Some(v) = puzzle.path_overlap { parts.push(format!("olap_best={:.2}", v)); }
        if let Some(v) = puzzle.path_overlap_avg { parts.push(format!("olap_avg={:.2}", v)); }
        if let Some(v) = puzzle.early_divergence { parts.push(format!("ediv={:.2}", v)); }
        
        let traps_str = if traps.is_empty() { "-".to_string() } else { traps.join(",") };
        parts.push(format!("traps=[{}]", traps_str));
        
        parts.join(" ")
    }
}

/// Reference target moves for 15x15 map (base thresholds are tuned for this)
const REFERENCE_MOVES: f64 = 10.0;

fn compute_prefilter_thresholds(width: usize, height: usize, target_moves: i32) -> PrefilterThresholds {
    let min_dim = width.min(height) as f64;
    let size_scale = min_dim / REFERENCE_SIZE; // Reference: 15x15 base map size
    
    // For move scaling: scale DOWN for fewer moves, but CAP at 1.0 for more moves
    // This makes shorter puzzles easier to generate (relaxed thresholds)
    // while keeping longer puzzles at the base difficulty (not harder to generate)
    let move_scale = ((target_moves as f64) / REFERENCE_MOVES).min(1.0);

    // Original thresholds - scale down for shorter puzzles only
    let ci = ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * move_scale).round() as i32)
        .max(1); // Floor of 1 for short puzzles
    let _decoys = ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * size_scale).round() as i32)
        .max(PREFILTER_FLOOR_ATTRACTIVE_DECOYS);
    let _gates = ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * size_scale).round() as i32)
        .max(PREFILTER_FLOOR_COMMITMENT_GATES);
    let fp = ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * move_scale).round() as i32)
        .max(1); // Floor of 1 for short puzzles

    // Phase 1 thresholds - direction changes scale with moves (can't have more changes than moves-1)
    let max_possible_dir_changes = (target_moves - 1).max(1);
    let min_dir_changes = ((BASE_PREFILTER_MIN_DIRECTION_CHANGES as f64 * move_scale).round() as i32)
        .max(2) // Floor of 2
        .min(max_possible_dir_changes); // Can't exceed what's physically possible
    let _min_backtrack = ((BASE_PREFILTER_MIN_BACKTRACK_DEPTH as f64 * size_scale).round() as i32)
        .max(PREFILTER_FLOOR_BACKTRACK_DEPTH);
    // Ambiguity scales with moves - shorter puzzles have fewer decision points
    let min_ambiguity = (BASE_PREFILTER_MIN_DECISION_AMBIGUITY * move_scale).max(1.5);

    // Phase 2 thresholds - scale down for shorter puzzles only
    let min_near_optimal = ((BASE_PREFILTER_MIN_NEAR_OPTIMAL_PATHS as f64 * move_scale).round() as i32)
        .max(4); // Floor of 4 paths
    // Overlap thresholds: relax for shorter puzzles (less room for divergence)
    let overlap_relax = if target_moves < 10 { 1.0 + (10 - target_moves) as f64 * 0.03 } else { 1.0 };
    let max_overlap_best = (BASE_PREFILTER_MAX_PATH_OVERLAP * overlap_relax).min(0.50);
    let max_overlap_avg = (BASE_PREFILTER_MAX_PATH_OVERLAP_AVG * overlap_relax).min(0.80);
    // Early divergence - keep constant
    let min_early_div = BASE_PREFILTER_MIN_EARLY_DIVERGENCE;

    PrefilterThresholds {
        // Counter-intuitive moves - ENABLED
        min_counter_intuitive: ci,
        min_attractive_decoys: 0,  // DISABLED - overlaps with paths/olap
        min_commitment_gates: 0,   // DISABLED - irrelevant with binary lives
        min_false_progress: fp,    // ENABLED - "I was so close!" frustration

        // Path locality - want paths that use moderate area of the map
        min_path_locality: BASE_PREFILTER_MIN_PATH_LOCALITY,
        max_path_locality: BASE_PREFILTER_MAX_PATH_LOCALITY,
        min_direction_changes: min_dir_changes,
        min_backtrack_depth: 0,    // DISABLED - irrelevant with binary lives
        min_decision_ambiguity: min_ambiguity,

        // TIER 1 - Core difficulty
        min_near_optimal_paths: min_near_optimal,
        max_path_overlap_best: max_overlap_best,
        max_path_overlap_avg: max_overlap_avg,
        min_early_divergence: min_early_div,

        // Enabled flags
        ci_enabled: PREFILTER_ENABLE_CI,         // ENABLED - counter-intuitive moves
        dec_enabled: PREFILTER_ENABLE_DEC,       // DISABLED
        gate_enabled: PREFILTER_ENABLE_GATE,     // DISABLED
        fp_enabled: PREFILTER_ENABLE_FP,         // DISABLED per user request
        loc_enabled: PREFILTER_ENABLE_LOC,       // ENABLED
        dir_enabled: PREFILTER_ENABLE_DIR,       // ENABLED
        bt_enabled: PREFILTER_ENABLE_BT,         // DISABLED
        amb_enabled: PREFILTER_ENABLE_AMB,       // ENABLED
        paths_enabled: PREFILTER_ENABLE_PATHS,   // ENABLED
        olap_best_enabled: PREFILTER_ENABLE_OLAP_BEST,  // ENABLED
        olap_avg_enabled: PREFILTER_ENABLE_OLAP_AVG,    // ENABLED
        ediv_enabled: PREFILTER_ENABLE_EDIV,     // ENABLED
    }
}

// =============================================================================
// BASE MAZE GENERATION + UTILITIES
// =============================================================================

fn create_base_maze(width: usize, height: usize, rng: &mut SeededRandom) -> Vec<Vec<TileType>> {
    let mut tiles = vec![vec![TileType::Wall; width]; height];
    let mut visited = new_pos_set(width * height);

    fn carve(
        tiles: &mut Vec<Vec<TileType>>,
        visited: &mut HashSet<Position>,
        x: i32,
        y: i32,
        width: usize,
        height: usize,
        rng: &mut SeededRandom,
    ) {
        let pos = Position { x, y };
        visited.insert(pos);
        tiles[y as usize][x as usize] = TileType::Ice;

        // Step-1 carving for single-wall borders and more open mazes
        let dirs = [(0, -1), (0, 1), (-1, 0), (1, 0)];
        let shuffled = rng.shuffle(&dirs);

        for (dx, dy) in shuffled {
            let nx = x + dx;
            let ny = y + dy;
            let npos = Position { x: nx, y: ny };
            if is_inner(nx, ny, width, height) && !visited.contains(&npos) {
                carve(tiles, visited, nx, ny, width, height, rng);
            }
        }
    }

    // Start from inner position (1 cell from border)
    let start_x = 1 + rng.random_int(0, (width - 2) as i32);
    let start_y = 1 + rng.random_int(0, (height - 2) as i32);
    carve(
        &mut tiles,
        &mut visited,
        start_x,
        start_y,
        width,
        height,
        rng,
    );

    tiles
}

fn widen_passages(
    tiles: &mut Vec<Vec<TileType>>,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    intensity: f64,
) {
    let widen_count = ((width * height) as f64 * intensity).floor() as i32;
    for _ in 0..widen_count {
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        if tiles[y as usize][x as usize] != TileType::Wall {
            continue;
        }
        let mut ice_count = 0;
        if tiles[(y - 1) as usize][x as usize] == TileType::Ice {
            ice_count += 1;
        }
        if tiles[(y + 1) as usize][x as usize] == TileType::Ice {
            ice_count += 1;
        }
        if tiles[y as usize][(x - 1) as usize] == TileType::Ice {
            ice_count += 1;
        }
        if tiles[y as usize][(x + 1) as usize] == TileType::Ice {
            ice_count += 1;
        }
        if ice_count >= 2 {
            tiles[y as usize][x as usize] = TileType::Ice;
        }
    }
}

fn add_stop_blocks(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
    protected: &HashSet<Position>,
) {
    let mut placed = 0;
    let mut attempts = 0;
    let max_attempts = count * 8;

    while placed < count && attempts < max_attempts {
        attempts += 1;
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        let candidate = Position { x, y };
        if tiles[y as usize][x as usize] != TileType::Ice {
            continue;
        }
        if pos_eq(&candidate, start) || pos_eq(&candidate, goal) {
            continue;
        }
        if protected.contains(&candidate) {
            continue;
        }

        tiles[y as usize][x as usize] = TileType::Wall;
        if is_solvable(tiles, start, goal, width, height) {
            placed += 1;
        } else {
            tiles[y as usize][x as usize] = TileType::Ice;
        }
    }
}

fn add_floor_stops(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
    protected: &HashSet<Position>,
) {
    let mut placed = 0;
    let mut attempts = 0;

    while placed < count && attempts < count * 3 {
        attempts += 1;
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        let candidate = Position { x, y };
        if tiles[y as usize][x as usize] != TileType::Ice {
            continue;
        }
        if pos_eq(&candidate, start) || pos_eq(&candidate, goal) {
            continue;
        }
        if protected.contains(&candidate) {
            continue;
        }
        tiles[y as usize][x as usize] = TileType::Ground;
        placed += 1;
    }
}

fn add_ledges(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
    protected: &HashSet<Position>,
) {
    let ledge_options = [
        (Direction::Down, TileType::LedgeUp),
        (Direction::Up, TileType::LedgeDown),
        (Direction::Right, TileType::LedgeLeft),
        (Direction::Left, TileType::LedgeRight),
    ];

    let mut placed = 0;
    let mut attempts = 0;
    let max_attempts = count * 15;

    while placed < count && attempts < max_attempts {
        attempts += 1;
        let x = rng.random_int(3, width as i32 - 3);
        let y = rng.random_int(3, height as i32 - 3);
        let pos = Position { x, y };
        if protected.contains(&pos) {
            continue;
        }
        if tiles[y as usize][x as usize] != TileType::Ice
            && tiles[y as usize][x as usize] != TileType::Ground
        {
            continue;
        }
        if pos_eq(&pos, start) || pos_eq(&pos, goal) {
            continue;
        }

        let (dir, ledge_type) = rng.random_choice(&ledge_options);
        let (dx, dy) = get_delta(dir);
        let entry_x = x - dx;
        let entry_y = y - dy;
        let exit_x = x + dx;
        let exit_y = y + dy;
        if !is_inner(entry_x, entry_y, width, height) || !is_inner(exit_x, exit_y, width, height) {
            continue;
        }
        let entry_tile = tiles[entry_y as usize][entry_x as usize];
        let exit_tile = tiles[exit_y as usize][exit_x as usize];
        if entry_tile == TileType::Wall || exit_tile == TileType::Wall {
            continue;
        }

        let old_tile = tiles[y as usize][x as usize];
        tiles[y as usize][x as usize] = ledge_type;

        if is_solvable(tiles, start, goal, width, height)
            && has_no_stuck_states(tiles, start, goal, width, height)
        {
            placed += 1;
        } else {
            tiles[y as usize][x as usize] = old_tile;
        }
    }
}

fn add_extra_connections(
    tiles: &mut Vec<Vec<TileType>>,
    _start: &Position,
    _goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let mut added = 0;
    let mut attempts = 0;

    while added < count && attempts < count * 5 {
        attempts += 1;
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        if tiles[y as usize][x as usize] != TileType::Wall {
            continue;
        }

        let mut ice_count = 0;
        if is_valid(x, y - 1, width, height) && tiles[(y - 1) as usize][x as usize] == TileType::Ice
        {
            ice_count += 1;
        }
        if is_valid(x, y + 1, width, height) && tiles[(y + 1) as usize][x as usize] == TileType::Ice
        {
            ice_count += 1;
        }
        if is_valid(x - 1, y, width, height) && tiles[y as usize][(x - 1) as usize] == TileType::Ice
        {
            ice_count += 1;
        }
        if is_valid(x + 1, y, width, height) && tiles[y as usize][(x + 1) as usize] == TileType::Ice
        {
            ice_count += 1;
        }

        if ice_count >= 2 {
            tiles[y as usize][x as usize] = TileType::Ice;
            added += 1;
        }
    }
}

fn add_island_obstacles(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let margin = scale_value_for_map(5, width, height, 2);
    let (size_min, size_max) = scale_range_for_map(2, 4, width, height, 1);
    let min_coord = margin;
    let max_coord_x = (width as i32 - margin).max(min_coord + 1);
    let max_coord_y = (height as i32 - margin).max(min_coord + 1);

    for _ in 0..count {
        let cx = rng.random_int(min_coord, max_coord_x);
        let cy = rng.random_int(min_coord, max_coord_y);
        let size = rng.random_int(size_min, size_max);

        let mut to_place: Vec<Position> = Vec::new();
        for dy in -size..=size {
            for dx in -size..=size {
                if dx.abs() + dy.abs() <= size {
                    let x = cx + dx;
                    let y = cy + dy;
                    let pos = Position { x, y };
                    if is_inner(x, y, width, height)
                        && tiles[y as usize][x as usize] == TileType::Ice
                        && !pos_eq(&pos, start)
                        && !pos_eq(&pos, goal)
                    {
                        to_place.push(pos);
                    }
                }
            }
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        for pos in to_place {
            backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
            tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn add_winding_corridors(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) {
    let (seg_min, seg_max) = scale_range_for_map(8, 15, width, height, 2);
    let margin = scale_value_for_map(4, width, height, 2);
    let (len_min_h, len_max_h) = scale_range_for_map(8, 18, width, height, 2);
    let (len_min_v, len_max_v) = scale_range_for_map(8, 16, width, height, 2);
    let (gap_size_min, gap_size_max) = scale_range_for_map(1, 3, width, height, 1);

    let num_segments = rng.random_int(seg_min, seg_max);
    for _ in 0..num_segments {
        let is_horizontal = rng.random() < 0.5;
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        if is_horizontal {
            let min_y = margin;
            let max_y = (height as i32 - margin).max(min_y + 1);
            let y = rng.random_int(min_y, max_y);
            let start_x = rng.random_int(2, ((width as f64 * 0.6) as i32).max(3));
            let length = rng.random_int(len_min_h, len_max_h);
            let gap_pos = rng.random_int(1, (length - 1).max(2));
            let gap_size = rng.random_int(gap_size_min, gap_size_max);

            for i in 0..length {
                let x = start_x + i;
                if i >= gap_pos && i < gap_pos + gap_size {
                    continue;
                }
                if !is_inner(x, y, width, height) {
                    continue;
                }
                let pos = Position { x, y };
                if tiles[y as usize][x as usize] != TileType::Ice {
                    continue;
                }
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }
                backup.push((pos, tiles[y as usize][x as usize]));
                tiles[y as usize][x as usize] = TileType::Wall;
            }
        } else {
            let min_x = margin;
            let max_x = (width as i32 - margin).max(min_x + 1);
            let x = rng.random_int(min_x, max_x);
            let start_y = rng.random_int(2, ((height as f64 * 0.6) as i32).max(3));
            let length = rng.random_int(len_min_v, len_max_v);
            let gap_pos = rng.random_int(1, (length - 1).max(2));
            let gap_size = rng.random_int(gap_size_min, gap_size_max);

            for i in 0..length {
                let y = start_y + i;
                if i >= gap_pos && i < gap_pos + gap_size {
                    continue;
                }
                if !is_inner(x, y, width, height) {
                    continue;
                }
                let pos = Position { x, y };
                if tiles[y as usize][x as usize] != TileType::Ice {
                    continue;
                }
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }
                backup.push((pos, tiles[y as usize][x as usize]));
                tiles[y as usize][x as usize] = TileType::Wall;
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn add_funnel_patterns(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let margin = scale_value_for_map(6, width, height, 2);
    let funnel_radius = scale_value_for_map(3, width, height, 1);
    let min_coord = margin;
    let max_coord_x = (width as i32 - margin).max(min_coord + 1);
    let max_coord_y = (height as i32 - margin).max(min_coord + 1);

    for _ in 0..count {
        let cx = rng.random_int(min_coord, max_coord_x);
        let cy = rng.random_int(min_coord, max_coord_y);
        if tiles[cy as usize][cx as usize] != TileType::Ice {
            continue;
        }
        let center = Position { x: cx, y: cy };
        if pos_eq(&center, start) || pos_eq(&center, goal) {
            continue;
        }

        let funnel_dir = if rng.random() < 0.5 {
            "horizontal"
        } else {
            "vertical"
        };
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        if funnel_dir == "horizontal" {
            for i in 1..=funnel_radius {
                let positions = [
                    Position {
                        x: cx - i,
                        y: cy - i,
                    },
                    Position {
                        x: cx - i,
                        y: cy + i,
                    },
                    Position {
                        x: cx + i,
                        y: cy - i,
                    },
                    Position {
                        x: cx + i,
                        y: cy + i,
                    },
                ];
                for pos in positions {
                    if is_inner(pos.x, pos.y, width, height)
                        && tiles[pos.y as usize][pos.x as usize] == TileType::Ice
                        && !pos_eq(&pos, start)
                        && !pos_eq(&pos, goal)
                    {
                        backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
                        tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
                    }
                }
            }
        } else {
            for i in 1..=funnel_radius {
                let positions = [
                    Position {
                        x: cx - i,
                        y: cy - i,
                    },
                    Position {
                        x: cx + i,
                        y: cy - i,
                    },
                    Position {
                        x: cx - i,
                        y: cy + i,
                    },
                    Position {
                        x: cx + i,
                        y: cy + i,
                    },
                ];
                for pos in positions {
                    if is_inner(pos.x, pos.y, width, height)
                        && tiles[pos.y as usize][pos.x as usize] == TileType::Ice
                        && !pos_eq(&pos, start)
                        && !pos_eq(&pos, goal)
                    {
                        backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
                        tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
                    }
                }
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn add_deceptive_paths(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let initial_path = find_path(tiles, start, goal, width, height);
    if initial_path.is_none() {
        return;
    }
    let initial_path = initial_path.unwrap();
    let mut added = 0;
    let mut attempts = 0;
    let margin = scale_value_for_map(4, width, height, 2);
    let min_coord = margin;
    let max_coord_x = (width as i32 - margin).max(min_coord + 1);
    let max_coord_y = (height as i32 - margin).max(min_coord + 1);

    while added < count && attempts < count * 10 {
        attempts += 1;
        let x = rng.random_int(min_coord, max_coord_x);
        let y = rng.random_int(min_coord, max_coord_y);
        if tiles[y as usize][x as usize] != TileType::Wall {
            continue;
        }

        let mut ice_neighbors = 0;
        for dir in get_all_dirs() {
            let (dx, dy) = get_delta(dir);
            let nx = x + dx;
            let ny = y + dy;
            if is_valid(nx, ny, width, height)
                && (tiles[ny as usize][nx as usize] == TileType::Ice
                    || tiles[ny as usize][nx as usize] == TileType::Ground)
            {
                ice_neighbors += 1;
            }
        }
        if ice_neighbors < 2 {
            continue;
        }

        tiles[y as usize][x as usize] = TileType::Ice;
        let new_path = find_path(tiles, start, goal, width, height);
        if let Some(new_path) = new_path {
            if new_path >= initial_path - 2 {
                added += 1;
            } else {
                tiles[y as usize][x as usize] = TileType::Wall;
            }
        } else {
            tiles[y as usize][x as usize] = TileType::Wall;
        }
    }
}

fn add_trap_alcoves(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let margin = scale_value_for_map(5, width, height, 2);
    let min_coord = margin;
    let max_coord_x = (width as i32 - margin).max(min_coord + 1);
    let max_coord_y = (height as i32 - margin).max(min_coord + 1);
    let back_dist = scale_value_for_map(2, width, height, 1);
    let side_range = scale_value_for_map(2, width, height, 1);

    for _ in 0..count {
        let cx = rng.random_int(min_coord, max_coord_x);
        let cy = rng.random_int(min_coord, max_coord_y);
        let open_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(open_dir);
        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let mut alcove_positions: Vec<Position> = Vec::new();

        let back_x = cx - dx * back_dist;
        let back_y = cy - dy * back_dist;

        if open_dir == Direction::Up || open_dir == Direction::Down {
            for d in -side_range..=0 {
                let dy2 = dy * d;
                let left_pos = Position {
                    x: cx - 1,
                    y: cy + dy2,
                };
                let right_pos = Position {
                    x: cx + 1,
                    y: cy + dy2,
                };
                if is_inner(left_pos.x, left_pos.y, width, height)
                    && tiles[left_pos.y as usize][left_pos.x as usize] == TileType::Ice
                    && !pos_eq(&left_pos, start)
                    && !pos_eq(&left_pos, goal)
                {
                    alcove_positions.push(left_pos);
                }
                if is_inner(right_pos.x, right_pos.y, width, height)
                    && tiles[right_pos.y as usize][right_pos.x as usize] == TileType::Ice
                    && !pos_eq(&right_pos, start)
                    && !pos_eq(&right_pos, goal)
                {
                    alcove_positions.push(right_pos);
                }
            }
            for dx2 in -1..=1 {
                let pos = Position {
                    x: cx + dx2,
                    y: back_y,
                };
                if is_inner(pos.x, pos.y, width, height)
                    && tiles[pos.y as usize][pos.x as usize] == TileType::Ice
                    && !pos_eq(&pos, start)
                    && !pos_eq(&pos, goal)
                {
                    alcove_positions.push(pos);
                }
            }
        } else {
            for d in -side_range..=0 {
                let dx2 = dx * d;
                let top_pos = Position {
                    x: cx + dx2,
                    y: cy - 1,
                };
                let bottom_pos = Position {
                    x: cx + dx2,
                    y: cy + 1,
                };
                if is_inner(top_pos.x, top_pos.y, width, height)
                    && tiles[top_pos.y as usize][top_pos.x as usize] == TileType::Ice
                    && !pos_eq(&top_pos, start)
                    && !pos_eq(&top_pos, goal)
                {
                    alcove_positions.push(top_pos);
                }
                if is_inner(bottom_pos.x, bottom_pos.y, width, height)
                    && tiles[bottom_pos.y as usize][bottom_pos.x as usize] == TileType::Ice
                    && !pos_eq(&bottom_pos, start)
                    && !pos_eq(&bottom_pos, goal)
                {
                    alcove_positions.push(bottom_pos);
                }
            }
            for dy2 in -1..=1 {
                let pos = Position {
                    x: back_x,
                    y: cy + dy2,
                };
                if is_inner(pos.x, pos.y, width, height)
                    && tiles[pos.y as usize][pos.x as usize] == TileType::Ice
                    && !pos_eq(&pos, start)
                    && !pos_eq(&pos, goal)
                {
                    alcove_positions.push(pos);
                }
            }
        }

        for pos in alcove_positions {
            backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
            tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
        }

        if !is_solvable(tiles, start, goal, width, height)
            || !has_no_stuck_states(tiles, start, goal, width, height)
        {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn add_precision_gates(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let margin_small = scale_value_for_map(4, width, height, 2);
    let margin_large = scale_value_for_map(6, width, height, 2);
    let (gate_min, gate_max) = scale_range_for_map(4, 8, width, height, 2);

    for _ in 0..count {
        let is_horizontal = rng.random() < 0.5;
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        if is_horizontal {
            let min_y = margin_small;
            let max_y = (height as i32 - margin_small).max(min_y + 1);
            let min_x = margin_large;
            let max_x = (width as i32 - margin_large).max(min_x + 1);
            let gate_y = rng.random_int(min_y, max_y);
            let gate_x = rng.random_int(min_x, max_x);
            let gate_width = rng.random_int(gate_min, gate_max);
            let gap_pos = rng.random_int(1, (gate_width - 1).max(2));

            for i in 0..gate_width {
                let x = gate_x + i;
                if i == gap_pos || i == gap_pos + 1 {
                    continue;
                }
                if !is_inner(x, gate_y, width, height) {
                    continue;
                }
                let pos = Position { x, y: gate_y };
                if tiles[gate_y as usize][x as usize] != TileType::Ice {
                    continue;
                }
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }
                backup.push((pos, tiles[gate_y as usize][x as usize]));
                tiles[gate_y as usize][x as usize] = TileType::Wall;
            }
        } else {
            let min_x = margin_small;
            let max_x = (width as i32 - margin_small).max(min_x + 1);
            let min_y = margin_large;
            let max_y = (height as i32 - margin_large).max(min_y + 1);
            let gate_x = rng.random_int(min_x, max_x);
            let gate_y = rng.random_int(min_y, max_y);
            let gate_height = rng.random_int(gate_min, gate_max);
            let gap_pos = rng.random_int(1, (gate_height - 1).max(2));

            for i in 0..gate_height {
                let y = gate_y + i;
                if i == gap_pos || i == gap_pos + 1 {
                    continue;
                }
                if !is_inner(gate_x, y, width, height) {
                    continue;
                }
                let pos = Position { x: gate_x, y };
                if tiles[y as usize][gate_x as usize] != TileType::Ice {
                    continue;
                }
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }
                backup.push((pos, tiles[y as usize][gate_x as usize]));
                tiles[y as usize][gate_x as usize] = TileType::Wall;
            }
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

fn convert_floors_to_ice(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    percentage: f64,
) {
    let mut floor_tiles: Vec<Position> = Vec::new();
    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == TileType::Ground
                && !pos_eq(
                    &Position {
                        x: x as i32,
                        y: y as i32,
                    },
                    start,
                )
                && !pos_eq(
                    &Position {
                        x: x as i32,
                        y: y as i32,
                    },
                    goal,
                )
            {
                floor_tiles.push(Position {
                    x: x as i32,
                    y: y as i32,
                });
            }
        }
    }
    let to_convert = rng
        .shuffle(&floor_tiles)
        .into_iter()
        .take((floor_tiles.len() as f64 * percentage) as usize);
    for pos in to_convert {
        tiles[pos.y as usize][pos.x as usize] = TileType::Ice;
    }
}

fn add_dead_end_magnets(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    count: i32,
) {
    let goal_dir = Position {
        x: if goal.x > start.x { 1 } else { -1 },
        y: if goal.y > start.y { 1 } else { -1 },
    };

    let offset_range = scale_value_for_map(8, width, height, 2);
    let margin = scale_value_for_map(6, width, height, 2);
    let magnet_size = scale_value_for_map(3, width, height, 1);
    let far_dist = scale_value_for_map(4, width, height, 1);
    let wall_range = scale_value_for_map(2, width, height, 1);

    for _ in 0..count {
        let mid_x = (start.x + goal.x) / 2;
        let mid_y = (start.y + goal.y) / 2;

        let cx = rng.random_int(
            (mid_x - offset_range).max(2),
            (mid_x + offset_range).min(width as i32 - margin).max(3),
        );
        let cy = rng.random_int(
            (mid_y - offset_range).max(2),
            (mid_y + offset_range).min(height as i32 - margin).max(3),
        );

        if !is_inner(cx, cy, width, height) {
            continue;
        }
        if tiles[cy as usize][cx as usize] != TileType::Ice {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let mut magnet_positions: Vec<Position> = Vec::new();

        for dy in 0..=magnet_size {
            for dx in 0..=magnet_size {
                let x = cx + dx * goal_dir.x;
                let y = cy + dy * goal_dir.y;
                if is_inner(x, y, width, height)
                    && tiles[y as usize][x as usize] == TileType::Wall
                    && !pos_eq(&Position { x, y }, start)
                    && !pos_eq(&Position { x, y }, goal)
                {
                    magnet_positions.push(Position { x, y });
                }
            }
        }

        for pos in magnet_positions {
            backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
            tiles[pos.y as usize][pos.x as usize] = TileType::Ice;
        }

        let mut dead_end_walls: Vec<Position> = Vec::new();
        let far_x = cx + far_dist * goal_dir.x;
        let far_y = cy + far_dist * goal_dir.y;
        for i in -wall_range..=wall_range {
            let block_x = far_x;
            let block_y = far_y + i;
            if is_inner(block_x, block_y, width, height)
                && tiles[block_y as usize][block_x as usize] == TileType::Ice
                && !pos_eq(
                    &Position {
                        x: block_x,
                        y: block_y,
                    },
                    start,
                )
                && !pos_eq(
                    &Position {
                        x: block_x,
                        y: block_y,
                    },
                    goal,
                )
            {
                dead_end_walls.push(Position {
                    x: block_x,
                    y: block_y,
                });
            }

            let block_x2 = far_x + i;
            let block_y2 = far_y;
            if is_inner(block_x2, block_y2, width, height)
                && tiles[block_y2 as usize][block_x2 as usize] == TileType::Ice
                && !pos_eq(
                    &Position {
                        x: block_x2,
                        y: block_y2,
                    },
                    start,
                )
                && !pos_eq(
                    &Position {
                        x: block_x2,
                        y: block_y2,
                    },
                    goal,
                )
            {
                dead_end_walls.push(Position {
                    x: block_x2,
                    y: block_y2,
                });
            }
        }

        for pos in dead_end_walls {
            backup.push((pos, tiles[pos.y as usize][pos.x as usize]));
            tiles[pos.y as usize][pos.x as usize] = TileType::Wall;
        }

        if !is_solvable(tiles, start, goal, width, height) {
            for (pos, tile) in backup {
                tiles[pos.y as usize][pos.x as usize] = tile;
            }
        }
    }
}

/// Create early path forks to increase path diversity and lower overlap.
/// This trap specifically targets the metrics we care about most:
/// - More near-optimal paths
/// - Lower path overlap (different routes don't share cells)
/// - Earlier divergence

/// Create multiple independent corridors that reach the goal area.
/// Create multiple independent corridors that reach the goal area.

/// Compute required optimal moves based on map size.
/// Reference: 10 moves for a 15x15 map, scales linearly with smaller dimension.
fn compute_required_moves(width: usize, height: usize) -> i32 {
    let min_dim = width.min(height) as f64;
    // 10 moves for 15x15, scaling linearly. Floor of 6 moves minimum.
    ((10.0 * min_dim / 15.0).round() as i32).max(6)
}

// =============================================================================
// CHAOS TRAP APPLICATION
// =============================================================================
// Randomly select and order trap functions for increased puzzle diversity

/// Trap function identifiers for random selection
#[derive(Clone, Copy, Debug)]
enum TrapFunction {
    AlmostThere,
    DecoyOpenAreas,
    HiddenChokePoints,
    MomentumTraps,
    AntiGradientZones,
    ParallelPathIllusion,
    LedgeMisdirection,
    GoalProximityDeadEnds,
    CommitmentTraps,
    PrecisionGates,
    FunnelPatterns,
    TrapAlcoves,
    DeceptivePaths,
    DeadEndMagnets,
}

impl TrapFunction {
    fn index(&self) -> usize {
        match self {
            TrapFunction::AlmostThere => 0,
            TrapFunction::DecoyOpenAreas => 1,
            TrapFunction::HiddenChokePoints => 2,
            TrapFunction::MomentumTraps => 3,
            TrapFunction::AntiGradientZones => 4,
            TrapFunction::ParallelPathIllusion => 5,
            TrapFunction::LedgeMisdirection => 6,
            TrapFunction::GoalProximityDeadEnds => 7,
            TrapFunction::CommitmentTraps => 8,
            TrapFunction::PrecisionGates => 9,
            TrapFunction::FunnelPatterns => 10,
            TrapFunction::TrapAlcoves => 11,
            TrapFunction::DeceptivePaths => 12,
            TrapFunction::DeadEndMagnets => 13,
        }
    }

    fn short_name(&self) -> &'static str {
        match self {
            TrapFunction::AlmostThere => "almost",
            TrapFunction::DecoyOpenAreas => "decoy",
            TrapFunction::HiddenChokePoints => "choke",
            TrapFunction::MomentumTraps => "momentum",
            TrapFunction::AntiGradientZones => "antigrad",
            TrapFunction::ParallelPathIllusion => "parallel",
            TrapFunction::LedgeMisdirection => "ledge",
            TrapFunction::GoalProximityDeadEnds => "goalprox",
            TrapFunction::CommitmentTraps => "commit",
            TrapFunction::PrecisionGates => "precision",
            TrapFunction::FunnelPatterns => "funnel",
            TrapFunction::TrapAlcoves => "alcove",
            TrapFunction::DeceptivePaths => "deceptive",
            TrapFunction::DeadEndMagnets => "deadend",
        }
    }
}

/// All available trap functions
const ALL_TRAPS: [TrapFunction; 14] = [
    TrapFunction::AlmostThere,
    TrapFunction::DecoyOpenAreas,
    TrapFunction::HiddenChokePoints,
    TrapFunction::MomentumTraps,
    TrapFunction::AntiGradientZones,
    TrapFunction::ParallelPathIllusion,
    TrapFunction::LedgeMisdirection,
    TrapFunction::GoalProximityDeadEnds,
    TrapFunction::CommitmentTraps,
    TrapFunction::PrecisionGates,
    TrapFunction::FunnelPatterns,
    TrapFunction::TrapAlcoves,
    TrapFunction::DeceptivePaths,
    TrapFunction::DeadEndMagnets,
];

/// Apply trap functions with randomization for increased diversity
/// - Randomly skips some traps (50-100% of traps run)
/// - Randomizes order of trap execution
/// - Varies count ranges by ±50%
/// Returns list of applied trap short names
fn apply_chaos_traps(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    ctx: &GenerationContext,
    rng: &mut SeededRandom,
    scale_range: impl Fn(i32, i32) -> (i32, i32),
    _protected: &mut HashSet<Position>,
) -> Vec<String> {
    let mut applied_traps: Vec<String> = Vec::new();
    
    let trap_pool: Vec<TrapFunction> = ALL_TRAPS.to_vec();

    // Shuffle trap order for variety
    let shuffled_traps = rng.shuffle(&trap_pool);
    
    // Randomly determine how many traps to run (50-100% of all traps)
    let min_traps = (trap_pool.len() as f64 * 0.5).ceil() as usize;
    let max_traps = trap_pool.len();
    let num_traps = rng.random_int(min_traps as i32, max_traps as i32 + 1) as usize;
    
    // Apply random count variance (±50%)
    let vary_count = |rng: &mut SeededRandom, min: i32, max: i32| -> i32 {
        let base = rng.random_int(min, max);
        let variance = (base as f64 * 0.5) as i32;
        let adjusted = base + rng.random_int(-variance, variance + 1);
        adjusted.max(1)
    };
    
    // First pass: Apply selected traps
    for trap in shuffled_traps.into_iter().take(num_traps) {
        applied_traps.push(trap.short_name().to_string());
        match trap {
            TrapFunction::AlmostThere => {
                let (min, max) = scale_range(2, 5);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_almost_there_traps(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::DecoyOpenAreas => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_decoy_open_areas(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::HiddenChokePoints => {
                let (min, max) = scale_range(2, 5);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_hidden_choke_points(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::MomentumTraps => {
                let (min, max) = scale_range(4, 8);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_momentum_traps(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::AntiGradientZones => {
                let (min, max) = scale_range(2, 5);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_anti_gradient_zones(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::ParallelPathIllusion => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_parallel_path_illusion(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::LedgeMisdirection => {
                let (min, max) = scale_range(5, 9);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_ledge_misdirection(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::GoalProximityDeadEnds => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_goal_proximity_dead_ends(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::CommitmentTraps => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                create_commitment_traps(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::PrecisionGates => {
                let (min, max) = scale_range(4, 8);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                add_precision_gates(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::FunnelPatterns => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                add_funnel_patterns(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::TrapAlcoves => {
                let (min, max) = scale_range(5, 9);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                add_trap_alcoves(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::DeceptivePaths => {
                let (min, max) = scale_range(8, 15);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                add_deceptive_paths(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
            TrapFunction::DeadEndMagnets => {
                let (min, max) = scale_range(3, 6);
                let count = vary_count(rng, min, max);
                let t = Instant::now();
                add_dead_end_magnets(tiles, start, goal, width, height, rng, count);
                ctx.record_trap_time(trap, t.elapsed().as_micros() as u64);
            }
        }
    }
    
    // WILD CARD PASS: 50% chance to apply 1-2 additional random traps
    // This creates more complex interactions between trap types
    if rng.random() < 0.5 {
        let wild_card_count = rng.random_int(1, 3);
        for _ in 0..wild_card_count {
            let wild_trap = rng.random_choice(&trap_pool);
            applied_traps.push(format!("{}*", wild_trap.short_name())); // * marks wild card
            match wild_trap {
                TrapFunction::AlmostThere => {
                    let count = vary_count(rng, 1, 3);
                    let t = Instant::now();
                    create_almost_there_traps(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::DecoyOpenAreas => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    create_decoy_open_areas(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::HiddenChokePoints => {
                    let count = vary_count(rng, 1, 3);
                    let t = Instant::now();
                    create_hidden_choke_points(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::MomentumTraps => {
                    let count = vary_count(rng, 2, 5);
                    let t = Instant::now();
                    create_momentum_traps(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::AntiGradientZones => {
                    let count = vary_count(rng, 1, 3);
                    let t = Instant::now();
                    create_anti_gradient_zones(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::ParallelPathIllusion => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    create_parallel_path_illusion(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::LedgeMisdirection => {
                    let count = vary_count(rng, 3, 6);
                    let t = Instant::now();
                    create_ledge_misdirection(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::GoalProximityDeadEnds => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    create_goal_proximity_dead_ends(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::CommitmentTraps => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    create_commitment_traps(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::PrecisionGates => {
                    let count = vary_count(rng, 2, 5);
                    let t = Instant::now();
                    add_precision_gates(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::FunnelPatterns => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    add_funnel_patterns(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::TrapAlcoves => {
                    let count = vary_count(rng, 3, 6);
                    let t = Instant::now();
                    add_trap_alcoves(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::DeceptivePaths => {
                    let count = vary_count(rng, 4, 8);
                    let t = Instant::now();
                    add_deceptive_paths(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
                TrapFunction::DeadEndMagnets => {
                    let count = vary_count(rng, 2, 4);
                    let t = Instant::now();
                    add_dead_end_magnets(tiles, start, goal, width, height, rng, count);
                    ctx.record_trap_time(wild_trap, t.elapsed().as_micros() as u64);
                }
            }
        }
    }
    
    applied_traps
}

// =============================================================================
// MAIN GENERATION
// =============================================================================

fn pick_size(rng: &mut SeededRandom) -> (usize, usize) {
    rng.random_choice(&SIZE_OPTIONS)
}

#[allow(unused_variables)]
pub fn generate_puzzle(seed: &str, config: &GenerationConfig) -> PuzzleData {
    generate_puzzle_with_cancel(seed, config, None).expect("uncancelable generation should not fail")
}

pub fn generate_puzzle_with_cancel(
    seed: &str,
    config: &GenerationConfig,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> Result<PuzzleData, ()> {
    // Create per-run context for isolated tracking
    let ctx = Arc::new(GenerationContext::new(seed));
    let run_id = &ctx.run_id;

    // Log generation start with run identifier
    let num_threads = rayon::current_num_threads();
    info!("[{}] ━━━ Starting generation ━━━", run_id);
    info!("[{}] seed={} threads={}", run_id, seed, num_threads);

    let (width, height) = {
        let mut rng = SeededRandom::new(seed);
        pick_size(&mut rng)
    };

    // Use config override if set, otherwise compute from map size
    let required_optimal_moves = config.target_moves.unwrap_or_else(|| compute_required_moves(width, height));
    // Compute scaled parameters for this map size AND target moves
    let prefilter_thresholds = compute_prefilter_thresholds(width, height, required_optimal_moves);

    info!(
        "[{}] map={}x{} target_moves={} batch_size={}",
        run_id, width, height, required_optimal_moves, BATCH_SIZE
    );
    info!(
        "[{}] thresholds: {}",
        run_id,
        prefilter_thresholds.format_thresholds(),
    );

    let mut batch = config.start_batch;
    if batch > 0 {
        info!("[{}] Resuming from batch {}", run_id, batch);
    }
    let is_cancelled = |flag: &Option<Arc<AtomicBool>>| -> bool {
        flag.as_ref()
            .map(|f| f.load(Ordering::Relaxed))
            .unwrap_or(false)
    };

    loop {
        if is_cancelled(&cancel_flag) {
            info!("[{}] ✋ Cancelled before batch {}", run_id, batch);
            return Err(());
        }

        let batch_start = batch * BATCH_SIZE;
        let batch_end = batch_start + BATCH_SIZE;

        // Scale factor for generation parameters based on map size (reference: 35x35)
        let gen_scale = (width.min(height) as f64) / 35.0;
        let scale_range = |min: i32, max: i32| -> (i32, i32) {
            let scaled_min = ((min as f64 * gen_scale).round() as i32).max(1);
            let scaled_max = ((max as f64 * gen_scale).round() as i32).max(scaled_min + 1);
            (scaled_min, scaled_max)
        };

        // Clone context Arc for use in parallel closure
        let ctx_clone = ctx.clone();
        let prefilter_thresholds_clone = prefilter_thresholds.clone();

        // Generate puzzles in parallel (native) or sequential (WASM)
        let cancel_flag_inner = cancel_flag.clone();
        let batch_best = find_best_in_range("batch", batch_start..batch_end, |attempt| {
            if is_cancelled(&cancel_flag_inner) {
                return None;
            }

            let t_start = Instant::now();
            
            let mut attempt_rng = SeededRandom::new(&format!("{}-{}", seed, attempt));
            let mut tiles = create_base_maze(width, height, &mut attempt_rng);
            let mut protected_cells = new_pos_set(width * height);
            
            let t_base = t_start.elapsed();

            let mut ice_tiles: Vec<Position> = Vec::new();
            for y in 1..height - 1 {
                for x in 1..width - 1 {
                    if tiles[y][x] == TileType::Ice {
                        ice_tiles.push(Position {
                            x: x as i32,
                            y: y as i32,
                        });
                    }
                }
            }

            // Scale minimum ice tiles requirement for small maps
            let min_ice_tiles =
                ((20.0 * (width.min(height) as f64 / 35.0).powi(2)) as usize).max(8);
            if ice_tiles.len() < min_ice_tiles {
                return None;
            }

            // Select placement strategy and start/goal positions
            // ========== SIMPLIFIED: Skip branch-friendly selection, use random placement ==========
            let (start, goal, strategy) = {
                let fallback_strategy = select_placement_strategy(&mut attempt_rng);
                match select_start_goal(&ice_tiles, width, height, fallback_strategy, &mut attempt_rng) {
                    Some((start, goal)) => (start, goal, fallback_strategy),
                    None => return None,
                }
            };

            // CHAOS: Randomize passage widening intensity (10-35% instead of fixed 20%)
            let widen_intensity = 0.10 + attempt_rng.random() * 0.25;
            widen_passages(&mut tiles, width, height, &mut attempt_rng, widen_intensity);
            
            let (ec_min, ec_max) = scale_range(35, 60);
            let extra_connections = attempt_rng.random_int(ec_min, ec_max);
            add_extra_connections(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                extra_connections,
            );
            
            // CHAOS: Randomly add 0-5 winding corridors (was 1-3)
            let winding_count = attempt_rng.random_int(0, 6);
            for _ in 0..winding_count {
                add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            }
            
            let (isl_min, isl_max) = scale_range(10, 18);
            let island_count = attempt_rng.random_int(isl_min, isl_max);
            add_island_obstacles(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                island_count,
            );

            // Split stop block placement into pre/post trap phases so we can preserve branching.
            let (stb_min, stb_max) = scale_range(20, 45);
            let stop_blocks = attempt_rng.random_int(stb_min, stb_max);
            let early_stop_blocks = ((stop_blocks as f64) * 0.30).round() as i32;
            let mut late_stop_blocks = stop_blocks - early_stop_blocks;
            if early_stop_blocks > 0 {
                add_stop_blocks(
                    &mut tiles,
                    &start,
                    &goal,
                    width,
                    height,
                    &mut attempt_rng,
                    early_stop_blocks,
                    &protected_cells,
                );
            }

            engineer_counter_intuitive_path(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
            );

            let t_pre_traps = Instant::now();
            
            // Apply trap functions with randomized selection and ordering
            let applied_traps = apply_chaos_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &ctx_clone,
                &mut attempt_rng,
                scale_range,
                &mut protected_cells,
            );

            if late_stop_blocks < 0 {
                late_stop_blocks = 0;
            }
            if late_stop_blocks > 0 {
                add_stop_blocks(
                    &mut tiles,
                    &start,
                    &goal,
                    width,
                    height,
                    &mut attempt_rng,
                    late_stop_blocks,
                    &protected_cells,
                );
            }
            
            // Always apply these structural elements (not randomized)
            let (fls_min, fls_max) = scale_range(2, 4);
            let floor_stops = attempt_rng.random_int(fls_min, fls_max);
            add_floor_stops(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                floor_stops,
                &protected_cells,
            );
            convert_floors_to_ice(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                0.82,
            );
            let (ldg_min, ldg_max) = scale_range(20, 35);
            let ledge_count = attempt_rng.random_int(ldg_min, ldg_max);
            add_ledges(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                ledge_count,
                &protected_cells,
            );

            let t_traps = t_pre_traps.elapsed();

            tiles[start.y as usize][start.x as usize] = TileType::Start;
            tiles[goal.y as usize][goal.x as usize] = TileType::Goal;

            let optimal_path = find_optimal_path(&tiles, &start, &goal, width, height)?;
            if !has_no_stuck_states(&tiles, &start, &goal, width, height) {
                return None;
            }
            let optimal_moves = (optimal_path.len() - 1) as i32;
            if optimal_moves != required_optimal_moves {
                return None;
            }
            
            // FAST EARLY BAILOUT: Check unique optimal path first (32% fail rate)
            // This avoids expensive psych score calculation for ~1/3 of candidates
            if !has_unique_optimal_path(&tiles, &start, &goal, width, height, optimal_moves) {
                ctx_clone.total_checked.fetch_add(1, Ordering::Relaxed);
                ctx_clone.fail_unique_opt.fetch_add(1, Ordering::Relaxed);
                return None;
            }

            let t_pre_psych = Instant::now();
            let (psych_metrics, psych_timing) = calculate_psychology_score_timed(&tiles, &start, &goal, width, height);
            let t_psych = t_pre_psych.elapsed();
            
            // Record timing stats
            ctx_clone.time_base_maze_us.fetch_add(t_base.as_micros() as u64, Ordering::Relaxed);
            ctx_clone.time_traps_us.fetch_add(t_traps.as_micros() as u64, Ordering::Relaxed);
            ctx_clone.time_psych_score_us.fetch_add(t_psych.as_micros() as u64, Ordering::Relaxed);
            ctx_clone.time_find_path_us.fetch_add(psych_timing.find_path_us, Ordering::Relaxed);
            ctx_clone.time_count_paths_us.fetch_add(psych_timing.count_paths_us, Ordering::Relaxed);
            ctx_clone.time_overlap_us.fetch_add(psych_timing.overlap_us, Ordering::Relaxed);
            
            // Track which prefilters fail (using per-run context)
            ctx_clone.total_checked.fetch_add(1, Ordering::Relaxed);
            let passed = {
                // unique_opt already checked via early bailout above
                let pass_unique_opt = true; // Already verified by has_unique_optimal_path
                
                let pass_ci = psych_metrics.counter_intuitive_moves >= prefilter_thresholds_clone.min_counter_intuitive;
                let pass_dec = psych_metrics.attractive_decoys >= prefilter_thresholds_clone.min_attractive_decoys;
                let pass_gate = psych_metrics.commitment_gates >= prefilter_thresholds_clone.min_commitment_gates;
                let pass_fp = psych_metrics.false_progress_paths >= prefilter_thresholds_clone.min_false_progress;
                let pass_loc = psych_metrics.path_locality >= prefilter_thresholds_clone.min_path_locality 
                    && psych_metrics.path_locality <= prefilter_thresholds_clone.max_path_locality;
                let pass_dir = psych_metrics.direction_changes >= prefilter_thresholds_clone.min_direction_changes;
                let pass_bt = psych_metrics.backtrack_depth >= prefilter_thresholds_clone.min_backtrack_depth;
                let pass_amb = psych_metrics.decision_ambiguity >= prefilter_thresholds_clone.min_decision_ambiguity;
                let pass_paths = psych_metrics.near_optimal_paths >= prefilter_thresholds_clone.min_near_optimal_paths;
                let pass_olap_best = if prefilter_thresholds_clone.olap_best_enabled {
                    psych_metrics.path_overlap <= prefilter_thresholds_clone.max_path_overlap_best
                } else {
                    true
                };
                let pass_olap_avg = psych_metrics.path_overlap_avg <= prefilter_thresholds_clone.max_path_overlap_avg;
                let pass_ediv = psych_metrics.early_divergence >= prefilter_thresholds_clone.min_early_divergence;

                // Note: fail_unique_opt already counted in early bailout
                if !pass_ci { ctx_clone.fail_ci.fetch_add(1, Ordering::Relaxed); }
                if !pass_dec { ctx_clone.fail_dec.fetch_add(1, Ordering::Relaxed); }
                if !pass_gate { ctx_clone.fail_gate.fetch_add(1, Ordering::Relaxed); }
                if !pass_fp { ctx_clone.fail_fp.fetch_add(1, Ordering::Relaxed); }
                if !pass_loc { ctx_clone.fail_loc.fetch_add(1, Ordering::Relaxed); }
                if !pass_dir { ctx_clone.fail_dir.fetch_add(1, Ordering::Relaxed); }
                if !pass_bt { ctx_clone.fail_bt.fetch_add(1, Ordering::Relaxed); }
                if !pass_amb { ctx_clone.fail_amb.fetch_add(1, Ordering::Relaxed); }
                if !pass_paths { ctx_clone.fail_paths.fetch_add(1, Ordering::Relaxed); }
                if prefilter_thresholds_clone.olap_best_enabled && !pass_olap_best {
                    ctx_clone.fail_olap_best.fetch_add(1, Ordering::Relaxed);
                }
                if !pass_olap_avg { ctx_clone.fail_olap_avg.fetch_add(1, Ordering::Relaxed); }
                if !pass_ediv { ctx_clone.fail_ediv.fetch_add(1, Ordering::Relaxed); }

                // Calculate closeness score for tracking (only for puzzles with unique optimal path)
                // Higher score = closer to passing all thresholds
                // For "min X" thresholds: ratio = actual / threshold (capped at 1.0)
                // For "max X" thresholds: ratio = threshold / actual (capped at 1.0)
                // Only include ENABLED metrics in the calculation
                let closeness = if pass_unique_opt {
                    let mut ratios: Vec<f64> = Vec::new();
                    
                    // Add ratios only for enabled metrics
                    if prefilter_thresholds_clone.ci_enabled && prefilter_thresholds_clone.min_counter_intuitive > 0 {
                        ratios.push((psych_metrics.counter_intuitive_moves as f64 / prefilter_thresholds_clone.min_counter_intuitive as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.dec_enabled && prefilter_thresholds_clone.min_attractive_decoys > 0 {
                        ratios.push((psych_metrics.attractive_decoys as f64 / prefilter_thresholds_clone.min_attractive_decoys as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.gate_enabled && prefilter_thresholds_clone.min_commitment_gates > 0 {
                        ratios.push((psych_metrics.commitment_gates as f64 / prefilter_thresholds_clone.min_commitment_gates as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.fp_enabled && prefilter_thresholds_clone.min_false_progress > 0 {
                        ratios.push((psych_metrics.false_progress_paths as f64 / prefilter_thresholds_clone.min_false_progress as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.loc_enabled {
                        let loc_ratio = if psych_metrics.path_locality < prefilter_thresholds_clone.min_path_locality {
                            psych_metrics.path_locality / prefilter_thresholds_clone.min_path_locality
                        } else if psych_metrics.path_locality > prefilter_thresholds_clone.max_path_locality {
                            prefilter_thresholds_clone.max_path_locality / psych_metrics.path_locality
                        } else {
                            1.0  // In range = perfect
                        };
                        ratios.push(loc_ratio);
                    }
                    if prefilter_thresholds_clone.dir_enabled && prefilter_thresholds_clone.min_direction_changes > 0 {
                        ratios.push((psych_metrics.direction_changes as f64 / prefilter_thresholds_clone.min_direction_changes as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.bt_enabled && prefilter_thresholds_clone.min_backtrack_depth > 0 {
                        ratios.push((psych_metrics.backtrack_depth as f64 / prefilter_thresholds_clone.min_backtrack_depth as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.amb_enabled && prefilter_thresholds_clone.min_decision_ambiguity > 0.0 {
                        ratios.push((psych_metrics.decision_ambiguity / prefilter_thresholds_clone.min_decision_ambiguity).min(1.0));
                    }
                    if prefilter_thresholds_clone.paths_enabled && prefilter_thresholds_clone.min_near_optimal_paths > 0 {
                        ratios.push((psych_metrics.near_optimal_paths as f64 / prefilter_thresholds_clone.min_near_optimal_paths as f64).min(1.0));
                    }
                    if prefilter_thresholds_clone.olap_best_enabled && psych_metrics.path_overlap > 0.0 {
                        ratios.push((prefilter_thresholds_clone.max_path_overlap_best / psych_metrics.path_overlap).min(1.0));
                    }
                    if prefilter_thresholds_clone.olap_avg_enabled && psych_metrics.path_overlap_avg > 0.0 {
                        ratios.push((prefilter_thresholds_clone.max_path_overlap_avg / psych_metrics.path_overlap_avg).min(1.0));
                    }
                    if prefilter_thresholds_clone.ediv_enabled && prefilter_thresholds_clone.min_early_divergence > 0.0 {
                        ratios.push((psych_metrics.early_divergence / prefilter_thresholds_clone.min_early_divergence).min(1.0));
                    }
                    
                    // Geometric mean of all enabled ratios
                    let score = if ratios.is_empty() {
                        1.0
                    } else {
                        let product: f64 = ratios.iter().product();
                        product.powf(1.0 / ratios.len() as f64)
                    };
                    
                    // Build metrics list dynamically based on enabled filters
                    let mut metrics: Vec<MetricInfo> = Vec::new();
                    
                    if prefilter_thresholds_clone.ci_enabled {
                        metrics.push(MetricInfo {
                            name: "ci".to_string(),
                            value: psych_metrics.counter_intuitive_moves as f64,
                            threshold: prefilter_thresholds_clone.min_counter_intuitive as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.dec_enabled {
                        metrics.push(MetricInfo {
                            name: "dec".to_string(),
                            value: psych_metrics.attractive_decoys as f64,
                            threshold: prefilter_thresholds_clone.min_attractive_decoys as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.gate_enabled {
                        metrics.push(MetricInfo {
                            name: "gate".to_string(),
                            value: psych_metrics.commitment_gates as f64,
                            threshold: prefilter_thresholds_clone.min_commitment_gates as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.fp_enabled {
                        metrics.push(MetricInfo {
                            name: "fp".to_string(),
                            value: psych_metrics.false_progress_paths as f64,
                            threshold: prefilter_thresholds_clone.min_false_progress as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.loc_enabled {
                        metrics.push(MetricInfo {
                            name: "loc".to_string(),
                            value: psych_metrics.path_locality,
                            threshold: prefilter_thresholds_clone.min_path_locality,
                            threshold_max: Some(prefilter_thresholds_clone.max_path_locality),
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.dir_enabled {
                        metrics.push(MetricInfo {
                            name: "dir".to_string(),
                            value: psych_metrics.direction_changes as f64,
                            threshold: prefilter_thresholds_clone.min_direction_changes as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.bt_enabled {
                        metrics.push(MetricInfo {
                            name: "bt".to_string(),
                            value: psych_metrics.backtrack_depth as f64,
                            threshold: prefilter_thresholds_clone.min_backtrack_depth as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.amb_enabled {
                        metrics.push(MetricInfo {
                            name: "amb".to_string(),
                            value: psych_metrics.decision_ambiguity,
                            threshold: prefilter_thresholds_clone.min_decision_ambiguity,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.paths_enabled {
                        metrics.push(MetricInfo {
                            name: "paths".to_string(),
                            value: psych_metrics.near_optimal_paths as f64,
                            threshold: prefilter_thresholds_clone.min_near_optimal_paths as f64,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    if prefilter_thresholds_clone.olap_best_enabled {
                        metrics.push(MetricInfo {
                            name: "olap_best".to_string(),
                            value: psych_metrics.path_overlap,
                            threshold: prefilter_thresholds_clone.max_path_overlap_best,
                            threshold_max: None,
                            is_max_threshold: true,
                        });
                    }
                    if prefilter_thresholds_clone.olap_avg_enabled {
                        metrics.push(MetricInfo {
                            name: "olap_avg".to_string(),
                            value: psych_metrics.path_overlap_avg,
                            threshold: prefilter_thresholds_clone.max_path_overlap_avg,
                            threshold_max: None,
                            is_max_threshold: true,
                        });
                    }
                    if prefilter_thresholds_clone.ediv_enabled {
                        metrics.push(MetricInfo {
                            name: "ediv".to_string(),
                            value: psych_metrics.early_divergence,
                            threshold: prefilter_thresholds_clone.min_early_divergence,
                            threshold_max: None,
                            is_max_threshold: false,
                        });
                    }
                    
                    // Update closest puzzle in context
                    ctx_clone.update_closest(ClosestPuzzleInfo {
                        closeness: score,
                        metrics,
                        traps: applied_traps.clone(),
                    });
                    
                    score
                } else {
                    0.0 // No closeness score without unique optimal path
                };

                // Accept puzzle if either:
                // 1. All thresholds pass, OR
                // 2. Closeness score is >= 1.0 (perfect match only)
                let passes_all_thresholds = pass_unique_opt && pass_ci && pass_dec && pass_gate && pass_fp && pass_loc && pass_dir && pass_bt && pass_amb && pass_paths && pass_olap_best && pass_olap_avg && pass_ediv;
                let passes_closeness_threshold = pass_unique_opt && closeness >= config.closeness_threshold;
                
                passes_all_thresholds || passes_closeness_threshold
            };
            
            if !passed {
                return None;
            }
            // Apply strategy-specific bonus for placement diversity
            let base_score = psych_metrics.psychology_score;
            let score = base_score + get_strategy_bonus(strategy);

            let puzzle = PuzzleData {
                width,
                height,
                tiles: tiles
                    .iter()
                    .map(|row| row.iter().map(|t| *t as u8).collect())
                    .collect(),
                start,
                goal,
                optimal_moves,
                solution_path: Some(optimal_path),
                map_type: MapType::Ice,
                difficulty_score: Some(base_score.round() as i32), // Store base score without bonus
                selected_batch: None, // Will be set when puzzle is selected
                // Original metrics (Phase 0)
                counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
                attractive_decoys: Some(psych_metrics.attractive_decoys),
                commitment_gates: Some(psych_metrics.commitment_gates),
                false_progress_paths: Some(psych_metrics.false_progress_paths),
                // Path structure metrics (Phase 1)
                path_locality: Some(psych_metrics.path_locality),
                direction_changes: Some(psych_metrics.direction_changes),
                backtrack_depth: Some(psych_metrics.backtrack_depth),
                decision_ambiguity: Some(psych_metrics.decision_ambiguity),
                // Path diversity metrics (Phase 2)
                near_optimal_paths: Some(psych_metrics.near_optimal_paths),
                path_overlap: if PREFILTER_ENABLE_OLAP_BEST { Some(psych_metrics.path_overlap) } else { None },
                path_overlap_avg: Some(psych_metrics.path_overlap_avg),
                early_divergence: Some(psych_metrics.early_divergence),
            };

            Some(((puzzle, applied_traps), score))
        });

        // Check if we found a puzzle meeting the prefilter thresholds
        // Note: If prefilters pass, psychology_score is guaranteed to be high enough
        // (minimum ~1505 for 15x15, far exceeds TARGET_PSYCHOLOGY_SCORE of 800)
        if let Some(((mut puzzle, traps), _score)) = batch_best.clone() {
            if puzzle
                .counter_intuitive_moves
                .map_or(false, |v| v >= prefilter_thresholds.min_counter_intuitive)
                && puzzle
                    .attractive_decoys
                    .map_or(false, |v| v >= prefilter_thresholds.min_attractive_decoys)
                && puzzle
                    .commitment_gates
                    .map_or(false, |v| v >= prefilter_thresholds.min_commitment_gates)
            {
                puzzle.selected_batch = Some(batch);
                info!(
                    "[{}] ✓ FOUND at batch {} │ {}",
                    run_id,
                    batch,
                    prefilter_thresholds.format_puzzle(&puzzle, &traps),
                );
                info!("[{}] ━━━ Generation complete ━━━", run_id);
                return Ok(puzzle);
            }
        }

        // If we found any valid puzzle, return it
        if let Some(((mut puzzle, traps), _score)) = batch_best {
            puzzle.selected_batch = Some(batch);
            info!(
                "[{}] ✓ FOUND (fallback) at batch {} │ {}",
                run_id,
                batch,
                prefilter_thresholds.format_puzzle(&puzzle, &traps),
            );
            info!("[{}] ━━━ Generation complete ━━━", run_id);
            return Ok(puzzle);
        }

        // Log progress every 10 batches
        if batch > 0 && batch % 10 == 0 {
            let fail_rates = ctx.format_fail_rates(&prefilter_thresholds);
            info!("[{}] batch {} │ {}", run_id, batch, fail_rates);
            
            // Log closest puzzle metrics
            if let Some(closest_str) = ctx.format_closest(&prefilter_thresholds) {
                info!("[{}]   └─ closest: {}", run_id, closest_str);
            }
            
            // Log timing every 50 batches (debug level)
            if batch % 50 == 0 {
                debug!("[{}]   └─ timing: {}", run_id, ctx.format_timing());
                debug!("[{}]   └─ trap timing: {}", run_id, ctx.format_trap_timing());
            }
        }

        batch += 1;
    }
}
