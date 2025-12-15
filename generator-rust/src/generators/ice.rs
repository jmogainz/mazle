// Fast, deterministic hashing for tight puzzle loops
use rustc_hash::{FxHashMap as HashMap, FxHashSet as HashSet};

// Rayon for parallel processing (works on both native and WASM with wasm-bindgen-rayon)
use crate::types::{Direction, GenerationConfig, MapType, Position, PuzzleData, TileType};
use log::{debug, info, trace};
use rayon::prelude::*;

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

const TARGET_PSYCHOLOGY_SCORE: f64 = 800.0;
const TRADITIONAL_ATTEMPTS: usize = 10000;

const SIZE_OPTIONS: [(usize, usize); 1] = [(15, 15)];

// =============================================================================
// PSYCHOLOGY SCORING WEIGHTS
// =============================================================================
// Balanced distribution across 11 metrics for puzzle variety while maintaining difficulty

// Original metrics (keep for baseline difficulty)
const WEIGHT_COUNTER_INTUITIVE: f64 = 50.0;   // Moves away from goal
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 40.0;   // Tempting wrong moves
const WEIGHT_COMMITMENT_GATES: f64 = 80.0;    // Costly wrong decisions
const WEIGHT_FALSE_PROGRESS: f64 = 50.0;      // Deceptive progress paths

// Path structure metrics (Phase 1 - rebalanced)
const WEIGHT_PATH_LOCALITY: f64 = 120.0;      // Concentrated vs spread path (REDUCED from 350)
const WEIGHT_DIRECTION_CHANGES: f64 = 60.0;   // Zigzag complexity
const WEIGHT_BACKTRACK_DEPTH: f64 = 50.0;     // Going wrong way distance
const WEIGHT_DECISION_AMBIGUITY: f64 = 70.0;  // Choice paralysis at each step

// Path diversity metrics (Phase 2 - NEW)
const WEIGHT_NEAR_OPTIMAL_PATHS: f64 = 25.0;  // Per alternative path found
const WEIGHT_PATH_OVERLAP: f64 = 100.0;       // Structural similarity of alternatives
const WEIGHT_EARLY_DIVERGENCE: f64 = 120.0;   // Early decision pressure

// Diversity bonus for non-traditional placements (helps them compete with traditional)
const DIVERSITY_BONUS: f64 = 150.0;
// Extra bonus for Adjacent strategy (visually close, long path - very tricky!)
const ADJACENT_BONUS: f64 = 300.0;

// =============================================================================
// PREFILTER BASE THRESHOLDS (reference 35x35, scaled for smaller maps)
// =============================================================================

// Original thresholds (RELAXED - let variety through, difficulty comes from Phase 2)
const BASE_PREFILTER_MIN_COUNTER_INTUITIVE: i32 = 8;
const BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS: i32 = 10;
const BASE_PREFILTER_MIN_COMMITMENT_GATES: i32 = 3;
const BASE_PREFILTER_MIN_FALSE_PROGRESS: i32 = 10;

// Phase 1 thresholds (rebalanced for ~50% fail rates)
const BASE_PREFILTER_MAX_PATH_LOCALITY: f64 = 0.70;
const BASE_PREFILTER_MIN_DIRECTION_CHANGES: i32 = 16;     // RAISED - was too easy (0% fail)
const BASE_PREFILTER_MIN_BACKTRACK_DEPTH: i32 = 4;
const BASE_PREFILTER_MIN_DECISION_AMBIGUITY: f64 = 2.6;   // RAISED - was too easy (3% fail)

// Phase 2 thresholds (key difficulty metrics)
const BASE_PREFILTER_MIN_NEAR_OPTIMAL_PATHS: i32 = 60;    // Back to moderate level
const BASE_PREFILTER_MIN_PATH_OVERLAP: f64 = 0.0;         // No minimum
const BASE_PREFILTER_MAX_PATH_OVERLAP: f64 = 0.98;        // ENABLED - hunt for rare low-overlap gems
const BASE_PREFILTER_MIN_EARLY_DIVERGENCE: f64 = 0.58;    // Want early confusion

// Reference map size for scaling calculations
const REFERENCE_SIZE: f64 = 35.0;

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
    let mut queue: Vec<(Position, i32)> = vec![(*start, 0)];
    let mut visited = new_pos_set(width * height);
    visited.insert(*start);
    let mut head = 0;

    while head < queue.len() {
        let (pos, moves) = queue[head];
        head += 1;

        if pos_eq(&pos, goal) {
            return Some(moves);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid && visited.insert(result.pos) {
                queue.push((result.pos, moves + 1));
            }
        }
    }

    None
}

fn get_reachable(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    width: usize,
    height: usize,
) -> HashSet<Position> {
    let mut reachable = new_pos_set(width * height);
    let mut queue: Vec<Position> = vec![*start];
    reachable.insert(*start);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid && reachable.insert(result.pos) {
                queue.push(result.pos);
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

fn get_can_reach_goal(
    tiles: &Vec<Vec<TileType>>,
    goal: &Position,
    width: usize,
    height: usize,
) -> HashSet<Position> {
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut can_reach_goal = new_pos_set(width * height);
    let mut queue: Vec<Position> = vec![*goal];
    can_reach_goal.insert(*goal);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        if let Some(sources) = reverse_graph.get(&current) {
            for source in sources {
                if can_reach_goal.insert(*source) {
                    queue.push(*source);
                }
            }
        }
    }

    can_reach_goal
}

fn has_no_stuck_states(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> bool {
    let reachable = get_reachable(tiles, start, width, height);
    let can_reach_goal = get_can_reach_goal(tiles, goal, width, height);

    for key in reachable {
        if !can_reach_goal.contains(&key) {
            return false;
        }
    }
    true
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
    let mut queue: Vec<Position> = vec![*start];
    let mut visited = new_pos_set(width * height);
    let mut parent: HashMap<Position, Option<Position>> = new_pos_map(width * height);
    visited.insert(*start);
    parent.insert(*start, None);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        if pos_eq(&current, goal) {
            let mut path = Vec::new();
            let mut pos = Some(current);
            while let Some(p) = pos {
                path.push(p);
                pos = parent.get(&p).and_then(|o| *o);
            }
            path.reverse();
            return Some(path);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid && visited.insert(result.pos) {
                parent.insert(result.pos, Some(current));
                queue.push(result.pos);
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

    // Path diversity metrics (Phase 2 - NEW)
    near_optimal_paths: i32,      // Count of paths within tolerance of optimal
    optimal_path_count: i32,      // Count of paths at exactly optimal length
    path_overlap: f64,            // 0.0-1.0, how much alternatives overlap with optimal
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
/// Returns (total_near_optimal_count, exactly_optimal_count)
///
/// More near-optimal paths = more "this could be right" confusion = harder puzzle.
fn count_near_optimal_paths(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_moves: i32,
    tolerance: i32,
) -> (i32, i32) {
    let max_moves = optimal_moves + tolerance;

    // Track number of ways to reach each (position, move_count) state
    let mut ways_to_reach: HashMap<(Position, i32), i64> = HashMap::default();
    ways_to_reach.insert((*start, 0), 1);

    // BFS by move count
    let mut current_positions: Vec<Position> = vec![*start];

    for moves in 0..max_moves {
        let mut next_positions: HashSet<Position> = HashSet::default();

        for pos in &current_positions {
            let ways_here = *ways_to_reach.get(&(*pos, moves)).unwrap_or(&0);
            if ways_here == 0 {
                continue;
            }

            // Don't explore past goal
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

    // Count paths reaching goal within tolerance
    let mut total_near_optimal: i64 = 0;
    let mut exactly_optimal: i64 = 0;

    for moves in optimal_moves..=max_moves {
        if let Some(&count) = ways_to_reach.get(&(*goal, moves)) {
            total_near_optimal += count;
            if moves == optimal_moves {
                exactly_optimal = count;
            }
        }
    }

    // Cap at reasonable values to avoid overflow issues in scoring
    (total_near_optimal.min(1000) as i32, exactly_optimal.min(100) as i32)
}

/// Calculate average overlap between near-optimal paths and the optimal path.
/// Returns 0.0-1.0 where:
/// - 1.0 = alternatives are nearly identical to optimal (diverge only at end)
/// - 0.0 = alternatives share almost no positions with optimal
///
/// Medium values (~0.3-0.6) create best difficulty - some structure but real choices.
fn calculate_path_overlap(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    optimal_path: &[Position],
    width: usize,
    height: usize,
    optimal_moves: i32,
) -> f64 {
    if optimal_path.len() < 2 {
        return 1.0;
    }

    let optimal_set: HashSet<Position> = optimal_path.iter().cloned().collect();
    let tolerance = 2; // Look at paths within optimal+2
    let max_moves = optimal_moves + tolerance;

    // Find alternative paths using BFS with path tracking
    // Limit exploration to control performance
    const MAX_PATHS: usize = 30;
    const MAX_QUEUE_SIZE: usize = 10000;

    let mut paths_found: Vec<Vec<Position>> = Vec::new();
    let mut queue: Vec<(Position, i32, Vec<Position>)> = vec![(*start, 0, vec![*start])];
    let mut head = 0;

    while head < queue.len() && paths_found.len() < MAX_PATHS && queue.len() < MAX_QUEUE_SIZE {
        let (pos, moves, path) = queue[head].clone();
        head += 1;

        if moves > max_moves {
            continue;
        }

        if pos_eq(&pos, goal) {
            paths_found.push(path);
            continue;
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid && !pos_eq(&result.pos, &pos) {
                let mut new_path = path.clone();
                new_path.push(result.pos);
                queue.push((result.pos, moves + 1, new_path));
            }
        }
    }

    if paths_found.len() <= 1 {
        return 1.0; // Only one path, maximum "overlap" with itself
    }

    // Calculate overlap for each non-optimal path
    let mut total_overlap = 0.0;
    let mut alt_count = 0;

    for path in &paths_found {
        // Check if this is the exact optimal path
        let is_optimal = path.len() == optimal_path.len()
            && path.iter().zip(optimal_path.iter()).all(|(a, b)| pos_eq(a, b));

        if is_optimal {
            continue;
        }

        let overlap_count = path.iter().filter(|p| optimal_set.contains(p)).count();
        let overlap_ratio = overlap_count as f64 / path.len() as f64;
        total_overlap += overlap_ratio;
        alt_count += 1;
    }

    if alt_count == 0 {
        return 1.0;
    }

    total_overlap / alt_count as f64
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

/// Convert path overlap ratio to a score.
/// Peaks at ~0.4 overlap (sweet spot of structure + variety).
/// Returns 0 at extremes (0.0 or 1.0 overlap).
fn overlap_score(overlap: f64) -> f64 {
    let ideal = 0.4;
    let deviation = (overlap - ideal).abs();
    // Score decreases linearly from peak, bottoms at 0
    (1.0 - deviation * 1.8).max(0.0)
}

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
    let (near_optimal_paths, optimal_path_count) =
        count_near_optimal_paths(tiles, start, goal, width, height, optimal_moves, tolerance);
    let path_overlap = calculate_path_overlap(
        tiles, start, goal, &optimal_path, width, height, optimal_moves
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
        + (overlap_score(path_overlap) * WEIGHT_PATH_OVERLAP)
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
        early_divergence,
        psychology_score,
    }
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
    max_path_locality: f64,
    min_direction_changes: i32,
    min_backtrack_depth: i32,
    min_decision_ambiguity: f64,

    // Phase 2 thresholds (NEW)
    min_near_optimal_paths: i32,  // Minimum alternative paths required
    min_path_overlap: f64,        // Minimum overlap (not too chaotic)
    max_path_overlap: f64,        // Maximum overlap (real alternatives exist)
    min_early_divergence: f64,    // Minimum early divergence score
}

fn compute_prefilter_thresholds(width: usize, height: usize) -> PrefilterThresholds {
    let min_dim = width.min(height) as f64;
    let scale = min_dim / 35.0; // Reference: 35x35 base map size

    let is_small_map = min_dim <= 18.0;

    // Original thresholds (scaled)
    let ci = ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(2);
    let decoys = ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * scale).round() as i32).max(3);
    let gates = ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * scale).round() as i32).max(1);
    let fp = ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * scale).round() as i32).max(3);

    // Phase 1 thresholds (RELAXED - allow more variety through filter)
    let max_locality = if is_small_map {
        BASE_PREFILTER_MAX_PATH_LOCALITY + 0.05  // Allow up to 0.70 for small maps
    } else {
        BASE_PREFILTER_MAX_PATH_LOCALITY
    };
    let min_dir_changes = ((BASE_PREFILTER_MIN_DIRECTION_CHANGES as f64 * scale).round() as i32).max(4);
    let min_backtrack = ((BASE_PREFILTER_MIN_BACKTRACK_DEPTH as f64 * scale).round() as i32).max(2);
    let min_ambiguity = if is_small_map {
        (BASE_PREFILTER_MIN_DECISION_AMBIGUITY - 0.2).max(2.0)  // Relaxed floor
    } else {
        BASE_PREFILTER_MIN_DECISION_AMBIGUITY
    };

    // Phase 2 thresholds (TIGHTENED - these are the key psychological metrics)
    let min_near_optimal = ((BASE_PREFILTER_MIN_NEAR_OPTIMAL_PATHS as f64 * scale * scale).round() as i32).max(4);
    let min_overlap = BASE_PREFILTER_MIN_PATH_OVERLAP; // Not scaled, ratio stays same
    let max_overlap = BASE_PREFILTER_MAX_PATH_OVERLAP; // Not scaled
    let min_early_div = if is_small_map {
        (BASE_PREFILTER_MIN_EARLY_DIVERGENCE - 0.03).max(0.55)  // Slightly lenient for small maps
    } else {
        BASE_PREFILTER_MIN_EARLY_DIVERGENCE
    };

    PrefilterThresholds {
        // TIER 3 - Relaxed significantly (less important for difficulty)
        min_counter_intuitive: if is_small_map { ci.max(2) } else { ci },  // Relaxed from 3 to 2
        min_attractive_decoys: if is_small_map { decoys.max(3) } else { decoys },  // Relaxed from 4 to 3
        min_commitment_gates: if is_small_map { gates.max(1) } else { gates },
        min_false_progress: if is_small_map { fp.max(2) } else { fp },  // Relaxed from 3 to 2

        // TIER 2 - Moderate (secondary difficulty drivers)
        max_path_locality: if is_small_map { max_locality.min(0.80) } else { max_locality },  // Relaxed from 0.75 to 0.80
        min_direction_changes: if is_small_map { min_dir_changes.max(7) } else { min_dir_changes },  // Relaxed from 8 to 7
        min_backtrack_depth: if is_small_map { min_backtrack.max(1) } else { min_backtrack },  // Relaxed from 2 to 1
        min_decision_ambiguity: if is_small_map { min_ambiguity.max(2.4) } else { min_ambiguity },  // Relaxed from 2.6 to 2.4

        // TIER 1 - Keep strict (core difficulty metrics)
        min_near_optimal_paths: if is_small_map { min_near_optimal.max(25) } else { min_near_optimal },  // Relaxed from 30 to 25
        min_path_overlap: min_overlap,
        max_path_overlap: max_overlap,  // 0.98 - hunting for low overlap!
        min_early_divergence: min_early_div,  // Keep at 0.55
    }
}

/// Track which prefilters are failing for diagnostics
fn passes_prefilters_with_stats(
    metrics: &PsychMetrics,
    thresholds: &PrefilterThresholds,
    fail_counts: &mut [u64; 12],
) -> bool {
    let checks = [
        (metrics.counter_intuitive_moves >= thresholds.min_counter_intuitive, 0),
        (metrics.attractive_decoys >= thresholds.min_attractive_decoys, 1),
        (metrics.commitment_gates >= thresholds.min_commitment_gates, 2),
        (metrics.false_progress_paths >= thresholds.min_false_progress, 3),
        (metrics.path_locality <= thresholds.max_path_locality, 4),
        (metrics.direction_changes >= thresholds.min_direction_changes, 5),
        (metrics.backtrack_depth >= thresholds.min_backtrack_depth, 6),
        (metrics.decision_ambiguity >= thresholds.min_decision_ambiguity, 7),
        (metrics.near_optimal_paths >= thresholds.min_near_optimal_paths, 8),
        (metrics.path_overlap >= thresholds.min_path_overlap, 9),
        (metrics.path_overlap <= thresholds.max_path_overlap, 10),
        (metrics.early_divergence >= thresholds.min_early_divergence, 11),
    ];

    let mut all_passed = true;
    for (passed, idx) in checks {
        if !passed {
            fail_counts[idx] += 1;
            all_passed = false;
        }
    }
    all_passed
}

fn passes_prefilters(metrics: &PsychMetrics, thresholds: &PrefilterThresholds) -> bool {
    // CRITICAL: Must have exactly ONE optimal path - this is core to puzzle design
    if metrics.optimal_path_count != 1 {
        return false;
    }
    
    // Original checks
    metrics.counter_intuitive_moves >= thresholds.min_counter_intuitive
        && metrics.attractive_decoys >= thresholds.min_attractive_decoys
        && metrics.commitment_gates >= thresholds.min_commitment_gates
        && metrics.false_progress_paths >= thresholds.min_false_progress
        // Phase 1 checks
        && metrics.path_locality <= thresholds.max_path_locality
        && metrics.direction_changes >= thresholds.min_direction_changes
        && metrics.backtrack_depth >= thresholds.min_backtrack_depth
        && metrics.decision_ambiguity >= thresholds.min_decision_ambiguity
        // Phase 2 checks
        && metrics.near_optimal_paths >= thresholds.min_near_optimal_paths
        && metrics.path_overlap >= thresholds.min_path_overlap
        && metrics.path_overlap <= thresholds.max_path_overlap
        && metrics.early_divergence >= thresholds.min_early_divergence
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
) {
    let mut placed = 0;
    let mut attempts = 0;
    let max_attempts = count * 8;

    while placed < count && attempts < max_attempts {
        attempts += 1;
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        if tiles[y as usize][x as usize] != TileType::Ice {
            continue;
        }
        if pos_eq(&Position { x, y }, start) || pos_eq(&Position { x, y }, goal) {
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
) {
    let mut placed = 0;
    let mut attempts = 0;

    while placed < count && attempts < count * 3 {
        attempts += 1;
        let x = rng.random_int(1, width as i32 - 1);
        let y = rng.random_int(1, height as i32 - 1);
        if tiles[y as usize][x as usize] != TileType::Ice {
            continue;
        }
        if pos_eq(&Position { x, y }, start) || pos_eq(&Position { x, y }, goal) {
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
/// - Randomly skips some traps (40-80% of traps run)
/// - Randomizes order of trap execution
/// - Varies count ranges by ±30%
fn apply_chaos_traps(
    tiles: &mut Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    scale_range: impl Fn(i32, i32) -> (i32, i32),
) {
    // CHAOS MODE v2: More randomization for puzzle diversity
    
    // Shuffle trap order for variety
    let shuffled_traps = rng.shuffle(&ALL_TRAPS);
    
    // Randomly determine how many traps to run (50-100% of all traps)
    // INCREASED from 40-80% to get more trap interactions
    let min_traps = (ALL_TRAPS.len() as f64 * 0.5).ceil() as usize;
    let max_traps = ALL_TRAPS.len();
    let num_traps = rng.random_int(min_traps as i32, max_traps as i32 + 1) as usize;
    
    // Apply random count variance (±50% instead of ±30%)
    // INCREASED variance for more diversity
    let vary_count = |rng: &mut SeededRandom, min: i32, max: i32| -> i32 {
        let base = rng.random_int(min, max);
        let variance = (base as f64 * 0.5) as i32;
        let adjusted = base + rng.random_int(-variance, variance + 1);
        adjusted.max(1)
    };
    
    // First pass: Apply selected traps
    for trap in shuffled_traps.into_iter().take(num_traps) {
        match trap {
            TrapFunction::AlmostThere => {
                let (min, max) = scale_range(5, 10);
                let count = vary_count(rng, min, max);
                create_almost_there_traps(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::DecoyOpenAreas => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                create_decoy_open_areas(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::HiddenChokePoints => {
                let (min, max) = scale_range(5, 10);
                let count = vary_count(rng, min, max);
                create_hidden_choke_points(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::MomentumTraps => {
                let (min, max) = scale_range(8, 16);
                let count = vary_count(rng, min, max);
                create_momentum_traps(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::AntiGradientZones => {
                let (min, max) = scale_range(5, 10);
                let count = vary_count(rng, min, max);
                create_anti_gradient_zones(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::ParallelPathIllusion => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                create_parallel_path_illusion(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::LedgeMisdirection => {
                let (min, max) = scale_range(10, 18);
                let count = vary_count(rng, min, max);
                create_ledge_misdirection(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::GoalProximityDeadEnds => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                create_goal_proximity_dead_ends(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::CommitmentTraps => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                create_commitment_traps(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::PrecisionGates => {
                let (min, max) = scale_range(8, 16);
                let count = vary_count(rng, min, max);
                add_precision_gates(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::FunnelPatterns => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                add_funnel_patterns(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::TrapAlcoves => {
                let (min, max) = scale_range(10, 18);
                let count = vary_count(rng, min, max);
                add_trap_alcoves(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::DeceptivePaths => {
                let (min, max) = scale_range(25, 45);
                let count = vary_count(rng, min, max);
                add_deceptive_paths(tiles, start, goal, width, height, rng, count);
            }
            TrapFunction::DeadEndMagnets => {
                let (min, max) = scale_range(6, 12);
                let count = vary_count(rng, min, max);
                add_dead_end_magnets(tiles, start, goal, width, height, rng, count);
            }
        }
    }
    
    // WILD CARD PASS: 50% chance to apply 2-4 additional random traps
    // This creates more complex interactions between trap types
    if rng.random() < 0.5 {
        let wild_card_count = rng.random_int(2, 5);
        for _ in 0..wild_card_count {
            let wild_trap = rng.random_choice(&ALL_TRAPS);
            match wild_trap {
                TrapFunction::AlmostThere => {
                    let count = vary_count(rng, 2, 6);
                    create_almost_there_traps(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::DecoyOpenAreas => {
                    let count = vary_count(rng, 3, 8);
                    create_decoy_open_areas(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::HiddenChokePoints => {
                    let count = vary_count(rng, 2, 6);
                    create_hidden_choke_points(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::MomentumTraps => {
                    let count = vary_count(rng, 4, 10);
                    create_momentum_traps(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::AntiGradientZones => {
                    let count = vary_count(rng, 2, 6);
                    create_anti_gradient_zones(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::ParallelPathIllusion => {
                    let count = vary_count(rng, 3, 8);
                    create_parallel_path_illusion(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::LedgeMisdirection => {
                    let count = vary_count(rng, 5, 12);
                    create_ledge_misdirection(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::GoalProximityDeadEnds => {
                    let count = vary_count(rng, 3, 8);
                    create_goal_proximity_dead_ends(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::CommitmentTraps => {
                    let count = vary_count(rng, 3, 8);
                    create_commitment_traps(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::PrecisionGates => {
                    let count = vary_count(rng, 4, 10);
                    add_precision_gates(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::FunnelPatterns => {
                    let count = vary_count(rng, 3, 8);
                    add_funnel_patterns(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::TrapAlcoves => {
                    let count = vary_count(rng, 5, 12);
                    add_trap_alcoves(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::DeceptivePaths => {
                    let count = vary_count(rng, 10, 25);
                    add_deceptive_paths(tiles, start, goal, width, height, rng, count);
                }
                TrapFunction::DeadEndMagnets => {
                    let count = vary_count(rng, 3, 8);
                    add_dead_end_magnets(tiles, start, goal, width, height, rng, count);
                }
            }
        }
    }
}

// =============================================================================
// MAIN GENERATION
// =============================================================================

fn pick_size(rng: &mut SeededRandom) -> (usize, usize) {
    rng.random_choice(&SIZE_OPTIONS)
}

pub fn generate_puzzle(seed: &str, config: &GenerationConfig) -> PuzzleData {
    // Log rayon thread pool info
    let num_threads = rayon::current_num_threads();
    info!("generate_puzzle called with seed: {}", seed);
    info!("Rayon thread pool has {} threads", num_threads);

    let (width, height) = {
        let mut rng = SeededRandom::new(seed);
        pick_size(&mut rng)
    };

    let traditional_attempts = if config.traditional_attempts > 0 {
        config.traditional_attempts
    } else {
        TRADITIONAL_ATTEMPTS
    };

    // Compute scaled parameters for this map size
    let prefilter_thresholds = compute_prefilter_thresholds(width, height);
    let required_optimal_moves = compute_required_moves(width, height);

    info!("Map {}x{}: required_optimal_moves={}", width, height, required_optimal_moves);
    info!(
        "Prefilters: ci>={}, dec>={}, gate>={}, fp>={}, loc<={:.2}, dir>={}, bt>={}, amb>={:.1}, paths>={}, olap={:.2}-{:.2}, ediv>={:.2}",
        prefilter_thresholds.min_counter_intuitive,
        prefilter_thresholds.min_attractive_decoys,
        prefilter_thresholds.min_commitment_gates,
        prefilter_thresholds.min_false_progress,
        prefilter_thresholds.max_path_locality,
        prefilter_thresholds.min_direction_changes,
        prefilter_thresholds.min_backtrack_depth,
        prefilter_thresholds.min_decision_ambiguity,
        prefilter_thresholds.min_near_optimal_paths,
        prefilter_thresholds.min_path_overlap,
        prefilter_thresholds.max_path_overlap,
        prefilter_thresholds.min_early_divergence,
    );
    info!("Running {} traditional attempts per batch", traditional_attempts);

    // Diagnostic counters for tracking which prefilters fail most
    use std::sync::atomic::{AtomicU64, Ordering};
    static FAIL_CI: AtomicU64 = AtomicU64::new(0);
    static FAIL_DEC: AtomicU64 = AtomicU64::new(0);
    static FAIL_GATE: AtomicU64 = AtomicU64::new(0);
    static FAIL_FP: AtomicU64 = AtomicU64::new(0);
    static FAIL_LOC: AtomicU64 = AtomicU64::new(0);
    static FAIL_DIR: AtomicU64 = AtomicU64::new(0);
    static FAIL_BT: AtomicU64 = AtomicU64::new(0);
    static FAIL_AMB: AtomicU64 = AtomicU64::new(0);
    static FAIL_PATHS: AtomicU64 = AtomicU64::new(0);
    static FAIL_OLAP_MIN: AtomicU64 = AtomicU64::new(0);
    static FAIL_OLAP_MAX: AtomicU64 = AtomicU64::new(0);
    static FAIL_EDIV: AtomicU64 = AtomicU64::new(0);
    static FAIL_UNIQUE_OPT: AtomicU64 = AtomicU64::new(0);  // Track puzzles with multiple optimal paths
    static TOTAL_CHECKED: AtomicU64 = AtomicU64::new(0);

    // Reset counters for this generation
    FAIL_CI.store(0, Ordering::Relaxed);
    FAIL_DEC.store(0, Ordering::Relaxed);
    FAIL_GATE.store(0, Ordering::Relaxed);
    FAIL_FP.store(0, Ordering::Relaxed);
    FAIL_LOC.store(0, Ordering::Relaxed);
    FAIL_DIR.store(0, Ordering::Relaxed);
    FAIL_BT.store(0, Ordering::Relaxed);
    FAIL_AMB.store(0, Ordering::Relaxed);
    FAIL_PATHS.store(0, Ordering::Relaxed);
    FAIL_OLAP_MIN.store(0, Ordering::Relaxed);
    FAIL_OLAP_MAX.store(0, Ordering::Relaxed);
    FAIL_EDIV.store(0, Ordering::Relaxed);
    FAIL_UNIQUE_OPT.store(0, Ordering::Relaxed);
    TOTAL_CHECKED.store(0, Ordering::Relaxed);

    let mut batch = 0;
    loop {
        let trad_start = batch * traditional_attempts;
        let trad_end = trad_start + traditional_attempts;

        // Scale factor for generation parameters based on map size (reference: 35x35)
        let gen_scale = (width.min(height) as f64) / 35.0;
        let scale_range = |min: i32, max: i32| -> (i32, i32) {
            let scaled_min = ((min as f64 * gen_scale).round() as i32).max(1);
            let scaled_max = ((max as f64 * gen_scale).round() as i32).max(scaled_min + 1);
            (scaled_min, scaled_max)
        };

        // Traditional attempts (parallel on native, sequential on WASM)
        let trad_best = find_best_in_range("traditional", trad_start..trad_end, |attempt| {
            let mut attempt_rng = SeededRandom::new(&format!("{}-trad-{}", seed, attempt));
            let mut tiles = create_base_maze(width, height, &mut attempt_rng);

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
            let strategy = select_placement_strategy(&mut attempt_rng);
            let (start, goal) = match select_start_goal(&ice_tiles, width, height, strategy, &mut attempt_rng) {
                Some(pair) => pair,
                None => return None,
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

            engineer_counter_intuitive_path(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
            );
            
            // Apply trap functions with randomized selection and ordering (CHAOS MODE)
            apply_chaos_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                scale_range,
            );
            
            // Always apply these structural elements (not randomized)
            let (stb_min, stb_max) = scale_range(35, 60);
            let stop_blocks = attempt_rng.random_int(stb_min, stb_max);
            add_stop_blocks(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                stop_blocks,
            );
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
            );

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

            let psych_metrics = calculate_psychology_score(&tiles, &start, &goal, width, height);
            
            // Track which prefilters fail
            TOTAL_CHECKED.fetch_add(1, Ordering::Relaxed);
            let passed = {
                // CRITICAL: Must have exactly ONE optimal path
                let pass_unique_opt = psych_metrics.optimal_path_count == 1;
                
                let pass_ci = psych_metrics.counter_intuitive_moves >= prefilter_thresholds.min_counter_intuitive;
                let pass_dec = psych_metrics.attractive_decoys >= prefilter_thresholds.min_attractive_decoys;
                let pass_gate = psych_metrics.commitment_gates >= prefilter_thresholds.min_commitment_gates;
                let pass_fp = psych_metrics.false_progress_paths >= prefilter_thresholds.min_false_progress;
                let pass_loc = psych_metrics.path_locality <= prefilter_thresholds.max_path_locality;
                let pass_dir = psych_metrics.direction_changes >= prefilter_thresholds.min_direction_changes;
                let pass_bt = psych_metrics.backtrack_depth >= prefilter_thresholds.min_backtrack_depth;
                let pass_amb = psych_metrics.decision_ambiguity >= prefilter_thresholds.min_decision_ambiguity;
                let pass_paths = psych_metrics.near_optimal_paths >= prefilter_thresholds.min_near_optimal_paths;
                let pass_olap_min = psych_metrics.path_overlap >= prefilter_thresholds.min_path_overlap;
                let pass_olap_max = psych_metrics.path_overlap <= prefilter_thresholds.max_path_overlap;
                let pass_ediv = psych_metrics.early_divergence >= prefilter_thresholds.min_early_divergence;

                if !pass_unique_opt { FAIL_UNIQUE_OPT.fetch_add(1, Ordering::Relaxed); }
                if !pass_ci { FAIL_CI.fetch_add(1, Ordering::Relaxed); }
                if !pass_dec { FAIL_DEC.fetch_add(1, Ordering::Relaxed); }
                if !pass_gate { FAIL_GATE.fetch_add(1, Ordering::Relaxed); }
                if !pass_fp { FAIL_FP.fetch_add(1, Ordering::Relaxed); }
                if !pass_loc { FAIL_LOC.fetch_add(1, Ordering::Relaxed); }
                if !pass_dir { FAIL_DIR.fetch_add(1, Ordering::Relaxed); }
                if !pass_bt { FAIL_BT.fetch_add(1, Ordering::Relaxed); }
                if !pass_amb { FAIL_AMB.fetch_add(1, Ordering::Relaxed); }
                if !pass_paths { FAIL_PATHS.fetch_add(1, Ordering::Relaxed); }
                if !pass_olap_min { FAIL_OLAP_MIN.fetch_add(1, Ordering::Relaxed); }
                if !pass_olap_max { FAIL_OLAP_MAX.fetch_add(1, Ordering::Relaxed); }
                if !pass_ediv { FAIL_EDIV.fetch_add(1, Ordering::Relaxed); }

                pass_unique_opt && pass_ci && pass_dec && pass_gate && pass_fp && pass_loc && pass_dir && pass_bt && pass_amb && pass_paths && pass_olap_min && pass_olap_max && pass_ediv
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
                path_overlap: Some(psych_metrics.path_overlap),
                early_divergence: Some(psych_metrics.early_divergence),
            };

            Some((puzzle, score))
        });

        // Check if we found a puzzle meeting the prefilter thresholds
        // Note: If prefilters pass, psychology_score is guaranteed to be high enough
        // (minimum ~1505 for 15x15, far exceeds TARGET_PSYCHOLOGY_SCORE of 800)
        if let Some((puzzle, _score)) = trad_best.clone() {
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
                info!(
                    "Selected puzzle: score={}, ci={}, dec={}, gate={}, fp={}, loc={:.2}, dir={}, bt={}, amb={:.1}, paths={}, olap={:.2}, ediv={:.2}",
                    puzzle.difficulty_score.unwrap_or(0),
                    puzzle.counter_intuitive_moves.unwrap_or(0),
                    puzzle.attractive_decoys.unwrap_or(0),
                    puzzle.commitment_gates.unwrap_or(0),
                    puzzle.false_progress_paths.unwrap_or(0),
                    puzzle.path_locality.unwrap_or(0.0),
                    puzzle.direction_changes.unwrap_or(0),
                    puzzle.backtrack_depth.unwrap_or(0),
                    puzzle.decision_ambiguity.unwrap_or(0.0),
                    puzzle.near_optimal_paths.unwrap_or(0),
                    puzzle.path_overlap.unwrap_or(0.0),
                    puzzle.early_divergence.unwrap_or(0.0),
                );
                return puzzle;
            }
        }

        // If we found any valid puzzle, return it
        if let Some((puzzle, _score)) = trad_best {
            info!(
                "Selected puzzle (fallback): score={}, ci={}, dec={}, gate={}, fp={}, loc={:.2}, dir={}, bt={}, amb={:.1}, paths={}, olap={:.2}, ediv={:.2}",
                puzzle.difficulty_score.unwrap_or(0),
                puzzle.counter_intuitive_moves.unwrap_or(0),
                puzzle.attractive_decoys.unwrap_or(0),
                puzzle.commitment_gates.unwrap_or(0),
                puzzle.false_progress_paths.unwrap_or(0),
                puzzle.path_locality.unwrap_or(0.0),
                puzzle.direction_changes.unwrap_or(0),
                puzzle.backtrack_depth.unwrap_or(0),
                puzzle.decision_ambiguity.unwrap_or(0.0),
                puzzle.near_optimal_paths.unwrap_or(0),
                puzzle.path_overlap.unwrap_or(0.0),
                puzzle.early_divergence.unwrap_or(0.0),
            );
            return puzzle;
        }

        // Log failure stats every 10 batches
        if batch > 0 && batch % 10 == 0 {
            let total = TOTAL_CHECKED.load(Ordering::Relaxed);
            if total > 0 {
                info!(
                    "Batch {} fail rates: uopt={:.0}% ci={:.0}% dec={:.0}% gate={:.0}% fp={:.0}% loc={:.0}% dir={:.0}% bt={:.0}% amb={:.0}% paths={:.0}% olap_max={:.0}% ediv={:.0}% (n={})",
                    batch,
                    FAIL_UNIQUE_OPT.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_CI.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_DEC.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_GATE.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_FP.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_LOC.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_DIR.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_BT.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_AMB.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_PATHS.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_OLAP_MAX.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    FAIL_EDIV.load(Ordering::Relaxed) as f64 / total as f64 * 100.0,
                    total,
                );
            }
        }

        // Only log batch progress every 10 batches to reduce noise
        if batch % 10 == 0 {
            info!("No puzzle met target in batch {}. Continuing...", batch);
        }
        batch += 1;
    }
}
