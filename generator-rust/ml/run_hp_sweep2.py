#!/usr/bin/env python3
"""
Hyperparameter Sweep Phase 2: Test remaining ideas on SwiGLU base.

Experiments:
1. SwiGLU + 100k data (does SwiGLU scale with more data?)
2. SwiGLU + 200 timesteps (more diffusion steps)
3. SwiGLU + linear mask schedule (instead of cosine)
4. SwiGLU + wider model (384 dim instead of 256)
5. SwiGLU + label smoothing 0.1
6. SwiGLU + grad clip 1.0
7. SwiGLU + AdamW β2=0.95
8. Combined best: SwiGLU + any winners from above
"""

import subprocess
import sys
import time
import re
from pathlib import Path
from datetime import datetime

EXPERIMENTS = [
    {
        "name": "swiglu_100k",
        "args": ["--data", "../data/train-10move-100k.jsonl", "--ff-activation", "swiglu"],
        "desc": "SwiGLU + 100k data",
    },
    {
        "name": "swiglu_200steps",
        "args": ["--ff-activation", "swiglu", "--num-timesteps", "200"],
        "desc": "SwiGLU + 200 diffusion timesteps",
    },
    {
        "name": "swiglu_linear_sched",
        "args": ["--ff-activation", "swiglu", "--mask-schedule", "linear"],
        "desc": "SwiGLU + linear mask schedule",
    },
    {
        "name": "swiglu_wide384",
        "args": ["--ff-activation", "swiglu", "--model-dim", "384", "--ff-dim", "1536"],
        "desc": "SwiGLU + wider model (384 dim)",
    },
    {
        "name": "swiglu_labelsmooth",
        "args": ["--ff-activation", "swiglu", "--label-smoothing", "0.1"],
        "desc": "SwiGLU + label smoothing 0.1",
    },
    {
        "name": "swiglu_gradclip",
        "args": ["--ff-activation", "swiglu", "--grad-clip", "1.0"],
        "desc": "SwiGLU + gradient clipping 1.0",
    },
    {
        "name": "swiglu_beta2_95",
        "args": ["--ff-activation", "swiglu", "--beta2", "0.95"],
        "desc": "SwiGLU + AdamW β2=0.95",
    },
]

# Base training config (matches SwiGLU 3.1% run)
BASE_CONFIG = [
    "--data", "../data/train-10move-50k.jsonl",
    "--preset", "base",
    "--epochs", "30",
    "--batch-size", "64",
    "--lr", "1e-4",
    "--ema-decay", "0.9999",
    "--eval-every", "500",
    "--generate-samples", "256",
]

BASELINE_PASS = 3.1  # SwiGLU baseline to beat


def parse_best_pass(log_path: Path) -> float:
    """Parse best PASS rate from progress log."""
    if not log_path.exists():
        return 0.0
    
    best = 0.0
    text = log_path.read_text()
    for match in re.finditer(r"PASS=(\d+\.\d+)%", text):
        val = float(match.group(1))
        if val > best:
            best = val
    return best


def run_experiment(exp: dict, results_file: Path):
    """Run a single experiment."""
    name = exp["name"]
    args = exp["args"]
    desc = exp["desc"]
    out_dir = f"output_hp2_{name}"
    
    print(f"\n{'='*60}")
    print(f"Starting: {name} ({desc})")
    print(f"Output: {out_dir}")
    print(f"{'='*60}\n")
    
    # Build command - merge BASE_CONFIG with experiment-specific args
    cmd = [
        sys.executable, "pretrain_v2.py",
        "--out", out_dir,
    ]
    
    # Add base config, but skip --data if experiment overrides it
    exp_has_data = any("--data" in arg for arg in args)
    for i, arg in enumerate(BASE_CONFIG):
        if arg == "--data" and exp_has_data:
            continue
        if i > 0 and BASE_CONFIG[i-1] == "--data" and exp_has_data:
            continue
        cmd.append(arg)
    
    # Add experiment-specific args
    cmd.extend(args)
    
    print(f"Command: {' '.join(cmd)}\n")
    
    # Run training
    start_time = time.time()
    result = subprocess.run(cmd, capture_output=False)
    elapsed = time.time() - start_time
    
    # Parse results
    log_path = Path(out_dir) / "progress.log"
    best_pass = parse_best_pass(log_path)
    
    # Record result
    marker = "✓" if best_pass > BASELINE_PASS else ""
    result_line = f"{best_pass:.1f}% - {name} ({desc}) {marker}\n"
    
    with open(results_file, "a") as f:
        f.write(result_line)
    
    print(f"\n{'='*60}")
    print(f"Completed: {name}")
    print(f"Best PASS: {best_pass:.1f}% (baseline: {BASELINE_PASS}%)")
    print(f"Time: {elapsed/60:.1f} min")
    print(f"{'='*60}\n")
    
    return best_pass


def main():
    results_file = Path("hp_sweep2_results.txt")
    
    # Initialize results file
    with open(results_file, "w") as f:
        f.write("HYPERPARAMETER SWEEP PHASE 2 RESULTS\n")
        f.write("=" * 60 + "\n")
        f.write(f"Baseline (SwiGLU): {BASELINE_PASS}% PASS\n\n")
    
    # Run each experiment
    results = []
    for exp in EXPERIMENTS:
        best = run_experiment(exp, results_file)
        results.append((exp["name"], exp["desc"], best))
    
    # Write sorted summary
    with open(results_file, "a") as f:
        f.write("\n" + "=" * 60 + "\n")
        f.write("SORTED SUMMARY\n")
        f.write("=" * 60 + "\n")
        for name, desc, best in sorted(results, key=lambda x: -x[2]):
            marker = "✓" if best > BASELINE_PASS else ""
            f.write(f"{best:.1f}% - {name} {marker}\n")
    
    print("\n" + "=" * 60)
    print("SWEEP COMPLETE")
    print("=" * 60)
    print(f"\nResults saved to: {results_file}")
    
    # Print summary
    best_exp = max(results, key=lambda x: x[2])
    print(f"\nBest result: {best_exp[0]} with {best_exp[2]:.1f}% PASS")
    if best_exp[2] > BASELINE_PASS:
        print(f"  → Beat baseline by +{best_exp[2] - BASELINE_PASS:.1f}%!")
    else:
        print(f"  → Did not beat baseline ({BASELINE_PASS}%)")


if __name__ == "__main__":
    main()
