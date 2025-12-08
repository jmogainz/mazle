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
  private goalSprite!: Phaser.GameObjects.Container;
  private isAnimating = false;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key } | null = null;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private offsetX = 0;
  private offsetY = 0;

  private isPlaying = false;
  
  // Boulder state tracking (for ground maps)
  private boulderPositions: Set<string> = new Set();
  private boulderSprites: Map<string, Phaser.GameObjects.Container> = new Map();

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
      lives: 3,
      penaltyTimeMs: 0,
      attempts: [],
      startTime: 0,
      endTime: null,
      isComplete: false,
      isSliding: false,
      moveHistory: [{ ...this.puzzle.start }],
    };
    
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
    
    // Create boulder sprites (for ground maps)
    this.createBoulderSprites();
    
    // Create goal with animation
    this.createGoal();
    
    // Create player
    this.createPlayer();
    
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
    const boulderSize = size * 0.75;
    const halfSize = boulderSize / 2;
    
    // Main boulder body
    g.fillStyle(COLORS.BOULDER);
    g.fillRoundedRect(-halfSize, -halfSize, boulderSize, boulderSize, 6);
    
    // Shadow
    g.fillStyle(COLORS.BOULDER_SHADOW);
    g.fillRoundedRect(-halfSize + 3, -halfSize + boulderSize - 6, boulderSize - 6, 4, 2);
    g.fillRoundedRect(-halfSize + boulderSize - 6, -halfSize + 3, 4, boulderSize - 6, 2);
    
    // Highlight
    g.fillStyle(COLORS.BOULDER_HIGHLIGHT);
    g.fillCircle(-halfSize + 8, -halfSize + 8, 3);
    g.fillRoundedRect(-halfSize + 4, -halfSize + 3, boulderSize * 0.4, 3, 1);
    
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

  private drawTile(px: number, py: number, tile: TileType, gridX: number, gridY: number) {
    const g = this.tileGraphics;
    const size = TILE_SIZE;
    const padding = 1.5; // Tighter fit
    const radius = 8;    // Softer, rounder corners ("squircle")

    // Draw base ground for transparency/layering
    const isAlt = (gridX + gridY) % 2 === 0;
    
    // Helper for standard tile drawing
    const drawStandardTile = (color: number) => {
        g.fillStyle(color);
        g.fillRoundedRect(px + padding, py + padding, size - padding * 2, size - padding * 2, radius);
    };

    switch (tile) {
      case TileType.GROUND:
        drawStandardTile(isAlt ? COLORS.GROUND : COLORS.GROUND_ALT);
        break;

      case TileType.START:
        drawStandardTile(COLORS.START);
        break;

      case TileType.GOAL:
        drawStandardTile(COLORS.GOAL);
        break;

      case TileType.WALL:
        // Walls are just black rounded blocks
        drawStandardTile(COLORS.WALL);
        break;

      case TileType.ICE:
        drawStandardTile(COLORS.ICE);
        break;

      case TileType.LEDGE_UP:
      case TileType.LEDGE_DOWN:
      case TileType.LEDGE_LEFT:
      case TileType.LEDGE_RIGHT:
        drawStandardTile(COLORS.LEDGE);
        
        // Direction arrow - Simple black triangle
        g.fillStyle(COLORS.LEDGE_ARROW);
        const cx = px + size / 2;
        const cy = py + size / 2;
        const arrowSize = 6;
        
        if (tile === TileType.LEDGE_UP) {
          g.fillTriangle(cx, cy + arrowSize, cx - arrowSize, cy - arrowSize/2, cx + arrowSize, cy - arrowSize/2);
        } else if (tile === TileType.LEDGE_DOWN) {
          g.fillTriangle(cx, cy - arrowSize, cx - arrowSize, cy + arrowSize/2, cx + arrowSize, cy + arrowSize/2);
        } else if (tile === TileType.LEDGE_RIGHT) {
          g.fillTriangle(cx + arrowSize, cy, cx - arrowSize/2, cy - arrowSize, cx - arrowSize/2, cy + arrowSize);
        } else {
          g.fillTriangle(cx - arrowSize, cy, cx + arrowSize/2, cy - arrowSize, cx + arrowSize/2, cy + arrowSize);
        }
        break;

      case TileType.BOULDER:
        // Draw ground underneath
        drawStandardTile(isAlt ? COLORS.GROUND : COLORS.GROUND_ALT);
        break;
    }
  }

  private createGoal() {
    const px = this.offsetX + this.puzzle.goal.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.goal.y * TILE_SIZE + TILE_SIZE / 2;
    
    this.goalSprite = this.add.container(px, py);
    
    // Simple pulse ring (flat)
    const glow = this.add.graphics();
    glow.lineStyle(2, COLORS.GOAL_GLOW);
    glow.strokeCircle(0, 0, 10);
    this.goalSprite.add(glow);
    
    // Main goal marker - White Star on Green Tile (handled by drawTile)
    // We just add a simple white star icon here
    const star = this.add.graphics();
    star.fillStyle(0xffffff);
    
    // Draw a simple 5-point star
    const points = 5;
    const outerRadius = 8;
    const innerRadius = 4;
    const rot = Math.PI / 2 * 3;
    const x = 0;
    const y = 0;
    const step = Math.PI / points;

    star.beginPath();
    star.moveTo(x, y - outerRadius);
    for (let i = 0; i < points; i++) {
        star.lineTo(x + Math.cos(rot + step * i * 2) * outerRadius, y + Math.sin(rot + step * i * 2) * outerRadius);
        star.lineTo(x + Math.cos(rot + step * (i * 2 + 1)) * innerRadius, y + Math.sin(rot + step * (i * 2 + 1)) * innerRadius);
    }
    star.lineTo(x, y - outerRadius);
    star.closePath();
    star.fillPath();
    
    this.goalSprite.add(star);
    
    // Subtle breathing animation
    this.tweens.add({
      targets: this.goalSprite,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createPlayer() {
    const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2;
    
    this.player = this.add.container(px, py);
    
    // Player body - Rounded Square (Jelly Tile)
    const body = this.add.graphics();
    const size = TILE_SIZE * 0.65; // A tad bit smaller (was 0.75)
    const radius = 6;
    
    // Centered rounded rect
    body.fillStyle(COLORS.PLAYER);
    body.fillRoundedRect(-size/2, -size/2, size, size, radius);
    
    // Black Outline
    body.lineStyle(2, COLORS.PLAYER_OUTLINE);
    body.strokeRoundedRect(-size/2, -size/2, size, size, radius);
    
    this.player.add(body);
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
    this.gameState.penaltyTimeMs += 20000; // 20s penalty
    
    // Calculate deviation index
    const deviationIndex = this.findDeviationIndex(this.gameState.moveHistory, this.puzzle.solutionPath || []);

    // Record attempt
    this.gameState.attempts.push({
      moveCount: this.gameState.currentAttemptMoves,
      path: [...this.gameState.moveHistory], // Snapshot of history for this attempt
      failedAt: finalPos,
      deviationIndex,
    });

    // Reset for next life
    this.gameState.currentAttemptMoves = 0;
    this.gameState.moveHistory = [{ ...this.puzzle.start }];
    this.gameState.playerPos = { ...this.puzzle.start };

    // Emit event for UI (penalty visual)
    emitGameEvent('stateUpdate', { ...this.gameState });
    emitGameEvent('lifeLost', { 
        lives: this.gameState.lives, 
        penaltyMs: 20000 
    });

    if (this.gameState.lives <= 0) {
      this.handleGameOver();
    } else {
      // Block input during respawn sequence
      this.isAnimating = true;
      
      // Flash red and shake the player
      this.tweens.add({
        targets: this.player,
        scaleX: { from: 1.3, to: 1 },
        scaleY: { from: 1.3, to: 1 },
        duration: 200,
        ease: 'Quad.easeOut',
      });
      
      // Brief pause, then fade out and teleport
      this.time.delayedCall(400, () => {
        // Fade out at current position
        this.tweens.add({
          targets: this.player,
          alpha: 0,
          duration: 200,
          ease: 'Quad.easeIn',
          onComplete: () => {
            // Teleport to start
            const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
            const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2;
            this.player.setPosition(px, py);
            
            // Fade back in
            this.tweens.add({
              targets: this.player,
              alpha: 1,
              duration: 300,
              ease: 'Quad.easeOut',
              onComplete: () => {
                this.isAnimating = false; // Allow input again
              }
            });
          }
        });
      });
    }
  }

  private handleGameOver() {
    this.gameState.isComplete = true;
    this.gameState.endTime = Date.now(); // Timer continues until end
    
    // Hide player
    this.player.setVisible(false);

    // Show analysis
    this.drawEndGameAnalysis();
    
    // Emit state update so UI knows game is complete
    emitGameEvent('stateUpdate', { ...this.gameState });
    
    emitGameEvent('gameComplete', {
      moveCount: this.gameState.moveCount,
      timeMs: (this.gameState.endTime - this.gameState.startTime) + this.gameState.penaltyTimeMs,
      optimalMoves: this.puzzle.optimalMoves,
      failed: true,
      attempts: this.gameState.attempts,
      solutionPath: this.puzzle.solutionPath,
    });
  }

  private drawEndGameAnalysis() {
    if (!this.puzzle.solutionPath) return;
    
    const g = this.add.graphics();
    
    // Draw path as connected line with gradient and numbered waypoints
    const path = this.puzzle.solutionPath;
    if (path.length > 1) {
        // Draw thick green gradient line
        g.lineStyle(6, 0x06d6a0, 0.7);
        g.beginPath();
        
        const startPx = this.offsetX + path[0].x * TILE_SIZE + TILE_SIZE / 2;
        const startPy = this.offsetY + path[0].y * TILE_SIZE + TILE_SIZE / 2;
        g.moveTo(startPx, startPy);
        
        for (let i = 1; i < path.length; i++) {
            const px = this.offsetX + path[i].x * TILE_SIZE + TILE_SIZE / 2;
            const py = this.offsetY + path[i].y * TILE_SIZE + TILE_SIZE / 2;
            g.lineTo(px, py);
        }
        g.strokePath();
        
        // Draw numbered circles at each waypoint
        for (let i = 0; i < path.length; i++) {
            const px = this.offsetX + path[i].x * TILE_SIZE + TILE_SIZE / 2;
            const py = this.offsetY + path[i].y * TILE_SIZE + TILE_SIZE / 2;
            
            // Green circle background
            g.fillStyle(0x06d6a0, 0.9);
            g.fillCircle(px, py, 12);
            
            // Move number (0-based)
            this.add.text(
                px, 
                py, 
                i.toString(), 
                { 
                    fontSize: '14px',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 3,
                }
            ).setOrigin(0.5);
        }
    }
    
    // Highlight deviation points in red with life numbers
    const deviationMap = new Map<string, { lifeNumber: number }>();
    
    this.gameState.attempts.forEach((attempt, attemptIndex) => {
        let pos = attempt.failedAt;
        
        // If we have a deviation index, use that position
        if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1 && attempt.path[attempt.deviationIndex]) {
             pos = attempt.path[attempt.deviationIndex];
        }

        if (pos) {
            const key = `${pos.x},${pos.y}`;
            // Always update with latest attempt number
            deviationMap.set(key, { lifeNumber: attemptIndex + 1 });
        }
    });
    
    // Draw red cells with numbers
    deviationMap.forEach(({ lifeNumber }, key) => {
        const [x, y] = key.split(',').map(Number);
        const px = this.offsetX + x * TILE_SIZE + TILE_SIZE / 2;
        const py = this.offsetY + y * TILE_SIZE + TILE_SIZE / 2;
        
        // Red circle background
        g.fillStyle(0xef476f, 0.9);
        g.fillCircle(px, py, 14);
        
        // Life number
        this.add.text(
            px, 
            py, 
            lifeNumber.toString(), 
            { 
                fontSize: '18px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4,
            }
        ).setOrigin(0.5);
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
    const py = this.offsetY + finalPos.y * TILE_SIZE + TILE_SIZE / 2;
    
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
      timeMs: (this.gameState.endTime - this.gameState.startTime) + this.gameState.penaltyTimeMs,
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
    this.isPlaying = false;
    this.gameState = {
      playerPos: { ...this.puzzle.start },
      moveCount: 0,
      currentAttemptMoves: 0,
      lives: 3,
      penaltyTimeMs: 0,
      attempts: [],
      startTime: 0,
      endTime: null,
      isComplete: false,
      isSliding: false,
      moveHistory: [{ ...this.puzzle.start }],
    };

    // Reset player position
    const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2;
    
    this.tweens.add({
      targets: this.player,
      x: px,
      y: py,
      duration: 300,
      ease: 'Quad.easeOut',
    });

    emitGameEvent('stateUpdate', { ...this.gameState });
  }
}
