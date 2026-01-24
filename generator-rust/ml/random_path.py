"""
Random path generator for seed-only inference.

Creates random 10-move paths on a 13x13 grid using ICE PHYSICS,
then uses the path-conditioned model to realize them as puzzles.
"""

import torch
import random
from typing import Optional, Tuple, List

GRID_SIZE = 13
NUM_MOVES = 10
DIRECTIONS = [(0, -1), (0, 1), (-1, 0), (1, 0)]  # up, down, left, right
DIR_NAMES = ["up", "down", "left", "right"]


def pos_to_flat(x: int, y: int) -> int:
    return y * GRID_SIZE + x


def flat_to_pos(flat: int) -> Tuple[int, int]:
    return flat % GRID_SIZE, flat // GRID_SIZE


def ice_slide_path(seed: int, num_moves: int = NUM_MOVES) -> Optional[dict]:
    """
    Generate a random ice-sliding path of exactly num_moves steps.
    
    Ice physics: each move slides in a direction until hitting the edge.
    We record the stopping points as the path.
    
    Matches training data distribution:
    - Starts biased toward edges (56% near edge)
    - Goals heavily biased toward edges/corners (90% near edge)
    
    Returns dict with start, goal, path cells (stopping points), and slide_cells.
    """
    rng = random.Random(seed)
    
    # Start position - bias toward edges like training data
    if rng.random() < 0.56:
        # Near edge
        edge = rng.choice(['top', 'bottom', 'left', 'right'])
        if edge == 'top':
            start_x, start_y = rng.randint(1, 11), rng.randint(0, 2)
        elif edge == 'bottom':
            start_x, start_y = rng.randint(1, 11), rng.randint(10, 12)
        elif edge == 'left':
            start_x, start_y = rng.randint(0, 2), rng.randint(1, 11)
        else:
            start_x, start_y = rng.randint(10, 12), rng.randint(1, 11)
    else:
        # Interior
        start_x = rng.randint(3, 9)
        start_y = rng.randint(3, 9)
    
    path = [(start_x, start_y)]  # Stopping points only
    all_cells = [(start_x, start_y)]  # All cells traversed (for on_path)
    x, y = start_x, start_y
    
    last_dir = None
    
    for move in range(num_moves):
        # Try random directions, avoid immediate reversal
        dirs = list(range(4))
        rng.shuffle(dirs)
        
        moved = False
        for dir_idx in dirs:
            dx, dy = DIRECTIONS[dir_idx]
            
            # Don't reverse immediately
            if last_dir is not None:
                reverse = [(0, 1), (0, -1), (1, 0), (-1, 0)]
                if (dx, dy) == reverse[last_dir]:
                    continue
            
            # Simulate ice slide - go until edge
            nx, ny = x, y
            slide_cells = []
            
            while True:
                test_x, test_y = nx + dx, ny + dy
                # Stop at grid edge (simulating hitting a wall)
                if test_x < 0 or test_x >= GRID_SIZE or test_y < 0 or test_y >= GRID_SIZE:
                    break
                nx, ny = test_x, test_y
                slide_cells.append((nx, ny))
            
            # Must actually move
            if (nx, ny) != (x, y) and len(slide_cells) > 0:
                # For last move, bias toward edge (like training data goals)
                if move == num_moves - 1:
                    # Prefer sliding to edge
                    stop_idx = len(slide_cells) - 1
                elif len(slide_cells) >= 2:
                    stop_idx = rng.randint(1, len(slide_cells) - 1)
                else:
                    stop_idx = 0
                
                # Record cells slid through up to stop point
                for i, cell in enumerate(slide_cells[:stop_idx + 1]):
                    if cell not in all_cells:
                        all_cells.append(cell)
                
                nx, ny = slide_cells[stop_idx]
                x, y = nx, ny
                path.append((x, y))
                last_dir = dir_idx
                moved = True
                break
        
        if not moved:
            return None  # Stuck, can't complete path
    
    if len(path) != num_moves + 1:
        return None
    
    return {
        "start": (start_x, start_y),
        "goal": (x, y),
        "path": path,  # Stopping points (11 cells for 10 moves)
        "all_cells": all_cells,  # All cells traversed
        "seed": seed,
    }


def create_path_features(path_info: dict, device: torch.device) -> Tuple[torch.Tensor, torch.Tensor, int, int]:
    """
    Convert path info to model input features.
    Returns: (stop_step_feat, on_path, start_flat, goal_flat)
    """
    path = path_info["path"]  # Stopping points
    all_cells = path_info.get("all_cells", path)  # All traversed cells
    start = path_info["start"]
    goal = path_info["goal"]
    
    # Create stop_step_feat: one-hot encoding of which step each cell is
    # Shape: (169, 11) - 11 possible stops (0-10)
    stop_step_feat = torch.zeros(GRID_SIZE * GRID_SIZE, 11, device=device)
    
    # Create on_path: binary mask for ALL cells on the path
    on_path = torch.zeros(GRID_SIZE * GRID_SIZE, 1, device=device)
    
    # Mark stopping points with step number
    for step, (x, y) in enumerate(path):
        flat = pos_to_flat(x, y)
        if step < 11:  # steps 0-10
            stop_step_feat[flat, step] = 1.0
        on_path[flat, 0] = 1.0
    
    # Mark all traversed cells as on_path
    for (x, y) in all_cells:
        flat = pos_to_flat(x, y)
        on_path[flat, 0] = 1.0
    
    start_flat = pos_to_flat(start[0], start[1])
    goal_flat = pos_to_flat(goal[0], goal[1])
    
    return stop_step_feat, on_path, start_flat, goal_flat


def generate_with_random_path(
    model,
    device: torch.device,
    seed: int,
    temperature: float = 1.0,
    max_attempts: int = 100,
) -> Optional[dict]:
    """
    Generate a puzzle using a randomly created ice-sliding path.
    """
    # Try to generate a valid random ice path
    for attempt in range(max_attempts):
        path_info = ice_slide_path(seed + attempt)
        if path_info is not None:
            break
    else:
        return None
    
    # Create path features
    stop_step_feat, on_path, start_flat, goal_flat = create_path_features(path_info, device)
    
    # Add batch dimension
    stop_step_feat = stop_step_feat.unsqueeze(0)  # (1, 169, 11)
    on_path = on_path.unsqueeze(0)  # (1, 169, 1)
    start_pos = torch.tensor([start_flat], device=device)
    goal_pos = torch.tensor([goal_flat], device=device)
    
    # Generate using model's generate_with_plan
    model.eval()
    with torch.no_grad():
        # MPS doesn't support generators, use None
        result = model.generate_with_plan(
            batch_size=1,
            device=device,
            generator=None,
            temperature=temperature,
            start_pos=start_pos,
            goal_pos=goal_pos,
            stop_step_feat=stop_step_feat,
            on_path=on_path,
        )
    
    return {
        "tiles": result["tiles"][0],  # (169,)
        "start_pos": start_flat,
        "goal_pos": goal_flat,
        "path_info": path_info,
    }


def visualize_path(path_info: dict) -> str:
    """Create ASCII visualization of the ice-sliding path."""
    grid = [['.' for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
    
    # Mark all traversed cells
    all_cells = path_info.get("all_cells", [])
    for (x, y) in all_cells:
        grid[y][x] = '~'  # Ice slide path
    
    # Mark stopping points with numbers
    path = path_info["path"]
    for i, (x, y) in enumerate(path):
        if i == 0:
            grid[y][x] = 'S'
        elif i == len(path) - 1:
            grid[y][x] = 'G'
        else:
            grid[y][x] = str(i) if i < 10 else '*'
    
    return '\n'.join(''.join(row) for row in grid)


if __name__ == "__main__":
    import sys
    import argparse
    sys.path.insert(0, ".")
    
    from model_v2 import PuzzleGeneratorV2, config_for_preset
    
    parser = argparse.ArgumentParser(description="Generate puzzles with random paths")
    parser.add_argument("--seed", type=int, default=42, help="Starting seed")
    parser.add_argument("--count", type=int, default=10, help="Number of puzzles to generate")
    parser.add_argument("--checkpoint", type=str, default="output_shortcut_v1/best_model.pt")
    parser.add_argument("--validate", action="store_true", help="Validate generated puzzles")
    parser.add_argument("--show-path", action="store_true", help="Show path visualization")
    args = parser.parse_args()
    
    import os
    if not os.path.exists(args.checkpoint):
        print(f"Checkpoint not found: {args.checkpoint}")
        sys.exit(1)
    
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Device: {device}")
    
    # Load model
    ckpt = torch.load(args.checkpoint, map_location=device, weights_only=False)
    config = ckpt.get("config", config_for_preset("base"))
    model = PuzzleGeneratorV2(config).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    print(f"Loaded: {args.checkpoint}")
    
    # Try to load validator
    validate_fn = None
    if args.validate:
        try:
            from mazle_eval import validate_ice_interior
            validate_fn = validate_ice_interior
            print("Rust validator loaded")
        except ImportError:
            print("Warning: mazle_eval not available, skipping validation")
    
    # Tile remapping for validation
    TILE_REMAP_INV = {0: 0, 1: 1, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 100, 8: 101, 9: 2}
    
    # Generate puzzles
    stats = {"generated": 0, "solvable": 0, "unique": 0, "t10": 0, "pass": 0}
    total_moves = 0
    
    print(f"\nGenerating {args.count} puzzles starting from seed {args.seed}...")
    print("-" * 60)
    
    for i in range(args.count):
        seed = args.seed + i
        result = generate_with_random_path(model, device, seed)
        
        if result is None:
            print(f"Seed {seed}: Failed to generate path")
            continue
        
        stats["generated"] += 1
        tiles = result["tiles"]
        start_flat = result["start_pos"]
        goal_flat = result["goal_pos"]
        sx, sy = flat_to_pos(start_flat)
        gx, gy = flat_to_pos(goal_flat)
        
        if args.show_path:
            print(f"\nSeed {seed} - Path:")
            print(visualize_path(result["path_info"]))
        
        if validate_fn:
            # Convert tiles for validator - needs 2D list
            tiles_2d = tiles.cpu().numpy().tolist()
            tiles_rust = [[TILE_REMAP_INV.get(t, t) for t in row] for row in tiles_2d]
            
            vr = validate_fn(tiles_rust, sx, sy, gx, gy)
            
            solvable = vr.solvable
            unique = vr.unique_optimal if solvable else False
            moves = vr.optimal_moves if solvable else 0
            t10 = solvable and moves == 10
            full_pass = unique and t10
            
            if solvable:
                stats["solvable"] += 1
                total_moves += moves
            if unique:
                stats["unique"] += 1
            if t10:
                stats["t10"] += 1
            if full_pass:
                stats["pass"] += 1
            
            status = "PASS" if full_pass else f"moves={moves}" if solvable else "unsolvable"
            print(f"Seed {seed}: {status}")
        else:
            print(f"Seed {seed}: Generated (no validation)")
    
    # Summary
    print("-" * 60)
    n = stats["generated"]
    if n > 0 and validate_fn:
        avg_moves = total_moves / stats["solvable"] if stats["solvable"] > 0 else 0
        print(f"Generated: {n}")
        print(f"Solvable:  {stats['solvable']}/{n} ({100*stats['solvable']/n:.1f}%)")
        print(f"Unique:    {stats['unique']}/{n} ({100*stats['unique']/n:.1f}%)")
        print(f"Target-10: {stats['t10']}/{n} ({100*stats['t10']/n:.1f}%)")
        print(f"PASS:      {stats['pass']}/{n} ({100*stats['pass']/n:.1f}%)")
        print(f"Avg moves: {avg_moves:.1f}")
