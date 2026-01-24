"""
PPO-based RL fine-tuning for puzzle generator.

This uses PPO (Proximal Policy Optimization) to fine-tune the diffusion model.
Unlike standard RL envs, here:
- The policy IS the generative model
- Actions are tile predictions at each denoising step
- Reward is computed from the final generated puzzle

Shaped reward function:
- solvable: +0.2
- no_stuck: +0.2
- unique_optimal: +0.2
- moves bonus: +0.4 * (1 - |moves - 10| / 10)^2

PPO improvements over REINFORCE:
- Clipped surrogate objective (prevents large updates)
- Multiple epochs per batch (better sample efficiency)
- GAE for advantage estimation
- Larger effective batch sizes
"""

import argparse
import copy
import time
import torch
import torch.nn.functional as F
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass

from model_v2 import PuzzleGeneratorV2, ModelConfig
from mazle_eval import validate_ice_interior


@dataclass
class PPOConfig:
    """PPO hyperparameters."""
    lr: float = 1e-5
    batch_size: int = 64  # Larger batch for stability
    mini_batch_size: int = 16
    ppo_epochs: int = 4  # Multiple passes over each batch
    clip_eps: float = 0.2  # PPO clipping
    vf_coef: float = 0.5  # Value function loss coefficient
    ent_coef: float = 0.01  # Entropy bonus
    kl_coef: float = 0.1  # KL penalty coefficient
    max_grad_norm: float = 0.5
    gamma: float = 1.0  # No discounting (single-step episodes)
    gae_lambda: float = 1.0
    target_kl: float = 0.1  # Increased from 0.02 - allow more learning per epoch
    max_steps: int = 500
    eval_every: int = 50
    target_moves: int = 10
    curriculum_stage: int = 1  # 1=unique focus, 2=add moves


def compute_shaped_reward(
    solvable: bool,
    no_stuck: bool,
    unique_optimal: bool,
    optimal_moves: int,
    target: int = 10,
    curriculum_stage: int = 1,  # 1=unique focus, 2=add moves
) -> float:
    """
    Curriculum reward function.
    
    Stage 1 (unique focus):
    - solvable: +0.2
    - no_stuck: +0.3
    - unique_optimal: +0.5  (main focus!)
    
    Stage 2 (add moves):
    - solvable: +0.1
    - no_stuck: +0.1
    - unique_optimal: +0.3
    - moves bonus: +0.5 * (1 - |moves - target| / 10)^2
    """
    if not solvable:
        return -0.3
    
    if curriculum_stage == 1:
        # Stage 1: Focus on unique_optimal (50% of reward)
        reward = 0.2  # Solvable
        if no_stuck:
            reward += 0.3
        if unique_optimal:
            reward += 0.5  # Big reward for unique!
        return reward
    else:
        # Stage 2: Add moves bonus
        reward = 0.1  # Solvable
        if no_stuck:
            reward += 0.1
        if unique_optimal:
            reward += 0.3
            # Moves bonus only if unique
            move_diff = abs(optimal_moves - target)
            move_score = max(0, 1 - move_diff / 10) ** 2
            reward += 0.5 * move_score
        return reward


class PPOTrainer:
    """PPO trainer for puzzle generator."""
    
    def __init__(
        self,
        model: PuzzleGeneratorV2,
        ref_model: PuzzleGeneratorV2,
        cfg: PPOConfig,
        device: torch.device,
    ):
        self.model = model
        self.ref_model = ref_model
        self.cfg = cfg
        self.device = device
        
        self.optimizer = torch.optim.AdamW(
            model.parameters(), 
            lr=cfg.lr,
            weight_decay=0.01,
        )
        
        # Value head for advantage estimation
        # Simple MLP on top of model's hidden state
        self.value_head = torch.nn.Sequential(
            torch.nn.Linear(256, 128),
            torch.nn.ReLU(),
            torch.nn.Linear(128, 1),
        ).to(device)
        self.value_optimizer = torch.optim.AdamW(self.value_head.parameters(), lr=cfg.lr)
        
    def generate_with_logprobs(
        self, 
        batch_size: int, 
        seeds: List[str]
    ) -> Tuple[Dict, torch.Tensor, torch.Tensor]:
        """
        Generate puzzles and track log-probabilities for PPO.
        Returns: (outputs, log_probs, values)
        """
        self.model.eval()
        
        all_tiles = []
        all_starts = []
        all_goals = []
        all_log_probs = []
        
        for i, seed in enumerate(seeds):
            torch.manual_seed(hash(seed) % (2**32))
            
            # Generate with log-prob tracking
            result = self.model.generate(1, device=self.device)
            
            tiles = result["tiles"][0]
            start = result["start_pos"][0]
            goal = result["goal_pos"][0]
            
            all_tiles.append(tiles)
            all_starts.append(start)
            all_goals.append(goal)
            
            # Compute log-prob of generated sequence
            # For diffusion, this is approximate - sum of log-probs at each step
            log_prob = self._compute_generation_logprob(tiles, start, goal)
            all_log_probs.append(log_prob)
        
        outputs = {
            "tiles": torch.stack(all_tiles),
            "start_pos": torch.stack(all_starts),
            "goal_pos": torch.stack(all_goals),
        }
        
        log_probs = torch.stack(all_log_probs).detach()  # Detach old log-probs!
        
        # Compute values (simple: just zeros for now, proper impl would use hidden states)
        values = torch.zeros(batch_size, device=self.device)
        
        return outputs, log_probs, values
    
    def _compute_generation_logprob(
        self, 
        tiles: torch.Tensor, 
        start: torch.Tensor, 
        goal: torch.Tensor,
        detach: bool = True,
    ) -> torch.Tensor:
        """Compute approximate log-probability of a generated puzzle.
        
        Fixed: Average over multiple timesteps instead of random single timestep
        to reduce variance in log-prob estimates.
        """
        self.model.train()
        
        # Create a batch of 1
        tiles_batch = tiles.unsqueeze(0)  # (1, 13, 13)
        
        # Average log-prob over multiple fixed timesteps for stability
        timesteps = [10, 25, 40]  # Early, mid, late in diffusion
        log_probs_list = []
        
        for t_val in timesteps:
            t = torch.tensor([t_val], device=self.device)
            
            # Forward pass through model to get logits
            logits = self._get_tile_logits(tiles_batch, t)
            
            # Log-prob of actual tiles
            log_probs = F.log_softmax(logits, dim=-1)
            tiles_flat = tiles_batch.view(-1).long()
            log_prob = log_probs.view(-1, log_probs.size(-1))[
                torch.arange(tiles_flat.size(0), device=self.device),
                tiles_flat
            ].mean()
            log_probs_list.append(log_prob)
        
        # Average across timesteps for more stable estimate
        avg_log_prob = torch.stack(log_probs_list).mean()
        
        if detach:
            return avg_log_prob.detach()
        return avg_log_prob
    
    def _get_tile_logits(self, tiles: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """Get model's tile logits for given tiles and timestep."""
        batch_size = tiles.size(0)
        
        # Create input with masking based on timestep
        mask_prob = t.float() / 50.0
        mask = torch.rand_like(tiles.float()) < mask_prob.view(-1, 1, 1)
        
        x_t = tiles.clone()
        x_t[mask] = 6  # MASK token
        
        # Forward pass - use model.forward() which takes (tiles, t, start_pos, goal_pos)
        output = self.model.forward(
            x_t.view(batch_size, -1),
            t.expand(batch_size),
        )
        
        return output["tile_logits"]
    
    def compute_advantages(
        self,
        rewards: torch.Tensor,
        values: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Compute GAE advantages and returns."""
        # For bandit (single-step), advantage = reward - value
        advantages = rewards - values
        returns = rewards
        
        # Normalize advantages
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)
        
        return advantages, returns
    
    def ppo_update(
        self,
        log_probs_old: torch.Tensor,
        advantages: torch.Tensor,
        returns: torch.Tensor,
        tiles: torch.Tensor,
        starts: torch.Tensor,
        goals: torch.Tensor,
    ) -> Dict[str, float]:
        """Perform PPO update with multiple epochs."""
        
        batch_size = tiles.size(0)
        total_policy_loss = 0
        total_value_loss = 0
        total_entropy = 0
        total_kl = 0
        n_updates = 0
        
        for epoch in range(self.cfg.ppo_epochs):
            # Shuffle batch
            indices = torch.randperm(batch_size)
            
            for start_idx in range(0, batch_size, self.cfg.mini_batch_size):
                end_idx = min(start_idx + self.cfg.mini_batch_size, batch_size)
                mb_indices = indices[start_idx:end_idx]
                
                mb_tiles = tiles[mb_indices]
                mb_old_logprobs = log_probs_old[mb_indices]
                mb_advantages = advantages[mb_indices]
                mb_returns = returns[mb_indices]
                
                # Compute new log-probs WITH GRADIENTS for PPO update
                mb_new_logprobs = []
                for i in range(mb_tiles.size(0)):
                    lp = self._compute_generation_logprob(
                        mb_tiles[i],
                        starts[mb_indices[i]],
                        goals[mb_indices[i]],
                        detach=False,  # Keep gradients for PPO update!
                    )
                    mb_new_logprobs.append(lp)
                mb_new_logprobs = torch.stack(mb_new_logprobs)
                
                # Compute values
                mb_values = torch.zeros(mb_tiles.size(0), device=self.device)
                
                # PPO ratio (old_logprobs are already detached)
                ratio = torch.exp(mb_new_logprobs - mb_old_logprobs)
                
                # Clipped surrogate
                surr1 = ratio * mb_advantages
                surr2 = torch.clamp(ratio, 1 - self.cfg.clip_eps, 1 + self.cfg.clip_eps) * mb_advantages
                policy_loss = -torch.min(surr1, surr2).mean()
                
                # Value loss
                value_loss = F.mse_loss(mb_values, mb_returns)
                
                # KL divergence (approximate) - detach for logging
                kl = (mb_old_logprobs - mb_new_logprobs.detach()).mean()
                
                # Total loss (don't include KL in backward - it's just for logging/early stop)
                loss = policy_loss + self.cfg.vf_coef * value_loss
                
                # Update
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.cfg.max_grad_norm)
                self.optimizer.step()
                
                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_kl += kl.item()
                n_updates += 1
                
            # Early stop if KL too high
            avg_kl = total_kl / n_updates
            if avg_kl > self.cfg.target_kl:
                print(f"  Early stopping PPO epoch {epoch+1} due to high KL: {avg_kl:.4f}")
                break
        
        return {
            "policy_loss": total_policy_loss / n_updates,
            "value_loss": total_value_loss / n_updates,
            "kl": total_kl / n_updates,
        }
    
    def train_step(self, step: int) -> Dict[str, float]:
        """Single PPO training step."""
        
        # Generate batch
        seeds = [f"ppo-step{step}-{i}" for i in range(self.cfg.batch_size)]
        outputs, log_probs_old, values = self.generate_with_logprobs(
            self.cfg.batch_size, seeds
        )
        
        tiles = outputs["tiles"]
        starts = outputs["start_pos"]
        goals = outputs["goal_pos"]
        
        # Compute rewards
        rewards = []
        stats = {"solvable": 0, "no_stuck": 0, "unique": 0, "exact10": 0, "moves": []}
        
        for i in range(self.cfg.batch_size):
            t = tiles[i].cpu().numpy()
            sx, sy = int(starts[i][0]), int(starts[i][1])
            gx, gy = int(goals[i][0]), int(goals[i][1])
            
            val = validate_ice_interior(t, sx, sy, gx, gy, self.cfg.target_moves)
            
            reward = compute_shaped_reward(
                val.solvable, val.no_stuck, val.unique_optimal,
                val.optimal_moves if val.solvable else 0,
                self.cfg.target_moves,
                self.cfg.curriculum_stage,
            )
            rewards.append(reward)
            
            if val.solvable:
                stats["solvable"] += 1
                stats["moves"].append(val.optimal_moves)
            if val.no_stuck:
                stats["no_stuck"] += 1
            if val.unique_optimal:
                stats["unique"] += 1
            if val.solvable and val.unique_optimal and val.meets_target_moves and val.no_stuck:
                stats["exact10"] += 1
        
        rewards = torch.tensor(rewards, device=self.device)
        
        # Compute advantages
        advantages, returns = self.compute_advantages(rewards, values)
        
        # PPO update
        update_stats = self.ppo_update(
            log_probs_old, advantages, returns,
            tiles, starts, goals,
        )
        
        return {
            "reward_mean": rewards.mean().item(),
            "reward_std": rewards.std().item(),
            "solvable": stats["solvable"] / self.cfg.batch_size,
            "no_stuck": stats["no_stuck"] / self.cfg.batch_size,
            "unique": stats["unique"] / self.cfg.batch_size,
            "exact10": stats["exact10"] / self.cfg.batch_size,
            "moves_mean": np.mean(stats["moves"]) if stats["moves"] else 0,
            **update_stats,
        }


def evaluate(
    model: PuzzleGeneratorV2,
    num_samples: int,
    device: torch.device,
    target_moves: int = 10,
    eval_step: int = 0,
) -> Dict[str, float]:
    """Evaluate model with single-shot generation."""
    import random
    
    model.eval()
    
    passes = 0
    solvable = 0
    no_stuck = 0
    unique = 0
    moves_list = []
    rewards = []
    
    for i in range(num_samples):
        seed = f"eval-ppo-step{eval_step}-{i}-{random.randint(0, 999999)}"
        
        with torch.no_grad():
            torch.manual_seed(hash(seed) % (2**32))
            result = model.generate(1, device=device)
        
        tiles = result["tiles"][0].cpu().numpy()
        sx, sy = int(result["start_pos"][0, 0]), int(result["start_pos"][0, 1])
        gx, gy = int(result["goal_pos"][0, 0]), int(result["goal_pos"][0, 1])
        
        val = validate_ice_interior(tiles, sx, sy, gx, gy, target_moves)
        
        reward = compute_shaped_reward(
            val.solvable, val.no_stuck, val.unique_optimal,
            val.optimal_moves if val.solvable else 0,
            target_moves,
        )
        rewards.append(reward)
        
        if val.solvable:
            solvable += 1
            moves_list.append(val.optimal_moves)
        if val.no_stuck:
            no_stuck += 1
        if val.unique_optimal:
            unique += 1
        if val.solvable and val.no_stuck and val.unique_optimal and val.meets_target_moves:
            passes += 1
    
    return {
        "full_pass_rate": passes / num_samples,
        "passes": passes,
        "total": num_samples,
        "solvable": solvable / num_samples,
        "no_stuck": no_stuck / num_samples,
        "unique": unique / num_samples,
        "reward_mean": np.mean(rewards),
        "moves_mean": np.mean(moves_list) if moves_list else 0,
    }


def main():
    parser = argparse.ArgumentParser(description="PPO training for puzzle generator")
    parser.add_argument("--checkpoint", required=True, help="Path to pretrained checkpoint")
    parser.add_argument("--output", default="output_ppo", help="Output directory")
    parser.add_argument("--batch-size", type=int, default=64, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--max-steps", type=int, default=500, help="Max training steps")
    parser.add_argument("--eval-samples", type=int, default=200, help="Eval samples")
    parser.add_argument("--clip-eps", type=float, default=0.2, help="PPO clip epsilon")
    parser.add_argument("--kl-coef", type=float, default=0.1, help="KL penalty coefficient")
    parser.add_argument("--curriculum-stage", type=int, default=1, help="1=unique focus, 2=add moves")
    
    args = parser.parse_args()
    
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    # Load model
    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    config = ckpt["config"]
    
    model = PuzzleGeneratorV2(config)
    model.load_state_dict(ckpt["model_state"])
    model = model.to(device)
    
    ref_model = PuzzleGeneratorV2(config)
    ref_model.load_state_dict(ckpt["model_state"])
    ref_model = ref_model.to(device)
    ref_model.eval()
    for p in ref_model.parameters():
        p.requires_grad = False
    
    print(f"Loaded checkpoint from step {ckpt.get('step', 'unknown')}")
    print(f"Curriculum stage: {args.curriculum_stage}")
    
    # Setup trainer
    cfg = PPOConfig(
        lr=args.lr,
        batch_size=args.batch_size,
        max_steps=args.max_steps,
        clip_eps=args.clip_eps,
        kl_coef=args.kl_coef,
        curriculum_stage=args.curriculum_stage,
    )
    
    trainer = PPOTrainer(model, ref_model, cfg, device)
    
    output_path = Path(args.output)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Initial eval
    print("\nInitial evaluation...")
    init_metrics = evaluate(model, args.eval_samples, device, eval_step=-1)
    print(f"Initial: {init_metrics['passes']}/{init_metrics['total']} "
          f"({init_metrics['full_pass_rate']*100:.1f}%) full pass, "
          f"reward={init_metrics['reward_mean']:.3f}")
    
    best_pass_rate = init_metrics["full_pass_rate"]
    best_reward = init_metrics["reward_mean"]
    
    # Training loop
    print(f"\nStarting PPO training for {cfg.max_steps} steps...")
    print(f"Batch size: {cfg.batch_size}, LR: {cfg.lr}, Clip: {cfg.clip_eps}")
    
    for step in range(cfg.max_steps):
        start_time = time.time()
        
        metrics = trainer.train_step(step)
        
        step_time = time.time() - start_time
        
        if step % 1 == 0:  # Print every step for visibility
            print(f"step={step} reward={metrics['reward_mean']:.3f}±{metrics['reward_std']:.2f} "
                  f"solve={metrics['solvable']*100:.0f}% unique={metrics['unique']*100:.0f}% "
                  f"exact10={metrics['exact10']*100:.0f}% moves={metrics['moves_mean']:.1f} "
                  f"kl={metrics['kl']:.4f} dt={step_time:.1f}s")
        
        # Evaluate periodically
        if (step + 1) % cfg.eval_every == 0:
            eval_metrics = evaluate(model, args.eval_samples, device, eval_step=step)
            print(f"  EVAL: {eval_metrics['passes']}/{eval_metrics['total']} "
                  f"({eval_metrics['full_pass_rate']*100:.1f}%) full pass, "
                  f"reward={eval_metrics['reward_mean']:.3f}, "
                  f"moves={eval_metrics['moves_mean']:.1f}")
            
            # Save best by pass rate
            if eval_metrics["full_pass_rate"] > best_pass_rate:
                best_pass_rate = eval_metrics["full_pass_rate"]
                torch.save({
                    "model_state": model.state_dict(),
                    "config": config,
                    "step": step,
                    "pass_rate": best_pass_rate,
                    "reward": eval_metrics["reward_mean"],
                }, output_path / "best_model.pt")
                print(f"  -> New best pass rate: {best_pass_rate*100:.1f}%")
            
            # Early stop if moves collapse
            if eval_metrics["moves_mean"] < 6.0:
                print(f"  WARNING: moves_mean={eval_metrics['moves_mean']:.1f} < 6.0, stopping!")
                break
    
    # Final eval
    print("\nFinal evaluation...")
    final_metrics = evaluate(model, args.eval_samples * 2, device, eval_step=999999)
    print(f"Final: {final_metrics['passes']}/{final_metrics['total']} "
          f"({final_metrics['full_pass_rate']*100:.1f}%) full pass")
    
    torch.save({
        "model_state": model.state_dict(),
        "config": config,
        "step": cfg.max_steps,
        "pass_rate": final_metrics["full_pass_rate"],
    }, output_path / "final_model.pt")


if __name__ == "__main__":
    main()
