"""Autoregressive transformer for puzzle grid generation.

The model predicts tiles sequentially in raster order (left-to-right, top-to-bottom).
Each tile prediction is conditioned on:
1. The seed (via latent embedding)
2. All previously placed tiles
3. The 2D position being predicted

This allows the model to learn constraints like "exactly 1 START" naturally.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from utils import seed_to_latent


@dataclass
class ARModelConfig:
    """Configuration for autoregressive puzzle generator."""
    latent_dim: int = 256
    model_dim: int = 256
    num_layers: int = 8
    num_heads: int = 8
    mlp_ratio: int = 4
    dropout: float = 0.1
    max_seq_len: int = 169  # 13x13


def ar_config_for_preset(name: str) -> ARModelConfig:
    key = name.lower()
    if key == "base":
        return ARModelConfig()
    if key == "large":
        return ARModelConfig(
            latent_dim=384,
            model_dim=384,
            num_layers=12,
            num_heads=8,
            mlp_ratio=4,
            dropout=0.1,
        )
    if key == "xl":
        return ARModelConfig(
            latent_dim=512,
            model_dim=512,
            num_layers=16,
            num_heads=8,
            mlp_ratio=4,
            dropout=0.1,
        )
    raise ValueError(f"unknown preset: {name}")


class CausalSelfAttention(nn.Module):
    """Multi-head self-attention with causal masking."""

    def __init__(self, dim: int, num_heads: int, dropout: float = 0.1):
        super().__init__()
        assert dim % num_heads == 0
        self.num_heads = num_heads
        self.head_dim = dim // num_heads
        self.scale = self.head_dim ** -0.5

        self.qkv = nn.Linear(dim, dim * 3)
        self.proj = nn.Linear(dim, dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        B, T, C = x.shape
        
        qkv = self.qkv(x).reshape(B, T, 3, self.num_heads, self.head_dim)
        qkv = qkv.permute(2, 0, 3, 1, 4)  # (3, B, heads, T, head_dim)
        q, k, v = qkv[0], qkv[1], qkv[2]

        attn = (q @ k.transpose(-2, -1)) * self.scale  # (B, heads, T, T)
        
        if mask is not None:
            attn = attn.masked_fill(mask == 0, float('-inf'))
        
        attn = F.softmax(attn, dim=-1)
        attn = self.dropout(attn)
        
        out = (attn @ v).transpose(1, 2).reshape(B, T, C)
        return self.proj(out)


class TransformerBlock(nn.Module):
    """Transformer block with causal attention."""

    def __init__(self, dim: int, num_heads: int, mlp_ratio: int, dropout: float):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = CausalSelfAttention(dim, num_heads, dropout)
        self.norm2 = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(
            nn.Linear(dim, dim * mlp_ratio),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(dim * mlp_ratio, dim),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        x = x + self.attn(self.norm1(x), mask)
        x = x + self.mlp(self.norm2(x))
        return x


class AutoregressivePuzzleModel(nn.Module):
    """
    Autoregressive transformer for puzzle grid generation.
    
    Input: seed string → latent vector
    Output: sequence of tile logits (169 positions for 13x13 grid)
    
    During training: teacher forcing (input is ground truth tiles shifted right)
    During inference: generate tile by tile, feeding each prediction back
    """

    def __init__(self, tile_vocab_size: int, config: ARModelConfig):
        super().__init__()
        self.config = config
        self.tile_vocab_size = tile_vocab_size

        # Tile embedding (input tokens)
        # +1 for BOS (beginning of sequence) token
        self.tile_embed = nn.Embedding(tile_vocab_size + 1, config.model_dim)
        self.bos_token_id = tile_vocab_size  # BOS is last token in extended vocab

        # 2D positional embeddings (learnable)
        # We encode (x, y) position for each of 169 grid positions
        self.pos_embed = nn.Parameter(torch.zeros(1, config.max_seq_len, config.model_dim))

        # Seed conditioning - project latent to model dim and add as prefix token
        self.seed_proj = nn.Linear(config.latent_dim, config.model_dim)

        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(
                dim=config.model_dim,
                num_heads=config.num_heads,
                mlp_ratio=config.mlp_ratio,
                dropout=config.dropout,
            )
            for _ in range(config.num_layers)
        ])

        self.norm = nn.LayerNorm(config.model_dim)
        self.head = nn.Linear(config.model_dim, tile_vocab_size)

        # Initialize positional embeddings with 2D structure
        self._init_pos_embed()

        # Causal mask cache
        self._causal_mask_cache: Dict[Tuple[int, torch.device], torch.Tensor] = {}

    def _init_pos_embed(self):
        """Initialize positional embeddings with 2D sinusoidal encoding."""
        seq_len = self.config.max_seq_len
        dim = self.config.model_dim
        
        # Assuming 13x13 grid
        height = width = int(math.sqrt(seq_len))
        
        pe = torch.zeros(seq_len, dim)
        for pos in range(seq_len):
            y, x = divmod(pos, width)
            for i in range(0, dim, 4):
                div_term = math.exp(-math.log(10000.0) * i / dim)
                pe[pos, i] = math.sin(x * div_term)
                pe[pos, i + 1] = math.cos(x * div_term)
                if i + 2 < dim:
                    pe[pos, i + 2] = math.sin(y * div_term)
                if i + 3 < dim:
                    pe[pos, i + 3] = math.cos(y * div_term)
        
        self.pos_embed.data.copy_(pe.unsqueeze(0))

    def _get_causal_mask(self, seq_len: int, device: torch.device) -> torch.Tensor:
        """Get causal attention mask (lower triangular)."""
        key = (seq_len, device)
        if key not in self._causal_mask_cache:
            mask = torch.tril(torch.ones(seq_len, seq_len, device=device))
            self._causal_mask_cache[key] = mask
        return self._causal_mask_cache[key]

    def forward(
        self,
        latent: torch.Tensor,
        tiles: Optional[torch.Tensor] = None,
        width: int = 13,
        height: int = 13,
        sample_prob: float = 0.0,
    ) -> Dict[str, torch.Tensor]:
        """
        Forward pass for training with optional scheduled sampling.
        
        Args:
            latent: (B, latent_dim) seed embedding
            tiles: (B, H, W) ground truth tiles for teacher forcing
            width, height: grid dimensions
            sample_prob: probability of using model's own prediction instead of ground truth
                         0.0 = pure teacher forcing, 1.0 = pure autoregressive
            
        Returns:
            tile_logits: (B, seq_len, vocab_size) logits for each position
        """
        B = latent.shape[0]
        device = latent.device
        seq_len = width * height

        if tiles is not None and sample_prob > 0.0:
            # Scheduled sampling: mix ground truth with model's own predictions
            tiles_seq = tiles.view(B, -1)  # (B, seq_len)
            
            # Start with BOS token
            bos = torch.full((B, 1), self.bos_token_id, dtype=torch.long, device=device)
            
            # Precompute seed embedding
            seed_emb = self.seed_proj(latent)  # (B, model_dim)
            
            # Build input sequence step by step
            all_logits = []
            input_tokens = bos  # Start with just BOS
            
            for pos in range(seq_len):
                # Embed current sequence
                x = self.tile_embed(input_tokens)
                x = x + self.pos_embed[:, :x.shape[1], :]
                x = x + seed_emb.unsqueeze(1)
                
                mask = self._get_causal_mask(x.shape[1], device)
                for layer in self.layers:
                    x = layer(x, mask)
                
                x = self.norm(x)
                logits = self.head(x[:, -1:, :])  # (B, 1, vocab_size)
                all_logits.append(logits)
                
                # Decide next input: ground truth or sampled
                if pos < seq_len - 1:  # Don't need next token after last position
                    use_sample = torch.rand(B, device=device) < sample_prob
                    sampled = torch.multinomial(F.softmax(logits.squeeze(1), dim=-1), 1)  # (B, 1)
                    gt_token = tiles_seq[:, pos:pos+1]  # (B, 1)
                    next_token = torch.where(use_sample.unsqueeze(1), sampled, gt_token)
                    input_tokens = torch.cat([input_tokens, next_token], dim=1)
            
            logits = torch.cat(all_logits, dim=1)  # (B, seq_len, vocab_size)
            return {"tile_logits": logits}
        
        # Standard teacher forcing (sample_prob == 0)
        if tiles is not None:
            tiles_seq = tiles.view(B, -1)  # (B, seq_len)
            # Shift right and prepend BOS token
            bos = torch.full((B, 1), self.bos_token_id, dtype=torch.long, device=device)
            input_seq = torch.cat([bos, tiles_seq[:, :-1]], dim=1)  # (B, seq_len)
        else:
            # Inference mode: just BOS token (will generate autoregressively)
            input_seq = torch.full((B, 1), self.bos_token_id, dtype=torch.long, device=device)

        # Embed input tiles
        x = self.tile_embed(input_seq)  # (B, seq_len, model_dim)

        # Add positional embeddings
        x = x + self.pos_embed[:, :x.shape[1], :]

        # Add seed conditioning as bias to all positions
        seed_emb = self.seed_proj(latent)  # (B, model_dim)
        x = x + seed_emb.unsqueeze(1)  # broadcast to all positions

        # Causal mask
        mask = self._get_causal_mask(x.shape[1], device)

        # Transformer layers
        for layer in self.layers:
            x = layer(x, mask)

        x = self.norm(x)
        logits = self.head(x)  # (B, seq_len, vocab_size)

        return {"tile_logits": logits}

    @torch.no_grad()
    def generate(
        self,
        latent: torch.Tensor,
        width: int = 13,
        height: int = 13,
        temperature: float = 1.0,
        top_k: Optional[int] = None,
    ) -> torch.Tensor:
        """
        Autoregressive generation.
        
        Args:
            latent: (B, latent_dim) seed embedding
            width, height: grid dimensions
            temperature: sampling temperature (1.0 = neutral, <1 = more deterministic)
            top_k: if set, sample from top-k most likely tokens
            
        Returns:
            tiles: (B, H, W) generated tile grid
        """
        B = latent.shape[0]
        device = latent.device
        seq_len = width * height

        # Start with BOS token
        generated = torch.full((B, 1), self.bos_token_id, dtype=torch.long, device=device)

        # Precompute seed embedding
        seed_emb = self.seed_proj(latent)  # (B, model_dim)

        for pos in range(seq_len):
            # Embed current sequence
            x = self.tile_embed(generated)  # (B, pos+1, model_dim)
            
            # Add positional embeddings
            x = x + self.pos_embed[:, :x.shape[1], :]
            
            # Add seed conditioning
            x = x + seed_emb.unsqueeze(1)

            # Causal mask
            mask = self._get_causal_mask(x.shape[1], device)

            # Forward through transformer
            for layer in self.layers:
                x = layer(x, mask)

            x = self.norm(x)
            logits = self.head(x[:, -1, :])  # (B, vocab_size) - last position only

            # Apply temperature
            logits = logits / temperature

            # Optional top-k sampling
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = float('-inf')

            # Sample next token
            probs = F.softmax(logits, dim=-1)
            next_token = torch.multinomial(probs, num_samples=1)  # (B, 1)

            generated = torch.cat([generated, next_token], dim=1)

        # Remove BOS token and reshape to grid
        tiles = generated[:, 1:].view(B, height, width)
        return tiles

    def latent_from_seeds(self, seeds: List[str], device: torch.device) -> torch.Tensor:
        """Convert seed strings to latent vectors."""
        latents = [seed_to_latent(seed, self.config.latent_dim, device=device) for seed in seeds]
        return torch.stack(latents, dim=0)
