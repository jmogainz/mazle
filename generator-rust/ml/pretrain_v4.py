"""
Pretraining script for V4 two-stage model (Path-First Generation).

Stage 1: Train PathGenerator to predict optimal path from start/goal
Stage 2: Train TileGenerator to fill tiles conditioned on path

Key advantage: Move count is BY CONSTRUCTION (11 stops = 10 moves)
"""

import argparse
import json
import math
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset, random_split

from model_v4 import ModelConfig, PuzzleGeneratorV4, config_for_preset


# Tile remapping: original IDs -> contiguous [0, 6]
TILE_REMAP = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
TILE_UNREMAP = {v: k for k, v in TILE_REMAP.items()}


def remap_tile(tile_id: int) -> int:
    return TILE_REMAP.get(tile_id, 2)  # Default to ice


def log_progress(msg: str, out_dir: Path):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{timestamp} {msg}"
    print(line, flush=True)
    with open(out_dir / "progress.log", "a") as f:
        f.write(line + "\n")


class EMA:
    """Exponential Moving Average of model parameters."""
    
    def __init__(self, model: nn.Module, decay: float = 0.999):
        self.decay = decay
        self.shadow = {}
        self.backup = {}
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = param.data.clone()
    
    def update(self, model: nn.Module):
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.shadow[name] = self.decay * self.shadow[name] + (1 - self.decay) * param.data
    
    def apply_shadow(self, model: nn.Module):
        for name, param in model.named_parameters():
            if param.requires_grad:
                self.backup[name] = param.data.clone()
                param.data = self.shadow[name]
    
    def restore(self, model: nn.Module):
        for name, param in model.named_parameters():
            if param.requires_grad:
                param.data = self.backup[name]
        self.backup = {}


class PuzzleDatasetV4(Dataset):
    """Dataset for v4 model with path labels."""
    
    def __init__(self, path: Path):
        self.records = []
        with open(path) as f:
            for line in f:
                self.records.append(json.loads(line.strip()))
    
    def __len__(self):
        return len(self.records)
    
    def __getitem__(self, idx):
        return self.records[idx]


class CollateFnV4:
    """Collate function for v4 model."""
    
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
        stops = torch.empty((B, 11), dtype=torch.long)  # 11 stops for 10 moves
        
        for i, item in enumerate(batch):
            grid = item["tilesInterior"]
            start = item["start"]
            goal = item["goal"]
            path = item["optimal_path"]  # List of [x, y] pairs
            
            # Remap tiles to contiguous indices
            flat_tiles = []
            for row in grid:
                for val in row:
                    flat_tiles.append(remap_tile(val))
            tiles[i] = torch.tensor(flat_tiles, dtype=torch.long)
            
            # Flat position indices
            start_pos[i] = start["y"] * W + start["x"]
            goal_pos[i] = goal["y"] * W + goal["x"]
            
            # Convert path to flat indices
            path_flat = [p[1] * W + p[0] for p in path]  # [x, y] -> y * W + x
            if len(path_flat) == 11:
                stops[i] = torch.tensor(path_flat, dtype=torch.long)
            else:
                # Pad or truncate (shouldn't happen with 10-move data)
                if len(path_flat) < 11:
                    path_flat = path_flat + [path_flat[-1]] * (11 - len(path_flat))
                stops[i] = torch.tensor(path_flat[:11], dtype=torch.long)
            
            # Apply augmentation if enabled
            if self.augment:
                tiles[i], start_pos[i], goal_pos[i], stops[i] = self._augment(
                    tiles[i], start_pos[i].item(), goal_pos[i].item(), stops[i], H, W
                )
        
        return {
            "tiles": tiles,  # (B, 169)
            "start_pos": start_pos,  # (B,)
            "goal_pos": goal_pos,  # (B,)
            "stops": stops,  # (B, 11)
        }
    
    def _augment(self, tiles, start_pos, goal_pos, stops, H, W):
        """Apply random rotation/flip augmentation."""
        aug_type = random.randint(0, 7)
        
        if aug_type == 0:
            return tiles, start_pos, goal_pos, stops
        
        # Reshape to 2D
        tiles_2d = tiles.reshape(H, W).clone()
        
        # Get positions
        start_y, start_x = start_pos // W, start_pos % W
        goal_y, goal_x = goal_pos // W, goal_pos % W
        
        # Ledge remapping for different transforms
        LEDGE_REMAP_90CW = {3: 6, 4: 5, 5: 3, 6: 4}  # up->right, down->left, left->up, right->down
        LEDGE_REMAP_90CCW = {3: 5, 4: 6, 5: 4, 6: 3}
        LEDGE_REMAP_180 = {3: 4, 4: 3, 5: 6, 6: 5}
        LEDGE_REMAP_FLIP_H = {5: 6, 6: 5}
        LEDGE_REMAP_FLIP_V = {3: 4, 4: 3}
        
        def transform_tile(t, ledge_map):
            return ledge_map.get(t, t)
        
        def transform_pos(pos_flat, aug):
            y, x = pos_flat // W, pos_flat % W
            if aug == 1:  # 90 CW
                x, y = H - 1 - y, x
            elif aug == 2:  # 180
                x, y = W - 1 - x, H - 1 - y
            elif aug == 3:  # 90 CCW
                x, y = y, W - 1 - x
            elif aug == 4:  # Flip H
                x = W - 1 - x
            elif aug == 5:  # Flip V
                y = H - 1 - y
            elif aug == 6:  # Transpose
                x, y = y, x
            elif aug == 7:  # Anti-transpose
                x, y = H - 1 - y, W - 1 - x
            return y * W + x
        
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
        
        # Transform positions
        new_start = transform_pos(start_pos, aug_type)
        new_goal = transform_pos(goal_pos, aug_type)
        new_stops = torch.tensor([transform_pos(s.item(), aug_type) for s in stops], dtype=torch.long)
        
        return tiles_2d.reshape(-1), new_start, new_goal, new_stops


def validate_puzzles(model, device, num_samples=256, k=1):
    """Validate generated puzzles using Rust verifier."""
    try:
        from mazle_eval import validate_ice_interior
    except ImportError:
        return {"error": "verifier not available"}
    
    model.eval()
    
    results = {
        "valid": 0,
        "solvable": 0,
        "no_stuck": 0,
        "unique_optimal": 0,
        "target_10": 0,
        "full_pass": 0,
        "total": num_samples,
        "moves_sum": 0,
        "moves_count": 0,
    }
    
    with torch.no_grad():
        for seed_idx in range(num_samples):
            seed = f"eval-{seed_idx}"
            
            # Generate puzzle
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_idx)
            output = model.generate(1, device, gen, temperature=1.0)
            
            tiles = output["tiles"][0].cpu().numpy()
            start = output["start_pos"][0].cpu().numpy()
            goal = output["goal_pos"][0].cpu().numpy()
            
            # Convert tiles back to original IDs
            tiles_orig = [[TILE_UNREMAP.get(int(tiles[y, x]), 4) for x in range(13)] for y in range(13)]
            
            try:
                result = validate_ice_interior(
                    tiles_orig,
                    int(start[0]), int(start[1]),
                    int(goal[0]), int(goal[1]),
                    10  # target moves
                )
                
                results["valid"] += 1
                if result.solvable:
                    results["solvable"] += 1
                    results["moves_sum"] += result.optimal_moves
                    results["moves_count"] += 1
                if result.no_stuck:
                    results["no_stuck"] += 1
                if result.unique_optimal:
                    results["unique_optimal"] += 1
                if result.meets_target_moves:
                    results["target_10"] += 1
                if result.solvable and result.no_stuck and result.unique_optimal and result.meets_target_moves:
                    results["full_pass"] += 1
            except Exception as e:
                pass
    
    model.train()
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=str, required=True, help="Path to training data JSONL")
    parser.add_argument("--out", type=str, required=True, help="Output directory")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--preset", type=str, default="base", choices=["small", "base", "large"])
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--lr-min", type=float, default=1e-6)
    parser.add_argument("--warmup-steps", type=int, default=500)
    parser.add_argument("--val-split", type=float, default=0.033)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--save-every", type=int, default=2000)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--generate-samples", type=int, default=256)
    parser.add_argument("--ema-decay", type=float, default=0.999)
    parser.add_argument("--augment", action="store_true")
    parser.add_argument("--resume", type=str, default=None, help="Checkpoint to resume from")
    parser.add_argument("--stage", type=str, default="both", choices=["path", "tiles", "both"],
                        help="Which stage(s) to train")
    args = parser.parse_args()
    
    # Setup
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    log_progress(f"device={device}", out_dir)
    
    # Load data
    full_dataset = PuzzleDatasetV4(Path(args.data))
    val_size = int(len(full_dataset) * args.val_split)
    train_size = len(full_dataset) - val_size
    train_dataset, val_dataset = random_split(
        full_dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )
    
    collate_fn = CollateFnV4(augment=args.augment)
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True,
                              collate_fn=collate_fn, num_workers=0, pin_memory=True)
    
    steps_per_epoch = len(train_loader)
    total_steps = args.epochs * steps_per_epoch
    
    log_progress(f"data={len(full_dataset)} train={train_size} steps/epoch={steps_per_epoch}", out_dir)
    
    # Model
    config = config_for_preset(args.preset)
    model = PuzzleGeneratorV4(config).to(device)
    
    # Count parameters
    path_params = sum(p.numel() for p in model.path_generator.parameters())
    tile_params = sum(p.numel() for p in model.tile_generator.parameters())
    total_params = path_params + tile_params
    log_progress(f"params: path={path_params/1e6:.1f}M tile={tile_params/1e6:.1f}M total={total_params/1e6:.1f}M", out_dir)
    
    # Optimizer - different for each stage
    if args.stage == "path":
        optimizer = torch.optim.AdamW(model.path_generator.parameters(), lr=args.lr, weight_decay=0.01)
    elif args.stage == "tiles":
        optimizer = torch.optim.AdamW(model.tile_generator.parameters(), lr=args.lr, weight_decay=0.01)
    else:
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    
    # EMA
    ema = EMA(model, decay=args.ema_decay)
    
    # Resume if specified
    global_step = 0
    start_epoch = 0
    if args.resume:
        ckpt = torch.load(args.resume, map_location=device)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        ema.shadow = ckpt.get("ema_shadow", ema.shadow)
        global_step = ckpt.get("step", 0)
        start_epoch = ckpt.get("epoch", 0)
        log_progress(f"resumed from {args.resume} at step {global_step}", out_dir)
    
    log_progress(f"training stage={args.stage}", out_dir)
    
    # Training loop
    model.train()
    step_times = []
    best_pass_rate = 0.0
    
    for epoch in range(start_epoch, args.epochs):
        for batch in train_loader:
            step_start = time.time()
            
            tiles = batch["tiles"].to(device)
            start_pos = batch["start_pos"].to(device)
            goal_pos = batch["goal_pos"].to(device)
            stops = batch["stops"].to(device)
            batch_size = tiles.shape[0]
            
            # Learning rate schedule
            if global_step < args.warmup_steps:
                lr = args.lr * global_step / args.warmup_steps
            else:
                progress = (global_step - args.warmup_steps) / (total_steps - args.warmup_steps)
                lr = args.lr_min + 0.5 * (args.lr - args.lr_min) * (1 + math.cos(math.pi * progress))
            
            for param_group in optimizer.param_groups:
                param_group["lr"] = lr
            
            # ===== PATH LOSS (Stage 1) =====
            # Now predicts DIRECTIONS (4-way) instead of positions (169-way)
            path_loss = torch.tensor(0.0, device=device)
            if args.stage in ["path", "both"]:
                from model_v4 import PathGenerator
                
                # Convert ground truth stops to directions
                directions = PathGenerator.stops_to_directions(stops)  # (B, 10)
                
                # Get direction logits
                path_logits = model.forward_path(stops, start_pos, goal_pos)  # (B, 10, 4)
                
                # Cross-entropy for direction prediction
                path_loss = F.cross_entropy(
                    path_logits.reshape(-1, 4),  # (B*10, 4)
                    directions.reshape(-1),  # (B*10,)
                )
            
            # ===== TILE LOSS (Stage 2) =====
            tile_loss = torch.tensor(0.0, device=device)
            if args.stage in ["tiles", "both"]:
                # Sample random timesteps
                t = torch.randint(0, model.tile_generator.num_timesteps, (batch_size,), device=device)
                
                # Forward diffusion
                x_t = model.tile_generator.q_sample(tiles, t)
                
                # Predict tiles conditioned on path
                tile_logits = model.forward_tiles(x_t, t, stops)
                
                tile_loss = F.cross_entropy(
                    tile_logits.reshape(-1, config.tile_vocab_size),
                    tiles.reshape(-1),
                )
            
            # Combined loss
            if args.stage == "path":
                loss = path_loss
            elif args.stage == "tiles":
                loss = tile_loss
            else:
                loss = path_loss + tile_loss
            
            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; skipping", out_dir)
                continue
            
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            ema.update(model)
            
            step_times.append(time.time() - step_start)
            global_step += 1
            
            # Logging
            if global_step % args.log_every == 0:
                dt = sum(step_times[-100:]) / len(step_times[-100:]) * 100
                log_progress(
                    f"step {global_step} loss={loss.item():.4f} path={path_loss.item():.4f} "
                    f"tile={tile_loss.item():.4f} lr={lr:.2e} dt={dt:.1f}s",
                    out_dir,
                )
            
            # Evaluation
            if global_step % args.eval_every == 0:
                ema.apply_shadow(model)
                
                results = validate_puzzles(model, device, num_samples=args.generate_samples)
                
                if "error" not in results:
                    n = results["total"]
                    solve_pct = 100 * results["solvable"] / n
                    nostuck_pct = 100 * results["no_stuck"] / n
                    unique_pct = 100 * results["unique_optimal"] / n
                    t10_pct = 100 * results["target_10"] / n
                    pass_pct = 100 * results["full_pass"] / n
                    
                    moves_mean = results["moves_sum"] / results["moves_count"] if results["moves_count"] > 0 else 0
                    near10 = sum(1 for _ in range(1))  # Placeholder
                    
                    log_progress(
                        f"eval step={global_step} valid=100.0% solve={solve_pct:.1f}% "
                        f"nostuck={nostuck_pct:.1f}% unique={unique_pct:.1f}% t10={t10_pct:.1f}% "
                        f"PASS={pass_pct:.1f}% | moves: mean={moves_mean:.1f}",
                        out_dir,
                    )
                    
                    # Save best model
                    if pass_pct > best_pass_rate:
                        best_pass_rate = pass_pct
                        torch.save({
                            "model": model.state_dict(),
                            "optimizer": optimizer.state_dict(),
                            "ema_shadow": ema.shadow,
                            "step": global_step,
                            "epoch": epoch,
                            "config": config,
                            "pass_rate": pass_pct,
                        }, out_dir / "best_model.pt")
                        log_progress(f"new best model saved (PASS={pass_pct:.1f}%)", out_dir)
                
                ema.restore(model)
            
            # Checkpoint
            if global_step % args.save_every == 0:
                ema.apply_shadow(model)
                torch.save({
                    "model": model.state_dict(),
                    "optimizer": optimizer.state_dict(),
                    "ema_shadow": ema.shadow,
                    "step": global_step,
                    "epoch": epoch,
                    "config": config,
                }, out_dir / f"checkpoint_{global_step:08d}.pt")
                ema.restore(model)
    
    # Final save
    ema.apply_shadow(model)
    torch.save({
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "ema_shadow": ema.shadow,
        "step": global_step,
        "epoch": args.epochs,
        "config": config,
    }, out_dir / "final_model.pt")
    
    log_progress("training complete", out_dir)


if __name__ == "__main__":
    main()
