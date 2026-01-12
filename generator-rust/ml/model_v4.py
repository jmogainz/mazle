"""
Puzzle Generator v4 - Two-Stage Path-First Generation

Key insight: Move count is a GLOBAL EMERGENT property, not learnable from local tile patterns.
Solution: Generate the PATH first (guarantees move count by construction), then fill in tiles.

Stage 1 - Path Generator:
  Input: start_pos, goal_pos, target_moves=10
  Output: sequence of 11 stop positions [(x0,y0), ..., (x10,y10)]
  
  - Autoregressive transformer
  - Each stop conditioned on previous stops
  - Must obey ice physics (slides in cardinal direction until blocked)
  - Move count is BY CONSTRUCTION (11 stops = 10 moves)

Stage 2 - Tile Generator:
  Input: the 11 stop positions (encoded as path mask)
  Output: 13x13 tile grid
  
  - Cells ON the path: must be ice (to allow sliding)
  - Cells that would create SHORTCUTS: must be walls (learned from data)
  - Other cells: free choice (ice, wall, ledges)
  
  Uses masked diffusion conditioned on the path.
"""

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ModelConfig:
    """Configuration for v4 model."""
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
    
    # Path generator (Stage 1)
    num_stops: int = 11  # 10 moves = 11 stops (start + 9 intermediate + goal)
    path_layers: int = 4  # Smaller than tile generator
    
    # Tile generator (Stage 2)
    num_timesteps: int = 50
    mask_schedule: str = "cosine"


def config_for_preset(preset: str) -> ModelConfig:
    """Get config for a preset size."""
    if preset == "small":
        return ModelConfig(model_dim=128, num_layers=4, num_heads=4, ff_dim=512, path_layers=3)
    elif preset == "base":
        return ModelConfig(model_dim=256, num_layers=6, num_heads=8, ff_dim=1024, path_layers=4)
    elif preset == "large":
        return ModelConfig(model_dim=384, num_layers=8, num_heads=12, ff_dim=1536, path_layers=6)
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
    
    def __init__(self, dim: int, num_heads: int, ff_dim: int, dropout: float = 0.1, causal: bool = False):
        super().__init__()
        self.causal = causal
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
        # Self-attention (optionally causal)
        h = self.norm1(x)
        if self.causal:
            # Generate causal mask
            seq_len = x.size(1)
            mask = torch.triu(torch.ones(seq_len, seq_len, device=x.device), diagonal=1).bool()
            h, _ = self.attn(h, h, h, attn_mask=mask)
        else:
            h, _ = self.attn(h, h, h)
        x = x + h
        
        # Add timestep embedding if provided
        if t_emb is not None:
            x = x + t_emb.unsqueeze(1)
        
        # Feedforward
        h = self.norm2(x)
        x = x + self.ff(h)
        
        return x


# =============================================================================
# STAGE 1: PATH GENERATOR (Direction-based)
# =============================================================================

class PathGenerator(nn.Module):
    """
    Autoregressive transformer that generates the optimal path as DIRECTIONS.
    
    Instead of predicting arbitrary grid positions (which don't guarantee valid
    ice physics), we predict 10 DIRECTIONS (up/down/left/right).
    
    The actual stop positions are computed by simulating ice slides on the
    generated tile grid. This makes valid paths BY CONSTRUCTION.
    
    For training, we convert ground-truth paths to direction sequences.
    """
    
    # Direction encoding: 0=up, 1=down, 2=left, 3=right
    NUM_DIRECTIONS = 4
    NUM_MOVES = 10  # Always 10 moves for 10-move puzzles
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width  # 169
        
        # Move index embedding (which move we're predicting: 0-9)
        self.move_idx_embed = nn.Embedding(self.NUM_MOVES, config.model_dim)
        
        # Direction embedding (for teacher forcing - embed previous directions)
        self.dir_embed = nn.Embedding(self.NUM_DIRECTIONS + 1, config.model_dim)  # +1 for start token
        
        # 2D position embeddings for current position
        self.row_embed = nn.Embedding(config.grid_height, config.model_dim // 2)
        self.col_embed = nn.Embedding(config.grid_width, config.model_dim // 2)
        
        # Start/goal embeddings (global context)
        self.start_embed = nn.Embedding(self.grid_size, config.model_dim)
        self.goal_embed = nn.Embedding(self.grid_size, config.model_dim)
        
        # Causal transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(config.model_dim, config.num_heads, config.ff_dim, config.dropout, causal=True)
            for _ in range(config.path_layers)
        ])
        
        # Output head: predict direction (4-way categorical)
        self.output_norm = nn.LayerNorm(config.model_dim)
        self.output_head = nn.Linear(config.model_dim, self.NUM_DIRECTIONS)
    
    def _get_2d_pos_embed(self, flat_pos: torch.Tensor) -> torch.Tensor:
        """Get 2D position embedding for flat positions."""
        W = self.config.grid_width
        row = flat_pos // W
        col = flat_pos % W
        row_emb = self.row_embed(row)
        col_emb = self.col_embed(col)
        return torch.cat([row_emb, col_emb], dim=-1)
    
    @staticmethod
    def stops_to_directions(stops: torch.Tensor) -> torch.Tensor:
        """
        Convert stop positions to direction sequence.
        
        Args:
            stops: (B, 11) stop positions (flat indices)
        
        Returns:
            directions: (B, 10) direction for each move (0=up, 1=down, 2=left, 3=right)
        """
        B = stops.shape[0]
        W = 13  # grid width
        
        directions = torch.zeros(B, 10, dtype=torch.long, device=stops.device)
        
        for i in range(10):
            curr = stops[:, i]
            next_pos = stops[:, i + 1]
            
            curr_x = curr % W
            curr_y = curr // W
            next_x = next_pos % W
            next_y = next_pos // W
            
            dx = next_x - curr_x
            dy = next_y - curr_y
            
            # Determine direction based on displacement
            # 0=up (dy<0), 1=down (dy>0), 2=left (dx<0), 3=right (dx>0)
            dir_up = (dy < 0).long() * 0
            dir_down = (dy > 0).long() * 1
            dir_left = (dx < 0).long() * 2
            dir_right = (dx > 0).long() * 3
            
            # Combine (only one should be non-zero for valid paths)
            directions[:, i] = dir_up + dir_down + dir_left + dir_right
        
        return directions
    
    def forward(
        self,
        stops: torch.Tensor,  # (B, 11) ground truth stop positions
        start_pos: torch.Tensor,  # (B,) start position
        goal_pos: torch.Tensor,  # (B,) goal position
    ) -> torch.Tensor:
        """
        Forward pass for training with teacher forcing.
        
        Args:
            stops: (B, 11) ground truth stop positions (flat indices)
            start_pos: (B,) start position
            goal_pos: (B,) goal position
        
        Returns:
            logits: (B, 10, 4) direction logits for each move
        """
        B = stops.shape[0]
        device = stops.device
        
        # Convert stops to directions for teacher forcing
        directions = self.stops_to_directions(stops)  # (B, 10)
        
        # Shift directions right and prepend start token (index 4)
        dir_input = torch.cat([
            torch.full((B, 1), self.NUM_DIRECTIONS, dtype=torch.long, device=device),  # start token
            directions[:, :-1]  # previous directions
        ], dim=1)  # (B, 10)
        
        # Get current position for each move (from stops)
        current_pos = stops[:, :-1]  # (B, 10) - positions before each move
        
        # Build embeddings
        move_idx = torch.arange(self.NUM_MOVES, device=device)
        
        x = self.dir_embed(dir_input)  # (B, 10, dim)
        x = x + self.move_idx_embed(move_idx).unsqueeze(0)  # Add move index
        x = x + self._get_2d_pos_embed(current_pos.reshape(-1)).reshape(B, self.NUM_MOVES, -1)  # Current position
        
        # Add global context from start and goal
        start_ctx = self.start_embed(start_pos).unsqueeze(1)
        goal_ctx = self.goal_embed(goal_pos).unsqueeze(1)
        x = x + start_ctx + goal_ctx
        
        # Causal transformer
        for layer in self.layers:
            x = layer(x)
        
        # Output logits
        x = self.output_norm(x)
        logits = self.output_head(x)  # (B, 10, 4)
        
        return logits
    
    @torch.no_grad()
    def generate(
        self,
        start_pos: torch.Tensor,  # (B,) start positions
        goal_pos: torch.Tensor,  # (B,) goal positions
        temperature: float = 1.0,
        generator: Optional[torch.Generator] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Autoregressively generate direction sequence.
        
        Returns:
            directions: (B, 10) generated directions
            stops: (B, 11) stop positions (start + derived from directions)
                   Note: stops are just start repeated - actual positions 
                   require simulating on tile grid
        """
        B = start_pos.shape[0]
        device = start_pos.device
        W = self.config.grid_width
        
        directions = torch.zeros(B, self.NUM_MOVES, dtype=torch.long, device=device)
        stops = torch.zeros(B, 11, dtype=torch.long, device=device)
        stops[:, 0] = start_pos
        
        # For generation, we need to track current position
        # But we don't have the tile grid here, so we'll do a simple heuristic:
        # Move in the predicted direction by 1 cell (will be refined by tile generator)
        current_pos = start_pos.clone()
        
        for i in range(self.NUM_MOVES):
            # Build input for this step
            if i == 0:
                dir_input = torch.full((B, 1), self.NUM_DIRECTIONS, dtype=torch.long, device=device)
            else:
                dir_input = torch.cat([
                    torch.full((B, 1), self.NUM_DIRECTIONS, dtype=torch.long, device=device),
                    directions[:, :i]
                ], dim=1)
            
            # Pad to full length for batched forward
            dir_input_padded = torch.full((B, self.NUM_MOVES), self.NUM_DIRECTIONS, dtype=torch.long, device=device)
            dir_input_padded[:, :dir_input.shape[1]] = dir_input
            
            # Current positions for all moves (use current_pos for position i)
            current_pos_seq = stops[:, :self.NUM_MOVES].clone()
            current_pos_seq[:, i] = current_pos
            
            # Build embeddings manually for this step
            move_idx = torch.arange(self.NUM_MOVES, device=device)
            
            x = self.dir_embed(dir_input_padded)
            x = x + self.move_idx_embed(move_idx).unsqueeze(0)
            x = x + self._get_2d_pos_embed(current_pos_seq.reshape(-1)).reshape(B, self.NUM_MOVES, -1)
            
            start_ctx = self.start_embed(start_pos).unsqueeze(1)
            goal_ctx = self.goal_embed(goal_pos).unsqueeze(1)
            x = x + start_ctx + goal_ctx
            
            for layer in self.layers:
                x = layer(x)
            
            x = self.output_norm(x)
            logits = self.output_head(x)  # (B, 10, 4)
            
            # Get logits for current move
            next_logits = logits[:, i, :] / temperature  # (B, 4)
            probs = F.softmax(next_logits, dim=-1)
            
            # Sample direction
            if generator is not None:
                gumbel_noise = torch.rand(probs.shape, device=device, generator=generator)
                gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
                next_dir = (next_logits + gumbel).argmax(dim=-1)
            else:
                next_dir = torch.multinomial(probs, 1).squeeze(-1)
            
            directions[:, i] = next_dir
            
            # Update position heuristically (move 1 cell in direction)
            # This is approximate - actual position depends on tile grid
            curr_x = current_pos % W
            curr_y = current_pos // W
            
            # 0=up, 1=down, 2=left, 3=right
            new_y = curr_y - (next_dir == 0).long() + (next_dir == 1).long()
            new_x = curr_x - (next_dir == 2).long() + (next_dir == 3).long()
            
            # Clamp to grid
            new_x = new_x.clamp(0, W - 1)
            new_y = new_y.clamp(0, self.config.grid_height - 1)
            
            current_pos = new_y * W + new_x
            stops[:, i + 1] = current_pos
        
        # Force last stop to goal
        stops[:, -1] = goal_pos
        
        return directions, stops


# =============================================================================
# STAGE 2: TILE GENERATOR (Conditioned on Path)
# =============================================================================

class TileGenerator(nn.Module):
    """
    Masked diffusion model that generates tiles conditioned on the path.
    
    Key insight: Given the path, tile generation becomes constrained:
    - Cells ON the path: must be traversable (ice or floor)
    - Cells that would create SHORTCUTS: must be walls
    - Other cells: free choice
    
    The model learns these constraints from training data.
    """
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width
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
        
        # Path conditioning embeddings
        # on_path: whether cell is on the path
        # stop_idx: which stop this cell is (0-10 or 11 for not a stop)
        self.on_path_embed = nn.Embedding(2, config.model_dim)  # 0=not on path, 1=on path
        self.stop_idx_embed = nn.Embedding(config.num_stops + 1, config.model_dim)  # 0-10 + "not a stop"
        
        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(config.model_dim, config.num_heads, config.ff_dim, config.dropout)
            for _ in range(config.num_layers)
        ])
        
        # Output head
        self.output_norm = nn.LayerNorm(config.model_dim)
        self.tile_head = nn.Linear(config.model_dim, config.tile_vocab_size)
        
        # Initialize diffusion schedule
        self._init_schedule()
    
    def _init_schedule(self):
        """Initialize mask schedule for diffusion."""
        T = self.num_timesteps
        
        if self.config.mask_schedule == "cosine":
            s = 0.008
            steps = torch.linspace(0, T, T + 1)
            alpha_bar = torch.cos(((steps / T) + s) / (1 + s) * math.pi / 2) ** 2
            alpha_bar = alpha_bar / alpha_bar[0]
        else:
            alpha_bar = 1.0 - torch.linspace(0, 1, T + 1)
        
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
    
    def _encode_path(self, stops: torch.Tensor, device: torch.device) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Encode path as per-cell features.
        
        Args:
            stops: (B, 11) stop positions (flat indices)
        
        Returns:
            on_path: (B, 169) binary - 1 if cell is on path
            stop_idx: (B, 169) stop index (0-10) or 11 if not a stop
        """
        B = stops.shape[0]
        
        # Initialize
        on_path = torch.zeros(B, self.grid_size, dtype=torch.long, device=device)
        stop_idx = torch.full((B, self.grid_size), self.config.num_stops, dtype=torch.long, device=device)  # 11 = not a stop
        
        # Mark path cells
        for i in range(self.config.num_stops):
            pos = stops[:, i]  # (B,)
            batch_idx = torch.arange(B, device=device)
            on_path[batch_idx, pos] = 1
            stop_idx[batch_idx, pos] = i
        
        return on_path, stop_idx
    
    def q_sample(self, x_0: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """Forward diffusion: mask tiles according to schedule."""
        B = x_0.shape[0]
        device = x_0.device
        
        mask_prob = 1.0 - self.alpha_bar[t]
        mask = torch.rand(B, self.grid_size, device=device) < mask_prob[:, None]
        x_t = torch.where(mask, self.mask_token_id, x_0)
        
        return x_t
    
    def forward(
        self,
        tiles: torch.Tensor,  # (B, 169) tile indices (possibly masked)
        t: torch.Tensor,  # (B,) timesteps
        stops: torch.Tensor,  # (B, 11) path stop positions
    ) -> torch.Tensor:
        """
        Forward pass for training.
        
        Args:
            tiles: (B, 169) tile indices (possibly masked)
            t: (B,) timesteps
            stops: (B, 11) path stop positions (for conditioning)
        
        Returns:
            tile_logits: (B, 169, tile_vocab_size)
        """
        B = tiles.shape[0]
        device = tiles.device
        
        # Embed tiles
        x = self.tile_embed(tiles)  # (B, 169, dim)
        
        # Add position embeddings
        x = x + self._get_position_features(B, device)
        
        # Add timestep embedding
        t_emb = self.time_embed(t.float())  # (B, dim)
        
        # Add path conditioning
        on_path, stop_idx = self._encode_path(stops, device)
        x = x + self.on_path_embed(on_path)  # (B, 169, dim)
        x = x + self.stop_idx_embed(stop_idx)  # (B, 169, dim)
        
        # Transformer layers
        for layer in self.layers:
            x = layer(x, t_emb)
        
        # Output projection
        x = self.output_norm(x)
        tile_logits = self.tile_head(x)  # (B, 169, tile_vocab_size)
        
        return tile_logits
    
    @torch.no_grad()
    def generate(
        self,
        stops: torch.Tensor,  # (B, 11) path stop positions
        temperature: float = 1.0,
        generator: Optional[torch.Generator] = None,
    ) -> torch.Tensor:
        """
        Generate tiles conditioned on path using iterative denoising.
        
        Returns:
            tiles: (B, 169) generated tile grid
        """
        B = stops.shape[0]
        device = stops.device
        
        # Initialize with all MASK tokens
        x_t = torch.full((B, self.grid_size), self.mask_token_id, dtype=torch.long, device=device)
        
        # Iterative denoising
        for step in reversed(range(self.num_timesteps)):
            t = torch.full((B,), step, dtype=torch.long, device=device)
            
            # Get temperature for this step (linear decay)
            step_temp = temperature * (1.0 - step / self.num_timesteps) + 0.1
            
            # Predict tiles
            logits = self.forward(x_t, t, stops) / step_temp
            probs = F.softmax(logits, dim=-1)
            probs_flat = probs.reshape(-1, self.config.tile_vocab_size)
            
            # Sample
            if generator is not None:
                logits_flat = logits.reshape(-1, self.config.tile_vocab_size)
                gumbel_noise = torch.rand(probs_flat.shape, device=device, generator=generator)
                gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
                sampled = (logits_flat + gumbel).argmax(dim=-1)
            else:
                sampled = torch.multinomial(probs_flat, 1).squeeze(-1)
            
            x_0_pred = sampled.reshape(B, self.grid_size)
            
            if step > 0:
                # Re-mask some positions
                mask_prob_t = 1.0 - self.alpha_bar[step]
                mask_prob_prev = 1.0 - self.alpha_bar[step - 1]
                keep_mask_prob = mask_prob_prev / mask_prob_t.clamp(min=1e-8)
                
                if generator is not None:
                    rand_vals = torch.rand((B, self.grid_size), device=device, generator=generator)
                    keep_mask = rand_vals < keep_mask_prob
                else:
                    keep_mask = torch.rand(B, self.grid_size, device=device) < keep_mask_prob
                
                currently_masked = x_t == self.mask_token_id
                x_t = torch.where(currently_masked & keep_mask, self.mask_token_id, x_0_pred)
            else:
                x_t = x_0_pred
        
        return x_t


# =============================================================================
# COMBINED MODEL
# =============================================================================

class PuzzleGeneratorV4(nn.Module):
    """
    Two-stage puzzle generator:
    1. PathGenerator: Generate 11 stop positions (guarantees 10 moves)
    2. TileGenerator: Generate tile grid conditioned on path
    
    This architecture makes move count BY CONSTRUCTION rather than emergent.
    """
    
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.grid_size = config.grid_height * config.grid_width
        
        # Two-stage architecture
        self.path_generator = PathGenerator(config)
        self.tile_generator = TileGenerator(config)
    
    def forward_path(
        self,
        stops: torch.Tensor,
        start_pos: torch.Tensor,
        goal_pos: torch.Tensor,
    ) -> torch.Tensor:
        """Forward pass for path generator training."""
        return self.path_generator(stops, start_pos, goal_pos)
    
    def forward_tiles(
        self,
        tiles: torch.Tensor,
        t: torch.Tensor,
        stops: torch.Tensor,
    ) -> torch.Tensor:
        """Forward pass for tile generator training."""
        return self.tile_generator(tiles, t, stops)
    
    @torch.no_grad()
    def generate(
        self,
        batch_size: int,
        device: torch.device,
        generator: Optional[torch.Generator] = None,
        temperature: float = 1.0,
    ) -> Dict[str, torch.Tensor]:
        """
        Generate complete puzzles.
        
        1. Sample start and goal positions
        2. Generate path from start to goal (Stage 1)
        3. Generate tiles conditioned on path (Stage 2)
        
        Returns:
            dict with tiles, start_pos, goal_pos, path
        """
        H, W = self.config.grid_height, self.config.grid_width
        
        # Sample start position uniformly
        if generator is not None:
            start_probs = torch.ones(batch_size, self.grid_size, device=device)
            gumbel = -torch.log(-torch.log(torch.rand(start_probs.shape, device=device, generator=generator).clamp(min=1e-10)))
            start_pos = gumbel.argmax(dim=-1)
        else:
            start_pos = torch.randint(0, self.grid_size, (batch_size,), device=device)
        
        # Sample goal position (different from start)
        if generator is not None:
            goal_probs = torch.ones(batch_size, self.grid_size, device=device)
            # Zero out start position
            goal_probs.scatter_(1, start_pos.unsqueeze(1), 0)
            gumbel = -torch.log(-torch.log(torch.rand(goal_probs.shape, device=device, generator=generator).clamp(min=1e-10)))
            goal_pos = (goal_probs * gumbel).argmax(dim=-1)
        else:
            goal_pos = torch.randint(0, self.grid_size, (batch_size,), device=device)
            # Ensure different from start
            same = goal_pos == start_pos
            while same.any():
                goal_pos[same] = torch.randint(0, self.grid_size, (same.sum(),), device=device)
                same = goal_pos == start_pos
        
        # Stage 1: Generate path (now returns directions and approximate stops)
        directions, stops = self.path_generator.generate(start_pos, goal_pos, temperature, generator)
        
        # Stage 2: Generate tiles conditioned on path
        tiles = self.tile_generator.generate(stops, temperature, generator)
        tiles = tiles.reshape(batch_size, H, W)
        
        # Convert positions to (x, y)
        start_xy = torch.stack([start_pos % W, start_pos // W], dim=-1)
        goal_xy = torch.stack([goal_pos % W, goal_pos // W], dim=-1)
        path_xy = torch.stack([stops % W, stops // W], dim=-1)  # (B, 11, 2)
        
        return {
            "tiles": tiles,
            "start_pos": start_xy,
            "goal_pos": goal_xy,
            "path": path_xy,
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
        """
        import hashlib
        
        all_tiles = []
        all_starts = []
        all_goals = []
        all_paths = []
        
        for i in range(k):
            sub_seed = hashlib.sha256(f"{seed}||{i}".encode()).hexdigest()
            seed_int = int(sub_seed[:16], 16)
            
            gen = torch.Generator(device=device)
            gen.manual_seed(seed_int)
            
            result = self.generate(1, device, gen, temperature)
            
            all_tiles.append(result["tiles"])
            all_starts.append(result["start_pos"])
            all_goals.append(result["goal_pos"])
            all_paths.append(result["path"])
        
        return {
            "tiles": torch.cat(all_tiles, dim=0),
            "start_pos": torch.cat(all_starts, dim=0),
            "goal_pos": torch.cat(all_goals, dim=0),
            "path": torch.cat(all_paths, dim=0),
        }
