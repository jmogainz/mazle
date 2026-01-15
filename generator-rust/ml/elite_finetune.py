"""
Elite Fine-Tuning for Mazle Puzzle Generator

Implements Best-of-K + Verifier + Elite Fine-Tune with KL anchor.

Loop:
1. Generate K candidates per seed
2. Score with Rust verifier, compute reward
3. Keep top M "elite" puzzles
4. Fine-tune generator on elites with KL penalty to reference model

This shifts probability mass toward exact-10-move puzzles without
losing solvability/uniqueness from pretraining.
"""

import argparse
import json
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from model_v2 import PuzzleGeneratorV2, ModelConfig, config_for_preset
from mazle_eval import validate_ice_interior


@dataclass
class EliteConfig:
    """Configuration for elite fine-tuning."""
    # Generation
    k_candidates: int = 64          # Candidates per seed
    elite_fraction: float = 0.1     # Keep top 10% as elites
    min_elites_per_batch: int = 8   # Minimum elites to collect before training
    seeds_per_round: int = 128      # Seeds to sample per round
    
    # Reward shaping
    target_moves: int = 10
    reward_not_solvable: float = -2.0
    reward_stuck: float = -2.0
    reward_not_unique: float = -1.0
    reward_exact_target: float = 5.0
    reward_moves_tau: float = 2.0   # Temperature for moves reward
    
    # Training
    lr: float = 1e-5                # Lower LR for fine-tuning
    kl_weight: float = 0.1          # KL penalty weight (β)
    batch_size: int = 32
    grad_accum_steps: int = 2
    max_rounds: int = 100
    eval_every: int = 5
    save_every: int = 10
    
    # Early stopping
    target_success_rate: float = 0.5  # Stop if we hit 50% exact-10


def compute_reward(
    solvable: bool,
    no_stuck: bool,
    unique_optimal: bool,
    optimal_moves: int,
    target: int = 10,
    cfg: EliteConfig = None,
) -> float:
    """
    Compute scalar reward for a puzzle.
    
    Reward structure:
    - Base: moves proximity bonus
    - Penalties for failing constraints
    - Big bonus for exact target
    """
    if cfg is None:
        cfg = EliteConfig()
    
    reward = 0.0
    
    # Constraint penalties
    if not solvable:
        return cfg.reward_not_solvable
    if not no_stuck:
        reward += cfg.reward_stuck
    if not unique_optimal:
        reward += cfg.reward_not_unique
    
    # Moves proximity reward: exp(-|moves - target| / τ)
    if optimal_moves > 0:
        moves_reward = math.exp(-abs(optimal_moves - target) / cfg.reward_moves_tau)
        reward += moves_reward
        
        # Big bonus for exact target
        if optimal_moves == target:
            reward += cfg.reward_exact_target
    
    return reward


def generate_and_score(
    model: PuzzleGeneratorV2,
    seeds: List[str],
    k: int,
    device: torch.device,
    target_moves: int = 10,
    cfg: EliteConfig = None,
) -> List[Dict]:
    """
    Generate K candidates per seed and score with verifier.
    
    Returns list of dicts with puzzle data and rewards.
    """
    if cfg is None:
        cfg = EliteConfig()
    
    results = []
    
    for seed in seeds:
        # Generate K candidates
        with torch.no_grad():
            output = model.generate_k_candidates(seed, k, device=device)
        
        tiles_batch = output["tiles"]      # (K, 13, 13)
        starts = output["start_pos"]       # (K, 2)
        goals = output["goal_pos"]         # (K, 2)
        
        for i in range(k):
            tiles = tiles_batch[i].cpu().numpy().tolist()
            sx, sy = int(starts[i][0]), int(starts[i][1])
            gx, gy = int(goals[i][0]), int(goals[i][1])
            
            # Verify
            res = validate_ice_interior(tiles, sx, sy, gx, gy, target_moves=target_moves)
            
            # Compute reward
            reward = compute_reward(
                solvable=res.solvable,
                no_stuck=res.no_stuck,
                unique_optimal=res.unique_optimal,
                optimal_moves=res.optimal_moves if res.solvable else -1,
                target=target_moves,
                cfg=cfg,
            )
            
            results.append({
                "seed": f"{seed}-{i}",
                "tiles": tiles_batch[i],  # Keep as tensor
                "start_pos": starts[i],
                "goal_pos": goals[i],
                "solvable": res.solvable,
                "no_stuck": res.no_stuck,
                "unique_optimal": res.unique_optimal,
                "optimal_moves": res.optimal_moves if res.solvable else -1,
                "reward": reward,
                "is_target": res.solvable and res.unique_optimal and res.meets_target_moves,
            })
    
    return results


def select_elites(
    results: List[Dict],
    elite_fraction: float = 0.1,
    min_elites: int = 8,
) -> List[Dict]:
    """Select top elite_fraction of results by reward."""
    # Sort by reward descending
    sorted_results = sorted(results, key=lambda x: x["reward"], reverse=True)
    
    # Keep top fraction, but at least min_elites
    n_elites = max(min_elites, int(len(sorted_results) * elite_fraction))
    n_elites = min(n_elites, len(sorted_results))
    
    return sorted_results[:n_elites]


class EliteDataset(Dataset):
    """Dataset of elite puzzles for fine-tuning."""
    
    def __init__(self, elites: List[Dict]):
        self.elites = elites
    
    def __len__(self):
        return len(self.elites)
    
    def __getitem__(self, idx):
        e = self.elites[idx]
        return {
            "tiles": e["tiles"],
            "start_pos": e["start_pos"],
            "goal_pos": e["goal_pos"],
            "reward": torch.tensor(e["reward"], dtype=torch.float32),
        }


def compute_kl_loss(
    model: PuzzleGeneratorV2,
    ref_model: PuzzleGeneratorV2,
    tiles: torch.Tensor,
    start_pos: torch.Tensor,
    goal_pos: torch.Tensor,
    device: torch.device,
) -> torch.Tensor:
    """
    Compute KL divergence between model and reference model.
    
    KL(model || ref) = sum over positions of KL(model_logits || ref_logits)
    """
    B = tiles.shape[0]
    
    # Get logits from both models
    # We need to run a forward pass with the tiles as targets
    # Create a "fully revealed" input (t=0 in diffusion terms)
    tiles_flat = tiles.view(B, -1)  # (B, 169)
    
    # Create position indices for start/goal (flat index = y * 13 + x)
    start_idx = start_pos[:, 1] * 13 + start_pos[:, 0]
    goal_idx = goal_pos[:, 1] * 13 + goal_pos[:, 0]
    
    # Forward pass through model
    model_out = model.forward(
        tiles_flat, 
        t=torch.zeros(B, device=device, dtype=torch.long),
        start_pos=start_idx,
        goal_pos=goal_idx,
    )
    
    with torch.no_grad():
        ref_out = ref_model.forward(
            tiles_flat,
            t=torch.zeros(B, device=device, dtype=torch.long),
            start_pos=start_idx,
            goal_pos=goal_idx,
        )
    
    # KL divergence on tile logits
    model_log_probs = F.log_softmax(model_out["tile_logits"], dim=-1)
    ref_probs = F.softmax(ref_out["tile_logits"], dim=-1)
    
    # KL = sum_x ref(x) * (log ref(x) - log model(x))
    # We use the formula: KL = sum ref * log(ref/model)
    kl = F.kl_div(model_log_probs, ref_probs, reduction="batchmean")
    
    return kl


def train_on_elites(
    model: PuzzleGeneratorV2,
    ref_model: PuzzleGeneratorV2,
    elites: List[Dict],
    optimizer: torch.optim.Optimizer,
    cfg: EliteConfig,
    device: torch.device,
) -> Dict[str, float]:
    """
    Fine-tune model on elite puzzles with KL anchor.
    
    Loss = -log_prob(elite_tiles) + β * KL(model || ref)
    """
    model.train()
    
    dataset = EliteDataset(elites)
    loader = DataLoader(dataset, batch_size=cfg.batch_size, shuffle=True)
    
    total_loss = 0.0
    total_tile_loss = 0.0
    total_kl_loss = 0.0
    n_batches = 0
    
    optimizer.zero_grad()
    
    for batch_idx, batch in enumerate(loader):
        tiles = batch["tiles"].to(device)
        start_pos = batch["start_pos"].to(device)
        goal_pos = batch["goal_pos"].to(device)
        
        B = tiles.shape[0]
        tiles_flat = tiles.view(B, -1)
        
        # Position indices
        start_idx = start_pos[:, 1] * 13 + start_pos[:, 0]
        goal_idx = goal_pos[:, 1] * 13 + goal_pos[:, 0]
        
        # Forward pass (at t=0, fully revealed)
        out = model.forward(
            tiles_flat,
            t=torch.zeros(B, device=device, dtype=torch.long),
            start_pos=start_idx,
            goal_pos=goal_idx,
        )
        
        # Tile cross-entropy loss (maximize log-prob of elite tiles)
        tile_logits = out["tile_logits"]  # (B, 169, vocab)
        tile_loss = F.cross_entropy(
            tile_logits.view(-1, tile_logits.size(-1)),
            tiles_flat.view(-1),
        )
        
        # KL loss
        kl_loss = compute_kl_loss(model, ref_model, tiles, start_pos, goal_pos, device)
        
        # Combined loss
        loss = tile_loss + cfg.kl_weight * kl_loss
        loss = loss / cfg.grad_accum_steps
        loss.backward()
        
        total_loss += loss.item() * cfg.grad_accum_steps
        total_tile_loss += tile_loss.item()
        total_kl_loss += kl_loss.item()
        n_batches += 1
        
        # Gradient accumulation
        if (batch_idx + 1) % cfg.grad_accum_steps == 0:
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad()
    
    # Final step if needed
    if n_batches % cfg.grad_accum_steps != 0:
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        optimizer.zero_grad()
    
    model.eval()
    
    return {
        "loss": total_loss / max(n_batches, 1),
        "tile_loss": total_tile_loss / max(n_batches, 1),
        "kl_loss": total_kl_loss / max(n_batches, 1),
    }


def evaluate(
    model: PuzzleGeneratorV2,
    num_seeds: int,
    k: int,
    device: torch.device,
    target_moves: int = 10,
) -> Dict[str, float]:
    """Evaluate model on fresh seeds."""
    results = []
    
    for seed_idx in range(num_seeds):
        seed = f"eval-{seed_idx}"
        with torch.no_grad():
            output = model.generate_k_candidates(seed, k, device=device)
        
        tiles_batch = output["tiles"]
        starts = output["start_pos"]
        goals = output["goal_pos"]
        
        # Check first valid puzzle found
        for i in range(k):
            tiles = tiles_batch[i].cpu().numpy().tolist()
            sx, sy = int(starts[i][0]), int(starts[i][1])
            gx, gy = int(goals[i][0]), int(goals[i][1])
            
            res = validate_ice_interior(tiles, sx, sy, gx, gy, target_moves=target_moves)
            
            if res.solvable and res.unique_optimal and res.meets_target_moves:
                results.append({"found": True, "moves": res.optimal_moves})
                break
        else:
            # Check stats of best candidate
            tiles = tiles_batch[0].cpu().numpy().tolist()
            sx, sy = int(starts[0][0]), int(starts[0][1])
            gx, gy = int(goals[0][0]), int(goals[0][1])
            res = validate_ice_interior(tiles, sx, sy, gx, gy)
            results.append({
                "found": False,
                "moves": res.optimal_moves if res.solvable else -1,
            })
    
    found = sum(1 for r in results if r["found"])
    moves = [r["moves"] for r in results if r["moves"] > 0]
    
    return {
        "success_rate": found / num_seeds,
        "found": found,
        "total": num_seeds,
        "moves_mean": sum(moves) / len(moves) if moves else 0,
    }


def main():
    parser = argparse.ArgumentParser(description="Elite fine-tuning for puzzle generator")
    parser.add_argument("--checkpoint", required=True, help="Path to pretrained checkpoint")
    parser.add_argument("--output", default="output_elite", help="Output directory")
    parser.add_argument("--k", type=int, default=64, help="Candidates per seed")
    parser.add_argument("--elite-fraction", type=float, default=0.1, help="Top fraction to keep")
    parser.add_argument("--seeds-per-round", type=int, default=128, help="Seeds per round")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--kl-weight", type=float, default=0.1, help="KL penalty weight")
    parser.add_argument("--max-rounds", type=int, default=100, help="Max training rounds")
    parser.add_argument("--eval-seeds", type=int, default=50, help="Seeds for evaluation")
    parser.add_argument("--eval-k", type=int, default=100, help="K for evaluation")
    args = parser.parse_args()
    
    # Config
    cfg = EliteConfig(
        k_candidates=args.k,
        elite_fraction=args.elite_fraction,
        seeds_per_round=args.seeds_per_round,
        lr=args.lr,
        kl_weight=args.kl_weight,
        max_rounds=args.max_rounds,
    )
    
    # Setup
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    os.makedirs(args.output, exist_ok=True)
    
    # Load pretrained model
    torch.serialization.add_safe_globals([ModelConfig])
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=True)
    
    model = PuzzleGeneratorV2(ckpt["config"]).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    print(f"Loaded checkpoint from step {ckpt.get('global_step', 'unknown')}")
    
    # Create frozen reference model
    ref_model = PuzzleGeneratorV2(ckpt["config"]).to(device)
    ref_model.load_state_dict(ckpt["model_state"])
    ref_model.eval()
    for param in ref_model.parameters():
        param.requires_grad = False
    print("Reference model frozen")
    
    # Optimizer
    optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.lr)
    
    # Initial evaluation
    print("\nInitial evaluation...")
    init_metrics = evaluate(model, args.eval_seeds, args.eval_k, device)
    print(f"Initial: {init_metrics['found']}/{init_metrics['total']} "
          f"({init_metrics['success_rate']*100:.1f}%) exact-10, "
          f"moves mean={init_metrics['moves_mean']:.1f}")
    
    best_success = init_metrics["success_rate"]
    
    # Training loop
    log_path = Path(args.output) / "progress.log"
    
    for round_idx in range(cfg.max_rounds):
        round_start = time.time()
        
        # Generate seeds for this round
        seeds = [f"round{round_idx}-seed{i}" for i in range(cfg.seeds_per_round)]
        
        # Generate and score
        print(f"\nRound {round_idx + 1}/{cfg.max_rounds}: Generating {len(seeds)} x {cfg.k_candidates} candidates...")
        gen_start = time.time()
        results = generate_and_score(model, seeds, cfg.k_candidates, device, cfg.target_moves, cfg)
        gen_time = time.time() - gen_start
        
        # Stats
        n_solvable = sum(1 for r in results if r["solvable"])
        n_unique = sum(1 for r in results if r["unique_optimal"])
        n_target = sum(1 for r in results if r["is_target"])
        rewards = [r["reward"] for r in results]
        
        print(f"  Generated {len(results)} puzzles in {gen_time:.1f}s")
        print(f"  Solvable: {n_solvable/len(results)*100:.1f}%, "
              f"Unique: {n_unique/len(results)*100:.1f}%, "
              f"Exact-10: {n_target/len(results)*100:.2f}%")
        print(f"  Reward: min={min(rewards):.2f}, max={max(rewards):.2f}, mean={sum(rewards)/len(rewards):.2f}")
        
        # Select elites
        elites = select_elites(results, cfg.elite_fraction, cfg.min_elites_per_batch)
        elite_rewards = [e["reward"] for e in elites]
        elite_targets = sum(1 for e in elites if e["is_target"])
        print(f"  Elites: {len(elites)} (reward >= {min(elite_rewards):.2f}), "
              f"{elite_targets} exact-10")
        
        # Train on elites
        train_metrics = train_on_elites(model, ref_model, elites, optimizer, cfg, device)
        print(f"  Training: loss={train_metrics['loss']:.4f}, "
              f"tile={train_metrics['tile_loss']:.4f}, "
              f"kl={train_metrics['kl_loss']:.4f}")
        
        # Evaluate periodically
        if (round_idx + 1) % cfg.eval_every == 0:
            eval_metrics = evaluate(model, args.eval_seeds, args.eval_k, device)
            print(f"  Eval: {eval_metrics['found']}/{eval_metrics['total']} "
                  f"({eval_metrics['success_rate']*100:.1f}%) exact-10, "
                  f"moves mean={eval_metrics['moves_mean']:.1f}")
            
            # Save if best
            if eval_metrics["success_rate"] > best_success:
                best_success = eval_metrics["success_rate"]
                torch.save({
                    "model_state": model.state_dict(),
                    "config": ckpt["config"],
                    "round": round_idx + 1,
                    "success_rate": best_success,
                }, Path(args.output) / "best_model.pt")
                print(f"  -> New best: {best_success*100:.1f}%")
            
            # Early stopping
            if eval_metrics["success_rate"] >= cfg.target_success_rate:
                print(f"\n🎉 Target success rate reached! ({eval_metrics['success_rate']*100:.1f}%)")
                break
        
        # Save checkpoint periodically
        if (round_idx + 1) % cfg.save_every == 0:
            torch.save({
                "model_state": model.state_dict(),
                "config": ckpt["config"],
                "round": round_idx + 1,
                "optimizer_state": optimizer.state_dict(),
            }, Path(args.output) / f"checkpoint_round{round_idx+1:04d}.pt")
        
        # Log
        round_time = time.time() - round_start
        with open(log_path, "a") as f:
            f.write(f"round={round_idx+1} "
                    f"exact10={n_target/len(results)*100:.2f}% "
                    f"elites={len(elites)} "
                    f"loss={train_metrics['loss']:.4f} "
                    f"kl={train_metrics['kl_loss']:.4f} "
                    f"time={round_time:.1f}s\n")
    
    # Final evaluation
    print("\nFinal evaluation...")
    final_metrics = evaluate(model, args.eval_seeds * 2, args.eval_k, device)
    print(f"Final: {final_metrics['found']}/{final_metrics['total']} "
          f"({final_metrics['success_rate']*100:.1f}%) exact-10")
    
    # Save final model
    torch.save({
        "model_state": model.state_dict(),
        "config": ckpt["config"],
        "round": round_idx + 1,
        "final_success_rate": final_metrics["success_rate"],
    }, Path(args.output) / "final_model.pt")


if __name__ == "__main__":
    main()
