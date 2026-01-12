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
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
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
            )

            # Position losses
            start_logits = outputs["start_logits"]
            goal_logits = outputs["goal_logits"]
            start_loss = F.cross_entropy(start_logits, start_pos)
            goal_loss = F.cross_entropy(goal_logits, goal_pos)

            # Combined loss
            loss = tile_loss + 0.5 * start_loss + 0.5 * goal_loss

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

    # Training
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
    parser.add_argument("--generate-samples", type=int, default=256)
    parser.add_argument("--k-candidates", type=int, default=1)
    parser.add_argument("--ema-decay", type=float, default=0.999)
    parser.add_argument("--augment", action="store_true", help="Enable data augmentation")
    parser.add_argument("--lr-min", type=float, default=1e-6)

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

    # Model
    config = config_for_preset(args.preset)
    model = PuzzleGeneratorV2(config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})", out_dir)

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
    else:
        if not args.data:
            raise ValueError("--data required for pretraining")
        train_pretrain(args, model, device, validate_fn, out_dir, config)


if __name__ == "__main__":
    main()
