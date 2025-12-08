# Mazle - AI Agent Guide

## What is Mazle?

A daily Wordle-style puzzle game inspired by Pokémon ice gym puzzles. Players navigate compact rooms using step movement, ice sliding, and one-way ledges. Browser-first (Next.js + Phaser 3).

## Development Workflow

```bash
# Required env var (add to shell profile)
export UNIQUE_RUNNER_ID=$(whoami)

# Common workflows
make up                       # Quick start (WASM fallback)
make up ENV=dev               # Full stack (frontend + Rust backend)
make up ENV=dev WITH_DEPS=0   # Dev mode, frontend only
make up ENV=prod              # Deploy both frontend (Vercel) + backend (Fly.io)
make down                     # Stop containers
make clean                    # Full cleanup
make help                     # List all targets

# Build/compile verification
make build                              # Build frontend (from root)
cd generator-rust && make build         # Build Rust backend
```

## Environment Behavior

| ENV | WITH_DEPS | Notes |
|-----|-----------|-------|
| `dev-test` (default) | 0 | WASM fallback, fast iteration |
| `dev` | 1 (override with =0) | Full local stack |
| `staging` | 1 | Pre-prod (Fly.io) |
| `prod` | 1 (override with =0) | Deploy backend to Fly.io, frontend to Vercel |

## Architecture

```
mazle/
├── src/                    # Next.js 14 + Phaser 3 game
│   ├── app/               # App router, API routes
│   ├── components/        # React UI (GameUI, ShareCard, etc.)
│   ├── game/              # Phaser: GameScene, movement, maps
│   └── wasm/generator/    # Compiled WASM (from generator-rust)
├── generator-rust/         # Rust puzzle generator
│   └── src/               # Rust sources → WASM + HTTP server
├── devops-toolkit/         # Build system (git submodule)
└── Makefile               # Root orchestration
```

## Key Files

- `Makefile` - Root build targets, WASM build, backend wiring
- `mazle.compose.yaml` - Docker Compose for frontend
- `generator-rust/Makefile` - Backend build/deploy (Fly.io)
- `src/game/GameScene.ts` - Main Phaser game logic
- `src/game/puzzleGenerator.ts` - WASM/HTTP generator interface

## Puzzle Generation

Two modes:
1. **WASM** (client-side): `src/wasm/generator/` - runs in web workers
2. **HTTP** (server-side): `generator-rust/` on port 8080 - Rust Axum server

Frontend auto-detects: uses HTTP if `NEXT_PUBLIC_GENERATOR_URL` set, else WASM fallback.

## Deployment

- **Full stack**: `make up ENV=prod` (requires `VERCEL_TOKEN` and `FLY_API_TOKEN`)
- **Frontend only**: `make up ENV=prod WITH_DEPS=0` (backend must already be deployed)
- **Backend only**: `cd generator-rust && make up ENV=prod`

## Game Spec Summary

- **Tiles**: Floor (step), Wall (block), Ice (slide), Ledge (one-way), Start, Goal
- **Target**: ~20 moves, <3 min solve time
- **Scoring**: Move count (primary), time (tiebreaker)
- **Daily**: Same puzzle globally, midnight UTC reset



## EXAMPLE AGENT WORKING IN BACKEND SO YOU CAN SEE FOR EXAMPLE AND INSPIRATION:

 ✔ Build with adjusted thresholds
    $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -5
    └ 6 lines...

 ✔ Restart server
    $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5
    └ 6 lines...

 ✔ Test 15x15 with timeout
    $ timeout 40 curl -s "http://10.0.0.240:8080/api/generate/quick1" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle'];
    print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves, {d['generationTimeMs']}ms\")" || echo "Timeout/failed"
    └ 3 lines...

 ● Still timing out. The 15x15 with 10 moves is probably too constrained. Let me check the logs to see what's happening:

 ✔ Check generator logs
    $ docker logs mazle-generator_instance 2>&1 | tail -30
    └ 31 lines...

 ● It's running batches but not finding valid puzzles. Let me check what parameters are being used:

 ✔ Check generation parameters
    $ docker logs mazle-generator_instance 2>&1 | grep -E "Map|Prefilters" | tail -10
    └ 3 lines...

 ● Interesting - it shows 14x14. But you said you changed to 15x15. Let me check the SIZE_OPTIONS:

 ✔ Grep "SIZE_OPTIONS" (/Users/jmogainz/mazle/generator-rust/src/generators/ice.rs)
   └ 2 lines found

 ✔ Read generator-rust/src/generators/ice.rs:63-68
   └ 11 lines read

 ● It's currently 14x14, not 15x15. The thresholds for 14x14 (which is still < 15) should use the small map path. Let me recalculate:

   For 14x14:

     - scale = 14/35 = 0.4
     - min_counter_intuitive = round(10 * 0.4) = 4, .max(3) = 4
     - min_attractive_decoys = round(14 * 0.4) = 6, .max(4) = 6

   So the thresholds are: ci>=4, decoys>=6, gates>=2, fp>=6

   These might still be too high. The issue is that for a maze with only 9-10 optimal moves, getting 4+ counter-intuitive moves and 6+ decoys is hard. Let me lower
   these further:

 ✔ Edit generator-rust/src/generators/ice.rs (+6 -6)
   ╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
   │ 1624         let min_dim = width.min(height) as f64;                                                                                                         │
   │ 1625         let scale = min_dim / 35.0;  // Reference: 35x35 base map size                                                                                  │
   │ 1626                                                                                                                                                         │
   │ 1627  -      // For small maps (<= 15), use lower thresholds tuned for faster generation                                                                     │
   │ 1628  -      let is_small_map = min_dim <= 15.0;                                                                                                             │
   │ 1627  +      // For small maps (<= 18), use lower thresholds tuned for faster generation                                                                     │
   │ 1628  +      let is_small_map = min_dim <= 18.0;                                                                                                             │
   │ 1629                                                                                                                                                         │
   │ 1630         PrefilterThresholds {                                                                                                                           │
   │ 1631  -          min_counter_intuitive: ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(if is_small_map { 3 } else { 4 }),        │
   │ 1632  -          min_attractive_decoys: ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * scale).round() as i32).max(if is_small_map { 4 } else { 5 }),        │
   │ 1633  -          min_commitment_gates: ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * scale).round() as i32).max(if is_small_map { 2 } else { 2 }),          │
   │ 1634  -          min_false_progress: ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * scale).round() as i32).max(if is_small_map { 4 } else { 5 }),              │
   │ 1631  +          min_counter_intuitive: ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(if is_small_map { 2 } else { 4 }),        │
   │ 1632  +          min_attractive_decoys: ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * scale).round() as i32).max(if is_small_map { 3 } else { 5 }),        │
   │ 1633  +          min_commitment_gates: ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * scale).round() as i32).max(if is_small_map { 1 } else { 2 }),          │
   │ 1634  +          min_false_progress: ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * scale).round() as i32).max(if is_small_map { 3 } else { 5 }),              │
   │ 1635         }                                                                                                                                               │
   │ 1636     }                                                                                                                                                   │
   ╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 ✘ Build and restart
   $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -3 && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -3
   Operation aborted by user

 ● Operation cancelled by user

 > sure and change to 15x15

 ✔ Edit generator-rust/src/generators/ice.rs (+1 -1)
   ╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
   │ 61     const TRADITIONAL_ATTEMPTS: usize = 1000;                                                                                                             │
   │ 62                                                                                                                                                           │
   │ 63     const SIZE_OPTIONS: [(usize, usize); 1] = [                                                                                                           │
   │ 64  -      (14, 14),                                                                                                                                         │
   │ 64  +      (15, 15),                                                                                                                                         │
   │ 65     ];                                                                                                                                                    │
   │ 66                                                                                                                                                           │
   │ 67     // Weighting knobs for psychology scoring (emphasize traps over length)                                                                               │
   ╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 ✔ Build Rust backend
    $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -3
    └ 4 lines...

 ✔ Restart server
    $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5
    └ 6 lines...

 ✔ Test 15x15 puzzle
    $ timeout 40 curl -s "http://10.0.0.240:8080/api/generate/test15x15" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle'];
    print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves, {d['generationTimeMs']}ms\")" || echo "Timeout"
    └ 3 lines...

 ✔ Check thresholds being used
    $ docker logs mazle-generator_instance 2>&1 | grep -E "Map|Prefilters" | tail -5
    └ 3 lines...

 ● The thresholds are still high. The scaled values are overriding my .max() floors. Let me check the math:

   For 15x15:

     - scale = 15/35 ≈ 0.43
     - min_counter_intuitive = round(10 * 0.43) = 4 → .max(2) = 4 (scaled wins)
     - min_attractive_decoys = round(14 * 0.43) = 6 → .max(3) = 6 (scaled wins)

   The problem is the scaled value is HIGHER than my floor. I need to use .min() as well to cap the values for small maps:

 ✔ Edit generator-rust/src/generators/ice.rs (+10 -5)
   ╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
   │ 1624         let min_dim = width.min(height) as f64;                                                                                                         │
   │ 1625         let scale = min_dim / 35.0;  // Reference: 35x35 base map size                                                                                  │
   │ 1626                                                                                                                                                         │
   │ 1627  -      // For small maps (<= 18), use lower thresholds tuned for faster generation                                                                     │
   │ 1627  +      // For small maps (<= 18), cap thresholds to achievable values                                                                                  │
   │ 1628         let is_small_map = min_dim <= 18.0;                                                                                                             │
   │ 1629  +                                                                                                                                                      │
   │ 1630  +      let ci = ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(2);                                                         │
   │ 1631  +      let decoys = ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * scale).round() as i32).max(3);                                                     │
   │ 1632  +      let gates = ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * scale).round() as i32).max(1);                                                       │
   │ 1633  +      let fp = ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * scale).round() as i32).max(3);                                                            │
   │ 1634                                                                                                                                                         │
   │ 1635         PrefilterThresholds {                                                                                                                           │
   │ 1636             min_counter_intuitive: ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(if is_small_map { 2 } else { 4 }),        │
   │ 1633         let is_small_map = min_dim <= 18.0;                                                                                                             │
   │ 1634                                                                                                                                                         │
   │ 1635         PrefilterThresholds {                                                                                                                           │
   │ 1631  -          min_counter_intuitive: ((BASE_PREFILTER_MIN_COUNTER_INTUITIVE as f64 * scale).round() as i32).max(if is_small_map { 2 } else { 4 }),        │
   │ 1632  -          min_attractive_decoys: ((BASE_PREFILTER_MIN_ATTRACTIVE_DECOYS as f64 * scale).round() as i32).max(if is_small_map { 3 } else { 5 }),        │
   │ 1633  -          min_commitment_gates: ((BASE_PREFILTER_MIN_COMMITMENT_GATES as f64 * scale).round() as i32).max(if is_small_map { 1 } else { 2 }),          │
   │ 1634  -          min_false_progress: ((BASE_PREFILTER_MIN_FALSE_PROGRESS as f64 * scale).round() as i32).max(if is_small_map { 3 } else { 5 }),              │
   │ 1636  +          min_counter_intuitive: if is_small_map { ci.min(3) } else { ci },                                                                           │
   │ 1637  +          min_attractive_decoys: if is_small_map { decoys.min(4) } else { decoys },                                                                   │
   │ 1638  +          min_commitment_gates: if is_small_map { gates.min(2) } else { gates },                                                                      │
   │ 1639  +          min_false_progress: if is_small_map { fp.min(4) } else { fp },                                                                              │
   │ 1640         }                                                                                                                                               │
   │ 1641     }                                                                                                                                                   │
   ╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 ✔ Build and restart
    $ cd /Users/jmogainz/mazle/generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -3 && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -3
    └ 7 lines...

 ✔ Check new thresholds
    $ docker logs mazle-generator_instance 2>&1 | grep -E "Map|Prefilters" | tail -5
    └ 1 line...

 ✔ Test with new thresholds
    $ timeout 40 curl -s "http://10.0.0.240:8080/api/generate/newtest" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle'];
    print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves, {d['generationTimeMs']}ms\")" || echo "Timeout"
    └ 2 lines...

 ● Excellent! 15x15 with 10 moves in 1.3 seconds! Let me run a few more tests:

 ○ Test multiple seeds
   $ for s in a b c d e; do timeout 40 curl -s "http://10.0.0.240:8080/api/generate/$s" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin);
   p=d['puzzle']; print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves, {d['generationTimeMs']}ms\")" || echo "Timeout"; done
    └ 1 line...

