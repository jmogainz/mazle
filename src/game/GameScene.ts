import * as Phaser from 'phaser';
import {
  TileType,
  Direction,
  Position,
  PuzzleData,
  GameState,
  COLORS,
  TILE_SIZE,
  MapType,
  HINTS_ENABLED,
} from './types';
import { emitGameEvent } from './events';
import {
  simulateMove,
  getDelta,
  getMovementConfig,
  MovementConfig,
  positionKey,
  simulateGroundMove,
  createGroundState,
  GroundPuzzleState,
} from './movement';

export class GameScene extends Phaser.Scene {
  private puzzle!: PuzzleData;
  private gameState!: GameState;
  private movementConfig!: MovementConfig;
  private player!: Phaser.GameObjects.Container;
  private tileGraphics!: Phaser.GameObjects.Graphics;
  private hintTileContainers: Phaser.GameObjects.Container[] = [];
  private hintTileTweens: Phaser.Tweens.Tween[] = [];
  private goalSprite!: Phaser.GameObjects.Container;
  private flashOverlay!: Phaser.GameObjects.Graphics;
  private isAnimating = false;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key } | null = null;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private offsetX = 0;
  private offsetY = 0;
  private readonly tileFaceLift = 3 * (TILE_SIZE / 32); // lift sprites to sit on the top face of 3D tiles

  private isPlaying = false;
  
  // Boulder state tracking (for ground maps)
  private boulderPositions: Set<string> = new Set();
  private boulderSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private analysisObjects: Phaser.GameObjects.GameObject[] = [];

  private solutionIndexByKey: Map<string, number> | null = null;
  private solutionNextByKey: Map<string, string> | null = null;
  private solutionPosByKey: Map<string, Position> | null = null;
  private solutionEdges: Set<string> | null = null; // All edges in solution for correct move counting

  private unlockedHintTiles: Set<string> = new Set();
  private unlockedHintEdges: Set<string> = new Set();
  private unlockedThisLifeTiles: Set<string> = new Set();
  private unlockedThisLifeEdges: Set<string> = new Set();

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { puzzle: PuzzleData }) {
    this.puzzle = data.puzzle;
    // Get movement config based on map type (defaults to ice for legacy puzzles)
    this.movementConfig = getMovementConfig(this.puzzle.mapType ?? MapType.ICE);
    this.isPlaying = false;
    this.gameState = {
      playerPos: { ...this.puzzle.start },
      moveCount: 0,
      currentAttemptMoves: 0,
      currentAttemptCorrectMoves: 0,
      lives: 3,
      penaltyTimeMs: 0,
      attempts: [],
      startTime: 0,
      endTime: null,
      isComplete: false,
      isSliding: false,
      moveHistory: [{ ...this.puzzle.start }],
    };

    this.unlockedHintTiles = new Set();
    this.unlockedHintEdges = new Set();
    this.unlockedThisLifeTiles = new Set();
    this.unlockedThisLifeEdges = new Set();
    this.indexSolutionPath();
    
    // Initialize boulder positions from puzzle tiles
    this.boulderPositions = new Set();
    this.boulderSprites = new Map();
    for (let y = 0; y < this.puzzle.height; y++) {
      for (let x = 0; x < this.puzzle.width; x++) {
        if (this.puzzle.tiles[y][x] === TileType.BOULDER) {
          this.boulderPositions.add(positionKey({ x, y }));
        }
      }
    }
  }

  create() {
    // Calculate offset to center the puzzle
    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;
    this.offsetX = (gameWidth - this.puzzle.width * TILE_SIZE) / 2;
    this.offsetY = (gameHeight - this.puzzle.height * TILE_SIZE) / 2;

    // Draw tiles
    this.drawTiles();

    // Create hint overlays (above tiles, below sprites)
    this.createHintOverlays();
    
    // Create boulder sprites (for ground maps)
    this.createBoulderSprites();
    
    // Create goal with animation
    this.createGoal();
    
    // Create player
    this.createPlayer();
    
    // Create flash overlay
    this.createFlashOverlay();
    
    // Setup input
    this.setupInput();
    
    // Emit initial state
    emitGameEvent('stateUpdate', { ...this.gameState });
  }
  
  private createBoulderSprites() {
    // Create sprites for each boulder position
    for (const key of this.boulderPositions) {
      const [x, y] = key.split(',').map(Number);
      this.createBoulderSprite(x, y);
    }
  }
  
  private createBoulderSprite(gridX: number, gridY: number): Phaser.GameObjects.Container {
    const px = this.offsetX + gridX * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + gridY * TILE_SIZE + TILE_SIZE / 2;
    
    const boulder = this.add.container(px, py);
    const key = positionKey({ x: gridX, y: gridY });
    
    // Boulder graphics - matches the tile drawing
    const g = this.add.graphics();
    const size = TILE_SIZE;
    const s = size / 32; // Scale factor
    const boulderSize = size * 0.75;
    const halfSize = boulderSize / 2;
    
    // Main boulder body
    g.fillStyle(COLORS.BOULDER);
    g.fillRoundedRect(-halfSize, -halfSize, boulderSize, boulderSize, 6 * s);
    
    // Shadow
    g.fillStyle(COLORS.BOULDER_SHADOW);
    g.fillRoundedRect(-halfSize + 3 * s, -halfSize + boulderSize - 6 * s, boulderSize - 6 * s, 4 * s, 2 * s);
    g.fillRoundedRect(-halfSize + boulderSize - 6 * s, -halfSize + 3 * s, 4 * s, boulderSize - 6 * s, 2 * s);
    
    // Highlight
    g.fillStyle(COLORS.BOULDER_HIGHLIGHT);
    g.fillCircle(-halfSize + 8 * s, -halfSize + 8 * s, 3 * s);
    g.fillRoundedRect(-halfSize + 4 * s, -halfSize + 3 * s, boulderSize * 0.4, 3 * s, 1 * s);
    
    boulder.add(g);
    this.boulderSprites.set(key, boulder);
    
    return boulder;
  }

  private drawTiles() {
    this.tileGraphics = this.add.graphics();
    
    for (let y = 0; y < this.puzzle.height; y++) {
      for (let x = 0; x < this.puzzle.width; x++) {
        const tile = this.puzzle.tiles[y][x];
        const px = this.offsetX + x * TILE_SIZE;
        const py = this.offsetY + y * TILE_SIZE;
        
        this.drawTile(px, py, tile, x, y);
      }
    }
  }

  // hintLevel: 0 = none, 1 = path (lighter green), 2 = stop (brighter glow)
  private drawTile(px: number, py: number, tile: TileType, gridX: number, gridY: number, hintLevel = 0) {
    const g = this.tileGraphics;
    const size = TILE_SIZE;
    const s = size / 32; // Scale factor based on original design (32px)

    const padding = 2 * s; // Gap between tiles
    const radius = 8 * s;
    const depth = 4 * s;   // 3D lip height

    // Helper: Draw a "Waffle Style" 3D Tile
    const draw3DTile = (faceColor: number, edgeColor: number) => {
        const x = px + padding;
        const y = py + padding;
        const w = size - padding * 2;
        const h = size - padding * 2;

        // Subtle layered glow for hinted tiles
        if (hintLevel > 0) {
          const glowColor = COLORS.HINT_GLOW;
          const layers = 2;
          const maxExpand = 4 * s;
          const baseAlpha = hintLevel === 2 ? 0.08 : 0.05;
          const maxAlpha = hintLevel === 2 ? 0.2 : 0.12;
          
          for (let i = layers; i >= 1; i--) {
            const expand = (i / layers) * maxExpand;
            const alpha = baseAlpha + (1 - i / layers) * (maxAlpha - baseAlpha);
            
            g.fillStyle(glowColor, alpha);
            g.fillRoundedRect(
              x - expand, 
              y - expand, 
              w + expand * 2, 
              h + expand * 2, 
              radius + expand
            );
          }
        }

        // Determine tile colors based on hint level
        let actualFace = faceColor;
        let actualEdge = edgeColor;
        
        if (hintLevel === 2) {
          // Stopping points: darker green
          actualFace = COLORS.HINT_TILE_FACE;
          actualEdge = COLORS.HINT_TILE_EDGE;
        } else if (hintLevel === 1) {
          // Intermediate path: lighter green
          actualFace = COLORS.HINT_PATH_FACE;
          actualEdge = COLORS.HINT_PATH_EDGE;
        }

        // 1. Draw Edge (Bottom Layer / Shadow)
        g.fillStyle(actualEdge);
        g.fillRoundedRect(x, y, w, h, radius);

        // 2. Draw Face (Top Layer)
        g.fillStyle(actualFace);
        g.fillRoundedRect(x, y, w, h - depth, radius);
    };

    switch (tile) {
      case TileType.GROUND:
        draw3DTile(COLORS.GROUND_FACE, COLORS.GROUND_EDGE);
        break;

      case TileType.START:
        draw3DTile(COLORS.START_FACE, COLORS.START_EDGE);
        break;

      case TileType.GOAL:
        draw3DTile(COLORS.GOAL_FACE, COLORS.GOAL_EDGE);
        break;

      case TileType.WALL:
        draw3DTile(COLORS.WALL_FACE, COLORS.WALL_EDGE);
        break;

      case TileType.ICE:
        draw3DTile(COLORS.ICE_FACE, COLORS.ICE_EDGE);
        
        // Frosty reflection lines (Clean simplified version)
        {
          const inset = 4 * s;
          const faceX = px + padding + inset;
          const faceY = py + padding + inset;
          const faceW = size - padding * 2 - inset * 2;
          const faceH = size - padding * 2 - depth - inset * 2;

          // Subtle white reflection streaks
          g.lineStyle(1 * s, 0xffffff, 0.65);

          // Primary reflection
          g.beginPath();
          g.moveTo(faceX + faceW * 0.2, faceY + faceH * 0.8);
          g.lineTo(faceX + faceW * 0.8, faceY + faceH * 0.2);
          g.strokePath();

          // Secondary small reflection
          g.beginPath();
          g.moveTo(faceX + faceW * 0.6, faceY + faceH * 0.9);
          g.lineTo(faceX + faceW * 0.9, faceY + faceH * 0.6);
          g.strokePath();
        }
        break;

      case TileType.LEDGE_UP:
      case TileType.LEDGE_DOWN:
      case TileType.LEDGE_LEFT:
      case TileType.LEDGE_RIGHT:
        draw3DTile(COLORS.LEDGE_FACE, COLORS.LEDGE_EDGE);

        // Simple filled triangle centered on the tile face
        const cx = px + size / 2;
        const cy = py + size / 2 - depth / 2;
        const baseWidth = size * 0.32;
        const baseHeight = size * 0.20;
        const shrink = 1 * s;               // trim top/bottom by 1px
        const lift = depth * 0.6;       // subtle perspective lift toward the pointing direction
        const halfW = baseWidth / 2;
        const halfH = Math.max(baseHeight / 2 - shrink, 1);

        g.fillStyle(COLORS.LEDGE_ARROW);
        // Base "up" triangle points relative to center
        const upA = { x: 0, y: -halfH - lift };
        const upB = { x: -halfW, y: halfH };
        const upC = { x: halfW, y: halfH };

        const rotate = (p: { x: number; y: number }, dir: 'up' | 'down' | 'left' | 'right') => {
          switch (dir) {
            case 'up':
              return { x: p.x, y: p.y };
            case 'down':
              return { x: p.x, y: -p.y };
            case 'right':
              return { x: -p.y, y: p.x };
            case 'left':
              return { x: p.y, y: -p.x };
          }
        };

        const dir =
          tile === TileType.LEDGE_UP ? 'down' : // enter from above, exit downward
          tile === TileType.LEDGE_DOWN ? 'up' : // enter from below, exit upward
          tile === TileType.LEDGE_RIGHT ? 'right' : 'left';

        const A = rotate(upA, dir);
        const B = rotate(upB, dir);
        const C = rotate(upC, dir);

        g.fillTriangle(cx + A.x, cy + A.y, cx + B.x, cy + B.y, cx + C.x, cy + C.y);
        break;

      case TileType.BOULDER:
        // Draw ground first
        draw3DTile(COLORS.GROUND_FACE, COLORS.GROUND_EDGE);
        break;
    }
  }

  private createGoal() {
    const px = this.offsetX + this.puzzle.goal.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.goal.y * TILE_SIZE + TILE_SIZE / 2;
    const FACE_LIFT = this.tileFaceLift; // raise visuals to sit on the top face of the 3D tile
    
    this.goalSprite = this.add.container(px, py - FACE_LIFT);
    this.goalSprite.setDepth(10); // Above hint tiles
    
    const s = TILE_SIZE / 32;

    // 3D Star Drawing Helper
    const drawStar = (color: number, offsetY: number, outlineColor?: number) => {
        const star = this.add.graphics();
        star.fillStyle(color);
        if (outlineColor !== undefined) {
            star.lineStyle(.5 * s, outlineColor);
        }
        
        const points = 5;
        const outerRadius = 11 * s;
        const innerRadius = 4.5 * s;  // balance between sharp and soft angles
        const rot = Math.PI / 2 * 3;
        const step = Math.PI / points;

        star.beginPath();
        star.moveTo(0, offsetY - outerRadius);
        for (let i = 0; i < points; i++) {
            star.lineTo(
              Math.cos(rot + step * i * 2) * outerRadius,
              offsetY + Math.sin(rot + step * i * 2) * outerRadius
            );
            star.lineTo(
              Math.cos(rot + step * (i * 2 + 1)) * innerRadius,
              offsetY + Math.sin(rot + step * (i * 2 + 1)) * innerRadius
            );
        }
        star.lineTo(0, offsetY - outerRadius);
        star.closePath();
        star.fillPath();
        if (outlineColor !== undefined) {
            star.strokePath();
        }
        
        this.goalSprite.add(star);
    };

    // 1. Draw Shadow/Edge (Dark Yellow) - Offset slightly down from face center
    drawStar(0xdaa520, 2 * s);

    // 2. Draw Face (Bright Gold) - On face center
    // Use darker gold/brown for outline (Dark Goldenrod: 0xb8860b)
    drawStar(0xffd700, 0, 0xb8860b);
    
    // Static (no pulse) to respect 3D tile face
  }

  private createPlayer() {
    const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2;
    const FACE_LIFT = this.tileFaceLift; // raise visuals to sit on the top face of the 3D tile
    
    this.player = this.add.container(px, py - FACE_LIFT);
    this.player.setDepth(20); // Above everything except flash overlay
    
    const s = TILE_SIZE / 32;

    // Classic little character with eyes (returns from pre-overhaul)
    const body = this.add.graphics();

    // Shadow
    body.fillStyle(0x000000, 0.25);
    body.fillEllipse(0, 8 * s, 16 * s, 6 * s);

    // Body
    body.fillStyle(COLORS.PLAYER_FACE);
    body.fillRoundedRect(-8 * s, -10 * s, 16 * s, 18 * s, 3 * s);

    // Outline
    body.lineStyle(1.25 * s, COLORS.PLAYER_EDGE);
    body.strokeRoundedRect(-8 * s, -10 * s, 16 * s, 18 * s, 3 * s);

    // Eyes
    body.fillStyle(0xffffff);
    body.fillCircle(-3 * s, -4 * s, 3 * s);
    body.fillCircle(3 * s, -4 * s, 3 * s);
    body.fillStyle(0x000000);
    body.fillCircle(-2 * s, -4 * s, 1.5 * s);
    body.fillCircle(4 * s, -4 * s, 1.5 * s);

    this.player.add(body);
  }

  private createFlashOverlay() {
    this.flashOverlay = this.add.graphics();
    this.flashOverlay.fillStyle(0xff0000, 1);
    this.flashOverlay.fillRect(0, 0, this.scale.width, this.scale.height);
    this.flashOverlay.setAlpha(0);
    this.flashOverlay.setDepth(100); // Ensure it's on top
  }

  private setupInput() {
    // Keyboard input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }

    // Touch/swipe input
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.swipeStartX = pointer.x;
      this.swipeStartY = pointer.y;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const dx = pointer.x - this.swipeStartX;
      const dy = pointer.y - this.swipeStartY;
      const minSwipe = 30;
      
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minSwipe) {
        this.handleMove(dx > 0 ? Direction.RIGHT : Direction.LEFT);
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > minSwipe) {
        this.handleMove(dy > 0 ? Direction.DOWN : Direction.UP);
      }
    });
  }

  update() {
    if (this.isAnimating || this.gameState.isComplete) return;

    // Check keyboard input (only if keyboard and cursors are available)
    if (this.input.keyboard && this.cursors && this.wasd) {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.wasd.W)) {
        this.handleMove(Direction.UP);
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down) || Phaser.Input.Keyboard.JustDown(this.wasd.S)) {
        this.handleMove(Direction.DOWN);
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.left) || Phaser.Input.Keyboard.JustDown(this.wasd.A)) {
        this.handleMove(Direction.LEFT);
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right) || Phaser.Input.Keyboard.JustDown(this.wasd.D)) {
        this.handleMove(Direction.RIGHT);
      }
    }
  }

  private handleMove(dir: Direction) {
    if (this.isAnimating || this.gameState.isComplete || !this.isPlaying) return;

    const currentPos = { ...this.gameState.playerPos };
    
    // Check if this is a ground map with boulders
    const isGroundMap = this.puzzle.mapType === MapType.GROUND;
    const hasBoulders = this.boulderPositions.size > 0;
    
    if (isGroundMap && hasBoulders) {
      // Use ground movement simulation with boulder support
      this.handleGroundMove(dir);
    } else {
      // Use standard movement simulation (ice maps or ground without boulders)
      this.handleStandardMove(dir);
    }
  }
  
  private handleLifeLost(finalPos: Position) {
    this.gameState.lives--;
    this.gameState.penaltyTimeMs += 10000; // 10s penalty

    this.mergeHintsForNextLife();
    
    // Calculate deviation index
    const deviationIndex = this.findDeviationIndex(this.gameState.moveHistory, this.puzzle.solutionPath || []);

    // Record attempt
    this.gameState.attempts.push({
      moveCount: this.gameState.currentAttemptMoves,
      correctMoves: this.gameState.currentAttemptCorrectMoves,
      path: [...this.gameState.moveHistory], // Snapshot of history for this attempt
      failedAt: finalPos,
      deviationIndex,
    });

    // Reset for next life
    this.gameState.currentAttemptMoves = 0;
    this.gameState.currentAttemptCorrectMoves = 0;
    this.gameState.moveHistory = [{ ...this.puzzle.start }];
    this.gameState.playerPos = { ...this.puzzle.start };

    // Apply hint visuals (visible starting next life)
    if (HINTS_ENABLED) {
      this.redrawHintOverlays();
    }

    // Emit event for UI (penalty visual)
    emitGameEvent('stateUpdate', { ...this.gameState });
    emitGameEvent('lifeLost', { 
        lives: this.gameState.lives, 
        penaltyMs: 10000 
    });

    if (this.gameState.lives <= 0) {
      this.handleGameOver();
    } else {
      // Block input during respawn sequence
      this.isAnimating = true;

      // Visual Feedback: Camera Shake & Subtle Red Flash
      this.cameras.main.shake(200, 0.01);
      
      // Flash overlay
      this.flashOverlay.setAlpha(0.3);
      this.tweens.add({
        targets: this.flashOverlay,
        alpha: 0,
        duration: 300,
        ease: 'Quad.easeOut'
      });
      
      // Player "Death" animation
      this.tweens.add({
        targets: this.player,
        scaleX: 1.5,
        scaleY: 1.5,
        alpha: 0,
        duration: 200,
        ease: 'Quad.easeOut',
        onComplete: () => {
             // ... rest of teleport logic
             this.time.delayedCall(200, () => {
                const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
                const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
                this.player.setPosition(px, py);
                this.player.setScale(0); // Start small
                this.player.setAlpha(1);

                // Pop in at start
                this.tweens.add({
                    targets: this.player,
                    scaleX: 1,
                    scaleY: 1,
                    duration: 400,
                    ease: 'Back.out',
                    onComplete: () => {
                        this.isAnimating = false;
                    }
                });
             });
        }
      });
    }
  }

  private handleGameOver() {
    this.gameState.isComplete = true;
    this.gameState.endTime = Date.now(); // Timer continues until end
    
    // Hide player
    this.player.setVisible(false);

    // Final intense flash and shake
    this.cameras.main.shake(400, 0.015);
    this.flashOverlay.setAlpha(0.5);
    
    // Linger the flash then fade
    this.tweens.add({
      targets: this.flashOverlay,
      alpha: 0,
      duration: 600,
      delay: 200, // Linger for 200ms before fading
      ease: 'Quad.easeOut',
      onComplete: () => {
        // Emit state update so UI knows game is complete
        emitGameEvent('stateUpdate', { ...this.gameState });
        
        emitGameEvent('gameComplete', {
          moveCount: this.gameState.moveCount,
          timeMs: ((this.gameState.endTime ?? this.gameState.startTime) - this.gameState.startTime) + this.gameState.penaltyTimeMs,
          optimalMoves: this.puzzle.optimalMoves,
          failed: true,
          attempts: this.gameState.attempts,
          solutionPath: this.puzzle.solutionPath,
        });
      }
    });
  }

  private drawEndGameAnalysis() {
    if (!this.puzzle.solutionPath) return;
    
    // Clear previous analysis if any (just in case called multiple times without restart)
    this.clearAnalysis();

    const g = this.add.graphics();
    this.analysisObjects.push(g);
    
    const path = this.puzzle.solutionPath;
    const s = TILE_SIZE / 32;

    // 1. Draw Solution Path
    if (path.length > 1) {
        // Vivid Green Path
        const pathColor = 0x2eec71; // Brighter, more vivid green
        
        g.lineStyle(5 * s, pathColor, 0.8);
        g.beginPath();
        
        const startPx = this.offsetX + path[0].x * TILE_SIZE + TILE_SIZE / 2;
        const startPy = this.offsetY + path[0].y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
        g.moveTo(startPx, startPy);
        
        for (let i = 1; i < path.length; i++) {
            const px = this.offsetX + path[i].x * TILE_SIZE + TILE_SIZE / 2;
            const py = this.offsetY + path[i].y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
            g.lineTo(px, py);
        }
        g.strokePath();
        
        // Numbered Waypoints
        for (let i = 0; i < path.length; i++) {
            const px = this.offsetX + path[i].x * TILE_SIZE + TILE_SIZE / 2;
            const py = this.offsetY + path[i].y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
            
            // Solid Green Circle
            g.fillStyle(pathColor, 1);
            g.fillCircle(px, py, 11 * s);
            
            // Dark Border for contrast
            g.lineStyle(2 * s, COLORS.TEXT, 1); // Using dark text color (0x1a1a1a)
            g.strokeCircle(px, py, 11 * s);
            
            // Move Number
            const t = this.add.text(px, py, i.toString(), {
                fontSize: `${13 * s}px`,
                fontFamily: 'Arial',
                color: '#ffffff',
                fontStyle: 'bold'
            }).setOrigin(0.5);
            this.analysisObjects.push(t);
        }
    }
    
    // 2. Draw Deviation Points (Where lives were lost)
    // Map position key to array of attempt numbers (1-based)
    const deviationMap = new Map<string, number[]>();
    
    this.gameState.attempts.forEach((attempt, attemptIndex) => {
        let pos = attempt.failedAt;
        if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1 && attempt.path[attempt.deviationIndex]) {
             pos = attempt.path[attempt.deviationIndex];
        }

        if (pos) {
            const key = `${pos.x},${pos.y}`;
            if (!deviationMap.has(key)) {
                deviationMap.set(key, []);
            }
            deviationMap.get(key)!.push(attemptIndex + 1);
        }
    });
    
    deviationMap.forEach((lifeNumbers, key) => {
        const [x, y] = key.split(',').map(Number);
        const px = this.offsetX + x * TILE_SIZE + TILE_SIZE / 2;
        const py = this.offsetY + y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
        
        // Draw a "Skull" or "X" marker - Cleaner than big red circle
        const markerSize = 10 * s;
        
        // White background for contrast
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(px, py, 12 * s);
        
        // Red X
        g.lineStyle(3 * s, COLORS.PLAYER_FACE, 1);
        g.beginPath();
        g.moveTo(px - markerSize/2, py - markerSize/2);
        g.lineTo(px + markerSize/2, py + markerSize/2);
        g.moveTo(px + markerSize/2, py - markerSize/2);
        g.lineTo(px - markerSize/2, py + markerSize/2);
        g.strokePath();

        // Attempt Number Badges
        lifeNumbers.forEach((lifeNumber, i) => {
            // Distribute badges if multiple failures at same spot
            let dx = 8 * s;
            let dy = 8 * s;
            
            // i=0: Bottom-Right (+8, +8)
            // i=1: Top-Right (+8, -8)
            // i=2: Bottom-Left (-8, +8)
            
            if (i === 1) dy = -8 * s;
            if (i === 2) dx = -8 * s;
            
            const badgeX = px + dx;
            const badgeY = py + dy;
            
            // Badge Circle (using same graphics object 'g')
            g.fillStyle(COLORS.PLAYER_FACE, 1);
            g.fillCircle(badgeX, badgeY, 7 * s);
            
            const t = this.add.text(badgeX, badgeY, lifeNumber.toString(), { 
                fontSize: `${10 * s}px`, 
                fontFamily: 'Arial',
                color: '#ffffff', 
                fontStyle: 'bold'
            }).setOrigin(0.5);
            this.analysisObjects.push(t);
        });
    });
  }

  private findDeviationIndex(path: Position[], solution: Position[]): number {
    if (!solution) return -1;
    
    const len = Math.min(path.length, solution.length);
    for (let i = 0; i < len; i++) {
        if (path[i].x !== solution[i].x || path[i].y !== solution[i].y) {
            return i;
        }
    }
    
    if (path.length > solution.length) return solution.length;
    
    return -1;
  }

  private updateGameStateAndCheckLives(newPos: Position, path: Position[], onComplete: () => void) {
    this.isAnimating = true;
    this.gameState.moveCount++; // Total stats
    this.gameState.currentAttemptMoves++; // Life stats
    this.gameState.playerPos = newPos;
    this.gameState.moveHistory.push({ ...newPos });

    // Check if reached goal
    const atGoal = newPos.x === this.puzzle.goal.x && newPos.y === this.puzzle.goal.y;

    if (atGoal) {
       // Win!
       emitGameEvent('stateUpdate', { ...this.gameState });
       this.animatePath(path, () => {
         this.isAnimating = false;
         this.handleWin();
       });
       return;
    }

    // Check if life lost
    if (this.gameState.currentAttemptMoves >= this.puzzle.optimalMoves) {
      // Life lost!
      // Animate the move first, then trigger life lost logic
      this.animatePath(path, () => {
        this.isAnimating = false;
        this.handleLifeLost(newPos);
      });
    } else {
      // Normal continue
      emitGameEvent('stateUpdate', { ...this.gameState });
      this.animatePath(path, () => {
        this.isAnimating = false;
        onComplete();
      });
    }
  }
  
  private handleStandardMove(dir: Direction) {
    const currentPos = { ...this.gameState.playerPos };
    
    // Use shared movement simulation
    const result = simulateMove(
      this.puzzle.tiles,
      currentPos,
      dir,
      this.puzzle.width,
      this.puzzle.height,
      this.movementConfig
    );

    // If move is invalid, play bump animation
    if (!result.valid) {
      this.playBumpAnimation(dir);
      return;
    }

    const newPos = result.pos;
    const path = result.path ?? [newPos];

    this.recordHintProgress(currentPos, newPos);
    this.updateGameStateAndCheckLives(newPos, path, () => {});
  }
  
  private handleGroundMove(dir: Direction) {
    const currentPos = { ...this.gameState.playerPos };
    
    // Create ground state with current boulder positions
    const groundState: GroundPuzzleState = {
      tiles: this.puzzle.tiles,
      boulderPositions: this.boulderPositions,
      width: this.puzzle.width,
      height: this.puzzle.height,
    };
    
    // Simulate ground move with boulder mechanics
    const result = simulateGroundMove(groundState, currentPos, dir);
    
    // If move is invalid, play bump animation
    if (!result.valid) {
      this.playBumpAnimation(dir);
      return;
    }

    const newPos = result.playerPos;
    const path = result.path ?? [newPos];

    this.recordHintProgress(currentPos, newPos);

    // Handle boulder push animation
    if (result.boulderPushed && result.boulderFrom && result.boulderTo && result.newBoulderPositions) {
      const oldKey = positionKey(result.boulderFrom);
      const newKey = positionKey(result.boulderTo);
      
      // Update boulder positions
      this.boulderPositions = result.newBoulderPositions;
      
      // Animate boulder and player together
      const boulderSprite = this.boulderSprites.get(oldKey);
      if (boulderSprite) {
        // Update sprite map
        this.boulderSprites.delete(oldKey);
        this.boulderSprites.set(newKey, boulderSprite);
        
        // Calculate boulder target position
        const boulderPath = result.boulderPath ?? [result.boulderTo];
        const finalBoulderPos = boulderPath[boulderPath.length - 1];
        const boulderPx = this.offsetX + finalBoulderPos.x * TILE_SIZE + TILE_SIZE / 2;
        const boulderPy = this.offsetY + finalBoulderPos.y * TILE_SIZE + TILE_SIZE / 2;
        
        // Animate boulder
        const boulderDuration = boulderPath.length > 1 
          ? 180 + (boulderPath.length - 1) * 90  // Ice slide
          : 110;  // Single push
        
        this.tweens.add({
          targets: boulderSprite,
          x: boulderPx,
          y: boulderPy,
          duration: boulderDuration,
          ease: boulderPath.length > 1 ? 'Sine.easeOut' : 'Quad.easeOut',
        });
      }
    }

    this.updateGameStateAndCheckLives(newPos, path, () => {});
  }

  private animatePath(path: Position[], onComplete: () => void) {
    // "Jelly" Physics Animation
    const finalPos = path[path.length - 1];
    const px = this.offsetX + finalPos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + finalPos.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
    
    const isSliding = path.length > 1;
    
    // Calculate movement vector
    const dx = px - this.player.x;
    const dy = py - this.player.y;
    
    // Timing
    const duration = isSliding 
      ? 150 + (path.length - 1) * 60 
      : 120; 
      
    // 1. Stretch during move (Speed)
    // We maintain this stretch for the entire duration of the move
    let moveScaleX = 1;
    let moveScaleY = 1;
    
    // More subtle stretch (was 1.25/0.75)
    if (Math.abs(dx) > Math.abs(dy)) {
        // Moving Horizontal
        moveScaleX = 1.15;
        moveScaleY = 0.85;
    } else {
        // Moving Vertical
        moveScaleX = 0.85;
        moveScaleY = 1.15;
    }

    // Apply stretch
    this.tweens.add({
        targets: this.player,
        scaleX: moveScaleX,
        scaleY: moveScaleY,
        duration: 100,
        ease: 'Quad.easeOut'
    });
      
    // 2. Position Tween
    this.tweens.add({
      targets: this.player,
      x: px,
      y: py,
      duration,
      ease: isSliding ? 'Quad.out' : 'Back.out',
      onComplete: () => {
          // 3. Impact & Snap Back
          // When we stop, we swap the scales to "Squash" against the wall
          // (Conservation of momentum: Length turns into Width)
          
          // Swap scales for instant impact deformation
          this.player.setScale(moveScaleY, moveScaleX); 
          
          // 4. Elastic Snap Recovery
          this.tweens.add({
              targets: this.player,
              scaleX: 1,
              scaleY: 1,
              duration: 500,
              ease: 'Elastic.out',
              easeParams: [1.2, 0.6] // Tighter elastic snap
          });
          
          onComplete();
      },
    });
  }

  private playBumpAnimation(dir: Direction) {
    // Jelly Splash Effect
    // Squash against the wall we hit
    
    let scaleX = 1;
    let scaleY = 1;
    
    // Impact deformation
    // Hitting a vertical wall (UP/DOWN) -> Squash Y, Stretch X
    if (dir === Direction.UP || dir === Direction.DOWN) {
        scaleY = 0.6;
        scaleX = 1.4;
    } 
    // Hitting a horizontal wall (LEFT/RIGHT) -> Squash X, Stretch Y
    else {
        scaleX = 0.6;
        scaleY = 1.4;
    }

    // Tween 1: Impact (Squash)
    this.tweens.add({
      targets: this.player,
      scaleX: scaleX,
      scaleY: scaleY,
      duration: 100,
      yoyo: true, // Go back to normal
      ease: 'Quad.easeOut',
      onComplete: () => {
         // Tween 2: Wiggle/Settle (Elastic recovery)
         this.tweens.add({
             targets: this.player,
             scaleX: 1,
             scaleY: 1,
             duration: 300,
             ease: 'Bounce.easeOut'
         });
      }
    });
  }

  private handleWin() {
    this.gameState.isComplete = true;
    this.gameState.endTime = Date.now();
    
    // Hide player
    this.player.setVisible(false);

    // Show analysis
    this.drawEndGameAnalysis();

    // Goal burst effect
    const particles = this.add.particles(this.goalSprite.x, this.goalSprite.y, undefined, {
      speed: { min: 50, max: 150 },
      scale: { start: 0.4, end: 0 },
      lifespan: 800,
      quantity: 20,
      emitting: false,
    });

    // Create particle texture
    const particleGraphics = this.add.graphics();
    particleGraphics.fillStyle(COLORS.GOAL_GLOW);
    particleGraphics.fillCircle(4, 4, 4);
    particleGraphics.generateTexture('particle', 8, 8);
    particleGraphics.destroy();

    // Emit state update so UI knows game is complete
    emitGameEvent('stateUpdate', { ...this.gameState });

    // Emit win event
    emitGameEvent('gameComplete', {
      moveCount: this.gameState.moveCount,
      timeMs: ((this.gameState.endTime ?? this.gameState.startTime) - this.gameState.startTime) + this.gameState.penaltyTimeMs,
      optimalMoves: this.puzzle.optimalMoves,
      failed: false,
      attempts: this.gameState.attempts,
      solutionPath: this.puzzle.solutionPath,
    });
  }

  // Public method to show analysis (for revisit)
  public showAnalysis(attempts: GameState['attempts']) {
    this.gameState.attempts = attempts || [];
    this.gameState.isComplete = true;
    this.player.setVisible(false);
    this.drawEndGameAnalysis();
  }

  // Public method to trigger a move from external (React) calls
  public movePlayer(dir: Direction) {
    this.handleMove(dir);
  }

  public startGame() {
    if (!this.isPlaying && !this.gameState.isComplete) {
      this.isPlaying = true;
      this.gameState.startTime = Date.now();
      emitGameEvent('stateUpdate', { ...this.gameState });
    }
  }

  // Public method to restart the puzzle
  public restart() {
    this.clearAnalysis();
    this.isPlaying = false;
    this.gameState = {
      playerPos: { ...this.puzzle.start },
      moveCount: 0,
      currentAttemptMoves: 0,
      currentAttemptCorrectMoves: 0,
      lives: 3,
      penaltyTimeMs: 0,
      attempts: [],
      startTime: 0,
      endTime: null,
      isComplete: false,
      isSliding: false,
      moveHistory: [{ ...this.puzzle.start }],
    };

    this.unlockedHintTiles = new Set();
    this.unlockedHintEdges = new Set();
    this.unlockedThisLifeTiles = new Set();
    this.unlockedThisLifeEdges = new Set();
    if (HINTS_ENABLED) {
      this.redrawHintOverlays();
    }

    // Reset player position and visibility
    const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
    
    this.player.setVisible(true);
    this.tweens.add({
      targets: this.player,
      x: px,
      y: py,
      duration: 300,
      ease: 'Quad.easeOut',
    });

    emitGameEvent('stateUpdate', { ...this.gameState });
  }

  private indexSolutionPath() {
    const path = this.puzzle.solutionPath;
    if (!path || path.length < 2) {
      this.solutionIndexByKey = null;
      this.solutionNextByKey = null;
      this.solutionPosByKey = null;
      this.solutionEdges = null;
      return;
    }

    const indexByKey = new Map<string, number>();
    const nextByKey = new Map<string, string>();
    const posByKey = new Map<string, Position>();
    const edges = new Set<string>();

    for (let i = 0; i < path.length; i++) {
      const key = positionKey(path[i]);
      indexByKey.set(key, i);
      posByKey.set(key, { ...path[i] });
      if (i + 1 < path.length) {
        const nextKey = positionKey(path[i + 1]);
        nextByKey.set(key, nextKey);
        edges.add(`${key}->${nextKey}`);
      }
    }

    this.solutionIndexByKey = indexByKey;
    this.solutionNextByKey = nextByKey;
    this.solutionPosByKey = posByKey;
    this.solutionEdges = edges;
  }

  private recordHintProgress(fromPos: Position, toPos: Position) {
    if (!this.solutionIndexByKey || !this.solutionNextByKey || !this.solutionEdges) return;
    if (this.gameState.isComplete) return;

    const startKey = positionKey(this.puzzle.start);
    const goalKey = positionKey(this.puzzle.goal);

    const fromKey = positionKey(fromPos);
    const toKey = positionKey(toPos);
    const edgeKey = `${fromKey}->${toKey}`;

    // 1) Check if this move is ANY correct move in the solution (for scoring)
    if (this.solutionEdges.has(edgeKey)) {
      this.gameState.currentAttemptCorrectMoves++;
    }

    // Visual hint unlocking (only if hints enabled)
    if (HINTS_ENABLED) {
      // 2) Stopping on an optimal-path tile (landing positions only; not intermediate slide tiles)
      const toIndex = this.solutionIndexByKey.get(toKey);
      if (toIndex !== undefined && toKey !== startKey && toKey !== goalKey) {
        this.unlockedThisLifeTiles.add(toKey);
      }

      // 3) Making a move along the optimal path (consecutive step) - for hint unlocking
      const expectedNextKey = this.solutionNextByKey.get(fromKey);
      if (expectedNextKey === toKey && toKey !== goalKey) {
        this.unlockedThisLifeEdges.add(edgeKey);
        if (fromKey !== startKey && fromKey !== goalKey) this.unlockedThisLifeTiles.add(fromKey);
        if (toKey !== startKey && toKey !== goalKey) this.unlockedThisLifeTiles.add(toKey);
      }
    }
  }

  private mergeHintsForNextLife() {
    for (const key of this.unlockedThisLifeTiles) this.unlockedHintTiles.add(key);
    for (const key of this.unlockedThisLifeEdges) this.unlockedHintEdges.add(key);
    this.unlockedThisLifeTiles = new Set();
    this.unlockedThisLifeEdges = new Set();
  }

  private createHintOverlays() {
    // Initial call - no hints exist yet, skip redraw
    // Hints only appear after losing a life, which calls redrawHintOverlays()
  }

  private redrawHintOverlays() {
    // Clean up previous hint tile containers and tweens
    this.hintTileTweens.forEach(t => t.stop());
    this.hintTileTweens = [];
    this.hintTileContainers.forEach(c => c.destroy());
    this.hintTileContainers = [];

    // Skip redraw if no hints to show (avoids unnecessary tile redraw)
    if (this.unlockedHintTiles.size === 0 && this.unlockedHintEdges.size === 0) {
      return;
    }

    // Build set of intermediate path tiles
    const intermediateTiles = new Set<string>();
    
    if (this.solutionPosByKey) {
      for (const edgeKey of this.unlockedHintEdges) {
        const [fromKey, toKey] = edgeKey.split('->');
        const from = this.solutionPosByKey.get(fromKey);
        const to = this.solutionPosByKey.get(toKey);
        if (!from || !to) continue;

        // Walk from 'from' to 'to' and mark all intermediate tiles
        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);
        let cx = from.x + dx;
        let cy = from.y + dy;
        
        while (cx !== to.x || cy !== to.y) {
          intermediateTiles.add(positionKey({ x: cx, y: cy }));
          cx += dx;
          cy += dy;
        }
      }
    }

    // Redraw the entire tilemap - draw non-hinted tiles normally
    this.tileGraphics.clear();
    
    // Collect hinted tiles to draw separately
    const hintedTileData: { x: number; y: number; tile: TileType; hintLevel: number }[] = [];
    
    for (let y = 0; y < this.puzzle.height; y++) {
      for (let x = 0; x < this.puzzle.width; x++) {
        const tile = this.puzzle.tiles[y][x];
        const px = this.offsetX + x * TILE_SIZE;
        const py = this.offsetY + y * TILE_SIZE;
        
        const key = positionKey({ x, y });
        
        // Determine hint level: 2 = stop tile, 1 = intermediate path, 0 = none
        let hintLevel = 0;
        if (this.unlockedHintTiles.has(key)) {
          hintLevel = 2;
        } else if (intermediateTiles.has(key)) {
          hintLevel = 1;
        }
        
        if (hintLevel > 0) {
          // Draw base tile without hint, collect for animated overlay
          this.drawTile(px, py, tile, x, y, 0);
          hintedTileData.push({ x, y, tile, hintLevel });
        } else {
          this.drawTile(px, py, tile, x, y, 0);
        }
      }
    }

    // Create animated containers for hinted tiles
    for (const data of hintedTileData) {
      const px = this.offsetX + data.x * TILE_SIZE;
      const py = this.offsetY + data.y * TILE_SIZE;
      
      // Create a container at tile position
      const container = this.add.container(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      container.setDepth(1); // Above base tiles, below player/goal
      
      // Draw the hinted tile into a graphics object centered in container
      const g = this.add.graphics();
      this.drawHintedTileGraphics(g, data.tile, data.hintLevel);
      container.add(g);
      
      this.hintTileContainers.push(container);
      
      // Add subtle wiggle animation
      const wiggleAmount = data.hintLevel === 2 ? .6 : .5;
      const duration = data.hintLevel === 2 ? 135 : 110;
      const delay = Math.random() * 50; // Stagger animations
      
      const tween = this.tweens.add({
        targets: container,
        x: { from: container.x - wiggleAmount, to: container.x + wiggleAmount },
        duration,
        delay,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      
      this.hintTileTweens.push(tween);
    }
  }

  // Draw a hinted tile into a graphics object (centered at 0,0)
  private drawHintedTileGraphics(g: Phaser.GameObjects.Graphics, tile: TileType, hintLevel: number) {
    const size = TILE_SIZE;
    const s = size / 32;
    const padding = 2 * s;
    const radius = 8 * s;
    const depth = 4 * s;

    const x = -size / 2 + padding;
    const y = -size / 2 + padding;
    const w = size - padding * 2;
    const h = size - padding * 2;

    // Glow
    const glowColor = COLORS.HINT_GLOW;
    const layers = 2;
    const maxExpand = 4 * s;
    const baseAlpha = hintLevel === 2 ? 0.08 : 0.05;
    const maxAlpha = hintLevel === 2 ? 0.2 : 0.12;
    
    for (let i = layers; i >= 1; i--) {
      const expand = (i / layers) * maxExpand;
      const alpha = baseAlpha + (1 - i / layers) * (maxAlpha - baseAlpha);
      
      g.fillStyle(glowColor, alpha);
      g.fillRoundedRect(
        x - expand, 
        y - expand, 
        w + expand * 2, 
        h + expand * 2, 
        radius + expand
      );
    }

    // Tile colors
    const faceColor = hintLevel === 2 ? COLORS.HINT_TILE_FACE : COLORS.HINT_PATH_FACE;
    const edgeColor = hintLevel === 2 ? COLORS.HINT_TILE_EDGE : COLORS.HINT_PATH_EDGE;

    // Edge
    g.fillStyle(edgeColor);
    g.fillRoundedRect(x, y, w, h, radius);

    // Face
    g.fillStyle(faceColor);
    g.fillRoundedRect(x, y, w, h - depth, radius);

    // Ice reflection lines
    if (tile === TileType.ICE) {
      const inset = 4 * s;
      const faceX = x + inset;
      const faceY = y + inset;
      const faceW = w - inset * 2;
      const faceH = h - depth - inset * 2;

      g.lineStyle(1 * s, 0xffffff, 0.65);

      // Primary reflection
      g.beginPath();
      g.moveTo(faceX + faceW * 0.2, faceY + faceH * 0.8);
      g.lineTo(faceX + faceW * 0.8, faceY + faceH * 0.2);
      g.strokePath();

      // Secondary small reflection
      g.beginPath();
      g.moveTo(faceX + faceW * 0.6, faceY + faceH * 0.9);
      g.lineTo(faceX + faceW * 0.9, faceY + faceH * 0.6);
      g.strokePath();
    }

    // Ledge arrows
    if (tile === TileType.LEDGE_UP || tile === TileType.LEDGE_DOWN || 
        tile === TileType.LEDGE_LEFT || tile === TileType.LEDGE_RIGHT) {
      const cx = 0;
      const cy = -depth / 2;
      const baseWidth = size * 0.32;
      const baseHeight = size * 0.20;
      const shrink = 1 * s;
      const lift = depth * 0.6;
      const halfW = baseWidth / 2;
      const halfH = Math.max(baseHeight / 2 - shrink, 1);

      g.fillStyle(COLORS.LEDGE_ARROW);

      const upA = { x: 0, y: -halfH - lift };
      const upB = { x: -halfW, y: halfH };
      const upC = { x: halfW, y: halfH };

      const rotate = (p: { x: number; y: number }, dir: 'up' | 'down' | 'left' | 'right') => {
        switch (dir) {
          case 'up': return { x: p.x, y: p.y };
          case 'down': return { x: p.x, y: -p.y };
          case 'right': return { x: -p.y, y: p.x };
          case 'left': return { x: p.y, y: -p.x };
        }
      };

      const dir =
        tile === TileType.LEDGE_UP ? 'down' :
        tile === TileType.LEDGE_DOWN ? 'up' :
        tile === TileType.LEDGE_RIGHT ? 'right' : 'left';

      const A = rotate(upA, dir);
      const B = rotate(upB, dir);
      const C = rotate(upC, dir);

      g.fillTriangle(cx + A.x, cy + A.y, cx + B.x, cy + B.y, cx + C.x, cy + C.y);
    }
  }

  private clearAnalysis() {
    this.analysisObjects.forEach(obj => obj.destroy());
    this.analysisObjects = [];
  }
}