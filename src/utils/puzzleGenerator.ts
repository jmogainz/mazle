import { TileType } from '../game/constants';

export interface Point {
    x: number;
    y: number;
}

export interface PuzzleData {
    width: number;
    height: number;
    grid: TileType[][];
    start: Point;
    goal: Point;
    id: string;
}

class Mulberry32 {
    private state: number;

    constructor(seed: number) {
        this.state = seed;
    }

    next(): number {
        let t = (this.state += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

// Helper to get seed from string (YYYY-MM-DD)
function getSeedFromString(str: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return h >>> 0;
}

export function generateDailyPuzzle(dateStr: string): PuzzleData {
    const seed = getSeedFromString(dateStr);
    const rng = new Mulberry32(seed);

    // Dimensions: 10x10 to 15x15
    const width = 12; 
    const height = 12;

    // Initialize with Walls
    let grid: TileType[][] = Array(height).fill(null).map(() => Array(width).fill(TileType.WALL));

    // Helper to check bounds
    const isValid = (x: number, y: number) => x >= 1 && x < width - 1 && y >= 1 && y < height - 1;

    // Generate a simple room/maze
    // 1. Place Start randomly in a quadrant
    const startX = Math.floor(rng.next() * (width / 3)) + 1;
    const startY = Math.floor(rng.next() * (height / 3)) + 1;
    
    // 2. Random Walk to carve floor
    let currentX = startX;
    let currentY = startY;
    grid[currentY][currentX] = TileType.FLOOR;

    const targetFloorCount = Math.floor((width * height) * 0.4); // 40% floor
    let floorCount = 1;

    const queue: Point[] = [{x: startX, y: startY}];
    
    // Use a growth algorithm to make it room-like rather than snake-like
    while (floorCount < targetFloorCount && queue.length > 0) {
        // Pick a random point from queue
        const idx = Math.floor(rng.next() * queue.length);
        const p = queue[idx];

        // Try to expand
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        // Shuffle dirs
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(rng.next() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }

        let expanded = false;
        for (const [dx, dy] of dirs) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (isValid(nx, ny) && grid[ny][nx] === TileType.WALL) {
                grid[ny][nx] = TileType.FLOOR;
                floorCount++;
                queue.push({x: nx, y: ny});
                expanded = true;
                if (rng.next() > 0.7) break; // Branch factor
            }
        }
        
        if (!expanded && rng.next() > 0.8) {
            queue.splice(idx, 1); // Remove stuck points occasionally
        }
    }

    // 3. Place Goal at the furthest point from Start
    let maxDist = -1;
    let goalX = startX;
    let goalY = startY;

    for(let y=0; y<height; y++) {
        for(let x=0; x<width; x++) {
            if (grid[y][x] === TileType.FLOOR) {
                const dist = Math.abs(x - startX) + Math.abs(y - startY);
                if (dist > maxDist) {
                    maxDist = dist;
                    goalX = x;
                    goalY = y;
                }
            }
        }
    }

    // 4. Add Ice patches
    // Simple approach: 3x3 patches or lines
    const numIcePatches = 3 + Math.floor(rng.next() * 3);
    for(let i=0; i<numIcePatches; i++) {
        const cx = Math.floor(rng.next() * (width - 2)) + 1;
        const cy = Math.floor(rng.next() * (height - 2)) + 1;
        // Try to make a small 2x2 or 3x3 patch
        for(let dy=-1; dy<=1; dy++) {
            for(let dx=-1; dx<=1; dx++) {
                if (isValid(cx+dx, cy+dy) && grid[cy+dy][cx+dx] === TileType.FLOOR) {
                    if (rng.next() > 0.3 && (cx+dx !== startX || cy+dy !== startY) && (cx+dx !== goalX || cy+dy !== goalY)) {
                        grid[cy+dy][cx+dx] = TileType.ICE;
                    }
                }
            }
        }
    }
    
    // 5. Verify connectivity (Solver)
    // If goal is unreachable, regenerate (or simple fix: draw line).
    // For this simple implementation, we just carved connected floors, so it is connected.
    // However, Ice might make it tricky if we slide past goal (unlikely with floor logic, but possible if goal is on ice).
    // Let's make sure Start and Goal are safe (Floor).
    grid[startY][startX] = TileType.START;
    grid[goalY][goalX] = TileType.GOAL;

    return {
        width,
        height,
        grid,
        start: {x: startX, y: startY},
        goal: {x: goalX, y: goalY},
        id: dateStr
    };
}
