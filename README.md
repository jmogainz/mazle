# Mazle 🎮

A daily Pokémon-inspired puzzle game where players navigate compact, gym-style mazes using step movement, sliding on ice, and one-way ledges.

## 🎯 Features

- **Daily Puzzles**: A new puzzle available globally each day
- **Multiple Mechanics**: Floor tiles, walls, ice (sliding), and one-way ledges
- **Scoring System**: Track moves and completion time
- **Shareable Results**: Wordle-style share cards with emoji minimap
- **Statistics**: Track your streak, win rate, and history
- **Mobile Support**: Touch controls with swipe gestures and on-screen D-pad

## 🎮 How to Play

1. Navigate from the start (green) to the goal (yellow star)
2. Use arrow keys, WASD, or swipe on mobile
3. **Floor tiles**: Normal step movement
4. **Ice tiles**: Slide until hitting a wall
5. **Ledges**: One-way movement (can only enter from one direction)
6. **Walls**: Block movement

Complete the puzzle in as few moves as possible!

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## 🛠️ Tech Stack

- **Next.js 14** - React framework
- **Phaser 3** - Game engine for rendering and physics
- **TypeScript** - Type safety
- **CSS Modules** - Scoped styling

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
│   │   ├── puzzleGenerator.ts # Puzzle generation
│   │   └── types.ts      # TypeScript types
│   └── utils/
│       └── storage.ts    # LocalStorage helpers
├── public/               # Static assets
└── package.json
```

## 🎨 Design

- **Pixel art aesthetic** with crisp rendering
- **Dark theme** inspired by Pokémon gym interiors
- **Responsive design** for desktop and mobile
- **Accessible** with keyboard and touch support

## 🔄 Daily System

- Puzzles reset at midnight UTC
- Same puzzle for all players globally
- Deterministic generation using date-based seed
- Streak tracking for consecutive daily completions

## 📦 Deployment

This project is configured for deployment on Vercel:

```bash
# Deploy to Vercel
vercel

# Or connect your GitHub repo to Vercel for automatic deployments
```

## 📜 License

MIT

