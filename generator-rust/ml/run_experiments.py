#!/usr/bin/env python3
"""
Sequential Hyperparameter Search with Early Stopping

Runs experiments sequentially, stops each when degradation begins
(full_pass rate decreases from best for 5 consecutive evals).
"""

import subprocess
import os
import sys
import time
import re
from pathlib import Path

# Experiments to run
EXPERIMENTS = [
    # === Dataset Size Sweep (PRIORITY - test if more data helps) ===
    {"name": "data_200k_base", "lr": 1e-4, "epochs": 15, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "200k"},
    {"name": "data_300k_base", "lr": 1e-4, "epochs": 10, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "300k"},
    {"name": "data_200k_slow", "lr": 5e-5, "epochs": 20, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "200k"},
    {"name": "data_300k_slow", "lr": 5e-5, "epochs": 15, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "300k"},
    {"name": "data_300k_small_batch", "lr": 1e-4, "epochs": 15, "batch_size": 32, "preset": "base", "ema": 0.9999, "data": "300k"},
    
    # === Learning Rate Sweep ===
    {"name": "lr_5e5", "lr": 5e-5, "epochs": 40, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "50k"},
    {"name": "lr_2e4", "lr": 2e-4, "epochs": 20, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "50k"},
    {"name": "lr_3e4", "lr": 3e-4, "epochs": 15, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "50k"},
    
    # === Batch Size Sweep ===
    {"name": "batch_32", "lr": 1e-4, "epochs": 40, "batch_size": 32, "preset": "base", "ema": 0.9999, "data": "50k"},
    {"name": "batch_128", "lr": 1e-4, "epochs": 20, "batch_size": 128, "preset": "base", "ema": 0.9999, "data": "50k"},
    {"name": "batch_16", "lr": 1e-4, "epochs": 60, "batch_size": 16, "preset": "base", "ema": 0.9999, "data": "50k"},
    
    # === EMA Decay Sweep ===
    {"name": "ema_999", "lr": 1e-4, "epochs": 30, "batch_size": 64, "preset": "base", "ema": 0.999, "data": "50k"},
    {"name": "ema_99995", "lr": 1e-4, "epochs": 30, "batch_size": 64, "preset": "base", "ema": 0.99995, "data": "50k"},
    
    # === Model Size Sweep ===
    {"name": "model_small", "lr": 1e-4, "epochs": 40, "batch_size": 64, "preset": "small", "ema": 0.9999, "data": "50k"},
    {"name": "model_large", "lr": 1e-4, "epochs": 30, "batch_size": 32, "preset": "large", "ema": 0.9999, "data": "50k"},
    
    # === Large data + large model ===
    {"name": "large_model_200k", "lr": 1e-4, "epochs": 15, "batch_size": 32, "preset": "large", "ema": 0.9999, "data": "200k"},
    {"name": "large_model_300k", "lr": 1e-4, "epochs": 10, "batch_size": 32, "preset": "large", "ema": 0.9999, "data": "300k"},
    
    # === Combined Variations ===
    {"name": "small_lr_small_batch", "lr": 5e-5, "epochs": 50, "batch_size": 32, "preset": "base", "ema": 0.9999, "data": "50k"},
    {"name": "data_25k_long", "lr": 1e-4, "epochs": 80, "batch_size": 32, "preset": "base", "ema": 0.9999, "data": "25k"},
    
    # === Augmentation test ===
    {"name": "with_augment", "lr": 1e-4, "epochs": 30, "batch_size": 64, "preset": "base", "ema": 0.9999, "data": "50k", "augment": True},
]

DATA_PATHS = {
    "25k": "../data/train-10move-25k.jsonl",
    "50k": "../data/train-10move-50k.jsonl",
    "100k": "../data/train-10move-100k.jsonl",
    "200k": "../data/train-10move-200k.jsonl",
    "300k": "../data/train-10move-300k.jsonl",
}

def get_best_pass_from_log(log_path):
    """Parse log file and return best full_pass seen and current degradation count."""
    if not os.path.exists(log_path):
        return 0.0, 0, []
    
    passes = []
    with open(log_path) as f:
        for line in f:
            match = re.search(r'PASS=(\d+\.?\d*)%', line)
            if match:
                passes.append(float(match.group(1)))
    
    if not passes:
        return 0.0, 0, []
    
    best = max(passes)
    
    # Count consecutive degradations from best
    degrade_count = 0
    for p in reversed(passes):
        if p < best:
            degrade_count += 1
        else:
            break
    
    return best, degrade_count, passes

def run_experiment(exp, exp_num, total):
    """Run a single experiment with early stopping."""
    name = exp["name"]
    out_dir = f"output_sweep_{exp_num:02d}_{name}"
    log_file = f"{out_dir}.log"
    
    print(f"\n{'='*60}", flush=True)
    print(f"EXPERIMENT {exp_num}/{total}: {name}", flush=True)
    print(f"{'='*60}", flush=True)
    print(f"Config: {exp}", flush=True)
    print(f"Output: {out_dir}", flush=True)
    print(f"Log: {log_file}", flush=True)
    
    # Build command
    data_path = DATA_PATHS[exp["data"]]
    cmd = [
        sys.executable, "pretrain_v2.py",
        "--data", data_path,
        "--out", out_dir,
        "--preset", exp["preset"],
        "--epochs", str(exp["epochs"]),
        "--batch-size", str(exp["batch_size"]),
        "--lr", str(exp["lr"]),
        "--ema-decay", str(exp["ema"]),
        "--eval-every", "500",
        "--generate-samples", "256",
    ]
    
    if exp.get("augment"):
        cmd.append("--augment")
    
    print(f"Command: {' '.join(cmd)}", flush=True)
    print(f"Starting at {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
    
    # Start process
    with open(log_file, "w") as log_f:
        proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT)
    
    # Monitor for early stopping
    best_pass = 0.0
    degrade_patience = 5  # Stop after 5 consecutive degradations
    check_interval = 60  # Check every 60 seconds
    
    while proc.poll() is None:
        time.sleep(check_interval)
        
        progress_log = f"{out_dir}/progress.log"
        best, degrade_count, passes = get_best_pass_from_log(progress_log)
        
        if best > best_pass:
            best_pass = best
            print(f"  [{time.strftime('%H:%M:%S')}] New best: {best_pass:.1f}%", flush=True)
        
        if degrade_count >= degrade_patience and best_pass > 0:
            print(f"  [{time.strftime('%H:%M:%S')}] Early stopping! Degraded {degrade_count}x from {best_pass:.1f}%", flush=True)
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except:
                proc.kill()
            break
    
    # Get final results
    progress_log = f"{out_dir}/progress.log"
    final_best, _, all_passes = get_best_pass_from_log(progress_log)
    
    print(f"Finished at {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
    print(f"Best PASS: {final_best:.1f}%", flush=True)
    
    return {
        "name": name,
        "best_pass": final_best,
        "config": exp,
    }

def main():
    print("="*60, flush=True)
    print("HYPERPARAMETER SWEEP", flush=True)
    print("="*60, flush=True)
    print(f"Started at {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)
    print(f"Baseline to beat: 2.7% PASS", flush=True)
    print(f"Total experiments: {len(EXPERIMENTS)}", flush=True)
    print(flush=True)
    
    results = []
    
    for i, exp in enumerate(EXPERIMENTS, 1):
        try:
            result = run_experiment(exp, i, len(EXPERIMENTS))
            results.append(result)
        except Exception as e:
            print(f"ERROR in experiment {i}: {e}", flush=True)
            results.append({"name": exp["name"], "best_pass": 0.0, "error": str(e)})
        
        # Save intermediate results
        with open("sweep_results.txt", "w") as f:
            f.write("HYPERPARAMETER SWEEP RESULTS\n")
            f.write("="*60 + "\n")
            f.write(f"Baseline: 2.7% PASS\n\n")
            
            sorted_results = sorted(results, key=lambda x: x.get("best_pass", 0), reverse=True)
            for r in sorted_results:
                beat = "BEAT!" if r.get("best_pass", 0) > 2.7 else ""
                f.write(f"{r['best_pass']:.1f}% - {r['name']} {beat}\n")
            
            f.write(f"\nCompleted: {len(results)}/{len(EXPERIMENTS)}\n")
    
    # Final summary
    print("\n" + "="*60, flush=True)
    print("FINAL RESULTS", flush=True)
    print("="*60, flush=True)
    
    sorted_results = sorted(results, key=lambda x: x.get("best_pass", 0), reverse=True)
    for r in sorted_results:
        beat = "🏆 BEAT BASELINE!" if r.get("best_pass", 0) > 2.7 else ""
        print(f"{r['best_pass']:.1f}% - {r['name']} {beat}", flush=True)
    
    print(f"\nCompleted at {time.strftime('%Y-%m-%d %H:%M:%S')}", flush=True)

if __name__ == "__main__":
    main()
