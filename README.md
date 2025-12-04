# Mazle 🧊

A daily Pokémon-inspired puzzle game where players navigate compact, gym-style mazes using step movement, sliding on ice, and one-way ledges.

## Quick Start

```bash
# Required: Set your runner ID (add to shell profile)
export UNIQUE_RUNNER_ID=$(whoami)

# Start dev server (WASM fallback, no backend)
make up

# Open http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `make up` | Start frontend (ENV=dev-test default, WASM fallback) |
| `make up ENV=dev` | Start with Rust backend auto-launching |
| `make up ENV=dev AUTO_LAUNCH_BACKEND=0` | Dev mode, frontend only |
| `make down` | Stop containers |
| `make clean` | Full cleanup (containers, images, volumes) |
| `make wasm` | Rebuild WASM from Rust sources |
| `make help` | List all targets |

## Environments

| ENV | Backend | Use Case |
|-----|---------|----------|
| `dev-test` | WASM fallback | Default, quick iteration |
| `dev` | Auto-starts (port 3001) | Full stack local dev |
| `staging` | Remote | Pre-prod testing |
| `prod` | Remote (Shuttle) | Production |

Override backend behavior: `AUTO_LAUNCH_BACKEND=0` or `AUTO_LAUNCH_BACKEND=1`

## Deployment

```bash
# Frontend → Vercel
VERCEL_TOKEN=... ENV=prod make up

# Backend → Shuttle (from generator-rust/)
cd generator-rust && ENV=prod make up
```

## Project Structure

```
mazle/
├── src/                    # Next.js app + Phaser game
├── generator-rust/         # Rust puzzle generator (WASM + HTTP)
├── devops-toolkit/         # Build system (submodule)
└── Makefile               # Root build orchestration
```

## How to Play

- **Arrow keys / WASD / Swipe** to move
- **Floor tiles**: Step movement
- **Ice tiles**: Slide until hitting a wall
- **Ledges**: One-way (can only enter from one direction)
- Goal: Reach ⭐ from start in minimum moves
