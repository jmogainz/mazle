// =============================================================================
// ICE GENERATOR - Faithful port of src/game/maps/ice/generator.ts
// This file mirrors the TypeScript structure exactly
// =============================================================================

use rand::prelude::*;
use rand_chacha::ChaCha8Rng;
use std::collections::{HashMap, HashSet};

use crate::types::{Direction, GenerationConfig, MapType, Position, PuzzleData};

// =============================================================================
// TILE TYPES (matching TypeScript enum values)
// =============================================================================

pub const GROUND: u8 = 0;
pub const WALL: u8 = 1;
pub const START: u8 = 2;
pub const GOAL: u8 = 3;
pub const ICE: u8 = 4;
pub const WATER: u8 = 5;
pub const LEDGE_UP: u8 = 6;
pub const LEDGE_DOWN: u8 = 7;
pub const LEDGE_LEFT: u8 = 8;
pub const LEDGE_RIGHT: u8 = 9;

// =============================================================================
// CONSTANTS (matching TypeScript)
// =============================================================================

const TARGET_PSYCHOLOGY_SCORE: i32 = 2000;
const CONSTRAINT_ATTEMPTS: usize = 160;
const TRADITIONAL_ATTEMPTS: usize = 400;

const SIZE_OPTIONS: [(usize, usize); 10] = [
    (35, 27),
    (37, 27),
    (35, 29),
    (37, 29),
    (39, 29),
    (37, 31),
    (39, 31),
    (41, 31),
    (41, 33),
    (43, 33),
];

// Psychology weights (matching TypeScript PSYCH_WEIGHTS)
const WEIGHT_COUNTER_INTUITIVE: i32 = 70;
const WEIGHT_ATTRACTIVE_DECOYS: i32 = 80;
const WEIGHT_COMMITMENT_GATES: i32 = 70;
const WEIGHT_FALSE_PROGRESS: i32 = 100;
const WEIGHT_MOVE_BONUS: f64 = 0.5;

// Prefilter thresholds
const MIN_COUNTER_INTUITIVE: i32 = 6;
const MIN_ATTRACTIVE_DECOYS: i32 = 8;
const MIN_COMMITMENT_GATES: i32 = 3;
const MIN_FALSE_PROGRESS: i32 = 8;

// =============================================================================
// SEEDED RANDOM (matching TypeScript SeededRandom class)
// =============================================================================

fn create_rng(seed: &str) -> ChaCha8Rng {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    seed.hash(&mut hasher);
    ChaCha8Rng::seed_from_u64(hasher.finish())
}

trait SeededRandomExt {
    fn random_int(&mut self, min: i32, max: i32) -> i32;
    fn random_choice<T: Clone>(&mut self, arr: &[T]) -> T;
    fn shuffle<T: Clone>(&mut self, arr: &[T]) -> Vec<T>;
}

impl SeededRandomExt for ChaCha8Rng {
    fn random_int(&mut self, min: i32, max: i32) -> i32 {
        min + (self.gen::<f64>() * (max - min) as f64).floor() as i32
    }

    fn random_choice<T: Clone>(&mut self, arr: &[T]) -> T {
        arr[self.random_int(0, arr.len() as i32) as usize].clone()
    }

    fn shuffle<T: Clone>(&mut self, arr: &[T]) -> Vec<T> {
        let mut result = arr.to_vec();
        for i in (1..result.len()).rev() {
            let j = self.random_int(0, (i + 1) as i32) as usize;
            result.swap(i, j);
        }
        result
    }
}

// =============================================================================
// POSITION UTILITIES (matching TypeScript)
// =============================================================================

fn is_valid(x: i32, y: i32, width: usize, height: usize) -> bool {
    x >= 0 && x < width as i32 && y >= 0 && y < height as i32
}

fn is_inner(x: i32, y: i32, width: usize, height: usize) -> bool {
    x > 0 && x < (width as i32 - 1) && y > 0 && y < (height as i32 - 1)
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

// =============================================================================
// MOVEMENT SIMULATION (matching TypeScript simulateMove exactly)
// =============================================================================

fn simulate_move(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    dir: Direction,
    width: usize,
    height: usize,
) -> (Position, bool) {
    let (dx, dy) = get_delta(dir);
    let mut x = start.x + dx;
    let mut y = start.y + dy;

    if !is_valid(x, y, width, height) {
        return (start.clone(), false);
    }

    let target_tile = tiles[y as usize][x as usize];

    if target_tile == WALL {
        return (start.clone(), false);
    }

    // Check ledge entry rules (matching TypeScript exactly)
    // LEDGE_UP: enter from above (moving DOWN), etc.
    if target_tile >= LEDGE_UP && target_tile <= LEDGE_RIGHT {
        let ledge_dir = target_tile - LEDGE_UP;
        let allowed_dirs = [
            Direction::Down,
            Direction::Up,
            Direction::Left,
            Direction::Right,
        ];
        if dir != allowed_dirs[ledge_dir as usize] {
            return (start.clone(), false);
        }
    }

    // Handle ice sliding
    if target_tile == ICE {
        let mut steps = 0;
        while steps < 100 {
            steps += 1;
            let next_x = x + dx;
            let next_y = y + dy;

            if !is_valid(next_x, next_y, width, height) {
                break;
            }

            let next_tile = tiles[next_y as usize][next_x as usize];

            if next_tile == WALL {
                break;
            }

            // Check ledge during slide
            if next_tile >= LEDGE_UP && next_tile <= LEDGE_RIGHT {
                let ledge_dir = next_tile - LEDGE_UP;
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

            if next_tile != ICE {
                break;
            }
        }
    }

    (Position::new(x, y), true)
}

// =============================================================================
// PATHFINDING (matching TypeScript exactly)
// =============================================================================

fn find_path(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> Option<i32> {
    let mut queue: Vec<(Position, i32)> = vec![(start.clone(), 0)];
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
            let (result_pos, valid) = simulate_move(tiles, &pos, dir, width, height);
            if valid {
                let key = pos_key(&result_pos);
                if !visited.contains(&key) {
                    visited.insert(key);
                    queue.push((result_pos, moves + 1));
                }
            }
        }
    }

    None
}

fn find_optimal_path(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> Option<Vec<Position>> {
    let mut queue: Vec<Position> = vec![start.clone()];
    let mut visited = HashSet::new();
    let mut parent: HashMap<String, Option<Position>> = HashMap::new();
    let start_key = pos_key(start);
    visited.insert(start_key.clone());
    parent.insert(start_key, None);
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head].clone();
        head += 1;

        if pos_eq(&current, goal) {
            // Reconstruct path
            let mut path: Vec<Position> = Vec::new();
            let mut pos: Option<Position> = Some(current);
            while let Some(p) = pos {
                path.push(p.clone());
                pos = parent.get(&pos_key(&p)).and_then(|opt| opt.clone());
            }
            path.reverse();
            return Some(path);
        }

        for dir in get_all_dirs() {
            let (result_pos, valid) = simulate_move(tiles, &current, dir, width, height);
            if valid {
                let key = pos_key(&result_pos);
                if !visited.contains(&key) {
                    visited.insert(key.clone());
                    parent.insert(key, Some(current.clone()));
                    queue.push(result_pos);
                }
            }
        }
    }

    None
}

fn get_reachable(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    width: usize,
    height: usize,
) -> HashSet<String> {
    let mut reachable = HashSet::new();
    let mut queue: Vec<Position> = vec![start.clone()];
    reachable.insert(pos_key(start));
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head].clone();
        head += 1;

        for dir in get_all_dirs() {
            let (result_pos, valid) = simulate_move(tiles, &current, dir, width, height);
            if valid {
                let key = pos_key(&result_pos);
                if !reachable.contains(&key) {
                    reachable.insert(key.clone());
                    queue.push(result_pos);
                }
            }
        }
    }

    reachable
}

fn is_solvable(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    w: usize,
    h: usize,
) -> bool {
    find_path(tiles, start, goal, w, h).is_some()
}

fn build_reverse_graph(
    tiles: &Vec<Vec<u8>>,
    width: usize,
    height: usize,
) -> HashMap<String, Vec<Position>> {
    let mut reverse_graph: HashMap<String, Vec<Position>> = HashMap::new();

    for y in 0..height {
        for x in 0..width {
            if tiles[y][x] == WALL {
                continue;
            }

            let pos = Position::new(x as i32, y as i32);
            for dir in get_all_dirs() {
                let (result_pos, valid) = simulate_move(tiles, &pos, dir, width, height);
                if valid && !pos_eq(&result_pos, &pos) {
                    let dest_key = pos_key(&result_pos);
                    reverse_graph
                        .entry(dest_key)
                        .or_insert_with(Vec::new)
                        .push(pos.clone());
                }
            }
        }
    }

    reverse_graph
}

fn get_can_reach_goal(
    tiles: &Vec<Vec<u8>>,
    goal: &Position,
    width: usize,
    height: usize,
) -> HashSet<String> {
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut can_reach_goal = HashSet::new();
    let mut queue: Vec<Position> = vec![goal.clone()];
    can_reach_goal.insert(pos_key(goal));
    let mut head = 0;

    while head < queue.len() {
        let current = queue[head].clone();
        head += 1;

        if let Some(sources) = reverse_graph.get(&pos_key(&current)) {
            for source in sources {
                let key = pos_key(source);
                if !can_reach_goal.contains(&key) {
                    can_reach_goal.insert(key);
                    queue.push(source.clone());
                }
            }
        }
    }

    can_reach_goal
}

fn has_no_stuck_states(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    w: usize,
    h: usize,
) -> bool {
    let reachable = get_reachable(tiles, start, w, h);
    let can_reach_goal = get_can_reach_goal(tiles, goal, w, h);

    for key in &reachable {
        if !can_reach_goal.contains(key) {
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
        if dx > 0 {
            Some(Direction::Right)
        } else {
            Some(Direction::Left)
        }
    } else if dy.abs() > dx.abs() {
        if dy > 0 {
            Some(Direction::Down)
        } else {
            Some(Direction::Up)
        }
    } else {
        None
    }
}

// =============================================================================
// SCORING FUNCTIONS (matching TypeScript exactly)
// =============================================================================

fn compute_distance_to_goal(
    tiles: &Vec<Vec<u8>>,
    goal: &Position,
    width: usize,
    height: usize,
) -> HashMap<String, i32> {
    let mut distances = HashMap::new();
    let reverse_graph = build_reverse_graph(tiles, width, height);

    let mut queue: Vec<(Position, i32)> = vec![(goal.clone(), 0)];
    distances.insert(pos_key(goal), 0);
    let mut head = 0;

    while head < queue.len() {
        let (current, dist) = queue[head].clone();
        head += 1;

        if let Some(sources) = reverse_graph.get(&pos_key(&current)) {
            for source in sources {
                let key = pos_key(source);
                if !distances.contains_key(&key) {
                    distances.insert(key, dist + 1);
                    queue.push((source.clone(), dist + 1));
                }
            }
        }
    }

    distances
}

fn trap_bonus(false_progress: i32, attractive_decoys: i32) -> i32 {
    let fp_bonus = if false_progress > 8 {
        (false_progress - 8) * 40
    } else {
        0
    };
    let decoy_bonus = if attractive_decoys > 12 {
        (attractive_decoys - 12) * 25
    } else {
        0
    };
    fp_bonus + decoy_bonus
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
    from: &Position,
    alt_pos: &Position,
    opt_pos: &Position,
    goal: &Position,
    tiles: &Vec<Vec<u8>>,
    width: usize,
    height: usize,
) -> bool {
    let alt_dist = manhattan_dist(alt_pos, goal);
    let opt_dist = manhattan_dist(opt_pos, goal);

    // Alternative gets closer - very attractive
    if alt_dist < opt_dist {
        return true;
    }

    // Same distance but in intuitive direction
    if alt_dist == opt_dist {
        let intuitive_dirs = get_intuitive_direction(from, goal);
        if let Some(alt_dir) = get_direction_between(from, alt_pos) {
            if intuitive_dirs.contains(&alt_dir) {
                return true;
            }
        }
    }

    // Alternative has more options
    let mut alt_options = 0;
    let mut opt_options = 0;

    for dir in get_all_dirs() {
        let (alt_result, alt_valid) = simulate_move(tiles, alt_pos, dir, width, height);
        if alt_valid && !pos_eq(&alt_result, alt_pos) {
            alt_options += 1;
        }

        let (opt_result, opt_valid) = simulate_move(tiles, opt_pos, dir, width, height);
        if opt_valid && !pos_eq(&opt_result, opt_pos) {
            opt_options += 1;
        }
    }

    alt_options > opt_options + 1
}

fn count_attractive_decoys(
    tiles: &Vec<Vec<u8>>,
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

            let (result_pos, valid) = simulate_move(tiles, current, dir, width, height);
            if !valid || pos_eq(&result_pos, current) {
                continue;
            }

            if is_move_attractive(
                current,
                &result_pos,
                optimal_next,
                goal,
                tiles,
                width,
                height,
            ) {
                count += 1;
            }
        }
    }

    count
}

fn count_commitment_gates(
    tiles: &Vec<Vec<u8>>,
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

        let mut max_wrong_cost = 0;

        for dir in get_all_dirs() {
            if dir == optimal_dir {
                continue;
            }

            let (result_pos, valid) = simulate_move(tiles, current, dir, width, height);
            if !valid || pos_eq(&result_pos, current) {
                continue;
            }

            if let Some(&wrong_dist) = distance_to_goal.get(&pos_key(&result_pos)) {
                let remaining_optimal = optimal_moves - i as i32;
                let wrong_cost = (wrong_dist + 1) - remaining_optimal;
                max_wrong_cost = max_wrong_cost.max(wrong_cost);
            }
        }

        if max_wrong_cost >= 5 {
            gate_count += 1;
        }
    }

    gate_count
}

fn count_false_progress_paths(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    optimal_moves: i32,
    distance_to_goal: &HashMap<String, i32>,
) -> i32 {
    let mut count = 0;
    let mut checked = HashSet::new();

    let start_dist = manhattan_dist(start, goal);
    let mut queue: Vec<(Position, i32, i32)> = vec![(start.clone(), 0, start_dist)];
    checked.insert(pos_key(start));
    let mut head = 0;

    while head < queue.len() {
        let (pos, dist_from_start, min_dist_seen) = queue[head].clone();
        head += 1;

        if dist_from_start > optimal_moves + 10 {
            continue;
        }

        for dir in get_all_dirs() {
            let (result_pos, valid) = simulate_move(tiles, &pos, dir, width, height);
            if !valid || pos_eq(&result_pos, &pos) {
                continue;
            }

            let key = pos_key(&result_pos);
            if checked.contains(&key) {
                continue;
            }
            checked.insert(key.clone());

            let new_dist_to_goal = manhattan_dist(&result_pos, goal);
            let new_dist_from_start = dist_from_start + 1;

            // Is this "progress"?
            let is_progress = new_dist_to_goal < min_dist_seen;

            if is_progress {
                if let Some(&path_from_here) = distance_to_goal.get(&key) {
                    let total_path = new_dist_from_start + path_from_here;
                    if total_path > optimal_moves + 3 {
                        count += 1;
                    }
                }
            }

            queue.push((
                result_pos,
                new_dist_from_start,
                min_dist_seen.min(new_dist_to_goal),
            ));
        }
    }

    count
}

#[derive(Debug, Clone)]
pub struct PsychologyMetrics {
    pub counter_intuitive_moves: i32,
    pub attractive_decoys: i32,
    pub commitment_gates: i32,
    pub false_progress_paths: i32,
    pub optimal_moves: i32,
    pub psychology_score: i32,
}

fn calculate_psychology_score(
    tiles: &Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
) -> PsychologyMetrics {
    let optimal_path = match find_optimal_path(tiles, start, goal, width, height) {
        Some(p) if p.len() >= 2 => p,
        _ => {
            return PsychologyMetrics {
                counter_intuitive_moves: 0,
                attractive_decoys: 0,
                commitment_gates: 0,
                false_progress_paths: 0,
                optimal_moves: 0,
                psychology_score: 0,
            };
        }
    };

    let optimal_moves = (optimal_path.len() - 1) as i32;
    let distance_to_goal = compute_distance_to_goal(tiles, goal, width, height);

    let counter_intuitive = count_counter_intuitive_moves(goal, &optimal_path);
    let attractive_decoys = count_attractive_decoys(tiles, goal, width, height, &optimal_path);
    let commitment_gates =
        count_commitment_gates(tiles, goal, width, height, &optimal_path, &distance_to_goal);
    let false_progress = count_false_progress_paths(
        tiles,
        start,
        goal,
        width,
        height,
        optimal_moves,
        &distance_to_goal,
    );

    let score = (counter_intuitive * WEIGHT_COUNTER_INTUITIVE)
        + (attractive_decoys * WEIGHT_ATTRACTIVE_DECOYS)
        + (commitment_gates * WEIGHT_COMMITMENT_GATES)
        + (false_progress * WEIGHT_FALSE_PROGRESS)
        + (optimal_moves as f64 * WEIGHT_MOVE_BONUS) as i32
        + trap_bonus(false_progress, attractive_decoys);

    PsychologyMetrics {
        counter_intuitive_moves: counter_intuitive,
        attractive_decoys,
        commitment_gates,
        false_progress_paths: false_progress,
        optimal_moves,
        psychology_score: score,
    }
}

fn passes_prefilters(metrics: &PsychologyMetrics) -> bool {
    metrics.counter_intuitive_moves >= MIN_COUNTER_INTUITIVE
        && metrics.attractive_decoys >= MIN_ATTRACTIVE_DECOYS
        && metrics.commitment_gates >= MIN_COMMITMENT_GATES
        && metrics.false_progress_paths >= MIN_FALSE_PROGRESS
}

// =============================================================================
// BASE MAZE GENERATION (matching TypeScript createBaseMaze)
// =============================================================================

fn create_base_maze(width: usize, height: usize, rng: &mut ChaCha8Rng) -> Vec<Vec<u8>> {
    let mut tiles = vec![vec![WALL; width]; height];
    let mut visited = HashSet::new();

    fn carve(
        tiles: &mut Vec<Vec<u8>>,
        visited: &mut HashSet<String>,
        x: i32,
        y: i32,
        width: usize,
        height: usize,
        rng: &mut ChaCha8Rng,
    ) {
        let pos = Position::new(x, y);
        visited.insert(pos_key(&pos));
        tiles[y as usize][x as usize] = ICE;

        let dirs = [(0i32, -2i32), (0, 2), (-2, 0), (2, 0)];
        let shuffled = rng.shuffle(&dirs);

        for (dx, dy) in shuffled {
            let nx = x + dx;
            let ny = y + dy;
            let npos = Position::new(nx, ny);

            if is_inner(nx, ny, width, height) && !visited.contains(&pos_key(&npos)) {
                tiles[(y + dy / 2) as usize][(x + dx / 2) as usize] = ICE;
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

// =============================================================================
// MODIFICATION FUNCTIONS
// =============================================================================

fn widen_passages(
    tiles: &mut Vec<Vec<u8>>,
    width: usize,
    height: usize,
    rng: &mut ChaCha8Rng,
    intensity: f64,
) {
    let mut to_open = Vec::new();

    for y in 2..height - 2 {
        for x in 2..width - 2 {
            if tiles[y][x] != WALL {
                continue;
            }
            let mut ice_neighbors = 0;
            for (dx, dy) in &[(0i32, 1i32), (0, -1), (1, 0), (-1, 0)] {
                let nx = (x as i32 + dx) as usize;
                let ny = (y as i32 + dy) as usize;
                if tiles[ny][nx] == ICE {
                    ice_neighbors += 1;
                }
            }
            if ice_neighbors >= 2 && rng.gen::<f64>() < intensity {
                to_open.push((x, y));
            }
        }
    }

    for (x, y) in to_open {
        tiles[y][x] = ICE;
    }
}

fn add_extra_connections(
    tiles: &mut Vec<Vec<u8>>,
    _start: &Position,
    _goal: &Position,
    width: usize,
    height: usize,
    rng: &mut ChaCha8Rng,
    count: i32,
) {
    let mut added = 0;
    let mut attempts = 0;

    while added < count && attempts < count * 5 {
        attempts += 1;
        let x = rng.random_int(2, (width - 2) as i32) as usize;
        let y = rng.random_int(2, (height - 2) as i32) as usize;

        if tiles[y][x] != WALL {
            continue;
        }

        let mut ice_count = 0;
        for (dx, dy) in &[(0i32, 1i32), (0, -1), (1, 0), (-1, 0)] {
            let nx = (x as i32 + dx) as usize;
            let ny = (y as i32 + dy) as usize;
            if tiles[ny][nx] == ICE {
                ice_count += 1;
            }
        }

        if ice_count >= 2 {
            tiles[y][x] = ICE;
            added += 1;
        }
    }
}

fn add_stop_blocks(
    tiles: &mut Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut ChaCha8Rng,
    count: i32,
) {
    let mut added = 0;
    let mut attempts = 0;

    while added < count && attempts < count * 10 {
        attempts += 1;
        let x = rng.random_int(3, (width - 3) as i32);
        let y = rng.random_int(3, (height - 3) as i32);
        let pos = Position::new(x, y);

        if pos_eq(&pos, start) || pos_eq(&pos, goal) {
            continue;
        }
        if tiles[y as usize][x as usize] != ICE {
            continue;
        }

        tiles[y as usize][x as usize] = WALL;

        if is_solvable(tiles, start, goal, width, height) {
            added += 1;
        } else {
            tiles[y as usize][x as usize] = ICE;
        }
    }
}

fn add_ledges(
    tiles: &mut Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    rng: &mut ChaCha8Rng,
    count: i32,
) {
    let ledge_types = [LEDGE_UP, LEDGE_DOWN, LEDGE_LEFT, LEDGE_RIGHT];
    let mut added = 0;
    let mut attempts = 0;

    while added < count && attempts < count * 10 {
        attempts += 1;
        let x = rng.random_int(4, (width - 4) as i32);
        let y = rng.random_int(4, (height - 4) as i32);
        let pos = Position::new(x, y);

        if pos_eq(&pos, start) || pos_eq(&pos, goal) {
            continue;
        }
        if tiles[y as usize][x as usize] != ICE {
            continue;
        }

        let ledge_type = ledge_types[rng.random_int(0, 4) as usize];
        let old_tile = tiles[y as usize][x as usize];
        tiles[y as usize][x as usize] = ledge_type;

        if is_solvable(tiles, start, goal, width, height)
            && has_no_stuck_states(tiles, start, goal, width, height)
        {
            added += 1;
        } else {
            tiles[y as usize][x as usize] = old_tile;
        }
    }
}

fn convert_floors_to_ice(
    tiles: &mut Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    _rng: &mut ChaCha8Rng,
    intensity: f64,
) {
    let mut floor_tiles: Vec<(usize, usize)> = Vec::new();

    for y in 2..height - 2 {
        for x in 2..width - 2 {
            let pos = Position::new(x as i32, y as i32);
            if !pos_eq(&pos, start) && !pos_eq(&pos, goal) && tiles[y][x] == GROUND {
                floor_tiles.push((x, y));
            }
        }
    }

    let to_convert = (floor_tiles.len() as f64 * intensity) as usize;
    for (x, y) in floor_tiles.into_iter().take(to_convert) {
        tiles[y][x] = ICE;
    }
}

// =============================================================================
// DECEPTION ALGORITHMS (simplified versions - key ones)
// =============================================================================

fn engineer_counter_intuitive_path(
    tiles: &mut Vec<Vec<u8>>,
    start: &Position,
    goal: &Position,
    width: usize,
    height: usize,
    _rng: &mut ChaCha8Rng,
) {
    let intuitive_dirs = get_intuitive_direction(start, goal);

    for r in 2..=6 {
        for &dir in &intuitive_dirs {
            let (dx, dy) = get_delta(dir);
            let x = goal.x - dx * r;
            let y = goal.y - dy * r;

            if !is_inner(x, y, width, height) {
                continue;
            }
            let pos = Position::new(x, y);
            if pos_eq(&pos, start) || pos_eq(&pos, goal) {
                continue;
            }
            if tiles[y as usize][x as usize] != ICE {
                continue;
            }

            tiles[y as usize][x as usize] = WALL;

            if !is_solvable(tiles, start, goal, width, height) {
                tiles[y as usize][x as usize] = ICE;
            }
        }
    }
}

// =============================================================================
// MAIN GENERATION FUNCTION
// =============================================================================

fn generate_attempt(
    seed: &str,
    attempt: usize,
    width: usize,
    height: usize,
) -> Option<(PuzzleData, i32)> {
    let mut rng = create_rng(&format!("{}-trad-{}", seed, attempt));

    let mut tiles = create_base_maze(width, height, &mut rng);

    // Find ice tiles
    let mut ice_tiles: Vec<Position> = Vec::new();
    for y in 2..height - 2 {
        for x in 2..width - 2 {
            if tiles[y][x] == ICE {
                ice_tiles.push(Position::new(x as i32, y as i32));
            }
        }
    }

    if ice_tiles.len() < 90 {
        return None;
    }

    // Pick start/goal positions
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
    let top_left: Vec<_> = ice_tiles
        .iter()
        .filter(|p| p.x < width as i32 / 4 && p.y < height as i32 / 3)
        .cloned()
        .collect();
    let bottom_right: Vec<_> = ice_tiles
        .iter()
        .filter(|p| p.x > (3 * width as i32) / 4 && p.y > (2 * height as i32) / 3)
        .cloned()
        .collect();

    let (start, goal) =
        if !top_left.is_empty() && !bottom_right.is_empty() && rng.gen::<f64>() < 0.6 {
            (
                rng.random_choice(&top_left),
                rng.random_choice(&bottom_right),
            )
        } else if !left_tiles.is_empty() && !right_tiles.is_empty() {
            (
                rng.random_choice(&left_tiles),
                rng.random_choice(&right_tiles),
            )
        } else {
            return None;
        };

    // Apply modifications
    widen_passages(&mut tiles, width, height, &mut rng, 0.20);
    let count = rng.random_int(35, 60);
    add_extra_connections(&mut tiles, &start, &goal, width, height, &mut rng, count);

    // Deception
    engineer_counter_intuitive_path(&mut tiles, &start, &goal, width, height, &mut rng);

    // Stop blocks and ledges
    let count = rng.random_int(35, 60);
    add_stop_blocks(&mut tiles, &start, &goal, width, height, &mut rng, count);
    let count = rng.random_int(2, 4);
    // add_floor_stops would go here
    convert_floors_to_ice(&mut tiles, &start, &goal, width, height, &mut rng, 0.82);
    let count = rng.random_int(20, 35);
    add_ledges(&mut tiles, &start, &goal, width, height, &mut rng, count);

    // Calculate score BEFORE setting start/goal tiles
    let optimal_moves = find_path(&tiles, &start, &goal, width, height)?;
    if optimal_moves < 20 {
        return None;
    }

    if !has_no_stuck_states(&tiles, &start, &goal, width, height) {
        return None;
    }

    let psych_metrics = calculate_psychology_score(&tiles, &start, &goal, width, height);
    if !passes_prefilters(&psych_metrics) {
        return None;
    }

    // NOW set start/goal for display
    tiles[start.y as usize][start.x as usize] = START;
    tiles[goal.y as usize][goal.x as usize] = GOAL;

    let score = psych_metrics.psychology_score;

    let puzzle = PuzzleData {
        width,
        height,
        tiles: tiles
            .iter()
            .map(|row| row.iter().map(|&t| t).collect())
            .collect(),
        start: start.clone(),
        goal: goal.clone(),
        optimal_moves,
        map_type: MapType::Ice,
        difficulty_score: Some(score),
        counter_intuitive_moves: Some(psych_metrics.counter_intuitive_moves),
        attractive_decoys: Some(psych_metrics.attractive_decoys),
        commitment_gates: Some(psych_metrics.commitment_gates),
        false_progress_paths: Some(psych_metrics.false_progress_paths),
    };

    Some((puzzle, score))
}

pub fn generate_puzzle(seed: &str, config: &GenerationConfig) -> PuzzleData {
    let mut rng = create_rng(seed);
    let (width, height) = SIZE_OPTIONS[rng.random_int(0, SIZE_OPTIONS.len() as i32) as usize];

    let mut best_puzzle: Option<PuzzleData> = None;
    let mut best_score = 0;

    // Traditional generation
    for attempt in 0..config.max_attempts.min(TRADITIONAL_ATTEMPTS) {
        if let Some((puzzle, score)) = generate_attempt(seed, attempt, width, height) {
            if score > best_score {
                best_score = score;
                best_puzzle = Some(puzzle);
            }

            if score >= TARGET_PSYCHOLOGY_SCORE {
                if let Some(ref p) = best_puzzle {
                    if p.counter_intuitive_moves.unwrap_or(0) >= 8
                        && p.attractive_decoys.unwrap_or(0) >= 10
                        && p.commitment_gates.unwrap_or(0) >= 3
                    {
                        return best_puzzle.unwrap();
                    }
                }
            }
        }
    }

    // Return best found or create fallback
    best_puzzle.unwrap_or_else(|| {
        let mut tiles = create_base_maze(width, height, &mut rng);

        // Simple start/goal selection
        let start = Position::new(4, 4);
        let goal = Position::new(width as i32 - 5, height as i32 - 5);

        // Make sure start/goal are on ice
        tiles[start.y as usize][start.x as usize] = ICE;
        tiles[goal.y as usize][goal.x as usize] = ICE;

        let optimal_moves = find_path(&tiles, &start, &goal, width, height).unwrap_or(30);
        let psych = calculate_psychology_score(&tiles, &start, &goal, width, height);

        tiles[start.y as usize][start.x as usize] = START;
        tiles[goal.y as usize][goal.x as usize] = GOAL;

        PuzzleData {
            width,
            height,
            tiles: tiles.iter().map(|row| row.to_vec()).collect(),
            start,
            goal,
            optimal_moves,
            map_type: MapType::Ice,
            difficulty_score: Some(psych.psychology_score),
            counter_intuitive_moves: Some(psych.counter_intuitive_moves),
            attractive_decoys: Some(psych.attractive_decoys),
            commitment_gates: Some(psych.commitment_gates),
            false_progress_paths: Some(psych.false_progress_paths),
        }
    })
}
