# Mazle - AI Agent Instructions

## What is Mazle?

A daily Wordle-style puzzle game inspired by Pokémon ice gym puzzles. Players navigate compact rooms using step movement, ice sliding, and one-way ledges. Browser-first (Next.js + Phaser 3).

---

## 🚨 CRITICAL: Use Make Commands Only

**DO NOT use these commands directly:**
- ❌ `npm install` / `npm run build` / `npm run dev`
- ❌ `cargo build` / `cargo run`
- ❌ `docker build` / `docker compose`
- ❌ `vercel deploy`
- ❌ `fly deploy`

**ALWAYS use the Make targets provided below.** All build, test, and deployment workflows are orchestrated through the root `Makefile` and `generator-rust/Makefile`.

---

## Required Setup

Before ANY command, you MUST export:

```bash
export UNIQUE_RUNNER_ID=$(whoami)
```

This is required for all Make commands. Set it once per session.

---

## Development Workflow

### Starting Services

```bash
# Quick start (WASM fallback, no backend) - DEFAULT
make up

# Full stack (frontend + Rust backend auto-launch)
make up ENV=dev

# Dev mode, frontend only (backend must already be running)
make up ENV=dev WITH_DEPS=0

# Stop all services
make down

# Full cleanup (containers, images, volumes)
make clean
```

### Building Code

```bash
# Build frontend (from root directory)
# This also rebuilds WASM from Rust sources
make build

# Build ONLY the Rust backend (from generator-rust/ directory)
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build
```

**IMPORTANT:**
- Frontend changes: Use `make build` from root
- Backend changes: Use `cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build`
- Never use `npm` or `cargo` directly

### Testing Changes

```bash
# Restart backend after changes
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev

# Test backend endpoint (example)
curl -s "http://10.0.0.240:8080/api/generate/test" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle']; print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves\")"

# Check backend logs
docker logs mazle-generator_instance 2>&1 | tail -30
```

**Testing Checklist:**
1. After frontend changes: `make build` → verify build succeeds
2. After backend changes: `cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build`
3. Restart services if needed: `make up ENV=dev` or `cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev`
4. Test the specific feature you changed
5. Do NOT run full test suites unless explicitly requested by user

---

## Environment Behavior

| ENV | WITH_DEPS | Notes |
|-----|-----------|-------|
| `dev-test` (default) | 0 | WASM fallback, fast iteration |
| `dev` | 1 (override with =0) | Full local stack |
| `staging` | 1 | Pre-prod (Fly.io) |
| `prod` | 1 (override with =0) | Deploy backend to Fly.io, frontend to Vercel |

**Environment Selection Rules:**
- **Default (no ENV)**: Use `dev-test` with WASM fallback
- **Local full stack**: Use `ENV=dev`
- **Skip backend**: Add `WITH_DEPS=0` to any environment
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
- `Makefile` - Root build targets, WASM build, orchestration (USE THIS)
- `generator-rust/Makefile` - Backend build/deploy (USE THIS for backend)
- `mazle.compose.yaml` - Docker Compose for frontend
- `package.json` - Frontend deps (DO NOT use npm directly)
- `generator-rust/Cargo.toml` - Rust deps (DO NOT use cargo directly)

**Game Logic:**
- `src/game/GameScene.ts` - Main Phaser game scene
- `src/game/wasmGenerator.ts` - WASM/HTTP generator interface
- `src/game/generationWorker.ts` - Web worker for WASM generation
- `generator-rust/src/lib.rs` - WASM bindings
- `generator-rust/src/generators/ice.rs` - Ice puzzle generator

**API Routes:**
- `src/app/api/daily/route.ts` - Daily puzzle endpoint
- `src/app/api/cron/generate/route.ts` - Pre-generation cron

---

## Puzzle Generation System

Two generation backends (produce **identical puzzles** for same seed):

1. **WASM** (client-side):
   - Location: `src/wasm/generator/` (compiled from `generator-rust/`)
   - Runs in web worker (`src/game/generationWorker.ts`)
   - Uses rayon thread pool for parallelism
   - Fallback when HTTP backend unavailable

2. **HTTP** (server-side):
   - Location: `generator-rust/` (Rust Axum server on port 8080)
   - Runs with native rayon parallelism
   - Primary backend when available

**Frontend auto-detection:**
- Uses HTTP if `NEXT_PUBLIC_GENERATOR_URL` environment variable is set
- Falls back to WASM if HTTP unavailable
- See `src/game/wasmGenerator.ts` for routing logic

**When modifying generation:**
1. Edit Rust code in `generator-rust/src/generators/`
2. Build: `cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build`
3. For WASM: Also run `make build` from root to rebuild WASM bundle
4. Restart: `cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev`

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

**Deployment Checklist:**
1. Verify `ENV=prod` is correct environment
2. Confirm required tokens are set
3. Test locally first with `ENV=dev`
4. Deploy backend first if doing full stack
5. Monitor logs after deployment

---

## Game Specification

- **Tiles**: Floor (step), Wall (block), Ice (slide), Ledge (one-way), Start, Goal
- **Target**: ~20 moves, <3 min solve time
- **Scoring**: Move count (primary), time (tiebreaker)
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
**ALWAYS verify builds after code changes:**

1. **Frontend changes:** 
   ```bash
   make build
   ```

2. **Backend changes:**
   ```bash
   cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build
   ```

3. **Both changed:**
   ```bash
   cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build
   cd .. && make build
   ```

### Error Handling
If a build/command fails:
1. Read the error message carefully
2. Fix ONLY the error that occurred
3. Do NOT "improve" other code while fixing
4. Verify fix with same command that failed

---

## Common Patterns

### Testing Backend Changes
```bash
# 1. Edit code in generator-rust/src/
# 2. Build
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -5

# 3. Restart
cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5

# 4. Test endpoint
curl -s "http://10.0.0.240:8080/api/generate/test" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle']; print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves, {d['generationTimeMs']}ms\")"

# 5. Check logs if needed
docker logs mazle-generator_instance 2>&1 | tail -30
```

### Testing Frontend Changes
```bash
# 1. Edit code in src/
# 2. Build (includes WASM rebuild if generator-rust changed)
make build 2>&1 | tail -20

# 3. Start/restart
make up ENV=dev

# 4. Test in browser at http://localhost:8080
```

### Checking Service Status
```bash
# Frontend container
docker ps | grep mazle

# Backend container
docker ps | grep generator

# Backend logs
docker logs mazle-generator_instance 2>&1 | tail -50

# Frontend logs
docker logs mazle-instance 2>&1 | tail -50
```

---

## Example: Backend Modification Workflow

This example shows the correct workflow for modifying backend code:

```bash
# User request: "Change puzzle size to 15x15"

# 1. Find the relevant code
$ grep "SIZE_OPTIONS" generator-rust/src/generators/ice.rs

# 2. Edit the code (using edit tool)
# Changed: (14, 14) → (15, 15)

# 3. Build to verify changes compile
$ cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make build 2>&1 | tail -3
   Compiling mazle-generator v0.1.0
   Finished release [optimized] target(s)
Build complete

# 4. Restart server with new code
$ cd generator-rust && UNIQUE_RUNNER_ID=$(whoami) make up ENV=dev 2>&1 | tail -5
Container mazle-generator_instance started

# 5. Test the change
$ curl -s "http://10.0.0.240:8080/api/generate/test15" | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['puzzle']; print(f\"{p['width']}x{p['height']}, {p['optimalMoves']} moves\")"
15x15, 10 moves

# 6. Success! Change verified.
```

**Key Points:**
- Used `make build` and `make up`, NOT `cargo build`
- Used `UNIQUE_RUNNER_ID=$(whoami)` for all make commands
- Verified change with specific test, not full test suite
- Made minimal changes - only what was requested

---

## Troubleshooting

### "UNIQUE_RUNNER_ID not set"
```bash
export UNIQUE_RUNNER_ID=$(whoami)
```

### "Permission denied" on make commands
- Ensure Docker is running
- Check Docker permissions for your user

### Build hangs or times out
- Stop existing containers: `make down`
- Clean up: `make clean`
- Try again: `make build`

### Backend not accessible
- Check if container is running: `docker ps | grep generator`
- Check logs: `docker logs mazle-generator_instance`
- Verify port 8080 is not in use: `lsof -i :8080`

### WASM build fails
- WASM is built inside Docker - no host Rust needed
- If build fails, check: `make build` output
- Clean rebuild: `make clean && make build`

---

## Summary of Rules

1. ✅ **ALWAYS** use `make` commands - NEVER use `npm`, `cargo`, `docker` directly
2. ✅ **ALWAYS** set `UNIQUE_RUNNER_ID=$(whoami)` before any make command
3. ✅ **ALWAYS** verify builds after code changes
4. ✅ **ALWAYS** use minimal changes - only fix what's requested
5. ❌ **NEVER** deploy to production unless explicitly requested
6. ❌ **NEVER** run full test suites unless explicitly requested
7. ❌ **NEVER** fix unrelated bugs or "improve" code beyond the request
8. ❌ **NEVER** use `npm install`, `cargo build`, or direct Docker commands

**When in doubt:** Check this file, or ask the user for clarification.
