from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from utils import seed_to_latent


@dataclass
class ModelConfig:
    latent_dim: int = 256
    cond_dim: int = 512
    model_dim: int = 256
    num_layers: int = 6
    num_heads: int = 8
    conv_blocks: int = 4
    mlp_ratio: int = 4
    dropout: float = 0.1
    coord_dim: int = 4
    size_scale: float = 15.0


def config_for_preset(name: str) -> ModelConfig:
    key = name.lower()
    if key == "base":
        return ModelConfig()
    if key == "large":
        return ModelConfig(
            latent_dim=384,
            cond_dim=768,
            model_dim=384,
            num_layers=8,
            num_heads=8,
            conv_blocks=6,
            mlp_ratio=4,
            dropout=0.1,
        )
    if key == "xl":
        return ModelConfig(
            latent_dim=512,
            cond_dim=1024,
            model_dim=512,
            num_layers=10,
            num_heads=8,
            conv_blocks=8,
            mlp_ratio=4,
            dropout=0.1,
        )
    raise ValueError(f"unknown preset: {name}")


_coord_cache: Dict[Tuple[int, int, torch.device, torch.dtype], torch.Tensor] = {}


def coord_grid(
    height: int, width: int, device: torch.device, dtype: torch.dtype
) -> torch.Tensor:
    key = (height, width, device, dtype)
    if key in _coord_cache:
        return _coord_cache[key]
    ys = torch.linspace(-1.0, 1.0, height, device=device, dtype=dtype)
    xs = torch.linspace(-1.0, 1.0, width, device=device, dtype=dtype)
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")
    coords = torch.stack([xx, yy, xx * xx, yy * yy], dim=-1)
    _coord_cache[key] = coords
    return coords


class FiLM(nn.Module):
    def __init__(self, cond_dim: int, channels: int):
        super().__init__()
        self.proj = nn.Linear(cond_dim, channels * 2)

    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        gamma, beta = self.proj(cond).chunk(2, dim=-1)
        while gamma.dim() < x.dim():
            gamma = gamma.unsqueeze(1)
            beta = beta.unsqueeze(1)
        return x * (1.0 + gamma) + beta


class TransformerBlock(nn.Module):
    def __init__(
        self,
        dim: int,
        heads: int,
        mlp_ratio: int,
        dropout: float,
        cond_dim: int,
    ):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(
            dim, heads, dropout=dropout, batch_first=True
        )
        self.norm2 = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(
            nn.Linear(dim, dim * mlp_ratio),
            nn.SiLU(),
            nn.Dropout(dropout),
            nn.Linear(dim * mlp_ratio, dim),
        )
        self.film = FiLM(cond_dim, dim)

    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        attn_in = self.norm1(x)
        attn_out, _ = self.attn(attn_in, attn_in, attn_in, need_weights=False)
        x = x + attn_out
        mlp_in = self.norm2(x)
        x = x + self.mlp(mlp_in)
        return self.film(x, cond)


class ConvResBlock(nn.Module):
    def __init__(self, channels: int, cond_dim: int):
        super().__init__()
        self.norm1 = nn.GroupNorm(8, channels)
        self.conv1 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.norm2 = nn.GroupNorm(8, channels)
        self.conv2 = nn.Conv2d(channels, channels, kernel_size=3, padding=1)
        self.film = FiLM(cond_dim, channels)

    def forward(self, x: torch.Tensor, cond: torch.Tensor) -> torch.Tensor:
        y = self.conv1(F.silu(self.norm1(x)))
        y = self.film(y, cond)
        y = self.conv2(F.silu(self.norm2(y)))
        return x + y


class MazleGeneratorModel(nn.Module):
    def __init__(self, tile_vocab_size: int, config: ModelConfig):
        super().__init__()
        self.config = config
        self.tile_vocab_size = tile_vocab_size

        self.cond_mlp = nn.Sequential(
            nn.Linear(config.latent_dim + 2, config.cond_dim),
            nn.SiLU(),
            nn.Linear(config.cond_dim, config.cond_dim),
        )

        self.coord_embed = nn.Linear(config.coord_dim, config.model_dim)

        self.transformer = nn.ModuleList(
            [
                TransformerBlock(
                    dim=config.model_dim,
                    heads=config.num_heads,
                    mlp_ratio=config.mlp_ratio,
                    dropout=config.dropout,
                    cond_dim=config.cond_dim,
                )
                for _ in range(config.num_layers)
            ]
        )

        self.conv_blocks = nn.ModuleList(
            [ConvResBlock(config.model_dim, config.cond_dim) for _ in range(config.conv_blocks)]
        )

        self.tile_head = nn.Conv2d(config.model_dim, tile_vocab_size, kernel_size=1)
        self.start_head = nn.Conv2d(config.model_dim, 1, kernel_size=1)
        self.goal_head = nn.Conv2d(config.model_dim, 1, kernel_size=1)

    def forward(
        self, latent: torch.Tensor, width: int, height: int
    ) -> Dict[str, torch.Tensor]:
        device = latent.device
        dtype = latent.dtype

        coords = coord_grid(height, width, device, dtype)
        coords = coords.view(1, height * width, self.config.coord_dim)
        coords = self.coord_embed(coords)

        size = torch.tensor(
            [[width / self.config.size_scale, height / self.config.size_scale]],
            device=device,
            dtype=dtype,
        ).repeat(latent.shape[0], 1)
        cond = self.cond_mlp(torch.cat([latent, size], dim=-1))

        tokens = coords.repeat(latent.shape[0], 1, 1)
        for block in self.transformer:
            tokens = block(tokens, cond)

        feat = tokens.transpose(1, 2).reshape(
            latent.shape[0], self.config.model_dim, height, width
        )
        for block in self.conv_blocks:
            feat = block(feat, cond)

        tile_logits = self.tile_head(feat)
        start_logits = self.start_head(feat)
        goal_logits = self.goal_head(feat)
        return {
            "tile_logits": tile_logits,
            "start_logits": start_logits,
            "goal_logits": goal_logits,
        }

    def latent_from_seeds(self, seeds: List[str], device: torch.device) -> torch.Tensor:
        latents = [seed_to_latent(seed, self.config.latent_dim, device=device) for seed in seeds]
        return torch.stack(latents, dim=0)
