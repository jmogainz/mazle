"""
Training script for Puzzle Generator v2.

Key changes from v1:
1. No seed conditioning - model learns distribution, not seed→puzzle mapping
2. Separate START/GOAL as position heads
3. BERT-style masked modeling (not autoregressive)
4. Deterministic seeded sampling for generation
5. Generate-many + verifier filter baseline
6. Path auxiliary heads for move-count learning
7. EMA (Exponential Moving Average) for stable sampling
"""

import argparse
import copy
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
from torch.utils.data import DataLoader
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

# Global verifier function (set during init)
_VALIDATE_FN = None


def set_validate_fn(fn):
    """Set the global verifier function for path computation."""
    global _VALIDATE_FN
    _VALIDATE_FN = fn


def compute_path_masks(grid: List[List[int]], start: dict, goal: dict, width: int = 13) -> Tuple[torch.Tensor, torch.Tensor, Optional[torch.Tensor]]:
    """
    Compute on_path, is_stop masks, and ordered stop sequence from a puzzle.
    
    Returns:
        on_path: (169,) binary tensor - 1 if cell is on optimal path
        is_stop: (169,) binary tensor - 1 if cell is a stop position
        stop_sequence: (11,) tensor of flat indices for ordered stops, or None if not 11 stops
    """
    global _VALIDATE_FN
    
    on_path = torch.zeros(169, dtype=torch.float32)
    is_stop = torch.zeros(169, dtype=torch.float32)
    stop_sequence = None
    
    if _VALIDATE_FN is None:
        return on_path, is_stop, stop_sequence
    
    try:
        result = _VALIDATE_FN(grid, start["x"], start["y"], goal["x"], goal["y"], None)
        if result.solvable and result.optimal_path:
            path = result.optimal_path
            for x, y in path:
                flat_idx = y * width + x
                if 0 <= flat_idx < 169:
                    is_stop[flat_idx] = 1.0
                    on_path[flat_idx] = 1.0
            
            # Create ordered stop sequence if exactly 11 stops (10 moves)
            if len(path) == 11:
                stop_sequence = torch.tensor([y * width + x for x, y in path], dtype=torch.long)
    except Exception:
        pass
    
    return on_path, is_stop, stop_sequence


def count_lines(path: Path) -> int:
    with open(path) as f:
        return sum(1 for _ in f)


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
# Original IDs: 5=up, 6=down, 7=left, 8=right
# After remapping: 3=up, 4=down, 5=left, 6=right
LEDGE_REMAP_90CW = {3: 5, 4: 6, 5: 4, 6: 3}  # up->left, down->right, left->down, right->up
LEDGE_REMAP_180 = {3: 4, 4: 3, 5: 6, 6: 5}   # up<->down, left<->right
LEDGE_REMAP_90CCW = {3: 6, 4: 5, 5: 3, 6: 4} # up->right, down->left, left->up, right->down
LEDGE_REMAP_FLIP_H = {3: 3, 4: 4, 5: 6, 6: 5} # left<->right
LEDGE_REMAP_FLIP_V = {3: 4, 4: 3, 5: 5, 6: 6} # up<->down


def transform_tile(tile_idx: int, transform_map: dict) -> int:
    """Transform a tile index according to augmentation."""
    if tile_idx in transform_map:
        return transform_map[tile_idx]
    return tile_idx


def transform_position(flat_idx: int, aug_type: int, H: int = 13, W: int = 13) -> int:
    """Transform a flat position index according to augmentation type."""
    y, x = flat_idx // W, flat_idx % W
    
    if aug_type == 0:
        pass  # Identity
    elif aug_type == 1:  # Rotate 90 CW
        x, y = H - 1 - y, x
    elif aug_type == 2:  # Rotate 180
        x, y = W - 1 - x, H - 1 - y
    elif aug_type == 3:  # Rotate 270 CW
        x, y = y, W - 1 - x
    elif aug_type == 4:  # Flip horizontal
        x = W - 1 - x
    elif aug_type == 5:  # Flip vertical
        y = H - 1 - y
    elif aug_type == 6:  # Transpose
        x, y = y, x
    elif aug_type == 7:  # Anti-transpose
        x, y = H - 1 - y, W - 1 - x
    
    return y * W + x


def augment_puzzle(tiles: torch.Tensor, start_pos: int, goal_pos: int, 
                   on_path: torch.Tensor, is_stop: torch.Tensor,
                   stop_sequence: Optional[torch.Tensor] = None,
                   H: int = 13, W: int = 13) -> Tuple:
    """
    Apply random augmentation to a puzzle.
    
    Augmentations: identity, rot90, rot180, rot270, flip_h, flip_v, flip_diag1, flip_diag2
    """
    import random
    aug_type = random.randint(0, 7)
    
    if aug_type == 0:
        # Identity - no change
        return tiles, start_pos, goal_pos, on_path, is_stop, stop_sequence
    
    # Reshape to 2D for transformations
    tiles_2d = tiles.reshape(H, W).clone()
    on_path_2d = on_path.reshape(H, W).clone()
    is_stop_2d = is_stop.reshape(H, W).clone()
    
    start_y, start_x = start_pos // W, start_pos % W
    goal_y, goal_x = goal_pos // W, goal_pos % W
    
    if aug_type == 1:
        # Rotate 90 CW
        tiles_2d = torch.rot90(tiles_2d, k=-1)
        on_path_2d = torch.rot90(on_path_2d, k=-1)
        is_stop_2d = torch.rot90(is_stop_2d, k=-1)
        start_x, start_y = H - 1 - start_y, start_x
        goal_x, goal_y = H - 1 - goal_y, goal_x
        ledge_map = LEDGE_REMAP_90CW
    elif aug_type == 2:
        # Rotate 180
        tiles_2d = torch.rot90(tiles_2d, k=2)
        on_path_2d = torch.rot90(on_path_2d, k=2)
        is_stop_2d = torch.rot90(is_stop_2d, k=2)
        start_x, start_y = W - 1 - start_x, H - 1 - start_y
        goal_x, goal_y = W - 1 - goal_x, H - 1 - goal_y
        ledge_map = LEDGE_REMAP_180
    elif aug_type == 3:
        # Rotate 270 CW (90 CCW)
        tiles_2d = torch.rot90(tiles_2d, k=1)
        on_path_2d = torch.rot90(on_path_2d, k=1)
        is_stop_2d = torch.rot90(is_stop_2d, k=1)
        start_x, start_y = start_y, W - 1 - start_x
        goal_x, goal_y = goal_y, W - 1 - goal_x
        ledge_map = LEDGE_REMAP_90CCW
    elif aug_type == 4:
        # Flip horizontal
        tiles_2d = torch.flip(tiles_2d, dims=[1])
        on_path_2d = torch.flip(on_path_2d, dims=[1])
        is_stop_2d = torch.flip(is_stop_2d, dims=[1])
        start_x = W - 1 - start_x
        goal_x = W - 1 - goal_x
        ledge_map = LEDGE_REMAP_FLIP_H
    elif aug_type == 5:
        # Flip vertical
        tiles_2d = torch.flip(tiles_2d, dims=[0])
        on_path_2d = torch.flip(on_path_2d, dims=[0])
        is_stop_2d = torch.flip(is_stop_2d, dims=[0])
        start_y = H - 1 - start_y
        goal_y = H - 1 - goal_y
        ledge_map = LEDGE_REMAP_FLIP_V
    elif aug_type == 6:
        # Flip along main diagonal (transpose then adjust ledges)
        tiles_2d = tiles_2d.T
        on_path_2d = on_path_2d.T
        is_stop_2d = is_stop_2d.T
        start_x, start_y = start_y, start_x
        goal_x, goal_y = goal_y, goal_x
        # Transpose swaps left<->up and right<->down
        ledge_map = {3: 5, 4: 6, 5: 3, 6: 4}
    else:  # aug_type == 7
        # Flip along anti-diagonal
        tiles_2d = torch.flip(tiles_2d.T, dims=[0, 1])
        on_path_2d = torch.flip(on_path_2d.T, dims=[0, 1])
        is_stop_2d = torch.flip(is_stop_2d.T, dims=[0, 1])
        start_x, start_y = H - 1 - start_y, W - 1 - start_x
        goal_x, goal_y = H - 1 - goal_y, W - 1 - goal_x
        ledge_map = {3: 6, 4: 5, 5: 4, 6: 3}
    
    # Transform ledge tiles
    for y in range(H):
        for x in range(W):
            tiles_2d[y, x] = transform_tile(tiles_2d[y, x].item(), ledge_map)
    
    # Flatten back
    tiles_out = tiles_2d.reshape(-1)
    on_path_out = on_path_2d.reshape(-1)
    is_stop_out = is_stop_2d.reshape(-1)
    start_pos_out = start_y * W + start_x
    goal_pos_out = goal_y * W + goal_x
    
    # Transform stop sequence if present
    stop_sequence_out = None
    if stop_sequence is not None:
        stop_sequence_out = torch.tensor(
            [transform_position(p.item(), aug_type, H, W) for p in stop_sequence],
            dtype=torch.long
        )
    
    return tiles_out, start_pos_out, goal_pos_out, on_path_out, is_stop_out, stop_sequence_out


class CollateFnV2:
    """Collate function for v2 model - extracts tiles WITHOUT start/goal."""
    
    def __init__(self, grid_height: int = 13, grid_width: int = 13, 
                 compute_paths: bool = True, augment: bool = False):
        self.grid_height = grid_height
        self.grid_width = grid_width
        self.compute_paths = compute_paths
        self.augment = augment
    
    def __call__(self, batch: List[Dict]) -> Dict[str, torch.Tensor]:
        B = len(batch)
        H, W = self.grid_height, self.grid_width
        
        tiles = torch.empty((B, H * W), dtype=torch.long)
        start_pos = torch.empty(B, dtype=torch.long)
        goal_pos = torch.empty(B, dtype=torch.long)
        on_path = torch.zeros((B, H * W), dtype=torch.float32)
        is_stop = torch.zeros((B, H * W), dtype=torch.float32)
        # Stop sequence: (B, 11) or None entries for puzzles without 11 stops
        stop_sequences = []
        has_stop_sequence = []
        
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
            
            # Flat position indices
            start_pos[i] = start["y"] * W + start["x"]
            goal_pos[i] = goal["y"] * W + goal["x"]
            
            # Compute path masks and stop sequence if enabled
            stop_seq_i = None
            if self.compute_paths:
                on_path_i, is_stop_i, stop_seq_i = compute_path_masks(grid, start, goal, W)
                on_path[i] = on_path_i
                is_stop[i] = is_stop_i
            
            # Apply augmentation if enabled
            if self.augment:
                tiles[i], start_pos[i], goal_pos[i], on_path[i], is_stop[i], stop_seq_i = augment_puzzle(
                    tiles[i], start_pos[i].item(), goal_pos[i].item(),
                    on_path[i], is_stop[i], stop_seq_i, H, W
                )
            
            # Track stop sequences
            if stop_seq_i is not None and len(stop_seq_i) == 11:
                stop_sequences.append(stop_seq_i)
                has_stop_sequence.append(True)
            else:
                stop_sequences.append(torch.zeros(11, dtype=torch.long))  # Placeholder
                has_stop_sequence.append(False)
        
        # Stack stop sequences
        stop_sequence_tensor = torch.stack(stop_sequences)  # (B, 11)
        stop_sequence_mask = torch.tensor(has_stop_sequence, dtype=torch.bool)  # (B,)
        
        return {
            "tiles": tiles,  # (B, 169)
            "start_pos": start_pos,  # (B,)
            "goal_pos": goal_pos,  # (B,)
            "on_path": on_path,  # (B, 169) binary
            "is_stop": is_stop,  # (B, 169) binary
            "stop_sequence": stop_sequence_tensor,  # (B, 11) ordered stop positions
            "stop_sequence_mask": stop_sequence_mask,  # (B,) True if valid 11-stop sequence
        }


@dataclass
class ReplayBuffer:
    """Buffer for verifier-aware fine-tuning."""
    max_size: int = 10000
    
    # Storage
    tiles: deque = field(default_factory=deque)
    start_pos: deque = field(default_factory=deque)
    goal_pos: deque = field(default_factory=deque)
    scores: deque = field(default_factory=deque)
    
    def add(self, tiles: torch.Tensor, start: torch.Tensor, goal: torch.Tensor, score: float):
        """Add a sample with its verifier score."""
        self.tiles.append(tiles.cpu())
        self.start_pos.append(start.cpu())
        self.goal_pos.append(goal.cpu())
        self.scores.append(score)
        
        # Trim if over capacity
        while len(self.tiles) > self.max_size:
            self.tiles.popleft()
            self.start_pos.popleft()
            self.goal_pos.popleft()
            self.scores.popleft()
    
    def sample_batch(self, batch_size: int, device: torch.device) -> Optional[Dict]:
        """Sample a weighted batch (higher scores = more likely)."""
        if len(self.tiles) < batch_size:
            return None
        
        # Compute sampling weights
        scores_t = torch.tensor(list(self.scores))
        weights = torch.exp(scores_t * 2.0)  # Temperature-scaled
        weights = weights / weights.sum()
        
        # Sample indices
        indices = torch.multinomial(weights, batch_size, replacement=True)
        
        tiles = torch.stack([self.tiles[i] for i in indices]).to(device)
        start = torch.stack([self.start_pos[i] for i in indices]).to(device)
        goal = torch.stack([self.goal_pos[i] for i in indices]).to(device)
        sample_scores = torch.tensor([self.scores[i] for i in indices]).to(device)
        
        return {
            "tiles": tiles,
            "start_pos": start,
            "goal_pos": goal,
            "scores": sample_scores,
        }
    
    def __len__(self):
        return len(self.tiles)


class EMA:
    """Exponential Moving Average of model parameters for stable sampling."""
    
    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.model = model
        self.decay = decay
        self.shadow = {}
        self.backup = {}
        
        # Initialize shadow weights
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


def compute_verifier_score(result) -> float:
    """
    Compute a score from verifier result for weighted replay.
    
    New scoring (optimized for target_10):
    - solvable: +1.0
    - no_stuck: +1.0  
    - unique_optimal: +1.0
    - move_distance: +2.0 * exp(-0.5 * |optimal_moves - 10|)
    
    This gives continuous reward for being close to 10 moves,
    rather than binary meets_target_moves.
    """
    import math
    
    score = 0.0
    if result.solvable:
        score += 1.0
    if result.no_stuck:
        score += 1.0
    if result.unique_optimal:
        score += 1.0
    
    # Continuous move-distance reward (peaks at 10)
    # exp(-0.5 * |m - 10|) gives: 10->1.0, 9/11->0.61, 8/12->0.37, 7/13->0.22
    if result.optimal_moves > 0:
        move_distance = abs(result.optimal_moves - 10)
        score += 2.0 * math.exp(-0.5 * move_distance)
    
    # Normalize to 0-1 range (max = 1+1+1+2 = 5)
    return score / 5.0


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
    
    # Convert tiles back to original IDs
    grid = []
    flat = tiles.tolist()
    for y in range(H):
        row = []
        for x in range(W):
            idx = flat[y * W + x]
            row.append(remap_tile_inv(idx))
        grid.append(row)
    
    # Call verifier
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
    
    # Track move distribution for diagnostics
    move_counts = []
    
    for i in range(num_samples):
        seed = f"eval-{i}"
        
        if k_candidates > 1:
            result = model.generate_k_candidates(seed, k_candidates, device, temperature)
        else:
            # Single generation with deterministic seed
            seed_int = int(hashlib.sha256(seed.encode()).hexdigest()[:16], 16)
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_int)
            result = model.generate(1, device, gen, temperature)
        
        # Validate each candidate
        for j in range(result["tiles"].shape[0]):
            tiles = result["tiles"][j].reshape(-1)  # (169,)
            sx, sy = result["start_pos"][j].tolist()
            gx, gy = result["goal_pos"][j].tolist()
            
            metrics["total"] += 1
            
            # Always count as valid_structure (by construction)
            metrics["valid_structure"] += 1
            
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
    
    # Convert to rates
    total = max(metrics["total"], 1)
    result = {k: v / total if k != "total" else v for k, v in metrics.items()}
    
    # Add move distribution stats
    if move_counts:
        import statistics
        result["moves_mean"] = statistics.mean(move_counts)
        result["moves_median"] = statistics.median(move_counts)
        result["moves_stdev"] = statistics.stdev(move_counts) if len(move_counts) > 1 else 0
        # Count how many are within 1 of target
        result["moves_near_10"] = sum(1 for m in move_counts if abs(m - 10) <= 1) / len(move_counts)
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Train puzzle generator v2")
    parser.add_argument("--data", type=str, required=True, help="Path to training JSONL")
    parser.add_argument("--out", type=str, required=True, help="Output directory")
    parser.add_argument("--data-count", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--preset", type=str, default="base", choices=["small", "base", "large"])
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
    parser.add_argument("--generate-samples", type=int, default=256, help="Samples per eval (larger=more stable)")
    parser.add_argument("--k-candidates", type=int, default=1, help="Candidates per seed for generate-many")
    parser.add_argument("--ema-decay", type=float, default=0.999, help="EMA decay rate")
    parser.add_argument("--augment", action="store_true", help="Enable data augmentation (rotations/flips)")
    parser.add_argument("--lr-min", type=float, default=1e-6, help="Minimum learning rate floor")
    parser.add_argument("--stop-loss-weight", type=float, default=0.5, help="Weight for ordered stop sequence loss")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    data_path = Path(args.data)

    # Device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    
    log_progress(f"device={device}", out_dir)

    # Try to import verifier
    validate_fn = try_import_verifier()
    if validate_fn:
        log_progress("Rust verifier available for validation", out_dir)
        # Set global verifier for path computation during data loading
        set_validate_fn(validate_fn)
    else:
        log_progress("WARNING: Rust verifier not available, using structure-only validation", out_dir)

    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)
    total_steps = steps_per_epoch * args.epochs

    log_progress(f"data={data_count} train={train_count} steps/epoch={steps_per_epoch}", out_dir)

    # Model
    config = config_for_preset(args.preset)
    model = PuzzleGeneratorV2(config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})", out_dir)

    # Optimizer with warmup + cosine decay to floor
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )
    
    warmup_steps = min(1000, total_steps // 10)
    lr_min_ratio = args.lr_min / args.lr  # Floor as ratio of max LR
    
    def lr_lambda(step):
        if step < warmup_steps:
            return step / warmup_steps
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        # Cosine decay from 1.0 to lr_min_ratio
        cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
        return lr_min_ratio + (1.0 - lr_min_ratio) * cosine
    
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # Replay buffer for verifier-aware fine-tuning (DISABLED - made things worse)
    # replay_buffer = ReplayBuffer(max_size=10000)

    # EMA for stable sampling
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
            map_type="ice",
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
            tiles = batch["tiles"].to(device)  # (B, 169)
            start_pos = batch["start_pos"].to(device)  # (B,)
            goal_pos = batch["goal_pos"].to(device)  # (B,)
            on_path = batch["on_path"].to(device)  # (B, 169)
            is_stop = batch["is_stop"].to(device)  # (B, 169)
            stop_sequence = batch["stop_sequence"].to(device)  # (B, 11)
            stop_sequence_mask = batch["stop_sequence_mask"].to(device)  # (B,)
            batch_size = tiles.shape[0]

            # Sample random timesteps
            t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)
            
            # Forward diffusion: mask tiles
            x_t = model.q_sample(tiles, t)
            
            # Forward pass
            outputs = model(x_t, t, start_pos, goal_pos)
            
            # Tile loss: predict original tiles from masked
            tile_logits = outputs["tile_logits"]  # (B, 169, vocab_size)
            tile_loss = F.cross_entropy(
                tile_logits.reshape(-1, config.tile_vocab_size),
                tiles.reshape(-1),
            )
            
            # Position losses
            start_logits = outputs["start_logits"]  # (B, 169)
            goal_logits = outputs["goal_logits"]  # (B, 169)
            
            start_loss = F.cross_entropy(start_logits, start_pos)
            goal_loss = F.cross_entropy(goal_logits, goal_pos)
            
            # Path auxiliary losses (binary cross entropy)
            on_path_logits = outputs["on_path_logits"]  # (B, 169)
            is_stop_logits = outputs["is_stop_logits"]  # (B, 169)
            
            # Only compute path loss if we have path labels (verifier available)
            if on_path.sum() > 0:
                on_path_loss = F.binary_cross_entropy_with_logits(on_path_logits, on_path)
                is_stop_loss = F.binary_cross_entropy_with_logits(is_stop_logits, is_stop)
            else:
                on_path_loss = torch.tensor(0.0, device=device)
                is_stop_loss = torch.tensor(0.0, device=device)
            
            # ===== NEW: Ordered stop sequence loss =====
            # Only compute for samples with valid 11-stop sequences
            stop_logits = outputs["stop_logits"]  # (B, 11, 169)
            if stop_sequence_mask.any():
                # Select only valid samples
                valid_stop_logits = stop_logits[stop_sequence_mask]  # (N, 11, 169)
                valid_stop_targets = stop_sequence[stop_sequence_mask]  # (N, 11)
                
                # Cross-entropy for each stop position
                stop_seq_loss = F.cross_entropy(
                    valid_stop_logits.reshape(-1, 169),
                    valid_stop_targets.reshape(-1),
                )
            else:
                stop_seq_loss = torch.tensor(0.0, device=device)
            
            # Combined loss: tile + position + path auxiliary + stop sequence
            loss = (tile_loss + 0.5 * start_loss + 0.5 * goal_loss + 
                    0.5 * on_path_loss + 0.5 * is_stop_loss + 
                    args.stop_loss_weight * stop_seq_loss)

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; skipping", out_dir)
                continue

            epoch_loss += loss.item() * batch_size
            epoch_samples += batch_size

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
            optimizer.step()
            scheduler.step()
            
            # Update EMA weights
            ema.update()

            if global_step % args.log_every == 0:
                dt = time.time() - t0
                lr = scheduler.get_last_lr()[0]
                log_progress(
                    f"step {global_step} loss={loss.item():.4f} tile={tile_loss.item():.4f} "
                    f"start={start_loss.item():.4f} goal={goal_loss.item():.4f} "
                    f"path={on_path_loss.item():.4f} stop={is_stop_loss.item():.4f} "
                    f"stopseq={stop_seq_loss.item():.4f} lr={lr:.2e} dt={dt:.1f}s",
                    out_dir,
                )

            # Periodic evaluation (using EMA weights)
            if global_step > 0 and global_step % args.eval_every == 0:
                # Apply EMA weights for evaluation
                ema.apply_shadow()
                
                metrics = generate_and_validate(
                    model, device, validate_fn,
                    num_samples=args.generate_samples,
                    k_candidates=args.k_candidates,
                )
                
                # Restore original weights
                ema.restore()
                
                # Build log message with move stats if available
                log_msg = (
                    f"eval step={global_step} valid={metrics['valid_structure']:.1%} "
                    f"solve={metrics['solvable']:.1%} nostuck={metrics['no_stuck']:.1%} "
                    f"unique={metrics['unique_optimal']:.1%} t10={metrics['target_10']:.1%} "
                    f"PASS={metrics['full_pass']:.1%}"
                )
                if "moves_mean" in metrics:
                    log_msg += (
                        f" | moves: mean={metrics['moves_mean']:.1f} "
                        f"med={metrics['moves_median']:.0f} near10={metrics['moves_near_10']:.1%}"
                    )
                log_progress(log_msg, out_dir)
                
                # Update best (save EMA weights)
                if metrics["full_pass"] > best_full_pass:
                    best_full_pass = metrics["full_pass"]
                    # Apply EMA for saving
                    ema.apply_shadow()
                    ckpt = {
                        "model_state": model.state_dict(),  # This is now EMA weights
                        "config": config,
                        "step": global_step,
                        "metrics": metrics,
                    }
                    torch.save(ckpt, out_dir / "best_model.pt")
                    ema.restore()
                    log_progress(f"New best! full_pass={best_full_pass:.1%}", out_dir)

            if global_step > 0 and global_step % args.save_every == 0:
                # Save both regular and EMA weights
                ema.apply_shadow()
                ckpt = {
                    "model_state": model.state_dict(),  # EMA weights
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

        # End of epoch logging
        avg_loss = epoch_loss / max(1, epoch_samples)
        log_progress(f"epoch {epoch + 1} complete, avg_loss={avg_loss:.4f}", out_dir)

    # Final evaluation
    log_progress("Final evaluation...", out_dir)
    final_metrics = generate_and_validate(
        model, device, validate_fn,
        num_samples=256,
        k_candidates=args.k_candidates,
    )
    log_progress(
        f"FINAL: valid={final_metrics['valid_structure']:.1%} "
        f"solve={final_metrics['solvable']:.1%} nostuck={final_metrics['no_stuck']:.1%} "
        f"unique={final_metrics['unique_optimal']:.1%} t10={final_metrics['target_10']:.1%} "
        f"PASS={final_metrics['full_pass']:.1%}",
        out_dir,
    )

    # Save final model
    ckpt = {
        "model_state": model.state_dict(),
        "config": config,
        "step": global_step,
        "metrics": final_metrics,
    }
    torch.save(ckpt, out_dir / "final_model.pt")
    log_progress(f"Training complete. Best full_pass={best_full_pass:.1%}", out_dir)


if __name__ == "__main__":
    main()
