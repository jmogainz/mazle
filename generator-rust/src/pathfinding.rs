use crate::simulation::simulate_move;
use crate::types::{Direction, Grid, Position, TileType};
use std::collections::{HashMap, HashSet, VecDeque};

/// Find shortest path length using BFS
pub fn find_path(grid: &Grid, start: Position, goal: Position) -> Option<i32> {
    let mut queue = VecDeque::with_capacity(256);
    let mut visited = HashSet::with_capacity(256);

    queue.push_back((start, 0));
    visited.insert(start.key());

    while let Some((pos, moves)) = queue.pop_front() {
        if pos == goal {
            return Some(moves);
        }

        for dir in Direction::ALL {
            let result = simulate_move(grid, pos, dir);
            if result.valid {
                let key = result.pos.key();
                if !visited.contains(&key) {
                    visited.insert(key);
                    queue.push_back((result.pos, moves + 1));
                }
            }
        }
    }

    None
}

/// Find optimal path with positions using BFS
pub fn find_optimal_path(grid: &Grid, start: Position, goal: Position) -> Option<Vec<Position>> {
    let mut queue = VecDeque::with_capacity(256);
    let mut visited = HashSet::with_capacity(256);
    let mut parent: HashMap<u32, Option<Position>> = HashMap::with_capacity(256);

    let start_key = start.key();
    queue.push_back(start);
    visited.insert(start_key);
    parent.insert(start_key, None);

    while let Some(pos) = queue.pop_front() {
        if pos == goal {
            // Reconstruct path
            let mut path = Vec::new();
            let mut current = Some(pos);
            while let Some(p) = current {
                path.push(p);
                current = parent.get(&p.key()).copied().flatten();
            }
            path.reverse();
            return Some(path);
        }

        for dir in Direction::ALL {
            let result = simulate_move(grid, pos, dir);
            if result.valid {
                let key = result.pos.key();
                if !visited.contains(&key) {
                    visited.insert(key);
                    parent.insert(key, Some(pos));
                    queue.push_back(result.pos);
                }
            }
        }
    }

    None
}

/// Get all reachable positions from start
pub fn get_reachable(grid: &Grid, start: Position) -> HashSet<u32> {
    let mut reachable = HashSet::with_capacity(256);
    let mut queue = VecDeque::with_capacity(256);

    reachable.insert(start.key());
    queue.push_back(start);

    while let Some(pos) = queue.pop_front() {
        for dir in Direction::ALL {
            let result = simulate_move(grid, pos, dir);
            if result.valid {
                let key = result.pos.key();
                if !reachable.contains(&key) {
                    reachable.insert(key);
                    queue.push_back(result.pos);
                }
            }
        }
    }

    reachable
}

/// Build reverse graph: for each position, which positions can reach it
pub fn build_reverse_graph(grid: &Grid) -> HashMap<u32, Vec<Position>> {
    let mut reverse_graph: HashMap<u32, Vec<Position>> = HashMap::with_capacity(256);

    for y in 0..grid.height as i32 {
        for x in 0..grid.width as i32 {
            if let Some(tile) = grid.get(x, y) {
                if tile == TileType::Wall {
                    continue;
                }

                let from = Position::new(x, y);
                for dir in Direction::ALL {
                    let result = simulate_move(grid, from, dir);
                    if result.valid && result.pos != from {
                        let dest_key = result.pos.key();
                        reverse_graph
                            .entry(dest_key)
                            .or_insert_with(Vec::new)
                            .push(from);
                    }
                }
            }
        }
    }

    reverse_graph
}

/// Get all positions that can reach the goal using reverse BFS
pub fn get_can_reach_goal(grid: &Grid, goal: Position) -> HashSet<u32> {
    let reverse_graph = build_reverse_graph(grid);

    let mut can_reach = HashSet::with_capacity(256);
    let mut queue = VecDeque::with_capacity(256);

    can_reach.insert(goal.key());
    queue.push_back(goal);

    while let Some(pos) = queue.pop_front() {
        if let Some(sources) = reverse_graph.get(&pos.key()) {
            for &source in sources {
                let key = source.key();
                if !can_reach.contains(&key) {
                    can_reach.insert(key);
                    queue.push_back(source);
                }
            }
        }
    }

    can_reach
}

/// Compute distance from every position to goal using reverse BFS
pub fn compute_distance_to_goal(grid: &Grid, goal: Position) -> HashMap<u32, i32> {
    let reverse_graph = build_reverse_graph(grid);

    let mut distances = HashMap::with_capacity(256);
    let mut queue = VecDeque::with_capacity(256);

    distances.insert(goal.key(), 0);
    queue.push_back((goal, 0));

    while let Some((pos, dist)) = queue.pop_front() {
        if let Some(sources) = reverse_graph.get(&pos.key()) {
            for &source in sources {
                let key = source.key();
                if !distances.contains_key(&key) {
                    distances.insert(key, dist + 1);
                    queue.push_back((source, dist + 1));
                }
            }
        }
    }

    distances
}

/// Check if puzzle is solvable
pub fn is_solvable(grid: &Grid, start: Position, goal: Position) -> bool {
    find_path(grid, start, goal).is_some()
}

/// Verify no stuck states - all reachable positions can reach goal
pub fn has_no_stuck_states(grid: &Grid, start: Position, goal: Position) -> bool {
    let reachable = get_reachable(grid, start);
    let can_reach_goal = get_can_reach_goal(grid, goal);

    reachable.iter().all(|key| can_reach_goal.contains(key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_path() {
        let mut grid = Grid::new(5, 5, TileType::Ground);
        let start = Position::new(0, 0);
        let goal = Position::new(4, 0);

        let path_len = find_path(&grid, start, goal);
        assert_eq!(path_len, Some(4));
    }

    #[test]
    fn test_blocked_path() {
        let mut grid = Grid::new(5, 5, TileType::Ground);
        // Create a wall barrier
        for y in 0..5 {
            grid.set(2, y, TileType::Wall);
        }

        let start = Position::new(0, 0);
        let goal = Position::new(4, 0);

        let path_len = find_path(&grid, start, goal);
        assert_eq!(path_len, None);
    }
}
