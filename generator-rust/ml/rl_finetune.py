"""
Reinforcement Learning Fine-Tuning for Mazle Puzzle Generator

Uses REINFORCE (policy gradient) to directly optimize verifier reward.

Key difference from elite fine-tuning:
- Elite: trains on tiles of good puzzles (doesn't learn WHY they're good)
- RL: optimizes log-prob of actions that led to reward (learns the mechanism)

For masked diffusion:
1. Track log-probs of each tile prediction during generation
2. Get reward from verifier
3. REINFORCE: loss = -reward * sum(log_probs)
4. KL penalty to prevent collapse
"""

import argparse
import math
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from model_v2 import PuzzleGeneratorV2, ModelConfig, config_for_preset
from mazle_eval import validate_ice_interior


@dataclass  
class RLConfig:
    """Configuration for RL fine-tuning."""
    # Generation
    batch_size: int = 16           # Puzzles per batch
    
    # Reward shaping
    target_moves: int = 10
    reward_not_solvable: float = -1.0
    reward_stuck: float = -1.0           # Increased from -0.5
    reward_not_unique: float = -0.5
    reward_exact_target: float = 1.0
    reward_near_target: float = 0.3   # For moves within ±1
    reward_off_target: float = -0.2   # Per move away from target
    
    # Training
    lr: float = 1e-5
    kl_weight: float = 0.01          # KL penalty weight
    entropy_weight: float = 0.01     # Entropy bonus for exploration
    max_steps: int = 5000
    eval_every: int = 100
    save_every: int = 500
    grad_clip: float = 1.0
    
    # Baseline
    use_baseline: bool = True        # Subtract mean reward to reduce variance


def compute_reward(
    solvable: bool,
    no_stuck: bool, 
    unique_optimal: bool,
    optimal_moves: int,
    target: int = 10,
    cfg: RLConfig = None,
) -> float:
    """Compute scalar reward for a puzzle."""
    if cfg is None:
        cfg = RLConfig()
    
    if not solvable:
        return cfg.reward_not_solvable
    
    reward = 0.0
    
    if not no_stuck:
        reward += cfg.reward_stuck
    if not unique_optimal:
        reward += cfg.reward_not_unique
    
    # Move-based reward
    if optimal_moves == target:
        reward += cfg.reward_exact_target
    elif abs(optimal_moves - target) == 1:
        reward += cfg.reward_near_target
    else:
        reward += cfg.reward_off_target * abs(optimal_moves - target)
    
    return reward


class RLTrainer:
    """RL trainer for puzzle generator."""
    
    def __init__(
        self,
        model: PuzzleGeneratorV2,
        ref_model: PuzzleGeneratorV2,
        cfg: RLConfig,
        device: torch.device,
    ):
        self.model = model
        self.ref_model = ref_model
        self.cfg = cfg
        self.device = device
        
        self.optimizer = torch.optim.AdamW(model.parameters(), lr=cfg.lr)
        
    def generate_with_logprobs(
        self,
        batch_size: int,
        seeds: List[str],
    ) -> Tuple[Dict[str, torch.Tensor], torch.Tensor, torch.Tensor]:
        """
        Generate puzzles while tracking log-probabilities.
        
        For REINFORCE, we don't backprop through generation - we just need
        the log-probs of the actions taken, which we'll use to compute
        the policy gradient.
        
        Returns:
            - outputs: dict with tiles, start_pos, goal_pos
            - log_probs: (B,) sum of log-probs for each puzzle
            - entropies: (B,) sum of entropies for each puzzle
        """
        H, W = self.model.config.grid_height, self.model.config.grid_width
        grid_size = H * W
        num_steps = self.model.config.num_timesteps
        
        all_tiles = []
        all_starts = []
        all_goals = []
        all_log_probs = []
        all_entropies = []
        
        for seed in seeds:
            # Create deterministic generator from seed
            seed_int = hash(seed) % (2**32)
            gen = torch.Generator(device=self.device).manual_seed(seed_int)
            
            # Initialize with all MASK tokens
            x_t = torch.full((1, grid_size), self.model.mask_token_id,
                           dtype=torch.long, device=self.device)
            
            # Track log-probs separately (these will require grad)
            log_prob_accum = torch.tensor(0.0, device=self.device, requires_grad=True)
            entropy_accum = torch.tensor(0.0, device=self.device)
            
            # Sample START/GOAL positions first
            init_out = self.model.forward(
                x_t,
                t=torch.tensor([num_steps - 1], device=self.device),
            )
            
            # Sample start position
            start_logits = init_out["start_logits"]  # (1, 169)
            start_probs = F.softmax(start_logits, dim=-1)
            start_idx = torch.multinomial(start_probs.detach(), 1, generator=gen).squeeze(-1)  # (1,)
            
            # Log-prob of chosen action (this requires grad through start_logits)
            start_log_prob = F.log_softmax(start_logits, dim=-1)[0, start_idx]
            start_entropy = -(start_probs * start_probs.clamp(min=1e-8).log()).sum()
            
            log_prob_accum = log_prob_accum + start_log_prob
            entropy_accum = entropy_accum + start_entropy.detach()
            
            # Sample goal position (exclude start)
            goal_logits = init_out["goal_logits"].clone()
            goal_logits[0, start_idx] = float('-inf')
            goal_probs = F.softmax(goal_logits, dim=-1)
            goal_idx = torch.multinomial(goal_probs.detach(), 1, generator=gen).squeeze(-1)
            
            goal_log_prob = F.log_softmax(goal_logits, dim=-1)[0, goal_idx]
            goal_entropy = -(goal_probs * goal_probs.clamp(min=1e-8).log()).sum()
            
            log_prob_accum = log_prob_accum + goal_log_prob
            entropy_accum = entropy_accum + goal_entropy.detach()
            
            # Denoising loop - sample tiles
            for step in range(num_steps - 1, -1, -1):
                t = torch.tensor([step], device=self.device)
                
                # Forward pass
                out = self.model.forward(x_t, t, start_pos=start_idx, goal_pos=goal_idx)
                tile_logits = out["tile_logits"]  # (1, 169, vocab)
                
                # Find masked positions
                mask = (x_t == self.model.mask_token_id)  # (1, 169)
                
                if not mask.any():
                    break
                
                # Determine how many to unmask this step
                n_masked = mask.sum().item()
                n_to_unmask = max(1, int(n_masked * (1.0 / (step + 1))))
                n_to_unmask = min(n_to_unmask, n_masked)
                
                # Get logits for masked positions
                masked_indices = mask[0].nonzero(as_tuple=True)[0]
                masked_logits = tile_logits[0, masked_indices]  # (n_masked, vocab)
                
                # Temperature scaling
                temp = 1.0 - 0.5 * (step / num_steps)
                masked_logits_scaled = masked_logits / max(temp, 0.1)
                
                # Sample predictions for masked positions (detached for sampling)
                masked_probs = F.softmax(masked_logits_scaled.detach(), dim=-1)
                sampled_tiles = torch.multinomial(masked_probs, 1, generator=gen).squeeze(-1)
                
                # Compute confidence scores for selecting which to unmask
                confidence = masked_probs.max(dim=-1).values
                _, top_k_indices = confidence.topk(min(n_to_unmask, len(confidence)))
                
                # Update x_t with most confident predictions (no grad needed for x_t itself)
                positions_to_update = masked_indices[top_k_indices]
                tiles_to_set = sampled_tiles[top_k_indices]
                x_t = x_t.clone()  # Avoid inplace modification
                x_t[0, positions_to_update] = tiles_to_set
                
                # Accumulate log-probs for the actions we took (requires grad through logits)
                log_probs_for_tiles = F.log_softmax(masked_logits_scaled[top_k_indices], dim=-1)
                for i, tile_id in enumerate(tiles_to_set):
                    log_prob_accum = log_prob_accum + log_probs_for_tiles[i, tile_id]
                
                # Accumulate entropy
                entropy_for_tiles = -(masked_probs[top_k_indices] * masked_probs[top_k_indices].clamp(min=1e-8).log()).sum()
                entropy_accum = entropy_accum + entropy_for_tiles
            
            # Convert positions to (x, y)
            start_x = start_idx % W
            start_y = start_idx // W
            goal_x = goal_idx % W
            goal_y = goal_idx // W
            
            all_tiles.append(x_t.view(H, W).detach())
            all_starts.append(torch.stack([start_x, start_y], dim=-1).detach())
            all_goals.append(torch.stack([goal_x, goal_y], dim=-1).detach())
            all_log_probs.append(log_prob_accum)
            all_entropies.append(entropy_accum)
        
        return {
            "tiles": torch.stack(all_tiles),
            "start_pos": torch.cat(all_starts),
            "goal_pos": torch.cat(all_goals),
        }, torch.stack(all_log_probs), torch.stack(all_entropies)
    
    def compute_kl_penalty(
        self,
        tiles: torch.Tensor,
        start_pos: torch.Tensor,
        goal_pos: torch.Tensor,
    ) -> torch.Tensor:
        """Compute KL divergence from reference model."""
        B = tiles.shape[0]
        tiles_flat = tiles.view(B, -1)
        
        # Convert positions to flat indices
        start_idx = start_pos[:, 1] * 13 + start_pos[:, 0]
        goal_idx = goal_pos[:, 1] * 13 + goal_pos[:, 0]
        
        # Forward through both models
        model_out = self.model.forward(
            tiles_flat,
            t=torch.zeros(B, device=self.device, dtype=torch.long),
            start_pos=start_idx,
            goal_pos=goal_idx,
        )
        
        with torch.no_grad():
            ref_out = self.ref_model.forward(
                tiles_flat,
                t=torch.zeros(B, device=self.device, dtype=torch.long),
                start_pos=start_idx,
                goal_pos=goal_idx,
            )
        
        # KL on tile logits
        model_log_probs = F.log_softmax(model_out["tile_logits"], dim=-1)
        ref_probs = F.softmax(ref_out["tile_logits"], dim=-1)
        
        kl = F.kl_div(model_log_probs, ref_probs, reduction="batchmean")
        return kl
    
    def train_step(self, step: int) -> Dict[str, float]:
        """Single RL training step."""
        self.model.train()
        
        # Generate batch with log-probs
        seeds = [f"rl-step{step}-{i}" for i in range(self.cfg.batch_size)]
        
        outputs, log_probs, entropies = self.generate_with_logprobs(
            self.cfg.batch_size, seeds
        )
        
        tiles = outputs["tiles"]
        starts = outputs["start_pos"]
        goals = outputs["goal_pos"]
        
        # Compute rewards from verifier
        rewards = []
        stats = {"solvable": 0, "unique": 0, "exact10": 0, "moves": []}
        
        for i in range(self.cfg.batch_size):
            t = tiles[i].cpu().numpy().tolist()
            sx, sy = int(starts[i][0]), int(starts[i][1])
            gx, gy = int(goals[i][0]), int(goals[i][1])
            
            res = validate_ice_interior(t, sx, sy, gx, gy, target_moves=self.cfg.target_moves)
            
            reward = compute_reward(
                solvable=res.solvable,
                no_stuck=res.no_stuck,
                unique_optimal=res.unique_optimal,
                optimal_moves=res.optimal_moves if res.solvable else -1,
                target=self.cfg.target_moves,
                cfg=self.cfg,
            )
            rewards.append(reward)
            
            if res.solvable:
                stats["solvable"] += 1
                stats["moves"].append(res.optimal_moves)
                if res.unique_optimal:
                    stats["unique"] += 1
                if res.optimal_moves == self.cfg.target_moves:
                    stats["exact10"] += 1
        
        rewards = torch.tensor(rewards, device=self.device, dtype=torch.float32)
        
        # Baseline subtraction to reduce variance
        if self.cfg.use_baseline:
            baseline = rewards.mean()
            advantages = rewards - baseline
        else:
            advantages = rewards
        
        # Policy gradient loss: -E[advantage * log_prob]
        pg_loss = -(advantages * log_probs).mean()
        
        # KL penalty
        kl_loss = self.compute_kl_penalty(tiles, starts, goals)
        
        # Entropy bonus (encourage exploration)
        entropy_bonus = entropies.mean()
        
        # Total loss
        loss = pg_loss + self.cfg.kl_weight * kl_loss - self.cfg.entropy_weight * entropy_bonus
        
        # Optimize
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.cfg.grad_clip)
        self.optimizer.step()
        
        self.model.eval()
        
        return {
            "loss": loss.item(),
            "pg_loss": pg_loss.item(),
            "kl_loss": kl_loss.item(),
            "entropy": entropy_bonus.item(),
            "reward_mean": rewards.mean().item(),
            "reward_max": rewards.max().item(),
            "solvable": stats["solvable"] / self.cfg.batch_size,
            "unique": stats["unique"] / self.cfg.batch_size,
            "exact10": stats["exact10"] / self.cfg.batch_size,
            "moves_mean": sum(stats["moves"]) / len(stats["moves"]) if stats["moves"] else 0,
        }


def evaluate(
    model: PuzzleGeneratorV2,
    num_seeds: int,
    k: int,
    device: torch.device,
    target_moves: int = 10,
) -> Dict[str, float]:
    """Evaluate model with K-candidates."""
    found = 0
    moves_list = []
    
    for seed_idx in range(num_seeds):
        seed = f"eval-{seed_idx}"
        with torch.no_grad():
            output = model.generate_k_candidates(seed, k, device=device)
        
        tiles_batch = output["tiles"]
        starts = output["start_pos"]
        goals = output["goal_pos"]
        
        for i in range(k):
            tiles = tiles_batch[i].cpu().numpy().tolist()
            sx, sy = int(starts[i][0]), int(starts[i][1])
            gx, gy = int(goals[i][0]), int(goals[i][1])
            
            res = validate_ice_interior(tiles, sx, sy, gx, gy, target_moves=target_moves)
            
            if res.solvable and res.unique_optimal and res.meets_target_moves and res.no_stuck:
                found += 1
                moves_list.append(res.optimal_moves)
                break
        else:
            # Track first puzzle's moves for stats
            tiles = tiles_batch[0].cpu().numpy().tolist()
            sx, sy = int(starts[0][0]), int(starts[0][1])
            gx, gy = int(goals[0][0]), int(goals[0][1])
            res = validate_ice_interior(tiles, sx, sy, gx, gy)
            if res.solvable:
                moves_list.append(res.optimal_moves)
    
    return {
        "success_rate": found / num_seeds,
        "found": found,
        "total": num_seeds,
        "moves_mean": sum(moves_list) / len(moves_list) if moves_list else 0,
    }


def main():
    parser = argparse.ArgumentParser(description="RL fine-tuning for puzzle generator")
    parser.add_argument("--checkpoint", required=True, help="Path to pretrained checkpoint")
    parser.add_argument("--output", default="output_rl", help="Output directory")
    parser.add_argument("--batch-size", type=int, default=16, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--kl-weight", type=float, default=0.01, help="KL penalty weight")
    parser.add_argument("--max-steps", type=int, default=5000, help="Max training steps")
    parser.add_argument("--eval-seeds", type=int, default=30, help="Seeds for evaluation")
    parser.add_argument("--eval-k", type=int, default=100, help="K for evaluation")
    args = parser.parse_args()
    
    # Config
    cfg = RLConfig(
        batch_size=args.batch_size,
        lr=args.lr,
        kl_weight=args.kl_weight,
        max_steps=args.max_steps,
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
    print(f"Loaded checkpoint from step {ckpt.get('global_step', 'unknown')}")
    
    # Create frozen reference model
    ref_model = PuzzleGeneratorV2(ckpt["config"]).to(device)
    ref_model.load_state_dict(ckpt["model_state"])
    ref_model.eval()
    for param in ref_model.parameters():
        param.requires_grad = False
    print("Reference model frozen")
    
    # Trainer
    trainer = RLTrainer(model, ref_model, cfg, device)
    
    # Initial evaluation
    print("\nInitial evaluation...")
    init_metrics = evaluate(model, args.eval_seeds, args.eval_k, device)
    print(f"Initial: {init_metrics['found']}/{init_metrics['total']} "
          f"({init_metrics['success_rate']*100:.1f}%) exact-10")
    
    best_success = init_metrics["success_rate"]
    log_path = Path(args.output) / "progress.log"
    
    # Training loop
    print(f"\nStarting RL training for {cfg.max_steps} steps...")
    
    for step in range(cfg.max_steps):
        start_time = time.time()
        
        metrics = trainer.train_step(step)
        
        step_time = time.time() - start_time
        
        # Log every 10 steps
        if step % 10 == 0:
            print(f"step={step} loss={metrics['loss']:.4f} pg={metrics['pg_loss']:.4f} "
                  f"kl={metrics['kl_loss']:.4f} reward={metrics['reward_mean']:.3f} "
                  f"solve={metrics['solvable']*100:.0f}% exact10={metrics['exact10']*100:.0f}% "
                  f"moves={metrics['moves_mean']:.1f} dt={step_time:.1f}s")
        
        # Log to file
        with open(log_path, "a") as f:
            f.write(f"step={step} loss={metrics['loss']:.4f} reward={metrics['reward_mean']:.3f} "
                   f"exact10={metrics['exact10']*100:.1f}% moves={metrics['moves_mean']:.1f}\n")
        
        # Evaluate periodically
        if (step + 1) % cfg.eval_every == 0:
            eval_metrics = evaluate(model, args.eval_seeds, args.eval_k, device)
            print(f"  EVAL: {eval_metrics['found']}/{eval_metrics['total']} "
                  f"({eval_metrics['success_rate']*100:.1f}%) exact-10, "
                  f"moves={eval_metrics['moves_mean']:.1f}")
            
            if eval_metrics["success_rate"] > best_success:
                best_success = eval_metrics["success_rate"]
                torch.save({
                    "model_state": model.state_dict(),
                    "config": ckpt["config"],
                    "step": step + 1,
                    "success_rate": best_success,
                }, Path(args.output) / "best_model.pt")
                print(f"  -> New best: {best_success*100:.1f}%")
        
        # Save checkpoint periodically
        if (step + 1) % cfg.save_every == 0:
            torch.save({
                "model_state": model.state_dict(),
                "config": ckpt["config"],
                "step": step + 1,
                "optimizer_state": trainer.optimizer.state_dict(),
            }, Path(args.output) / f"checkpoint_step{step+1:05d}.pt")
    
    # Final evaluation
    print("\nFinal evaluation...")
    final_metrics = evaluate(model, args.eval_seeds * 2, args.eval_k, device)
    print(f"Final: {final_metrics['found']}/{final_metrics['total']} "
          f"({final_metrics['success_rate']*100:.1f}%) exact-10")
    
    torch.save({
        "model_state": model.state_dict(),
        "config": ckpt["config"],
        "step": cfg.max_steps,
        "final_success_rate": final_metrics["success_rate"],
    }, Path(args.output) / "final_model.pt")


if __name__ == "__main__":
    main()
