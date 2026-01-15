#!/usr/bin/env python3
"""
Architecture Sweep: Test model architecture variants.

6 experiments:
1. Baseline + SwiGLU
2. Baseline + RMSNorm  
3. Baseline + AdaLN-Zero (timestep conditioning)
4. 12 layers + residual scaling
5. Baseline + DropPath 0.1
6. Combined: SwiGLU + RMSNorm + DropPath 0.1

All use 50k data, same training config as 2.7% baseline.
"""

import subprocess
import sys
import time
import re
from pathlib import Path
from datetime import datetime

EXPERIMENTS = [
    {
        "name": "swiglu",
        "args": ["--ff-activation", "swiglu"],
        "desc": "SwiGLU activation",
    },
    {
        "name": "rmsnorm",
        "args": ["--norm-type", "rmsnorm"],
        "desc": "RMSNorm instead of LayerNorm",
    },
    {
        "name": "adaln_zero",
        "args": ["--time-conditioning", "adaln_zero"],
        "desc": "AdaLN-Zero timestep conditioning",
    },
    {
        "name": "deep_12L",
        "args": ["--num-layers", "12", "--residual-scale"],
        "desc": "12 layers with residual scaling",
    },
    {
        "name": "droppath",
        "args": ["--drop-path", "0.1"],
        "desc": "DropPath 0.1 (stochastic depth)",
    },
    {
        "name": "combined",
        "args": ["--ff-activation", "swiglu", "--norm-type", "rmsnorm", "--drop-path", "0.1"],
        "desc": "SwiGLU + RMSNorm + DropPath 0.1",
    },
]

# Base training config (matches 2.7% baseline)
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

BASELINE_PASS = 2.7  # Our target to beat


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


def run_experiment(exp_idx: int, exp: dict, results_file: Path):
    """Run a single experiment."""
    name = exp["name"]
    out_dir = f"output_arch_{exp_idx+1:02d}_{name}"
    log_file = f"{out_dir}.log"
    
    print(f"\n{'='*60}")
    print(f"EXPERIMENT {exp_idx+1}/{len(EXPERIMENTS)}: {name}")
    print(f"{'='*60}")
    print(f"Description: {exp['desc']}")
    print(f"Output: {out_dir}")
    print(f"Starting at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    cmd = [
        sys.executable, "pretrain_v2.py",
        "--out", out_dir,
        *BASE_CONFIG,
        *exp["args"],
    ]
    
    print(f"Command: {' '.join(cmd)}")
    
    with open(log_file, "w") as f:
        proc = subprocess.Popen(
            cmd,
            stdout=f,
            stderr=subprocess.STDOUT,
        )
    
    # Monitor progress
    progress_log = Path(out_dir) / "progress.log"
    last_best = 0.0
    consecutive_degrades = 0
    
    while proc.poll() is None:
        time.sleep(60)  # Check every minute
        
        if progress_log.exists():
            current_best = parse_best_pass(progress_log)
            if current_best > last_best:
                print(f"  [{datetime.now().strftime('%H:%M:%S')}] New best: {current_best:.1f}%")
                last_best = current_best
                consecutive_degrades = 0
            
            # Check for degradation (5 evals with no improvement after peak)
            text = progress_log.read_text()
            evals = re.findall(r"eval step=(\d+).*PASS=(\d+\.\d+)%", text)
            if len(evals) >= 5 and last_best > 0:
                recent = [float(p) for _, p in evals[-5:]]
                if all(p < last_best for p in recent):
                    consecutive_degrades += 1
                    if consecutive_degrades >= 3:  # 3 minutes of degradation
                        print(f"  [{datetime.now().strftime('%H:%M:%S')}] Early stopping! Degraded from {last_best:.1f}%")
                        proc.terminate()
                        break
    
    proc.wait()
    
    # Get final best
    final_best = parse_best_pass(progress_log) if progress_log.exists() else 0.0
    print(f"Finished at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Best PASS: {final_best:.1f}%")
    
    # Update results file
    with open(results_file, "a") as f:
        beat = "✓" if final_best > BASELINE_PASS else ""
        f.write(f"{final_best:.1f}% - {name} ({exp['desc']}) {beat}\n")
    
    return final_best


def main():
    results_file = Path("arch_sweep_results.txt")
    
    print("=" * 60)
    print("ARCHITECTURE SWEEP")
    print("=" * 60)
    print(f"Started at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Baseline to beat: {BASELINE_PASS}% PASS")
    print(f"Total experiments: {len(EXPERIMENTS)}")
    print()
    
    # Initialize results file
    with open(results_file, "w") as f:
        f.write("ARCHITECTURE SWEEP RESULTS\n")
        f.write("=" * 60 + "\n")
        f.write(f"Baseline: {BASELINE_PASS}% PASS\n\n")
    
    results = {}
    
    for i, exp in enumerate(EXPERIMENTS):
        best = run_experiment(i, exp, results_file)
        results[exp["name"]] = best
    
    # Summary
    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    
    sorted_results = sorted(results.items(), key=lambda x: -x[1])
    for name, best in sorted_results:
        beat = "✓ BEAT BASELINE" if best > BASELINE_PASS else ""
        print(f"  {best:.1f}% - {name} {beat}")
    
    # Update results file with sorted summary
    with open(results_file, "a") as f:
        f.write("\n" + "=" * 60 + "\n")
        f.write("SORTED SUMMARY\n")
        f.write("=" * 60 + "\n")
        for name, best in sorted_results:
            beat = "✓" if best > BASELINE_PASS else ""
            f.write(f"{best:.1f}% - {name} {beat}\n")
    
    print(f"\nCompleted at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Results saved to: {results_file}")


if __name__ == "__main__":
    main()
