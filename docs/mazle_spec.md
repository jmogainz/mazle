# Mazle

## 1. Overview
A daily, Pokémon-inspired puzzle where players navigate a compact, gym-style maze using step movement, sliding on ice, and one-way ledges.  
The puzzle is designed to be quick, satisfying, solvable, and optimized for **move count** (primary metric) and **completion time** (secondary metric).  
A new puzzle is available globally each day with shareable results and leaderboards.

---

## 2. Core Vision
- Inspired by classic **Pokémon ice gyms**, one-way ledges, and small logic rooms.  
- **Pixel-art aesthetic** with crisp rendering and simple animations.  
- Puzzle solves in **~20 effective moves**, and typical players complete in **under 3 minutes**.  
- Small, readable puzzle rooms instead of large wandering mazes.  
- Viral and social: share card, daily streak, competitive metrics.

---

## 3. Platforms & Tech Stack  
*(Subject to change based on feasibility)*

### v1 Target Platforms
- **Browser (desktop + mobile)**  
  - Focus on instant-play, Wordle-style friction profile.

### Future Platforms
- Mobile app wrapper (Capacitor / Tauri / Expo WebView).

### Likely Tech Choices (Flexible)
- **TypeScript**  
- **Phaser 3** for game rendering + tilemap handling  
- **Optional React** for UI components (leaderboard, stats, share card)  
- Backend: lightweight serverless routes for daily seed + leaderboard submissions.

---

## 4. Controls

### Desktop
- Arrow keys  
- WASD  

### Mobile
- Swipe input  
- Optional on-screen movement buttons (accessibility)

### Movement Behavior
- **Step-based** on normal floor tiles  
- **Automatic sliding** on ice tiles (Pokémon style)

---

## 5. Puzzle Structure
- Puzzle room resembles a **Pokémon gym puzzle**, not a full maze.  
- **No fixed grid size required**; daily puzzles can vary in shape and dimensions.  
- Rooms should be small, clear, visually parseable in seconds.  
- Layout examples:
  - 10×10 square  
  - 12×14 rectangular block  
  - L-shaped room  
  - Two connected chambers  
- Avoid giant mazes or long paths that feel like navigation instead of puzzle-solving.

---

## 6. Tile Types & Mechanics

### Core v1 Tile Types
- **Floor** – normal movement  
- **Wall** – blocks movement  
- **Start** – player spawn  
- **Goal** – endpoint  
- **Ice tile** – slides until hitting a wall (Pokémon style)  
- **Lledge (one-way)** – can drop down; cannot climb back up (direction-locked transition)

### Optional v2+ Mechanics
- Teleport pads  
- One-way arrow tiles (forced direction tiles)  
- Pushable blocks  
- Switches / toggles  
- Seasonal themed tiles (snow piles, pumpkins, etc.)

### Mechanic Philosophy
- Only **a small subset** of mechanics appear on any given day.  
- Start v1 with **a minimal, predictable set** (ice + ledges + walls).  
- Introduce new obstacles gradually, ensuring readability and fairness.

---

## 7. Generation Constraints

### Solvability
- Every puzzle must be guaranteed solvable based on movement rules:  
  - step movement  
  - sliding on ice  
  - one-way ledges  

### Difficulty Target
- **Solution depth:** ~20 effective moves  
- Puzzle should be completable in **1–3 minutes** by most players.  
- Avoid:
  - Overly linear trivial puzzles  
  - Excessively branching dead-ends early  
  - Trap states without signaling  

### Layout Constraints
- Puzzle must be visually understandable within 1–1.5 seconds.  
- Avoid overly complex geometries or tight corridors unless theme requires it.  
- Ice sections should be placed **sparingly** and not dominate daily puzzles.

### Mechanics Frequency
- Ice does **not** need to appear daily  
- Ledges appear only when puzzle logic supports them  
- Seasonal obstacles optional  
- Mechanic variety should increase slowly over the game's lifespan

### Deterministic Daily Seed
- Puzzle generated via:  
  `seed = YYYY-MM-DD + serverSalt`  
- All players see the **same puzzle globally**.

---

## 8. Metrics & Scoring

### Primary Metrics
- **Move count** (primary ranking metric)  
- **Completion time** (tie-breaker after move count)

### Metric Philosophy
- Moves reward efficient planning  
- Time rewards precision and mastery  
- Both support a high skill ceiling without punishing casual players

---

## 9. Daily System

- One **global puzzle per day**  
- Resets at **midnight (UTC or PST, TBD)**  
- **Daily streak** system  
- Optional: weekly recap or trends (v2)  
- Optional: non-competitive archive of past puzzles

---

## 10. Social Features

### v1
- **Share card (Wordle-style)**  
  - Daily puzzle number  
  - Move count  
  - Completion time  
  - Simple emoji/minimap representation

- **Leaderboards**
  - Global  
  - Regional (country/locale)  
  - Friends-only  

- **Friends List**
  - Share code or friend link  
  - Compare stats for the day

### v2
- Ghost runs (friend or global top player)  
- “Beat my time / moves” challenge link  
- Weekly leaderboards

---

## 11. Art Direction

### Style
- **Pokémon-inspired pixel art**  
- Nearest-neighbor (crisp) scaling  
- Simple, readable tiles  
- Clean UI with minimal clutter

### Animations
- Sliding animation on ice  
- Small bump animation when hitting a wall  
- Goal sparkle or flare when completed  
- Seasonal micro-effects (optional)

---

## 12. Non-Goals (v1)
- No combat or NPCs  
- No multi-floor dungeons  
- No heavy cutscenes or lore  
- No overly complex mechanics  
- No ads or monetization  
- Avoid anything requiring in-depth tutorials  

---

## 13. Roadmap (Optional v2+)
- New tile mechanics  
- Seasonal puzzle variants  
- Full mobile app  
- Player skins or cosmetic themes  
- Achievements/badges  
- Ghost races  
- Weekly challenge mode  
