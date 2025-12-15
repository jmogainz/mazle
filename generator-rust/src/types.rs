use serde::{Deserialize, Serialize};

/// Tile types matching the TypeScript enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum TileType {
    Ground = 0,
    Wall = 1,
    Start = 2,
    Goal = 3,
    Ice = 4,
    LedgeUp = 5,
    LedgeDown = 6,
    LedgeLeft = 7,
    LedgeRight = 8,
    Boulder = 9,
}

/// Cardinal directions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

/// A position on the grid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

/// Map types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MapType {
    Ice,
    Ground,
}

/// Complete puzzle data for API response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleData {
    pub width: usize,
    pub height: usize,
    pub tiles: Vec<Vec<u8>>,
    pub start: Position,
    pub goal: Position,
    pub optimal_moves: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solution_path: Option<Vec<Position>>,
    pub map_type: MapType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub difficulty_score: Option<i32>,
    // Original metrics (Phase 0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counter_intuitive_moves: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attractive_decoys: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commitment_gates: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub false_progress_paths: Option<i32>,
    // Path structure metrics (Phase 1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_locality: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction_changes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backtrack_depth: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_ambiguity: Option<f64>,
    // Path diversity metrics (Phase 2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub near_optimal_paths: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_overlap: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_overlap_avg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub early_divergence: Option<f64>,
}

/// Generation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationConfig {
    #[serde(default = "default_target_score")]
    pub target_psychology_score: i32,
    #[serde(default)]
    pub parallel: bool,
    #[serde(default)]
    pub start_batch: usize,
}

fn default_target_score() -> i32 {
    2000
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            target_psychology_score: default_target_score(),
            parallel: true,
            start_batch: 0,
        }
    }
}
