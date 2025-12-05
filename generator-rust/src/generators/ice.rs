use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};

// Rayon for parallel processing (works on both native and WASM with wasm-bindgen-rayon)
use rayon::prelude::*;

use crate::types::{Direction, GenerationConfig, MapType, Position, PuzzleData, TileType};

// WASM logging helper
#[cfg(target_arch = "wasm32")]
fn log_to_console(msg: &str) {
    web_sys::console::log_1(&msg.into());
}

#[cfg(not(target_arch = "wasm32"))]
fn log_to_console(msg: &str) {
    println!("{}", msg);
}

// =============================================================================
// PARALLEL ITERATION HELPERS
// =============================================================================
// Rayon works on both native and WASM (via wasm-bindgen-rayon thread pool).
// Both produce identical results for the same seed.

/// Process a range in parallel and find the best result.
/// Uses attempt index as a deterministic tiebreaker when scores are equal,
/// ensuring identical results regardless of CPU count or thread scheduling.
fn find_best_in_range<F, T>(
    label: &str,
    range: std::ops::Range<usize>,
    f: F,
) -> Option<(T, f64)>
where
    F: Fn(usize) -> Option<(T, f64)> + Sync + Send,
    T: Send,
{
    let batch_size = range.len();

    // Track progress across rayon workers to emit periodic logs (visible in WASM and native).
    let progress = AtomicUsize::new(0);

    // Include attempt index in tuple for deterministic tie-breaking
    let result = range
        .into_par_iter()
        .filter_map(|i| {
            let done = progress.fetch_add(1, Ordering::Relaxed) + 1;
            if done % 50 == 0 || done == batch_size {
                log_to_console(&format!(
                    "[Rust][{}] Progress: {}/{}",
                    label, done, batch_size
                ));
            }
            f(i).map(|(puzzle, score)| (puzzle, score, i))
        })
        .max_by(|a, b| {
            match a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal) {
                std::cmp::Ordering::Equal => a.2.cmp(&b.2), // Tiebreaker: lower attempt index wins
                other => other,
            }
        })
        .map(|(puzzle, score, _)| (puzzle, score)); // Strip the index

    log_to_console(&format!(
        "[Rust][{}] Batch of {} attempts completed",
        label, batch_size
    ));

    result
}

// =============================================================================
// CONSTANTS (match src/game/maps/ice/generator.ts)
// =============================================================================

const TARGET_PSYCHOLOGY_SCORE: f64 = 2000.0;
const CONSTRAINT_ATTEMPTS: usize = 160;
const TRADITIONAL_ATTEMPTS: usize = 400;

const SIZE_OPTIONS: [(usize, usize); 9] = [
    (21, 21),
    (22, 22),
    (23, 23),
    (24, 24),
    (25, 25),
    (26, 26),
    (27, 27),
    (28, 28),
    (29, 29),
];

// Weighting knobs for psychology scoring (emphasize traps over length)
const WEIGHT_COUNTER_INTUITIVE: f64 = 70.0;
const WEIGHT_ATTRACTIVE_DECOYS: f64 = 80.0;
const WEIGHT_COMMITMENT_GATES: f64 = 70.0;
const WEIGHT_FALSE_PROGRESS: f64 = 100.0;
const WEIGHT_MOVE_BONUS: f64 = 0.5;

// Prefilter thresholds to avoid wasting attempts on obviously easy maps
const PREFILTER_MIN_COUNTER_INTUITIVE: i32 = 6;
const PREFILTER_MIN_ATTRACTIVE_DECOYS: i32 = 8;
const PREFILTER_MIN_COMMITMENT_GATES: i32 = 3;
const PREFILTER_MIN_FALSE_PROGRESS: i32 = 8;

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

fn pos_key(p: &Position) -> String {
    format!("{},{}", p.x, p.y)
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
    let mut visited = HashSet::new();
    visited.insert(pos_key(start));
    let mut head = 0;

    while head < queue.len() {
        let (pos, moves) = queue[head].clone();
        head += 1;

        if pos_eq(&pos, goal) {
            return Some(moves);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if result.valid {
                let key = pos_key(&result.pos);
                if !visited.contains(&key) {
                    visited.insert(key);
                    queue.push((result.pos, moves + 1));
                }
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
) -> HashSet<String> {
    let mut reachable = HashSet::new();
    let mut queue: Vec<Position> = vec![*start];
    reachable.insert(pos_key(start));
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid {
                let key = pos_key(&result.pos);
                if !reachable.contains(&key) {
                    reachable.insert(key.clone());
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

fn build_reverse_graph(
    tiles: &Vec<Vec<TileType>>,
    width: usize,
    height: usize,
) -> HashMap<String, Vec<Position>> {
    let mut reverse_graph: HashMap<String, Vec<Position>> = HashMap::new();

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
                    let dest_key = pos_key(&result.pos);
                    reverse_graph
                        .entry(dest_key)
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
) -> HashSet<String> {
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut can_reach_goal = HashSet::new();
    let mut queue: Vec<Position> = vec![*goal];
    can_reach_goal.insert(pos_key(goal));
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        if let Some(sources) = reverse_graph.get(&pos_key(&current)) {
            for source in sources {
                let key = pos_key(source);
                if !can_reach_goal.contains(&key) {
                    can_reach_goal.insert(key.clone());
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
) -> HashSet<String> {
    let mut zone = HashSet::new();
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
                    zone.insert(pos_key(&Position { x, y }));
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
    let mut visited = HashSet::new();
    let mut parent: HashMap<String, Option<Position>> = HashMap::new();
    let start_key = pos_key(start);
    visited.insert(start_key.clone());
    parent.insert(start_key, None);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head];
        head += 1;

        if pos_eq(&current, goal) {
            let mut path = Vec::new();
            let mut pos = Some(current);
            while let Some(p) = pos {
                path.push(p);
                pos = parent.get(&pos_key(&p)).and_then(|o| *o);
            }
            path.reverse();
            return Some(path);
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid {
                let key = pos_key(&result.pos);
                if !visited.contains(&key) {
                    visited.insert(key.clone());
                    parent.insert(key, Some(current));
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
    let _intuitive_zone = get_direct_path_zone(start, goal, width, height, 4);
    let intuitive_dirs = get_intuitive_direction(start, goal);

    let mut goal_approaches: Vec<Position> = Vec::new();
    for r in 2..=6 {
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
    for _ in 0..count {
        let approach_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(approach_dir);
        let (odx, ody) = get_delta(get_opposite_dir(approach_dir));

        let runway_start = Position {
            x: goal.x + odx * rng.random_int(4, 8),
            y: goal.y + ody * rng.random_int(4, 8),
        };
        let runway_end = Position {
            x: goal.x + dx * rng.random_int(3, 6),
            y: goal.y + dy * rng.random_int(3, 6),
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

    for _ in 0..count {
        let primary_dir = rng.random_choice(&intuitive_dirs);
        let (dx, dy) = get_delta(primary_dir);

        let dist_from_start = rng.random_int(6, 12);
        let cx = start.x + dx * dist_from_start + rng.random_int(-3, 4);
        let cy = start.y + dy * dist_from_start + rng.random_int(-3, 4);

        if !is_inner(cx, cy, width, height) {
            continue;
        }

        let area_size = rng.random_int(4, 7);
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
    for _ in 0..count {
        let direct_zone = get_direct_path_zone(start, goal, width, height, 5);

        let mut cx;
        let mut cy;
        let mut attempts = 0;
        loop {
            cx = rng.random_int(4, width as i32 - 4);
            cy = rng.random_int(4, height as i32 - 4);
            attempts += 1;
            if !direct_zone.contains(&pos_key(&Position { x: cx, y: cy })) || attempts >= 50 {
                break;
            }
        }
        if attempts >= 50 {
            continue;
        }

        let is_horizontal = rng.random() < 0.5;
        let barrier_length = rng.random_int(8, 14);
        let gap_pos = rng.random_int(2, barrier_length - 2);

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
    if optimal_path.is_none() || optimal_path.as_ref().unwrap().len() < 5 {
        return;
    }
    let optimal_path = optimal_path.unwrap();

    for _ in 0..count {
        let path_idx = rng.random_int(1, (optimal_path.len() - 1).min(10) as i32);
        let key_pos = optimal_path[path_idx as usize];

        let runway_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(runway_dir);
        let runway_length = rng.random_int(8, 15);
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        let offset_dist = rng.random_int(2, 5);
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

    for _ in 0..count {
        let t = rng.random() * 0.6 + 0.2;
        let zone_x = (start.x as f64 + (goal.x - start.x) as f64 * t).round() as i32;
        let zone_y = (start.y as f64 + (goal.y - start.y) as f64 * t).round() as i32;

        if !is_inner(zone_x, zone_y, width, height) {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let zone_radius = rng.random_int(3, 6);

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

    for _ in 0..count {
        let dir = rng.random_choice(&intuitive_dirs);
        let (dx, dy) = get_delta(dir);
        let dist = rng.random_int(5, 12);
        let lx = start.x + dx * dist + rng.random_int(-2, 3);
        let ly = start.y + dy * dist + rng.random_int(-2, 3);

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
    for _ in 0..count {
        let dist = rng.random_int(2, 5);
        let angle = rng.random() * std::f64::consts::PI * 2.0;
        let pocket_x = (goal.x as f64 + angle.cos() * dist as f64).round() as i32;
        let pocket_y = (goal.y as f64 + angle.sin() * dist as f64).round() as i32;
        if !is_inner(pocket_x, pocket_y, width, height) {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let pocket_size = 2;
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
    counter_intuitive_moves: i32,
    attractive_decoys: i32,
    commitment_gates: i32,
    false_progress_paths: i32,
    psychology_score: f64,
}

fn trap_bonus(false_progress_paths: i32, attractive_decoys: i32) -> f64 {
    let fp_bonus = if false_progress_paths > 8 {
        (false_progress_paths - 8) * 40
    } else {
        0
    };
    let decoy_bonus = if attractive_decoys > 12 {
        (attractive_decoys - 12) * 25
    } else {
        0
    };
    (fp_bonus + decoy_bonus) as f64
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
) -> HashMap<String, i32> {
    let mut distances = HashMap::new();
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut queue: Vec<(Position, i32)> = vec![(*goal, 0)];
    distances.insert(pos_key(goal), 0);
    let mut head = 0;

    while head < queue.len() {
        let (current, dist) = queue[head].clone();
        head += 1;

        if let Some(sources) = reverse_graph.get(&pos_key(&current)) {
            for source in sources {
                let key = pos_key(source);
                if !distances.contains_key(&key) {
                    distances.insert(key.clone(), dist + 1);
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
    distance_to_goal: &HashMap<String, i32>,
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
            if let Some(wrong_path_length) = distance_to_goal.get(&pos_key(&result.pos)) {
                let remaining_optimal = optimal_moves - i as i32;
                let wrong_move_cost = (wrong_path_length + 1) - remaining_optimal;
                max_wrong_move_cost = max_wrong_move_cost.max(wrong_move_cost);
            }
        }

        if max_wrong_move_cost >= 5 {
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
    distance_to_goal: &HashMap<String, i32>,
) -> i32 {
    let mut false_path_count = 0;
    let mut checked = HashSet::new();

    let start_dist = manhattan_dist(start, goal);
    let mut queue: Vec<(Position, i32, i32)> = vec![(*start, 0, start_dist)];
    checked.insert(pos_key(start));
    let mut head = 0;

    while head < queue.len() {
        let (pos, dist_from_start, min_dist_seen) = queue[head].clone();
        head += 1;
        if dist_from_start > optimal_moves + 10 {
            continue;
        }

        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &pos, dir, width, height);
            if !result.valid || pos_eq(&result.pos, &pos) {
                continue;
            }
            let key = pos_key(&result.pos);
            if checked.contains(&key) {
                continue;
            }
            checked.insert(key.clone());

            let new_dist_to_goal = manhattan_dist(&result.pos, goal);
            let new_dist_from_start = dist_from_start + 1;
            let is_progress = new_dist_to_goal < min_dist_seen;

            if is_progress {
                if let Some(path_from_here) = distance_to_goal.get(&key) {
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
            psychology_score: 0.0,
        };
    }
    let optimal_path = optimal_path.unwrap();
    let optimal_moves = (optimal_path.len() - 1) as i32;
    let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);

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

    let psychology_score = (counter_intuitive_moves as f64 * WEIGHT_COUNTER_INTUITIVE)
        + (attractive_decoys as f64 * WEIGHT_ATTRACTIVE_DECOYS)
        + (commitment_gates as f64 * WEIGHT_COMMITMENT_GATES)
        + (false_progress_paths as f64 * WEIGHT_FALSE_PROGRESS)
        + (optimal_moves as f64 * WEIGHT_MOVE_BONUS)
        + trap_bonus(false_progress_paths, attractive_decoys);

    PsychMetrics {
        counter_intuitive_moves,
        attractive_decoys,
        commitment_gates,
        false_progress_paths,
        psychology_score,
    }
}

fn passes_prefilters(metrics: &PsychMetrics) -> bool {
    metrics.counter_intuitive_moves >= PREFILTER_MIN_COUNTER_INTUITIVE
        && metrics.attractive_decoys >= PREFILTER_MIN_ATTRACTIVE_DECOYS
        && metrics.commitment_gates >= PREFILTER_MIN_COMMITMENT_GATES
        && metrics.false_progress_paths >= PREFILTER_MIN_FALSE_PROGRESS
}

// =============================================================================
// BASE MAZE GENERATION + UTILITIES
// =============================================================================

fn create_base_maze(width: usize, height: usize, rng: &mut SeededRandom) -> Vec<Vec<TileType>> {
    let mut tiles = vec![vec![TileType::Wall; width]; height];
    let mut visited = HashSet::new();

    fn carve(
        tiles: &mut Vec<Vec<TileType>>,
        visited: &mut HashSet<String>,
        x: i32,
        y: i32,
        width: usize,
        height: usize,
        rng: &mut SeededRandom,
    ) {
        let pos = Position { x, y };
        visited.insert(pos_key(&pos));
        tiles[y as usize][x as usize] = TileType::Ice;

        let dirs = [(0, -2), (0, 2), (-2, 0), (2, 0)];
        let shuffled = rng.shuffle(&dirs);

        for (dx, dy) in shuffled {
            let nx = x + dx;
            let ny = y + dy;
            let npos = Position { x: nx, y: ny };
            if is_inner(nx, ny, width, height) && !visited.contains(&pos_key(&npos)) {
                tiles[(y + dy / 2) as usize][(x + dx / 2) as usize] = TileType::Ice;
                carve(tiles, visited, nx, ny, width, height, rng);
            }
        }
    }

    let start_x = 2 + rng.random_int(0, ((width - 4) / 2) as i32) * 2;
    let start_y = 2 + rng.random_int(0, ((height - 4) / 2) as i32) * 2;
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
        let x = rng.random_int(2, width as i32 - 2);
        let y = rng.random_int(2, height as i32 - 2);
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
        let x = rng.random_int(2, width as i32 - 2);
        let y = rng.random_int(2, height as i32 - 2);
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
        let x = rng.random_int(2, width as i32 - 2);
        let y = rng.random_int(2, height as i32 - 2);
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
        let x = rng.random_int(2, width as i32 - 2);
        let y = rng.random_int(2, height as i32 - 2);
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
    for _ in 0..count {
        let cx = rng.random_int(5, width as i32 - 5);
        let cy = rng.random_int(5, height as i32 - 5);
        let size = rng.random_int(2, 4);

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
    let num_segments = rng.random_int(8, 15);
    for _ in 0..num_segments {
        let is_horizontal = rng.random() < 0.5;
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        if is_horizontal {
            let y = rng.random_int(4, height as i32 - 4);
            let start_x = rng.random_int(3, (width as f64 * 0.6) as i32);
            let length = rng.random_int(8, 18);
            let gap_pos = rng.random_int(1, length - 1);
            let gap_size = rng.random_int(1, 3);

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
            let x = rng.random_int(4, width as i32 - 4);
            let start_y = rng.random_int(3, (height as f64 * 0.6) as i32);
            let length = rng.random_int(8, 16);
            let gap_pos = rng.random_int(1, length - 1);
            let gap_size = rng.random_int(1, 3);

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

// ADVANCED (unused but ported for completeness)
#[allow(dead_code)]
fn calculate_branching_factor(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    _goal: &Position,
    width: usize,
    height: usize,
) -> f64 {
    let mut visited = HashSet::new();
    let mut queue: Vec<(Position, i32)> = vec![(*start, 0)];
    visited.insert(pos_key(start));
    let mut head = 0;
    let mut total_branches = 0;
    let mut decision_points = 0;

    while head < queue.len() {
        let (current, depth) = queue[head].clone();
        head += 1;

        let mut valid_moves = 0;
        for dir in get_all_dirs() {
            let result = simulate_move(tiles, &current, dir, width, height);
            if result.valid && !pos_eq(&result.pos, &current) {
                valid_moves += 1;
                let key = pos_key(&result.pos);
                if !visited.contains(&key) {
                    visited.insert(key.clone());
                    queue.push((result.pos, depth + 1));
                }
            }
        }

        if valid_moves >= 2 {
            decision_points += 1;
            total_branches += valid_moves;
        }
    }

    if decision_points > 0 {
        total_branches as f64 / decision_points as f64
    } else {
        1.0
    }
}

#[allow(dead_code)]
fn count_trap_potential(
    tiles: &Vec<Vec<TileType>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> i32 {
    let reachable = get_reachable(tiles, start, width, height);
    let mut trap_score = 0;

    for key in reachable {
        let parts: Vec<_> = key.split(',').collect();
        if parts.len() != 2 {
            continue;
        }
        let x = parts[0].parse::<i32>().unwrap_or(0);
        let y = parts[1].parse::<i32>().unwrap_or(0);
        let pos = Position { x, y };
        if pos_eq(&pos, goal) {
            continue;
        }
        let path_from_pos = find_path(tiles, &pos, goal, width, height);
        let direct_path = find_path(tiles, start, goal, width, height);
        if let (Some(path_from_pos), Some(direct_path)) = (path_from_pos, direct_path) {
            if let Some(path_to_pos) = find_path(tiles, start, &pos, width, height) {
                let inefficiency = (path_to_pos + path_from_pos) - direct_path;
                if inefficiency > 5 {
                    trap_score += inefficiency.min(15);
                }
            }
        }
    }
    trap_score
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
    for _ in 0..count {
        let cx = rng.random_int(6, width as i32 - 6);
        let cy = rng.random_int(6, height as i32 - 6);
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
            for i in 1..=3 {
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
            for i in 1..=3 {
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

    while added < count && attempts < count * 10 {
        attempts += 1;
        let x = rng.random_int(4, width as i32 - 4);
        let y = rng.random_int(4, height as i32 - 4);
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
    for _ in 0..count {
        let cx = rng.random_int(5, width as i32 - 5);
        let cy = rng.random_int(5, height as i32 - 5);
        let open_dir = rng.random_choice(&get_all_dirs());
        let (dx, dy) = get_delta(open_dir);
        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let mut alcove_positions: Vec<Position> = Vec::new();

        let back_x = cx - dx * 2;
        let back_y = cy - dy * 2;

        if open_dir == Direction::Up || open_dir == Direction::Down {
            for d in -2..=0 {
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
            for d in -2..=0 {
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
    for _ in 0..count {
        let is_horizontal = rng.random() < 0.5;
        let mut backup: Vec<(Position, TileType)> = Vec::new();

        if is_horizontal {
            let gate_y = rng.random_int(4, height as i32 - 4);
            let gate_x = rng.random_int(6, width as i32 - 6);
            let gate_width = rng.random_int(4, 8);
            let gap_pos = rng.random_int(1, gate_width - 1);

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
            let gate_x = rng.random_int(4, width as i32 - 4);
            let gate_y = rng.random_int(6, height as i32 - 6);
            let gate_height = rng.random_int(4, 8);
            let gap_pos = rng.random_int(1, gate_height - 1);

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

    for _ in 0..count {
        let mid_x = (start.x + goal.x) / 2;
        let mid_y = (start.y + goal.y) / 2;

        let cx = rng.random_int(
            (mid_x - 8).min(width as i32 - 10),
            (mid_x + 8).min(width as i32 - 6),
        );
        let cy = rng.random_int(
            (mid_y - 6).min(height as i32 - 8),
            (mid_y + 6).min(height as i32 - 6),
        );

        if !is_inner(cx, cy, width, height) {
            continue;
        }
        if tiles[cy as usize][cx as usize] != TileType::Ice {
            continue;
        }

        let mut backup: Vec<(Position, TileType)> = Vec::new();
        let mut magnet_positions: Vec<Position> = Vec::new();

        for dy in 0..=3 {
            for dx in 0..=3 {
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
        let far_x = cx + 4 * goal_dir.x;
        let far_y = cy + 4 * goal_dir.y;
        for i in -2..=2 {
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

// =============================================================================
// CONSTRAINT-BASED PUZZLE GENERATION
// =============================================================================

#[derive(Clone)]
struct WaypointConstraint {
    pos: Position,
    required_approach_dir: Direction,
}

fn get_opposite_corner_direction(
    _pos: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> Direction {
    let center_x = width as f64 / 2.0;
    let center_y = height as f64 / 2.0;

    if (goal.x as f64) > center_x && (goal.y as f64) > center_y {
        Direction::Up
    } else if (goal.x as f64) < center_x && (goal.y as f64) > center_y {
        Direction::Right
    } else if (goal.x as f64) > center_x && (goal.y as f64) < center_y {
        Direction::Left
    } else {
        Direction::Down
    }
}

fn add_decoy_branches(
    tiles: &mut Vec<Vec<TileType>>,
    waypoints: &[WaypointConstraint],
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) {
    for wp in waypoints {
        let intuitive_dirs = get_intuitive_direction(&wp.pos, goal);
        for decoy_dir in intuitive_dirs {
            if decoy_dir == wp.required_approach_dir {
                continue;
            }
            let decoy_length = rng.random_int(4, 10);
            let (dx, dy) = get_delta(decoy_dir);
            let mut x = wp.pos.x + dx;
            let mut y = wp.pos.y + dy;

            for _ in 0..decoy_length {
                if !is_inner(x, y, width, height) {
                    break;
                }
                if tiles[y as usize][x as usize] == TileType::Wall {
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
                x += dx;
                y += dy;
            }

            if is_valid(x, y, width, height) {
                tiles[y as usize][x as usize] = TileType::Wall;
            }

            if rng.random() < 0.6 && decoy_length > 3 {
                let perp_dirs = if decoy_dir == Direction::Up || decoy_dir == Direction::Down {
                    vec![Direction::Left, Direction::Right]
                } else {
                    vec![Direction::Up, Direction::Down]
                };
                let perp_dir = rng.random_choice(&perp_dirs);
                let (pdx, pdy) = get_delta(perp_dir);
                let branch_x = wp.pos.x + dx * (decoy_length / 2);
                let branch_y = wp.pos.y + dy * (decoy_length / 2);

                for i in 1..=rng.random_int(3, 6) {
                    let bx = branch_x + pdx * i;
                    let by = branch_y + pdy * i;
                    if !is_inner(bx, by, width, height) {
                        break;
                    }
                    if tiles[by as usize][bx as usize] == TileType::Wall {
                        tiles[by as usize][bx as usize] = TileType::Ice;
                    }
                }
            }
        }
    }
}

fn fill_with_decoy_ice(
    tiles: &mut Vec<Vec<TileType>>,
    _solution_path: &HashSet<String>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) {
    let fill_attempts = (width * height) as f64 * 0.15;
    for _ in 0..(fill_attempts as i32) {
        let x = rng.random_int(2, width as i32 - 2);
        let y = rng.random_int(2, height as i32 - 2);
        if tiles[y as usize][x as usize] != TileType::Wall {
            continue;
        }
        if pos_eq(&Position { x, y }, start) || pos_eq(&Position { x, y }, goal) {
            continue;
        }
        let mut has_adjacent_ice = false;
        for dir in get_all_dirs() {
            let (dx, dy) = get_delta(dir);
            let nx = x + dx;
            let ny = y + dy;
            if is_valid(nx, ny, width, height)
                && (tiles[ny as usize][nx as usize] == TileType::Ice
                    || tiles[ny as usize][nx as usize] == TileType::Ground)
            {
                has_adjacent_ice = true;
                break;
            }
        }
        if has_adjacent_ice && rng.random() < 0.4 {
            tiles[y as usize][x as usize] = TileType::Ice;
        }
    }
}

fn add_shortcut_blockers(
    tiles: &mut Vec<Vec<TileType>>,
    waypoints: &[WaypointConstraint],
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) {
    for i in 0..waypoints.len().saturating_sub(2) {
        let wp1 = &waypoints[i];
        let wp2 = &waypoints[i + 2];
        let mid_x = (wp1.pos.x + wp2.pos.x) / 2;
        let mid_y = (wp1.pos.y + wp2.pos.y) / 2;

        for dx in -2..=2 {
            for dy in -2..=2 {
                let wx = mid_x + dx;
                let wy = mid_y + dy;
                if !is_inner(wx, wy, width, height) {
                    continue;
                }
                if tiles[wy as usize][wx as usize] != TileType::Ice {
                    continue;
                }
                let pos = Position { x: wx, y: wy };
                if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                    continue;
                }

                tiles[wy as usize][wx as usize] = TileType::Wall;
                if !is_solvable(tiles, start, goal, width, height) {
                    tiles[wy as usize][wx as usize] = TileType::Ice;
                } else if rng.random() < 0.5 {
                    break;
                } else {
                    tiles[wy as usize][wx as usize] = TileType::Ice;
                }
            }
        }
    }

    let goal_approach_dirs = get_intuitive_direction(start, goal);
    for dir in goal_approach_dirs {
        let (dx, dy) = get_delta(dir);
        let mut x = start.x + dx * 3;
        let mut y = start.y + dy * 3;
        for _ in 0..15 {
            if !is_inner(x, y, width, height) {
                break;
            }
            if tiles[y as usize][x as usize] == TileType::Ice && rng.random() < 0.25 {
                tiles[y as usize][x as usize] = TileType::Wall;
                if !is_solvable(tiles, start, goal, width, height) {
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
            x += dx;
            y += dy;
        }
    }
}

fn generate_constraint_based_puzzle(
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
    chain_length: i32,
) -> Option<(Vec<Vec<TileType>>, Position, Position)> {
    let mut tiles = vec![vec![TileType::Wall; width]; height];
    let corners = [
        Position {
            x: width as i32 - 4,
            y: height as i32 - 4,
        },
        Position {
            x: 4,
            y: height as i32 - 4,
        },
        Position {
            x: width as i32 - 4,
            y: 4,
        },
        Position { x: 4, y: 4 },
    ];
    let goal = rng.random_choice(&corners);

    let mut waypoints: Vec<WaypointConstraint> = Vec::new();
    let mut current_pos = goal;
    let mut solution_path = HashSet::new();
    solution_path.insert(pos_key(&goal));

    for _ in 0..chain_length {
        let intuitive_dir = get_opposite_corner_direction(&current_pos, &goal, width, height);
        let possible_dirs: Vec<Direction> = get_all_dirs()
            .iter()
            .copied()
            .filter(|d| {
                if *d == intuitive_dir {
                    return false;
                }
                if *d == get_opposite_dir(intuitive_dir) && rng.random() < 0.7 {
                    return false;
                }
                true
            })
            .collect();
        if possible_dirs.is_empty() {
            break;
        }
        let approach_dir = rng.random_choice(&possible_dirs);
        let opp_dir = get_opposite_dir(approach_dir);
        let (dx, dy) = get_delta(opp_dir);

        let slide_distance = rng.random_int(3, 8);
        let mut source_pos = Position {
            x: current_pos.x + dx * slide_distance,
            y: current_pos.y + dy * slide_distance,
        };

        if !is_inner(source_pos.x, source_pos.y, width, height) {
            let mut found = false;
            for dist in (2..slide_distance).rev() {
                let try_pos = Position {
                    x: current_pos.x + dx * dist,
                    y: current_pos.y + dy * dist,
                };
                if is_inner(try_pos.x, try_pos.y, width, height) {
                    source_pos = try_pos;
                    found = true;
                    break;
                }
            }
            if !found {
                continue;
            }
        }

        let (path_dx, path_dy) = get_delta(approach_dir);
        let mut carve_x = source_pos.x;
        let mut carve_y = source_pos.y;
        while !pos_eq(
            &Position {
                x: carve_x,
                y: carve_y,
            },
            &current_pos,
        ) {
            if !is_inner(carve_x, carve_y, width, height) {
                break;
            }
            tiles[carve_y as usize][carve_x as usize] = TileType::Ice;
            solution_path.insert(pos_key(&Position {
                x: carve_x,
                y: carve_y,
            }));
            carve_x += path_dx;
            carve_y += path_dy;
        }
        tiles[current_pos.y as usize][current_pos.x as usize] = TileType::Ice;

        let stopper_x = current_pos.x + path_dx;
        let stopper_y = current_pos.y + path_dy;
        if is_valid(stopper_x, stopper_y, width, height) {
            tiles[stopper_y as usize][stopper_x as usize] = TileType::Wall;
        }

        waypoints.push(WaypointConstraint {
            pos: current_pos,
            required_approach_dir: approach_dir,
        });
        current_pos = source_pos;
    }

    if waypoints.len() < 5 {
        return None;
    }

    let start = current_pos;
    tiles[start.y as usize][start.x as usize] = TileType::Ice;

    add_decoy_branches(&mut tiles, &waypoints, &goal, width, height, rng);
    fill_with_decoy_ice(
        &mut tiles,
        &solution_path,
        &start,
        &goal,
        width,
        height,
        rng,
    );
    add_shortcut_blockers(&mut tiles, &waypoints, &start, &goal, width, height, rng);

    tiles[start.y as usize][start.x as usize] = TileType::Start;
    tiles[goal.y as usize][goal.x as usize] = TileType::Goal;

    if !is_solvable(&tiles, &start, &goal, width, height) {
        return None;
    }
    if !has_no_stuck_states(&tiles, &start, &goal, width, height) {
        return None;
    }

    Some((tiles.clone(), start, goal))
}

// =============================================================================
// FALLBACK PUZZLE
// =============================================================================

#[allow(dead_code)]
fn create_guaranteed_hard_puzzle(
    width: usize,
    height: usize,
    rng: &mut SeededRandom,
) -> PuzzleData {
    let mut tiles = vec![vec![TileType::Wall; width]; height];

    let corridor_y1 = (height as f64 * 0.2).floor() as i32;
    let corridor_y2 = (height as f64 * 0.5).floor() as i32;
    let corridor_y3 = (height as f64 * 0.8).floor() as i32;
    let corridor_x1 = (width as f64 * 0.15).floor() as i32;
    let corridor_x2 = (width as f64 * 0.4).floor() as i32;
    let corridor_x3 = (width as f64 * 0.6).floor() as i32;
    let corridor_x4 = (width as f64 * 0.85).floor() as i32;

    for cy in [corridor_y1, corridor_y2, corridor_y3] {
        for x in 2..(width as i32 - 2) {
            for dy in -1..=1 {
                let y = cy + dy;
                if is_inner(x, y, width, height) {
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }
    }

    for cx in [corridor_x1, corridor_x2, corridor_x3, corridor_x4] {
        for y in 2..(height as i32 - 2) {
            for dx in -1..=1 {
                let x = cx + dx;
                if is_inner(x, y, width, height) {
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }
    }

    let start = Position {
        x: corridor_x1,
        y: corridor_y1,
    };
    let goal = Position {
        x: corridor_x4,
        y: corridor_y3,
    };

    for x in corridor_x3 + 3..corridor_x4 - 2 {
        for y in corridor_y2 - 2..=corridor_y2 + 2 {
            if is_inner(x, y, width, height)
                && !pos_eq(&Position { x, y }, &start)
                && !pos_eq(&Position { x, y }, &goal)
            {
                tiles[y as usize][x as usize] = TileType::Wall;
            }
        }
    }

    for y in corridor_y2 + 3..corridor_y3 - 2 {
        let x = corridor_x4;
        if is_inner(x, y, width, height) {
            tiles[y as usize][x as usize] = TileType::Wall;
            tiles[y as usize][(x - 1) as usize] = TileType::Wall;
        }
    }

    for _ in 0..100 {
        let x = rng.random_int(3, width as i32 - 3);
        let y = rng.random_int(3, height as i32 - 3);
        if !pos_eq(&Position { x, y }, &start)
            && !pos_eq(&Position { x, y }, &goal)
            && tiles[y as usize][x as usize] == TileType::Ice
        {
            tiles[y as usize][x as usize] = TileType::Wall;
            if !is_solvable(&tiles, &start, &goal, width, height) {
                tiles[y as usize][x as usize] = TileType::Ice;
            }
        }
    }

    let ledge_positions = [
        Position {
            x: corridor_x2,
            y: corridor_y1 + 2,
        },
        Position {
            x: corridor_x3,
            y: corridor_y2 - 2,
        },
        Position {
            x: corridor_x2 + 2,
            y: corridor_y2,
        },
        Position {
            x: corridor_x3 - 2,
            y: corridor_y3,
        },
    ];
    let ledge_types = [
        TileType::LedgeDown,
        TileType::LedgeUp,
        TileType::LedgeRight,
        TileType::LedgeLeft,
    ];

    for (lp, lt) in ledge_positions.iter().zip(ledge_types.iter()) {
        if is_inner(lp.x, lp.y, width, height)
            && tiles[lp.y as usize][lp.x as usize] == TileType::Ice
            && !pos_eq(lp, &start)
            && !pos_eq(lp, &goal)
        {
            tiles[lp.y as usize][lp.x as usize] = *lt;
            if !is_solvable(&tiles, &start, &goal, width, height)
                || !has_no_stuck_states(&tiles, &start, &goal, width, height)
            {
                tiles[lp.y as usize][lp.x as usize] = TileType::Ice;
            }
        }
    }

    let escape_x = corridor_x1 - 2;
    for y in corridor_y1..=corridor_y3 {
        if is_inner(escape_x, y, width, height) {
            tiles[y as usize][escape_x as usize] = TileType::Ice;
        }
    }

    tiles[start.y as usize][start.x as usize] = TileType::Start;
    tiles[goal.y as usize][goal.x as usize] = TileType::Goal;

    if !is_solvable(&tiles, &start, &goal, width, height) {
        for y in corridor_y2 - 1..=corridor_y2 + 1 {
            for x in corridor_x1..=corridor_x4 {
                if is_inner(x, y, width, height) {
                    tiles[y as usize][x as usize] = TileType::Ice;
                }
            }
        }
    }

    let optimal_moves = find_path(&tiles, &start, &goal, width, height).unwrap_or(60);
    let psych = calculate_psychology_score(&tiles, &start, &goal, width, height);

    PuzzleData {
        width,
        height,
        tiles: tiles
            .iter()
            .map(|row| row.iter().map(|t| *t as u8).collect())
            .collect(),
        start,
        goal,
        optimal_moves,
        map_type: MapType::Ice,
        difficulty_score: Some(psych.psychology_score.round() as i32),
        counter_intuitive_moves: Some(psych.counter_intuitive_moves),
        attractive_decoys: Some(psych.attractive_decoys),
        commitment_gates: Some(psych.commitment_gates),
        false_progress_paths: Some(psych.false_progress_paths),
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
    log_to_console(&format!("[Rust] generate_puzzle called with seed: {}", seed));
    log_to_console(&format!("[Rust] Rayon thread pool has {} threads", num_threads));
    
    let (width, height) = {
        let mut rng = SeededRandom::new(seed);
        pick_size(&mut rng)
    };

    let constraint_attempts = if config.constraint_attempts > 0 {
        config.constraint_attempts
    } else {
        CONSTRAINT_ATTEMPTS
    };
    let traditional_attempts = if config.traditional_attempts > 0 {
        config.traditional_attempts
    } else {
        TRADITIONAL_ATTEMPTS
    };
    let target_score = if config.target_psychology_score > 0 {
        config.target_psychology_score as f64
    } else {
        TARGET_PSYCHOLOGY_SCORE
    };
    
    log_to_console(&format!("[Rust] Running {} constraint + {} traditional attempts", constraint_attempts, traditional_attempts));

    let mut batch = 0;
    loop {
        let cb_start = batch * constraint_attempts;
        let cb_end = cb_start + constraint_attempts;
        let trad_start = batch * traditional_attempts;
        let trad_end = trad_start + traditional_attempts;

        // Constraint attempts (parallel on native, sequential on WASM)
        let cb_best = find_best_in_range("constraint", cb_start..cb_end, |cb_attempt| {
            let mut cb_rng = SeededRandom::new(&format!("{}-cb-{}", seed, cb_attempt));
            let chain_length = cb_rng.random_int(16, 26);
            let (tiles, start, goal) =
                generate_constraint_based_puzzle(width, height, &mut cb_rng, chain_length)?;

            let optimal_moves = find_path(&tiles, &start, &goal, width, height)?;
            if optimal_moves < 20 {
                return None;
            }
            let psych_metrics =
                calculate_psychology_score(&tiles, &start, &goal, width, height);
            if !passes_prefilters(&psych_metrics) {
                return None;
            }
            let score = psych_metrics.psychology_score;

            let mut tiles = tiles;
            tiles[start.y as usize][start.x as usize] = TileType::Start;
            tiles[goal.y as usize][goal.x as usize] = TileType::Goal;

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
                map_type: MapType::Ice,
                difficulty_score: Some(score.round() as i32),
                counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
                attractive_decoys: Some(psych_metrics.attractive_decoys),
                commitment_gates: Some(psych_metrics.commitment_gates),
                false_progress_paths: Some(psych_metrics.false_progress_paths),
            };

            Some((puzzle, score))
        });

        if let Some((puzzle, score)) = cb_best.clone() {
            if score >= target_score
                && puzzle.counter_intuitive_moves.map_or(false, |v| v >= 8)
                && puzzle.attractive_decoys.map_or(false, |v| v >= 10)
                && puzzle.commitment_gates.map_or(false, |v| v >= 3)
            {
                log_to_console(&format!(
                    "[Rust] Selected puzzle from constraint attempts (batch {}, score {:.2})",
                    batch, score
                ));
                return puzzle;
            }
        }

        // Traditional attempts (parallel on native, sequential on WASM)
        let trad_best = find_best_in_range("traditional", trad_start..trad_end, |attempt| {
            let mut attempt_rng = SeededRandom::new(&format!("{}-trad-{}", seed, attempt));
            let mut tiles = create_base_maze(width, height, &mut attempt_rng);

            let mut ice_tiles: Vec<Position> = Vec::new();
            for y in 2..height - 2 {
                for x in 2..width - 2 {
                    if tiles[y][x] == TileType::Ice {
                        ice_tiles.push(Position {
                            x: x as i32,
                            y: y as i32,
                        });
                    }
                }
            }
            if ice_tiles.len() < 90 {
                return None;
            }

            let left_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x < width as i32 / 5)
                .cloned()
                .collect();
            let right_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x > (4 * width as i32) / 5)
                .cloned()
                .collect();
            let top_left_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x < width as i32 / 4 && p.y < height as i32 / 3)
                .cloned()
                .collect();
            let bottom_right_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x > (3 * width as i32) / 4 && p.y > (2 * height as i32) / 3)
                .cloned()
                .collect();

            let (start, goal) = if !top_left_tiles.is_empty()
                && !bottom_right_tiles.is_empty()
                && attempt_rng.random() < 0.6
            {
                (
                    attempt_rng.random_choice(&top_left_tiles),
                    attempt_rng.random_choice(&bottom_right_tiles),
                )
            } else if !left_tiles.is_empty() && !right_tiles.is_empty() {
                (
                    attempt_rng.random_choice(&left_tiles),
                    attempt_rng.random_choice(&right_tiles),
                )
            } else {
                return None;
            };

            widen_passages(&mut tiles, width, height, &mut attempt_rng, 0.20);
            let extra_connections = attempt_rng.random_int(35, 60);
            add_extra_connections(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                extra_connections,
            );
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            let island_count = attempt_rng.random_int(10, 18);
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
            let almost_count = attempt_rng.random_int(5, 10);
            create_almost_there_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                almost_count,
            );
            let decoy_open = attempt_rng.random_int(6, 12);
            create_decoy_open_areas(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                decoy_open,
            );
            let choke_count = attempt_rng.random_int(5, 10);
            create_hidden_choke_points(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                choke_count,
            );
            let momentum_count = attempt_rng.random_int(8, 16);
            create_momentum_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                momentum_count,
            );
            let anti_count = attempt_rng.random_int(5, 10);
            create_anti_gradient_zones(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                anti_count,
            );
            let parallel_count = attempt_rng.random_int(6, 12);
            create_parallel_path_illusion(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                parallel_count,
            );
            let ledge_count = attempt_rng.random_int(10, 18);
            create_ledge_misdirection(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                ledge_count,
            );
            let proximity_dead = attempt_rng.random_int(6, 12);
            create_goal_proximity_dead_ends(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                proximity_dead,
            );
            let commitment = attempt_rng.random_int(6, 12);
            create_commitment_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                commitment,
            );

            let precision = attempt_rng.random_int(8, 16);
            add_precision_gates(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                precision,
            );
            let funnel = attempt_rng.random_int(6, 12);
            add_funnel_patterns(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                funnel,
            );
            let alcoves = attempt_rng.random_int(10, 18);
            add_trap_alcoves(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                alcoves,
            );
            let deceptive = attempt_rng.random_int(25, 45);
            add_deceptive_paths(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                deceptive,
            );
            let dead_magnets = attempt_rng.random_int(6, 12);
            add_dead_end_magnets(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                dead_magnets,
            );
            let stop_blocks = attempt_rng.random_int(35, 60);
            add_stop_blocks(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                stop_blocks,
            );
            let floor_stops = attempt_rng.random_int(2, 4);
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
            let ledge_count = attempt_rng.random_int(20, 35);
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

            let optimal_moves = find_path(&tiles, &start, &goal, width, height)?;
            if !has_no_stuck_states(&tiles, &start, &goal, width, height) {
                return None;
            }
            if optimal_moves < 20 {
                return None;
            }

            let psych_metrics =
                calculate_psychology_score(&tiles, &start, &goal, width, height);
            if !passes_prefilters(&psych_metrics) {
                return None;
            }
            let score = psych_metrics.psychology_score;

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
                map_type: MapType::Ice,
                difficulty_score: Some(score.round() as i32),
                counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
                attractive_decoys: Some(psych_metrics.attractive_decoys),
                commitment_gates: Some(psych_metrics.commitment_gates),
                false_progress_paths: Some(psych_metrics.false_progress_paths),
            };

            Some((puzzle, score))
        });

        if let Some((puzzle, score)) = trad_best.clone() {
            if score >= target_score
                && puzzle.counter_intuitive_moves.map_or(false, |v| v >= 8)
                && puzzle.attractive_decoys.map_or(false, |v| v >= 10)
                && puzzle.commitment_gates.map_or(false, |v| v >= 3)
            {
                log_to_console(&format!(
                    "[Rust] Selected puzzle from traditional attempts (batch {}, score {:.2})",
                    batch, score
                ));
                return puzzle;
            }
        }

        // Pick best across both phases
        let mut best: Option<(PuzzleData, f64, &'static str)> = None;
        for (puzzle, score, label) in [
            cb_best.clone().map(|(p, s)| (p, s, "constraint")),
            trad_best.clone().map(|(p, s)| (p, s, "traditional")),
        ]
        .into_iter()
        .flatten()
        {
            if best.as_ref().map_or(true, |b| score > b.1) {
                best = Some((puzzle, score, label));
            }
        }

        if let Some((puzzle, score, label)) = best {
            log_to_console(&format!(
                "[Rust] Selected puzzle from {} attempts (batch {}, score {:.2})",
                label, batch, score
            ));
            return puzzle;
        }
        log_to_console(&format!(
            "[Rust] No puzzle met target in batch {}. Continuing...",
            batch
        ));
        batch += 1;
    }
}

// Partial puzzle generation for parallel workers
#[allow(dead_code)]
pub fn generate_puzzle_partial(
    seed: &str,
    constraint_start: usize,
    constraint_end: usize,
    traditional_start: usize,
    traditional_end: usize,
) -> (Option<PuzzleData>, f64) {
    let mut size_rng = SeededRandom::new(seed);
    let (width, height) = pick_size(&mut size_rng);

    let constraint_range = constraint_end - constraint_start;
    let traditional_range = traditional_end - traditional_start;
    let mut batch = 0;

    let mut best_puzzle: Option<PuzzleData> = None;
    let mut best_score = 0.0;

    loop {
        let cb_base = constraint_start + batch * constraint_range;
        let cb_limit = cb_base + constraint_range;
        let trad_base = traditional_start + batch * traditional_range;
        let trad_limit = trad_base + traditional_range;

        for cb_attempt in cb_base..cb_limit {
            let mut cb_rng = SeededRandom::new(&format!("{}-cb-{}", seed, cb_attempt));
            let chain_length = cb_rng.random_int(16, 26);
            if let Some((mut tiles, start, goal)) =
                generate_constraint_based_puzzle(width, height, &mut cb_rng, chain_length)
            {
                let optimal_moves = find_path(&tiles, &start, &goal, width, height);
                if optimal_moves.is_none() || optimal_moves.unwrap() < 20 {
                    continue;
                }
                let optimal_moves = optimal_moves.unwrap();
                let psych_metrics =
                    calculate_psychology_score(&tiles, &start, &goal, width, height);
                if !passes_prefilters(&psych_metrics) {
                    continue;
                }
                let score = psych_metrics.psychology_score;
                if score > best_score {
                    best_score = score;
                    tiles[start.y as usize][start.x as usize] = TileType::Start;
                    tiles[goal.y as usize][goal.x as usize] = TileType::Goal;
                    best_puzzle = Some(PuzzleData {
                        width,
                        height,
                        tiles: tiles
                            .iter()
                            .map(|row| row.iter().map(|t| *t as u8).collect())
                            .collect(),
                        start,
                        goal,
                        optimal_moves,
                        map_type: MapType::Ice,
                        difficulty_score: Some(score.round() as i32),
                        counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
                        attractive_decoys: Some(psych_metrics.attractive_decoys),
                        commitment_gates: Some(psych_metrics.commitment_gates),
                        false_progress_paths: Some(psych_metrics.false_progress_paths),
                    });
                }

                if score >= TARGET_PSYCHOLOGY_SCORE
                    && psych_metrics.counter_intuitive_moves >= 8
                    && psych_metrics.attractive_decoys >= 10
                    && psych_metrics.commitment_gates >= 3
                {
                    return (best_puzzle, best_score);
                }
            }
        }

        for attempt in trad_base..trad_limit {
            let mut attempt_rng = SeededRandom::new(&format!("{}-trad-{}", seed, attempt));
            let mut tiles = create_base_maze(width, height, &mut attempt_rng);

            let mut ice_tiles: Vec<Position> = Vec::new();
            for y in 2..height - 2 {
                for x in 2..width - 2 {
                    if tiles[y][x] == TileType::Ice {
                        ice_tiles.push(Position {
                            x: x as i32,
                            y: y as i32,
                        });
                    }
                }
            }
            if ice_tiles.len() < 90 {
                continue;
            }

            let left_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x < width as i32 / 5)
                .cloned()
                .collect();
            let right_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x > (4 * width as i32) / 5)
                .cloned()
                .collect();
            let top_left_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x < width as i32 / 4 && p.y < height as i32 / 3)
                .cloned()
                .collect();
            let bottom_right_tiles: Vec<_> = ice_tiles
                .iter()
                .filter(|p| p.x > (3 * width as i32) / 4 && p.y > (2 * height as i32) / 3)
                .cloned()
                .collect();

            let (start, goal) = if !top_left_tiles.is_empty()
                && !bottom_right_tiles.is_empty()
                && attempt_rng.random() < 0.6
            {
                (
                    attempt_rng.random_choice(&top_left_tiles),
                    attempt_rng.random_choice(&bottom_right_tiles),
                )
            } else if !left_tiles.is_empty() && !right_tiles.is_empty() {
                (
                    attempt_rng.random_choice(&left_tiles),
                    attempt_rng.random_choice(&right_tiles),
                )
            } else {
                continue;
            };

            widen_passages(&mut tiles, width, height, &mut attempt_rng, 0.20);
            let extra_connections = attempt_rng.random_int(35, 60);
            add_extra_connections(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                extra_connections,
            );
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            add_winding_corridors(&mut tiles, &start, &goal, width, height, &mut attempt_rng);
            let island_count = attempt_rng.random_int(10, 18);
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
            let almost_count = attempt_rng.random_int(5, 10);
            create_almost_there_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                almost_count,
            );
            let decoy_open = attempt_rng.random_int(6, 12);
            create_decoy_open_areas(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                decoy_open,
            );
            let choke_count = attempt_rng.random_int(5, 10);
            create_hidden_choke_points(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                choke_count,
            );
            let momentum_count = attempt_rng.random_int(8, 16);
            create_momentum_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                momentum_count,
            );
            let anti_count = attempt_rng.random_int(5, 10);
            create_anti_gradient_zones(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                anti_count,
            );
            let parallel_count = attempt_rng.random_int(6, 12);
            create_parallel_path_illusion(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                parallel_count,
            );
            let ledge_mis = attempt_rng.random_int(10, 18);
            create_ledge_misdirection(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                ledge_mis,
            );
            let proximity_dead = attempt_rng.random_int(6, 12);
            create_goal_proximity_dead_ends(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                proximity_dead,
            );
            let commitment = attempt_rng.random_int(6, 12);
            create_commitment_traps(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                commitment,
            );

            let precision = attempt_rng.random_int(8, 16);
            add_precision_gates(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                precision,
            );
            let funnel = attempt_rng.random_int(6, 12);
            add_funnel_patterns(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                funnel,
            );
            let alcoves = attempt_rng.random_int(10, 18);
            add_trap_alcoves(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                alcoves,
            );
            let deceptive = attempt_rng.random_int(25, 45);
            add_deceptive_paths(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                deceptive,
            );
            let dead_magnets = attempt_rng.random_int(6, 12);
            add_dead_end_magnets(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                dead_magnets,
            );
            let stop_blocks = attempt_rng.random_int(35, 60);
            add_stop_blocks(
                &mut tiles,
                &start,
                &goal,
                width,
                height,
                &mut attempt_rng,
                stop_blocks,
            );
            let floor_stops = attempt_rng.random_int(2, 4);
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
            let ledge_count = attempt_rng.random_int(20, 35);
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

            let optimal_moves = find_path(&tiles, &start, &goal, width, height);
            if optimal_moves.is_none() {
                continue;
            }
            let optimal_moves = optimal_moves.unwrap();
            if !has_no_stuck_states(&tiles, &start, &goal, width, height) {
                continue;
            }
            if optimal_moves < 20 {
                continue;
            }
            let psych_metrics = calculate_psychology_score(&tiles, &start, &goal, width, height);
            if !passes_prefilters(&psych_metrics) {
                continue;
            }
            let score = psych_metrics.psychology_score;
            if score > best_score {
                best_score = score;
                best_puzzle = Some(PuzzleData {
                    width,
                    height,
                    tiles: tiles
                        .iter()
                        .map(|row| row.iter().map(|t| *t as u8).collect())
                        .collect(),
                    start,
                    goal,
                    optimal_moves,
                    map_type: MapType::Ice,
                    difficulty_score: Some(score.round() as i32),
                    counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
                    attractive_decoys: Some(psych_metrics.attractive_decoys),
                    commitment_gates: Some(psych_metrics.commitment_gates),
                    false_progress_paths: Some(psych_metrics.false_progress_paths),
                });
            }

            if score >= TARGET_PSYCHOLOGY_SCORE
                && psych_metrics.counter_intuitive_moves >= 8
                && psych_metrics.attractive_decoys >= 10
                && psych_metrics.commitment_gates >= 3
            {
                return (best_puzzle, best_score);
            }
        }

        if best_puzzle.is_some() {
            return (best_puzzle, best_score);
        }
        batch += 1;
    }
}
