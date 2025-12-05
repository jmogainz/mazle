# Mazle 🧊

A daily Pokémon-inspired puzzle game where players navigate compact, gym-style mazes using step movement, sliding on ice, and one-way ledges.

## Quick Start

```bash
# Required: Set your runner ID (add to shell profile)
export UNIQUE_RUNNER_ID=$(whoami)

# Start dev server (WASM fallback, no backend)
make up

# Open http://localhost:8080 (port may vary - check console output)
```

## Commands

| Command | Description |
|---------|-------------|
| `make up` | Start frontend (ENV=dev-test default, WASM fallback) |
| `make up ENV=dev` | Start with Rust backend auto-launching |
| `make up ENV=dev WITH_DEPS=0` | Dev mode, frontend only |
| `make up ENV=prod` | Deploy backend (Fly.io) + frontend (Vercel) |
| `make down` | Stop containers |
| `make clean` | Full cleanup (containers, images, volumes) |
| `make wasm` | Rebuild WASM from Rust sources (Dockerized, no host Rust needed) |
| `make help` | List all targets |

## Environments

| ENV | WITH_DEPS | Backend | Use Case |
|-----|-----------|---------|----------|
| `dev-test` | 0 | WASM fallback | Default, quick iteration |
| `dev` | 1 | Auto-starts (port 8080) | Full stack local dev |
| `staging` | 1 | Fly.io | Pre-prod testing |
| `prod` | 1 | Fly.io | Production |

Override backend: `WITH_DEPS=0` to skip, `WITH_DEPS=1` to include

## Deployment

```bash
# Full stack (backend + frontend)
VERCEL_TOKEN=... FLY_API_TOKEN=... make up ENV=prod

# Frontend only (backend must already be deployed)
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
