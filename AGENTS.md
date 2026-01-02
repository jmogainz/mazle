# Mazle - AI Agent Instructions

## What is Mazle?

A daily Wordle-style puzzle game inspired by Pokémon ice gym puzzles. Players navigate compact rooms using step movement, ice sliding, and one-way ledges. Browser-first (Next.js + Phaser 3).

**Game Mechanic:** Binary lives system - player must complete puzzle in exactly the optimal number of moves or they lose that life. Backtracking cost is irrelevant; once you make a wrong move, the life is burned.

---

## ✅ Preferred: Use Make for Build/Run/Deploy

**Make is the preferred path for build, run, and deploy workflows.** Use the root `Makefile` and `generator-rust/Makefile` whenever a suitable target exists.

**Direct CLI commands are allowed** when:
- You are inspecting, debugging, or querying local services (e.g., `docker ps`, `docker logs`, `psql`).
- There is no Make target for the task.
- You need a one-off command that does not replace the normal build/run/deploy flow.

**Exception:** You may use `cargo build` / `cargo run` **only for ML-related work inside `generator-rust/`** (e.g., `generator-rust/ml` or `generator-rust/ml/bridge`) when a Make target is not available.

**ALWAYS use the Make targets provided below** for all other build, test, and deployment workflows. All orchestration runs through the root `Makefile` and `generator-rust/Makefile`.

If you choose a direct command for build/run/deploy, call it out explicitly and explain why Make isn’t used.

---

## Required Setup

Before any **Make** command, you MUST export:

```bash
export UNIQUE_RUNNER_ID=$(whoami)
```

This is required for all Make commands. Set it once per session.

---

## Development Workflow

### Starting Services

**NOTE:** `make up` automatically builds before starting. You do NOT need to run `make build` first.

```bash
# Full stack (frontend + Rust backend) - DEFAULT
make up

# Quick start (WASM fallback, no backend)
make up ENV=dev-test

# Dev mode, frontend only (backend must already be running)
make up ENV=dev WITH_DEPS=0

# Stop all services
make down

# Full cleanup (containers, images, volumes)
make clean
```

### Building Code (Only When Needed)

`make up` handles builds automatically. Only use `make build` directly when:
- You want to verify compilation without starting services
- You need to rebuild WASM for frontend-only deployment

```bash
# Build frontend + WASM (from root directory)
make build

# Build ONLY the Rust backend (from generator-rust/ directory)
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build
```

### Backend Development Workflow

**The standard iterative workflow for backend changes:**

```bash
# 1. Edit code in generator-rust/src/

# 2. Build and restart (make up does both!)
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5

# 3. Test the endpoint with inline Python parsing
curl -s "http://10.0.0.240:8080/api/generate/test-seed" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d['puzzle']
print(f\"paths={p.get('nearOptimalPaths',0)} olap={p.get('pathOverlap',1.0):.3f} ediv={p.get('earlyDivergence',0):.2f} time={d['generationTimeMs']/1000:.1f}s\")
"

# 4. Check logs for fail rates and diagnostics
docker logs mazle-generator_instance 2>&1 | grep "fail rates:" | tail -1

# 5. Iterate: edit code → make up → test → check logs
```

---

## Iterative Testing Patterns

### Testing Puzzle Generation

Use inline Python to parse JSON responses and extract metrics:

```bash
# Single puzzle test with full metrics
curl -s "http://10.0.0.240:8080/api/generate/test-1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d['puzzle']
print(f\"score={p.get('difficultyScore',0)} paths={p.get('nearOptimalPaths',0)} olap={p.get('pathOverlap',1.0):.3f} ediv={p.get('earlyDivergence',0):.2f} dir={p.get('directionChanges',0)} amb={p.get('decisionAmbiguity',0):.1f} time={d['generationTimeMs']/1000:.1f}s\")
"
```

### Batch Testing (Multiple Puzzles)

**⚠️ IMPORTANT: Run puzzles SEQUENTIALLY, not in parallel!** Parallel generation requests compete for CPU and skew timing results. Always wait for one puzzle to complete before starting the next.

```bash
# Generate 10 puzzles SEQUENTIALLY and show metrics
for i in $(seq 1 10); do
  curl -s "http://10.0.0.240:8080/api/generate/batch-$i" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d['puzzle']
print(f\"paths={p.get('nearOptimalPaths',0)} olap={p.get('pathOverlap',1.0):.3f} ediv={p.get('earlyDivergence',0):.2f} time={d['generationTimeMs']/1000:.1f}s\")
"
done
```

### Analyzing Fail Rates

The generator logs which filters are causing rejections:

```bash
# Check current fail rates
docker logs mazle-generator_instance 2>&1 | grep "fail rates:" | tail -1

# Example output:
# Batch 170 fail rates: uopt=17% ci=0% dec=0% gate=0% fp=0% loc=0% dir=24% bt=0% amb=24% paths=64% olap_max=76% ediv=75% (n=6565)
```

**Key metrics to watch:**
- `uopt` - Unique optimal path (must be exactly 1)
- `paths` - Near-optimal path count threshold
- `olap_max` - Maximum path overlap threshold
- `ediv` - Early divergence threshold
- `dir` - Direction changes
- `amb` - Decision ambiguity

**Target:** ~50-70% fail rate on core metrics (paths, olap, ediv) indicates good difficulty filtering.

### Statistical Analysis

For deeper analysis, save to file and process:

```bash
# Generate 20 puzzles to CSV
for i in $(seq 1 20); do
  curl -s "http://10.0.0.240:8080/api/generate/stats-$i" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d['puzzle']
print(f\"{p.get('difficultyScore',0)},{p.get('nearOptimalPaths',0)},{p.get('pathOverlap',0):.3f},{p.get('earlyDivergence',0):.2f},{d['generationTimeMs']}\")
"
done | tee /tmp/metrics.csv

# Analyze with Python
python3 << 'EOF'
import statistics
data = open('/tmp/metrics.csv').read().strip().split('\n')
scores, paths, olaps, edivs, times = [], [], [], [], []
for line in data:
    parts = line.split(',')
    if len(parts) == 5:
        scores.append(int(parts[0]))
        paths.append(int(parts[1]))
        olaps.append(float(parts[2]))
        edivs.append(float(parts[3]))
        times.append(int(parts[4]))

print(f"score:  {min(scores)}-{max(scores)}, avg={statistics.mean(scores):.0f}")
print(f"paths:  {min(paths)}-{max(paths)}, avg={statistics.mean(paths):.1f}")
print(f"olap:   {min(olaps):.3f}-{max(olaps):.3f}, avg={statistics.mean(olaps):.3f}")
print(f"ediv:   {min(edivs):.2f}-{max(edivs):.2f}, avg={statistics.mean(edivs):.2f}")
print(f"time:   {min(times)}-{max(times)}ms, avg={statistics.mean(times):.0f}ms")
EOF
```

---

## Environment Behavior

| ENV | WITH_DEPS | Notes |
|-----|-----------|-------|
| `dev` (default) | 1 (override with =0) | Full local stack |
| `dev-test` | 0 | WASM fallback, fast iteration |
| `staging` | 1 | Pre-prod (Fly.io) |
| `prod` | 1 (override with =0) | Deploy backend to Fly.io, frontend to Vercel |

**Environment Selection Rules:**
- **Default (no ENV)**: Use `dev` with full local stack (Rust backend)
- **WASM Fallback**: Use `ENV=dev-test` to skip backend
- **Skip backend in dev**: Add `WITH_DEPS=0` to `ENV=dev`
- **Production**: Only use `ENV=prod` when explicitly deploying

---

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

---

## Key Files Reference

**Build & Deploy:**
- `Makefile` - Root build targets, WASM build, orchestration (PREFERRED for build/run/deploy)
- `generator-rust/Makefile` - Backend build/deploy (PREFERRED for backend build/run/deploy)
- `mazle.compose.yaml` - Docker Compose for frontend
- `package.json` - Frontend deps (prefer Make for build/run; npm ok for tooling when needed)
- `generator-rust/Cargo.toml` - Rust deps (prefer Make for build/run; cargo ok for tooling when needed)

**Game Logic:**
- `src/game/GameScene.ts` - Main Phaser game scene
- `src/game/wasmGenerator.ts` - WASM/HTTP generator interface
- `src/game/generationWorker.ts` - Web worker for WASM generation
- `generator-rust/src/lib.rs` - WASM bindings
- `generator-rust/src/generators/ice.rs` - Ice puzzle generator (MAIN FILE)

**API Routes:**
- `src/app/api/daily/route.ts` - Daily puzzle endpoint
- `src/app/api/cron/generate/route.ts` - Pre-generation cron

---

## Puzzle Generation System

### Two Generation Backends

Both produce **identical puzzles** for same seed:

1. **WASM** (client-side):
   - Location: `src/wasm/generator/` (compiled from `generator-rust/`)
   - Runs in web worker (`src/game/generationWorker.ts`)
   - Fallback when HTTP backend unavailable

2. **HTTP** (server-side):
   - Location: `generator-rust/` (Rust Axum server on port 8080)
   - Primary backend when available

### Difficulty Metrics (Ranked by Importance)

**TIER 1 - Core Difficulty (what actually makes puzzles hard):**
- `paths` (near_optimal_paths) - More paths = more "this could work" confusion
- `olap` (path_overlap) - Low overlap = truly different routes exist
- `ediv` (early_divergence) - Confusion from move 1

**TIER 2 - Per-Move Confusion:**
- `dir` (direction_changes) - Zigzags harder to visualize
- `amb` (decision_ambiguity) - More choices per move

**DISABLED (irrelevant with binary lives):**
- `gate` (commitment_gates) - Backtrack cost doesn't matter
- `bt` (backtrack_depth) - Backtrack cost doesn't matter
- `loc` (path_locality) - Spread doesn't matter
- `ci`, `dec`, `fp` - Overlap with paths/olap metrics

### Modifying Generation

```bash
# 1. Edit Rust code
vi generator-rust/src/generators/ice.rs

# 2. Build and restart (single command!)
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5

# 3. Test
curl -s "http://10.0.0.240:8080/api/generate/test" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle']; print(f\"paths={p.get('nearOptimalPaths',0)} olap={p.get('pathOverlap',1.0):.3f}\")"

# 4. Check fail rates
docker logs mazle-generator_instance 2>&1 | grep "fail rates:" | tail -1
```

---

## Deployment

**ONLY deploy when explicitly requested by user.**

```bash
# Full stack (backend + frontend)
# Requires: VERCEL_TOKEN and FLY_API_TOKEN
make up ENV=prod

# Frontend only (backend must already be deployed)
# Requires: VERCEL_TOKEN
make up ENV=prod WITH_DEPS=0

# Backend only
# Requires: FLY_API_TOKEN
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=prod
```

---

## Game Specification

- **Tiles**: Floor (step), Wall (block), Ice (slide), Ledge (one-way), Start, Goal
- **Target**: 10 moves optimal for 15x15 map
- **Lives**: Binary success/failure - must complete in exactly optimal moves
- **Daily**: Same puzzle globally, midnight UTC reset

---

## Agent Decision Making

### When to Edit Code
✅ **DO edit when:**
- User explicitly requests a feature/fix
- You find a bug directly related to user's request
- Code needs updating to implement requested change

❌ **DO NOT edit when:**
- Unrelated bugs exist
- Tests are failing for unrelated features
- Code style doesn't match your preferences
- "While you're at it..." improvements

### Build Verification

**Use `make up` - it builds automatically!**

```bash
# Backend changes - builds and restarts:
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5

# Frontend changes - builds and restarts:
make up ENV=dev 2>&1 | tail -10
```

Only use standalone `make build` when you want to verify compilation without starting services.

### Error Handling
If a build/command fails:
1. Read the error message carefully
2. Fix ONLY the error that occurred
3. Do NOT "improve" other code while fixing
4. Verify fix with same command that failed

---

## Troubleshooting

### "UNIQUE_RUNNER_ID not set"
```bash
export UNIQUE_RUNNER_ID=$(whoami)
```

### Backend not accessible
```bash
# Check if container is running
docker ps | grep generator

# Check logs
docker logs mazle-generator_instance 2>&1 | tail -30

# Verify port
lsof -i :8080
```

### Generation too slow
Check fail rates - if any metric is >80%, consider relaxing that threshold:
```bash
docker logs mazle-generator_instance 2>&1 | grep "fail rates:" | tail -1
```

### WASM build fails
WASM is built inside Docker - no host Rust needed:
```bash
make clean && make build
```

---

## Summary of Rules

1. ✅ **PREFER** `make up` to build AND start (not `make build` then `make up`)
2. ✅ **ALWAYS** set `UNIQUE_RUNNER_ID=$(whoami)` before any make command
3. ✅ **ALWAYS** test with curl + Python parsing after changes
4. ✅ **ALWAYS** check fail rates in logs when tuning thresholds
5. ✅ **ALWAYS** edit the existing migration file (assume not deployed yet); **NEVER** create a new migration file
6. ❌ **NEVER** deploy to production unless explicitly requested
7. ❌ **NEVER** run full test suites unless explicitly requested
8. ❌ **NEVER** fix unrelated bugs or "improve" code beyond the request
9. ✅ **ALLOWED** to use direct CLI (npm/cargo/docker/psql/etc.) for inspection/debugging or when no Make target exists; **prefer Make** for build/run/deploy

**When in doubt:** Check this file, or ask the user for clarification.
