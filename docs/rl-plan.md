# Mazle RL Generator Plan (Deterministic, Seeded, One‑Shot)

This document captures the agreed plan for a deterministic RL-based maze generator that will eventually replace the current heuristic generator. Scope here is **ice-only** and **15×15**.

## Goals
- Deterministic 1:1 replacement for current generator.
- Policy generates **entire grid in one inference** from a seed.
- Learns difficulty from **human gameplay** (controlled training by the developer).
- Reward aligns with game scoring: **wall‑clock time + lives used**.

## Deterministic Policy Contract
**Observation**
- `seed` (deterministic input)
- `width`, `height` (fixed to 15×15 for now, included for future expansion)

**Output**
- Interior grid logits: **13×13×K** (K = tile vocab excluding start/goal)
- Separate heads for **start** and **goal** positions (13×13 logits each)
- Post-process: wrap with a single‑tile **wall border** to produce 15×15

**Determinism**
- Seed → fixed latent vector (hash/PRNG)
- Inference uses **argmax** per cell/head
- If invalid, deterministically retry using `seed + attempt_index` (still reproducible)

## Start/Goal Handling
- Start and goal are learned as **separate heads**, not as tile classes.
- During dataset creation: strip start/goal from tiles (replace with Ice).
- This enforces **exactly one** start and goal via argmax over positions.

## Reward (No DNF)
- No DNF concept for training mode.
- **Reward = rawWallClockMs + (livesUsed × 30,000 ms)**
- Penalty time is **excluded** (we log raw time and lives separately so weights can be adjusted later).
- “Reject” in training mode = worst possible reward.

## Training Mode (Frontend)
Separate training mode with controls:
- **Accept + Train** (log and train)
- **Reject** (worst reward, log)
- **Cancel** (no log, no train)
- **Regenerate** (new episode)

Telemetry fields to log per episode:
- `seed`, `width`, `height`, `mapType`
- `tilesInterior` (13×13)
- `start`, `goal`
- `rawTimeMs`, `livesUsed`
- `rejected`, `timestamp`, `modelVersion`, `puzzleHash`

## Dataset Generation (Imitation Pretrain)
Use the **existing Rust generator** to bootstrap a large supervised dataset.

**Mode**: backend dataset writer (env‑gated)
- `DATASET_OUT=/path/train.jsonl`
- `DATASET_COUNT=50000`
- `DATASET_SEED_PREFIX=train`
- `DATASET_MAP_TYPE=ice`
- `DATASET_SIZE=15`

**JSONL schema (one line per puzzle):**
```
{
  "seed": "train-000001",
  "width": 15,
  "height": 15,
  "mapType": "ice",
  "tilesInterior": [[...13×13...]],
  "start": {"x": 3, "y": 10},
  "goal": {"x": 11, "y": 2}
}
```

## Pretrain → RL Fine‑Tune
**Imitation Pretrain**
- Supervised cross‑entropy on tiles, start, goal.
- Target: stable, mostly valid layouts before RL.

**RL Fine‑Tune**
- REINFORCE (single‑step policy gradient) using gameplay reward.
- Invalid puzzles → reject (worst reward).
- Deterministic inference uses argmax; training uses sampling.

## Model Architecture (Minimal, CNN)
- Small CNN/ResNet/U‑Net (0.3–1.0M params)
- Fully‑convolutional to allow future size expansion
- Seed/size embedding injected via broadcast/FiLM
- Heads:
  - tile logits (13×13×K)
  - start logits (13×13)
  - goal logits (13×13)

## ONNX Inference
- Export trained model to **ONNX** for Rust inference.
- Client‑side inference is possible via **onnxruntime‑web** (WASM for determinism).
- Production integration with WASM fallback is out of scope for now.

## Validation (Rust)
Use existing solver and checks:
- solvable
- unique optimal path
- exact optimal move count

Invalid outputs are rejected (training) or deterministically retried (inference).

## Future Expansion (Not Yet Implemented)
- Variable maze sizes via `width/height` conditioning
- Additional obstacles via expanded tile vocab
- Optional difficulty conditioning

