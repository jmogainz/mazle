import * as Phaser from 'phaser';
import {
  TileType,
  Direction,
  Position,
  PuzzleData,
  GameState,
  COLORS,
  TILE_SIZE,
} from './types';
import { emitGameEvent } from './events';

export class GameScene extends Phaser.Scene {
  private puzzle!: PuzzleData;
  private gameState!: GameState;
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

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { puzzle: PuzzleData }) {
    this.puzzle = data.puzzle;
    this.isPlaying = false;
    this.gameState = {
      playerPos: { ...this.puzzle.start },
      moveCount: 0,
      startTime: 0,
      endTime: null,
      isComplete: false,
      isSliding: false,
      moveHistory: [{ ...this.puzzle.start }],
    };
  }

  create() {
    // Calculate offset to center the puzzle
    const gameWidth = this.scale.width;
    const gameHeight = this.scale.height;
    this.offsetX = (gameWidth - this.puzzle.width * TILE_SIZE) / 2;
    this.offsetY = (gameHeight - this.puzzle.height * TILE_SIZE) / 2;

    // Draw tiles
    this.drawTiles();
    
    // Create goal with animation
    this.createGoal();
    
    // Create player
    this.createPlayer();
    
    // Setup input
    this.setupInput();
    
    // Emit initial state
    emitGameEvent('stateUpdate', { ...this.gameState });
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
      case TileType.FLOOR:
      case TileType.START:
        // Checkerboard pattern for depth
        const isAlt = (gridX + gridY) % 2 === 0;
        g.fillStyle(isAlt ? COLORS.FLOOR : COLORS.FLOOR_ALT);
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
        g.fillStyle(COLORS.FLOOR);
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

  private getDirectionDelta(dir: Direction): Position {
    switch (dir) {
      case Direction.UP: return { x: 0, y: -1 };
      case Direction.DOWN: return { x: 0, y: 1 };
      case Direction.LEFT: return { x: -1, y: 0 };
      case Direction.RIGHT: return { x: 1, y: 0 };
    }
  }

  private canEnterTile(fromPos: Position, toPos: Position, dir: Direction): boolean {
    // Check bounds
    if (toPos.x < 0 || toPos.x >= this.puzzle.width || 
        toPos.y < 0 || toPos.y >= this.puzzle.height) {
      return false;
    }

    const tile = this.puzzle.tiles[toPos.y][toPos.x];
    
    // Walls always block
    if (tile === TileType.WALL) return false;
    
    // Ledge entry rules
    // LEDGE_UP: enter from above (moving DOWN), LEDGE_DOWN: enter from below (moving UP)
    // LEDGE_LEFT: enter from right (moving LEFT), LEDGE_RIGHT: enter from left (moving RIGHT)
    if (tile >= TileType.LEDGE_UP && tile <= TileType.LEDGE_RIGHT) {
      const ledgeIndex = tile - TileType.LEDGE_UP;
      const allowedDirs = [Direction.DOWN, Direction.UP, Direction.LEFT, Direction.RIGHT];
      if (dir !== allowedDirs[ledgeIndex]) return false;
    }
    
    return true;
  }

  private handleMove(dir: Direction) {
    if (this.isAnimating || this.gameState.isComplete || !this.isPlaying) return;

    const delta = this.getDirectionDelta(dir);
    const currentPos = { ...this.gameState.playerPos };
    let newPos = { x: currentPos.x + delta.x, y: currentPos.y + delta.y };

    // Check if initial move is valid
    if (!this.canEnterTile(currentPos, newPos, dir)) {
      this.playBumpAnimation(dir);
      return;
    }

    // Calculate final position (handling ice sliding)
    const path: Position[] = [newPos];
    let currentTile = this.puzzle.tiles[newPos.y][newPos.x];
    
    // Handle ice sliding
    while (currentTile === TileType.ICE) {
      const nextPos = { x: newPos.x + delta.x, y: newPos.y + delta.y };
      
      if (!this.canEnterTile(newPos, nextPos, dir)) {
        break;
      }
      
      newPos = nextPos;
      path.push(newPos);
      currentTile = this.puzzle.tiles[newPos.y][newPos.x];
    }

    // Animate movement
    this.isAnimating = true;
    this.gameState.moveCount++;
    this.gameState.playerPos = newPos;
    this.gameState.moveHistory.push({ ...newPos });

    // Emit state update
    emitGameEvent('stateUpdate', { ...this.gameState });

    // Animate through path
    this.animatePath(path, () => {
      this.isAnimating = false;
      
      // Check win condition
      if (newPos.x === this.puzzle.goal.x && newPos.y === this.puzzle.goal.y) {
        this.handleWin();
      }
    });
  }

  private animatePath(path: Position[], onComplete: () => void) {
    // Build chain of tweens for the path
    const tweenConfigs: Phaser.Types.Tweens.TweenBuilderConfig[] = path.map((pos, index) => {
      const px = this.offsetX + pos.x * TILE_SIZE + TILE_SIZE / 2;
      const py = this.offsetY + pos.y * TILE_SIZE + TILE_SIZE / 2;
      const duration = index === 0 ? 120 : 60; // First step slower, sliding fast
      
      return {
        targets: this.player,
        x: px,
        y: py,
        duration,
        ease: path.length > 1 ? 'Linear' : 'Quad.easeOut',
      };
    });

    // Chain the tweens together
    this.tweens.chain({
      tweens: tweenConfigs,
      onComplete: onComplete,
    });
  }

  private playBumpAnimation(dir: Direction) {
    const delta = this.getDirectionDelta(dir);
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
    
    // Victory animation
    this.tweens.add({
      targets: this.player,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 200,
      yoyo: true,
      repeat: 2,
      ease: 'Bounce.easeOut',
    });

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

    // Emit win event
    emitGameEvent('gameComplete', {
      moveCount: this.gameState.moveCount,
      timeMs: this.gameState.endTime - this.gameState.startTime,
      optimalMoves: this.puzzle.optimalMoves,
    });
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

