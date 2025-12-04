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
    pub map_type: MapType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub difficulty_score: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub counter_intuitive_moves: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attractive_decoys: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commitment_gates: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub false_progress_paths: Option<i32>,
}

/// Generation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationConfig {
    #[serde(default = "default_constraint_attempts")]
    pub constraint_attempts: usize,
    #[serde(default = "default_traditional_attempts")]
    pub traditional_attempts: usize,
    #[serde(default = "default_target_score")]
    pub target_psychology_score: i32,
    #[serde(default = "default_max_attempts")]
    pub max_attempts: usize,
    #[serde(default)]
    pub parallel: bool,
}

fn default_constraint_attempts() -> usize {
    160
}
fn default_traditional_attempts() -> usize {
    400
}
fn default_target_score() -> i32 {
    2000
}
fn default_max_attempts() -> usize {
    560
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            constraint_attempts: default_constraint_attempts(),
            traditional_attempts: default_traditional_attempts(),
            target_psychology_score: default_target_score(),
            max_attempts: default_max_attempts(),
            parallel: true,
        }
    }
}
