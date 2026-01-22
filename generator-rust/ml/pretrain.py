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
from model import MazleGeneratorModel, ModelConfig, config_for_preset
from utils import configure_torch_for_perf, select_device


def load_config(path: Path) -> Dict[str, object]:
    suffix = path.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        try:
            import yaml  # type: ignore
        except Exception as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "PyYAML is required for YAML configs. Install with:\n"
                "  pip install -r generator-rust/ml/requirements.txt"
            ) from exc
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    else:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("config must be a mapping object")
    return data


def _resolve_path(value: object, base: Path) -> object:
    if not isinstance(value, str):
        return value
    p = Path(value).expanduser()
    if not p.is_absolute():
        p = (base / p).resolve()
    return p


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mazle imitation pretraining")
    parser.add_argument("--config", type=Path, default=None, help="Path to JSON config")
    parser.add_argument("--data", type=Path, default=None, help="Path to JSONL dataset")
    parser.add_argument("--out", type=Path, default=None, help="Output dir for checkpoints")
    parser.add_argument(
        "--data-count", type=int, default=None, help="Number of samples in dataset"
    )
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--clip-grad", type=float, default=1.0)
    parser.add_argument("--tile-ids", type=str, default=None, help="Comma-separated tile ids")
    parser.add_argument(
        "--preset",
        type=str,
        default="xl",
        choices=["base", "large", "xl"],
        help="Model size preset",
    )
    parser.add_argument("--latent-dim", type=int, default=None)
    parser.add_argument("--cond-dim", type=int, default=None)
    parser.add_argument("--model-dim", type=int, default=None)
    parser.add_argument("--num-layers", type=int, default=None)
    parser.add_argument("--num-heads", type=int, default=None)
    parser.add_argument("--conv-blocks", type=int, default=None)
    parser.add_argument("--dropout", type=float, default=None)
    parser.add_argument("--mlp-ratio", type=int, default=None)
    parser.add_argument("--shuffle-buffer", type=int, default=4096)
    parser.add_argument("--val-pct", type=float, default=0.02)
    parser.add_argument("--test-pct", type=float, default=0.01)
    parser.add_argument("--eval-steps", type=int, default=100)
    parser.add_argument(
        "--eval-test", action=argparse.BooleanOptionalAction, default=False
    )
    parser.add_argument(
        "--solver-eval", action=argparse.BooleanOptionalAction, default=False
    )
    parser.add_argument("--solver-eval-samples", type=int, default=256)
    parser.add_argument("--solver-target-moves", type=int, default=10)
    parser.add_argument("--log-every", type=int, default=50)
    parser.add_argument("--save-every", type=int, default=1000)
    parser.add_argument("--resume", type=Path, default=None)
    parser.add_argument("--amp", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--compile", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--num-workers", type=int, default=0)
    return parser


def parse_args() -> argparse.Namespace:
    config_parser = argparse.ArgumentParser(add_help=False)
    config_parser.add_argument("--config", type=Path, default=None)
    pre_args, _ = config_parser.parse_known_args()

    parser = build_parser()
    if pre_args.config:
        config = load_config(pre_args.config)
        valid_keys = {action.dest for action in parser._actions}
        filtered: Dict[str, object] = {}
        for key, value in config.items():
            if key not in valid_keys:
                continue
            if key in {"data", "out", "resume"}:
                value = _resolve_path(value, pre_args.config.parent)
            filtered[key] = value
        parser.set_defaults(**filtered)
    return parser.parse_args()


def count_lines(path: Path) -> int:
    count = 0
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                count += 1
    return count


def parse_tile_ids(arg: Optional[str]) -> Optional[List[int]]:
    if not arg:
        return None
    return [int(x.strip()) for x in arg.split(",") if x.strip()]


def save_checkpoint(
    out_dir: Path,
    step: int,
    model: MazleGeneratorModel,
    optimizer: torch.optim.Optimizer,
    config: ModelConfig,
    tile_ids: List[int],
):
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "step": step,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict(),
        "config": config.__dict__,
        "tile_ids": tile_ids,
    }
    ckpt_path = out_dir / f"checkpoint_{step:08d}.pt"
    torch.save(payload, ckpt_path)

    meta = {
        "latest_checkpoint": ckpt_path.name,
        "step": step,
        "config": config.__dict__,
        "tile_ids": tile_ids,
    }
    (out_dir / "latest.json").write_text(json.dumps(meta, indent=2))


@torch.no_grad()
def evaluate(
    model: MazleGeneratorModel,
    loader: DataLoader,
    device: torch.device,
    max_steps: int,
):
    model.eval()
    total_loss = 0.0
    total_tiles = 0
    correct_tiles = 0
    steps = 0
    total_samples = 0

    for batch in loader:
        steps += 1
        seeds = batch["seeds"]
        width = int(batch["widths"][0].item())
        height = int(batch["heights"][0].item())
        batch_size = len(seeds)

        tiles = batch["tiles"].to(device)

        latents = model.latent_from_seeds(seeds, device)
        outputs = model(latents, width, height)

        tile_logits = outputs["tile_logits"]
        loss = F.cross_entropy(tile_logits, tiles)

        total_loss += loss.item() * batch_size
        total_samples += batch_size
        pred_tiles = tile_logits.argmax(dim=1)
        correct_tiles += (pred_tiles == tiles).sum().item()
        total_tiles += tiles.numel()

        if steps >= max_steps:
            break

    avg_loss = total_loss / max(total_samples, 1)
    tile_acc = correct_tiles / max(total_tiles, 1)
    return avg_loss, tile_acc


def run_training(
    args: argparse.Namespace,
    report_fn: Optional[Callable[[Dict[str, float]], None]] = None,
) -> Dict[str, float]:
    device = select_device()
    configure_torch_for_perf(device)

    if args.data is None or args.out is None:
        raise ValueError("--data and --out are required (or provided via --config)")

    if not isinstance(args.data, Path) or not isinstance(args.out, Path):
        raise ValueError("--data and --out must be paths")

    args.out.mkdir(parents=True, exist_ok=True)
    progress_path = args.out / "progress.log"
    progress_fh = progress_path.open("a", encoding="utf-8")

    def log_progress(message: str) -> None:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"{timestamp} {message}"
        tqdm.write(line)
        try:
            progress_fh.write(line + "\n")
            progress_fh.flush()
        except Exception:
            pass

    log_progress(f"device={device.type}")
    if device.type == "mps":
        log_progress(f"mps_available={torch.backends.mps.is_available()}")

    data_path = args.data
    if not data_path.exists():
        raise FileNotFoundError(data_path)

    tile_ids = parse_tile_ids(args.tile_ids)
    if tile_ids is None:
        tile_ids = collect_tile_ids(data_path, max_lines=5000)

    # Import and use make_vocab_with_start_goal to add START/GOAL tile types
    from data import make_vocab_with_start_goal
    vocab = make_vocab_with_start_goal(tile_ids)

    data_count = args.data_count
    if data_count is None:
        data_count = count_lines(data_path)

    if args.val_pct < 0.0 or args.test_pct < 0.0 or args.val_pct + args.test_pct >= 1.0:
        raise ValueError("val_pct + test_pct must be in [0, 1)")
    train_count = max(1, int(data_count * (1.0 - args.val_pct - args.test_pct)))
    steps_per_epoch = math.ceil(train_count / args.batch_size)
    max_steps = args.max_steps or steps_per_epoch * args.epochs

    config = config_for_preset(args.preset)
    if args.latent_dim is not None:
        config.latent_dim = args.latent_dim
    if args.cond_dim is not None:
        config.cond_dim = args.cond_dim
    if args.model_dim is not None:
        config.model_dim = args.model_dim
    if args.num_layers is not None:
        config.num_layers = args.num_layers
    if args.num_heads is not None:
        config.num_heads = args.num_heads
    if args.conv_blocks is not None:
        config.conv_blocks = args.conv_blocks
    if args.dropout is not None:
        config.dropout = args.dropout
    if args.mlp_ratio is not None:
        config.mlp_ratio = args.mlp_ratio
    model = MazleGeneratorModel(vocab.size, config).to(device)
    param_count = sum(p.numel() for p in model.parameters())
    log_progress(f"model params: {param_count/1e6:.1f}M (preset={args.preset})")

    if args.compile:
        model = torch.compile(model)  # type: ignore[assignment]

    # Compute class weights for imbalanced tile distribution
    # Using full inverse frequency weights (no dampening) to force learning of rare classes
    # Frequencies: ice ~73%, wall ~18%, ledges ~2% each, floor ~0.5%, start/goal ~0.6% each
    from data import START_TILE_ID, GOAL_TILE_ID
    class_weights = torch.ones(vocab.size, device=device)
    for i, tile_id in enumerate(vocab.tile_ids):
        if tile_id == 4:  # ice - 72.8%
            class_weights[i] = 1.0
        elif tile_id == 1:  # wall - 17.8%
            class_weights[i] = 4.0
        elif tile_id in (5, 6, 7, 8):  # ledges - ~1.9% each
            class_weights[i] = 38.0
        elif tile_id == 0:  # floor - 0.54%
            class_weights[i] = 135.0
        elif tile_id == START_TILE_ID:  # START - 0.59%, must be exactly 1
            class_weights[i] = 125.0
        elif tile_id == GOAL_TILE_ID:  # GOAL - 0.59%, must be exactly 1
            class_weights[i] = 125.0
    log_progress(f"class weights: {class_weights.tolist()}")

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )

    start_step = 0
    if args.resume:
        ckpt = torch.load(args.resume, map_location=device)
        model.load_state_dict(ckpt["model_state"])
        optimizer.load_state_dict(ckpt["optimizer_state"])
        start_step = int(ckpt.get("step", 0))

    scaler = None
    use_amp = args.amp and device.type in {"cuda", "mps"}
    if use_amp and device.type == "cuda":
        scaler = torch.cuda.amp.GradScaler()

    global_step = start_step
    last_metrics: Dict[str, float] = {}
    for epoch in range(args.epochs):
        dataset = JsonlMazeDataset(
            data_path,
            split="train",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=args.shuffle_buffer,
            shuffle_seed=epoch + 13,
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
        stop_after_eval = False
        abort_training = False
        pbar = tqdm(loader, total=steps_per_epoch, desc=f"epoch {epoch+1}")
        for batch in pbar:
            if global_step >= max_steps:
                stop_after_eval = True
                break

            seeds = batch["seeds"]
            width = int(batch["widths"][0].item())
            height = int(batch["heights"][0].item())
            if (batch["widths"] != width).any() or (batch["heights"] != height).any():
                raise ValueError("mixed sizes in a batch are not supported yet")

            tiles = batch["tiles"].to(device)

            latents = model.latent_from_seeds(seeds, device)
            batch_size = latents.shape[0]

            with torch.autocast(
                device_type=device.type, dtype=torch.float16, enabled=use_amp
            ):
                outputs = model(latents, width, height)
                tile_logits = outputs["tile_logits"]
                loss = F.cross_entropy(tile_logits, tiles, weight=class_weights)

            if not torch.isfinite(loss):
                nan_metrics = {
                    "epoch": float(epoch + 1),
                    "step": float(global_step),
                    "train_loss": float("inf"),
                    "val_loss": float("inf"),
                    "nan_loss": 1.0,
                }
                log_progress(f"nan loss at step {global_step}; stopping trial")
                if report_fn is not None:
                    report_fn(nan_metrics)
                last_metrics = nan_metrics
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

            if (
                args.save_every > 0
                and global_step % args.save_every == 0
                and global_step > start_step
            ):
                save_checkpoint(args.out, global_step, model, optimizer, config, vocab.tile_ids)

            global_step += 1

        if abort_training:
            break

        val_dataset = JsonlMazeDataset(
            data_path,
            split="val",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=0,
            shuffle_seed=99,
        )
        val_loader = DataLoader(
            val_dataset,
            batch_size=args.batch_size,
            num_workers=0,
            collate_fn=CollateFn(vocab),
        )
        val_loss, tile_acc = evaluate(
            model, val_loader, device, args.eval_steps
        )
        train_loss = epoch_loss / max(epoch_samples, 1)
        metrics = {
            "epoch": float(epoch + 1),
            "step": float(global_step),
            "train_loss": float(train_loss),
            "val_loss": float(val_loss),
            "val_tile_acc": float(tile_acc),
        }
        log_progress(
            f"val loss={val_loss:.4f} tile_acc={tile_acc:.3f}"
        )
        if args.solver_eval:
            from eval_solver import evaluate_solver

            solver_steps = max(1, math.ceil(args.solver_eval_samples / args.batch_size))
            solver_dataset = JsonlMazeDataset(
                data_path,
                split="val",
                val_pct=args.val_pct,
                test_pct=args.test_pct,
                shuffle_buffer=0,
                shuffle_seed=101,
            )
            solver_loader = DataLoader(
                solver_dataset,
                batch_size=args.batch_size,
                num_workers=0,
                collate_fn=CollateFn(vocab),
            )
            solver_metrics = evaluate_solver(
                model,
                solver_loader,
                vocab,
                device,
                solver_steps,
                target_moves=args.solver_target_moves,
            )
            for key, value in solver_metrics.to_dict().items():
                metrics[f"solver_{key}"] = float(value)
            log_progress(
                "solver "
                + " ".join(
                    f"{k}={v:.3f}" for k, v in solver_metrics.to_dict().items()
                )
            )

        if report_fn is not None:
            report_fn(metrics)
        last_metrics = metrics

        if stop_after_eval:
            break

    if args.eval_test:
        test_dataset = JsonlMazeDataset(
            data_path,
            split="test",
            val_pct=args.val_pct,
            test_pct=args.test_pct,
            shuffle_buffer=0,
            shuffle_seed=103,
        )
        test_loader = DataLoader(
            test_dataset,
            batch_size=args.batch_size,
            num_workers=0,
            collate_fn=CollateFn(vocab),
        )
        test_loss, tile_acc = evaluate(
            model, test_loader, device, args.eval_steps
        )
        test_metrics = {
            "test_loss": float(test_loss),
            "test_tile_acc": float(tile_acc),
        }
        log_progress(
            f"test loss={test_loss:.4f} tile_acc={tile_acc:.3f}"
        )
        if report_fn is not None:
            report_fn(test_metrics)
        last_metrics.update(test_metrics)

    save_checkpoint(args.out, global_step, model, optimizer, config, vocab.tile_ids)
    progress_fh.close()
    return last_metrics


def main() -> None:
    args = parse_args()
    run_training(args)


if __name__ == "__main__":
    main()
