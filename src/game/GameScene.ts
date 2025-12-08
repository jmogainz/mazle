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
    const padding = 1;

    switch (tile) {
      case TileType.GROUND:
      case TileType.START:
        // Checkerboard pattern for depth
        const isAlt = (gridX + gridY) % 2 === 0;
        g.fillStyle(isAlt ? COLORS.GROUND : COLORS.GROUND_ALT);
        g.fillRect(px + padding, py + padding, size - padding * 2, size - padding * 2);
        break;

      case TileType.WALL:
        // 3D wall effect
        g.fillStyle(COLORS.WALL);
        g.fillRect(px, py, size, size);
        g.fillStyle(COLORS.WALL_HIGHLIGHT);
        g.fillRect(px + 2, py + 2, size - 6, 3);
        g.fillRect(px + 2, py + 2, 3, size - 6);
        break;

      case TileType.GOAL:
        // Goal has floor underneath
        g.fillStyle(COLORS.GROUND);
        g.fillRect(px + padding, py + padding, size - padding * 2, size - padding * 2);
        break;

      case TileType.ICE:
        // Ice tile with shine effect
        g.fillStyle(COLORS.ICE);
        g.fillRect(px + padding, py + padding, size - padding * 2, size - padding * 2);
        // Shine lines
        g.fillStyle(COLORS.ICE_SHINE);
        g.fillRect(px + 4, py + 4, 8, 2);
        g.fillRect(px + 6, py + 8, 6, 2);
        g.fillRect(px + size - 12, py + size - 10, 6, 2);
        break;

      case TileType.LEDGE_UP:
      case TileType.LEDGE_DOWN:
      case TileType.LEDGE_LEFT:
      case TileType.LEDGE_RIGHT:
        // Ledge base
        g.fillStyle(COLORS.LEDGE);
        g.fillRect(px + padding, py + padding, size - padding * 2, size - padding * 2);
        
        // Direction arrow
        g.fillStyle(COLORS.LEDGE_ARROW);
        const cx = px + size / 2;
        const cy = py + size / 2;
        const arrowSize = 8;
        
        // Arrow points in the direction you TRAVEL when entering (away from you)
        // LEDGE_UP = enter from above, moving DOWN → arrow points DOWN
        // LEDGE_DOWN = enter from below, moving UP → arrow points UP
        // LEDGE_LEFT = enter from right, moving LEFT → arrow points LEFT
        // LEDGE_RIGHT = enter from left, moving RIGHT → arrow points RIGHT
        if (tile === TileType.LEDGE_UP) {
          // Arrow pointing DOWN (you enter moving down)
          g.fillTriangle(cx, cy + arrowSize, cx - arrowSize, cy - arrowSize/2, cx + arrowSize, cy - arrowSize/2);
        } else if (tile === TileType.LEDGE_DOWN) {
          // Arrow pointing UP (you enter moving up)
          g.fillTriangle(cx, cy - arrowSize, cx - arrowSize, cy + arrowSize/2, cx + arrowSize, cy + arrowSize/2);
        } else if (tile === TileType.LEDGE_RIGHT) {
          // Arrow pointing RIGHT (you enter moving right)
          g.fillTriangle(cx + arrowSize, cy, cx - arrowSize/2, cy - arrowSize, cx - arrowSize/2, cy + arrowSize);
        } else {
          // LEDGE_LEFT - Arrow pointing LEFT (you enter moving left)
          g.fillTriangle(cx - arrowSize, cy, cx + arrowSize/2, cy - arrowSize, cx + arrowSize/2, cy + arrowSize);
        }
        break;

      case TileType.BOULDER:
        // Draw ground underneath boulder (the boulder sprite is drawn separately)
        const isAltBoulder = (gridX + gridY) % 2 === 0;
        g.fillStyle(isAltBoulder ? COLORS.GROUND : COLORS.GROUND_ALT);
        g.fillRect(px + padding, py + padding, size - padding * 2, size - padding * 2);
        // Boulder is rendered as a sprite for animation purposes
        break;
    }
  }

  private createGoal() {
    const px = this.offsetX + this.puzzle.goal.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.goal.y * TILE_SIZE + TILE_SIZE / 2;
    
    this.goalSprite = this.add.container(px, py);
    
    // Outer glow
    const glow = this.add.graphics();
    glow.fillStyle(COLORS.GOAL_GLOW, 0.3);
    glow.fillCircle(0, 0, 14);
    this.goalSprite.add(glow);
    
    // Main star/goal marker - simplified circle design
    const star = this.add.graphics();
    star.fillStyle(COLORS.GOAL);
    star.fillCircle(0, 0, 10);
    star.fillStyle(COLORS.GOAL_GLOW);
    star.fillCircle(0, 0, 5);
    star.fillStyle(0xffffff);
    star.fillCircle(-3, -3, 2);
    this.goalSprite.add(star);
    
    // Pulsing animation
    this.tweens.add({
      targets: this.goalSprite,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private createPlayer() {
    const px = this.offsetX + this.puzzle.start.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + this.puzzle.start.y * TILE_SIZE + TILE_SIZE / 2;
    
    this.player = this.add.container(px, py);
    
    // Player body (pixel art style character)
    const body = this.add.graphics();
    
    // Shadow
    body.fillStyle(0x000000, 0.3);
    body.fillEllipse(0, 8, 16, 6);
    
    // Body
    body.fillStyle(COLORS.PLAYER);
    body.fillRoundedRect(-8, -10, 16, 18, 3);
    
    // Outline
    body.lineStyle(2, COLORS.PLAYER_OUTLINE);
    body.strokeRoundedRect(-8, -10, 16, 18, 3);
    
    // Eyes
    body.fillStyle(0xffffff);
    body.fillCircle(-3, -4, 3);
    body.fillCircle(3, -4, 3);
    body.fillStyle(0x000000);
    body.fillCircle(-2, -4, 1.5);
    body.fillCircle(4, -4, 1.5);
    
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
                    fontWeight: 'bold',
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
                fontWeight: 'bold',
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
    // For smooth ice sliding, animate directly to final position
    // instead of chaining many tiny tweens (which can look choppy)
    const finalPos = path[path.length - 1];
    const px = this.offsetX + finalPos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + finalPos.y * TILE_SIZE + TILE_SIZE / 2;
    
    const isSliding = path.length > 1;
    
    // Different timing for walking vs sliding:
    // - Regular step: 110ms, snappy and responsive
    // - Ice slide: 180ms + 90ms per tile, smooth leisurely glide
    const duration = isSliding 
      ? 180 + (path.length - 1) * 90 
      : 110;
    
    this.tweens.add({
      targets: this.player,
      x: px,
      y: py,
      duration,
      ease: isSliding ? 'Sine.easeOut' : 'Quad.easeOut',
      onComplete: onComplete,
    });
  }

  private playBumpAnimation(dir: Direction) {
    const delta = getDelta(dir);
    const bumpDist = 4;
    
    this.tweens.add({
      targets: this.player,
      x: this.player.x + delta.x * bumpDist,
      y: this.player.y + delta.y * bumpDist,
      duration: 50,
      yoyo: true,
      ease: 'Quad.easeOut',
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
