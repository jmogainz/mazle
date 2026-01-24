#!/usr/bin/env python3
"""
Test different sampling temperatures on the SwiGLU checkpoint.
"""

import sys
import torch
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from model_v2 import PuzzleGeneratorV2, ModelConfig

# Tile remapping (model uses contiguous indices, verifier needs original)
TILE_REMAP_INV = {0: 0, 1: 1, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8}

# Try to import Rust verifier
try:
    from mazle_eval import validate_ice_interior
    HAS_RUST_VERIFIER = True
except ImportError:
    HAS_RUST_VERIFIER = False
    print("Warning: Rust verifier not available")


def verify_puzzle(tiles, start_x, start_y, goal_x, goal_y, target_moves=10):
    """Verify a puzzle meets all criteria."""
    if not HAS_RUST_VERIFIER:
        return {"valid": False, "reason": "no_verifier"}
    
    H, W = 13, 13
    
    # Convert to 2D grid with remapped tile IDs
    flat = tiles.flatten().tolist()
    grid = []
    for y in range(H):
        row = []
        for x in range(W):
            idx = flat[y * W + x]
            row.append(TILE_REMAP_INV.get(int(idx), 4))  # Default to ice
        grid.append(row)
    
    result = validate_ice_interior(grid, int(start_x), int(start_y), int(goal_x), int(goal_y), target_moves)
    
    return {
        "valid": True,
        "solvable": result.solvable,
        "optimal_moves": result.optimal_moves,
        "unique_optimal": result.unique_optimal,
        "no_stuck": result.no_stuck,
        "meets_target": result.meets_target_moves,
        "full_pass": result.solvable and result.unique_optimal and result.no_stuck and result.meets_target_moves,
    }


def test_config(model, device, temperature, schedule, n_samples=256, n_batches=4):
    """Test a specific temperature configuration."""
    total = 0
    full_pass = 0
    solvable = 0
    moves_sum = 0
    moves_count = 0
    
    for batch_idx in range(n_batches):
        gen = torch.Generator(device=device).manual_seed(42 + batch_idx)
        
        with torch.no_grad():
            output = model.generate(
                batch_size=n_samples // n_batches,
                device=device,
                generator=gen,
                temperature=temperature,
                temperature_schedule=schedule,
            )
        
        tiles = output["tiles"].cpu()
        starts = output["start_pos"].cpu()
        goals = output["goal_pos"].cpu()
        
        for i in range(tiles.shape[0]):
            total += 1
            result = verify_puzzle(
                tiles[i], 
                starts[i, 0].item(), starts[i, 1].item(),
                goals[i, 0].item(), goals[i, 1].item(),
            )
            
            if result.get("solvable"):
                solvable += 1
                moves_sum += result.get("optimal_moves", 0)
                moves_count += 1
            
            if result.get("full_pass"):
                full_pass += 1
    
    pass_rate = 100.0 * full_pass / total if total > 0 else 0
    solve_rate = 100.0 * solvable / total if total > 0 else 0
    avg_moves = moves_sum / moves_count if moves_count > 0 else 0
    
    return {
        "pass_rate": pass_rate,
        "solve_rate": solve_rate,
        "avg_moves": avg_moves,
        "total": total,
        "full_pass": full_pass,
    }


def main():
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    # Load SwiGLU checkpoint
    ckpt_path = Path("output_arch_01_swiglu/best_model.pt")
    if not ckpt_path.exists():
        print(f"Checkpoint not found: {ckpt_path}")
        sys.exit(1)
    
    print(f"Loading {ckpt_path}...")
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    
    # Create model with SwiGLU config
    config = ModelConfig(ff_activation="swiglu")
    model = PuzzleGeneratorV2(config).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    print(f"Loaded model ({sum(p.numel() for p in model.parameters()) / 1e6:.1f}M params)")
    
    # Test configurations
    configs = [
        # (temperature, schedule, description)
        (1.0, "constant", "baseline (temp=1.0, constant)"),
        (0.8, "constant", "temp=0.8, constant"),
        (0.6, "constant", "temp=0.6, constant"),
        (0.5, "constant", "temp=0.5, constant"),
        (0.3, "constant", "temp=0.3, constant"),
        (0.1, "constant", "temp=0.1 (near-greedy)"),
        (1.0, "linear", "temp=1.0, linear decay"),
        (0.8, "linear", "temp=0.8, linear decay"),
        (1.0, "cosine", "temp=1.0, cosine decay"),
        (0.8, "cosine", "temp=0.8, cosine decay"),
    ]
    
    print("\n" + "="*70)
    print("TEMPERATURE SAMPLING TEST")
    print("="*70)
    print(f"{'Config':<35} {'PASS%':>8} {'Solve%':>8} {'AvgMoves':>10}")
    print("-"*70)
    
    results = []
    for temp, schedule, desc in configs:
        result = test_config(model, device, temp, schedule, n_samples=512, n_batches=8)
        results.append((desc, result))
        print(f"{desc:<35} {result['pass_rate']:>7.1f}% {result['solve_rate']:>7.1f}% {result['avg_moves']:>10.1f}")
    
    print("-"*70)
    
    # Find best
    best = max(results, key=lambda x: x[1]["pass_rate"])
    print(f"\nBest: {best[0]} with {best[1]['pass_rate']:.1f}% PASS")


if __name__ == "__main__":
    main()
