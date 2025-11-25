import { Scene, GameObjects, Input, Types } from 'phaser';
import { EventBus } from '../EventBus';
import { TileType, TILE_SIZE } from '../constants';
import { generateDailyPuzzle, PuzzleData } from '@/utils/puzzleGenerator';

export class Game extends Scene {
    private player!: GameObjects.Sprite;
    private cursors!: Types.Input.Keyboard.CursorKeys;
    private wasd!: {
        up: Input.Keyboard.Key;
        down: Input.Keyboard.Key;
        left: Input.Keyboard.Key;
        right: Input.Keyboard.Key;
    };
    
    private puzzle!: PuzzleData;
    private gridW!: number;
    private gridH!: number;
    
    private playerPos = { x: 0, y: 0 };
    private isMoving = false;
    
    private moveCount = 0;
    private startTime = 0;
    private timerEvent!: Phaser.Time.TimerEvent;
    private isLevelComplete = false;

    constructor() {
        super('Game');
    }

    create() {
        // 1. Generate Puzzle (Global Daily)
        const dateStr = new Date().toISOString().split('T')[0];
        this.puzzle = generateDailyPuzzle(dateStr);
        this.gridW = this.puzzle.width;
        this.gridH = this.puzzle.height;

        // 2. Draw Map
        this.createMap();

        // 3. Create Player
        this.playerPos = { ...this.puzzle.start };
        this.player = this.add.sprite(
            this.playerPos.x * TILE_SIZE + TILE_SIZE / 2,
            this.playerPos.y * TILE_SIZE + TILE_SIZE / 2,
            'player'
        );
        this.player.setDepth(10);

        // 4. Camera
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(2);
        // Center grid if possible or limit bounds
        const mapWidth = this.gridW * TILE_SIZE;
        const mapHeight = this.gridH * TILE_SIZE;
        this.cameras.main.setBounds(-100, -100, mapWidth + 200, mapHeight + 200);
        this.cameras.main.setBackgroundColor('#202020');

        // 5. Input
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasd = this.input.keyboard.addKeys({
                up: Input.Keyboard.KeyCodes.W,
                down: Input.Keyboard.KeyCodes.S,
                left: Input.Keyboard.KeyCodes.A,
                right: Input.Keyboard.KeyCodes.D
            }) as any;
        }

        // Mobile Swipe
        this.input.on('pointerup', (pointer: Input.Pointer) => {
            if (this.isMoving || this.isLevelComplete) return;
            
            const swipeThreshold = 30;
            const dist = pointer.getDistance();
            const duration = pointer.upTime - pointer.downTime;

            if (duration < 1000 && dist > swipeThreshold) {
                const dx = pointer.upX - pointer.downX;
                const dy = pointer.upY - pointer.downY;
                
                if (Math.abs(dx) > Math.abs(dy)) {
                    if (dx > 0) this.tryMove(1, 0);
                    else this.tryMove(-1, 0);
                } else {
                    if (dy > 0) this.tryMove(0, 1);
                    else this.tryMove(0, -1);
                }
            }
        });

        // 6. Stats
        this.moveCount = 0;
        this.startTime = Date.now();
        EventBus.emit('stats-update', { moves: 0, time: 0 });
        
        this.timerEvent = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                if (!this.isLevelComplete) {
                    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                    EventBus.emit('stats-update', { moves: this.moveCount, time: elapsed });
                }
            }
        });

        EventBus.emit('current-scene-ready', this);
    }

    createMap() {
        // Center the map
        const offsetX = 0;
        const offsetY = 0;

        for (let y = 0; y < this.gridH; y++) {
            for (let x = 0; x < this.gridW; x++) {
                const tileType = this.puzzle.grid[y][x];
                const posX = x * TILE_SIZE + TILE_SIZE / 2 + offsetX;
                const posY = y * TILE_SIZE + TILE_SIZE / 2 + offsetY;

                // Background floor (for transparency on walls/objects)
                this.add.image(posX, posY, 'floor');

                if (tileType === TileType.WALL) {
                    this.add.image(posX, posY, 'wall');
                } else if (tileType === TileType.ICE) {
                    this.add.image(posX, posY, 'ice');
                } else if (tileType === TileType.START) {
                    this.add.image(posX, posY, 'start');
                } else if (tileType === TileType.GOAL) {
                    this.add.image(posX, posY, 'goal');
                } else if (tileType === TileType.LEDGE_DOWN) {
                    this.add.image(posX, posY, 'ledge_down');
                }
            }
        }
    }

    update() {
        if (this.isLevelComplete) return;
        if (this.isMoving) return;

        if (this.cursors.left.isDown || this.wasd.left.isDown) {
            this.tryMove(-1, 0);
        } else if (this.cursors.right.isDown || this.wasd.right.isDown) {
            this.tryMove(1, 0);
        } else if (this.cursors.up.isDown || this.wasd.up.isDown) {
            this.tryMove(0, -1);
        } else if (this.cursors.down.isDown || this.wasd.down.isDown) {
            this.tryMove(0, 1);
        }
    }

    tryMove(dx: number, dy: number) {
        if (this.isMoving) return;

        // Move logic
        const nextX = this.playerPos.x + dx;
        const nextY = this.playerPos.y + dy;

        if (!this.isValid(nextX, nextY)) return;

        const targetTile = this.puzzle.grid[nextY][nextX];

        // Check Walls
        if (targetTile === TileType.WALL) {
             return;
        }

        // Check Ledges
        if (targetTile === TileType.LEDGE_DOWN) {
            if (dy !== 1) return; // Blocked unless moving down
        }

        // Valid Move Initiated
        this.isMoving = true;
        this.moveCount++;
        EventBus.emit('stats-update', { moves: this.moveCount, time: Math.floor((Date.now() - this.startTime) / 1000) });

        this.executeMove(dx, dy);
    }

    executeMove(dx: number, dy: number) {
        const targetX = this.playerPos.x + dx;
        const targetY = this.playerPos.y + dy;
        const targetTile = this.puzzle.grid[targetY][targetX];

        const moveDuration = 150; // ms

        // Tween to target
        this.tweens.add({
            targets: this.player,
            x: targetX * TILE_SIZE + TILE_SIZE / 2,
            y: targetY * TILE_SIZE + TILE_SIZE / 2,
            duration: moveDuration,
            onComplete: () => {
                this.playerPos = { x: targetX, y: targetY };
                
                // Check for Goal
                if (targetTile === TileType.GOAL) {
                    this.isMoving = false;
                    this.winLevel();
                    return;
                }

                // Check for Ice Slide
                if (targetTile === TileType.ICE) {
                    // Continue moving in same direction if valid
                    if (this.canSlide(dx, dy)) {
                        this.executeMove(dx, dy);
                    } else {
                        this.isMoving = false;
                    }
                } else if (targetTile === TileType.LEDGE_DOWN) {
                     // Force move down again (Jump)
                     if (this.isValid(targetX, targetY + 1) && this.puzzle.grid[targetY+1][targetX] !== TileType.WALL) {
                         this.executeMove(0, 1);
                     } else {
                         this.isMoving = false;
                     }
                } else {
                    // Floor/Start - Stop
                    this.isMoving = false;
                }
            }
        });
    }

    canSlide(dx: number, dy: number): boolean {
        const nextX = this.playerPos.x + dx;
        const nextY = this.playerPos.y + dy;
        if (!this.isValid(nextX, nextY)) return false;
        const tile = this.puzzle.grid[nextY][nextX];
        if (tile === TileType.WALL) return false;
        if (tile === TileType.LEDGE_DOWN && dy === -1) return false;
        
        return true;
    }

    isValid(x: number, y: number) {
        return x >= 0 && x < this.gridW && y >= 0 && y < this.gridH;
    }

    winLevel() {
        this.isLevelComplete = true;
        const finalTime = Math.floor((Date.now() - this.startTime) / 1000);
        EventBus.emit('game-complete', { moves: this.moveCount, time: finalTime });
        
        // Visuals
        this.tweens.add({
            targets: this.player,
            alpha: 0,
            y: this.player.y - 20,
            duration: 500,
            yoyo: true,
            repeat: 3
        });
    }
}
