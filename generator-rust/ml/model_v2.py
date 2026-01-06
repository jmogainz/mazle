"""
Puzzle Generator v2 - Unconditional Masked Diffusion

Key architectural changes from v1:
1. NO seed conditioning - seed only controls sampling RNG
2. Separate START/GOAL position heads (169-way categorical each)
3. Tile grid generation conditioned on fixed START/GOAL positions
4. BERT-style masked modeling with iterative refinement

This addresses the core problems:
- Removes "learning pseudo-random function" trap
- Makes START/GOAL "exactly 1" constraint trivial by construction
- Enables global reasoning about puzzle structure
"""

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ModelConfig:
    """Configuration for v2 model."""
    # Tile vocabulary (floor, wall, ice, ledges) - NO start/goal
    tile_vocab_size: int = 7  # 0=floor, 1=wall, 4=ice, 5-8=ledges
    
    # Grid dimensions
    grid_height: int = 13
    grid_width: int = 13
    
    # Model architecture
    model_dim: int = 256
    num_layers: int = 6
    num_heads: int = 8
    ff_dim: int = 1024
    dropout: float = 0.1
    
    # Diffusion/masking
    num_timesteps: int = 50  # Fewer steps, faster inference
    mask_schedule: str = "cosine"  # "linear" or "cosine"


def config_for_preset(preset: str) -> ModelConfig:
    """Get config for a preset size."""
    if preset == "small":
        return ModelConfig(model_dim=128, num_layers=4, num_heads=4, ff_dim=512)
    elif preset == "base":
        return ModelConfig(model_dim=256, num_layers=6, num_heads=8, ff_dim=1024)
    elif preset == "large":
        return ModelConfig(model_dim=384, num_layers=8, num_heads=12, ff_dim=1536)
    else:
        raise ValueError(f"Unknown preset: {preset}")


class SinusoidalPositionEmbedding(nn.Module):
    """Sinusoidal embeddings for 2D positions and timesteps."""
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (...) positions/timesteps
        Returns:
            (..., dim) embeddings
        """
        device = x.device
        half_dim = self.dim // 2
        emb = math.log(10000) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=device) * -emb)
        emb = x.unsqueeze(-1).float() * emb
        emb = torch.cat([torch.sin(emb), torch.cos(emb)], dim=-1)
        return emb


class TransformerBlock(nn.Module):
    """Standard transformer block with pre-norm."""
    
    def __init__(self, dim: int, num_heads: int, ff_dim: int, dropout: float = 0.1):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, num_heads, dropout=dropout, batch_first=True)
        self.norm2 = nn.LayerNorm(dim)
        self.ff = nn.Sequential(
            nn.Linear(dim, ff_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(ff_dim, dim),
            nn.Dropout(dropout),
        )
    
    def forward(self, x: torch.Tensor, t_emb: Optional[torch.Tensor] = None) -> torch.Tensor:
        # Self-attention
        h = self.norm1(x)
        h, _ = self.attn(h, h, h)
        x = x + h
        
        # Add timestep embedding if provided
        if t_emb is not None:
            x = x + t_emb.unsqueeze(1)
        
        # Feedforward
        h = self.norm2(x)
        x = x + self.ff(h)
        
        return x


class PositionHead(nn.Module):
    """Head for predicting a single position (START or GOAL)."""
    
    def __init__(self, input_dim: int, grid_size: int, hidden_dim: int = 256):
        super().__init__()
        self.grid_size = grid_size
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, grid_size),  # 169-way categorical
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, dim) pooled features
        Returns:
            (B, grid_size) logits over positions
        """
        return self.net(x)


class PuzzleGeneratorV2(nn.Module):
    """
    Unconditional puzzle generator with:
    - Position heads for START/GOAL (by construction exactly 1)
    - Masked diffusion for tile grid
    - No seed conditioning (determinism via sampling RNG)
    - Ordered stop sequence prediction (auxiliary supervision for 10-move constraint)
    """
    
    # Number of stops for 10-move puzzles (start + 9 intermediate + goal)
    NUM_STOPS = 11
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width  # 169
        self.num_timesteps = config.num_timesteps
        
        # MASK token for diffusion
        self.mask_token_id = config.tile_vocab_size
        self.full_vocab_size = config.tile_vocab_size + 1
        
        # Tile embedding (includes MASK token)
        self.tile_embed = nn.Embedding(self.full_vocab_size, config.model_dim)
        
        # 2D position embeddings
        self.row_embed = nn.Embedding(config.grid_height, config.model_dim // 2)
        self.col_embed = nn.Embedding(config.grid_width, config.model_dim // 2)
        
        # Timestep embedding
        self.time_embed = nn.Sequential(
            SinusoidalPositionEmbedding(config.model_dim),
            nn.Linear(config.model_dim, config.model_dim),
            nn.GELU(),
            nn.Linear(config.model_dim, config.model_dim),
        )
        
        # START/GOAL position embeddings (added to grid when known)
        self.start_pos_embed = nn.Embedding(self.grid_size, config.model_dim)
        self.goal_pos_embed = nn.Embedding(self.grid_size, config.model_dim)
        
        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(config.model_dim, config.num_heads, config.ff_dim, config.dropout)
            for _ in range(config.num_layers)
        ])
        
        # Output heads
        self.output_norm = nn.LayerNorm(config.model_dim)
        
        # Position heads (predict START/GOAL locations)
        self.start_head = PositionHead(config.model_dim, self.grid_size)
        self.goal_head = PositionHead(config.model_dim * 2, self.grid_size)  # Conditioned on start
        
        # Tile head (predict tile types, conditioned on START/GOAL)
        self.tile_head = nn.Linear(config.model_dim, config.tile_vocab_size)
        
        # Auxiliary path heads (predict optimal path structure)
        # on_path: binary per-cell "is this cell on the optimal path?"
        self.on_path_head = nn.Linear(config.model_dim, 1)
        # is_stop: binary per-cell "is this a stop/turn position on the path?"
        self.is_stop_head = nn.Linear(config.model_dim, 1)
        
        # ===== NEW: Ordered stop sequence head =====
        # Predicts 11 stops in order: stop_0=start, stop_1-9=intermediate, stop_10=goal
        # This makes "10 moves" explicit supervision, not emergent from tiles
        # Uses a small autoregressive transformer on top of grid features
        self.stop_idx_embed = nn.Embedding(self.NUM_STOPS, config.model_dim)
        self.stop_query = nn.Parameter(torch.randn(1, self.NUM_STOPS, config.model_dim) * 0.02)
        self.stop_attn = nn.MultiheadAttention(config.model_dim, config.num_heads, dropout=config.dropout, batch_first=True)
        self.stop_ff = nn.Sequential(
            nn.Linear(config.model_dim, config.ff_dim),
            nn.GELU(),
            nn.Linear(config.ff_dim, config.model_dim),
        )
        self.stop_norm1 = nn.LayerNorm(config.model_dim)
        self.stop_norm2 = nn.LayerNorm(config.model_dim)
        self.stop_head = nn.Linear(config.model_dim, self.grid_size)  # 11 x 169-way categorical
        
        # Initialize diffusion schedule
        self._init_schedule()
    
    def _init_schedule(self):
        """Initialize mask schedule for diffusion."""
        T = self.num_timesteps
        
        if self.config.mask_schedule == "cosine":
            # Cosine schedule: more masking at high t
            s = 0.008
            steps = torch.linspace(0, T, T + 1)
            alpha_bar = torch.cos(((steps / T) + s) / (1 + s) * math.pi / 2) ** 2
            alpha_bar = alpha_bar / alpha_bar[0]
        else:
            # Linear schedule
            alpha_bar = 1.0 - torch.linspace(0, 1, T + 1)
        
        self.register_buffer("alpha_bar", alpha_bar[1:])  # (T,)
    
    def _get_position_features(self, B: int, device: torch.device) -> torch.Tensor:
        """Get 2D position features for the grid."""
        H, W = self.config.grid_height, self.config.grid_width
        
        rows = torch.arange(H, device=device)
        cols = torch.arange(W, device=device)
        
        row_emb = self.row_embed(rows)  # (H, dim/2)
        col_emb = self.col_embed(cols)  # (W, dim/2)
        
        # Combine row and col embeddings
        row_emb = row_emb.unsqueeze(1).expand(H, W, -1)  # (H, W, dim/2)
        col_emb = col_emb.unsqueeze(0).expand(H, W, -1)  # (H, W, dim/2)
        
        pos_emb = torch.cat([row_emb, col_emb], dim=-1)  # (H, W, dim)
        pos_emb = pos_emb.reshape(H * W, -1)  # (169, dim)
        
        return pos_emb.unsqueeze(0).expand(B, -1, -1)  # (B, 169, dim)
    
    def q_sample(self, x_0: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """
        Forward diffusion: mask tiles according to schedule.
        
        Args:
            x_0: (B, 169) original tiles
            t: (B,) timesteps
        Returns:
            x_t: (B, 169) masked tiles
        """
        B = x_0.shape[0]
        device = x_0.device
        
        # Probability of being unmasked at each timestep
        mask_prob = 1.0 - self.alpha_bar[t]  # (B,)
        
        # Sample which positions to mask
        mask = torch.rand(B, self.grid_size, device=device) < mask_prob[:, None]
        
        # Replace masked positions with MASK token
        x_t = torch.where(mask, self.mask_token_id, x_0)
        
        return x_t
    
    def forward_positions(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Predict START and GOAL positions from initial grid features.
        
        Args:
            x: (B, 169, dim) grid features
        Returns:
            start_logits: (B, 169)
            goal_logits: (B, 169)
        """
        # Pool features for position prediction
        pooled = x.mean(dim=1)  # (B, dim)
        
        # Predict START
        start_logits = self.start_head(pooled)  # (B, 169)
        
        # Predict GOAL conditioned on START distribution
        # Use soft attention over start positions
        start_probs = F.softmax(start_logits, dim=-1)  # (B, 169)
        start_ctx = torch.einsum("bp,bpd->bd", start_probs, x)  # (B, dim)
        
        goal_input = torch.cat([pooled, start_ctx], dim=-1)  # (B, 2*dim)
        goal_logits = self.goal_head(goal_input)  # (B, 169)
        
        return start_logits, goal_logits
    
    def forward(
        self,
        tiles: torch.Tensor,
        t: torch.Tensor,
        start_pos: Optional[torch.Tensor] = None,
        goal_pos: Optional[torch.Tensor] = None,
    ) -> Dict[str, torch.Tensor]:
        """
        Forward pass for training.
        
        Args:
            tiles: (B, 169) tile indices (possibly masked)
            t: (B,) timesteps
            start_pos: (B,) start positions (flat index 0-168)
            goal_pos: (B,) goal positions (flat index 0-168)
        
        Returns:
            dict with logits for tiles, start, goal, path, and stop sequence
        """
        B = tiles.shape[0]
        device = tiles.device
        
        # Embed tiles
        x = self.tile_embed(tiles)  # (B, 169, dim)
        
        # Add position embeddings
        x = x + self._get_position_features(B, device)
        
        # Add timestep embedding
        t_emb = self.time_embed(t.float())  # (B, dim)
        
        # Add START/GOAL position context if provided
        if start_pos is not None:
            start_emb = self.start_pos_embed(start_pos)  # (B, dim)
            x = x + start_emb.unsqueeze(1)  # Broadcast to all positions
        
        if goal_pos is not None:
            goal_emb = self.goal_pos_embed(goal_pos)  # (B, dim)
            x = x + goal_emb.unsqueeze(1)
        
        # Transformer layers
        for layer in self.layers:
            x = layer(x, t_emb)
        
        # Output projections
        x = self.output_norm(x)
        
        # Tile logits
        tile_logits = self.tile_head(x)  # (B, 169, tile_vocab_size)
        
        # Position logits (from initial features, before heavy conditioning)
        start_logits, goal_logits = self.forward_positions(x)
        
        # Auxiliary path heads
        on_path_logits = self.on_path_head(x).squeeze(-1)  # (B, 169)
        is_stop_logits = self.is_stop_head(x).squeeze(-1)  # (B, 169)
        
        # ===== NEW: Ordered stop sequence prediction =====
        # Use learned queries that attend to grid features to predict each stop
        stop_queries = self.stop_query.expand(B, -1, -1)  # (B, 11, dim)
        stop_idx = torch.arange(self.NUM_STOPS, device=device)
        stop_queries = stop_queries + self.stop_idx_embed(stop_idx).unsqueeze(0)  # Add position info
        
        # Cross-attend to grid features
        stop_q = self.stop_norm1(stop_queries)
        stop_out, _ = self.stop_attn(stop_q, x, x)  # (B, 11, dim)
        stop_out = stop_queries + stop_out
        
        # Feedforward
        stop_out = stop_out + self.stop_ff(self.stop_norm2(stop_out))
        
        # Project to grid positions
        stop_logits = self.stop_head(stop_out)  # (B, 11, 169)
        
        return {
            "tile_logits": tile_logits,
            "start_logits": start_logits,
            "goal_logits": goal_logits,
            "on_path_logits": on_path_logits,
            "is_stop_logits": is_stop_logits,
            "stop_logits": stop_logits,  # NEW: ordered stop sequence
        }
    
    @torch.no_grad()
    def generate(
        self,
        batch_size: int,
        device: torch.device,
        generator: Optional[torch.Generator] = None,
        temperature: float = 1.0,
        temperature_schedule: str = "linear",  # "linear", "cosine", or "constant"
    ) -> Dict[str, torch.Tensor]:
        """
        Generate puzzles with deterministic seeded sampling.
        
        Args:
            batch_size: Number of puzzles to generate
            device: Device to generate on
            generator: torch.Generator for deterministic sampling
            temperature: Base temperature for sampling
            temperature_schedule: How to vary temperature over timesteps
        
        Returns:
            dict with:
                - tiles: (B, 13, 13) generated tile grid
                - start_pos: (B, 2) start (x, y)
                - goal_pos: (B, 2) goal (x, y)
        """
        H, W = self.config.grid_height, self.config.grid_width
        
        # Step 1: Initialize with all MASK tokens
        x_t = torch.full((batch_size, self.grid_size), self.mask_token_id, 
                         dtype=torch.long, device=device)
        
        # Step 2: Get initial features and sample START/GOAL positions
        t_init = torch.full((batch_size,), self.num_timesteps - 1, dtype=torch.long, device=device)
        
        # Initial forward pass to get position logits
        outputs = self.forward(x_t, t_init)
        
        # Sample START position
        start_logits = outputs["start_logits"] / temperature
        start_probs = F.softmax(start_logits, dim=-1)
        if generator is not None:
            # Gumbel-max trick for deterministic sampling
            gumbel_noise = torch.rand(start_probs.shape, device=device, generator=generator)
            gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
            start_pos = (start_logits + gumbel).argmax(dim=-1)
        else:
            start_pos = torch.multinomial(start_probs, 1).squeeze(-1)
        
        # Sample GOAL position (conditioned on START in the model)
        goal_logits = outputs["goal_logits"] / temperature
        goal_probs = F.softmax(goal_logits, dim=-1)
        if generator is not None:
            gumbel_noise = torch.rand(goal_probs.shape, device=device, generator=generator)
            gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
            goal_pos = (goal_logits + gumbel).argmax(dim=-1)
        else:
            goal_pos = torch.multinomial(goal_probs, 1).squeeze(-1)
        
        # Step 3: Iterative denoising for tiles
        for step in reversed(range(self.num_timesteps)):
            t = torch.full((batch_size,), step, dtype=torch.long, device=device)
            
            # Get temperature for this step
            if temperature_schedule == "linear":
                step_temp = temperature * (1.0 - step / self.num_timesteps) + 0.1
            elif temperature_schedule == "cosine":
                step_temp = temperature * math.cos(step / self.num_timesteps * math.pi / 2) + 0.1
            else:
                step_temp = temperature
            
            # Forward pass
            outputs = self.forward(x_t, t, start_pos, goal_pos)
            logits = outputs["tile_logits"]  # (B, 169, vocab_size)
            logits = logits / step_temp
            
            # Sample tiles
            probs = F.softmax(logits, dim=-1)  # (B, 169, vocab_size)
            probs_flat = probs.reshape(-1, self.config.tile_vocab_size)
            
            if generator is not None:
                # Gumbel-max for deterministic sampling
                gumbel_noise = torch.rand(probs_flat.shape, device=device, generator=generator)
                gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
                logits_flat = logits.reshape(-1, self.config.tile_vocab_size)
                sampled = (logits_flat + gumbel).argmax(dim=-1)
            else:
                sampled = torch.multinomial(probs_flat, 1).squeeze(-1)
            
            x_0_pred = sampled.reshape(batch_size, self.grid_size)
            
            if step > 0:
                # Re-mask some positions for next step
                mask_prob_t = 1.0 - self.alpha_bar[step]
                mask_prob_prev = 1.0 - self.alpha_bar[step - 1]
                
                # Probability of staying masked
                keep_mask_prob = mask_prob_prev / mask_prob_t.clamp(min=1e-8)
                
                if generator is not None:
                    rand_vals = torch.rand((batch_size, self.grid_size), device=device, 
                                          generator=generator)
                    keep_mask = rand_vals < keep_mask_prob
                else:
                    keep_mask = torch.rand(batch_size, self.grid_size, device=device) < keep_mask_prob
                
                currently_masked = x_t == self.mask_token_id
                x_t = torch.where(currently_masked & keep_mask, self.mask_token_id, x_0_pred)
            else:
                x_t = x_0_pred
        
        # Reshape to 2D grid
        tiles = x_t.reshape(batch_size, H, W)
        
        # Convert flat positions to (x, y)
        start_xy = torch.stack([start_pos % W, start_pos // W], dim=-1)  # (B, 2)
        goal_xy = torch.stack([goal_pos % W, goal_pos // W], dim=-1)  # (B, 2)
        
        return {
            "tiles": tiles,
            "start_pos": start_xy,
            "goal_pos": goal_xy,
        }
    
    @torch.no_grad()
    def generate_k_candidates(
        self,
        seed: str,
        k: int,
        device: torch.device,
        temperature: float = 1.0,
    ) -> Dict[str, torch.Tensor]:
        """
        Generate K candidate puzzles from a single seed.
        Uses deterministic sub-seeds for reproducibility.
        
        Args:
            seed: Base seed string
            k: Number of candidates
            device: Device
            temperature: Sampling temperature
        
        Returns:
            dict with K puzzles (tiles, start_pos, goal_pos)
        """
        import hashlib
        
        all_tiles = []
        all_starts = []
        all_goals = []
        
        for i in range(k):
            # Derive deterministic sub-seed
            sub_seed = hashlib.sha256(f"{seed}||{i}".encode()).hexdigest()
            seed_int = int(sub_seed[:16], 16)
            
            # Create deterministic generator
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_int)
            
            # Generate single puzzle
            result = self.generate(
                batch_size=1,
                device=device,
                generator=gen,
                temperature=temperature,
            )
            
            all_tiles.append(result["tiles"])
            all_starts.append(result["start_pos"])
            all_goals.append(result["goal_pos"])
        
        return {
            "tiles": torch.cat(all_tiles, dim=0),
            "start_pos": torch.cat(all_starts, dim=0),
            "goal_pos": torch.cat(all_goals, dim=0),
        }
