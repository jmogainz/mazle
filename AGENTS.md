# Mazle - AI Agent Guide

## What is Mazle?

A daily Wordle-style puzzle game inspired by Pokémon ice gym puzzles. Players navigate compact rooms using step movement, ice sliding, and one-way ledges. Browser-first (Next.js + Phaser 3).

## Development Workflow

```bash
# Required env var (add to shell profile)
export UNIQUE_RUNNER_ID=$(whoami)

# Common workflows
make up                              # Quick start (WASM fallback)
make up ENV=dev                      # Full stack (frontend + Rust backend)
make up ENV=dev AUTO_LAUNCH_BACKEND=0  # Dev mode, frontend only
make down                            # Stop containers
make clean                           # Full cleanup
make wasm                            # Rebuild WASM from Rust
make help                            # List all targets
```

## Environment Behavior

| ENV | AUTO_LAUNCH_BACKEND | Notes |
|-----|---------------------|-------|
| `dev-test` (default) | 0 | WASM fallback, fast iteration |
| `dev` | 1 (override with =0) | Full local stack |
| `staging` | 1 | Pre-prod |
| `prod` | 0 | Backend already deployed |

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
- `generator-rust/Makefile` - Backend build/deploy (Shuttle)
- `src/game/GameScene.ts` - Main Phaser game logic
- `src/game/puzzleGenerator.ts` - WASM/HTTP generator interface

## Puzzle Generation

Two modes:
1. **WASM** (client-side): `src/wasm/generator/` - runs in web workers
2. **HTTP** (server-side): `generator-rust/` on port 3001 - Rust Axum server

Frontend auto-detects: uses HTTP if `NEXT_PUBLIC_GENERATOR_URL` set, else WASM fallback.

## Deployment

- **Frontend**: Vercel (`ENV=prod make up` with `VERCEL_TOKEN`)
- **Backend**: Shuttle (`cd generator-rust && ENV=prod make up`)

## Game Spec Summary

- **Tiles**: Floor (step), Wall (block), Ice (slide), Ledge (one-way), Start, Goal
- **Target**: ~20 moves, <3 min solve time
- **Scoring**: Move count (primary), time (tiebreaker)
- **Daily**: Same puzzle globally, midnight UTC reset
