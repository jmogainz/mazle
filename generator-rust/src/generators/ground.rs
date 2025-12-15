// Placeholder ground generator: fast, deterministic, and solvable.
// This is intentionally simpler than the TS implementation and should be
// replaced with a full 1:1 port later.

use std::collections::VecDeque;

use rand::prelude::*;
use rand_chacha::ChaCha8Rng;

use crate::types::{Direction, GenerationConfig, MapType, Position, PuzzleData, TileType};

const SIZE_OPTIONS: [(usize, usize); 8] = [
    (28, 22),
    (30, 22),
    (30, 24),
    (32, 24),
    (32, 26),
    (34, 26),
    (34, 28),
    (36, 28),
];

fn create_rng(seed: &str) -> ChaCha8Rng {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    seed.hash(&mut hasher);
    ChaCha8Rng::seed_from_u64(hasher.finish())
}

fn get_delta(dir: Direction) -> (i32, i32) {
    match dir {
        Direction::Up => (0, -1),
        Direction::Down => (0, 1),
        Direction::Left => (-1, 0),
        Direction::Right => (1, 0),
    }
}

fn is_valid(x: i32, y: i32, w: usize, h: usize) -> bool {
    x >= 0 && x < w as i32 && y >= 0 && y < h as i32
}

fn simulate_move(
    tiles: &Vec<Vec<TileType>>,
    start: Position,
    dir: Direction,
    width: usize,
    height: usize,
) -> Option<Position> {
    let (dx, dy) = get_delta(dir);
    let mut x = start.x + dx;
    let mut y = start.y + dy;

    if !is_valid(x, y, width, height) {
        return None;
    }

    let target = tiles[y as usize][x as usize];
    if target == TileType::Wall || target == TileType::Boulder {
        return None;
    }

    // Ledge entry rules
    if target == TileType::LedgeUp && dir != Direction::Down {
        return None;
    }
    if target == TileType::LedgeDown && dir != Direction::Up {
        return None;
    }
    if target == TileType::LedgeLeft && dir != Direction::Left {
        return None;
    }
    if target == TileType::LedgeRight && dir != Direction::Right {
        return None;
    }

    // Ice slide
    if target == TileType::Ice {
        let mut steps = 0;
        while steps < 100 {
            steps += 1;
            let nx = x + dx;
            let ny = y + dy;
            if !is_valid(nx, ny, width, height) {
                break;
            }
            let next = tiles[ny as usize][nx as usize];
            if next == TileType::Wall || next == TileType::Boulder {
                break;
            }
            if (next == TileType::LedgeUp && dir != Direction::Down)
                || (next == TileType::LedgeDown && dir != Direction::Up)
                || (next == TileType::LedgeLeft && dir != Direction::Left)
                || (next == TileType::LedgeRight && dir != Direction::Right)
            {
                break;
            }
            x = nx;
            y = ny;
            if next != TileType::Ice {
                break;
            }
        }
    }

    Some(Position { x, y })
}

fn bfs_path(
    tiles: &Vec<Vec<TileType>>,
    start: Position,
    goal: Position,
    width: usize,
    height: usize,
) -> Option<i32> {
    let mut q = VecDeque::new();
    let mut visited = vec![vec![false; width]; height];
    q.push_back((start, 0));
    visited[start.y as usize][start.x as usize] = true;

    while let Some((pos, dist)) = q.pop_front() {
        if pos == goal {
            return Some(dist);
        }
        for dir in [
            Direction::Up,
            Direction::Down,
            Direction::Left,
            Direction::Right,
        ] {
            if let Some(next) = simulate_move(tiles, pos, dir, width, height) {
                if !visited[next.y as usize][next.x as usize] {
                    visited[next.y as usize][next.x as usize] = true;
                    q.push_back((next, dist + 1));
                }
            }
        }
    }
    None
}

fn build_tiles(rng: &mut ChaCha8Rng, width: usize, height: usize) -> Vec<Vec<TileType>> {
    let mut tiles = vec![vec![TileType::Wall; width]; height];

    // carve interior ground
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            tiles[y][x] = TileType::Ground;
        }
    }

    // sprinkle a few walls/ice/ledges for flavor
    let wall_count = (width * height / 30) as i32;
    for _ in 0..wall_count {
        let x = rng.gen_range(2..width - 2);
        let y = rng.gen_range(2..height - 2);
        tiles[y][x] = TileType::Wall;
    }

    let ice_count = (width * height / 40) as i32;
    for _ in 0..ice_count {
        let x = rng.gen_range(2..width - 2);
        let y = rng.gen_range(2..height - 2);
        if tiles[y][x] == TileType::Ground {
            tiles[y][x] = TileType::Ice;
        }
    }

    let ledge_types = [
        TileType::LedgeUp,
        TileType::LedgeDown,
        TileType::LedgeLeft,
        TileType::LedgeRight,
    ];
    let ledge_count = 2;
    for _ in 0..ledge_count {
        let x = rng.gen_range(2..width - 2);
        let y = rng.gen_range(2..height - 2);
        if tiles[y][x] == TileType::Ground {
            tiles[y][x] = ledge_types[rng.gen_range(0..ledge_types.len())];
        }
    }

    tiles
}

fn make_placeholder(seed: &str, width: usize, height: usize) -> PuzzleData {
    let mut rng = create_rng(seed);
    let start = Position { x: 1, y: 1 };
    let goal = Position {
        x: (width as i32 - 2),
        y: (height as i32 - 2),
    };

    let mut attempt = 0;
    let max_attempts = 200;
    let (mut best_tiles, mut best_len) = (None, None);

    while attempt < max_attempts {
        attempt += 1;
        let mut tiles = build_tiles(&mut rng, width, height);
        tiles[start.y as usize][start.x as usize] = TileType::Ground;
        tiles[goal.y as usize][goal.x as usize] = TileType::Ground;

        if let Some(len) = bfs_path(&tiles, start, goal, width, height) {
            best_tiles = Some(tiles);
            best_len = Some(len);
            break;
        }
    }

    let tiles = best_tiles.unwrap_or_else(|| build_tiles(&mut rng, width, height));
    let optimal_moves = best_len.unwrap_or_else(|| {
        bfs_path(&tiles, start, goal, width, height).unwrap_or((width + height) as i32)
    });

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
        solution_path: None,
        map_type: MapType::Ground,
        difficulty_score: Some(optimal_moves),
        // Original metrics (Phase 0) - not computed for ground
        counter_intuitive_moves: None,
        attractive_decoys: None,
        commitment_gates: None,
        false_progress_paths: None,
        // Path structure metrics (Phase 1) - not computed for ground
        path_locality: None,
        direction_changes: None,
        backtrack_depth: None,
        decision_ambiguity: None,
        // Path diversity metrics (Phase 2) - not computed for ground
        near_optimal_paths: None,
        path_overlap: None,
        early_divergence: None,
    }
}

pub fn generate_puzzle(seed: &str, _config: &GenerationConfig) -> PuzzleData {
    let mut rng = create_rng(seed);
    let (width, height) = SIZE_OPTIONS[rng.gen_range(0..SIZE_OPTIONS.len())];
    make_placeholder(seed, width, height)
}
