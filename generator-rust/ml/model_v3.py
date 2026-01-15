"""
Puzzle Generator v3 - Ordered Stop Sequence + Masked Diffusion

Key architectural changes from v2:
1. Predict ordered stop sequence (11 stops) FIRST
   - stop_0 = START, stop_10 = GOAL
   - stop_1..stop_9 = intermediate stops in order
   - This makes "10 moves" structural, not emergent!
2. Condition tile diffusion on the ordered stop sequence
3. Remove separate START/GOAL heads (now part of stop sequence)

This addresses the core problem:
- V2's on_path/is_stop masks are unordered, so "10" is still emergent
- Ordered stops ARE the move count - 11 stops = 10 moves by construction
- Train with teacher forcing on verifier's optimal_path
"""

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ModelConfig:
    """Configuration for v3 model."""
    # Tile vocabulary (floor, wall, ice, ledges) - NO start/goal
    tile_vocab_size: int = 7  # 0=floor, 1=wall, 4=ice, 5-8=ledges
    
    # Grid dimensions
    grid_height: int = 13
    grid_width: int = 13
    
    # Stop sequence
    num_stops: int = 11  # 10 moves = 11 stops (start + 9 intermediate + goal)
    
    # Model architecture
    model_dim: int = 256
    num_layers: int = 6
    num_heads: int = 8
    ff_dim: int = 1024
    dropout: float = 0.1
    
    # Diffusion/masking
    num_timesteps: int = 50


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
    """Sinusoidal embeddings for positions and timesteps."""
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
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
        h = self.norm1(x)
        h, _ = self.attn(h, h, h)
        x = x + h
        
        if t_emb is not None:
            x = x + t_emb.unsqueeze(1)
        
        h = self.norm2(x)
        x = x + self.ff(h)
        
        return x


class CausalTransformerBlock(nn.Module):
    """Transformer block with causal (autoregressive) attention for stop sequence."""
    
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
    
    def forward(self, x: torch.Tensor, causal_mask: torch.Tensor) -> torch.Tensor:
        h = self.norm1(x)
        h, _ = self.attn(h, h, h, attn_mask=causal_mask, is_causal=False)
        x = x + h
        
        h = self.norm2(x)
        x = x + self.ff(h)
        
        return x


class StopSequenceDecoder(nn.Module):
    """
    Autoregressive decoder for ordered stop sequence.
    
    Predicts 11 stop positions in order:
    - stop_0 = START position
    - stop_1..stop_9 = intermediate stop positions  
    - stop_10 = GOAL position
    
    Each stop is a 169-way categorical over grid positions.
    """
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width  # 169
        self.num_stops = config.num_stops  # 11
        
        # Stop index embedding (which stop in sequence: 0-10)
        self.stop_idx_embed = nn.Embedding(config.num_stops, config.model_dim)
        
        # Position embedding for previous stops (what position was chosen)
        self.pos_embed = nn.Embedding(self.grid_size, config.model_dim)
        
        # Learnable "start of sequence" token
        self.sos_embed = nn.Parameter(torch.randn(1, 1, config.model_dim) * 0.02)
        
        # Causal transformer layers (fewer than tile model)
        self.layers = nn.ModuleList([
            CausalTransformerBlock(config.model_dim, config.num_heads, config.ff_dim, config.dropout)
            for _ in range(3)  # Lighter than tile model
        ])
        
        # Output projection to grid positions
        self.output_norm = nn.LayerNorm(config.model_dim)
        self.output_proj = nn.Linear(config.model_dim, self.grid_size)
        
        # Register causal mask
        self._init_causal_mask()
    
    def _init_causal_mask(self):
        """Create causal attention mask."""
        # Mask shape: (num_stops, num_stops), True = masked
        mask = torch.triu(torch.ones(self.num_stops, self.num_stops), diagonal=1).bool()
        self.register_buffer("causal_mask", mask)
    
    def forward(
        self,
        stop_positions: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Forward pass for training with teacher forcing.
        
        Args:
            stop_positions: (B, 11) ground truth stop positions for teacher forcing
                           If None, returns initial embeddings for generation
        
        Returns:
            logits: (B, 11, 169) - logits for each stop position
        """
        if stop_positions is None:
            raise ValueError("stop_positions required for training forward pass")
        
        B = stop_positions.shape[0]
        device = stop_positions.device
        
        # Build input sequence: [SOS, stop_0, stop_1, ..., stop_9]
        # Output predicts: [stop_0, stop_1, ..., stop_10]
        
        # Embed chosen positions (shifted right for teacher forcing)
        pos_emb = self.pos_embed(stop_positions[:, :-1])  # (B, 10, dim)
        
        # Add stop index embeddings
        stop_idx = torch.arange(self.num_stops - 1, device=device)  # 0..9
        idx_emb = self.stop_idx_embed(stop_idx)  # (10, dim)
        pos_emb = pos_emb + idx_emb.unsqueeze(0)  # (B, 10, dim)
        
        # Prepend SOS token
        sos = self.sos_embed.expand(B, -1, -1)  # (B, 1, dim)
        x = torch.cat([sos, pos_emb], dim=1)  # (B, 11, dim)
        
        # Add final stop index embedding to each position
        final_idx_emb = self.stop_idx_embed(torch.arange(self.num_stops, device=device))  # (11, dim)
        x = x + final_idx_emb.unsqueeze(0)
        
        # Apply causal transformer layers
        causal_mask = self.causal_mask.to(device)
        for layer in self.layers:
            x = layer(x, causal_mask)
        
        # Project to logits
        x = self.output_norm(x)
        logits = self.output_proj(x)  # (B, 11, 169)
        
        return logits
    
    @torch.no_grad()
    def generate(
        self,
        batch_size: int,
        device: torch.device,
        generator: Optional[torch.Generator] = None,
        temperature: float = 1.0,
    ) -> torch.Tensor:
        """
        Generate stop sequence autoregressively.
        
        Returns:
            stop_positions: (B, 11) - sampled stop positions
        """
        stop_positions = torch.zeros(batch_size, self.num_stops, dtype=torch.long, device=device)
        
        # Start with SOS
        prev_embed = self.sos_embed.expand(batch_size, -1, -1)  # (B, 1, dim)
        
        for i in range(self.num_stops):
            # Add stop index embedding
            idx_emb = self.stop_idx_embed(torch.tensor([i], device=device))  # (1, dim)
            x = prev_embed + idx_emb.unsqueeze(0)  # (B, seq_len, dim)
            
            # Apply transformer (no causal mask needed for single-step)
            for layer in self.layers:
                # For incremental generation, we don't need the mask
                h = layer.norm1(x)
                h, _ = layer.attn(h[:, -1:], h, h)  # Query only last position
                x_last = x[:, -1:] + h
                h = layer.norm2(x_last)
                x_last = x_last + layer.ff(h)
            
            # Get logits for this position
            logits = self.output_proj(self.output_norm(x_last))  # (B, 1, 169)
            logits = logits.squeeze(1) / temperature  # (B, 169)
            
            # Sample
            probs = F.softmax(logits, dim=-1)
            if generator is not None:
                gumbel_noise = torch.rand(probs.shape, device=device, generator=generator)
                gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
                sampled = (logits + gumbel).argmax(dim=-1)
            else:
                sampled = torch.multinomial(probs, 1).squeeze(-1)
            
            stop_positions[:, i] = sampled
            
            # Update context for next step
            new_embed = self.pos_embed(sampled).unsqueeze(1)  # (B, 1, dim)
            new_embed = new_embed + self.stop_idx_embed(torch.tensor([i], device=device))
            prev_embed = torch.cat([prev_embed, new_embed], dim=1)  # (B, i+2, dim)
        
        return stop_positions


class PuzzleGeneratorV3(nn.Module):
    """
    Puzzle generator with:
    1. Ordered stop sequence prediction (11 stops = 10 moves by construction)
    2. Tile diffusion conditioned on stop sequence
    
    Generation flow:
    1. Generate ordered stop sequence (autoregressively)
    2. Generate tiles conditioned on stops (masked diffusion)
    """
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width  # 169
        self.num_timesteps = config.num_timesteps
        self.num_stops = config.num_stops  # 11
        
        # MASK token for diffusion
        self.mask_token_id = config.tile_vocab_size
        self.full_vocab_size = config.tile_vocab_size + 1
        
        # ===== Stop Sequence Model =====
        self.stop_decoder = StopSequenceDecoder(config)
        
        # ===== Tile Diffusion Model =====
        
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
        
        # Stop sequence conditioning: embed each stop's position onto the grid
        # Each cell gets info about which stops are on it (if any)
        self.stop_marker_embed = nn.Embedding(config.num_stops + 1, config.model_dim)  # +1 for "not a stop"
        
        # Transformer layers for tile prediction
        self.layers = nn.ModuleList([
            TransformerBlock(config.model_dim, config.num_heads, config.ff_dim, config.dropout)
            for _ in range(config.num_layers)
        ])
        
        # Output heads
        self.output_norm = nn.LayerNorm(config.model_dim)
        self.tile_head = nn.Linear(config.model_dim, config.tile_vocab_size)
        
        # Initialize diffusion schedule
        self._init_schedule()
    
    def _init_schedule(self):
        """Initialize cosine mask schedule for diffusion."""
        T = self.num_timesteps
        s = 0.008
        steps = torch.linspace(0, T, T + 1)
        alpha_bar = torch.cos(((steps / T) + s) / (1 + s) * math.pi / 2) ** 2
        alpha_bar = alpha_bar / alpha_bar[0]
        self.register_buffer("alpha_bar", alpha_bar[1:])
    
    def _get_position_features(self, B: int, device: torch.device) -> torch.Tensor:
        """Get 2D position features for the grid."""
        H, W = self.config.grid_height, self.config.grid_width
        
        rows = torch.arange(H, device=device)
        cols = torch.arange(W, device=device)
        
        row_emb = self.row_embed(rows).unsqueeze(1).expand(H, W, -1)
        col_emb = self.col_embed(cols).unsqueeze(0).expand(H, W, -1)
        
        pos_emb = torch.cat([row_emb, col_emb], dim=-1).reshape(H * W, -1)
        return pos_emb.unsqueeze(0).expand(B, -1, -1)
    
    def _get_stop_conditioning(
        self,
        stop_positions: torch.Tensor,
        device: torch.device,
    ) -> torch.Tensor:
        """
        Create stop conditioning for each grid cell.
        
        Args:
            stop_positions: (B, 11) stop positions as flat indices
        
        Returns:
            (B, 169, dim) - conditioning embeddings for each cell
        """
        B = stop_positions.shape[0]
        
        # Create a map from cell -> stop index (0-10) or 11 (not a stop)
        stop_map = torch.full((B, self.grid_size), self.num_stops, dtype=torch.long, device=device)
        
        # Mark each stop position with its index
        for i in range(self.num_stops):
            # stop_positions[:, i] is shape (B,), values 0-168
            batch_idx = torch.arange(B, device=device)
            stop_map[batch_idx, stop_positions[:, i]] = i
        
        # Embed the stop markers
        return self.stop_marker_embed(stop_map)  # (B, 169, dim)
    
    def q_sample(self, x_0: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """Forward diffusion: mask tiles according to schedule."""
        B = x_0.shape[0]
        device = x_0.device
        
        mask_prob = 1.0 - self.alpha_bar[t]
        mask = torch.rand(B, self.grid_size, device=device) < mask_prob[:, None]
        x_t = torch.where(mask, self.mask_token_id, x_0)
        
        return x_t
    
    def forward_stops(
        self,
        stop_positions: torch.Tensor,
    ) -> torch.Tensor:
        """
        Forward pass for stop sequence prediction (training).
        
        Args:
            stop_positions: (B, 11) ground truth stop positions
        
        Returns:
            stop_logits: (B, 11, 169)
        """
        return self.stop_decoder(stop_positions)
    
    def forward_tiles(
        self,
        tiles: torch.Tensor,
        t: torch.Tensor,
        stop_positions: torch.Tensor,
    ) -> torch.Tensor:
        """
        Forward pass for tile prediction (training).
        
        Args:
            tiles: (B, 169) tile indices (possibly masked)
            t: (B,) timesteps
            stop_positions: (B, 11) stop positions for conditioning
        
        Returns:
            tile_logits: (B, 169, vocab_size)
        """
        B = tiles.shape[0]
        device = tiles.device
        
        # Embed tiles
        x = self.tile_embed(tiles)  # (B, 169, dim)
        
        # Add position embeddings
        x = x + self._get_position_features(B, device)
        
        # Add timestep embedding
        t_emb = self.time_embed(t.float())  # (B, dim)
        
        # Add stop conditioning - THIS IS THE KEY CHANGE
        stop_cond = self._get_stop_conditioning(stop_positions, device)  # (B, 169, dim)
        x = x + stop_cond
        
        # Transformer layers
        for layer in self.layers:
            x = layer(x, t_emb)
        
        # Output projection
        x = self.output_norm(x)
        tile_logits = self.tile_head(x)  # (B, 169, tile_vocab_size)
        
        return tile_logits
    
    def forward(
        self,
        tiles: torch.Tensor,
        t: torch.Tensor,
        stop_positions: torch.Tensor,
    ) -> Dict[str, torch.Tensor]:
        """
        Full forward pass for training.
        
        Args:
            tiles: (B, 169) tile indices (possibly masked)
            t: (B,) timesteps
            stop_positions: (B, 11) ground truth stop positions
        
        Returns:
            dict with stop_logits and tile_logits
        """
        stop_logits = self.forward_stops(stop_positions)
        tile_logits = self.forward_tiles(tiles, t, stop_positions)
        
        return {
            "stop_logits": stop_logits,  # (B, 11, 169)
            "tile_logits": tile_logits,  # (B, 169, vocab_size)
        }
    
    @torch.no_grad()
    def generate(
        self,
        batch_size: int,
        device: torch.device,
        generator: Optional[torch.Generator] = None,
        temperature: float = 1.0,
    ) -> Dict[str, torch.Tensor]:
        """
        Generate puzzles.
        
        Returns:
            dict with:
                - tiles: (B, 13, 13) generated tile grid
                - start_pos: (B, 2) start (x, y)
                - goal_pos: (B, 2) goal (x, y)
                - stop_positions: (B, 11) all stop positions (flat indices)
        """
        H, W = self.config.grid_height, self.config.grid_width
        
        # Step 1: Generate stop sequence
        stop_positions = self.stop_decoder.generate(
            batch_size, device, generator, temperature
        )  # (B, 11)
        
        # Step 2: Initialize with all MASK tokens
        x_t = torch.full((batch_size, self.grid_size), self.mask_token_id,
                         dtype=torch.long, device=device)
        
        # Step 3: Iterative denoising for tiles
        for step in reversed(range(self.num_timesteps)):
            t = torch.full((batch_size,), step, dtype=torch.long, device=device)
            
            # Temperature schedule
            step_temp = temperature * (1.0 - step / self.num_timesteps) + 0.1
            
            # Forward pass (conditioned on stops)
            tile_logits = self.forward_tiles(x_t, t, stop_positions)
            logits = tile_logits / step_temp
            
            # Sample tiles
            probs = F.softmax(logits, dim=-1)
            probs_flat = probs.reshape(-1, self.config.tile_vocab_size)
            
            if generator is not None:
                gumbel_noise = torch.rand(probs_flat.shape, device=device, generator=generator)
                gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
                logits_flat = logits.reshape(-1, self.config.tile_vocab_size)
                sampled = (logits_flat + gumbel).argmax(dim=-1)
            else:
                sampled = torch.multinomial(probs_flat, 1).squeeze(-1)
            
            x_0_pred = sampled.reshape(batch_size, self.grid_size)
            
            if step > 0:
                mask_prob_t = 1.0 - self.alpha_bar[step]
                mask_prob_prev = 1.0 - self.alpha_bar[step - 1]
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
        
        # Extract start/goal from stop sequence
        start_pos_flat = stop_positions[:, 0]  # First stop is START
        goal_pos_flat = stop_positions[:, -1]  # Last stop is GOAL
        
        start_xy = torch.stack([start_pos_flat % W, start_pos_flat // W], dim=-1)
        goal_xy = torch.stack([goal_pos_flat % W, goal_pos_flat // W], dim=-1)
        
        return {
            "tiles": tiles,
            "start_pos": start_xy,
            "goal_pos": goal_xy,
            "stop_positions": stop_positions,
        }
    
    @torch.no_grad()
    def generate_k_candidates(
        self,
        seed: str,
        k: int,
        device: torch.device,
        temperature: float = 1.0,
    ) -> Dict[str, torch.Tensor]:
        """Generate K candidate puzzles from a single seed."""
        import hashlib
        
        all_tiles = []
        all_starts = []
        all_goals = []
        all_stops = []
        
        for i in range(k):
            sub_seed = hashlib.sha256(f"{seed}||{i}".encode()).hexdigest()
            seed_int = int(sub_seed[:16], 16)
            
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_int)
            
            result = self.generate(
                batch_size=1,
                device=device,
                generator=gen,
                temperature=temperature,
            )
            
            all_tiles.append(result["tiles"])
            all_starts.append(result["start_pos"])
            all_goals.append(result["goal_pos"])
            all_stops.append(result["stop_positions"])
        
        return {
            "tiles": torch.cat(all_tiles, dim=0),
            "start_pos": torch.cat(all_starts, dim=0),
            "goal_pos": torch.cat(all_goals, dim=0),
            "stop_positions": torch.cat(all_stops, dim=0),
        }
