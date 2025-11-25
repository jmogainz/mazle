# Mazle 🧊

A daily Pokémon-inspired puzzle game where players navigate compact, gym-style mazes using step movement, sliding on ice, and one-way ledges.

## 🚀 Quick Start

```bash
# 1. Set your runner ID (add to your shell profile for convenience)
export UNIQUE_RUNNER_ID=$(whoami)

# 2. Start the development server
make up

# 3. Open http://localhost:3000
```

That's it! The app runs in Docker with hot-reload enabled.

### Other Useful Commands

```bash
# See all available commands
make help

# Stop the development server
make down

# Full cleanup (containers, images, volumes)
make clean

# Run tests
make ci
```

## 📦 Deployment

### Production (Vercel)

The app is deployed to Vercel. To deploy manually:

```bash
# Deploy to production (uses vercel --prod)
VERCEL_TOKEN=... ENV=prod make up
```

> **Note:** Requires `VERCEL_TOKEN` in your environment. If `.vercel/project.json` is not committed, also provide `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIQUE_RUNNER_ID` | **Required.** Your identifier (e.g., `$(whoami)`) |
| `ENV` | Environment: `dev-test` (default), `staging`, `prod` |
| `VERCEL_TOKEN` | Required for Vercel deploys |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Only required if `.vercel/project.json` is not checked in |

## 🎮 How to Play

1. Navigate from the **start** (green) to the **goal** (yellow star)
2. Use **arrow keys**, **WASD**, or **swipe** on mobile
3. **Floor tiles**: Normal step movement
4. **Ice tiles**: Slide until hitting a wall
5. **Ledges**: One-way movement (can only enter from one direction)
6. **Walls**: Block movement

Complete the puzzle in as few moves as possible!

## 🎯 Features

- **Daily Puzzles**: A new puzzle available globally each day
- **Multiple Mechanics**: Floor tiles, walls, ice (sliding), and one-way ledges
- **Scoring System**: Track moves and completion time
- **Shareable Results**: Clean share cards with efficiency bar
- **Statistics**: Track your streak, win rate, and history
- **Mobile Support**: Touch controls with swipe gestures

## 🛠️ Tech Stack

- **Next.js 14** - React framework
- **Phaser 3** - Game engine for rendering
- **TypeScript** - Type safety
- **CSS Modules** - Scoped styling
- **Docker** - Containerized development

## 📁 Project Structure

```
mazle/
├── src/
│   ├── app/              # Next.js app router
│   │   ├── layout.tsx    # Root layout
│   │   ├── page.tsx      # Main game page
│   │   └── globals.css   # Global styles
│   ├── components/       # React UI components
│   │   ├── GameUI.tsx    # Move counter, timer
│   │   ├── ShareCard.tsx # Victory share modal
│   │   ├── StatsModal.tsx
│   │   ├── HelpModal.tsx
│   │   ├── Header.tsx
│   │   └── MobileControls.tsx
│   ├── game/             # Phaser game logic
│   │   ├── GameScene.ts  # Main game scene
│   │   ├── PhaserGame.tsx # React wrapper
│   │   ├── puzzleGenerator.ts
│   │   └── types.ts
│   └── utils/
│       └── storage.ts    # LocalStorage helpers
├── devops-toolkit/       # Build/deploy infrastructure
├── Makefile              # Development commands
└── mazle.compose.yaml    # Docker compose config
```

## 🔧 Development Notes

### Dev Tools

In `dev-test` environment, a debug panel appears with:
- Custom seed input for testing specific puzzles
- Date-based seed loading (e.g., `2025-01-15`)
- Random seed generation

### Daily System

- Puzzles reset at **midnight UTC**
- Same puzzle for all players globally
- Deterministic generation using date-based seed
- Streak tracking for consecutive daily completions

## 📚 Additional Resources

- [Full Spec](docs/mazle_spec.md) - Detailed game specification
- [DevOps Toolkit](devops-toolkit/README.md) - Build/deploy documentation
