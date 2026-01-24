"""
Inference module for PuzzleGeneratorV2.

Provides clean, reusable inference API for generating puzzles with trained models.
Handles all the complexity of path conditioning, tile remapping, and validation.

Usage:
    from inference_v2 import PuzzleInference
    
    # Load model
    inf = PuzzleInference("output_shortcut_v1/best_model.pt")
    
    # Generate with path conditioning (from training data)
    puzzles = inf.generate_from_data("../data/train-200k-with-paths.jsonl", num_samples=100)
    
    # Generate with custom path
    puzzle = inf.generate_with_path(start=(7,2), goal=(12,11), path=[(7,2), (7,0), ...])
    
    # Get statistics
    stats = inf.analyze_distribution(puzzles)
"""

import torch
import json
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from collections import Counter

from model_v2 import PuzzleGeneratorV2
from mazle_eval import validate_ice_interior


# Tile remapping between internal model format and Rust/game format
TILE_REMAP = {0: 0, 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 100: 7, 101: 8, 2: 9}
TILE_REMAP_INV = {0: 0, 1: 1, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 100, 8: 101, 9: 2}


@dataclass
class GeneratedPuzzle:
    """A generated puzzle with validation results."""
    grid: List[List[int]]  # 13x13 tile grid in Rust format
    start: Tuple[int, int]  # (x, y)
    goal: Tuple[int, int]   # (x, y)
    valid_tiles: bool
    solvable: bool
    unique_optimal: bool
    optimal_moves: int
    no_stuck: bool
    
    @property
    def full_pass(self) -> bool:
        """True if puzzle passes all validation criteria for 10-move puzzles."""
        return (self.valid_tiles and self.solvable and 
                self.unique_optimal and self.optimal_moves == 10)
    
    @property
    def target_10(self) -> bool:
        """True if optimal solution is exactly 10 moves."""
        return self.optimal_moves == 10


def build_path_conditioning(
    optimal_path: List[Tuple[int, int]], 
    W: int = 13, 
    H: int = 13, 
    S: int = 11
) -> Tuple[torch.Tensor, torch.Tensor]:
    """
    Build path conditioning tensors from optimal path.

    Args:
        optimal_path: List of (x, y) stop positions [(x0,y0), ..., (x10,y10)]
        W: Grid width
        H: Grid height
        S: Number of stops (11 for 10-move puzzles)

    Returns:
        stop_step_feat: (H*W, S) one-hot for which stop at each cell
        on_path: (H*W, 1) binary mask for cells on optimal path
    """
    stop_step_feat = torch.zeros((H, W, S), dtype=torch.float32)
    on_path = torch.zeros((H, W, 1), dtype=torch.float32)

    if len(optimal_path) != S:
        return stop_step_feat.reshape(H * W, S), on_path.reshape(H * W, 1)

    # Mark stop positions
    for k, (x, y) in enumerate(optimal_path):
        if 0 <= x < W and 0 <= y < H:
            stop_step_feat[y, x, k] = 1.0

    # Mark cells traversed between stops (ice sliding)
    for (x0, y0), (x1, y1) in zip(optimal_path[:-1], optimal_path[1:]):
        dx = 0 if x1 == x0 else (1 if x1 > x0 else -1)
        dy = 0 if y1 == y0 else (1 if y1 > y0 else -1)

        # Skip diagonal segments
        if (x1 != x0) and (y1 != y0):
            continue

        x, y = x0, y0
        while (x, y) != (x1, y1):
            if 0 <= x < W and 0 <= y < H:
                on_path[y, x, 0] = 1.0
            x, y = x + dx, y + dy

        # Mark endpoint
        if 0 <= x1 < W and 0 <= y1 < H:
            on_path[y1, x1, 0] = 1.0

    return stop_step_feat.reshape(H * W, S), on_path.reshape(H * W, 1)


class PuzzleInference:
    """
    High-level inference API for PuzzleGeneratorV2.
    
    Handles model loading, path conditioning, generation, and validation.
    """
    
    def __init__(
        self, 
        checkpoint_path: str,
        device: Optional[str] = None,
    ):
        """
        Load a trained model checkpoint.
        
        Args:
            checkpoint_path: Path to .pt checkpoint file
            device: Device to run on ("cuda", "mps", "cpu"). Auto-detects if None.
        """
        self.checkpoint_path = Path(checkpoint_path)
        
        # Auto-detect device
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        self.device = torch.device(device)
        
        # Load checkpoint
        checkpoint = torch.load(
            self.checkpoint_path, 
            map_location=self.device, 
            weights_only=False
        )
        
        self.config = checkpoint["config"]
        self.step = checkpoint.get("step", 0)
        self.metrics = checkpoint.get("metrics", {})
        
        # Initialize model
        self.model = PuzzleGeneratorV2(self.config)
        self.model.load_state_dict(checkpoint["model_state"])
        self.model.to(self.device)
        self.model.eval()
        
        print(f"Loaded model from {self.checkpoint_path}")
        print(f"  Step: {self.step}, Device: {self.device}")
        if self.metrics:
            print(f"  Best metrics: PASS={self.metrics.get('full_pass_pct', 0):.1f}%")
    
    def generate_with_path(
        self,
        start: Tuple[int, int],
        goal: Tuple[int, int],
        optimal_path: List[Tuple[int, int]],
        temperature: float = 1.0,
        seed: Optional[int] = None,
    ) -> GeneratedPuzzle:
        """
        Generate a puzzle conditioned on a specific optimal path.
        
        Args:
            start: (x, y) start position
            goal: (x, y) goal position
            optimal_path: List of 11 (x, y) positions forming the optimal path
            temperature: Sampling temperature (1.0 = normal, <1.0 = more deterministic)
            seed: Random seed for reproducibility
            
        Returns:
            GeneratedPuzzle with grid and validation results
        """
        if len(optimal_path) != 11:
            raise ValueError(f"optimal_path must have 11 positions, got {len(optimal_path)}")
        
        sx, sy = start
        gx, gy = goal
        
        # Build conditioning tensors
        stop_step_feat, on_path = build_path_conditioning(optimal_path)
        stop_step_feat = stop_step_feat.unsqueeze(0).to(self.device)
        on_path = on_path.unsqueeze(0).to(self.device)
        
        # Position tensors
        start_pos = torch.tensor([sy * 13 + sx], dtype=torch.long, device=self.device)
        goal_pos = torch.tensor([gy * 13 + gx], dtype=torch.long, device=self.device)
        
        # Generator for reproducibility
        gen = None
        if seed is not None:
            gen = torch.Generator(device=self.device)
            gen.manual_seed(seed)
        
        # Generate
        with torch.no_grad():
            result = self.model.generate_with_plan(
                batch_size=1,
                device=self.device,
                start_pos=start_pos,
                goal_pos=goal_pos,
                stop_step_feat=stop_step_feat,
                on_path=on_path,
                generator=gen,
                temperature=temperature,
            )
        
        # Convert to grid
        tiles = result["tiles"][0].cpu().numpy()
        grid = [
            [TILE_REMAP_INV.get(int(tiles[y, x]), tiles[y, x]) for x in range(13)]
            for y in range(13)
        ]
        
        # Validate
        vr = validate_ice_interior(grid, sx, sy, gx, gy, 10)
        
        return GeneratedPuzzle(
            grid=grid,
            start=(sx, sy),
            goal=(gx, gy),
            valid_tiles=vr.valid_tiles,
            solvable=vr.solvable,
            unique_optimal=vr.unique_optimal,
            optimal_moves=vr.optimal_moves,
            no_stuck=vr.no_stuck,
        )
    
    def generate_from_data(
        self,
        data_path: str,
        num_samples: int = 100,
        temperature: float = 1.0,
        require_full_pass: bool = False,
        verbose: bool = True,
    ) -> List[GeneratedPuzzle]:
        """
        Generate puzzles using paths from training data.
        
        Args:
            data_path: Path to JSONL file with optimal_path field
            num_samples: Number of puzzles to attempt generating
            temperature: Sampling temperature
            require_full_pass: If True, only return puzzles that pass all criteria
            verbose: Print progress
            
        Returns:
            List of GeneratedPuzzle objects
        """
        data_path = Path(data_path)
        if not data_path.exists():
            raise FileNotFoundError(f"Data file not found: {data_path}")
        
        puzzles = []
        attempts = 0
        
        with open(data_path) as f:
            for i, line in enumerate(f):
                if len(puzzles) >= num_samples and require_full_pass:
                    break
                if attempts >= num_samples and not require_full_pass:
                    break
                
                data = json.loads(line)
                
                # Skip if no valid path
                if "optimal_path" not in data or len(data["optimal_path"]) != 11:
                    continue
                
                start = (data["start"]["x"], data["start"]["y"])
                goal = (data["goal"]["x"], data["goal"]["y"])
                path = [(p[0], p[1]) for p in data["optimal_path"]]
                
                # Generate with deterministic seed based on index
                seed = int(hashlib.sha256(f"gen-{i}".encode()).hexdigest()[:8], 16)
                
                puzzle = self.generate_with_path(
                    start=start,
                    goal=goal,
                    optimal_path=path,
                    temperature=temperature,
                    seed=seed,
                )
                
                attempts += 1
                
                if require_full_pass and not puzzle.full_pass:
                    continue
                
                puzzles.append(puzzle)
                
                if verbose and attempts % 100 == 0:
                    pass_count = sum(1 for p in puzzles if p.full_pass)
                    print(f"Progress: {attempts} attempts, {len(puzzles)} collected, "
                          f"{pass_count} full_pass ({pass_count/max(1,len(puzzles))*100:.1f}%)")
        
        if verbose:
            pass_count = sum(1 for p in puzzles if p.full_pass)
            print(f"\nGenerated {len(puzzles)} puzzles from {attempts} attempts")
            print(f"Full pass: {pass_count} ({pass_count/max(1,len(puzzles))*100:.1f}%)")
        
        return puzzles
    
    def analyze_distribution(
        self, 
        puzzles: List[GeneratedPuzzle],
        only_full_pass: bool = True,
    ) -> Dict[str, Any]:
        """
        Analyze start/goal position distribution.
        
        Args:
            puzzles: List of generated puzzles
            only_full_pass: Only analyze puzzles that pass all criteria
            
        Returns:
            Dictionary with distribution statistics
        """
        if only_full_pass:
            puzzles = [p for p in puzzles if p.full_pass]
        
        if not puzzles:
            return {"error": "No puzzles to analyze"}
        
        starts = [p.start for p in puzzles]
        goals = [p.goal for p in puzzles]
        
        start_x = [s[0] for s in starts]
        start_y = [s[1] for s in starts]
        goal_x = [g[0] for g in goals]
        goal_y = [g[1] for g in goals]
        
        # Manhattan distances
        distances = [abs(s[0]-g[0]) + abs(s[1]-g[1]) for s, g in zip(starts, goals)]
        
        # Heatmaps
        start_heatmap = [[0]*13 for _ in range(13)]
        goal_heatmap = [[0]*13 for _ in range(13)]
        for s in starts:
            start_heatmap[s[1]][s[0]] += 1
        for g in goals:
            goal_heatmap[g[1]][g[0]] += 1
        
        return {
            "count": len(puzzles),
            "start": {
                "x_range": (min(start_x), max(start_x)),
                "y_range": (min(start_y), max(start_y)),
                "x_mean": sum(start_x) / len(start_x),
                "y_mean": sum(start_y) / len(start_y),
                "top_positions": Counter(starts).most_common(10),
                "heatmap": start_heatmap,
            },
            "goal": {
                "x_range": (min(goal_x), max(goal_x)),
                "y_range": (min(goal_y), max(goal_y)),
                "x_mean": sum(goal_x) / len(goal_x),
                "y_mean": sum(goal_y) / len(goal_y),
                "top_positions": Counter(goals).most_common(10),
                "heatmap": goal_heatmap,
            },
            "distance": {
                "range": (min(distances), max(distances)),
                "mean": sum(distances) / len(distances),
                "distribution": dict(Counter(distances)),
            },
        }
    
    def print_heatmap(self, heatmap: List[List[int]], title: str = "Heatmap"):
        """Pretty-print a 13x13 heatmap."""
        print(f"\n=== {title} (13x13, y=0 at top) ===")
        for row in heatmap:
            print(" ".join(f"{c:2d}" if c > 0 else " ." for c in row))
    
    def generate_from_seed(
        self,
        seed: str,
        max_candidates: int = 1000,
        temperature: float = 1.0,
        verbose: bool = True,
    ) -> Optional[GeneratedPuzzle]:
        """
        Generate a puzzle from just a seed string (no path conditioning).
        
        WARNING: Without path conditioning, success rate is ~0.1-1%. This may
        generate many candidates before finding a valid 10-move puzzle.
        
        Args:
            seed: Seed string for reproducible generation
            max_candidates: Maximum candidates to try before giving up
            temperature: Sampling temperature
            verbose: Print progress
            
        Returns:
            GeneratedPuzzle if found, None if max_candidates exhausted
        """
        batch_size = 32  # Generate in batches for efficiency
        
        for batch_start in range(0, max_candidates, batch_size):
            # Generate batch of candidates
            with torch.no_grad():
                result = self.model.generate_k_candidates(
                    seed=seed,
                    k=min(batch_size, max_candidates - batch_start),
                    device=self.device,
                    temperature=temperature,
                )
            
            tiles_batch = result["tiles"].cpu().numpy()
            starts = result["start_pos"].cpu().numpy()
            goals = result["goal_pos"].cpu().numpy()
            
            # Validate each candidate
            for i in range(tiles_batch.shape[0]):
                tiles = tiles_batch[i]
                sx, sy = int(starts[i, 0]), int(starts[i, 1])
                gx, gy = int(goals[i, 0]), int(goals[i, 1])
                
                # Convert to grid
                grid = [
                    [TILE_REMAP_INV.get(int(tiles[y, x]), tiles[y, x]) for x in range(13)]
                    for y in range(13)
                ]
                
                # Validate
                vr = validate_ice_interior(grid, sx, sy, gx, gy, 10)
                
                puzzle = GeneratedPuzzle(
                    grid=grid,
                    start=(sx, sy),
                    goal=(gx, gy),
                    valid_tiles=vr.valid_tiles,
                    solvable=vr.solvable,
                    unique_optimal=vr.unique_optimal,
                    optimal_moves=vr.optimal_moves,
                    no_stuck=vr.no_stuck,
                )
                
                if puzzle.full_pass:
                    if verbose:
                        print(f"Found valid puzzle after {batch_start + i + 1} candidates")
                    return puzzle
            
            if verbose and (batch_start + batch_size) % 100 == 0:
                print(f"Tried {batch_start + batch_size} candidates, no valid puzzle yet...")
        
        if verbose:
            print(f"No valid puzzle found after {max_candidates} candidates")
        return None
    
    def generate_batch_from_seed(
        self,
        seed: str,
        num_puzzles: int = 10,
        max_candidates_per_puzzle: int = 1000,
        temperature: float = 1.0,
        verbose: bool = True,
    ) -> List[GeneratedPuzzle]:
        """
        Generate multiple puzzles using seed variations.
        
        Args:
            seed: Base seed string
            num_puzzles: Number of puzzles to generate
            max_candidates_per_puzzle: Max candidates per puzzle attempt
            temperature: Sampling temperature
            verbose: Print progress
            
        Returns:
            List of valid GeneratedPuzzle objects (may be fewer than num_puzzles)
        """
        puzzles = []
        for i in range(num_puzzles):
            varied_seed = f"{seed}-puzzle-{i}"
            puzzle = self.generate_from_seed(
                seed=varied_seed,
                max_candidates=max_candidates_per_puzzle,
                temperature=temperature,
                verbose=False,
            )
            if puzzle:
                puzzles.append(puzzle)
                if verbose:
                    print(f"Generated puzzle {len(puzzles)}/{num_puzzles}")
            else:
                if verbose:
                    print(f"Failed to generate puzzle {i+1}")
        
        if verbose:
            print(f"\nGenerated {len(puzzles)}/{num_puzzles} puzzles")
        return puzzles

    def print_analysis(self, stats: Dict[str, Any]):
        """Pretty-print distribution analysis."""
        if "error" in stats:
            print(f"Error: {stats['error']}")
            return
        
        print(f"\n{'='*50}")
        print(f"Analysis of {stats['count']} puzzles")
        print(f"{'='*50}")
        
        print(f"\nSTART POSITIONS:")
        print(f"  X: {stats['start']['x_range'][0]}-{stats['start']['x_range'][1]}, "
              f"mean={stats['start']['x_mean']:.1f}")
        print(f"  Y: {stats['start']['y_range'][0]}-{stats['start']['y_range'][1]}, "
              f"mean={stats['start']['y_mean']:.1f}")
        print(f"  Top 5: {stats['start']['top_positions'][:5]}")
        
        print(f"\nGOAL POSITIONS:")
        print(f"  X: {stats['goal']['x_range'][0]}-{stats['goal']['x_range'][1]}, "
              f"mean={stats['goal']['x_mean']:.1f}")
        print(f"  Y: {stats['goal']['y_range'][0]}-{stats['goal']['y_range'][1]}, "
              f"mean={stats['goal']['y_mean']:.1f}")
        print(f"  Top 5: {stats['goal']['top_positions'][:5]}")
        
        print(f"\nMANHATTAN DISTANCE:")
        print(f"  Range: {stats['distance']['range'][0]}-{stats['distance']['range'][1]}, "
              f"mean={stats['distance']['mean']:.1f}")
        
        self.print_heatmap(stats['start']['heatmap'], "START HEATMAP")
        self.print_heatmap(stats['goal']['heatmap'], "GOAL HEATMAP")


# CLI interface
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Generate puzzles with trained model")
    parser.add_argument("checkpoint", help="Path to model checkpoint (.pt)")
    parser.add_argument("--data", default="../data/train-200k-with-paths.jsonl",
                        help="Path to JSONL data with optimal paths")
    parser.add_argument("--num", type=int, default=100, help="Number of puzzles to generate")
    parser.add_argument("--temp", type=float, default=1.0, help="Sampling temperature")
    parser.add_argument("--full-pass", action="store_true", 
                        help="Only collect full-pass puzzles")
    parser.add_argument("--analyze", action="store_true",
                        help="Print distribution analysis")
    
    args = parser.parse_args()
    
    inf = PuzzleInference(args.checkpoint)
    puzzles = inf.generate_from_data(
        args.data, 
        num_samples=args.num,
        temperature=args.temp,
        require_full_pass=args.full_pass,
    )
    
    if args.analyze:
        stats = inf.analyze_distribution(puzzles)
        inf.print_analysis(stats)
