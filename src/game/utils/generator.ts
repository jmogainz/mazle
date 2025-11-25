import seedrandom from 'seedrandom';
import { GRID_HEIGHT, GRID_WIDTH, TileType } from './constants';

interface Point {
  x: number;
  y: number;
}

export class LevelGenerator {
  private rng: seedrandom.PRNG;

  constructor(seed: string) {
    this.rng = seedrandom(seed);
  }

  generate(): { grid: TileType[][]; start: Point; goal: Point } {
    // Initialize with Walls
    const grid: TileType[][] = Array(GRID_HEIGHT)
      .fill(null)
      .map(() => Array(GRID_WIDTH).fill(TileType.WALL));

    // Random Start and Goal (ensure they are apart)
    // For simplicity, put Start in top-left quadrant, Goal in bottom-right
    const start = {
      x: Math.floor(this.rng() * (GRID_WIDTH / 2 - 2)) + 1,
      y: Math.floor(this.rng() * (GRID_HEIGHT / 2 - 2)) + 1,
    };

    const goal = {
      x: Math.floor(this.rng() * (GRID_WIDTH / 2 - 2)) + GRID_WIDTH / 2,
      y: Math.floor(this.rng() * (GRID_HEIGHT / 2 - 2)) + GRID_HEIGHT / 2,
    };

    grid[start.y][start.x] = TileType.START;
    grid[goal.y][goal.x] = TileType.GOAL;

    // Carve path
    this.carvePath(grid, start, goal);

    // Add noise/extras
    this.addIce(grid);
    
    // Cleanup walls to ensure boundary
    for(let y=0; y<GRID_HEIGHT; y++) {
        for(let x=0; x<GRID_WIDTH; x++) {
            if (x === 0 || x === GRID_WIDTH-1 || y === 0 || y === GRID_HEIGHT-1) {
                grid[y][x] = TileType.WALL;
            }
        }
    }
    
    // Re-ensure start/goal are correct types (in case boundary overwrite happened, though margin should prevent)
    grid[start.y][start.x] = TileType.START;
    grid[goal.y][goal.x] = TileType.GOAL;

    return { grid, start, goal };
  }

  private carvePath(grid: TileType[][], start: Point, goal: Point) {
    let current = { ...start };
    
    // Simple random walk towards goal with some variation
    const maxSteps = GRID_WIDTH * GRID_HEIGHT * 2;
    let steps = 0;

    while ((current.x !== goal.x || current.y !== goal.y) && steps < maxSteps) {
      grid[current.y][current.x] = 
        (current.x === start.x && current.y === start.y) ? TileType.START : 
        TileType.FLOOR;

      // Determine direction
      const moveX = goal.x - current.x;
      const moveY = goal.y - current.y;

      let dirs = [];
      if (moveX !== 0) dirs.push(moveX > 0 ? {x:1, y:0} : {x:-1, y:0});
      if (moveY !== 0) dirs.push(moveY > 0 ? {x:0, y:1} : {x:0, y:-1});
      
      // Add some randomness to explore
      dirs.push({x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1});

      const dir = dirs[Math.floor(this.rng() * dirs.length)];
      
      const nextX = current.x + dir.x;
      const nextY = current.y + dir.y;

      if (nextX > 0 && nextX < GRID_WIDTH - 1 && nextY > 0 && nextY < GRID_HEIGHT - 1) {
        current = { x: nextX, y: nextY };
      }
      steps++;
    }

    // If we timed out, force a straight line (fallback)
    if (current.x !== goal.x || current.y !== goal.y) {
        // Just fill rectangular region
        const minX = Math.min(start.x, goal.x);
        const maxX = Math.max(start.x, goal.x);
        const minY = Math.min(start.y, goal.y);
        const maxY = Math.max(start.y, goal.y);
        
        for(let y = minY; y <= maxY; y++) {
            for(let x = minX; x <= maxX; x++) {
                if (grid[y][x] === TileType.WALL) grid[y][x] = TileType.FLOOR;
            }
        }
    }
  }

  private addIce(grid: TileType[][]) {
    // Randomly turn some floors into ice
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (grid[y][x] === TileType.FLOOR) {
          // 15% chance of ice
          if (this.rng() < 0.15) {
            grid[y][x] = TileType.ICE;
          }
        }
      }
    }
  }
}
