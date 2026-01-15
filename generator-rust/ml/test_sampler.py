#!/usr/bin/env python3
"""
Compare original vs MaskGIT-style sampler on the 2.7% checkpoint.
No training - just tests generation quality.
"""

import sys
import torch
import time
from pathlib import Path

# Add bridge to path for verifier
sys.path.insert(0, str(Path(__file__).parent / "bridge"))

from model_v2 import PuzzleGeneratorV2, ModelConfig

def try_import_verifier():
    try:
        from mazle_eval import validate_ice_interior
        return validate_ice_interior
    except ImportError:
        print("Warning: Rust verifier not available")
        return None

def validate_puzzle(tiles, start, goal, verify_fn):
    """Validate a single puzzle."""
    tiles_list = tiles.cpu().tolist()
    start_x, start_y = start.cpu().tolist()
    goal_x, goal_y = goal.cpu().tolist()
    
    if verify_fn is None:
        return {"solvable": False, "error": "no verifier"}
    
    try:
        result = verify_fn(tiles_list, int(start_x), int(start_y), int(goal_x), int(goal_y), 10)
        return {
            "valid_structure": True,  # If we got here, structure is valid
            "solvable": result.solvable,
            "no_stuck": result.no_stuck,
            "unique_optimal": result.unique_optimal,
            "optimal_moves": result.optimal_moves if result.solvable else 0,
            "meets_target": result.meets_target_moves if result.solvable else False,
        }
    except Exception as e:
        return {"solvable": False, "error": str(e)}

def test_sampler(model, device, verify_fn, num_samples=256, sampler="original", **kwargs):
    """Test a sampler and return metrics."""
    model.eval()
    
    results = {
        "valid_structure": 0,
        "solvable": 0,
        "no_stuck": 0,
        "unique_optimal": 0,
        "target_10": 0,
        "full_pass": 0,
        "moves": [],
    }
    
    batch_size = 32
    num_batches = (num_samples + batch_size - 1) // batch_size
    
    t0 = time.time()
    
    for i in range(num_batches):
        current_batch = min(batch_size, num_samples - i * batch_size)
        
        if sampler == "original":
            output = model.generate(current_batch, device, **kwargs)
        elif sampler == "maskgit":
            output = model.generate_maskgit(current_batch, device, **kwargs)
        else:
            raise ValueError(f"Unknown sampler: {sampler}")
        
        tiles = output["tiles"]
        starts = output["start_pos"]
        goals = output["goal_pos"]
        
        for j in range(current_batch):
            result = validate_puzzle(tiles[j], starts[j], goals[j], verify_fn)
            
            if result.get("valid_structure", False):
                results["valid_structure"] += 1
            if result.get("solvable", False):
                results["solvable"] += 1
                moves = result.get("optimal_moves", 0)
                results["moves"].append(moves)
                if moves == 10:
                    results["target_10"] += 1
            if result.get("no_stuck", False):
                results["no_stuck"] += 1
            if result.get("unique_optimal", False):
                results["unique_optimal"] += 1
            
            # Full pass = all criteria
            if (result.get("solvable", False) and 
                result.get("no_stuck", False) and
                result.get("unique_optimal", False) and
                result.get("optimal_moves", 0) == 10):
                results["full_pass"] += 1
    
    elapsed = time.time() - t0
    
    # Convert to percentages
    n = num_samples
    metrics = {
        "valid_structure": results["valid_structure"] / n,
        "solvable": results["solvable"] / n,
        "no_stuck": results["no_stuck"] / n,
        "unique_optimal": results["unique_optimal"] / n,
        "target_10": results["target_10"] / n,
        "full_pass": results["full_pass"] / n,
        "time": elapsed,
        "samples_per_sec": n / elapsed,
    }
    
    if results["moves"]:
        metrics["moves_mean"] = sum(results["moves"]) / len(results["moves"])
    else:
        metrics["moves_mean"] = 0
    
    return metrics

def main():
    # Load best checkpoint
    checkpoint_path = Path("output_v2_50k_ema9999/best_model.pt")
    
    if not checkpoint_path.exists():
        print(f"Checkpoint not found: {checkpoint_path}")
        sys.exit(1)
    
    print(f"Loading checkpoint: {checkpoint_path}")
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    
    config = ckpt.get("config", ModelConfig())
    model = PuzzleGeneratorV2(config)
    model.load_state_dict(ckpt["model_state"])
    
    # Device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    
    print(f"Device: {device}")
    model = model.to(device)
    model.eval()
    
    # Verifier
    verify_fn = try_import_verifier()
    if verify_fn:
        print("Rust verifier loaded")
    
    num_samples = 256
    print(f"\nTesting with {num_samples} samples each...\n")
    
    # Test original sampler
    print("=" * 60)
    print("ORIGINAL SAMPLER (re-mask each step)")
    print("=" * 60)
    metrics_orig = test_sampler(model, device, verify_fn, num_samples, sampler="original")
    print(f"  valid={metrics_orig['valid_structure']:.1%} solve={metrics_orig['solvable']:.1%} "
          f"nostuck={metrics_orig['no_stuck']:.1%} unique={metrics_orig['unique_optimal']:.1%}")
    print(f"  t10={metrics_orig['target_10']:.1%} PASS={metrics_orig['full_pass']:.1%} "
          f"moves_mean={metrics_orig['moves_mean']:.1f}")
    print(f"  time={metrics_orig['time']:.1f}s ({metrics_orig['samples_per_sec']:.1f} samples/sec)")
    
    # Test MaskGIT sampler
    print()
    print("=" * 60)
    print("MASKGIT SAMPLER (confidence-unmask, no re-mask)")
    print("=" * 60)
    metrics_maskgit = test_sampler(model, device, verify_fn, num_samples, sampler="maskgit")
    print(f"  valid={metrics_maskgit['valid_structure']:.1%} solve={metrics_maskgit['solvable']:.1%} "
          f"nostuck={metrics_maskgit['no_stuck']:.1%} unique={metrics_maskgit['unique_optimal']:.1%}")
    print(f"  t10={metrics_maskgit['target_10']:.1%} PASS={metrics_maskgit['full_pass']:.1%} "
          f"moves_mean={metrics_maskgit['moves_mean']:.1f}")
    print(f"  time={metrics_maskgit['time']:.1f}s ({metrics_maskgit['samples_per_sec']:.1f} samples/sec)")
    
    # Summary
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Original:  PASS={metrics_orig['full_pass']:.1%}  moves={metrics_orig['moves_mean']:.1f}")
    print(f"MaskGIT:   PASS={metrics_maskgit['full_pass']:.1%}  moves={metrics_maskgit['moves_mean']:.1f}")
    
    delta = metrics_maskgit['full_pass'] - metrics_orig['full_pass']
    if delta > 0:
        print(f"\n✓ MaskGIT is BETTER by {delta:.1%}")
    elif delta < 0:
        print(f"\n✗ MaskGIT is WORSE by {-delta:.1%}")
    else:
        print(f"\n= Both samplers tied")

if __name__ == "__main__":
    main()
