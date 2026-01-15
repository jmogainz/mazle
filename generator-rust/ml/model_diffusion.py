"""
Discrete Diffusion Model for Puzzle Generation

Uses a U-Net style architecture with:
- 2D convolutions (treats grid as image)
- Discrete diffusion (categorical, not Gaussian)
- Forward process: gradually corrupt tiles toward uniform distribution
- Reverse process: denoise back to valid puzzle

Based on D3PM (Discrete Denoising Diffusion Probabilistic Models)
"""

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple
import hashlib

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class DiffusionConfig:
    """Configuration for discrete diffusion model."""
    vocab_size: int = 9  # Number of tile types
    latent_dim: int = 128  # Seed embedding dimension
    model_dim: int = 256  # Base channel dimension
    num_res_blocks: int = 3  # Residual blocks per resolution
    time_embed_dim: int = 256  # Time step embedding dimension
    num_timesteps: int = 100  # Diffusion steps
    grid_height: int = 13
    grid_width: int = 13


def diffusion_config_for_preset(preset: str) -> DiffusionConfig:
    """Get config for a preset size."""
    if preset == "small":
        return DiffusionConfig(model_dim=128, num_res_blocks=2)
    elif preset == "base":
        return DiffusionConfig(model_dim=256, num_res_blocks=3)
    elif preset == "large":
        return DiffusionConfig(model_dim=384, num_res_blocks=4)
    else:
        raise ValueError(f"Unknown preset: {preset}")


class SinusoidalTimeEmbedding(nn.Module):
    """Sinusoidal embeddings for diffusion timestep."""
    
    def __init__(self, dim: int):
        super().__init__()
        self.dim = dim
    
    def forward(self, t: torch.Tensor) -> torch.Tensor:
        """
        Args:
            t: (B,) timesteps in [0, num_timesteps)
        Returns:
            (B, dim) embeddings
        """
        device = t.device
        half_dim = self.dim // 2
        emb = math.log(10000) / (half_dim - 1)
        emb = torch.exp(torch.arange(half_dim, device=device) * -emb)
        emb = t[:, None].float() * emb[None, :]
        emb = torch.cat([torch.sin(emb), torch.cos(emb)], dim=-1)
        return emb


class ResBlock(nn.Module):
    """Residual block with time conditioning."""
    
    def __init__(self, channels: int, time_dim: int, dropout: float = 0.1):
        super().__init__()
        self.norm1 = nn.GroupNorm(8, channels)
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.time_mlp = nn.Linear(time_dim, channels)
        self.norm2 = nn.GroupNorm(8, channels)
        self.dropout = nn.Dropout(dropout)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)
    
    def forward(self, x: torch.Tensor, t_emb: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: (B, C, H, W) feature map
            t_emb: (B, time_dim) time embedding
        """
        h = self.norm1(x)
        h = F.silu(h)
        h = self.conv1(h)
        
        # Add time conditioning
        h = h + self.time_mlp(t_emb)[:, :, None, None]
        
        h = self.norm2(h)
        h = F.silu(h)
        h = self.dropout(h)
        h = self.conv2(h)
        
        return x + h


class DiscreteDiffusionModel(nn.Module):
    """
    Discrete diffusion model for tile grids.
    
    Uses absorbing state diffusion: tiles gradually get "masked" during forward process,
    and model learns to predict original tile from masked state.
    """
    
    def __init__(self, config: DiffusionConfig):
        super().__init__()
        self.config = config
        self.vocab_size = config.vocab_size
        self.num_timesteps = config.num_timesteps
        
        # MASK token is an extra token for the absorbing state
        self.mask_token_id = config.vocab_size
        self.full_vocab_size = config.vocab_size + 1  # +1 for MASK
        
        # Tile embedding (input)
        self.tile_embed = nn.Embedding(self.full_vocab_size, config.model_dim)
        
        # Seed conditioning
        self.seed_proj = nn.Sequential(
            nn.Linear(config.latent_dim, config.model_dim),
            nn.SiLU(),
            nn.Linear(config.model_dim, config.model_dim),
        )
        
        # Time embedding
        self.time_embed = nn.Sequential(
            SinusoidalTimeEmbedding(config.time_embed_dim),
            nn.Linear(config.time_embed_dim, config.time_embed_dim),
            nn.SiLU(),
            nn.Linear(config.time_embed_dim, config.time_embed_dim),
        )
        
        # U-Net encoder
        self.input_conv = nn.Conv2d(config.model_dim, config.model_dim, 3, padding=1)
        
        self.encoder_blocks = nn.ModuleList()
        for _ in range(config.num_res_blocks):
            self.encoder_blocks.append(ResBlock(config.model_dim, config.time_embed_dim))
        
        # Middle blocks
        self.mid_block1 = ResBlock(config.model_dim, config.time_embed_dim)
        self.mid_block2 = ResBlock(config.model_dim, config.time_embed_dim)
        
        # U-Net decoder
        self.decoder_blocks = nn.ModuleList()
        for _ in range(config.num_res_blocks):
            self.decoder_blocks.append(ResBlock(config.model_dim, config.time_embed_dim))
        
        # Output projection to tile logits
        self.output_norm = nn.GroupNorm(8, config.model_dim)
        self.output_conv = nn.Conv2d(config.model_dim, config.vocab_size, 3, padding=1)
        
        # Precompute diffusion schedule (absorbing state)
        # beta[t] = probability of masking at step t
        # Using cosine schedule
        self._init_diffusion_schedule()
    
    def _init_diffusion_schedule(self):
        """Initialize absorbing state diffusion schedule."""
        T = self.num_timesteps
        
        # Cosine schedule for cumulative mask probability
        # alpha_bar[t] = probability of being unmasked at step t
        s = 0.008  # small offset to prevent singularities
        steps = torch.linspace(0, T, T + 1)
        alpha_bar = torch.cos(((steps / T) + s) / (1 + s) * math.pi / 2) ** 2
        alpha_bar = alpha_bar / alpha_bar[0]  # normalize
        
        # Probability of transitioning to MASK at step t given unmasked at t-1
        # q(x_t = MASK | x_{t-1} = unmasked) = 1 - alpha_bar[t] / alpha_bar[t-1]
        self.register_buffer("alpha_bar", alpha_bar[1:])  # (T,)
    
    def latent_from_seeds(self, seeds: list, device: torch.device) -> torch.Tensor:
        """Convert seed strings to latent vectors."""
        latents = []
        for seed in seeds:
            h = hashlib.sha256(seed.encode()).digest()
            vec = torch.tensor([float(b) / 255.0 for b in h[:self.config.latent_dim]], 
                             device=device)
            # Pad if needed
            if len(vec) < self.config.latent_dim:
                vec = F.pad(vec, (0, self.config.latent_dim - len(vec)))
            latents.append(vec)
        return torch.stack(latents)
    
    def q_sample(self, x_0: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """
        Forward process: corrupt x_0 to x_t by randomly masking tiles.
        
        Args:
            x_0: (B, H, W) original tiles
            t: (B,) timesteps
            
        Returns:
            x_t: (B, H, W) corrupted tiles (some replaced with MASK)
        """
        B = x_0.shape[0]
        device = x_0.device
        
        # Get mask probability for each sample based on timestep
        # alpha_bar[t] = prob of being unmasked
        mask_prob = 1.0 - self.alpha_bar[t]  # (B,)
        
        # Sample which positions to mask
        mask = torch.rand_like(x_0.float()) < mask_prob[:, None, None]
        
        # Replace masked positions with MASK token
        x_t = torch.where(mask, self.mask_token_id, x_0)
        
        return x_t
    
    def forward(
        self,
        x_t: torch.Tensor,
        t: torch.Tensor,
        latent: torch.Tensor,
    ) -> Dict[str, torch.Tensor]:
        """
        Predict original tiles x_0 from noisy x_t.
        
        Args:
            x_t: (B, H, W) corrupted tiles
            t: (B,) timesteps
            latent: (B, latent_dim) seed embedding
            
        Returns:
            logits: (B, vocab_size, H, W) predicted tile logits
        """
        B, H, W = x_t.shape
        
        # Embed tiles: (B, H, W) -> (B, H, W, model_dim) -> (B, model_dim, H, W)
        x = self.tile_embed(x_t)  # (B, H, W, model_dim)
        x = x.permute(0, 3, 1, 2)  # (B, model_dim, H, W)
        
        # Time embedding
        t_emb = self.time_embed(t)  # (B, time_embed_dim)
        
        # Seed conditioning - add to feature map
        seed_emb = self.seed_proj(latent)  # (B, model_dim)
        x = x + seed_emb[:, :, None, None]
        
        # U-Net forward
        x = self.input_conv(x)
        
        # Encoder
        skips = []
        for block in self.encoder_blocks:
            x = block(x, t_emb)
            skips.append(x)
        
        # Middle
        x = self.mid_block1(x, t_emb)
        x = self.mid_block2(x, t_emb)
        
        # Decoder with skip connections
        for block, skip in zip(self.decoder_blocks, reversed(skips)):
            x = x + skip
            x = block(x, t_emb)
        
        # Output
        x = self.output_norm(x)
        x = F.silu(x)
        logits = self.output_conv(x)  # (B, vocab_size, H, W)
        
        return {"logits": logits}
    
    @torch.no_grad()
    def generate(
        self,
        latent: torch.Tensor,
        temperature: float = 1.0,
    ) -> torch.Tensor:
        """
        Generate tiles by iterative denoising.
        
        Args:
            latent: (B, latent_dim) seed embeddings
            temperature: sampling temperature
            
        Returns:
            tiles: (B, H, W) generated tiles
        """
        B = latent.shape[0]
        device = latent.device
        H, W = self.config.grid_height, self.config.grid_width
        
        # Start with all MASK tokens
        x_t = torch.full((B, H, W), self.mask_token_id, dtype=torch.long, device=device)
        
        # Reverse diffusion
        for t in reversed(range(self.num_timesteps)):
            t_tensor = torch.full((B,), t, dtype=torch.long, device=device)
            
            # Predict x_0
            outputs = self.forward(x_t, t_tensor, latent)
            logits = outputs["logits"]  # (B, vocab_size, H, W)
            
            # Sample from predicted distribution
            logits = logits / temperature
            probs = F.softmax(logits, dim=1)  # (B, vocab_size, H, W)
            
            # Reshape for sampling: (B, H, W, vocab_size)
            probs = probs.permute(0, 2, 3, 1)
            probs_flat = probs.reshape(-1, self.vocab_size)
            
            # Sample tiles
            sampled = torch.multinomial(probs_flat, 1).squeeze(-1)
            x_0_pred = sampled.reshape(B, H, W)
            
            if t > 0:
                # Re-mask some positions for next step
                # Positions that should still be masked at t-1
                mask_prob_t = 1.0 - self.alpha_bar[t]
                mask_prob_t_minus_1 = 1.0 - self.alpha_bar[t - 1]
                
                # Which positions to keep masked
                keep_mask_prob = mask_prob_t_minus_1 / mask_prob_t.clamp(min=1e-8)
                keep_mask = torch.rand(B, H, W, device=device) < keep_mask_prob
                
                # Only apply to currently masked positions
                currently_masked = x_t == self.mask_token_id
                x_t = torch.where(currently_masked & keep_mask, self.mask_token_id, x_0_pred)
            else:
                x_t = x_0_pred
        
        return x_t
