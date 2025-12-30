import hashlib
from typing import Optional

import torch


def hash_bytes(seed: str, n_bytes: int) -> bytes:
    if n_bytes <= 0:
        return b""
    out = bytearray()
    counter = 0
    seed_bytes = seed.encode("utf-8")
    while len(out) < n_bytes:
        h = hashlib.blake2b(digest_size=64)
        h.update(seed_bytes)
        h.update(counter.to_bytes(4, "little", signed=False))
        out.extend(h.digest())
        counter += 1
    return bytes(out[:n_bytes])


def seed_to_latent(
    seed: str,
    dim: int,
    device: Optional[torch.device] = None,
    dtype: torch.dtype = torch.float32,
) -> torch.Tensor:
    raw = hash_bytes(seed, dim * 2)
    vals = [0.0] * dim
    for i in range(dim):
        lo = raw[i * 2]
        hi = raw[i * 2 + 1]
        v = lo | (hi << 8)
        vals[i] = (v / 65535.0) * 2.0 - 1.0
    return torch.tensor(vals, dtype=dtype, device=device)


def seed_hash(seed: str) -> int:
    digest = hashlib.blake2b(seed.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "little", signed=False)


def split_seed(seed: str, val_pct: float, test_pct: float) -> str:
    if val_pct < 0.0 or test_pct < 0.0 or val_pct + test_pct >= 1.0:
        raise ValueError("val_pct + test_pct must be in [0, 1)")
    bucket = seed_hash(seed) % 10000
    test_cut = int(test_pct * 10000)
    val_cut = test_cut + int(val_pct * 10000)
    if bucket < test_cut:
        return "test"
    if bucket < val_cut:
        return "val"
    return "train"


def is_val_seed(seed: str, val_pct: float, test_pct: float = 0.0) -> bool:
    return split_seed(seed, val_pct, test_pct) == "val"


def select_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def configure_torch_for_perf(device: torch.device) -> None:
    if device.type == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
    torch.set_float32_matmul_precision("high")
