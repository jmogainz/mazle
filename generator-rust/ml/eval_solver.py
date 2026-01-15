from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

import torch

from data import TileVocab, START_TILE_ID, GOAL_TILE_ID

try:
    from mazle_eval import validate_ice_interior
except Exception as exc:  # pragma: no cover - optional import
    raise RuntimeError(
        "mazle_eval extension not available. Build it with:\n"
        "  python -m maturin develop -m ml/bridge/pyproject.toml"
    ) from exc


@dataclass
class SolverMetrics:
    total: int = 0
    valid_tiles: int = 0
    solvable: int = 0
    unique_optimal: int = 0
    no_stuck: int = 0
    target_moves: int = 0

    def to_dict(self) -> dict:
        total = max(self.total, 1)
        return {
            "samples": self.total,
            "valid_tiles_rate": self.valid_tiles / total,
            "solvable_rate": self.solvable / total,
            "unique_optimal_rate": self.unique_optimal / total,
            "no_stuck_rate": self.no_stuck / total,
            "target_moves_rate": self.target_moves / total,
        }


def _find_position(grid: List[List[int]], tile_id: int) -> tuple[int, int]:
    """Find (x, y) of the first occurrence of tile_id, or (-1, -1) if not found."""
    for y, row in enumerate(grid):
        for x, val in enumerate(row):
            if val == tile_id:
                return x, y
    return -1, -1


@torch.no_grad()
def evaluate_solver(
    model,
    loader: Iterable[dict],
    vocab: TileVocab,
    device: torch.device,
    max_steps: int,
    target_moves: int = 10,
) -> SolverMetrics:
    model.eval()
    metrics = SolverMetrics()

    steps = 0
    for batch in loader:
        steps += 1
        seeds: List[str] = batch["seeds"]
        height = int(batch["heights"][0].item())
        width = int(batch["widths"][0].item())

        latents = model.latent_from_seeds(seeds, device)
        outputs = model(latents, width, height)

        tile_logits = outputs["tile_logits"]
        tile_idx = tile_logits.argmax(dim=1).cpu().tolist()

        for i in range(len(seeds)):
            # Decode grid - this gives raw tile IDs including START/GOAL
            decoded = vocab.decode_grid(tile_idx[i])
            
            # Find start and goal positions
            sx, sy = _find_position(decoded, START_TILE_ID)
            gx, gy = _find_position(decoded, GOAL_TILE_ID)
            
            # Replace START/GOAL with floor (0) for validation
            tiles = [[0 if v in (START_TILE_ID, GOAL_TILE_ID) else v for v in row] for row in decoded]
            
            # Skip if no start or goal found
            if sx < 0 or gx < 0:
                metrics.total += 1
                continue
                
            result = validate_ice_interior(tiles, sx, sy, gx, gy, target_moves)

            metrics.total += 1
            if result.valid_tiles:
                metrics.valid_tiles += 1
            if result.solvable:
                metrics.solvable += 1
            if result.unique_optimal:
                metrics.unique_optimal += 1
            if result.no_stuck:
                metrics.no_stuck += 1
            if result.meets_target_moves:
                metrics.target_moves += 1

        if steps >= max_steps:
            break

    return metrics
