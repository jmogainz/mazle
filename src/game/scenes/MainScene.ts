import * as Phaser from 'phaser';
import { LevelGenerator } from '../utils/generator';
import { TILE_SIZE, TileType, COLORS, DIRECTIONS, GRID_WIDTH, GRID_HEIGHT } from '../utils/constants';
import Player from '../objects/Player';
import { EventBus } from '../EventBus';

export default class MainScene extends Phaser.Scene {
  private player!: Player;
  private grid: TileType[][] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private isInputLocked: boolean = false;
  private moves: number = 0;
  private startTime: number = 0;
  private timerEvent?: Phaser.Time.TimerEvent;
  private goalPoint!: { x: number; y: number };

  constructor() {
    super('MainScene');
  }

  create() {
    // Reset state
    this.moves = 0;
    this.isInputLocked = false;
    this.startTime = Date.now();

    // Notify UI
    EventBus.emit('game-start');
    EventBus.emit('stats-update', { moves: 0, time: 0 });

    // Generate Level
    // Use date string as seed for daily puzzle
    const date = new Date();
    const seed = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const generator = new LevelGenerator(seed);
    const { grid, start, goal } = generator.generate();
    this.grid = grid;
    this.goalPoint = goal;

    // Draw Map
    this.drawMap();

    // Spawn Player
    this.player = new Player(this, start.x * TILE_SIZE, start.y * TILE_SIZE, start.x, start.y);
    
    // Camera
    this.cameras.main.centerOn(
      (GRID_WIDTH * TILE_SIZE) / 2,
      (GRID_HEIGHT * TILE_SIZE) / 2
    );
    this.cameras.main.setZoom(1.5);

    // Input
    if(this.input.keyboard) {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
          W: Phaser.Input.Keyboard.KeyCodes.W,
          A: Phaser.Input.Keyboard.KeyCodes.A,
          S: Phaser.Input.Keyboard.KeyCodes.S,
          D: Phaser.Input.Keyboard.KeyCodes.D,
        }) as any;
    }

    // Swipe Input (Basic)
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const swipeThreshold = 30;
      if (pointer.getDuration() < 1000) {
        const dx = pointer.upX - pointer.downX;
        const dy = pointer.upY - pointer.downY;
        
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > swipeThreshold) {
          if (dx > 0) this.handleMove(DIRECTIONS.RIGHT);
          else this.handleMove(DIRECTIONS.LEFT);
        } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > swipeThreshold) {
          if (dy > 0) this.handleMove(DIRECTIONS.DOWN);
          else this.handleMove(DIRECTIONS.UP);
        }
      }
    });

    // Timer loop
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        EventBus.emit('stats-update', { moves: this.moves, time: elapsed });
      },
      loop: true
    });
  }

  update() {
    if (this.isInputLocked || this.player.isMoving) return;

    if (this.cursors.left.isDown || this.wasd.A.isDown) {
      this.handleMove(DIRECTIONS.LEFT);
    } else if (this.cursors.right.isDown || this.wasd.D.isDown) {
      this.handleMove(DIRECTIONS.RIGHT);
    } else if (this.cursors.up.isDown || this.wasd.W.isDown) {
      this.handleMove(DIRECTIONS.UP);
    } else if (this.cursors.down.isDown || this.wasd.S.isDown) {
      this.handleMove(DIRECTIONS.DOWN);
    }
  }

  private drawMap() {
    const graphics = this.add.graphics();
    
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = this.grid[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        let color = COLORS.FLOOR;
        if (tile === TileType.WALL) color = COLORS.WALL;
        else if (tile === TileType.ICE) color = COLORS.ICE;
        else if (tile === TileType.START) color = COLORS.START;
        else if (tile === TileType.GOAL) color = COLORS.GOAL;
        else if (
            tile === TileType.LEDGE_DOWN ||
            tile === TileType.LEDGE_UP ||
            tile === TileType.LEDGE_LEFT ||
            tile === TileType.LEDGE_RIGHT
        ) color = COLORS.LEDGE;

        graphics.fillStyle(color, 1);
        graphics.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Draw Directional Arrows for Ledges
        if (color === COLORS.LEDGE) {
            graphics.fillStyle(0x000000, 0.5);
            const cx = px + TILE_SIZE / 2;
            const cy = py + TILE_SIZE / 2;
            const size = 6;
            
            graphics.beginPath();
            if (tile === TileType.LEDGE_DOWN) {
                graphics.moveTo(cx - size, cy - size/2);
                graphics.lineTo(cx + size, cy - size/2);
                graphics.lineTo(cx, cy + size);
            } else if (tile === TileType.LEDGE_UP) {
                graphics.moveTo(cx - size, cy + size/2);
                graphics.lineTo(cx + size, cy + size/2);
                graphics.lineTo(cx, cy - size);
            } else if (tile === TileType.LEDGE_RIGHT) {
                graphics.moveTo(cx - size/2, cy - size);
                graphics.lineTo(cx - size/2, cy + size);
                graphics.lineTo(cx + size, cy);
            } else if (tile === TileType.LEDGE_LEFT) {
                graphics.moveTo(cx + size/2, cy - size);
                graphics.lineTo(cx + size/2, cy + size);
                graphics.lineTo(cx - size, cy);
            }
            graphics.fill();
        }
        
        // Grid lines
        graphics.lineStyle(1, 0x000000, 0.1);
        graphics.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private async handleMove(dir: { x: number; y: number }) {
    this.isInputLocked = true; // Lock until move sequence complete

    // Check first move validity
    const nextX = this.player.gridX + dir.x;
    const nextY = this.player.gridY + dir.y;

    if (!this.isValidMove(this.player.gridX, this.player.gridY, nextX, nextY, dir)) {
      // Bump animation
      this.tweens.add({
        targets: this.player,
        x: this.player.x + dir.x * 8,
        y: this.player.y + dir.y * 8,
        duration: 50,
        yoyo: true,
        onComplete: () => {
          this.isInputLocked = false;
        }
      });
      return;
    }

    this.moves++;
    EventBus.emit('stats-update', { moves: this.moves, time: Math.floor((Date.now() - this.startTime) / 1000) });

    await this.processSlide(dir);
    
    // Check Win
    if (this.player.gridX === this.goalPoint.x && this.player.gridY === this.goalPoint.y) {
        this.winGame();
    } else {
        this.isInputLocked = false;
    }
  }

  private async processSlide(dir: { x: number; y: number }) {
    let keepSliding = true;

    while (keepSliding) {
      const targetX = this.player.gridX + dir.x;
      const targetY = this.player.gridY + dir.y;

      if (!this.isValidMove(this.player.gridX, this.player.gridY, targetX, targetY, dir)) {
        keepSliding = false;
        break;
      }

      // Perform move
      await new Promise<void>((resolve) => {
        this.player.moveToTile(targetX, targetY, resolve);
      });

      // Check if we are on ICE
      const currentTile = this.grid[this.player.gridY][this.player.gridX];
      
      // If we are on ICE, we continue sliding.
      // If we are on FLOOR/START/GOAL, we stop.
      if (currentTile !== TileType.ICE) {
        keepSliding = false;
      }
      
      // Stop at goal
      if (this.player.gridX === this.goalPoint.x && this.player.gridY === this.goalPoint.y) {
          keepSliding = false;
      }
    }
  }

  private isValidMove(fromX: number, fromY: number, toX: number, toY: number, dir: { x: number; y: number }): boolean {
    if (toX < 0 || toX >= GRID_WIDTH || toY < 0 || toY >= GRID_HEIGHT) return false;
    
    const targetTile = this.grid[toY][toX];
    const currentTile = this.grid[fromY][fromX];

    // 1. Check if Target is blocked
    if (targetTile === TileType.WALL) return false;

    // 2. Check One-Way Ledge Entry (simplified: cannot enter LEDGE from wrong side)
    // If target is LEDGE_DOWN, must be moving DOWN
    if (targetTile === TileType.LEDGE_DOWN && dir.y !== 1) return false;
    if (targetTile === TileType.LEDGE_UP && dir.y !== -1) return false;
    if (targetTile === TileType.LEDGE_LEFT && dir.x !== -1) return false;
    if (targetTile === TileType.LEDGE_RIGHT && dir.x !== 1) return false;

    // 3. Check One-Way Ledge Exit (simplified: cannot go back UP if on LEDGE_DOWN)
    // Actually, if we are ON a ledge tile, we treat it as a floor we can leave? 
    // Or is it sticky?
    // Let's say: If you are ON LEDGE_DOWN, you cannot move UP.
    if (currentTile === TileType.LEDGE_DOWN && dir.y === -1) return false;
    if (currentTile === TileType.LEDGE_UP && dir.y === 1) return false;
    if (currentTile === TileType.LEDGE_LEFT && dir.x === 1) return false;
    if (currentTile === TileType.LEDGE_RIGHT && dir.x === -1) return false;

    return true;
  }

  private winGame() {
    if(this.timerEvent) this.timerEvent.remove();
    const time = Math.floor((Date.now() - this.startTime) / 1000);
    EventBus.emit('game-win', { moves: this.moves, time });
  }
}
