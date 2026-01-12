"""
Label the 200k 10-move dataset with optimal paths.

Reads each puzzle, runs the verifier to get optimal_path, and saves
to a new JSONL file with the path included.
"""

import json
import sys
from pathlib import Path
from tqdm import tqdm


def main():
    # Import verifier
    try:
        from mazle_eval import validate_ice_interior
    except ImportError:
        print("ERROR: mazle_eval not available. Build with: cd bridge && maturin develop --release")
        sys.exit(1)

    input_path = Path("../data/train-combined-200k-shuf.jsonl")
    output_path = Path("../data/train-200k-with-paths.jsonl")

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    # Count lines for progress bar
    print("Counting lines...")
    with open(input_path) as f:
        total_lines = sum(1 for _ in f)
    print(f"Total puzzles: {total_lines}")

    # Process each puzzle
    success_count = 0
    fail_count = 0

    with open(input_path) as fin, open(output_path, "w") as fout:
        for line in tqdm(fin, total=total_lines, desc="Labeling paths"):
            record = json.loads(line.strip())

            grid = record["tilesInterior"]
            start = record["start"]
            goal = record["goal"]

            try:
                result = validate_ice_interior(
                    grid,
                    start["x"], start["y"],
                    goal["x"], goal["y"],
                    None  # No target moves filter
                )

                if result.solvable and result.optimal_path:
                    # Add path to record
                    # optimal_path is list of (x, y) tuples
                    record["optimal_path"] = [[x, y] for x, y in result.optimal_path]
                    record["path_length"] = len(result.optimal_path)
                    fout.write(json.dumps(record) + "\n")
                    success_count += 1
                else:
                    # Puzzle not solvable? Skip it
                    fail_count += 1

            except Exception as e:
                print(f"Error processing puzzle: {e}")
                fail_count += 1

    print(f"\nDone!")
    print(f"Success: {success_count}")
    print(f"Failed: {fail_count}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
