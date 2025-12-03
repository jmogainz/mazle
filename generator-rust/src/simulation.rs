use crate::types::{Direction, Grid, Position, TileType};

/// Result of simulating a move
#[derive(Debug, Clone, Copy)]
pub struct MoveResult {
    pub pos: Position,
    pub valid: bool,
}

/// Simulate a move with ice sliding mechanics
pub fn simulate_move(grid: &Grid, start: Position, dir: Direction) -> MoveResult {
    let (dx, dy) = dir.delta();
    let mut x = start.x + dx;
    let mut y = start.y + dy;

    // Check if target is valid
    if !grid.is_valid(x, y) {
        return MoveResult {
            pos: start,
            valid: false,
        };
    }

    let target_tile = grid.get_unchecked(x, y);

    // Can't move into walls
    if target_tile == TileType::Wall {
        return MoveResult {
            pos: start,
            valid: false,
        };
    }

    // Check ledge entry rules
    if target_tile.is_ledge() {
        if let Some(allowed) = Direction::allowed_for_ledge(target_tile) {
            if dir != allowed {
                return MoveResult {
                    pos: start,
                    valid: false,
                };
            }
        }
    }

    // Handle ice sliding
    if target_tile == TileType::Ice {
        for _ in 0..100 {
            let next_x = x + dx;
            let next_y = y + dy;

            if !grid.is_valid(next_x, next_y) {
                break;
            }

            let next_tile = grid.get_unchecked(next_x, next_y);

            if next_tile == TileType::Wall {
                break;
            }

            // Check ledge during slide
            if next_tile.is_ledge() {
                if let Some(allowed) = Direction::allowed_for_ledge(next_tile) {
                    if dir != allowed {
                        break;
                    }
                    // Can enter ledge, stop here
                    x = next_x;
                    y = next_y;
                    break;
                }
            }

            x = next_x;
            y = next_y;

            // Stop if not ice
            if next_tile != TileType::Ice {
                break;
            }
        }
    }

    MoveResult {
        pos: Position::new(x, y),
        valid: true,
    }
}

/// Get directions that move toward a target (intuitive directions)
pub fn get_intuitive_directions(from: Position, to: Position) -> Vec<Direction> {
    let mut dirs = Vec::with_capacity(2);
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

/// Get the direction between two positions (for adjacent or slide endpoints)
pub fn get_direction_between(from: Position, to: Position) -> Option<Direction> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ice_slide() {
        let mut grid = Grid::new(10, 10, TileType::Ice);
        // Create a wall to stop sliding
        grid.set(5, 3, TileType::Wall);

        let result = simulate_move(&grid, Position::new(2, 3), Direction::Right);
        assert!(result.valid);
        assert_eq!(result.pos, Position::new(4, 3)); // Stops before wall
    }

    #[test]
    fn test_wall_block() {
        let mut grid = Grid::new(10, 10, TileType::Ground);
        grid.set(3, 3, TileType::Wall);

        let result = simulate_move(&grid, Position::new(2, 3), Direction::Right);
        assert!(!result.valid);
        assert_eq!(result.pos, Position::new(2, 3));
    }
}
