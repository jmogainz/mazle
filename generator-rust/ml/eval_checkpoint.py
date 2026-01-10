
import argparse
import torch
import json
from pathlib import Path
from model_v2 import PuzzleGeneratorV2, config_for_preset
from pretrain_v2 import generate_and_validate, try_import_verifier

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, required=True)
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--k", type=int, default=1)
    parser.add_argument("--moves", type=int, default=10)
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--device", type=str, default="mps")
    args = parser.parse_args()

    device = torch.device(args.device)
    print(f"Loading {args.checkpoint} to {device}...")
    
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    config = ckpt["config"]
    
    model = PuzzleGeneratorV2(config).to(device)
    model.load_state_dict(ckpt["model_state"])
    print("Model loaded.")

    validate_fn = try_import_verifier()
    if not validate_fn:
        print("Error: Rust verifier not found!")
        return

    print(f"Generating {args.samples} samples (k={args.k}, moves={args.moves}, cfg={args.scale})...")
    metrics = generate_and_validate(
        model, device, validate_fn,
        num_samples=args.samples,
        k_candidates=args.k,
        target_moves=args.moves,
        guidance_scale=args.scale
    )
    
    print("\nResults:")
    print(json.dumps(metrics, indent=2))

if __name__ == "__main__":
    main()
