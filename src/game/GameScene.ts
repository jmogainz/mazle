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
  private offsetX = 0;
  private offsetY = 0;
  private readonly tileFaceLift = 3 * (TILE_SIZE / 32); // lift sprites to sit on the top face of 3D tiles

  private isPlaying = false;

  // Boulder state tracking (for ground maps)
  private boulderPositions: Set<string> = new Set();
  private boulderSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  private analysisObjects: Phaser.GameObjects.GameObject[] = [];
  private analysisTimers: Phaser.Time.TimerEvent[] = [];
  private analysisTweens: Phaser.Tweens.Tween[] = [];

  private solutionIndexByKey: Map<string, number> | null = null;
  private solutionNextByKey: Map<string, string> | null = null;
  private solutionPosByKey: Map<string, Position> | null = null;
  private solutionEdges: Set<string> | null = null; // All edges in solution for correct move counting

  private unlockedHintTiles: Set<string> = new Set();
  private unlockedHintEdges: Set<string> = new Set();
  private unlockedThisLifeTiles: Set<string> = new Set();
  private unlockedThisLifeEdges: Set<string> = new Set();

  /**
   * Generate pre-rendered number textures to avoid Canvas text rasterization artifacts.
   * Some digits (especially 2 and 4) render with black artifacts on certain browsers/Canvas.
   * Uses 2x supersampling with explicit canvas clearing for clean rendering.
   * Font metrics-based placement keeps digits aligned across devices.
   */
  private generateNumberTextures() {
    const scale = 2; // Supersampling factor for quality

    const drawNumber = (
      canvas: HTMLCanvasElement,
      text: string,
      font: string,
      fontSize: number,
      fillStyle: string,
      align: 'top-left' | 'center',
      margin: number,
      nudgeX = 0
    ) => {
      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      const metrics = ctx.measureText(text);
      const ascent = metrics.actualBoundingBoxAscent ?? fontSize * 0.8;
      const descent = metrics.actualBoundingBoxDescent ?? fontSize * 0.2;
      const left = metrics.actualBoundingBoxLeft ?? 0;
      const right = metrics.actualBoundingBoxRight ?? metrics.width;
      const textWidth = left + right;

      const baseSize = canvas.width / scale;
      let x = 0;
      let y = 0;

      if (align === 'top-left') {
        x = margin - left;
        y = margin + ascent + 1;
      } else {
        x = (baseSize - textWidth) / 2 - left;
        y = baseSize / 2 + (ascent - descent) / 2;
      }
      x += nudgeX;

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = fillStyle;
      ctx.fillText(text, x, y);
    };

    // White numbers for solution path (font size 22)
    for (let i = 1; i <= 20; i++) {
      const key = `num_white_${i}`;
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }

      const canvas = document.createElement('canvas');
      const baseSize = 32;
      canvas.width = baseSize * scale;
      canvas.height = baseSize * scale;
      drawNumber(canvas, i.toString(), 'bold 22px Nunito, sans-serif', 22, '#ffffff', 'top-left', 2);
      this.textures.addCanvas(key, canvas);
    }

    // Red numbers for attempt badges (font size 18, centered)
    for (let i = 1; i <= 10; i++) {
      const key = `num_red_${i}`;
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }

      const canvas = document.createElement('canvas');
      const baseSize = 24;
      canvas.width = baseSize * scale;
      canvas.height = baseSize * scale;
      const nudgeX = i === 1 ? -1 : 0;
      drawNumber(canvas, i.toString(), 'bold 18px Nunito, sans-serif', 18, '#cc0000', 'center', 0, nudgeX);
      this.textures.addCanvas(key, canvas);
    }
  }

  /**
   * Create a number sprite using pre-rendered texture.
   */
  private createNumberSprite(
    x: number,
    y: number,
    num: number,
    variant: 'white' | 'red',
    originX: number,
    originY: number
  ): Phaser.GameObjects.Image {
    const key = `num_${variant}_${num}`;
    // Scale down from 2x supersampling
    return this.add.image(x, y, key).setOrigin(originX, originY).setScale(0.5);
  }

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
    // Generate pre-rendered number textures (avoids Canvas text artifacts)
    this.generateNumberTextures();
    const fonts = document.fonts;
    if (fonts && (!fonts.check('bold 22px Nunito') || !fonts.check('bold 18px Nunito'))) {
      let cancelled = false;
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        cancelled = true;
      });
      fonts.ready.then(() => {
        if (cancelled) return;
        this.generateNumberTextures();
      });
    }

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
    this.gameState.penaltyTimeMs += 15000; // 15s penalty

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
      penaltyMs: 15000
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
    this.isPlaying = false;
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

    // Clear previous analysis if any
    this.clearAnalysis();

    const path = this.puzzle.solutionPath;
    const s = TILE_SIZE / 32;
    const moveDelay = 150; // ms per move

    // Create ghost sprite (semi-transparent version of player)
    const ghostStartX = this.offsetX + path[0].x * TILE_SIZE + TILE_SIZE / 2;
    const ghostStartY = this.offsetY + path[0].y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;

    const ghost = this.add.container(ghostStartX, ghostStartY);
    ghost.setAlpha(0.6);
    ghost.setDepth(15); // Above hint tiles, below UI
    this.analysisObjects.push(ghost);

    // Draw ghost body (same as player but tinted)
    const body = this.add.graphics();
    body.fillStyle(0x000000, 0.25);
    body.fillEllipse(0, 8 * s, 16 * s, 6 * s);
    body.fillStyle(COLORS.HINT_TILE_FACE); // Green tint
    body.fillRoundedRect(-8 * s, -10 * s, 16 * s, 18 * s, 3 * s);
    body.lineStyle(1.25 * s, COLORS.HINT_TILE_EDGE);
    body.strokeRoundedRect(-8 * s, -10 * s, 16 * s, 18 * s, 3 * s);
    body.fillStyle(0xffffff);
    body.fillCircle(-3 * s, -4 * s, 3 * s);
    body.fillCircle(3 * s, -4 * s, 3 * s);
    body.fillStyle(0x000000);
    body.fillCircle(-2 * s, -4 * s, 1.5 * s);
    body.fillCircle(4 * s, -4 * s, 1.5 * s);
    ghost.add(body);

    // Track which tiles have been revealed (stopping tiles only)
    const revealedStoppingTiles: Set<string> = new Set();
    // Track intermediate tile containers so we can remove them if a stopping tile needs that spot
    const intermediateTileContainers: Map<string, Phaser.GameObjects.Container> = new Map();

    // Function to reveal a tile with green overlay and number
    const revealTile = (pos: Position, moveNumber: number) => {
      const key = positionKey(pos);
      if (revealedStoppingTiles.has(key)) return;
      revealedStoppingTiles.add(key);

      // If there's an intermediate tile at this position, remove it
      const existingIntermediate = intermediateTileContainers.get(key);
      if (existingIntermediate) {
        existingIntermediate.destroy();
        intermediateTileContainers.delete(key);
        // Also remove from analysisObjects array
        const idx = this.analysisObjects.indexOf(existingIntermediate);
        if (idx !== -1) {
          this.analysisObjects.splice(idx, 1);
        }
      }

      const px = this.offsetX + pos.x * TILE_SIZE;
      const py = this.offsetY + pos.y * TILE_SIZE;

      // Create tile overlay container
      const container = this.add.container(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      container.setDepth(5);
      container.setAlpha(0);
      this.analysisObjects.push(container);

      // Draw green tile overlay
      const tileG = this.add.graphics();
      const tile = this.puzzle.tiles[pos.y][pos.x];
      this.drawAnalysisTileGraphics(tileG, tile);
      container.add(tileG);

      // Add move number in top-left corner (skip 0 for start tile, skip goal tile)
      const isGoal = pos.x === this.puzzle.goal.x && pos.y === this.puzzle.goal.y;
      if (moveNumber > 0 && !isGoal) {
        const numSprite = this.createNumberSprite(
          -TILE_SIZE / 2 + 5 * s,
          -TILE_SIZE / 2 + 5 * s - this.tileFaceLift,
          moveNumber,
          'white',
          0,
          0
        );
        container.add(numSprite);
      }

      // Fade in the tile
      const tween = this.tweens.add({
        targets: container,
        alpha: 1,
        duration: 200,
        ease: 'Quad.easeOut',
      });
      this.analysisTweens.push(tween);
    };

    // Reveal intermediate tiles between two points - stepping stone style (one at a time, ahead of ghost)
    const revealIntermediateTiles = (from: Position, to: Position, moveDuration: number, ghostStartDelay: number) => {
      const dx = Math.sign(to.x - from.x);
      const dy = Math.sign(to.y - from.y);

      // Collect all intermediate positions
      const positions: Position[] = [];
      let cx = from.x + dx;
      let cy = from.y + dy;
      while (cx !== to.x || cy !== to.y) {
        positions.push({ x: cx, y: cy });
        cx += dx;
        cy += dy;
      }

      if (positions.length === 0) return;

      const totalDist = positions.length + 1; // +1 for the final stopping tile
      const LEAD_TIME = 140; // Tiles appear this many ms before ghost arrives

      positions.forEach((pos, idx) => {
        const key = positionKey(pos);
        if (revealedStoppingTiles.has(key) || intermediateTileContainers.has(key)) return;

        // Calculate exact time ghost will arrive at this tile
        // Ghost uses Quad.easeOut: p(t) = 2t - t^2
        // Inverse (time to reach progress p): t = 1 - sqrt(1 - p)
        const tileDist = idx + 1;
        const progress = tileDist / totalDist;
        const easeTime = 1 - Math.sqrt(1 - progress);
        const ghostArrivalTime = ghostStartDelay + (moveDuration * easeTime);

        // Schedule reveal relative to ghost arrival
        const delay = Math.max(0, ghostArrivalTime - LEAD_TIME);

        const timer = this.time.delayedCall(delay, () => {
          if (revealedStoppingTiles.has(key) || intermediateTileContainers.has(key)) return;

          const px = this.offsetX + pos.x * TILE_SIZE;
          const py = this.offsetY + pos.y * TILE_SIZE;

          const container = this.add.container(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
          container.setDepth(4);
          container.setAlpha(0);
          container.setScale(0.7);
          this.analysisObjects.push(container);
          intermediateTileContainers.set(key, container);

          const tileG = this.add.graphics();
          const tile = this.puzzle.tiles[pos.y][pos.x];
          this.drawAnalysisTileGraphics(tileG, tile, true);
          container.add(tileG);

          const tween = this.tweens.add({
            targets: container,
            alpha: 1,
            scale: 1,
            duration: 80,
            ease: 'Back.easeOut',
          });
          this.analysisTweens.push(tween);
        });
        this.analysisTimers.push(timer);
      });
    };

    // Reveal start tile immediately
    revealTile(path[0], 0);

    // Chain ghost movements using tween callbacks instead of pre-scheduled timers
    // This ensures each animation waits for the previous one to complete
    const animateStep = (stepIndex: number) => {
      if (stepIndex >= path.length) {
        // All moves complete - fade out ghost and show attempt paths
        const timer = this.time.delayedCall(300, () => {
          const fadeOutTween = this.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: 300,
            ease: 'Quad.easeOut',
          });
          this.analysisTweens.push(fadeOutTween);
          this.drawUserAttemptPaths();
        });
        this.analysisTimers.push(timer);
        return;
      }

      const from = path[stepIndex - 1];
      const to = path[stepIndex];
      const targetX = this.offsetX + to.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = this.offsetY + to.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;

      // Calculate distance for duration scaling
      const dist = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      // Standard moveDelay for first tile, then much faster (60ms) for subsequent tiles in a slide
      const duration = moveDelay + (Math.max(dist, 1) - 1) * 80;

      const GHOST_START_DELAY = 150; // Fixed start delay for consistent "chase" feel

      // Reveal intermediate tiles FIRST (stepping stone effect)
      // We sync this perfectly with the ghost's Quad.easeOut movement
      revealIntermediateTiles(from, to, duration, GHOST_START_DELAY);

      // Delay ghost start so tiles appear ahead
      const ghostStartTimer = this.time.delayedCall(GHOST_START_DELAY, () => {
        const moveTween = this.tweens.add({
          targets: ghost,
          x: targetX,
          y: targetY,
          duration,
          ease: dist > 1 ? 'Quad.easeOut' : 'Quad.easeInOut',
          onComplete: () => {
            // Reveal stopping tile when ghost arrives
            revealTile(to, stepIndex);

            // Small gap before next move, then continue chain
            const gapTimer = this.time.delayedCall(50, () => {
              animateStep(stepIndex + 1);
            });
            this.analysisTimers.push(gapTimer);
          },
        });
        this.analysisTweens.push(moveTween);
      });
      this.analysisTimers.push(ghostStartTimer);
    };

    // Start the animation chain from step 1 (step 0 is the start tile, already revealed)
    animateStep(1);
  }

  // Draw a tile for analysis overlay (similar to hint tiles but no shake)
  private drawAnalysisTileGraphics(g: Phaser.GameObjects.Graphics, tile: TileType, isIntermediate = false) {
    const size = TILE_SIZE;
    const s = size / 32;
    const padding = 2 * s;
    const radius = 8 * s;
    const depth = 4 * s;

    const x = -size / 2 + padding;
    const y = -size / 2 + padding;
    const w = size - padding * 2;
    const h = size - padding * 2;

    // Glow (subtle)
    const glowColor = COLORS.HINT_GLOW;
    const layers = 2;
    const maxExpand = 4 * s;

    for (let i = layers; i >= 1; i--) {
      const expand = (i / layers) * maxExpand;
      const alpha = 0.05 + (1 - i / layers) * 0.15;

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
    const faceColor = isIntermediate ? COLORS.HINT_PATH_FACE : COLORS.HINT_TILE_FACE;
    const edgeColor = isIntermediate ? COLORS.HINT_PATH_EDGE : COLORS.HINT_TILE_EDGE;

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
      g.beginPath();
      g.moveTo(faceX + faceW * 0.2, faceY + faceH * 0.8);
      g.lineTo(faceX + faceW * 0.8, faceY + faceH * 0.2);
      g.strokePath();
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

  // Draw dead character markers at failure points with attempt numbers
  private drawUserAttemptPaths() {
    if (this.gameState.attempts.length === 0) return;

    const s = TILE_SIZE / 32;

    // Draw dead character at each failure point
    this.gameState.attempts.forEach((attempt, idx) => {
      if (attempt.failedAt) {
        const fx = this.offsetX + attempt.failedAt.x * TILE_SIZE + TILE_SIZE / 2;
        const fy = this.offsetY + attempt.failedAt.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;

        // Create container for the failure marker
        const container = this.add.container(fx, fy);
        container.setDepth(6);
        container.setAlpha(0);
        this.analysisObjects.push(container);

        // Draw character body (same as player but with X eyes)
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

        // X eyes instead of normal eyes
        body.lineStyle(1.5 * s, 0xffffff, 1);
        // Left eye X
        body.beginPath();
        body.moveTo(-5 * s, -6 * s);
        body.lineTo(-1 * s, -2 * s);
        body.moveTo(-1 * s, -6 * s);
        body.lineTo(-5 * s, -2 * s);
        body.strokePath();
        // Right eye X
        body.beginPath();
        body.moveTo(1 * s, -6 * s);
        body.lineTo(5 * s, -2 * s);
        body.moveTo(5 * s, -6 * s);
        body.lineTo(1 * s, -2 * s);
        body.strokePath();

        container.add(body);

        // Attempt number badge in corner
        const badgeG = this.add.graphics();
        badgeG.fillStyle(0xffffff, 1);
        badgeG.fillCircle(10 * s, -12 * s, 6 * s);
        badgeG.lineStyle(1 * s, COLORS.PLAYER_FACE, 1);
        badgeG.strokeCircle(10 * s, -12 * s, 6 * s);
        container.add(badgeG);

        const numSprite = this.createNumberSprite(
          10 * s,
          -12 * s,
          idx + 1,
          'red',
          0.5,
          0.5
        );
        container.add(numSprite);

        // Fade in
        const fadeInTween = this.tweens.add({
          targets: container,
          alpha: 1,
          duration: 400,
          ease: 'Quad.easeOut',
        });
        this.analysisTweens.push(fadeInTween);
      }
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
    this.updateGameStateAndCheckLives(newPos, path, () => { });
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

    this.updateGameStateAndCheckLives(newPos, path, () => { });
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
    this.isPlaying = false;
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

  public canAcceptMoveInput() {
    return !(this.isAnimating || this.gameState.isComplete || !this.isPlaying);
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

    // Sort so intermediate tiles (hintLevel 1) are drawn first, stopping tiles (hintLevel 2) on top
    hintedTileData.sort((a, b) => a.hintLevel - b.hintLevel);

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

  // Get current game state in serializable format for localStorage persistence
  public getSerializableState(): {
    playerPos: Position;
    lives: number;
    currentAttemptMoves: number;
    currentAttemptCorrectMoves: number;
    moveCount: number;
    elapsedTimeMs: number;
    penaltyTimeMs: number;
    attempts: GameState['attempts'];
    moveHistory: Position[];
    boulderPositions?: string[];
    isPlaying: boolean;
    unlockedHintTiles?: string[];
    unlockedHintEdges?: string[];
    unlockedThisLifeTiles?: string[];
    unlockedThisLifeEdges?: string[];
  } {
    // Calculate elapsed time (frozen at current moment)
    const elapsedTimeMs = this.gameState.startTime > 0
      ? Date.now() - this.gameState.startTime
      : 0;

    return {
      playerPos: { ...this.gameState.playerPos },
      lives: this.gameState.lives,
      currentAttemptMoves: this.gameState.currentAttemptMoves,
      currentAttemptCorrectMoves: this.gameState.currentAttemptCorrectMoves,
      moveCount: this.gameState.moveCount,
      elapsedTimeMs,
      penaltyTimeMs: this.gameState.penaltyTimeMs,
      attempts: this.gameState.attempts.map(a => ({ ...a, path: [...a.path] })),
      moveHistory: [...this.gameState.moveHistory],
      boulderPositions: this.boulderPositions.size > 0 ? Array.from(this.boulderPositions) : undefined,
      isPlaying: this.isPlaying,
      unlockedHintTiles: this.unlockedHintTiles.size > 0 ? Array.from(this.unlockedHintTiles) : undefined,
      unlockedHintEdges: this.unlockedHintEdges.size > 0 ? Array.from(this.unlockedHintEdges) : undefined,
      unlockedThisLifeTiles: this.unlockedThisLifeTiles.size > 0 ? Array.from(this.unlockedThisLifeTiles) : undefined,
      unlockedThisLifeEdges: this.unlockedThisLifeEdges.size > 0 ? Array.from(this.unlockedThisLifeEdges) : undefined,
    };
  }

  // Restore game state from saved data (for resume after refresh)
  public restoreState(state: {
    playerPos: Position;
    lives: number;
    currentAttemptMoves: number;
    currentAttemptCorrectMoves: number;
    moveCount: number;
    elapsedTimeMs: number;
    penaltyTimeMs: number;
    attempts: GameState['attempts'];
    moveHistory: Position[];
    boulderPositions?: string[];
    isPlaying: boolean;
    unlockedHintTiles?: string[];
    unlockedHintEdges?: string[];
    unlockedThisLifeTiles?: string[];
    unlockedThisLifeEdges?: string[];
  }) {
    // Restore game state
    this.gameState.playerPos = { ...state.playerPos };
    this.gameState.lives = state.lives;
    this.gameState.currentAttemptMoves = state.currentAttemptMoves;
    this.gameState.currentAttemptCorrectMoves = state.currentAttemptCorrectMoves;
    this.gameState.moveCount = state.moveCount;
    this.gameState.penaltyTimeMs = state.penaltyTimeMs;
    this.gameState.attempts = state.attempts.map(a => ({ ...a, path: [...a.path] }));
    this.gameState.moveHistory = [...state.moveHistory];

    // Restore start time calculated from saved elapsed time
    // This makes the timer continue from where it was
    if (state.isPlaying) {
      this.gameState.startTime = Date.now() - (state.elapsedTimeMs ?? 0);
    }

    // Restore boulder positions if present
    if (state.boulderPositions) {
      // Clear existing boulder sprites
      for (const [key, sprite] of this.boulderSprites) {
        sprite.destroy();
      }
      this.boulderSprites.clear();

      // Set new boulder positions
      this.boulderPositions = new Set(state.boulderPositions);

      // Create sprites for new positions
      for (const key of this.boulderPositions) {
        const [x, y] = key.split(',').map(Number);
        this.createBoulderSprite(x, y);
      }
    }

    // Restore hint state
    this.unlockedHintTiles = new Set(state.unlockedHintTiles ?? []);
    this.unlockedHintEdges = new Set(state.unlockedHintEdges ?? []);
    this.unlockedThisLifeTiles = new Set(state.unlockedThisLifeTiles ?? []);
    this.unlockedThisLifeEdges = new Set(state.unlockedThisLifeEdges ?? []);
    // Redraw hint overlays if any hints were restored
    if (state.unlockedHintTiles?.length || state.unlockedHintEdges?.length) {
      this.redrawHintOverlays();
    }

    // Move player to restored position
    const px = this.offsetX + state.playerPos.x * TILE_SIZE + TILE_SIZE / 2;
    const py = this.offsetY + state.playerPos.y * TILE_SIZE + TILE_SIZE / 2 - this.tileFaceLift;
    this.player.setPosition(px, py);
    this.player.setVisible(true);

    // Set playing state
    this.isPlaying = state.isPlaying;

    // Emit state update for UI
    emitGameEvent('stateUpdate', { ...this.gameState });
  }

  private clearAnalysis() {
    // Cancel all scheduled timers (delayedCalls) for analysis animations
    this.analysisTimers.forEach(timer => timer.destroy());
    this.analysisTimers = [];

    // Stop all running tweens for analysis objects
    this.analysisTweens.forEach(tween => tween.stop());
    this.analysisTweens = [];

    // Destroy all analysis game objects
    this.analysisObjects.forEach(obj => obj.destroy());
    this.analysisObjects = [];
  }
}
