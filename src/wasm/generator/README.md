# Mazle Rust Generator

High-performance puzzle generator for Mazle, ported from TypeScript to Rust for 10-50x faster generation.

## Overview

This is a complete port of both the **ice map** and **ground map** generators from TypeScript to Rust. It includes:

### Ice Map Generator (Complete)
- ✅ Base maze generation (recursive backtracking)
- ✅ All 10 "genius-level" deception algorithms:
  1. Counter-intuitive path engineering
  2. "Almost there" traps
  3. Decoy open areas
  4. Hidden choke points
  5. Momentum traps
  6. Anti-gradient zones
  7. Parallel path illusions
  8. Ledge misdirection
  9. Goal proximity dead ends
  10. Commitment traps
- ✅ Stop blocks, floor stops, island obstacles
- ✅ Precision gates, funnel patterns, trap alcoves
- ✅ Dead-end magnets, deceptive paths, winding corridors
- ✅ Ledge placement with solvability verification
- ✅ Psychology-based scoring system
- ✅ BFS pathfinding (optimized with reverse BFS)
- ✅ Stuck state detection

### Ground Map Generator (Complete)
- ✅ Step-based movement with ice patches
- ✅ Boulder mechanics (Sokoban-style pushing)
- ✅ All 10 deception algorithms adapted for ground movement
- ✅ Ledge placement for commitment points
- ✅ Maze and open room generation
- ✅ Boulder-aware pathfinding

### What's NOT Ported
- Heat map / cognitive load systems (optional optimization, not critical)
- Full constraint-based backwards generation (partial implementation)
- Ghost path visualization (frontend-only feature)

## Installation

### Prerequisites
- Rust 1.70+ (install via [rustup](https://rustup.rs/))

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### Building

```bash
cd generator-rust

# Development build
cargo build

# Optimized release build (10x faster)
cargo build --release
```

### Running

```bash
# Development mode
cargo run

# Production mode
cargo run --release

# Or run the binary directly
./target/release/mazle-generator
```

The server starts on port 3001 by default. Set `PORT` environment variable to change.

## API Endpoints

### Health Check
```
GET /health
```

### Generate Ice Puzzle
```
GET /api/generate/:seed?map_type=ice&attempts=400
```

### Generate Ground Puzzle
```
GET /api/generate/:seed?map_type=ground&attempts=400
```

### Generate with Config (POST)
```
POST /api/generate
Content-Type: application/json

{
  "seed": "2024-01-01",
  "mapType": "ice",
  "config": {
    "traditionalAttempts": 400,
    "targetPsychologyScore": 2000,
    "parallel": true
  }
}
```

### Batch Generation
```
POST /api/generate/batch
Content-Type: application/json

{
  "seeds": ["2024-01-01", "2024-01-02", "2024-01-03"],
  "mapType": "ice",
  "config": {
    "traditionalAttempts": 200
  }
}
```

## Performance

Expected performance improvements over TypeScript:

| Operation | TypeScript | Rust | Speedup |
|-----------|------------|------|---------|
| Single puzzle (ice) | ~500-2000ms | ~50-200ms | 10-15x |
| Single puzzle (ground) | ~300-1000ms | ~30-100ms | 10-15x |
| Batch (10 puzzles) | ~5-20s | ~200-500ms | 25-40x |

Rust advantages:
- No garbage collection pauses
- Better CPU cache utilization (flat arrays)
- Parallel generation with Rayon
- Release mode optimizations (LTO, single codegen unit)

## Integration with Next.js

The Next.js API routes (`/api/generate/route.ts`) automatically fall back to TypeScript if the Rust server is unavailable.

Set the environment variable to point to your Rust server:

```bash
RUST_GENERATOR_URL=http://localhost:3001
```

## Testing

Run the comparison test to verify Rust matches TypeScript output:

```bash
# Start Rust server first
cd generator-rust && cargo run --release &

# Run comparison test
cd .. && npx ts-node generator-rust/test_comparison.ts
```

## Project Structure

```
generator-rust/
├── Cargo.toml              # Rust dependencies
├── README.md               # This file
├── verify.sh               # Build verification script
├── test_comparison.ts      # TypeScript/Rust comparison test
└── src/
    ├── main.rs             # HTTP server (Axum)
    ├── types.rs            # TileType, Position, Grid, etc.
    ├── simulation.rs       # Ice sliding, ledge movement
    ├── pathfinding.rs      # BFS, reachability, stuck detection
    ├── scoring.rs          # Psychology-based scoring
    ├── generator.rs        # Ice map generation
    └── ground_generator.rs # Ground map generation
```

## Deployment Options

### 1. Local Development
```bash
cargo run --release
```

### 2. Docker
```dockerfile
FROM rust:1.75-alpine AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM alpine:latest
COPY --from=builder /app/target/release/mazle-generator /usr/local/bin/
EXPOSE 3001
CMD ["mazle-generator"]
```

### 3. Shuttle.rs (Rust-native PaaS)
```bash
cargo install shuttle-cli
shuttle init
shuttle deploy
```

### 4. Fly.io
```bash
flyctl launch
flyctl deploy
```

## Algorithm Notes

### Deterministic Generation
Puzzles are deterministic based on seed. The same seed produces the same puzzle (assuming same configuration). This is achieved using the ChaCha8 PRNG seeded from a hash of the string seed.

### Solvability Guarantee
Every generated puzzle is guaranteed solvable:
1. BFS validates a path exists from start to goal
2. Reverse BFS ensures no stuck states (all reachable positions can reach goal)
3. All modifications are rolled back if they break solvability

### Psychology Scoring
The difficulty score is based on:
- Counter-intuitive moves (moves away from goal on optimal path)
- Attractive decoys (suboptimal paths that look better)
- Commitment gates (one-way ledges, narrow passages)
- False progress paths (paths that decrease distance but increase moves)

Higher scores = harder puzzles.
