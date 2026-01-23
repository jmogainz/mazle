"""
Training script for Puzzle Generator v2 (Clean Architecture).

Key changes from experimental versions:
1. No CFG conditioning - removed moves_embed, cfg_dropout
2. No AdaLN - using standard LayerNorm
3. Simple cross-entropy on tiles + positions
4. EMA for stable sampling
5. Data augmentation (rotations/flips)

Supports two training modes:
- Standard pretraining: Cross-entropy on training data
- DPO fine-tuning: Direct Preference Optimization on (winner, loser) pairs
"""

import argparse
import hashlib
import json
import math
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from data import (
    JsonlMazeDataset,
    TileVocab,
    collect_tile_ids,
    START_TILE_ID,
    GOAL_TILE_ID,
)
from model_v2 import PuzzleGeneratorV2, ModelConfig, config_for_preset


# Tile ID remapping: original IDs to contiguous 0-6
# Original: 0=floor, 1=wall, 4=ice, 5=ledge_u, 6=ledge_d, 7=ledge_l, 8=ledge_r
TILE_REMAP = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
TILE_REMAP_INV = {v: k for k, v in TILE_REMAP.items()}


def count_lines(path: Path) -> int:
    with open(path) as f:
        return sum(1 for _ in f)


# --- Lambda scheduling helpers ---
def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation between a and b."""
    return a + (b - a) * t


def ramp_t(step: int, start: int, end: int) -> float:
    """Compute ramp factor t in [0, 1] based on step."""
    if end <= start:
        return 1.0 if step >= start else 0.0
    x = (step - start) / float(end - start)
    return max(0.0, min(1.0, x))


class PlanLossScaler:
    """Tracks EMA of losses and computes scaling multiplier to keep plan loss influential."""
    
    def __init__(self, target_ratio: float = 0.30, ema_beta: float = 0.99,
                 mult_min: float = 0.5, mult_max: float = 4.0,
                 mult_max_late: float = 8.0, activation_step: int = 10000,
                 late_step: int = 18000):
        self.target_ratio = target_ratio
        self.ema_beta = ema_beta
        self.mult_min = mult_min
        self.mult_max = mult_max
        self.mult_max_late = mult_max_late
        self.activation_step = activation_step
        self.late_step = late_step
        self.ema_tile = None
        self.ema_plan = None
        self.eps = 1e-8
    
    def update_and_get_multiplier(self, tile_loss_val: float, plan_loss_val: float,
                                   global_step: int = 0) -> float:
        """Update EMAs and return multiplier to apply to plan loss."""
        # Before activation_step, force mult=1.0 (no scaling)
        if global_step < self.activation_step:
            return 1.0
        
        if self.ema_tile is None:
            self.ema_tile = tile_loss_val
            self.ema_plan = plan_loss_val
        else:
            self.ema_tile = self.ema_beta * self.ema_tile + (1.0 - self.ema_beta) * tile_loss_val
            self.ema_plan = self.ema_beta * self.ema_plan + (1.0 - self.ema_beta) * plan_loss_val
        
        # Compute multiplier to keep plan ~ target_ratio * tile
        raw_mult = self.target_ratio * (self.ema_tile / (self.ema_plan + self.eps))
        
        # Two-stage ceiling: use higher max after late_step
        current_max = self.mult_max_late if global_step >= self.late_step else self.mult_max
        return max(self.mult_min, min(current_max, raw_mult))


def log_progress(msg: str, out_dir: Path = None):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{timestamp} {msg}"
    print(line)
    if out_dir:
        with open(out_dir / "progress.log", "a") as f:
            f.write(line + "\n")


def remap_tile(tile_id: int) -> int:
    """Remap original tile ID to contiguous index."""
    return TILE_REMAP.get(tile_id, 2)  # Default to ice if unknown


def remap_tile_inv(idx: int) -> int:
    """Remap contiguous index back to original tile ID."""
    return TILE_REMAP_INV.get(idx, 4)  # Default to ice


# Ledge tile transformations for augmentation
# After remapping: 3=up, 4=down, 5=left, 6=right
LEDGE_REMAP_90CW = {3: 5, 4: 6, 5: 4, 6: 3}
LEDGE_REMAP_180 = {3: 4, 4: 3, 5: 6, 6: 5}
LEDGE_REMAP_90CCW = {3: 6, 4: 5, 5: 3, 6: 4}
LEDGE_REMAP_FLIP_H = {3: 3, 4: 4, 5: 6, 6: 5}
LEDGE_REMAP_FLIP_V = {3: 4, 4: 3, 5: 5, 6: 6}


def transform_tile(tile_idx: int, transform_map: dict) -> int:
    """Transform a tile index according to augmentation."""
    if tile_idx in transform_map:
        return transform_map[tile_idx]
    return tile_idx


def augment_puzzle(tiles: torch.Tensor, start_pos: int, goal_pos: int,
                   H: int = 13, W: int = 13) -> Tuple:
    """Apply random augmentation to a puzzle."""
    import random
    aug_type = random.randint(0, 7)

    if aug_type == 0:
        return tiles, start_pos, goal_pos

    tiles_2d = tiles.reshape(H, W).clone()
    start_y, start_x = start_pos // W, start_pos % W
    goal_y, goal_x = goal_pos // W, goal_pos % W

    if aug_type == 1:
        tiles_2d = torch.rot90(tiles_2d, k=-1)
        start_x, start_y = H - 1 - start_y, start_x
        goal_x, goal_y = H - 1 - goal_y, goal_x
        ledge_map = LEDGE_REMAP_90CW
    elif aug_type == 2:
        tiles_2d = torch.rot90(tiles_2d, k=2)
        start_x, start_y = W - 1 - start_x, H - 1 - start_y
        goal_x, goal_y = W - 1 - goal_x, H - 1 - goal_y
        ledge_map = LEDGE_REMAP_180
    elif aug_type == 3:
        tiles_2d = torch.rot90(tiles_2d, k=1)
        start_x, start_y = start_y, W - 1 - start_x
        goal_x, goal_y = goal_y, W - 1 - goal_x
        ledge_map = LEDGE_REMAP_90CCW
    elif aug_type == 4:
        tiles_2d = torch.flip(tiles_2d, dims=[1])
        start_x = W - 1 - start_x
        goal_x = W - 1 - goal_x
        ledge_map = LEDGE_REMAP_FLIP_H
    elif aug_type == 5:
        tiles_2d = torch.flip(tiles_2d, dims=[0])
        start_y = H - 1 - start_y
        goal_y = H - 1 - goal_y
        ledge_map = LEDGE_REMAP_FLIP_V
    elif aug_type == 6:
        tiles_2d = tiles_2d.T
        start_x, start_y = start_y, start_x
        goal_x, goal_y = goal_y, goal_x
        ledge_map = {3: 5, 4: 6, 5: 3, 6: 4}
    else:
        tiles_2d = torch.flip(tiles_2d.T, dims=[0, 1])
        start_x, start_y = H - 1 - start_y, W - 1 - start_x
        goal_x, goal_y = H - 1 - goal_y, W - 1 - goal_x
        ledge_map = {3: 6, 4: 5, 5: 4, 6: 3}

    for y in range(H):
        for x in range(W):
            tiles_2d[y, x] = transform_tile(tiles_2d[y, x].item(), ledge_map)

    tiles_out = tiles_2d.reshape(-1)
    start_pos_out = start_y * W + start_x
    goal_pos_out = goal_y * W + goal_x

    return tiles_out, start_pos_out, goal_pos_out


def build_path_conditioning(optimal_path: List[Tuple[int, int]], W: int = 13, H: int = 13, S: int = 11):
    """
    Build path conditioning tensors from optimal path.

    Args:
        optimal_path: List of (x, y) stop positions [(x0,y0), ..., (x10,y10)]
        W: Grid width
        H: Grid height
        S: Number of stops (11 for 10-move puzzles)

    Returns:
        stop_step_feat: (H*W, S) one-hot for which stop at each cell
        on_path: (H*W, 1) binary mask for cells on optimal path
    """
    stop_step_feat = torch.zeros((H, W, S), dtype=torch.float32)
    on_path = torch.zeros((H, W, 1), dtype=torch.float32)

    if len(optimal_path) != S:
        # Invalid path length, return zeros
        return stop_step_feat.reshape(H * W, S), on_path.reshape(H * W, 1)

    # 1) Mark stop positions
    for k, (x, y) in enumerate(optimal_path):
        if 0 <= x < W and 0 <= y < H:
            stop_step_feat[y, x, k] = 1.0

    # 2) Mark cells traversed between stops (ice sliding)
    for (x0, y0), (x1, y1) in zip(optimal_path[:-1], optimal_path[1:]):
        # Determine direction (must be axis-aligned)
        dx = 0 if x1 == x0 else (1 if x1 > x0 else -1)
        dy = 0 if y1 == y0 else (1 if y1 > y0 else -1)

        # Safety: ignore diagonal segments (shouldn't happen in valid ice puzzles)
        if (x1 != x0) and (y1 != y0):
             continue

        x, y = x0, y0
        if 0 <= y < H and 0 <= x < W:
            on_path[y, x, 0] = 1.0
            
        # Traverse
        steps = 0
        max_steps = max(W, H) * 2
        while (x, y) != (x1, y1):
            x += dx
            y += dy
            if 0 <= y < H and 0 <= x < W:
                on_path[y, x, 0] = 1.0
            steps += 1
            if steps > max_steps:
                break

    return stop_step_feat.reshape(H * W, S), on_path.reshape(H * W, 1)


# Plan-realization loss: tile sets that block entry from each direction
# Remapped tile IDs: 0=floor, 1=wall, 2=ice, 3=ledge_u, 4=ledge_d, 5=ledge_l, 6=ledge_r
# Ledge allows entry ONLY from its direction (ledge_u allows from up, etc.)
# For approach "from left" (moving East, dx=+1): blocking = wall + ledge_u + ledge_d + ledge_r
# For approach "from right" (moving West, dx=-1): blocking = wall + ledge_u + ledge_d + ledge_l
# For approach "from up" (moving South, dy=+1): blocking = wall + ledge_l + ledge_r + ledge_d
# For approach "from down" (moving North, dy=-1): blocking = wall + ledge_l + ledge_r + ledge_u
BLOCK_TILES_BY_APPROACH = {
    "from_left": [1, 3, 4, 6],   # wall, ledge_u, ledge_d, ledge_r (not ledge_l)
    "from_right": [1, 3, 4, 5],  # wall, ledge_u, ledge_d, ledge_l (not ledge_r)
    "from_up": [1, 4, 5, 6],     # wall, ledge_d, ledge_l, ledge_r (not ledge_u)
    "from_down": [1, 3, 5, 6],   # wall, ledge_u, ledge_l, ledge_r (not ledge_d)
}
NUM_TILES = 7  # 0-6


def get_approach_direction(dx: int, dy: int) -> str:
    """Get the approach direction string based on movement delta."""
    if dx > 0:
        return "from_left"   # Moving East, entering from left
    elif dx < 0:
        return "from_right"  # Moving West, entering from right
    elif dy > 0:
        return "from_up"     # Moving South, entering from up
    elif dy < 0:
        return "from_down"   # Moving North, entering from down
    else:
        return None  # No movement (shouldn't happen in valid paths)


def compute_plan_realization_loss(
    tile_logits: torch.Tensor,
    optimal_paths: List[List[Tuple[int, int]]],
    W: int = 13,
    H: int = 13,
    eps: float = 1e-8,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Compute plan-realization loss components to prevent shortcuts.

    This loss has two components:
    1. L_stop: The cell beyond each stop must be blocking for that approach
    2. L_clear: All intermediate cells on each segment must be non-blocking

    Args:
        tile_logits: (B, H*W, num_tiles) logits from model
        optimal_paths: List of B paths, each path is [(x0,y0), ..., (x10,y10)]
        W, H: Grid dimensions
        eps: Small value for numerical stability

    Returns:
        Tuple of (L_stop, L_clear) as scalar tensors (raw, before lambda weighting)
    """
    B = tile_logits.shape[0]
    device = tile_logits.device

    # Convert logits to probabilities
    tile_probs = F.softmax(tile_logits, dim=-1)  # (B, H*W, num_tiles)

    # Pre-compute blocking probability masks for each approach direction
    # block_mask[approach] is a (num_tiles,) tensor with 1 for blocking tiles
    block_masks = {}
    clear_masks = {}
    for approach, block_tiles in BLOCK_TILES_BY_APPROACH.items():
        mask = torch.zeros(NUM_TILES, device=device)
        mask[block_tiles] = 1.0
        block_masks[approach] = mask
        clear_masks[approach] = 1.0 - mask

    # All four cardinal directions: (dx, dy, approach_from)
    ALL_DIRECTIONS = [
        (1, 0, "from_left"),   # East
        (-1, 0, "from_right"), # West
        (0, 1, "from_up"),     # South
        (0, -1, "from_down"),  # North
    ]

    total_stop_loss = 0.0
    total_clear_loss = 0.0
    num_stop_cells = 0
    num_clear_cells = 0

    for b, path in enumerate(optimal_paths):
        if len(path) != 11:
            continue  # Skip invalid paths

        for k in range(len(path) - 1):
            x0, y0 = path[k]
            x1, y1 = path[k + 1]

            # Direction of movement
            dx = 0 if x1 == x0 else (1 if x1 > x0 else -1)
            dy = 0 if y1 == y0 else (1 if y1 > y0 else -1)

            if (x1 != x0) and (y1 != y0):
                continue

            approach = get_approach_direction(dx, dy)
            if approach is None:
                continue

            # 1) Stop-causing obstacle: cell beyond the stop
            obs_x = x1 + dx
            obs_y = y1 + dy

            # Check if obs is in bounds (if not, edge of map acts as blocker - no loss needed)
            if 0 <= obs_x < W and 0 <= obs_y < H:
                obs_idx = obs_y * W + obs_x
                # Probability that this cell is blocking
                p_block = (tile_probs[b, obs_idx] * block_masks[approach]).sum()
                total_stop_loss += -torch.log(p_block + eps)
                num_stop_cells += 1

            # 2) Segment clearance: intermediate cells must be non-blocking
            # Enumerate cells from (x0+dx, y0+dy) to (x1-dx, y1-dy) exclusive of endpoints
            x, y = x0, y0
            steps = 0
            max_steps = max(W, H) * 2
            while (x, y) != (x1, y1):
                x += dx
                y += dy
                if (x, y) == (x1, y1):
                    break  # Don't include the destination stop itself
                if 0 <= x < W and 0 <= y < H:
                    cell_idx = y * W + x
                    # Probability that this cell is non-blocking (clear)
                    p_clear = (tile_probs[b, cell_idx] * clear_masks[approach]).sum()
                    total_clear_loss += -torch.log(p_clear + eps)
                    num_clear_cells += 1
                steps += 1
                if steps > max_steps:
                    break

    # Average over cells (avoid div by zero)
    if num_stop_cells > 0:
        total_stop_loss = total_stop_loss / num_stop_cells
    else:
        total_stop_loss = torch.tensor(0.0, device=device)
    if num_clear_cells > 0:
        total_clear_loss = total_clear_loss / num_clear_cells
    else:
        total_clear_loss = torch.tensor(0.0, device=device)

    return total_stop_loss, total_clear_loss


def expand_path_to_cells(path: List[Tuple[int, int]]) -> set:
    """
    Expand a stop-sequence path to all cells traversed (including intermediate slide cells).
    
    Args:
        path: List of (x, y) stop positions
        
    Returns:
        Set of (x, y) tuples for all cells on the path
    """
    cells = set()
    for i, (x, y) in enumerate(path):
        cells.add((x, y))
        if i > 0:
            x0, y0 = path[i - 1]
            # Traverse intermediate cells
            dx = 0 if x == x0 else (1 if x > x0 else -1)
            dy = 0 if y == y0 else (1 if y > y0 else -1)
            
            if (x != x0) and (y != y0):
                continue
                
            cx, cy = x0, y0
            steps = 0
            while (cx, cy) != (x, y):
                cx += dx
                cy += dy
                cells.add((cx, cy))
                steps += 1
                if steps > 100:  # Safety break
                    break
    return cells


def compute_shortcut_loss(
    tile_logits: torch.Tensor,
    tile_probs: torch.Tensor,
    tiles_gt: torch.Tensor,
    start_pos: torch.Tensor,
    goal_pos: torch.Tensor,
    training_paths: List[List[Tuple[int, int]]],
    validate_fn,
    sample_fraction: float = 0.25,
    W: int = 13,
    H: int = 13,
    eps: float = 1e-8,
) -> Tuple[torch.Tensor, int, int]:
    """
    Compute shortcut-cutting loss: penalize cells that enable <10 move solutions.
    
    For each sample where the model produces a shortcut (solver finds m < 10):
    - Find cells on solver's path that are NOT on the training path
    - Penalize those "culprit" cells being clear (push toward blocking)
    
    Args:
        tile_logits: (B, H*W, num_tiles) logits from model
        tile_probs: (B, H*W, num_tiles) softmax probabilities
        tiles_gt: (B, H*W) ground-truth tiles (for fallback if needed)
        start_pos: (B,) start positions as flat indices
        goal_pos: (B,) goal positions as flat indices
        training_paths: List of B training paths, each [(x0,y0), ..., (x10,y10)]
        validate_fn: Rust solver function
        sample_fraction: Fraction of batch to evaluate (for efficiency)
        W, H: Grid dimensions
        eps: Small value for numerical stability
    
    Returns:
        Tuple of (L_shortcut, num_shortcuts_found, num_samples_checked)
    """
    B = tile_logits.shape[0]
    device = tile_logits.device
    
    if validate_fn is None:
        return torch.tensor(0.0, device=device), 0, 0
    
    # Sample subset of batch for efficiency
    num_to_check = max(1, int(B * sample_fraction))
    import random
    indices = random.sample(range(B), num_to_check)
    
    total_loss = 0.0
    num_culprit_cells = 0
    num_shortcuts = 0
    
    # Pre-compute clear probability mask (not wall = floor or ice or ledges)
    # We want to penalize cells being "traversable" when they shouldn't be
    # Wall (idx=1) is the main blocker; we push culprit cells toward wall
    # p_not_wall = 1 - p_wall
    
    for b_idx in indices:
        path_gt = training_paths[b_idx]
        if len(path_gt) != 11:
            continue
        
        # Get discrete tiles from model output (argmax)
        tiles_pred = tile_logits[b_idx].argmax(dim=-1)  # (H*W,)
        
        # Get start/goal
        sp = start_pos[b_idx].item()
        gp = goal_pos[b_idx].item()
        sx, sy = sp % W, sp // W
        gx, gy = gp % W, gp // W
        
        # Convert to grid format for solver
        grid = []
        for y in range(H):
            row = []
            for x in range(W):
                idx = tiles_pred[y * W + x].item()
                row.append(remap_tile_inv(idx))
            grid.append(row)
        
        # Run solver
        try:
            result = validate_fn(grid, sx, sy, gx, gy, 10)
            if not result.solvable:
                continue
            
            moves = result.optimal_moves
            if moves >= 10:
                continue  # No shortcut
            
            # Found shortcut! Get solver's path
            solver_path = [(x, y) for x, y in result.optimal_path]
            if not solver_path:
                continue
            
            num_shortcuts += 1
            
            # Expand both paths to cell sets
            gt_cells = expand_path_to_cells(path_gt)
            solver_cells = expand_path_to_cells(solver_path)
            
            # Culprit cells: on solver path but NOT on ground-truth path
            culprit_cells = solver_cells - gt_cells
            
            if not culprit_cells:
                continue
            
            # Take first 2 culprits (most impactful)
            culprits = list(culprit_cells)[:2]
            
            for cx, cy in culprits:
                if 0 <= cx < W and 0 <= cy < H:
                    cell_idx = cy * W + cx
                    # Probability of wall at this cell
                    p_wall = tile_probs[b_idx, cell_idx, 1]  # idx 1 = wall
                    # Push toward wall: -log(p_wall)
                    total_loss += -torch.log(p_wall + eps)
                    num_culprit_cells += 1
                    
        except Exception:
            continue  # Solver error, skip
    
    if num_culprit_cells > 0:
        L_shortcut = total_loss / num_culprit_cells
    else:
        L_shortcut = torch.tensor(0.0, device=device)
    
    return L_shortcut, num_shortcuts, num_to_check


def augment_path(optimal_path: List[Tuple[int, int]], aug_type: int, H: int = 13, W: int = 13) -> List[Tuple[int, int]]:
    """
    Apply the same augmentation transform to a path that was applied to tiles.

    Args:
        optimal_path: List of (x, y) stop positions
        aug_type: Augmentation type (0-7, same as in augment_puzzle)
        H, W: Grid dimensions

    Returns:
        Transformed path with same augmentation applied
    """
    if aug_type == 0:
        return optimal_path

    result = []
    for x, y in optimal_path:
        if aug_type == 1:  # Rotate 90 CW
            new_x, new_y = H - 1 - y, x
        elif aug_type == 2:  # Rotate 180
            new_x, new_y = W - 1 - x, H - 1 - y
        elif aug_type == 3:  # Rotate 90 CCW
            new_x, new_y = y, W - 1 - x
        elif aug_type == 4:  # Flip horizontal
            new_x, new_y = W - 1 - x, y
        elif aug_type == 5:  # Flip vertical
            new_x, new_y = x, H - 1 - y
        elif aug_type == 6:  # Transpose
            new_x, new_y = y, x
        else:  # aug_type == 7: Transpose + flip both
            new_x, new_y = H - 1 - y, W - 1 - x
        result.append((new_x, new_y))
    return result


def augment_puzzle_with_path(tiles: torch.Tensor, start_pos: int, goal_pos: int,
                              optimal_path: List[Tuple[int, int]],
                              H: int = 13, W: int = 13) -> Tuple:
    """Apply random augmentation to a puzzle and its path."""
    import random
    aug_type = random.randint(0, 7)

    if aug_type == 0:
        return tiles, start_pos, goal_pos, optimal_path, aug_type

    tiles_2d = tiles.reshape(H, W).clone()
    start_y, start_x = start_pos // W, start_pos % W
    goal_y, goal_x = goal_pos // W, goal_pos % W

    if aug_type == 1:
        tiles_2d = torch.rot90(tiles_2d, k=-1)
        start_x, start_y = H - 1 - start_y, start_x
        goal_x, goal_y = H - 1 - goal_y, goal_x
        ledge_map = LEDGE_REMAP_90CW
    elif aug_type == 2:
        tiles_2d = torch.rot90(tiles_2d, k=2)
        start_x, start_y = W - 1 - start_x, H - 1 - start_y
        goal_x, goal_y = W - 1 - goal_x, H - 1 - goal_y
        ledge_map = LEDGE_REMAP_180
    elif aug_type == 3:
        tiles_2d = torch.rot90(tiles_2d, k=1)
        start_x, start_y = start_y, W - 1 - start_x
        goal_x, goal_y = goal_y, W - 1 - goal_x
        ledge_map = LEDGE_REMAP_90CCW
    elif aug_type == 4:
        tiles_2d = torch.flip(tiles_2d, dims=[1])
        start_x = W - 1 - start_x
        goal_x = W - 1 - goal_x
        ledge_map = LEDGE_REMAP_FLIP_H
    elif aug_type == 5:
        tiles_2d = torch.flip(tiles_2d, dims=[0])
        start_y = H - 1 - start_y
        goal_y = H - 1 - goal_y
        ledge_map = LEDGE_REMAP_FLIP_V
    elif aug_type == 6:
        tiles_2d = tiles_2d.T
        start_x, start_y = start_y, start_x
        goal_x, goal_y = goal_y, goal_x
        ledge_map = {3: 5, 4: 6, 5: 3, 6: 4}
    else:
        tiles_2d = torch.flip(tiles_2d.T, dims=[0, 1])
        start_x, start_y = H - 1 - start_y, W - 1 - start_x
        goal_x, goal_y = H - 1 - goal_y, W - 1 - goal_x
        ledge_map = {3: 6, 4: 5, 5: 4, 6: 3}

    for y in range(H):
        for x in range(W):
            tiles_2d[y, x] = transform_tile(tiles_2d[y, x].item(), ledge_map)

    tiles_out = tiles_2d.reshape(-1)
    start_pos_out = start_y * W + start_x
    goal_pos_out = goal_y * W + goal_x

    # Augment the path using the same transform
    path_out = augment_path(optimal_path, aug_type, H, W)

    return tiles_out, start_pos_out, goal_pos_out, path_out, aug_type


class CollateFnV2:
    """Collate function for v2 model - clean version without CFG."""

    def __init__(self, grid_height: int = 13, grid_width: int = 13, augment: bool = False):
        self.grid_height = grid_height
        self.grid_width = grid_width
        self.augment = augment

    def __call__(self, batch: List[Dict]) -> Dict[str, torch.Tensor]:
        B = len(batch)
        H, W = self.grid_height, self.grid_width

        tiles = torch.empty((B, H * W), dtype=torch.long)
        start_pos = torch.empty(B, dtype=torch.long)
        goal_pos = torch.empty(B, dtype=torch.long)

        for i, item in enumerate(batch):
            grid = item["tilesInterior"]
            start = item["start"]
            goal = item["goal"]

            # Remap tiles to contiguous indices
            flat_tiles = []
            for row in grid:
                for val in row:
                    flat_tiles.append(remap_tile(val))

            tiles[i] = torch.tensor(flat_tiles, dtype=torch.long)
            start_pos[i] = start["y"] * W + start["x"]
            goal_pos[i] = goal["y"] * W + goal["x"]

            if self.augment:
                tiles[i], start_pos[i], goal_pos[i] = augment_puzzle(
                    tiles[i], start_pos[i].item(), goal_pos[i].item(), H, W
                )

        return {
            "tiles": tiles,
            "start_pos": start_pos,
            "goal_pos": goal_pos,
        }


class CollateFnV2WithPath:
    """Collate function for v2 model with path conditioning.
    
    Uses pre-labeled optimal_path from dataset if available, otherwise falls back to verifier.
    """

    def __init__(self, grid_height: int = 13, grid_width: int = 13, augment: bool = False,
                 validate_fn=None):
        self.grid_height = grid_height
        self.grid_width = grid_width
        self.augment = augment
        self.validate_fn = validate_fn
        self.num_stops = 11

    def __call__(self, batch: List[Dict]) -> Dict[str, torch.Tensor]:
        B = len(batch)
        H, W = self.grid_height, self.grid_width

        tiles = torch.empty((B, H * W), dtype=torch.long)
        start_pos = torch.empty(B, dtype=torch.long)
        goal_pos = torch.empty(B, dtype=torch.long)
        stop_step_feat = torch.zeros((B, H * W, self.num_stops), dtype=torch.float32)
        on_path = torch.zeros((B, H * W, 1), dtype=torch.float32)
        valid_path = torch.ones(B, dtype=torch.bool)  # Track which samples have valid paths
        all_paths = []  # Store paths for plan-realization loss

        for i, item in enumerate(batch):
            grid = item["tilesInterior"]
            start = item["start"]
            goal = item["goal"]

            # Remap tiles to contiguous indices
            flat_tiles = []
            for row in grid:
                for val in row:
                    flat_tiles.append(remap_tile(val))

            tiles[i] = torch.tensor(flat_tiles, dtype=torch.long)
            start_pos[i] = start["y"] * W + start["x"]
            goal_pos[i] = goal["y"] * W + goal["x"]

            # Get optimal path - prefer pre-labeled data, fallback to verifier
            optimal_path = []
            if "optimal_path" in item and len(item["optimal_path"]) == self.num_stops:
                # Use pre-labeled path from dataset: [[x,y], [x,y], ...]
                optimal_path = [(p[0], p[1]) for p in item["optimal_path"]]
            elif self.validate_fn is not None:
                # Fallback to verifier
                vr = self.validate_fn(grid, start["x"], start["y"], goal["x"], goal["y"], 10)
                if vr.solvable and hasattr(vr, 'optimal_path') and len(vr.optimal_path) == self.num_stops:
                    optimal_path = list(vr.optimal_path)

            if len(optimal_path) != self.num_stops:
                valid_path[i] = False
                all_paths.append([])  # Empty path for invalid samples
                continue

            if self.augment:
                tiles[i], start_pos[i], goal_pos[i], optimal_path, _ = augment_puzzle_with_path(
                    tiles[i], start_pos[i].item(), goal_pos[i].item(), optimal_path, H, W
                )

            # Store the path for plan-realization loss
            all_paths.append(optimal_path)

            # Build path conditioning tensors
            ssf, op = build_path_conditioning(optimal_path, W, H, self.num_stops)
            stop_step_feat[i] = ssf
            on_path[i] = op

        return {
            "tiles": tiles,
            "start_pos": start_pos,
            "goal_pos": goal_pos,
            "stop_step_feat": stop_step_feat,
            "on_path": on_path,
            "valid_path": valid_path,
            "optimal_paths": all_paths,  # List of paths for plan-realization loss
        }


class EMA:
    """Exponential Moving Average of model parameters for stable sampling."""

    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.model = model
        self.decay = decay
        self.shadow = {}
        self.backup = {}

        for name, param in model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = param.data.clone()

    def update(self):
        """Update EMA weights after each training step."""
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = (
                    self.decay * self.shadow[name] + (1 - self.decay) * param.data
                )

    def apply_shadow(self):
        """Apply EMA weights to model (for evaluation/generation)."""
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                self.backup[name] = param.data.clone()
                param.data = self.shadow[name]

    def restore(self):
        """Restore original weights after evaluation."""
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                param.data = self.backup[name]
        self.backup = {}


def try_import_verifier():
    """Try to import the Rust verifier."""
    try:
        from mazle_eval import validate_ice_interior
        return validate_ice_interior
    except ImportError:
        return None


def validate_puzzle(
    tiles: torch.Tensor,
    start_x: int,
    start_y: int,
    goal_x: int,
    goal_y: int,
    validate_fn,
    target_moves: int = 10,
):
    """Validate a single puzzle using Rust verifier."""
    H, W = 13, 13

    grid = []
    flat = tiles.tolist()
    for y in range(H):
        row = []
        for x in range(W):
            idx = flat[y * W + x]
            row.append(remap_tile_inv(idx))
        grid.append(row)

    result = validate_fn(grid, start_x, start_y, goal_x, goal_y, target_moves)
    return result


@torch.no_grad()
def generate_and_validate(
    model: PuzzleGeneratorV2,
    device: torch.device,
    validate_fn,
    num_samples: int = 32,
    k_candidates: int = 1,
    temperature: float = 1.0,
) -> Dict[str, float]:
    """Generate samples and validate with Rust verifier."""
    model.eval()

    metrics = {
        "total": 0,
        "valid_structure": 0,
        "solvable": 0,
        "no_stuck": 0,
        "unique_optimal": 0,
        "target_10": 0,
        "full_pass": 0,
    }

    move_counts = []

    for i in range(num_samples):
        seed = f"eval-{i}"

        if k_candidates > 1:
            result = model.generate_k_candidates(seed, k_candidates, device, temperature)
        else:
            seed_int = int(hashlib.sha256(seed.encode()).hexdigest()[:16], 16)
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_int)
            result = model.generate(1, device, gen, temperature)

        for j in range(result["tiles"].shape[0]):
            tiles = result["tiles"][j].reshape(-1)
            sx, sy = result["start_pos"][j].tolist()
            gx, gy = result["goal_pos"][j].tolist()

            metrics["total"] += 1
            metrics["valid_structure"] += 1  # By construction

            if validate_fn is not None:
                vr = validate_puzzle(tiles, sx, sy, gx, gy, validate_fn)

                if vr.solvable:
                    metrics["solvable"] += 1
                    move_counts.append(vr.optimal_moves)
                if vr.no_stuck:
                    metrics["no_stuck"] += 1
                if vr.unique_optimal:
                    metrics["unique_optimal"] += 1
                if vr.meets_target_moves:
                    metrics["target_10"] += 1
                if (vr.solvable and vr.no_stuck and vr.unique_optimal and vr.meets_target_moves):
                    metrics["full_pass"] += 1

    total = max(metrics["total"], 1)
    result = {k: v / total if k != "total" else v for k, v in metrics.items()}

    if move_counts:
        import statistics
        result["moves_mean"] = statistics.mean(move_counts)
        result["moves_median"] = statistics.median(move_counts)
        result["moves_stdev"] = statistics.stdev(move_counts) if len(move_counts) > 1 else 0
        result["moves_near_10"] = sum(1 for m in move_counts if abs(m - 10) <= 1) / len(move_counts)

    return result


@torch.no_grad()
def generate_and_validate_with_plan(
    model: PuzzleGeneratorV2,
    device: torch.device,
    validate_fn,
    num_samples: int = 32,
    temperature: float = 1.0,
    eval_data_path: Optional[Path] = None,
) -> Dict[str, float]:
    """
    Generate samples with ground-truth plan conditioning and validate.

    This is the key test for path conditioning: we load ground-truth puzzles
    from the training data, extract their optimal paths, and ask the model 
    to realize those plans. If plan conditioning works, metrics should improve.
    """
    model.eval()

    metrics = {
        "total": 0,
        "valid_structure": 0,
        "solvable": 0,
        "no_stuck": 0,
        "unique_optimal": 0,
        "target_10": 0,
        "full_pass": 0,
    }

    move_counts = []

    # Load ground-truth puzzles from training data for evaluation
    # This ensures we always have valid paths to condition on
    eval_puzzles = []
    if eval_data_path and eval_data_path.exists():
        with open(eval_data_path) as f:
            for i, line in enumerate(f):
                if i >= num_samples:
                    break
                eval_puzzles.append(json.loads(line))
    
    if not eval_puzzles:
        # Fallback: return empty metrics if no eval data
        return {k: 0.0 for k in metrics}

    for i, puzzle_data in enumerate(eval_puzzles):
        grid = puzzle_data["tilesInterior"]
        start = puzzle_data["start"]
        goal = puzzle_data["goal"]
        
        sx_orig, sy_orig = start["x"], start["y"]
        gx_orig, gy_orig = goal["x"], goal["y"]
        
        # Get optimal path - prefer pre-labeled, fallback to verifier
        optimal_path = []
        if "optimal_path" in puzzle_data and len(puzzle_data["optimal_path"]) == 11:
            optimal_path = [(p[0], p[1]) for p in puzzle_data["optimal_path"]]
        elif validate_fn is not None:
            vr = validate_fn(grid, sx_orig, sy_orig, gx_orig, gy_orig, 10)
            if vr.solvable and hasattr(vr, 'optimal_path') and len(vr.optimal_path) == 11:
                optimal_path = list(vr.optimal_path)
        
        if len(optimal_path) != 11:
            continue
        
        # Build conditioning tensors
        stop_step_feat, on_path = build_path_conditioning(optimal_path, W=13, H=13, S=11)
        stop_step_feat = stop_step_feat.unsqueeze(0).to(device)
        on_path = on_path.unsqueeze(0).to(device)
        
        # Convert positions to flat indices
        start_pos = torch.tensor([sy_orig * 13 + sx_orig], dtype=torch.long, device=device)
        goal_pos = torch.tensor([gy_orig * 13 + gx_orig], dtype=torch.long, device=device)
        
        # Create deterministic generator
        seed_int = int(hashlib.sha256(f"plan-eval-{i}".encode()).hexdigest()[:16], 16)
        gen = torch.Generator(device=device)
        gen.manual_seed(seed_int)
        
        # Generate with plan conditioning
        result = model.generate_with_plan(
            batch_size=1,
            device=device,
            start_pos=start_pos,
            goal_pos=goal_pos,
            stop_step_feat=stop_step_feat,
            on_path=on_path,
            generator=gen,
            temperature=temperature,
        )
        
        tiles = result["tiles"][0].reshape(-1)
        sx, sy = result["start_pos"][0].tolist()
        gx, gy = result["goal_pos"][0].tolist()
        
        metrics["total"] += 1
        metrics["valid_structure"] += 1
        
        vr_new = validate_puzzle(tiles, sx, sy, gx, gy, validate_fn)
        
        if vr_new.solvable:
            metrics["solvable"] += 1
            move_counts.append(vr_new.optimal_moves)
        if vr_new.no_stuck:
            metrics["no_stuck"] += 1
        if vr_new.unique_optimal:
            metrics["unique_optimal"] += 1
        if vr_new.meets_target_moves:
            metrics["target_10"] += 1
        if (vr_new.solvable and vr_new.no_stuck and vr_new.unique_optimal and vr_new.meets_target_moves):
            metrics["full_pass"] += 1

    total = max(metrics["total"], 1)
    result = {k: v / total if k != "total" else v for k, v in metrics.items()}

    if move_counts:
        import statistics
        result["moves_mean"] = statistics.mean(move_counts)
        result["moves_median"] = statistics.median(move_counts)
        result["moves_stdev"] = statistics.stdev(move_counts) if len(move_counts) > 1 else 0
        result["moves_near_10"] = sum(1 for m in move_counts if abs(m - 10) <= 1) / len(move_counts)

    return result


# =============================================================================
# DPO (Direct Preference Optimization) Training
# =============================================================================

class DPODataset(Dataset):
    """
    Dataset for DPO training on (winner, loser) puzzle pairs.

    Format: JSONL with {"winner": {...}, "loser": {...}} where each has
    tiles, start, goal in the same format as training data.
    """

    def __init__(self, path: Path):
        self.samples = []
        with open(path) as f:
            for line in f:
                self.samples.append(json.loads(line))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        return self.samples[idx]


class DPOCollateFn:
    """Collate function for DPO pairs."""

    def __init__(self, grid_height: int = 13, grid_width: int = 13):
        self.grid_height = grid_height
        self.grid_width = grid_width

    def _process_puzzle(self, puzzle: Dict) -> Tuple[torch.Tensor, int, int]:
        """Extract tiles, start_pos, goal_pos from a puzzle dict."""
        H, W = self.grid_height, self.grid_width
        grid = puzzle["tilesInterior"]
        start = puzzle["start"]
        goal = puzzle["goal"]

        flat_tiles = []
        for row in grid:
            for val in row:
                flat_tiles.append(remap_tile(val))

        tiles = torch.tensor(flat_tiles, dtype=torch.long)
        start_pos = start["y"] * W + start["x"]
        goal_pos = goal["y"] * W + goal["x"]

        return tiles, start_pos, goal_pos

    def __call__(self, batch: List[Dict]) -> Dict[str, torch.Tensor]:
        B = len(batch)
        H, W = self.grid_height, self.grid_width

        # Winner puzzles (10-move from training data)
        winner_tiles = torch.empty((B, H * W), dtype=torch.long)
        winner_start = torch.empty(B, dtype=torch.long)
        winner_goal = torch.empty(B, dtype=torch.long)

        # Loser puzzles (short-path from current model)
        loser_tiles = torch.empty((B, H * W), dtype=torch.long)
        loser_start = torch.empty(B, dtype=torch.long)
        loser_goal = torch.empty(B, dtype=torch.long)

        for i, item in enumerate(batch):
            w_tiles, w_start, w_goal = self._process_puzzle(item["winner"])
            l_tiles, l_start, l_goal = self._process_puzzle(item["loser"])

            winner_tiles[i] = w_tiles
            winner_start[i] = w_start
            winner_goal[i] = w_goal

            loser_tiles[i] = l_tiles
            loser_start[i] = l_start
            loser_goal[i] = l_goal

        return {
            "winner_tiles": winner_tiles,
            "winner_start": winner_start,
            "winner_goal": winner_goal,
            "loser_tiles": loser_tiles,
            "loser_start": loser_start,
            "loser_goal": loser_goal,
        }


def compute_log_prob(
    model: PuzzleGeneratorV2,
    tiles: torch.Tensor,
    start_pos: torch.Tensor,
    goal_pos: torch.Tensor,
    num_timesteps: int = 50,
) -> torch.Tensor:
    """
    Compute log probability of a puzzle under the model.

    We average over timesteps like in training, computing the expected
    log probability of predicting the correct tiles.

    Args:
        model: The puzzle generator
        tiles: (B, 169) tile indices
        start_pos: (B,) start positions
        goal_pos: (B,) goal positions
        num_timesteps: Number of timesteps to average over

    Returns:
        (B,) log probabilities
    """
    B = tiles.shape[0]
    device = tiles.device

    total_log_prob = torch.zeros(B, device=device)

    # Sample multiple timesteps and average
    for _ in range(num_timesteps):
        t = torch.randint(0, model.num_timesteps, (B,), device=device)

        # Forward diffusion
        x_t = model.q_sample(tiles, t)

        # Get predictions
        outputs = model(x_t, t, start_pos, goal_pos)
        tile_logits = outputs["tile_logits"]  # (B, 169, vocab_size)

        # Log probability of correct tiles
        log_probs = F.log_softmax(tile_logits, dim=-1)  # (B, 169, vocab_size)

        # Gather log probs for true tiles
        tile_log_probs = log_probs.gather(2, tiles.unsqueeze(-1)).squeeze(-1)  # (B, 169)

        # Sum over positions
        total_log_prob += tile_log_probs.sum(dim=1)  # (B,)

    # Average over timesteps
    return total_log_prob / num_timesteps


def dpo_loss(
    model: PuzzleGeneratorV2,
    ref_model: PuzzleGeneratorV2,
    winner_tiles: torch.Tensor,
    winner_start: torch.Tensor,
    winner_goal: torch.Tensor,
    loser_tiles: torch.Tensor,
    loser_start: torch.Tensor,
    loser_goal: torch.Tensor,
    beta: float = 0.1,
) -> torch.Tensor:
    """
    Compute DPO loss.

    DPO Loss = -log(sigmoid(beta * (log_pi(winner) - log_pi(loser)
                                    - log_ref(winner) + log_ref(loser))))

    This encourages the model to prefer winners over losers relative to
    the reference model.
    """
    # Compute log probs under current model
    log_pi_winner = compute_log_prob(model, winner_tiles, winner_start, winner_goal)
    log_pi_loser = compute_log_prob(model, loser_tiles, loser_start, loser_goal)

    # Compute log probs under reference model (frozen)
    with torch.no_grad():
        log_ref_winner = compute_log_prob(ref_model, winner_tiles, winner_start, winner_goal)
        log_ref_loser = compute_log_prob(ref_model, loser_tiles, loser_start, loser_goal)

    # DPO formula
    log_ratio_diff = (log_pi_winner - log_pi_loser) - (log_ref_winner - log_ref_loser)
    loss = -F.logsigmoid(beta * log_ratio_diff).mean()

    return loss


def train_dpo(args, model, device, validate_fn, out_dir):
    """DPO fine-tuning loop."""
    log_progress("Starting DPO fine-tuning...", out_dir)

    # Load DPO dataset
    dpo_data = DPODataset(Path(args.dpo_data))
    log_progress(f"Loaded {len(dpo_data)} DPO pairs", out_dir)

    dpo_loader = DataLoader(
        dpo_data,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        collate_fn=DPOCollateFn(),
    )

    # Create frozen reference model
    ref_model = PuzzleGeneratorV2(model.config).to(device)
    ref_model.load_state_dict(model.state_dict())
    ref_model.eval()
    for p in ref_model.parameters():
        p.requires_grad = False
    log_progress("Created frozen reference model", out_dir)

    # Optimizer
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )

    # EMA
    ema = EMA(model, decay=args.ema_decay)

    total_steps = len(dpo_loader) * args.epochs
    global_step = 0
    best_full_pass = 0.0

    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0

        pbar = tqdm(dpo_loader, desc=f"DPO epoch {epoch + 1}")
        for batch in pbar:
            winner_tiles = batch["winner_tiles"].to(device)
            winner_start = batch["winner_start"].to(device)
            winner_goal = batch["winner_goal"].to(device)
            loser_tiles = batch["loser_tiles"].to(device)
            loser_start = batch["loser_start"].to(device)
            loser_goal = batch["loser_goal"].to(device)

            loss = dpo_loss(
                model, ref_model,
                winner_tiles, winner_start, winner_goal,
                loser_tiles, loser_start, loser_goal,
                beta=args.dpo_beta,
            )

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; skipping", out_dir)
                continue

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
            optimizer.step()
            ema.update()

            epoch_loss += loss.item()
            global_step += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")

            if global_step % args.log_every == 0:
                log_progress(f"DPO step {global_step} loss={loss.item():.4f}", out_dir)

            # Evaluation
            if global_step % args.eval_every == 0:
                ema.apply_shadow()
                metrics = generate_and_validate(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                    k_candidates=args.k_candidates,
                )
                ema.restore()

                log_msg = (
                    f"DPO eval step={global_step} solve={metrics['solvable']:.1%} "
                    f"nostuck={metrics['no_stuck']:.1%} unique={metrics['unique_optimal']:.1%} "
                    f"t10={metrics['target_10']:.1%} PASS={metrics['full_pass']:.1%}"
                )
                if "moves_mean" in metrics:
                    log_msg += f" | moves_mean={metrics['moves_mean']:.1f}"
                log_progress(log_msg, out_dir)

                if metrics["full_pass"] > best_full_pass:
                    best_full_pass = metrics["full_pass"]
                    ema.apply_shadow()
                    torch.save({
                        "model_state": model.state_dict(),
                        "config": model.config,
                        "step": global_step,
                        "metrics": metrics,
                    }, out_dir / "best_dpo_model.pt")
                    ema.restore()
                    log_progress(f"New best DPO! full_pass={best_full_pass:.1%}", out_dir)

        log_progress(f"DPO epoch {epoch + 1} avg_loss={epoch_loss / len(dpo_loader):.4f}", out_dir)

    # Save final
    ema.apply_shadow()
    torch.save({
        "model_state": model.state_dict(),
        "config": model.config,
        "step": global_step,
    }, out_dir / "final_dpo_model.pt")
    ema.restore()

    log_progress(f"DPO training complete. Best full_pass={best_full_pass:.1%}", out_dir)


def train_pretrain(args, model, device, validate_fn, out_dir, config):
    """Standard pretraining loop."""
    data_path = Path(args.data)

    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)
    total_steps = steps_per_epoch * args.epochs

    log_progress(f"data={data_count} train={train_count} steps/epoch={steps_per_epoch}", out_dir)

    # Optimizer with warmup + cosine decay
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay,
        betas=(0.9, args.beta2)
    )

    warmup_steps = min(1000, total_steps // 10)
    lr_min_ratio = args.lr_min / args.lr

    def lr_lambda(step):
        if step < warmup_steps:
            return step / warmup_steps
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return lr_min_ratio + (1.0 - lr_min_ratio) * cosine

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # EMA
    ema = EMA(model, decay=args.ema_decay)
    log_progress(f"EMA initialized with decay={args.ema_decay}", out_dir)

    global_step = 0
    best_full_pass = 0.0

    for epoch in range(args.epochs):
        dataset = JsonlMazeDataset(
            data_path,
            split="train",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=args.shuffle_buffer,
            shuffle_seed=epoch + 42,
        )
        loader = DataLoader(
            dataset,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            collate_fn=CollateFnV2(augment=args.augment),
        )

        model.train()
        t0 = time.time()
        epoch_loss = 0.0
        epoch_samples = 0

        pbar = tqdm(loader, desc=f"epoch {epoch + 1}", total=steps_per_epoch)
        for batch in pbar:
            tiles = batch["tiles"].to(device)
            start_pos = batch["start_pos"].to(device)
            goal_pos = batch["goal_pos"].to(device)
            batch_size = tiles.shape[0]

            # Sample random timesteps
            t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)

            # Forward diffusion
            x_t = model.q_sample(tiles, t)

            # Forward pass
            outputs = model(x_t, t, start_pos, goal_pos)

            # Tile loss
            tile_logits = outputs["tile_logits"]
            tile_loss = F.cross_entropy(
                tile_logits.reshape(-1, config.tile_vocab_size),
                tiles.reshape(-1),
                label_smoothing=args.label_smoothing,
            )

            # Position losses
            start_logits = outputs["start_logits"]
            goal_logits = outputs["goal_logits"]
            start_loss = F.cross_entropy(start_logits, start_pos, label_smoothing=args.label_smoothing)
            goal_loss = F.cross_entropy(goal_logits, goal_pos, label_smoothing=args.label_smoothing)

            # Combined loss
            loss = tile_loss + 0.5 * start_loss + 0.5 * goal_loss

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; skipping", out_dir)
                continue

            epoch_loss += loss.item() * batch_size
            epoch_samples += batch_size

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            clip_val = args.grad_clip if args.grad_clip is not None else args.clip_grad
            torch.nn.utils.clip_grad_norm_(model.parameters(), clip_val)
            optimizer.step()
            scheduler.step()
            ema.update()

            if global_step % args.log_every == 0:
                dt = time.time() - t0
                lr = scheduler.get_last_lr()[0]
                log_progress(
                    f"step {global_step} loss={loss.item():.4f} tile={tile_loss.item():.4f} "
                    f"start={start_loss.item():.4f} goal={goal_loss.item():.4f} "
                    f"lr={lr:.2e} dt={dt:.1f}s",
                    out_dir,
                )

            # Evaluation
            if global_step > 0 and global_step % args.eval_every == 0:
                ema.apply_shadow()
                metrics = generate_and_validate(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                    k_candidates=args.k_candidates,
                )
                ema.restore()

                log_msg = (
                    f"eval step={global_step} valid={metrics['valid_structure']:.1%} "
                    f"solve={metrics['solvable']:.1%} nostuck={metrics['no_stuck']:.1%} "
                    f"unique={metrics['unique_optimal']:.1%} t10={metrics['target_10']:.1%} "
                    f"PASS={metrics['full_pass']:.1%}"
                )
                if "moves_mean" in metrics:
                    log_msg += f" | moves: mean={metrics['moves_mean']:.1f} near10={metrics['moves_near_10']:.1%}"
                log_progress(log_msg, out_dir)

                if metrics["full_pass"] > best_full_pass:
                    best_full_pass = metrics["full_pass"]
                    ema.apply_shadow()
                    torch.save({
                        "model_state": model.state_dict(),
                        "config": config,
                        "step": global_step,
                        "metrics": metrics,
                    }, out_dir / "best_model.pt")
                    ema.restore()
                    log_progress(f"New best! full_pass={best_full_pass:.1%}", out_dir)

            if global_step > 0 and global_step % args.save_every == 0:
                ema.apply_shadow()
                ckpt = {
                    "model_state": model.state_dict(),
                    "ema_shadow": ema.shadow,
                    "optimizer_state": optimizer.state_dict(),
                    "scheduler_state": scheduler.state_dict(),
                    "global_step": global_step,
                    "config": config,
                }
                ema.restore()
                ckpt_path = out_dir / f"checkpoint_{global_step:08d}.pt"
                torch.save(ckpt, ckpt_path)
                with open(out_dir / "latest.json", "w") as f:
                    json.dump({"checkpoint": str(ckpt_path), "step": global_step}, f)

            global_step += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")

            if global_step >= steps_per_epoch * (epoch + 1):
                break

        avg_loss = epoch_loss / max(1, epoch_samples)
        log_progress(f"epoch {epoch + 1} complete, avg_loss={avg_loss:.4f}", out_dir)

    # Final evaluation
    log_progress("Final evaluation...", out_dir)
    ema.apply_shadow()
    final_metrics = generate_and_validate(
        model, device, validate_fn,
        num_samples=256,
        k_candidates=args.k_candidates,
    )
    ema.restore()
    log_progress(
        f"FINAL: valid={final_metrics['valid_structure']:.1%} "
        f"solve={final_metrics['solvable']:.1%} nostuck={final_metrics['no_stuck']:.1%} "
        f"unique={final_metrics['unique_optimal']:.1%} t10={final_metrics['target_10']:.1%} "
        f"PASS={final_metrics['full_pass']:.1%}",
        out_dir,
    )

    torch.save({
        "model_state": model.state_dict(),
        "config": config,
        "step": global_step,
        "metrics": final_metrics,
    }, out_dir / "final_model.pt")
    log_progress(f"Training complete. Best full_pass={best_full_pass:.1%}", out_dir)


def train_pretrain_with_path(args, model, device, validate_fn, out_dir, config):
    """Pretraining with path conditioning - trains tile realizer on ground-truth plans."""
    data_path = Path(args.data)

    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)
    total_steps = steps_per_epoch * args.epochs

    log_progress(f"[PATH-COND] data={data_count} train={train_count} steps/epoch={steps_per_epoch}", out_dir)

    # Optimizer with warmup + step-down LR schedule (lock basin after ramp)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay,
        betas=(0.9, args.beta2)
    )

    warmup_steps = min(1000, total_steps // 10)
    lr_min_ratio = args.lr_min / args.lr
    
    # Step-down LR schedule: keeps high LR early, drops hard at ramp end
    def lr_lambda(step):
        if step < warmup_steps:
            return step / warmup_steps
        # Step-down schedule if configured
        if args.lr_step1 > 0 and step >= args.lr_step1:
            if args.lr_step2 > 0 and step >= args.lr_step2:
                return args.lr_drop1 * args.lr_drop2
            return args.lr_drop1
        # Before first step-down, maintain full LR
        if args.lr_step1 > 0:
            return 1.0
        # Fallback to cosine if no step-down configured
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return lr_min_ratio + (1.0 - lr_min_ratio) * cosine

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    
    if args.lr_step1 > 0:
        log_progress(
            f"LR step-down: {args.lr:.0e} until {args.lr_step1}, "
            f"{args.lr * args.lr_drop1:.0e} until {args.lr_step2}, "
            f"{args.lr * args.lr_drop1 * args.lr_drop2:.0e} after", out_dir
        )

    # EMA
    ema = EMA(model, decay=args.ema_decay)
    log_progress(f"EMA initialized with decay={args.ema_decay}", out_dir)

    # Plan loss scaler for EMA-based loss-ratio scaling
    plan_scaler = PlanLossScaler(
        target_ratio=args.plan_ratio_target,
        ema_beta=args.plan_ratio_ema,
        mult_min=args.plan_mult_min,
        mult_max=args.plan_mult_max,
        mult_max_late=args.plan_mult_max_late,
        activation_step=args.plan_scaling_activation_step,
        late_step=args.plan_scaling_late_step,
    )
    log_progress(
        f"Plan scaler: target_ratio={args.plan_ratio_target}, ema_beta={args.plan_ratio_ema}, "
        f"mult_range=[{args.plan_mult_min}, {args.plan_mult_max}], late_max={args.plan_mult_max_late}, "
        f"activation={args.plan_scaling_activation_step}, late={args.plan_scaling_late_step}", out_dir
    )
    log_progress(
        f"Lambda schedule: stop {args.lambda_stop_init}->{args.lambda_stop_final}, "
        f"clear {args.lambda_clear_init}->{args.lambda_clear_final}, "
        f"ramp steps {args.lambda_ramp_start}->{args.lambda_ramp_end}", out_dir
    )
    if args.lambda_shortcut_final > 0:
        log_progress(
            f"Shortcut schedule: {args.lambda_shortcut_init}->{args.lambda_shortcut_final}, "
            f"ramp steps {args.lambda_shortcut_ramp_start}->{args.lambda_shortcut_ramp_end}, "
            f"sample_fraction={args.shortcut_sample_fraction}", out_dir
        )

    global_step = 0
    best_full_pass = 0.0
    skipped_invalid = 0
    
    # Early stop tracking (only active after ramp)
    evals_without_improvement = 0
    consecutive_low_moves = 0
    early_stopped = False

    for epoch in range(args.epochs):
        dataset = JsonlMazeDataset(
            data_path,
            split="train",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=args.shuffle_buffer,
            shuffle_seed=epoch + 42,
        )
        loader = DataLoader(
            dataset,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            collate_fn=CollateFnV2WithPath(augment=args.augment, validate_fn=validate_fn),
        )

        model.train()
        t0 = time.time()
        epoch_loss = 0.0
        epoch_samples = 0

        pbar = tqdm(loader, desc=f"epoch {epoch + 1}", total=steps_per_epoch)
        for batch in pbar:
            tiles = batch["tiles"].to(device)
            start_pos = batch["start_pos"].to(device)
            goal_pos = batch["goal_pos"].to(device)
            stop_step_feat = batch["stop_step_feat"].to(device)
            on_path = batch["on_path"].to(device)
            valid_path = batch["valid_path"]
            optimal_paths = batch["optimal_paths"]  # List of paths
            batch_size = tiles.shape[0]

            # Filter out samples without valid paths
            valid_mask = valid_path.to(device)
            if not valid_mask.any():
                skipped_invalid += batch_size
                continue

            # Only use samples with valid paths
            tiles = tiles[valid_mask]
            start_pos = start_pos[valid_mask]
            goal_pos = goal_pos[valid_mask]
            stop_step_feat = stop_step_feat[valid_mask]
            on_path = on_path[valid_mask]
            # Filter paths to match valid mask
            valid_indices = valid_mask.cpu().numpy()
            filtered_paths = [p for i, p in enumerate(optimal_paths) if valid_indices[i]]
            batch_size = tiles.shape[0]

            # Sample random timesteps
            t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)

            # Forward diffusion
            x_t = model.q_sample(tiles, t)

            # Forward pass with path conditioning
            outputs = model(x_t, t, start_pos, goal_pos,
                           stop_step_feat=stop_step_feat, on_path=on_path)

            # Tile loss
            tile_logits = outputs["tile_logits"]
            tile_loss = F.cross_entropy(
                tile_logits.reshape(-1, config.tile_vocab_size),
                tiles.reshape(-1),
                label_smoothing=args.label_smoothing,
            )

            # Plan-realization loss (prevent shortcuts)
            L_stop, L_clear = compute_plan_realization_loss(
                tile_logits, filtered_paths, W=13, H=13
            )
            
            # Apply lambda scheduling (late ramp)
            t = ramp_t(global_step, args.lambda_ramp_start, args.lambda_ramp_end)
            lambda_stop = lerp(args.lambda_stop_init, args.lambda_stop_final, t)
            lambda_clear = lerp(args.lambda_clear_init, args.lambda_clear_final, t)
            
            # Compute base plan loss with scheduled lambdas
            plan_loss_base = lambda_stop * L_stop + lambda_clear * L_clear
            
            # Apply EMA-based loss-ratio scaling to keep plan loss influential
            plan_mult = plan_scaler.update_and_get_multiplier(
                tile_loss.detach().item(), 
                plan_loss_base.detach().item(),
                global_step,
            )
            plan_loss = plan_mult * plan_loss_base

            # L_shortcut: penalize cells enabling shortcuts (< 10 move solutions)
            # Only compute after ramp starts and with scheduled lambda
            t_shortcut = ramp_t(global_step, args.lambda_shortcut_ramp_start, args.lambda_shortcut_ramp_end)
            lambda_shortcut = lerp(args.lambda_shortcut_init, args.lambda_shortcut_final, t_shortcut)
            
            if lambda_shortcut > 0 and validate_fn is not None:
                tile_probs = F.softmax(tile_logits, dim=-1)
                L_shortcut, num_shortcuts, num_checked = compute_shortcut_loss(
                    tile_logits, tile_probs, tiles, start_pos, goal_pos,
                    filtered_paths, validate_fn,
                    sample_fraction=args.shortcut_sample_fraction,
                )
                shortcut_loss = lambda_shortcut * L_shortcut
            else:
                L_shortcut = torch.tensor(0.0, device=device)
                shortcut_loss = torch.tensor(0.0, device=device)
                num_shortcuts = 0
                num_checked = 0

            # Position losses (still train these)
            start_logits = outputs["start_logits"]
            goal_logits = outputs["goal_logits"]
            start_loss = F.cross_entropy(start_logits, start_pos, label_smoothing=args.label_smoothing)
            goal_loss = F.cross_entropy(goal_logits, goal_pos, label_smoothing=args.label_smoothing)

            # Combined loss
            loss = tile_loss + plan_loss + shortcut_loss + 0.5 * start_loss + 0.5 * goal_loss

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; skipping", out_dir)
                continue

            epoch_loss += loss.item() * batch_size
            epoch_samples += batch_size

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            clip_val = args.grad_clip if args.grad_clip is not None else args.clip_grad
            torch.nn.utils.clip_grad_norm_(model.parameters(), clip_val)
            optimizer.step()
            scheduler.step()
            ema.update()

            if global_step % args.log_every == 0:
                dt = time.time() - t0
                lr = scheduler.get_last_lr()[0]
                shortcut_info = f" sc={shortcut_loss.item():.4f}({num_shortcuts}/{num_checked})" if lambda_shortcut > 0 else ""
                log_progress(
                    f"step {global_step} loss={loss.item():.4f} tile={tile_loss.item():.4f} "
                    f"plan={plan_loss.item():.4f} (mult={plan_mult:.2f}){shortcut_info} start={start_loss.item():.4f} goal={goal_loss.item():.4f} "
                    f"lr={lr:.2e} λs={lambda_stop:.2f} λc={lambda_clear:.2f} dt={dt:.1f}s skipped={skipped_invalid}",
                    out_dir,
                )

            # Evaluation with plan conditioning
            if global_step > 0 and global_step % args.eval_every == 0:
                ema.apply_shadow()
                metrics = generate_and_validate_with_plan(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                    eval_data_path=data_path,
                )
                ema.restore()

                log_msg = (
                    f"eval step={global_step} valid={metrics['valid_structure']:.1%} "
                    f"solve={metrics['solvable']:.1%} nostuck={metrics['no_stuck']:.1%} "
                    f"unique={metrics['unique_optimal']:.1%} t10={metrics['target_10']:.1%} "
                    f"PASS={metrics['full_pass']:.1%}"
                )
                if "moves_mean" in metrics:
                    log_msg += f" | moves: mean={metrics['moves_mean']:.1f} near10={metrics['moves_near_10']:.1%}"
                log_progress(log_msg, out_dir)

                if metrics["full_pass"] > best_full_pass:
                    best_full_pass = metrics["full_pass"]
                    evals_without_improvement = 0
                    ema.apply_shadow()
                    torch.save({
                        "model_state": model.state_dict(),
                        "config": config,
                        "step": global_step,
                        "metrics": metrics,
                    }, out_dir / "best_model.pt")
                    ema.restore()
                    log_progress(f"New best! full_pass={best_full_pass:.1%}", out_dir)
                else:
                    evals_without_improvement += 1
                
                # Early stop logic (only active after ramp)
                if args.early_stop and global_step >= args.lambda_ramp_end:
                    moves_mean = metrics.get("moves_mean", 10.0)
                    
                    # Check moves drift
                    if moves_mean < args.early_stop_moves_threshold:
                        consecutive_low_moves += 1
                        if consecutive_low_moves >= args.early_stop_moves_count:
                            log_progress(
                                f"Early stop: moves_mean={moves_mean:.1f} < {args.early_stop_moves_threshold} "
                                f"for {consecutive_low_moves} consecutive evals", out_dir
                            )
                            early_stopped = True
                    else:
                        consecutive_low_moves = 0
                    
                    # Check PASS% stall
                    if evals_without_improvement >= args.early_stop_patience:
                        log_progress(
                            f"Early stop: no PASS% improvement for {evals_without_improvement} evals", out_dir
                        )
                        early_stopped = True

            if global_step > 0 and global_step % args.save_every == 0:
                ema.apply_shadow()
                ckpt = {
                    "model_state": model.state_dict(),
                    "ema_shadow": ema.shadow,
                    "optimizer_state": optimizer.state_dict(),
                    "scheduler_state": scheduler.state_dict(),
                    "global_step": global_step,
                    "config": config,
                }
                ema.restore()
                ckpt_path = out_dir / f"checkpoint_{global_step:08d}.pt"
                torch.save(ckpt, ckpt_path)
                with open(out_dir / "latest.json", "w") as f:
                    json.dump({"checkpoint": str(ckpt_path), "step": global_step}, f)

            global_step += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")

            if early_stopped:
                break
            if global_step >= steps_per_epoch * (epoch + 1):
                break

        avg_loss = epoch_loss / max(1, epoch_samples)
        log_progress(f"epoch {epoch + 1} complete, avg_loss={avg_loss:.4f}", out_dir)
        
        if early_stopped:
            break

    # Final evaluation
    log_progress("Final evaluation with plan conditioning...", out_dir)
    ema.apply_shadow()
    final_metrics = generate_and_validate_with_plan(
        model, device, validate_fn,
        num_samples=256,
        eval_data_path=data_path,
    )
    ema.restore()
    log_progress(
        f"FINAL: valid={final_metrics['valid_structure']:.1%} "
        f"solve={final_metrics['solvable']:.1%} nostuck={final_metrics['no_stuck']:.1%} "
        f"unique={final_metrics['unique_optimal']:.1%} t10={final_metrics['target_10']:.1%} "
        f"PASS={final_metrics['full_pass']:.1%}",
        out_dir,
    )

    torch.save({
        "model_state": model.state_dict(),
        "config": config,
        "step": global_step,
        "metrics": final_metrics,
    }, out_dir / "final_model.pt")
    log_progress(f"Training complete. Best full_pass={best_full_pass:.1%}", out_dir)


def get_cond_dropout_p(step: int, args) -> float:
    """
    Compute conditioning dropout probability based on step.
    
    Schedule:
    - Steps 0 → ramp1_end: p = p_init (0.10)
    - Steps ramp1_end → ramp2_end: linear ramp p_init → 0.60  
    - Steps ramp2_end → ramp3_end: linear ramp 0.60 → 0.90
    - Steps ramp3_end → total_steps: p = p_final (0.95)
    """
    if step < args.cond_dropout_ramp1_end:
        return args.cond_dropout_p_init
    elif step < args.cond_dropout_ramp2_end:
        # Ramp from p_init to 0.6
        t = (step - args.cond_dropout_ramp1_end) / max(1, args.cond_dropout_ramp2_end - args.cond_dropout_ramp1_end)
        return args.cond_dropout_p_init + t * (0.60 - args.cond_dropout_p_init)
    elif step < args.cond_dropout_ramp3_end:
        # Ramp from 0.6 to 0.9
        t = (step - args.cond_dropout_ramp2_end) / max(1, args.cond_dropout_ramp3_end - args.cond_dropout_ramp2_end)
        return 0.60 + t * (0.90 - 0.60)
    else:
        # Final phase: 0.95
        return args.cond_dropout_p_final


def train_cond_dropout(args, model, device, validate_fn, out_dir, config):
    """
    Fine-tune a path-conditioned model to work without path conditioning.
    
    Uses classifier-free conditioning dropout: randomly drop path features during
    training while keeping the same loss targets, forcing the model to internalize
    the planning signal rather than consuming it as input.
    """
    data_path = Path(args.data)
    
    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)
    
    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)
    total_steps = args.cond_dropout_total_steps
    
    log_progress(f"[COND-DROPOUT] data={data_count} train={train_count} steps/epoch={steps_per_epoch}", out_dir)
    log_progress(f"[COND-DROPOUT] total_steps={total_steps}, fine-tuning from checkpoint", out_dir)
    
    # Optimizer - lower LR for fine-tuning
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay,
        betas=(0.9, args.beta2)
    )
    
    # Simple constant LR for fine-tuning (with short warmup)
    warmup_steps = 500
    def lr_lambda(step):
        if step < warmup_steps:
            return step / warmup_steps
        return 1.0
    
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)
    log_progress(f"[COND-DROPOUT] LR={args.lr:.0e} (constant after {warmup_steps} warmup)", out_dir)
    
    # EMA
    ema = EMA(model, decay=args.ema_decay)
    log_progress(f"EMA initialized with decay={args.ema_decay}", out_dir)
    
    # Plan scaler (keep auxiliary losses relevant)
    plan_scaler = PlanLossScaler(
        target_ratio=0.3,
        ema_beta=0.99,
        mult_min=0.5,
        mult_max=8.0,  # Wider range for conditioning dropout
        mult_max_late=8.0,
        activation_step=0,
        late_step=0,
    )
    
    # Log schedules
    log_progress(
        f"[COND-DROPOUT] p_drop: {args.cond_dropout_p_init} until {args.cond_dropout_ramp1_end}, "
        f"ramp to 0.6 by {args.cond_dropout_ramp2_end}, ramp to 0.9 by {args.cond_dropout_ramp3_end}, "
        f"then {args.cond_dropout_p_final}", out_dir
    )
    log_progress(
        f"Lambda (fixed): stop={args.lambda_stop_final}, clear={args.lambda_clear_final}, "
        f"shortcut={args.lambda_shortcut_final}", out_dir
    )
    
    global_step = 0
    epoch = 0
    best_full_pass_uncond = 0.0
    best_full_pass_cond = 0.0
    evals_without_improvement = 0
    skipped_invalid = 0
    
    while global_step < total_steps:
        epoch += 1
        epoch_losses = []
        
        # Create fresh dataset/loader each epoch
        dataset = JsonlMazeDataset(
            data_path,
            split="train",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=args.shuffle_buffer,
            shuffle_seed=epoch + 42,
        )
        loader = DataLoader(
            dataset,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            collate_fn=CollateFnV2WithPath(augment=args.augment, validate_fn=validate_fn),
        )
        
        model.train()
        
        for batch in tqdm(loader, desc=f"epoch {epoch}", total=steps_per_epoch):
            if global_step >= total_steps:
                break
            
            # Unpack batch
            tiles = batch["tiles"].to(device)
            start_pos = batch["start_pos"].to(device)
            goal_pos = batch["goal_pos"].to(device)
            stop_step_feat = batch["stop_step_feat"].to(device)
            on_path = batch["on_path"].to(device)
            valid_path = batch["valid_path"]
            optimal_paths = batch["optimal_paths"]
            
            # Filter out samples without valid paths
            valid_mask = valid_path.to(device)
            if not valid_mask.any():
                skipped_invalid += tiles.shape[0]
                continue
            
            # Only use samples with valid paths
            tiles = tiles[valid_mask]
            start_pos = start_pos[valid_mask]
            goal_pos = goal_pos[valid_mask]
            stop_step_feat = stop_step_feat[valid_mask]
            on_path = on_path[valid_mask]
            valid_indices = valid_mask.cpu().numpy()
            filtered_paths = [p for i, p in enumerate(optimal_paths) if valid_indices[i]]
            batch_size = tiles.shape[0]
            
            # Sample timesteps
            t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)
            
            # Forward diffusion
            x_t = model.q_sample(tiles, t)
            
            # Conditioning dropout: randomly drop path features
            p_drop = get_cond_dropout_p(global_step, args)
            drop_mask = torch.rand(batch_size, device=device) < p_drop
            
            # Create masked conditioning (None for dropped samples)
            # We need per-sample dropout, so we zero out the features instead of passing None
            stop_step_feat_masked = stop_step_feat.clone()
            on_path_masked = on_path.clone()
            stop_step_feat_masked[drop_mask] = 0.0
            on_path_masked[drop_mask] = 0.0
            
            # Forward pass (with potentially zeroed conditioning)
            outputs = model(x_t, t, start_pos, goal_pos,
                           stop_step_feat=stop_step_feat_masked, 
                           on_path=on_path_masked)
            
            # Tile loss (same for all samples)
            tile_logits = outputs["tile_logits"]
            tile_loss = F.cross_entropy(
                tile_logits.reshape(-1, config.tile_vocab_size),
                tiles.reshape(-1),
                label_smoothing=args.label_smoothing,
            )
            
            # Plan-realization loss (always computed with ground-truth paths)
            # This is the key: we keep the constraints even when conditioning is dropped
            L_stop, L_clear = compute_plan_realization_loss(
                tile_logits, filtered_paths, W=13, H=13
            )
            
            # Use final lambda values (no ramping in fine-tune)
            lambda_stop = args.lambda_stop_final
            lambda_clear = args.lambda_clear_final
            
            plan_loss_base = lambda_stop * L_stop + lambda_clear * L_clear
            
            # Shortcut loss (on subset of batch)
            shortcut_loss = torch.tensor(0.0, device=device)
            num_shortcuts = 0
            num_checked = 0
            if args.lambda_shortcut_final > 0 and validate_fn is not None:
                tile_probs = F.softmax(tile_logits, dim=-1)
                L_shortcut, num_shortcuts, num_checked = compute_shortcut_loss(
                    tile_logits, tile_probs, tiles, start_pos, goal_pos,
                    filtered_paths, validate_fn,
                    sample_fraction=args.shortcut_sample_fraction,
                )
                shortcut_loss = args.lambda_shortcut_final * L_shortcut
            
            plan_loss = plan_loss_base + shortcut_loss
            
            # Scale plan loss to maintain gradient contribution
            plan_mult = plan_scaler.update_and_get_multiplier(tile_loss.item(), plan_loss.item(), global_step)
            
            # Total loss
            loss = tile_loss + plan_mult * plan_loss
            
            # Backward
            optimizer.zero_grad()
            loss.backward()
            if args.clip_grad > 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
            optimizer.step()
            scheduler.step()
            ema.update()
            
            epoch_losses.append(loss.item())
            
            # Logging
            if global_step % args.log_every == 0:
                lr = optimizer.param_groups[0]["lr"]
                drop_pct = p_drop * 100
                log_progress(
                    f"step {global_step} loss={loss.item():.4f} tile={tile_loss.item():.4f} "
                    f"plan={plan_loss.item():.4f} (mult={plan_mult:.2f}) "
                    f"p_drop={drop_pct:.0f}% lr={lr:.2e}", out_dir
                )
            
            # Evaluation - report BOTH conditioned and unconditioned
            if global_step > 0 and global_step % args.eval_every == 0:
                ema.apply_shadow()
                
                # Unconditioned eval (the metric we care about)
                metrics_uncond = generate_and_validate(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                )
                
                # Conditioned eval (for reference)
                metrics_cond = generate_and_validate_with_plan(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                    eval_data_path=data_path,
                )
                
                ema.restore()
                
                # Log unconditioned
                log_msg_uncond = (
                    f"eval step={global_step} [UNCOND] solve={metrics_uncond['solvable']:.1%} "
                    f"unique={metrics_uncond['unique_optimal']:.1%} t10={metrics_uncond['target_10']:.1%} "
                    f"PASS={metrics_uncond['full_pass']:.1%}"
                )
                if "moves_mean" in metrics_uncond:
                    log_msg_uncond += f" | moves={metrics_uncond['moves_mean']:.1f}"
                log_progress(log_msg_uncond, out_dir)
                
                # Log conditioned
                log_msg_cond = (
                    f"eval step={global_step} [COND]   solve={metrics_cond['solvable']:.1%} "
                    f"unique={metrics_cond['unique_optimal']:.1%} t10={metrics_cond['target_10']:.1%} "
                    f"PASS={metrics_cond['full_pass']:.1%}"
                )
                if "moves_mean" in metrics_cond:
                    log_msg_cond += f" | moves={metrics_cond['moves_mean']:.1f}"
                log_progress(log_msg_cond, out_dir)
                
                # Save best based on UNCONDITIONED PASS (this is what we care about)
                if metrics_uncond["full_pass"] > best_full_pass_uncond:
                    best_full_pass_uncond = metrics_uncond["full_pass"]
                    evals_without_improvement = 0
                    ema.apply_shadow()
                    torch.save({
                        "model_state": model.state_dict(),
                        "config": config,
                        "step": global_step,
                        "metrics_uncond": metrics_uncond,
                        "metrics_cond": metrics_cond,
                    }, out_dir / "best_model.pt")
                    ema.restore()
                    log_progress(f"  -> New best UNCOND PASS={best_full_pass_uncond:.1%}", out_dir)
                else:
                    evals_without_improvement += 1
                
                if metrics_cond["full_pass"] > best_full_pass_cond:
                    best_full_pass_cond = metrics_cond["full_pass"]
                
                # Early stopping based on unconditioned metrics
                if args.early_stop and evals_without_improvement >= args.early_stop_patience:
                    uncond_moves = metrics_uncond.get("moves_mean", 0)
                    if uncond_moves < args.early_stop_moves_threshold:
                        log_progress(
                            f"Early stop: {evals_without_improvement} evals without improvement, "
                            f"moves_mean={uncond_moves:.1f} < {args.early_stop_moves_threshold}", out_dir
                        )
                        break
            
            # Checkpoint
            if global_step > 0 and global_step % args.save_every == 0:
                ema.apply_shadow()
                torch.save({
                    "model_state": model.state_dict(),
                    "config": config,
                    "step": global_step,
                }, out_dir / f"checkpoint_{global_step}.pt")
                ema.restore()
            
            global_step += 1
        
        if epoch_losses:
            avg_loss = sum(epoch_losses) / len(epoch_losses)
            log_progress(f"epoch {epoch} complete, avg_loss={avg_loss:.4f}", out_dir)
    
    # Final evaluation
    ema.apply_shadow()
    final_metrics_uncond = generate_and_validate(
        model, device, validate_fn,
        num_samples=args.generate_samples * 2,
    )
    final_metrics_cond = generate_and_validate_with_plan(
        model, device, validate_fn,
        num_samples=args.generate_samples * 2,
        eval_data_path=data_path,
    )
    
    log_progress(
        f"FINAL [UNCOND] solve={final_metrics_uncond['solvable']:.1%} "
        f"unique={final_metrics_uncond['unique_optimal']:.1%} "
        f"t10={final_metrics_uncond['target_10']:.1%} PASS={final_metrics_uncond['full_pass']:.1%} "
        f"| moves={final_metrics_uncond.get('moves_mean', 0):.1f}", out_dir
    )
    log_progress(
        f"FINAL [COND]   solve={final_metrics_cond['solvable']:.1%} "
        f"unique={final_metrics_cond['unique_optimal']:.1%} "
        f"t10={final_metrics_cond['target_10']:.1%} PASS={final_metrics_cond['full_pass']:.1%} "
        f"| moves={final_metrics_cond.get('moves_mean', 0):.1f}", out_dir
    )
    
    torch.save({
        "model_state": model.state_dict(),
        "config": config,
        "step": global_step,
        "metrics_uncond": final_metrics_uncond,
        "metrics_cond": final_metrics_cond,
    }, out_dir / "final_model.pt")
    ema.restore()
    
    log_progress(
        f"Conditioning dropout fine-tune complete. "
        f"Best UNCOND PASS={best_full_pass_uncond:.1%}, Best COND PASS={best_full_pass_cond:.1%}", out_dir
    )


def main():
    parser = argparse.ArgumentParser(description="Train puzzle generator v2 (clean)")

    # Data
    parser.add_argument("--data", type=str, help="Path to training JSONL (for pretraining)")
    parser.add_argument("--out", type=str, required=True, help="Output directory")
    parser.add_argument("--data-count", type=int, default=None)

    # DPO mode
    parser.add_argument("--dpo", action="store_true", help="Run DPO fine-tuning instead of pretraining")
    parser.add_argument("--dpo-data", type=str, help="Path to DPO pairs JSONL")
    parser.add_argument("--dpo-beta", type=float, default=0.1, help="DPO beta parameter")
    parser.add_argument("--checkpoint", type=str, help="Checkpoint to load before DPO")

    # Path conditioning mode
    parser.add_argument("--path-cond", action="store_true", help="Train with path conditioning (ground-truth plan)")
    # Lambda scheduling (late ramp)
    parser.add_argument("--lambda-stop-init", type=float, default=0.15, help="Initial lambda_stop")
    parser.add_argument("--lambda-stop-final", type=float, default=0.40, help="Final lambda_stop after ramp")
    parser.add_argument("--lambda-clear-init", type=float, default=0.05, help="Initial lambda_clear")
    parser.add_argument("--lambda-clear-final", type=float, default=0.20, help="Final lambda_clear after ramp")
    parser.add_argument("--lambda-ramp-start", type=int, default=10000, help="Step to start ramping lambdas")
    parser.add_argument("--lambda-ramp-end", type=int, default=18000, help="Step to finish ramping lambdas")
    # EMA-based loss-ratio scaling
    parser.add_argument("--plan-ratio-target", type=float, default=0.30, help="Target ratio: plan_loss / tile_loss")
    parser.add_argument("--plan-ratio-ema", type=float, default=0.99, help="EMA beta for loss tracking")
    parser.add_argument("--plan-mult-min", type=float, default=0.5, help="Min multiplier for plan loss")
    parser.add_argument("--plan-mult-max", type=float, default=4.0, help="Max multiplier for plan loss (before late)")
    parser.add_argument("--plan-mult-max-late", type=float, default=8.0, help="Max multiplier for plan loss (after late step)")
    parser.add_argument("--plan-scaling-activation-step", type=int, default=10000, help="Step to activate EMA scaling (force mult=1.0 before)")
    parser.add_argument("--plan-scaling-late-step", type=int, default=18000, help="Step to switch to late max ceiling")
    
    # LR step-down schedule (lock basin after ramp)
    parser.add_argument("--lr-step1", type=int, default=0, help="Step for first LR drop (0=disabled, use cosine)")
    parser.add_argument("--lr-step2", type=int, default=0, help="Step for second LR drop")
    parser.add_argument("--lr-drop1", type=float, default=0.3, help="LR multiplier at step1 (e.g., 0.3 = 3e-5 from 1e-4)")
    parser.add_argument("--lr-drop2", type=float, default=0.333, help="Additional LR multiplier at step2 (stacks with drop1)")
    
    # Early stop (after ramp)
    parser.add_argument("--early-stop", action="store_true", help="Enable early stopping after ramp")
    parser.add_argument("--early-stop-patience", type=int, default=6, help="Stop after N evals without PASS% improvement")
    parser.add_argument("--early-stop-moves-threshold", type=float, default=7.0, help="Stop if moves_mean drops below this")
    parser.add_argument("--early-stop-moves-count", type=int, default=2, help="Stop after N consecutive low-moves evals")
    
    # L_shortcut: anti-shortcut loss (penalize cells enabling <10 move solutions)
    parser.add_argument("--lambda-shortcut-init", type=float, default=0.0, help="Initial lambda_shortcut (usually 0)")
    parser.add_argument("--lambda-shortcut-final", type=float, default=0.30, help="Final lambda_shortcut after ramp")
    parser.add_argument("--lambda-shortcut-ramp-start", type=int, default=12000, help="Step to start ramping lambda_shortcut")
    parser.add_argument("--lambda-shortcut-ramp-end", type=int, default=18000, help="Step to finish ramping lambda_shortcut")
    parser.add_argument("--shortcut-sample-fraction", type=float, default=0.25, help="Fraction of batch to check for shortcuts")
    
    # Conditioning dropout fine-tuning (converts path-conditioned model to unconditional)
    parser.add_argument("--cond-dropout", action="store_true", help="Enable conditioning dropout fine-tuning")
    parser.add_argument("--cond-dropout-p-init", type=float, default=0.10, help="Initial conditioning dropout probability")
    parser.add_argument("--cond-dropout-p-final", type=float, default=0.95, help="Final conditioning dropout probability")
    parser.add_argument("--cond-dropout-ramp1-end", type=int, default=2000, help="End of phase 1 (constant p_init)")
    parser.add_argument("--cond-dropout-ramp2-end", type=int, default=10000, help="End of phase 2 (ramp to 0.6)")
    parser.add_argument("--cond-dropout-ramp3-end", type=int, default=20000, help="End of phase 3 (ramp to 0.9)")
    parser.add_argument("--cond-dropout-total-steps", type=int, default=30000, help="Total fine-tuning steps")

    # Training
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--preset", type=str, default="base", choices=["small", "base", "large", "deep"])
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--clip-grad", type=float, default=1.0)
    parser.add_argument("--val-pct", type=float, default=0.02)
    parser.add_argument("--test-pct", type=float, default=0.01)
    parser.add_argument("--shuffle-buffer", type=int, default=8192)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--save-every", type=int, default=2000)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--generate-samples", type=int, default=256)
    parser.add_argument("--k-candidates", type=int, default=1)
    parser.add_argument("--ema-decay", type=float, default=0.999)
    parser.add_argument("--augment", action="store_true", help="Enable data augmentation")
    parser.add_argument("--lr-min", type=float, default=1e-6)
    
    # Model architecture variants
    parser.add_argument("--ff-activation", type=str, default="gelu", choices=["gelu", "swiglu", "geglu"])
    parser.add_argument("--norm-type", type=str, default="layernorm", choices=["layernorm", "rmsnorm"])
    parser.add_argument("--time-conditioning", type=str, default="add", choices=["add", "adaln_zero"])
    parser.add_argument("--drop-path", type=float, default=0.0, help="DropPath/stochastic depth rate")
    parser.add_argument("--residual-scale", action="store_true", help="Scale residuals by 1/sqrt(2L)")
    parser.add_argument("--num-layers", type=int, default=None, help="Override number of layers")
    
    # Additional hyperparameters for sweep
    parser.add_argument("--num-timesteps", type=int, default=None, help="Override diffusion timesteps")
    parser.add_argument("--mask-schedule", type=str, default=None, choices=["cosine", "linear"])
    parser.add_argument("--model-dim", type=int, default=None, help="Override model dimension")
    parser.add_argument("--ff-dim", type=int, default=None, help="Override feedforward dimension")
    parser.add_argument("--label-smoothing", type=float, default=0.0, help="Label smoothing for CE loss")
    parser.add_argument("--beta2", type=float, default=0.999, help="AdamW beta2")
    parser.add_argument("--grad-clip", type=float, default=None, help="Gradient clipping (overrides --clip-grad)")

    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")

    log_progress(f"device={device}", out_dir)

    # Verifier
    validate_fn = try_import_verifier()
    if validate_fn:
        log_progress("Rust verifier available", out_dir)
    else:
        log_progress("WARNING: Rust verifier not available", out_dir)

    # Model - apply architecture variant overrides
    config = config_for_preset(args.preset)
    config.ff_activation = args.ff_activation
    config.norm_type = args.norm_type
    config.time_conditioning = args.time_conditioning
    config.drop_path = args.drop_path
    config.residual_scale = args.residual_scale
    if args.num_layers is not None:
        config.num_layers = args.num_layers
    if args.num_timesteps is not None:
        config.num_timesteps = args.num_timesteps
    if args.mask_schedule is not None:
        config.mask_schedule = args.mask_schedule
    if args.model_dim is not None:
        config.model_dim = args.model_dim
    if args.ff_dim is not None:
        config.ff_dim = args.ff_dim
    
    model = PuzzleGeneratorV2(config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    
    # Log config details
    variant_str = []
    if args.ff_activation != "gelu":
        variant_str.append(f"ff={args.ff_activation}")
    if args.norm_type != "layernorm":
        variant_str.append(f"norm={args.norm_type}")
    if args.time_conditioning != "add":
        variant_str.append(f"time={args.time_conditioning}")
    if args.drop_path > 0:
        variant_str.append(f"droppath={args.drop_path}")
    if args.residual_scale:
        variant_str.append("resscale")
    if args.num_layers is not None:
        variant_str.append(f"layers={args.num_layers}")
    if args.num_timesteps is not None:
        variant_str.append(f"steps={args.num_timesteps}")
    if args.mask_schedule is not None:
        variant_str.append(f"sched={args.mask_schedule}")
    if args.model_dim is not None:
        variant_str.append(f"dim={args.model_dim}")
    if args.label_smoothing > 0:
        variant_str.append(f"ls={args.label_smoothing}")
    if args.beta2 != 0.999:
        variant_str.append(f"b2={args.beta2}")
    
    variant_info = f" [{', '.join(variant_str)}]" if variant_str else ""
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset}){variant_info}", out_dir)

    # Load checkpoint if specified
    if args.checkpoint:
        ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
        # Support EMA weights (stored under 'ema_shadow' key)
        if "ema_shadow" in ckpt:
            model.load_state_dict(ckpt["ema_shadow"], strict=False)
        else:
            model.load_state_dict(ckpt["model_state"])
        log_progress(f"Loaded checkpoint: {args.checkpoint}", out_dir)

    # Run appropriate training mode
    if args.dpo:
        if not args.dpo_data:
            raise ValueError("--dpo-data required for DPO training")
        if not args.checkpoint:
            log_progress("WARNING: Running DPO without pretrained checkpoint", out_dir)
        train_dpo(args, model, device, validate_fn, out_dir)
    elif args.cond_dropout:
        if not args.data:
            raise ValueError("--data required for conditioning dropout fine-tuning")
        if not args.checkpoint:
            raise ValueError("--checkpoint required for conditioning dropout (must start from trained model)")
        log_progress("Starting conditioning dropout fine-tuning (path-conditioned → unconditional)", out_dir)
        train_cond_dropout(args, model, device, validate_fn, out_dir, config)
    elif args.path_cond:
        if not args.data:
            raise ValueError("--data required for path-conditioned training")
        log_progress("Starting path-conditioned training (ground-truth plan)", out_dir)
        train_pretrain_with_path(args, model, device, validate_fn, out_dir, config)
    else:
        if not args.data:
            raise ValueError("--data required for pretraining")
        train_pretrain(args, model, device, validate_fn, out_dir, config)


if __name__ == "__main__":
    main()
