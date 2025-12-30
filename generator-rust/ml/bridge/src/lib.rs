use mazle_generator::generators::ice::{validate_ice_puzzle_interior, ValidationResult};
use mazle_generator::types::Position;
use pyo3::prelude::*;

#[pyclass]
struct ValidationResultPy {
    #[pyo3(get)]
    valid_tiles: bool,
    #[pyo3(get)]
    solvable: bool,
    #[pyo3(get)]
    optimal_moves: i32,
    #[pyo3(get)]
    unique_optimal: bool,
    #[pyo3(get)]
    no_stuck: bool,
    #[pyo3(get)]
    meets_target_moves: bool,
}

impl From<ValidationResult> for ValidationResultPy {
    fn from(result: ValidationResult) -> Self {
        Self {
            valid_tiles: result.valid_tiles,
            solvable: result.solvable,
            optimal_moves: result.optimal_moves,
            unique_optimal: result.unique_optimal,
            no_stuck: result.no_stuck,
            meets_target_moves: result.meets_target_moves,
        }
    }
}

#[pyfunction]
fn validate_ice_interior(
    tiles_interior: Vec<Vec<u8>>,
    start_x: i32,
    start_y: i32,
    goal_x: i32,
    goal_y: i32,
    target_moves: Option<i32>,
) -> PyResult<ValidationResultPy> {
    let start = Position { x: start_x, y: start_y };
    let goal = Position { x: goal_x, y: goal_y };
    let result = validate_ice_puzzle_interior(&tiles_interior, start, goal, target_moves);
    Ok(result.into())
}

#[pymodule]
fn mazle_eval(_py: Python, m: &PyModule) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(validate_ice_interior, m)?)?;
    Ok(())
}
