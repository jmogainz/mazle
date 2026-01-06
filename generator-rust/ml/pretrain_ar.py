"""Training script for autoregressive puzzle generator.

This trains the model to predict tiles sequentially, conditioned on:
1. The seed (latent embedding)
2. All previously placed tiles (teacher forcing during training)

The key difference from feedforward: each tile prediction sees all previous tiles,
so the model can learn "exactly 1 START" naturally.
"""
import argparse
import json
import math
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from tqdm import tqdm

from data import JsonlMazeDataset, TileVocab, collect_tile_ids, CollateFn
from model_ar import AutoregressivePuzzleModel, ARModelConfig, ar_config_for_preset
from utils import configure_torch_for_perf, select_device


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Autoregressive puzzle pretraining")
    parser.add_argument("--data", type=Path, required=True, help="Path to JSONL dataset")
    parser.add_argument("--out", type=Path, required=True, help="Output dir for checkpoints")
    parser.add_argument("--data-count", type=int, default=None, help="Number of samples in dataset")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--clip-grad", type=float, default=1.0)
    parser.add_argument("--preset", type=str, default="base", choices=["base", "large", "xl"])
    parser.add_argument("--val-pct", type=float, default=0.02)
    parser.add_argument("--test-pct", type=float, default=0.01)
    parser.add_argument("--shuffle-buffer", type=int, default=4096)
    parser.add_argument("--eval-steps", type=int, default=100)
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--save-every", type=int, default=2000)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--amp", action="store_true", default=True)
    parser.add_argument("--no-amp", action="store_false", dest="amp")
    parser.add_argument("--eval-test", action="store_true", default=True)
    parser.add_argument("--no-eval-test", action="store_false", dest="eval_test")
    parser.add_argument("--generate-samples", type=int, default=8, help="Samples to generate for eval")
    return parser


def count_lines(path: Path) -> int:
    count = 0
    with path.open("r") as f:
        for _ in f:
            count += 1
    return count


def save_checkpoint(
    out_dir: Path,
    step: int,
    model: AutoregressivePuzzleModel,
    optimizer: torch.optim.Optimizer,
    config: ARModelConfig,
    tile_ids: List[int],
):
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt = {
        "step": step,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "config": config,
        "tile_ids": tile_ids,
    }
    path = out_dir / f"checkpoint_{step:08d}.pt"
    torch.save(ckpt, path)
    
    latest = out_dir / "latest.json"
    with latest.open("w") as f:
        json.dump({"step": step, "path": path.name}, f)


@torch.no_grad()
def evaluate(
    model: AutoregressivePuzzleModel,
    loader: DataLoader,
    device: torch.device,
    max_steps: int,
):
    """Evaluate model on validation/test set."""
    model.eval()
    total_loss = 0.0
    total_tokens = 0
    correct_tokens = 0
    steps = 0

    for batch in loader:
        steps += 1
        seeds = batch["seeds"]
        width = int(batch["widths"][0].item())
        height = int(batch["heights"][0].item())
        seq_len = width * height

        tiles = batch["tiles"].to(device)  # (B, H, W)
        tiles_seq = tiles.view(tiles.shape[0], -1)  # (B, seq_len)

        latents = model.latent_from_seeds(seeds, device)
        outputs = model(latents, tiles, width, height)
        logits = outputs["tile_logits"]  # (B, seq_len, vocab_size)

        # Cross-entropy loss
        loss = F.cross_entropy(
            logits.view(-1, logits.size(-1)),
            tiles_seq.view(-1),
            reduction='sum'
        )

        total_loss += loss.item()
        total_tokens += tiles_seq.numel()

        # Accuracy
        preds = logits.argmax(dim=-1)  # (B, seq_len)
        correct_tokens += (preds == tiles_seq).sum().item()

        if steps >= max_steps:
            break

    avg_loss = total_loss / max(total_tokens, 1)
    accuracy = correct_tokens / max(total_tokens, 1)
    return avg_loss, accuracy


@torch.no_grad()
def generate_and_analyze(
    model: AutoregressivePuzzleModel,
    vocab: TileVocab,
    device: torch.device,
    num_samples: int = 8,
):
    """Generate samples and analyze quality."""
    from data import START_TILE_ID, GOAL_TILE_ID
    
    model.eval()
    seeds = [f"eval-{i}" for i in range(num_samples)]
    latents = model.latent_from_seeds(seeds, device)
    
    # Generate with temp=1.0 sampling (model learned the distribution)
    # Use seeded RNG for reproducibility
    torch.manual_seed(42)
    generated = model.generate(latents, temperature=1.0, top_k=None)  # (B, H, W)
    
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


def run_training(args: argparse.Namespace) -> Dict[str, float]:
    device = select_device()
    configure_torch_for_perf(device)

    data_path = args.data
    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    progress_log = out_dir / "progress.log"
    progress_fh = progress_log.open("a")

    def log_progress(msg: str):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
        print(line)
        progress_fh.write(line + "\n")
        progress_fh.flush()

    log_progress(f"device={device}")
    log_progress(f"mps_available={torch.backends.mps.is_available()}")

    # Collect tile IDs and create vocab with START/GOAL
    tile_ids = collect_tile_ids(data_path, max_lines=5000)
    from data import make_vocab_with_start_goal
    vocab = make_vocab_with_start_goal(tile_ids)
    log_progress(f"vocab_size={vocab.size} tile_ids={vocab.tile_ids}")

    from data import START_TILE_ID, GOAL_TILE_ID
    
    # Store indices for auxiliary losses
    start_idx = vocab.tile_ids.index(START_TILE_ID)
    goal_idx = vocab.tile_ids.index(GOAL_TILE_ID)
    
    # Target tile distribution (from training data analysis)
    # ice: 72.8%, wall: 17.8%, ledges: ~1.9% each, floor: 0.5%, start/goal: 0.6% each
    target_dist = torch.zeros(vocab.size, device=device)
    dist_map = {
        0: 0.005,   # floor
        1: 0.178,   # wall  
        4: 0.728,   # ice
        5: 0.019,   # ledge_u
        6: 0.019,   # ledge_d
        7: 0.019,   # ledge_l
        8: 0.019,   # ledge_r
        START_TILE_ID: 0.006,
        GOAL_TILE_ID: 0.006,
    }
    for i, tile_id in enumerate(vocab.tile_ids):
        target_dist[i] = dist_map.get(tile_id, 0.01)
    target_dist = target_dist / target_dist.sum()  # normalize
    log_progress(f"target_dist={[f'{d:.3f}' for d in target_dist.tolist()]}")

    # Data count
    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)

    # Model
    config = ar_config_for_preset(args.preset)
    model = AutoregressivePuzzleModel(vocab.size, config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})")

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
        # Scheduled sampling: linearly increase sample_prob from 0 to 0.5 over epochs
        # Epoch 0: 0%, Epoch 5: 25%, Epoch 10: 50%
        sample_prob = min(0.5, epoch / (args.epochs * 2))
        log_progress(f"epoch {epoch + 1} sample_prob={sample_prob:.2f}")
        
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
            tiles_seq = tiles.view(tiles.shape[0], -1)  # (B, seq_len)

            latents = model.latent_from_seeds(seeds, device)
            batch_size = latents.shape[0]
            seq_len = width * height

            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                outputs = model(latents, tiles, width, height, sample_prob=sample_prob)
                logits = outputs["tile_logits"]  # (B, seq_len, vocab_size)
                
                # 1. Cross-entropy loss (main loss)
                ce_loss = F.cross_entropy(
                    logits.view(-1, logits.size(-1)),
                    tiles_seq.view(-1),
                )
                
                # 2. Auxiliary losses on softmax probabilities
                probs = F.softmax(logits, dim=-1)  # (B, seq_len, vocab_size)
                
                # 2a. Count penalty: expected START count should be 1
                expected_start = probs[:, :, start_idx].sum(dim=1)  # (B,)
                start_penalty = (expected_start - 1.0).abs().mean()
                
                # 2b. Count penalty: expected GOAL count should be 1
                expected_goal = probs[:, :, goal_idx].sum(dim=1)  # (B,)
                goal_penalty = (expected_goal - 1.0).abs().mean()
                
                # 2c. KL divergence: predicted tile distribution should match training distribution
                # Average predicted distribution across batch and sequence
                pred_dist = probs.mean(dim=(0, 1))  # (vocab_size,)
                # KL(target || pred) - encourages pred to cover target
                kl_loss = F.kl_div(pred_dist.log(), target_dist, reduction='sum')
                
                # Combined loss with weights
                # λ1=2.0 for count penalties (strong signal for exactly-1 constraint)
                # λ2=0.5 for KL (softer signal for distribution matching)
                loss = ce_loss + 2.0 * start_penalty + 2.0 * goal_penalty + 0.5 * kl_loss

            if not torch.isfinite(loss):
                log_progress(f"nan loss at step {global_step}; stopping")
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
                pbar.set_postfix(loss=f"{loss.item():.4f}", step=global_step, dt=f"{dt:.1f}s")
                log_progress(f"step {global_step} loss={loss.item():.4f} dt={dt:.1f}s")

            if args.save_every > 0 and global_step % args.save_every == 0 and global_step > 0:
                save_checkpoint(out_dir, global_step, model, optimizer, config, vocab.tile_ids)

            global_step += 1

        if abort_training:
            break

        # End of epoch validation
        val_dataset = JsonlMazeDataset(
            data_path,
            split="val",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=0,
            shuffle_seed=99,
            map_type="ice",
        )
        val_loader = DataLoader(
            val_dataset,
            batch_size=args.batch_size,
            num_workers=0,
            collate_fn=CollateFn(vocab),
        )
        val_loss, val_acc = evaluate(model, val_loader, device, args.eval_steps)
        train_loss = epoch_loss / max(epoch_samples, 1)
        
        log_progress(f"val loss={val_loss:.4f} acc={val_acc:.3f}")

        # Generate samples and analyze
        gen_results = generate_and_analyze(model, vocab, device, args.generate_samples)
        start_rate = gen_results["exactly_1_start"] / gen_results["total"]
        goal_rate = gen_results["exactly_1_goal"] / gen_results["total"]
        valid_rate = gen_results["valid_structure"] / gen_results["total"]
        log_progress(f"gen samples={gen_results['total']} 1_start={start_rate:.1%} 1_goal={goal_rate:.1%} valid={valid_rate:.1%}")

        last_metrics = {
            "epoch": epoch + 1,
            "train_loss": train_loss,
            "val_loss": val_loss,
            "val_acc": val_acc,
            "gen_1_start_rate": start_rate,
            "gen_1_goal_rate": goal_rate,
            "gen_valid_rate": valid_rate,
        }

    # Final test evaluation
    if args.eval_test:
        test_dataset = JsonlMazeDataset(
            data_path,
            split="test",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=0,
            shuffle_seed=103,
            map_type="ice",
        )
        test_loader = DataLoader(
            test_dataset,
            batch_size=args.batch_size,
            num_workers=0,
            collate_fn=CollateFn(vocab),
        )
        test_loss, test_acc = evaluate(model, test_loader, device, args.eval_steps)
        log_progress(f"test loss={test_loss:.4f} acc={test_acc:.3f}")
        
        # Final generation analysis
        gen_results = generate_and_analyze(model, vocab, device, args.generate_samples * 4)
        start_rate = gen_results["exactly_1_start"] / gen_results["total"]
        goal_rate = gen_results["exactly_1_goal"] / gen_results["total"]
        valid_rate = gen_results["valid_structure"] / gen_results["total"]
        log_progress(f"final gen samples={gen_results['total']} 1_start={start_rate:.1%} 1_goal={goal_rate:.1%} valid={valid_rate:.1%}")
        
        last_metrics.update({
            "test_loss": test_loss,
            "test_acc": test_acc,
            "final_1_start_rate": start_rate,
            "final_1_goal_rate": goal_rate,
            "final_valid_rate": valid_rate,
        })

    save_checkpoint(out_dir, global_step, model, optimizer, config, vocab.tile_ids)
    progress_fh.close()
    return last_metrics


def main():
    parser = build_parser()
    args = parser.parse_args()
    run_training(args)


if __name__ == "__main__":
    main()
