import argparse
import copy
import json
import os
import uuid
from pathlib import Path
from typing import Dict, Optional

from ray import tune
from ray.tune.schedulers import ASHAScheduler

from pretrain import run_training


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
    parser = argparse.ArgumentParser(
        description="Mazle pretraining hyperparameter tuning"
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to JSON config")
    parser.add_argument("--data", type=Path, default=None, help="Path to JSONL dataset")
    parser.add_argument("--out", type=Path, default=None, help="Output dir for Ray results")
    parser.add_argument("--data-count", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--clip-grad", type=float, default=1.0)
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
    parser.add_argument("--log-every", type=int, default=100)
    parser.add_argument("--save-every", type=int, default=0)
    parser.add_argument("--amp", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--compile", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--num-workers", type=int, default=0)

    parser.add_argument("--num-samples", type=int, default=8)
    parser.add_argument("--max-concurrent", type=int, default=1)
    parser.add_argument("--cpus-per-trial", type=int, default=None)
    parser.add_argument("--metric", type=str, default="val_loss")
    parser.add_argument("--mode", type=str, default="min", choices=["min", "max"])
    parser.add_argument("--tune-arch", action="store_true")
    parser.add_argument("--ray-out", type=Path, default=None)
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
            if key in {"data", "out", "ray_out"}:
                value = _resolve_path(value, pre_args.config.parent)
            filtered[key] = value
        parser.set_defaults(**filtered)
    return parser.parse_args()


def _trial_id() -> str:
    try:
        from ray.air import session

        trial_id = session.get_trial_id()
        if trial_id:
            return trial_id
    except Exception:
        pass
    env_id = os.environ.get("TUNE_TRIAL_ID") or os.environ.get("RAY_TRIAL_ID")
    return env_id or uuid.uuid4().hex[:8]


def _report(metrics: Dict[str, float]) -> None:
    try:
        from ray.air import session

        session.report(metrics)
    except Exception:
        tune.report(**metrics)


def _build_base_args(args: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        data=args.data,
        out=args.out,
        data_count=args.data_count,
        epochs=args.epochs,
        max_steps=args.max_steps,
        batch_size=args.batch_size,
        lr=args.lr,
        weight_decay=args.weight_decay,
        clip_grad=args.clip_grad,
        tile_ids=None,
        preset=args.preset,
        latent_dim=args.latent_dim,
        cond_dim=args.cond_dim,
        model_dim=args.model_dim,
        num_layers=args.num_layers,
        num_heads=args.num_heads,
        conv_blocks=args.conv_blocks,
        dropout=args.dropout,
        mlp_ratio=args.mlp_ratio,
        shuffle_buffer=args.shuffle_buffer,
        val_pct=args.val_pct,
        test_pct=args.test_pct,
        eval_steps=args.eval_steps,
        eval_test=args.eval_test,
        solver_eval=args.solver_eval,
        solver_eval_samples=args.solver_eval_samples,
        solver_target_moves=args.solver_target_moves,
        log_every=args.log_every,
        save_every=args.save_every,
        resume=None,
        amp=args.amp,
        compile=args.compile,
        num_workers=args.num_workers,
    )


def _build_search_space(args: argparse.Namespace) -> Dict[str, object]:
    space: Dict[str, object] = {
        "lr": tune.loguniform(1e-4, 3e-3),
        "weight_decay": tune.loguniform(1e-4, 3e-2),
        "dropout": tune.uniform(0.05, 0.2),
        "batch_size": tune.choice([32, 48, 64, 96]),
    }

    if args.tune_arch:
        space.update(
            {
                "latent_dim": tune.choice([384, 512, 640]),
                "cond_dim": tune.choice([768, 1024, 1280]),
                "model_dim": tune.choice([384, 512, 640]),
                "num_layers": tune.choice([8, 10, 12]),
                "num_heads": tune.choice([8, 12]),
                "conv_blocks": tune.choice([6, 8, 10]),
            }
        )

    return space


def main() -> None:
    args = parse_args()
    if args.data is None or args.out is None:
        raise ValueError("--data and --out are required (or provided via --config)")
    if not isinstance(args.data, Path) or not isinstance(args.out, Path):
        raise ValueError("--data and --out must be paths")
    base_args = _build_base_args(args)

    ray_out = args.ray_out or args.out
    cpus_per_trial = args.cpus_per_trial or max(1, (os.cpu_count() or 4) // 2)

    scheduler = ASHAScheduler(
        metric=args.metric,
        mode=args.mode,
        max_t=args.epochs,
        grace_period=1,
        reduction_factor=2,
    )

    search_space = _build_search_space(args)

    def train_fn(config: Dict[str, object]) -> None:
        trial_args = copy.deepcopy(base_args)
        for key, value in config.items():
            setattr(trial_args, key, value)

        trial_dir = base_args.out / f"trial_{_trial_id()}"
        trial_dir.mkdir(parents=True, exist_ok=True)
        trial_args.out = trial_dir
        run_training(trial_args, report_fn=_report)

    analysis = tune.run(
        train_fn,
        config=search_space,
        num_samples=args.num_samples,
        scheduler=scheduler,
        metric=args.metric,
        mode=args.mode,
        local_dir=str(ray_out),
        resources_per_trial={"cpu": cpus_per_trial},
        max_concurrent_trials=args.max_concurrent,
    )

    best_config = analysis.get_best_config(metric=args.metric, mode=args.mode)
    print(f"best config ({args.metric} {args.mode}): {best_config}")


if __name__ == "__main__":
    main()
