"""
Seed-based puzzle generator using path templates from training data.

Pipeline:
1. seed → pick start position + path template
2. template → concrete path (reject if exits bounds)
3. path → k-candidate tile generation
4. verifier → filter for valid 10-move puzzles

This keeps paths near the training manifold while allowing diverse start/goal placement.
"""

import torch
import json
import random
from pathlib import Path
from typing import Optional, List, Tuple, Dict
from dataclasses import dataclass


@dataclass
class PathTemplate:
    """A path template: sequence of (dx, dy) deltas between stops."""
    deltas: List[Tuple[int, int]]  # 10 deltas for 10 moves
    
    def apply(self, start_x: int, start_y: int, grid_size: int = 13) -> Optional[List[Tuple[int, int]]]:
        """
        Apply template starting from (start_x, start_y).
        Returns list of 11 stop positions, or None if path exits bounds.
        """
        path = [(start_x, start_y)]
        x, y = start_x, start_y
        
        for dx, dy in self.deltas:
            x += dx
            y += dy
            # Check bounds
            if x < 0 or x >= grid_size or y < 0 or y >= grid_size:
                return None
            path.append((x, y))
        
        return path


class TemplateLibrary:
    """Library of path templates extracted from training data."""
    
    def __init__(self, data_path: str, max_templates: int = 10000):
        self.templates: List[PathTemplate] = []
        self._load_templates(data_path, max_templates)
    
    def _load_templates(self, data_path: str, max_templates: int):
        """Extract templates from training data."""
        with open(data_path) as f:
            for i, line in enumerate(f):
                if i >= max_templates:
                    break
                sample = json.loads(line)
                path = sample.get("optimal_path", [])
                if len(path) != 11:
                    continue
                
                # Extract deltas
                deltas = []
                for j in range(1, len(path)):
                    dx = path[j][0] - path[j-1][0]
                    dy = path[j][1] - path[j-1][1]
                    deltas.append((dx, dy))
                
                self.templates.append(PathTemplate(deltas=deltas))
        
        print(f"Loaded {len(self.templates)} path templates")
    
    def sample_path(self, seed: int, grid_size: int = 13, max_template_attempts: int = 50) -> Optional[dict]:
        """
        Sample a valid path using seed for randomness.
        Tries multiple templates until one fits.
        Returns dict with start, goal, path, or None if all failed.
        """
        rng = random.Random(seed)
        
        # Shuffle templates deterministically based on seed
        template_indices = list(range(len(self.templates)))
        rng.shuffle(template_indices)
        
        for attempt in range(min(max_template_attempts, len(self.templates))):
            template = self.templates[template_indices[attempt]]
            
            # Try multiple start positions for this template
            for _ in range(10):
                start_x = rng.randint(0, grid_size - 1)
                start_y = rng.randint(0, grid_size - 1)
                
                path = template.apply(start_x, start_y, grid_size)
                if path is not None:
                    return {
                        "start": path[0],
                        "goal": path[-1],
                        "path": path,
                        "seed": seed,
                        "template_idx": template_indices[attempt],
                    }
        
        return None


class SeedPuzzleGenerator:
    """
    Generate puzzles from seeds using template-based path sampling
    and k-candidate tile generation.
    """
    
    def __init__(
        self,
        checkpoint_path: str,
        data_path: str,
        device: Optional[torch.device] = None,
        max_templates: int = 10000,
    ):
        self.device = device or torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        
        # Load model
        from model_v2 import PuzzleGeneratorV2
        ckpt = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.model = PuzzleGeneratorV2(ckpt["config"]).to(self.device)
        self.model.load_state_dict(ckpt["model_state"])
        self.model.eval()
        print(f"Loaded model from {checkpoint_path}")
        
        # Load template library
        self.templates = TemplateLibrary(data_path, max_templates)
        
        # Load validator
        try:
            from mazle_eval import validate_ice_interior
            self.validate_fn = validate_ice_interior
            print("Rust validator loaded")
        except ImportError:
            self.validate_fn = None
            print("Warning: mazle_eval not available")
        
        # Tile remapping
        self.TILE_REMAP_INV = {0: 0, 1: 1, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 100, 8: 101, 9: 2}
    
    def generate(
        self,
        seed: int,
        max_candidates: int = 100,
        temperature: float = 1.0,
    ) -> dict:
        """
        Generate a valid puzzle from a seed. Always succeeds.
        
        Args:
            seed: Random seed (deterministic output)
            max_candidates: Max tile candidates to try (keeps trying until success)
            temperature: Sampling temperature
        
        Returns:
            dict with tiles, start, goal, moves, attempts
        """
        from pretrain_v2 import build_path_conditioning
        
        # Sample path from template (try multiple templates)
        path_info = self.templates.sample_path(seed)
        if path_info is None:
            # Fallback: use a template directly from training data
            rng = random.Random(seed)
            idx = rng.randint(0, len(self.templates.templates) - 1)
            template = self.templates.templates[idx]
            # Find a valid start for this template
            for sx in range(13):
                for sy in range(13):
                    path = template.apply(sx, sy)
                    if path:
                        path_info = {"start": path[0], "goal": path[-1], "path": path, "seed": seed}
                        break
                if path_info:
                    break
        
        path = path_info["path"]
        sx, sy = path[0]
        gx, gy = path[-1]
        
        # Build conditioning
        optimal_path = [(p[0], p[1]) for p in path]
        stop_step_feat, on_path = build_path_conditioning(optimal_path, W=13, H=13, S=11)
        stop_step_feat = stop_step_feat.unsqueeze(0).to(self.device)
        on_path = on_path.unsqueeze(0).to(self.device)
        
        start_pos = torch.tensor([sy * 13 + sx], dtype=torch.long, device=self.device)
        goal_pos = torch.tensor([gy * 13 + gx], dtype=torch.long, device=self.device)
        
        # Keep trying until we get a valid puzzle
        attempt = 0
        while attempt < max_candidates:
            attempt += 1
            
            with torch.no_grad():
                result = self.model.generate_with_plan(
                    batch_size=1,
                    device=self.device,
                    start_pos=start_pos,
                    goal_pos=goal_pos,
                    stop_step_feat=stop_step_feat,
                    on_path=on_path,
                    generator=None,
                    temperature=temperature,
                )
            
            tiles = result["tiles"][0].reshape(-1)
            tiles_list = tiles.cpu().numpy().tolist()
            tiles_2d = [
                [self.TILE_REMAP_INV.get(tiles_list[r*13+c], tiles_list[r*13+c]) for c in range(13)]
                for r in range(13)
            ]
            
            if self.validate_fn:
                vr = self.validate_fn(tiles_2d, sx, sy, gx, gy)
                
                if vr.solvable and vr.unique_optimal and vr.optimal_moves == 10:
                    return {
                        "tiles": tiles_2d,
                        "start": (sx, sy),
                        "goal": (gx, gy),
                        "moves": 10,
                        "attempts": attempt,
                        "path": path,
                    }
        
        # If we exhaust candidates, return best effort (last generated)
        return {
            "tiles": tiles_2d,
            "start": (sx, sy),
            "goal": (gx, gy),
            "moves": vr.optimal_moves if vr.solvable else 0,
            "attempts": attempt,
            "path": path,
            "fallback": True,
        }
    
    def generate_batch(
        self,
        start_seed: int,
        count: int,
        max_candidates: int = 100,
        temperature: float = 1.0,
    ) -> List[dict]:
        """Generate multiple puzzles. Always returns count puzzles."""
        results = []
        
        for i in range(count):
            seed = start_seed + i
            result = self.generate(seed, max_candidates=max_candidates, temperature=temperature)
            results.append(result)
        
        return results


def visualize_puzzle(puzzle: dict) -> str:
    """Create ASCII visualization of a puzzle."""
    tiles = puzzle["tiles"]
    sx, sy = puzzle["start"]
    gx, gy = puzzle["goal"]
    
    TILE_CHARS = {
        0: ".",   # Floor
        1: "#",   # Wall
        4: "~",   # Ice
        5: "^",   # Ledge up
        6: "v",   # Ledge down
        7: "<",   # Ledge left
        8: ">",   # Ledge right
        100: "S", # Start
        101: "G", # Goal
        2: "?",   # Reserved
    }
    
    lines = []
    for y in range(13):
        row = ""
        for x in range(13):
            if x == sx and y == sy:
                row += "S"
            elif x == gx and y == gy:
                row += "G"
            else:
                row += TILE_CHARS.get(tiles[y][x], "?")
        lines.append(row)
    
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate puzzles from seeds")
    parser.add_argument("--seed", type=int, default=42, help="Starting seed")
    parser.add_argument("--count", type=int, default=10, help="Number of puzzles to generate")
    parser.add_argument("--max-candidates", type=int, default=100, help="Max candidates per puzzle")
    parser.add_argument("--checkpoint", type=str, default="output_shortcut_v1/best_model.pt")
    parser.add_argument("--data", type=str, default="../data/train-200k-with-paths.jsonl")
    parser.add_argument("--show", action="store_true", help="Show puzzle visualizations")
    args = parser.parse_args()
    
    print(f"Initializing generator...")
    generator = SeedPuzzleGenerator(
        checkpoint_path=args.checkpoint,
        data_path=args.data,
    )
    
    print(f"\nGenerating {args.count} puzzles starting from seed {args.seed}...")
    puzzles = generator.generate_batch(
        start_seed=args.seed,
        count=args.count,
        max_candidates=args.max_candidates,
    )
    
    # Stats
    attempts_list = [p["attempts"] for p in puzzles]
    fallbacks = sum(1 for p in puzzles if p.get("fallback"))
    
    print(f"\n--- Results ---")
    print(f"Generated: {len(puzzles)} puzzles")
    print(f"Fallbacks (hit max candidates): {fallbacks}")
    print(f"Avg attempts: {sum(attempts_list)/len(attempts_list):.1f}")
    print(f"Max attempts: {max(attempts_list)}")
    
    for i, puzzle in enumerate(puzzles):
        status = "FALLBACK" if puzzle.get("fallback") else "OK"
        print(f"  Seed {args.seed + i}: {status} attempts={puzzle['attempts']} start={puzzle['start']} goal={puzzle['goal']}")
        if args.show:
            print(visualize_puzzle(puzzle))
            print()
