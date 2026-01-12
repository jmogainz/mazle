"""
Training script for Puzzle Generator v3.

Key changes from v2:
1. Ordered stop sequence supervision (11 stops = 10 moves by construction)
2. Stop sequence predicted first, then tiles conditioned on it
3. No more emergent move count - it's structural!

Training losses:
- stop_loss: Cross-entropy for each of 11 stop positions
- tile_loss: Cross-entropy for tile prediction (conditioned on stops)
"""

import argparse
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from data import JsonlMazeDataset
from model_v3 import PuzzleGeneratorV3, ModelConfig, config_for_preset


# Tile ID remapping: original IDs to contiguous 0-6
TILE_REMAP = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
TILE_REMAP_INV = {v: k for k, v in TILE_REMAP.items()}

# Global verifier function
_VALIDATE_FN = None


def set_validate_fn(fn):
    global _VALIDATE_FN
    _VALIDATE_FN = fn


def compute_stop_sequence(grid: List[List[int]], start: dict, goal: dict, width: int = 13) -> Optional[torch.Tensor]:
    """
    Compute the ordered stop sequence from a puzzle.
    
    Returns:
        stop_positions: (11,) tensor of flat indices, or None if not available
    """
    global _VALIDATE_FN
    
    if _VALIDATE_FN is None:
        return None
    
    try:
        result = _VALIDATE_FN(grid, start["x"], start["y"], goal["x"], goal["y"], None)
        if result.solvable and result.optimal_path:
            path = result.optimal_path  # List of (x, y) tuples
            
            # The optimal_path from verifier is the stop positions
            # Should be exactly 11 for 10-move puzzles
            if len(path) != 11:
                return None
            
            # Convert to flat indices
            stop_positions = torch.tensor([y * width + x for x, y in path], dtype=torch.long)
            return stop_positions
    except Exception:
        pass
    
    return None


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
    return TILE_REMAP.get(tile_id, 2)


def remap_tile_inv(idx: int) -> int:
    return TILE_REMAP_INV.get(idx, 4)


# Ledge transformations for augmentation
LEDGE_REMAP_90CW = {3: 5, 4: 6, 5: 4, 6: 3}
LEDGE_REMAP_180 = {3: 4, 4: 3, 5: 6, 6: 5}
LEDGE_REMAP_90CCW = {3: 6, 4: 5, 5: 3, 6: 4}
LEDGE_REMAP_FLIP_H = {3: 3, 4: 4, 5: 6, 6: 5}
LEDGE_REMAP_FLIP_V = {3: 4, 4: 3, 5: 5, 6: 6}


def transform_tile(tile_idx: int, transform_map: dict) -> int:
    if tile_idx in transform_map:
        return transform_map[tile_idx]
    return tile_idx


def augment_puzzle(tiles: torch.Tensor, stop_positions: torch.Tensor,
                   H: int = 13, W: int = 13) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Apply random augmentation to a puzzle including its stop sequence.
    """
    import random
    aug_type = random.randint(0, 7)
    
    if aug_type == 0:
        return tiles, stop_positions
    
    # Reshape tiles to 2D
    tiles_2d = tiles.reshape(H, W).clone()
    
    # Transform stop positions (they're flat indices)
    def transform_pos(flat_idx, aug):
        y, x = flat_idx // W, flat_idx % W
        
        if aug == 1:  # Rotate 90 CW
            x, y = H - 1 - y, x
        elif aug == 2:  # Rotate 180
            x, y = W - 1 - x, H - 1 - y
        elif aug == 3:  # Rotate 270 CW
            x, y = y, W - 1 - x
        elif aug == 4:  # Flip horizontal
            x = W - 1 - x
        elif aug == 5:  # Flip vertical
            y = H - 1 - y
        elif aug == 6:  # Transpose
            x, y = y, x
        elif aug == 7:  # Anti-transpose
            x, y = H - 1 - y, W - 1 - x
        
        return y * W + x
    
    # Transform tiles
    if aug_type == 1:
        tiles_2d = torch.rot90(tiles_2d, k=-1)
        ledge_map = LEDGE_REMAP_90CW
    elif aug_type == 2:
        tiles_2d = torch.rot90(tiles_2d, k=2)
        ledge_map = LEDGE_REMAP_180
    elif aug_type == 3:
        tiles_2d = torch.rot90(tiles_2d, k=1)
        ledge_map = LEDGE_REMAP_90CCW
    elif aug_type == 4:
        tiles_2d = torch.flip(tiles_2d, dims=[1])
        ledge_map = LEDGE_REMAP_FLIP_H
    elif aug_type == 5:
        tiles_2d = torch.flip(tiles_2d, dims=[0])
        ledge_map = LEDGE_REMAP_FLIP_V
    elif aug_type == 6:
        tiles_2d = tiles_2d.T
        ledge_map = {3: 5, 4: 6, 5: 3, 6: 4}
    else:  # aug_type == 7
        tiles_2d = torch.flip(tiles_2d.T, dims=[0, 1])
        ledge_map = {3: 6, 4: 5, 5: 4, 6: 3}
    
    # Transform ledge tiles
    for y in range(H):
        for x in range(W):
            tiles_2d[y, x] = transform_tile(tiles_2d[y, x].item(), ledge_map)
    
    # Transform stop positions
    new_stops = torch.tensor([transform_pos(p.item(), aug_type) for p in stop_positions], dtype=torch.long)
    
    return tiles_2d.reshape(-1), new_stops


class CollateFnV3:
    """Collate function for v3 model - includes ordered stop sequence."""
    
    def __init__(self, grid_height: int = 13, grid_width: int = 13, augment: bool = False):
        self.grid_height = grid_height
        self.grid_width = grid_width
        self.augment = augment
    
    def __call__(self, batch: List[Dict]) -> Optional[Dict[str, torch.Tensor]]:
        H, W = self.grid_height, self.grid_width
        
        # Filter batch to only include items with valid 11-stop sequences
        valid_items = []
        for item in batch:
            grid = item["tilesInterior"]
            start = item["start"]
            goal = item["goal"]
            
            stop_seq = compute_stop_sequence(grid, start, goal, W)
            if stop_seq is not None and len(stop_seq) == 11:
                valid_items.append((item, stop_seq))
        
        if len(valid_items) == 0:
            return None
        
        B = len(valid_items)
        tiles = torch.empty((B, H * W), dtype=torch.long)
        stop_positions = torch.empty((B, 11), dtype=torch.long)
        
        for i, (item, stop_seq) in enumerate(valid_items):
            grid = item["tilesInterior"]
            
            # Remap tiles
            flat_tiles = []
            for row in grid:
                for val in row:
                    flat_tiles.append(remap_tile(val))
            
            tiles[i] = torch.tensor(flat_tiles, dtype=torch.long)
            stop_positions[i] = stop_seq
            
            # Apply augmentation
            if self.augment:
                tiles[i], stop_positions[i] = augment_puzzle(tiles[i], stop_positions[i], H, W)
        
        return {
            "tiles": tiles,  # (B, 169)
            "stop_positions": stop_positions,  # (B, 11)
        }


class EMA:
    """Exponential Moving Average of model parameters."""
    
    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.model = model
        self.decay = decay
        self.shadow = {}
        self.backup = {}
        
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = param.data.clone()
    
    def update(self):
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = self.decay * self.shadow[name] + (1 - self.decay) * param.data
    
    def apply_shadow(self):
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                self.backup[name] = param.data.clone()
                param.data = self.shadow[name]
    
    def restore(self):
        for name, param in self.model.named_parameters():
            if param.requires_grad:
                param.data = self.backup[name]
        self.backup = {}


def try_import_verifier():
    try:
        from mazle_eval import validate_ice_interior
        return validate_ice_interior
    except ImportError:
        return None


def validate_puzzle(tiles: torch.Tensor, start_x: int, start_y: int, 
                    goal_x: int, goal_y: int, validate_fn, target_moves: int = 10):
    H, W = 13, 13
    grid = []
    flat = tiles.tolist()
    for y in range(H):
        row = []
        for x in range(W):
            idx = flat[y * W + x]
            row.append(remap_tile_inv(idx))
        grid.append(row)
    
    return validate_fn(grid, start_x, start_y, goal_x, goal_y, target_moves)


@torch.no_grad()
def generate_and_validate(
    model: PuzzleGeneratorV3,
    device: torch.device,
    validate_fn,
    num_samples: int = 32,
    k_candidates: int = 1,
    temperature: float = 1.0,
) -> Dict[str, float]:
    """Generate samples and validate."""
    model.eval()
    
    import hashlib
    
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
                if vr.solvable and vr.no_stuck and vr.unique_optimal and vr.meets_target_moves:
                    metrics["full_pass"] += 1
    
    total = max(metrics["total"], 1)
    result = {k: v / total if k != "total" else v for k, v in metrics.items()}
    
    if move_counts:
        import statistics
        result["moves_mean"] = statistics.mean(move_counts)
        result["moves_median"] = statistics.median(move_counts)
        result["moves_near_10"] = sum(1 for m in move_counts if abs(m - 10) <= 1) / len(move_counts)
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Train puzzle generator v3")
    parser.add_argument("--data", type=str, required=True)
    parser.add_argument("--out", type=str, required=True)
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
    parser.add_argument("--generate-samples", type=int, default=256)
    parser.add_argument("--k-candidates", type=int, default=1)
    parser.add_argument("--ema-decay", type=float, default=0.999)
    parser.add_argument("--augment", action="store_true")
    parser.add_argument("--lr-min", type=float, default=1e-6)
    parser.add_argument("--stop-loss-weight", type=float, default=1.0, help="Weight for stop sequence loss")
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

    # Verifier
    validate_fn = try_import_verifier()
    if validate_fn:
        log_progress("Rust verifier available", out_dir)
        set_validate_fn(validate_fn)
    else:
        log_progress("ERROR: Rust verifier required for v3 training (need stop sequences)", out_dir)
        return

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
    model = PuzzleGeneratorV3(config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})", out_dir)

    # Optimizer
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
    skipped_batches = 0

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
            collate_fn=CollateFnV3(augment=args.augment),
        )

        model.train()
        t0 = time.time()
        epoch_loss = 0.0
        epoch_samples = 0

        pbar = tqdm(loader, desc=f"epoch {epoch + 1}", total=steps_per_epoch)
        for batch in pbar:
            if batch is None:
                skipped_batches += 1
                continue
            
            tiles = batch["tiles"].to(device)
            stop_positions = batch["stop_positions"].to(device)
            batch_size = tiles.shape[0]

            # Sample random timesteps
            t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)
            
            # Forward diffusion: mask tiles
            x_t = model.q_sample(tiles, t)
            
            # Forward pass
            outputs = model(x_t, t, stop_positions)
            
            # Stop sequence loss: cross-entropy for each stop position
            stop_logits = outputs["stop_logits"]  # (B, 11, 169)
            stop_loss = F.cross_entropy(
                stop_logits.reshape(-1, config.grid_height * config.grid_width),
                stop_positions.reshape(-1),
            )
            
            # Tile loss
            tile_logits = outputs["tile_logits"]  # (B, 169, vocab_size)
            tile_loss = F.cross_entropy(
                tile_logits.reshape(-1, config.tile_vocab_size),
                tiles.reshape(-1),
            )
            
            # Combined loss
            loss = tile_loss + args.stop_loss_weight * stop_loss

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
                    f"stop={stop_loss.item():.4f} lr={lr:.2e} dt={dt:.1f}s",
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
                    ckpt = {
                        "model_state": model.state_dict(),
                        "config": config,
                        "step": global_step,
                        "metrics": metrics,
                    }
                    torch.save(ckpt, out_dir / "best_model.pt")
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
        log_progress(f"epoch {epoch + 1} complete, avg_loss={avg_loss:.4f}, skipped={skipped_batches}", out_dir)

    # Final eval
    log_progress("Final evaluation...", out_dir)
    ema.apply_shadow()
    final_metrics = generate_and_validate(model, device, validate_fn, num_samples=256, k_candidates=args.k_candidates)
    ema.restore()
    
    log_progress(
        f"FINAL: valid={final_metrics['valid_structure']:.1%} "
        f"solve={final_metrics['solvable']:.1%} nostuck={final_metrics['no_stuck']:.1%} "
        f"unique={final_metrics['unique_optimal']:.1%} t10={final_metrics['target_10']:.1%} "
        f"PASS={final_metrics['full_pass']:.1%}",
        out_dir,
    )

    ema.apply_shadow()
    ckpt = {"model_state": model.state_dict(), "config": config, "step": global_step, "metrics": final_metrics}
    torch.save(ckpt, out_dir / "final_model.pt")
    ema.restore()
    
    log_progress(f"Training complete. Best full_pass={best_full_pass:.1%}", out_dir)


if __name__ == "__main__":
    main()
