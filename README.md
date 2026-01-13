# Mazle 🧊

A daily Pokémon-inspired puzzle game where players navigate compact, gym-style mazes using step movement, sliding on ice, and one-way ledges.

## Quick Start

```bash
# Required: Set your runner ID (add to shell profile)
export UNIQUE_RUNNER_ID=$(whoami)

# Start dev server (Full stack: frontend + Rust backend)
make up

# Open http://localhost:8080 (port may vary - check console output)
```

## Commands

| Command | Description |
|---------|-------------|
| `make up` | Start full stack (ENV=dev default, includes Rust backend) |
| `make up ENV=dev-test` | Start with WASM fallback (no backend) |
| `make up ENV=dev WITH_DEPS=0` | Frontend only (connect to existing backend) |
| `make up FRONTEND_RELEASE_MODE=1` | Run prod-style Next.js build (no hot reload) |
| `make up ENV=prod` | Deploy backend (Fly.io) + frontend (Vercel) |
| `make down` | Stop containers |
| `make clean` | Full cleanup (containers, images, volumes) |
| `make build` | Rebuild WASM from Rust sources (Dockerized, no host Rust needed) |
| `make help` | List all targets |

## Release-mode Toggle

Need to reproduce Vercel's optimized build locally? Append `FRONTEND_RELEASE_MODE=1` to any `make up` invocation (e.g. `make up FRONTEND_RELEASE_MODE=1`). The frontend container will:

- force `NODE_ENV=production` and disable dev overlays/devtools
- run `npm run build` once, then serve with `npm run start`
- skip aggressive file watchers (no hot reload — restart the service after code changes)

This keeps the rest of your Make/ENV flags intact while letting you benchmark the exact code we deploy.

## Environments

| ENV | WITH_DEPS | Backend | Use Case |
|-----|-----------|---------|----------|
| `dev` | 1 | Auto-starts (port 8080) | Default, full stack local dev |
| `dev-test` | 0 | WASM fallback | Quick iteration, no backend needed |
| `staging` | 1 | Fly.io | Pre-prod testing |
| `prod` | 1 | Fly.io | Production |

Override backend: `WITH_DEPS=0` to skip, `WITH_DEPS=1` to include

## Deployment

```bash
# Full stack (backend + frontend)
VERCEL_TOKEN=... FLY_API_TOKEN=... make up ENV=prod

# Frontend only (connect to existing backend)
VERCEL_TOKEN=... make up ENV=prod WITH_DEPS=0

# Backend only
cd generator-rust && make up ENV=prod
```

## Project Structure

```
mazle/
├── src/                    # Next.js app + Phaser game
├── generator-rust/         # Rust puzzle generator (WASM + HTTP)
├── devops-toolkit/         # Build system (submodule)
└── Makefile               # Root build orchestration
```

## Daily Puzzle Flow

Daily puzzles are pre-generated at 11 PM ET via Vercel Cron and cached in Vercel KV for instant loading. If the cache misses, the system self-heals with on-demand generation and community backfill.

```
┌─────────────────┐
│ localStorage?   │─── hit ──→ Done! ✅
└────────┬────────┘
         │ miss
         ▼
┌─────────────────────────────────────────────┐
│              GET /api/daily                 │
│  KV hit? ──→ Return ✅                      │
│  KV miss ──→ Rust gen ──→ Store ──→ Return ✅│
└─────────────────────────┬───────────────────┘
                          │ fail (Rust down)
                          ▼
               ┌─────────────────┐
               │ WASM (browser)  │──→ Return ✅
               └────────┬────────┘
                        │
                        ▼ (async, fire-and-forget)
               ┌─────────────────┐
               │ POST /api/daily │
               │ /cache          │──→ Backfill KV (NX)
               └─────────────────┘
                        │
                        ▼
               Next user gets instant load! 🎉
```

**Key guarantees:**
- Puzzles never change mid-day (KV writes use NX = only if not exists)
- Thread-safe backfill from concurrent WASM generations
- Self-healing on fresh deploy or cron failure

## How to Play

- **Arrow keys / WASD / Swipe** to move
- **Floor tiles**: Step movement
- **Ice tiles**: Slide until hitting a wall
- **Ledges**: One-way (can only enter from one direction)
- Goal: Reach ⭐ from start in minimum moves
