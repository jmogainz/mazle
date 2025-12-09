use crate::pathfinding::{compute_distance_to_goal, find_optimal_path};
use crate::simulation::{get_direction_between, get_intuitive_directions, simulate_move};
use crate::types::{Direction, Grid, Position, PsychologyMetrics};
use std::collections::{HashMap, HashSet, VecDeque};

/// Psychology scoring weights
const WEIGHT_COUNTER_INTUITIVE: i32 = 70;
const WEIGHT_ATTRACTIVE_DECOYS: i32 = 80;
const WEIGHT_COMMITMENT_GATES: i32 = 70;
const WEIGHT_FALSE_PROGRESS: i32 = 100;
const WEIGHT_MOVE_BONUS: f32 = 0.5;

/// Prefilter thresholds
const MIN_COUNTER_INTUITIVE: i32 = 6;
const MIN_ATTRACTIVE_DECOYS: i32 = 8;
const MIN_COMMITMENT_GATES: i32 = 3;
const MIN_FALSE_PROGRESS: i32 = 8;

/// Nonlinear bonus for trap-heavy layouts
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

/// Count moves on optimal path that go away from goal
fn count_counter_intuitive_moves(goal: Position, optimal_path: &[Position]) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }

    let mut count = 0;
    for i in 0..optimal_path.len() - 1 {
        let current = optimal_path[i];
        let next = optimal_path[i + 1];

        if let Some(move_dir) = get_direction_between(current, next) {
            let intuitive_dirs = get_intuitive_directions(current, goal);
            if !intuitive_dirs.contains(&move_dir) {
                count += 1;
            }
        }
    }

    count
}

/// Check if an alternative move looks attractive compared to optimal
fn is_move_attractive(
    grid: &Grid,
    from: Position,
    alt_pos: Position,
    opt_pos: Position,
    goal: Position,
) -> bool {
    let alt_dist = alt_pos.manhattan_distance(goal);
    let opt_dist = opt_pos.manhattan_distance(goal);

    // Alternative gets closer to goal than optimal - very attractive
    if alt_dist < opt_dist {
        return true;
    }

    // Same distance but moves toward goal direction
    if alt_dist == opt_dist {
        let intuitive_dirs = get_intuitive_directions(from, goal);
        if let Some(alt_dir) = get_direction_between(from, alt_pos) {
            if intuitive_dirs.contains(&alt_dir) {
                return true;
            }
        }
    }

    // Alternative has more options (feels safer)
    let mut alt_options = 0;
    let mut opt_options = 0;

    for dir in Direction::ALL {
        let alt_result = simulate_move(grid, alt_pos, dir);
        if alt_result.valid && alt_result.pos != alt_pos {
            alt_options += 1;
        }

        let opt_result = simulate_move(grid, opt_pos, dir);
        if opt_result.valid && opt_result.pos != opt_pos {
            opt_options += 1;
        }
    }

    alt_options > opt_options + 1
}

/// Count positions where wrong moves look better than optimal
fn count_attractive_decoys(grid: &Grid, goal: Position, optimal_path: &[Position]) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }

    let mut count = 0;

    for i in 0..optimal_path.len() - 1 {
        let current = optimal_path[i];
        let optimal_next = optimal_path[i + 1];

        let optimal_dir = match get_direction_between(current, optimal_next) {
            Some(d) => d,
            None => continue,
        };

        for dir in Direction::ALL {
            if dir == optimal_dir {
                continue;
            }

            let result = simulate_move(grid, current, dir);
            if !result.valid || result.pos == current {
                continue;
            }

            if is_move_attractive(grid, current, result.pos, optimal_next, goal) {
                count += 1;
            }
        }
    }

    count
}

/// Count positions where wrong choice is very costly (5+ extra moves)
fn count_commitment_gates(
    grid: &Grid,
    _goal: Position,
    optimal_path: &[Position],
    distance_to_goal: &HashMap<u32, i32>,
) -> i32 {
    if optimal_path.len() < 2 {
        return 0;
    }

    let optimal_moves = (optimal_path.len() - 1) as i32;
    let mut gate_count = 0;

    for i in 0..optimal_path.len() - 1 {
        let current = optimal_path[i];
        let optimal_next = optimal_path[i + 1];

        let optimal_dir = match get_direction_between(current, optimal_next) {
            Some(d) => d,
            None => continue,
        };

        let mut max_wrong_cost = 0;

        for dir in Direction::ALL {
            if dir == optimal_dir {
                continue;
            }

            let result = simulate_move(grid, current, dir);
            if !result.valid || result.pos == current {
                continue;
            }

            // Get distance from wrong position to goal
            if let Some(&wrong_dist) = distance_to_goal.get(&result.pos.key()) {
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

/// Count paths that feel like progress but waste moves
fn count_false_progress_paths(
    grid: &Grid,
    start: Position,
    goal: Position,
    optimal_moves: i32,
    distance_to_goal: &HashMap<u32, i32>,
) -> i32 {
    let mut count = 0;
    let mut checked = HashSet::with_capacity(256);
    let mut queue = VecDeque::with_capacity(256);

    let start_dist = start.manhattan_distance(goal);
    queue.push_back((start, 0, start_dist));
    checked.insert(start.key());

    while let Some((pos, dist_from_start, min_dist_seen)) = queue.pop_front() {
        if dist_from_start > optimal_moves + 10 {
            continue;
        }

        for dir in Direction::ALL {
            let result = simulate_move(grid, pos, dir);
            if !result.valid || result.pos == pos {
                continue;
            }

            let key = result.pos.key();
            if checked.contains(&key) {
                continue;
            }
            checked.insert(key);

            let new_dist_to_goal = result.pos.manhattan_distance(goal);
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

            queue.push_back((
                result.pos,
                new_dist_from_start,
                min_dist_seen.min(new_dist_to_goal),
            ));
        }
    }

    count
}

/// Calculate full psychology score - optimized to compute shared data once
pub fn calculate_psychology_score(
    grid: &Grid,
    start: Position,
    goal: Position,
) -> PsychologyMetrics {
    // Compute optimal path once
    let optimal_path = match find_optimal_path(grid, start, goal) {
        Some(path) if path.len() >= 2 => path,
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

    // Compute distance map once
    let distance_to_goal = compute_distance_to_goal(grid, goal);

    // Calculate all metrics using precomputed data
    let counter_intuitive = count_counter_intuitive_moves(goal, &optimal_path);
    let attractive_decoys = count_attractive_decoys(grid, goal, &optimal_path);
    let commitment_gates = count_commitment_gates(grid, goal, &optimal_path, &distance_to_goal);
    let false_progress =
        count_false_progress_paths(grid, start, goal, optimal_moves, &distance_to_goal);

    // Calculate final score
    let score = (counter_intuitive * WEIGHT_COUNTER_INTUITIVE)
        + (attractive_decoys * WEIGHT_ATTRACTIVE_DECOYS)
        + (commitment_gates * WEIGHT_COMMITMENT_GATES)
        + (false_progress * WEIGHT_FALSE_PROGRESS)
        + (optimal_moves as f32 * WEIGHT_MOVE_BONUS) as i32
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

/// Quick prefilter check to reject obviously easy puzzles
pub fn passes_prefilters(metrics: &PsychologyMetrics) -> bool {
    metrics.counter_intuitive_moves >= MIN_COUNTER_INTUITIVE
        && metrics.attractive_decoys >= MIN_ATTRACTIVE_DECOYS
        && metrics.commitment_gates >= MIN_COMMITMENT_GATES
        && metrics.false_progress_paths >= MIN_FALSE_PROGRESS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TileType;

    #[test]
    fn test_scoring_empty() {
        let grid = Grid::new(10, 10, TileType::Ice);
        let metrics = calculate_psychology_score(&grid, Position::new(1, 1), Position::new(8, 8));
        assert!(metrics.optimal_moves > 0);
    }
}
