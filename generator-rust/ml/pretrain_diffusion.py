"""
Training script for discrete diffusion puzzle generator.
"""

import argparse
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from data import (
    JsonlMazeDataset,
    CollateFn,
    TileVocab,
    collect_tile_ids,
    make_vocab_with_start_goal,
    START_TILE_ID,
    GOAL_TILE_ID,
)
from model_diffusion import DiscreteDiffusionModel, DiffusionConfig, diffusion_config_for_preset


def count_lines(path: Path) -> int:
    """Count lines in a file."""
    with open(path) as f:
        return sum(1 for _ in f)


def log_progress(msg: str, out_dir: Path = None):
    """Log progress to stdout and optionally to file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{timestamp} {msg}"
    print(line)
    if out_dir:
        with open(out_dir / "progress.log", "a") as f:
            f.write(line + "\n")


def generate_and_analyze(
    model: DiscreteDiffusionModel,
    vocab: TileVocab,
    device: torch.device,
    num_samples: int = 8,
):
    """Generate samples and analyze quality."""
    model.eval()
    seeds = [f"eval-{i}" for i in range(num_samples)]
    latents = model.latent_from_seeds(seeds, device)
    
    # Generate
    torch.manual_seed(42)
    generated = model.generate(latents, temperature=1.0)  # (B, H, W)
    
    # Decode and analyze
    results = {
        "total": num_samples,
        "exactly_1_start": 0,
        "exactly_1_goal": 0,
        "valid_structure": 0,
    }
    
    for i in range(num_samples):
        grid = generated[i].cpu().tolist()
        decoded = vocab.decode_grid(grid)
        
        start_count = sum(1 for row in decoded for v in row if v == START_TILE_ID)
        goal_count = sum(1 for row in decoded for v in row if v == GOAL_TILE_ID)
        
        if start_count == 1:
            results["exactly_1_start"] += 1
        if goal_count == 1:
            results["exactly_1_goal"] += 1
        if start_count == 1 and goal_count == 1:
            results["valid_structure"] += 1
    
    return results


def main():
    parser = argparse.ArgumentParser(description="Train discrete diffusion model")
    parser.add_argument("--data", type=str, required=True, help="Path to training JSONL")
    parser.add_argument("--out", type=str, required=True, help="Output directory")
    parser.add_argument("--data-count", type=int, default=None, help="Number of samples in data")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--preset", type=str, default="base", choices=["small", "base", "large"])
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--clip-grad", type=float, default=1.0)
    parser.add_argument("--val-pct", type=float, default=0.02)
    parser.add_argument("--test-pct", type=float, default=0.01)
    parser.add_argument("--shuffle-buffer", type=int, default=8192)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--save-every", type=int, default=2000)
    parser.add_argument("--eval-steps", type=int, default=100)
    parser.add_argument("--amp", action="store_true", help="Use automatic mixed precision")
    parser.add_argument("--generate-samples", type=int, default=32)
    parser.add_argument("--eval-test", action="store_true", help="Evaluate on test set at end")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    data_path = Path(args.data)

    # Device
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    
    log_progress(f"device={device}", out_dir)
    log_progress(f"mps_available={torch.backends.mps.is_available()}", out_dir)

    # Vocab
    tile_ids = collect_tile_ids(data_path, max_lines=5000)
    vocab = make_vocab_with_start_goal(tile_ids)
    log_progress(f"vocab_size={vocab.size} tile_ids={vocab.tile_ids}", out_dir)

    # Store indices for auxiliary losses
    start_idx = vocab.tile_ids.index(START_TILE_ID)
    goal_idx = vocab.tile_ids.index(GOAL_TILE_ID)

    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)

    # Model
    config = diffusion_config_for_preset(args.preset)
    config.vocab_size = vocab.size
    model = DiscreteDiffusionModel(config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})", out_dir)

    # Optimizer
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )

    # AMP
    scaler = None
    use_amp = args.amp and device.type in {"cuda", "mps"}
    if use_amp and device.type == "cuda":
        scaler = torch.cuda.amp.GradScaler()

    global_step = 0
    last_metrics: Dict[str, float] = {}

    for epoch in range(args.epochs):
        dataset = JsonlMazeDataset(
            data_path,
            split="train",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=args.shuffle_buffer,
            shuffle_seed=epoch + 13,
            map_type="ice",
        )
        loader = DataLoader(
            dataset,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            collate_fn=CollateFn(vocab),
        )

        model.train()
        t0 = time.time()
        epoch_loss = 0.0
        epoch_samples = 0
        abort_training = False

        pbar = tqdm(loader, desc=f"epoch {epoch + 1}", total=steps_per_epoch)
        for batch in pbar:
            seeds = batch["seeds"]
            width = int(batch["widths"][0].item())
            height = int(batch["heights"][0].item())

            tiles = batch["tiles"].to(device)  # (B, H, W)
            batch_size = tiles.shape[0]
            
            latents = model.latent_from_seeds(seeds, device)

            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                # Sample random timesteps
                t = torch.randint(0, model.num_timesteps, (batch_size,), device=device)
                
                # Forward diffusion: corrupt tiles
                x_t = model.q_sample(tiles, t)
                
                # Predict original tiles
                outputs = model(x_t, t, latents)
                logits = outputs["logits"]  # (B, vocab_size, H, W)
                
                # Cross-entropy loss: predict x_0 from x_t
                # Only compute loss on masked positions (where we're actually predicting)
                ce_loss = F.cross_entropy(
                    logits,  # (B, vocab_size, H, W)
                    tiles,   # (B, H, W)
                )
                
                # Auxiliary losses on predicted probabilities
                probs = F.softmax(logits, dim=1)  # (B, vocab_size, H, W)
                
                # Count penalty: expected START should be 1
                expected_start = probs[:, start_idx, :, :].sum(dim=(1, 2))  # (B,)
                start_penalty = (expected_start - 1.0).abs().mean()
                
                # Count penalty: expected GOAL should be 1
                expected_goal = probs[:, goal_idx, :, :].sum(dim=(1, 2))  # (B,)
                goal_penalty = (expected_goal - 1.0).abs().mean()
                
                # Combined loss
                loss = ce_loss + 1.0 * start_penalty + 1.0 * goal_penalty

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; stopping", out_dir)
                abort_training = True
                break

            epoch_loss += loss.item() * batch_size
            epoch_samples += batch_size

            optimizer.zero_grad(set_to_none=True)
            if scaler is not None:
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
                scaler.step(optimizer)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip_grad)
                optimizer.step()

            if global_step % args.log_every == 0:
                dt = time.time() - t0
                log_progress(f"step {global_step} loss={loss.item():.4f} dt={dt:.1f}s", out_dir)

            if global_step > 0 and global_step % args.save_every == 0:
                ckpt = {
                    "model_state": model.state_dict(),
                    "optimizer_state": optimizer.state_dict(),
                    "global_step": global_step,
                    "config": config,
                    "tile_ids": vocab.tile_ids,
                }
                ckpt_path = out_dir / f"checkpoint_{global_step:08d}.pt"
                torch.save(ckpt, ckpt_path)
                with open(out_dir / "latest.json", "w") as f:
                    json.dump({"checkpoint": str(ckpt_path), "step": global_step}, f)

            global_step += 1
            pbar.set_postfix(loss=f"{loss.item():.4f}")
            
            if global_step >= steps_per_epoch * (epoch + 1):
                break

        if abort_training:
            break

        # End of epoch: validation
        model.eval()
        val_dataset = JsonlMazeDataset(
            data_path,
            split="val",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            map_type="ice",
        )
        val_loader = DataLoader(
            val_dataset, batch_size=args.batch_size, collate_fn=CollateFn(vocab)
        )
        
        val_loss = 0.0
        val_correct = 0
        val_total = 0
        val_samples = 0
        
        with torch.no_grad():
            for batch in val_loader:
                tiles = batch["tiles"].to(device)
                seeds = batch["seeds"]
                batch_size = tiles.shape[0]
                
                latents = model.latent_from_seeds(seeds, device)
                
                # Use t=0 for validation (fully masked -> predict all)
                t = torch.zeros(batch_size, dtype=torch.long, device=device)
                x_t = torch.full_like(tiles, model.mask_token_id)
                
                outputs = model(x_t, t, latents)
                logits = outputs["logits"]
                
                loss = F.cross_entropy(logits, tiles)
                val_loss += loss.item() * batch_size
                val_samples += batch_size
                
                preds = logits.argmax(dim=1)
                val_correct += (preds == tiles).sum().item()
                val_total += tiles.numel()
        
        val_loss /= max(1, val_samples)
        val_acc = val_correct / max(1, val_total)
        log_progress(f"val loss={val_loss:.4f} acc={val_acc:.3f}", out_dir)
        
        # Generate samples
        gen_results = generate_and_analyze(model, vocab, device, args.generate_samples)
        start_pct = gen_results["exactly_1_start"] / gen_results["total"] * 100
        goal_pct = gen_results["exactly_1_goal"] / gen_results["total"] * 100
        valid_pct = gen_results["valid_structure"] / gen_results["total"] * 100
        log_progress(
            f"gen samples={gen_results['total']} 1_start={start_pct:.1f}% 1_goal={goal_pct:.1f}% valid={valid_pct:.1f}%",
            out_dir,
        )

    # Save final checkpoint
    ckpt = {
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "global_step": global_step,
        "config": config,
        "tile_ids": vocab.tile_ids,
    }
    ckpt_path = out_dir / f"checkpoint_{global_step:08d}.pt"
    torch.save(ckpt, ckpt_path)

    # Test evaluation
    if args.eval_test:
        model.eval()
        test_dataset = JsonlMazeDataset(
            data_path,
            split="test",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            map_type="ice",
        )
        test_loader = DataLoader(
            test_dataset, batch_size=args.batch_size, collate_fn=CollateFn(vocab)
        )
        
        test_loss = 0.0
        test_correct = 0
        test_total = 0
        test_samples = 0
        
        with torch.no_grad():
            for batch in test_loader:
                tiles = batch["tiles"].to(device)
                seeds = batch["seeds"]
                batch_size = tiles.shape[0]
                
                latents = model.latent_from_seeds(seeds, device)
                t = torch.zeros(batch_size, dtype=torch.long, device=device)
                x_t = torch.full_like(tiles, model.mask_token_id)
                
                outputs = model(x_t, t, latents)
                logits = outputs["logits"]
                
                loss = F.cross_entropy(logits, tiles)
                test_loss += loss.item() * batch_size
                test_samples += batch_size
                
                preds = logits.argmax(dim=1)
                test_correct += (preds == tiles).sum().item()
                test_total += tiles.numel()
        
        test_loss /= max(1, test_samples)
        test_acc = test_correct / max(1, test_total)
        log_progress(f"test loss={test_loss:.4f} acc={test_acc:.3f}", out_dir)

        # Final generation analysis
        gen_results = generate_and_analyze(model, vocab, device, 256)
        start_pct = gen_results["exactly_1_start"] / gen_results["total"] * 100
        goal_pct = gen_results["exactly_1_goal"] / gen_results["total"] * 100
        valid_pct = gen_results["valid_structure"] / gen_results["total"] * 100
        log_progress(
            f"final gen samples={gen_results['total']} 1_start={start_pct:.1f}% 1_goal={goal_pct:.1f}% valid={valid_pct:.1f}%",
            out_dir,
        )


if __name__ == "__main__":
    main()
