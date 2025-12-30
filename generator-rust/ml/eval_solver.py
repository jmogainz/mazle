from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

import torch

from data import TileVocab

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


def _idx_to_xy(idx: int, width: int) -> tuple[int, int]:
    return idx % width, idx // width


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
        start_logits = outputs["start_logits"].view(latents.shape[0], -1)
        goal_logits = outputs["goal_logits"].view(latents.shape[0], -1)

        tile_idx = tile_logits.argmax(dim=1).cpu().tolist()
        start_idx = start_logits.argmax(dim=1).cpu().tolist()
        goal_idx = goal_logits.argmax(dim=1).cpu().tolist()

        for i in range(len(seeds)):
            tiles = vocab.decode_grid(tile_idx[i])
            sx, sy = _idx_to_xy(start_idx[i], width)
            gx, gy = _idx_to_xy(goal_idx[i], width)
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
