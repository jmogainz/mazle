#!/usr/bin/env python3
"""
Self-Play DPO Data Generator (Fixed)

Generate DPO pairs where BOTH winner and loser are model-generated.
This prevents the model from learning "real vs fake" artifacts.

Winner = puzzle that PASSES (10 moves, unique optimal, no stuck)
Loser = puzzle that FAILS (solvable but wrong move count, <8 moves)
"""

import argparse
import json
import random
import hashlib
from pathlib import Path

import torch
from tqdm import tqdm

from model_v2 import PuzzleGeneratorV2, config_for_preset

# Tile ID remapping (model uses 0-6, game uses 0,1,4,5,6,7,8)
TILE_REMAP = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}
TILE_REMAP_INV = {v: k for k, v in TILE_REMAP.items()}

def remap_tile_inv(idx: int) -> int:
    return TILE_REMAP_INV.get(idx, 4)

# Import Rust validator
try:
    from mazle_eval import validate_ice_interior
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False
    print("WARNING: Rust validator not available")


def validate_puzzle(tiles_flat, sx, sy, gx, gy):
    """Validate puzzle and return full result."""
    class Result:
        def __init__(self, solvable, optimal_moves, no_stuck, unique_optimal):
            self.solvable = solvable
            self.optimal_moves = optimal_moves
            self.no_stuck = no_stuck
            self.unique_optimal = unique_optimal
            # Full pass = 10 moves, unique optimal, no stuck
            self.full_pass = (solvable and optimal_moves == 10 and 
                            unique_optimal and no_stuck)
    
    try:
        H, W = 13, 13
        grid = []
        flat = tiles_flat.tolist() if hasattr(tiles_flat, 'tolist') else tiles_flat
        for y in range(H):
            row = []
            for x in range(W):
                idx = flat[y * W + x]
                row.append(remap_tile_inv(idx))
            grid.append(row)
        
        result = validate_ice_interior(grid, sx, sy, gx, gy, 10)
        return Result(result.solvable, result.optimal_moves, 
                     result.no_stuck, result.unique_optimal)
    except Exception as e:
        return Result(False, 0, False, False)


def tiles_to_interior(tiles_flat, H=13, W=13):
    """Convert flat tiles tensor to 2D interior grid."""
    grid = []
    flat = tiles_flat.tolist() if hasattr(tiles_flat, 'tolist') else tiles_flat
    for y in range(H):
        row = []
        for x in range(W):
            idx = flat[y * W + x]
            row.append(remap_tile_inv(idx))
        grid.append(row)
    return grid


def generate_puzzle(model, device, seed, temperature=1.0):
    """Generate a single puzzle and return it with validation."""
    seed_int = int(hashlib.sha256(seed.encode()).hexdigest()[:16], 16)
    gen = torch.Generator(device=device)
    gen.manual_seed(seed_int)
    
    # Initialize with MASK tokens
    x_t = torch.full((1, 169), model.mask_token_id, dtype=torch.long, device=device)
    
    # Random start/goal positions
    random.seed(seed_int)
    start_pos = random.randint(0, 168)
    goal_pos = random.randint(0, 168)
    while goal_pos == start_pos:
        goal_pos = random.randint(0, 168)
    
    start_pos_t = torch.tensor([start_pos], dtype=torch.long, device=device)
    goal_pos_t = torch.tensor([goal_pos], dtype=torch.long, device=device)
    
    # Iterative denoising
    with torch.no_grad():
        for step in reversed(range(model.num_timesteps)):
            t = torch.tensor([step], dtype=torch.long, device=device)
            outputs = model(x_t, t, start_pos_t, goal_pos_t)
            logits = outputs["tile_logits"] / temperature
            
            # Gumbel-max sampling
            gumbel_noise = torch.rand(logits.shape, device=device, generator=gen)
            gumbel = -torch.log(-torch.log(gumbel_noise.clamp(min=1e-10)))
            sampled = (logits + gumbel).argmax(dim=-1)
            
            if step > 0:
                mask_prob_t = 1.0 - model.alpha_bar[step]
                mask_prob_prev = 1.0 - model.alpha_bar[step - 1]
                keep_mask_prob = mask_prob_prev / mask_prob_t.clamp(min=1e-8)
                
                rand_vals = torch.rand((1, 169), device=device, generator=gen)
                keep_mask = rand_vals < keep_mask_prob
                currently_masked = x_t == model.mask_token_id
                x_t = torch.where(currently_masked & keep_mask, model.mask_token_id, sampled)
            else:
                x_t = sampled
    
    tiles_flat = x_t[0].cpu()
    sx, sy = start_pos % 13, start_pos // 13
    gx, gy = goal_pos % 13, goal_pos // 13
    
    # Validate
    vr = validate_puzzle(tiles_flat, sx, sy, gx, gy)
    
    return {
        "tiles_flat": tiles_flat,
        "start": {"x": sx, "y": sy},
        "goal": {"x": gx, "y": gy},
        "optimal_moves": vr.optimal_moves,
        "solvable": vr.solvable,
        "no_stuck": vr.no_stuck,
        "unique_optimal": vr.unique_optimal,
        "full_pass": vr.full_pass,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, required=True)
    parser.add_argument("--output", type=str, required=True)
    parser.add_argument("--num-pairs", type=int, default=5000)
    parser.add_argument("--max-loser-moves", type=int, default=7, 
                       help="Max moves for loser puzzle")
    parser.add_argument("--temperature", type=float, default=1.0)
    parser.add_argument("--k-candidates", type=int, default=4,
                       help="Generate k candidates per seed, pick best for winners")
    args = parser.parse_args()
    
    device = torch.device("mps" if torch.backends.mps.is_available() else 
                         "cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    
    if not RUST_AVAILABLE:
        raise RuntimeError("Rust validator required")
    print("Rust verifier loaded")
    
    # Load model
    config = config_for_preset("base")
    model = PuzzleGeneratorV2(config).to(device)
    
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    if "ema_shadow" in ckpt:
        model.load_state_dict(ckpt["ema_shadow"], strict=False)
        print(f"Loaded EMA weights from: {args.checkpoint}")
    else:
        model.load_state_dict(ckpt["model_state"])
        print(f"Loaded checkpoint: {args.checkpoint}")
    
    model.eval()
    
    # Collect winners (PASS) and losers (solvable, <8 moves)
    winners = []
    losers = []
    pairs = []
    
    stats = {
        "generated": 0,
        "solvable": 0,
        "full_pass": 0,
        "valid_loser": 0,
    }
    
    gen_idx = 0
    pbar = tqdm(total=args.num_pairs, desc="Generating self-play pairs")
    
    while len(pairs) < args.num_pairs:
        # Generate k candidates and pick the best for winners
        candidates = []
        for k in range(args.k_candidates):
            puzzle = generate_puzzle(model, device, f"selfplay-{gen_idx}-{k}", args.temperature)
            candidates.append(puzzle)
        
        stats["generated"] += args.k_candidates
        gen_idx += 1
        
        # Find best candidate (prioritize full_pass, then highest moves)
        best_winner = None
        for c in candidates:
            if c["solvable"]:
                stats["solvable"] += 1
                if c["full_pass"]:
                    stats["full_pass"] += 1
                    if best_winner is None or not best_winner["full_pass"]:
                        best_winner = c
                elif c["optimal_moves"] <= args.max_loser_moves:
                    stats["valid_loser"] += 1
                    losers.append(c)
        
        if best_winner and best_winner["full_pass"]:
            winners.append(best_winner)
        
        # Try to make pairs
        while winners and losers and len(pairs) < args.num_pairs:
            winner = winners.pop(0)
            loser = losers.pop(0)
            
            pair = {
                "winner": {
                    "tilesInterior": tiles_to_interior(winner["tiles_flat"]),
                    "start": winner["start"],
                    "goal": winner["goal"],
                    "optimal_moves": winner["optimal_moves"],
                },
                "loser": {
                    "tilesInterior": tiles_to_interior(loser["tiles_flat"]),
                    "start": loser["start"],
                    "goal": loser["goal"],
                    "optimal_moves": loser["optimal_moves"],
                },
            }
            pairs.append(pair)
            pbar.update(1)
        
        # Log progress
        if stats["generated"] % 100 == 0:
            pass_rate = stats["full_pass"] / stats["generated"] * 100
            loser_rate = stats["valid_loser"] / stats["generated"] * 100
            pbar.set_postfix(
                gen=stats["generated"],
                winners=len(winners),
                losers=len(losers),
                pass_rate=f"{pass_rate:.1f}%",
                loser_rate=f"{loser_rate:.1f}%",
            )
            print(f"  Gen {stats['generated']}: {len(pairs)} pairs, "
                  f"winners={len(winners)}, losers={len(losers)}, "
                  f"pass={pass_rate:.1f}%, loser={loser_rate:.1f}%", flush=True)
    
    pbar.close()
    
    # Save pairs
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, "w") as f:
        for pair in pairs:
            f.write(json.dumps(pair) + "\n")
    
    print(f"\nGeneration complete!")
    print(f"Stats: {json.dumps(stats, indent=2)}")
    print(f"Saved {len(pairs)} pairs to {output_path}")
    
    # Sample pairs
    if pairs:
        for i in [0, len(pairs)//2, -1]:
            p = pairs[i]
            print(f"Pair {i}: Winner={p['winner']['optimal_moves']} moves, "
                  f"Loser={p['loser']['optimal_moves']} moves")


if __name__ == "__main__":
    main()
