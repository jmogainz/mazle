from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import torch
from torch.utils.data import IterableDataset

from utils import split_seed

try:
    import orjson as _json  # type: ignore

    def _loads(line: str) -> Dict:
        return _json.loads(line)

except Exception:

    def _loads(line: str) -> Dict:
        return json.loads(line)


@dataclass(frozen=True)
class TileVocab:
    tile_ids: List[int]

    def __post_init__(self) -> None:
        if len(set(self.tile_ids)) != len(self.tile_ids):
            raise ValueError("tile_ids contains duplicates")
        if not self.tile_ids:
            raise ValueError("tile_ids cannot be empty")

    @property
    def size(self) -> int:
        return len(self.tile_ids)

    def build_lookup(self) -> List[int]:
        lookup = [-1] * 256
        for idx, tile_id in enumerate(self.tile_ids):
            if tile_id < 0 or tile_id >= 256:
                raise ValueError(f"tile id out of range: {tile_id}")
            lookup[tile_id] = idx
        return lookup

    def encode_grid(self, grid: List[List[int]]) -> List[List[int]]:
        lookup = self.build_lookup()
        out: List[List[int]] = []
        for row in grid:
            out.append([lookup[val] for val in row])
        if any(val < 0 for row in out for val in row):
            unknown = sorted({v for row in grid for v in row if lookup[v] < 0})
            raise ValueError(f"unknown tile ids in dataset: {unknown}")
        return out

    def decode_grid(self, grid: List[List[int]]) -> List[List[int]]:
        return [[self.tile_ids[val] for val in row] for row in grid]


def collect_tile_ids(path: Path, max_lines: Optional[int] = None) -> List[int]:
    tile_ids = set()
    lines = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = _loads(line)
            for row in record["tilesInterior"]:
                tile_ids.update(row)
            lines += 1
            if max_lines is not None and lines >= max_lines:
                break
    return sorted(tile_ids)


class JsonlMazeDataset(IterableDataset):
    def __init__(
        self,
        path: Path,
        split: str = "train",
        val_pct: float = 0.02,
        test_pct: float = 0.0,
        shuffle_buffer: int = 0,
        shuffle_seed: int = 13,
        map_type: Optional[str] = None,
    ) -> None:
        super().__init__()
        self.path = path
        self.split = split
        self.val_pct = val_pct
        self.test_pct = test_pct
        self.shuffle_buffer = shuffle_buffer
        self.shuffle_seed = shuffle_seed
        self.map_type = map_type

    def _iter_records(self) -> Iterable[Dict]:
        rng = random.Random(self.shuffle_seed)
        buffer: List[Dict] = []
        with self.path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                record = _loads(line)
                if self.map_type and record.get("mapType") != self.map_type:
                    continue
                seed = record.get("seed", "")
                split = split_seed(seed, self.val_pct, self.test_pct)
                if self.split != split:
                    continue

                if self.shuffle_buffer > 0:
                    buffer.append(record)
                    if len(buffer) >= self.shuffle_buffer:
                        idx = rng.randrange(len(buffer))
                        yield buffer.pop(idx)
                else:
                    yield record

        if self.shuffle_buffer > 0:
            while buffer:
                idx = rng.randrange(len(buffer))
                yield buffer.pop(idx)

    def __iter__(self):
        for record in self._iter_records():
            yield record


def collate_batch(
    batch: List[Dict],
    vocab: TileVocab,
    device: torch.device,
):
    seeds = [item["seed"] for item in batch]
    widths = [item["width"] for item in batch]
    heights = [item["height"] for item in batch]
    tiles = [item["tilesInterior"] for item in batch]
    starts = [item["start"] for item in batch]
    goals = [item["goal"] for item in batch]

    h = len(tiles[0])
    w = len(tiles[0][0])

    tiles_idx = torch.empty((len(batch), h, w), dtype=torch.long)
    for i, grid in enumerate(tiles):
        tiles_idx[i] = torch.tensor(vocab.encode_grid(grid), dtype=torch.long)

    start_idx = torch.tensor(
        [s["y"] * w + s["x"] for s in starts], dtype=torch.long
    )
    goal_idx = torch.tensor([g["y"] * w + g["x"] for g in goals], dtype=torch.long)

    return {
        "seeds": seeds,
        "widths": torch.tensor(widths, dtype=torch.long),
        "heights": torch.tensor(heights, dtype=torch.long),
        "tiles": tiles_idx.to(device),
        "start_idx": start_idx.to(device),
        "goal_idx": goal_idx.to(device),
    }
