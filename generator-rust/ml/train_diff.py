"""
Training with Differentiable Verifier

Adds soft verification loss to the standard diffusion training.
Gradients flow through the verifier, telling the model which tiles to adjust.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
import numpy as np
from pathlib import Path
import time
import argparse
from dataclasses import dataclass
from typing import Dict, List

from model_v2 import PuzzleGeneratorV2, ModelConfig
from diff_verifier import DifferentiableIceVerifier
from mazle_eval import validate_ice_interior
from data import JsonlMazeDataset, TileVocab

# Tile remapping (from pretrain_v2.py)
TILE_REMAP = {0: 0, 1: 1, 2: 6, 3: 5, 4: 2, 5: 3, 6: 4}
TILE_REMAP_INV = {v: k for k, v in TILE_REMAP.items()}


@dataclass
class TrainConfig:
    lr: float = 1e-5
    batch_size: int = 32
    max_steps: int = 1000
    eval_every: int = 50
    save_every: int = 100
    verifier_weight: float = 0.1
    temperature: float = 0.5
    uniqueness_weight: float = 2.0
    target_moves: int = 10


def collate_fn(batch: List[Dict]) -> Dict:
    """Collate function for data loader."""
    H, W = 13, 13
    tiles = []
    start_pos = []
    goal_pos = []
    
    # Raw tile mapping: 0=floor, 1=wall, 4=ice, 5-8=ledges
    # Model expects: 0=floor, 1=wall, 2=ice, 3-6=ledges
    RAW_TO_MODEL = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
    
    for sample in batch:
        # tilesInterior is [13][13] list
        tile_2d = sample['tilesInterior']
        flat = []
        for row in tile_2d:
            for val in row:
                flat.append(RAW_TO_MODEL.get(val, 2))  # Default to ice
        tiles.append(torch.tensor(flat, dtype=torch.long))
        
        # Positions as flat indices (y * W + x)
        start_pos.append(sample['start']['y'] * W + sample['start']['x'])
        goal_pos.append(sample['goal']['y'] * W + sample['goal']['x'])
    
    return {
        'tiles': torch.stack(tiles),  # [B, 169]
        'start_pos': torch.tensor(start_pos),  # [B]
        'goal_pos': torch.tensor(goal_pos),  # [B]
    }


def train_step(
    model: PuzzleGeneratorV2,
    verifier: DifferentiableIceVerifier,
    batch: dict,
    optimizer: torch.optim.Optimizer,
    config: TrainConfig,
    device: torch.device,
) -> dict:
    """Single training step with diffusion + verifier loss."""
    
    model.train()
    
    tiles = batch['tiles'].to(device)  # [B, 169]
    start_pos = batch['start_pos'].to(device)  # [B] flat indices
    goal_pos = batch['goal_pos'].to(device)  # [B] flat indices
    
    B = tiles.shape[0]
    H, W = 13, 13
    
    # Sample timesteps
    t = torch.randint(0, model.num_timesteps, (B,), device=device)
    
    # Forward diffusion
    x_t = model.q_sample(tiles, t)
    
    # Model forward
    outputs = model(x_t, t, start_pos, goal_pos)
    tile_logits = outputs["tile_logits"]  # [B, 169, 7]
    
    # Diffusion loss
    diffusion_loss = F.cross_entropy(
        tile_logits.view(-1, 7),
        tiles.view(-1),
    )
    
    # Convert flat positions to [row, col] for verifier
    start_rc = torch.stack([start_pos // W, start_pos % W], dim=1)
    goal_rc = torch.stack([goal_pos // W, goal_pos % W], dim=1)
    
    # Verifier loss on predicted logits
    logits_hwc = tile_logits.view(B, H, W, 7)
    
    verifier_metrics = verifier(
        logits_hwc, start_rc, goal_rc, 
        temperature=config.temperature
    )
    
    solvable_loss = -torch.log(verifier_metrics['solvable'].clamp(min=1e-6)).mean()
    uniqueness_loss = (1.0 - verifier_metrics['uniqueness']).mean()
    
    verifier_loss = solvable_loss + config.uniqueness_weight * uniqueness_loss
    
    # Combined loss
    total_loss = diffusion_loss + config.verifier_weight * verifier_loss
    
    optimizer.zero_grad()
    total_loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    
    return {
        'total_loss': total_loss.item(),
        'diffusion_loss': diffusion_loss.item(),
        'verifier_loss': verifier_loss.item(),
        'solvable': verifier_metrics['solvable'].mean().item(),
        'uniqueness': verifier_metrics['uniqueness'].mean().item(),
    }


def evaluate(model, device, num_samples=100, target_moves=10):
    """Evaluate with real verifier."""
    model.eval()
    
    passes = 0
    solvable = 0
    unique = 0
    moves_list = []
    
    with torch.no_grad():
        for i in range(0, num_samples, 8):
            batch_size = min(8, num_samples - i)
            result = model.generate(batch_size, device=device)
            
            tiles = result['tiles'].cpu().numpy()
            starts = result['start_pos'].cpu().numpy()
            goals = result['goal_pos'].cpu().numpy()
            
            for j in range(batch_size):
                t = tiles[j]
                sr, sc = int(starts[j, 0]), int(starts[j, 1])
                gr, gc = int(goals[j, 0]), int(goals[j, 1])
                
                val = validate_ice_interior(t, sr, sc, gr, gc, target_moves)
                
                if val.solvable:
                    solvable += 1
                    moves_list.append(val.optimal_moves)
                if val.unique_optimal:
                    unique += 1
                if val.solvable and val.no_stuck and val.unique_optimal and val.meets_target_moves:
                    passes += 1
    
    return {
        'full_pass': passes / num_samples * 100,
        'solvable': solvable / num_samples * 100,
        'unique': unique / num_samples * 100,
        'moves_mean': np.mean(moves_list) if moves_list else 0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--data", required=True, help="Path to jsonl data file")
    parser.add_argument("--output", default="output_diff")
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--max-steps", type=int, default=1000)
    parser.add_argument("--verifier-weight", type=float, default=0.1)
    args = parser.parse_args()
    
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    # Load checkpoint
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = PuzzleGeneratorV2(ckpt['config'])
    model.load_state_dict(ckpt['model_state'])
    model = model.to(device)
    print(f"Loaded checkpoint from step {ckpt.get('step', 'unknown')}")
    
    # Create verifier
    verifier = DifferentiableIceVerifier(num_iterations=20).to(device)
    
    # Load data
    print(f"\nLoading data from {args.data}...")
    dataset = JsonlMazeDataset(
        Path(args.data),
        split="train",
        val_pct=0.0,
        test_pct=0.0,
    )
    dataloader = DataLoader(dataset, batch_size=args.batch_size, 
                           shuffle=False, drop_last=True, collate_fn=collate_fn)
    print(f"Loaded dataset from {args.data}")
    
    # Setup training
    config = TrainConfig(
        lr=args.lr,
        batch_size=args.batch_size,
        max_steps=args.max_steps,
        verifier_weight=args.verifier_weight,
    )
    
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.lr)
    
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Initial eval
    print("\nInitial evaluation...")
    init_eval = evaluate(model, device)
    print(f"Initial: {init_eval['full_pass']:.1f}% pass, "
          f"{init_eval['solvable']:.1f}% solve, "
          f"{init_eval['unique']:.1f}% unique")
    
    best_pass_rate = init_eval['full_pass']
    
    # Training loop
    print(f"\nStarting training for {config.max_steps} steps...")
    print(f"Verifier weight: {config.verifier_weight}")
    
    data_iter = iter(dataloader)
    
    for step in range(config.max_steps):
        try:
            batch = next(data_iter)
        except StopIteration:
            data_iter = iter(dataloader)
            batch = next(data_iter)
        
        start_time = time.time()
        metrics = train_step(model, verifier, batch, optimizer, config, device)
        step_time = time.time() - start_time
        
        if step % 10 == 0:
            print(f"step={step} loss={metrics['total_loss']:.4f} "
                  f"diff={metrics['diffusion_loss']:.4f} ver={metrics['verifier_loss']:.4f} "
                  f"solv={metrics['solvable']:.2f} uniq={metrics['uniqueness']:.2f} "
                  f"dt={step_time:.1f}s")
        
        if (step + 1) % config.eval_every == 0:
            eval_metrics = evaluate(model, device)
            print(f"  EVAL: {eval_metrics['full_pass']:.1f}% pass, "
                  f"{eval_metrics['solvable']:.1f}% solve, "
                  f"{eval_metrics['unique']:.1f}% unique")
            
            if eval_metrics['full_pass'] > best_pass_rate:
                best_pass_rate = eval_metrics['full_pass']
                torch.save({
                    'model_state': model.state_dict(),
                    'config': ckpt['config'],
                    'step': step,
                    'pass_rate': best_pass_rate,
                }, output_path / "best_model.pt")
                print(f"  -> New best: {best_pass_rate:.1f}%")
    
    # Final eval
    print("\nFinal evaluation...")
    final_eval = evaluate(model, device, num_samples=200)
    print(f"Final: {final_eval['full_pass']:.1f}% pass")
    
    torch.save({
        'model_state': model.state_dict(),
        'config': ckpt['config'],
        'step': config.max_steps,
    }, output_path / "final_model.pt")


if __name__ == "__main__":
    main()
