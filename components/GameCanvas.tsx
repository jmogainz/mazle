'use client';

import * as Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { Direction, MovePath, Point, Puzzle, TileType } from '../lib/types';

const TILE_SIZE = 32;

type GameCanvasProps = {
  puzzle: Puzzle;
  playerPosition: Point;
  moveAnimation?: { path: Point[]; bumped: boolean; direction: Direction; id: number } | null;
  snapVersion?: number;
};

class MazleScene extends Phaser.Scene {
  puzzle: Puzzle;
  playerPosition: Point;
  playerSprite?: Phaser.GameObjects.Sprite;
  moveTint?: Phaser.GameObjects.Rectangle;

  constructor(puzzle: Puzzle, playerPosition: Point) {
    super('MazleScene');
    this.puzzle = puzzle;
    this.playerPosition = playerPosition;
  }

  preload() {
    this.createTextures();
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0a1422);
    this.drawGrid();
    this.spawnPlayer();
  }

  private createTextures() {
    if (this.textures.exists('tile-floor')) return;
    const size = TILE_SIZE;

    const makeSquare = (key: string, fill: number, border: number, borderWidth = 2) => {
      const g = this.add.graphics({ x: 0, y: 0 });
      g.setVisible(false);
      g.fillStyle(fill, 1);
      g.fillRect(0, 0, size, size);
      g.lineStyle(borderWidth, border, 1);
      g.strokeRect(0, 0, size, size);
      g.generateTexture(key, size, size);
      g.destroy();
    };

    makeSquare('tile-floor', 0x183251, 0x294a76);
    makeSquare('tile-wall', 0x0f1c33, 0x0b1323, 3);

    const ice = this.add.graphics({ x: 0, y: 0 });
    ice.setVisible(false);
    ice.fillStyle(0x63e5ff, 1);
    ice.fillRect(0, 0, size, size);
    ice.fillStyle(0xb6f4ff, 0.5);
    ice.fillRect(4, 4, size - 8, size - 8);
    ice.lineStyle(2, 0x1f7aa4, 1);
    ice.strokeRect(0, 0, size, size);
    ice.generateTexture('tile-ice', size, size);
    ice.destroy();

    const ledge = this.add.graphics({ x: 0, y: 0 });
    ledge.setVisible(false);
    ledge.fillStyle(0x2a3f5f, 1);
    ledge.fillRect(0, 0, size, size);
    ledge.fillStyle(0xf4c542, 1);
    ledge.beginPath();
    ledge.moveTo(size / 2, size * 0.2);
    ledge.lineTo(size * 0.8, size * 0.55);
    ledge.lineTo(size * 0.2, size * 0.55);
    ledge.closePath();
    ledge.fillPath();
    ledge.generateTexture('tile-ledge', size, size);
    ledge.destroy();

    const goal = this.add.graphics({ x: 0, y: 0 });
    goal.setVisible(false);
    goal.fillStyle(0x1f3659, 1);
    goal.fillRect(0, 0, size, size);
    goal.fillStyle(0xf5e960, 1);
    goal.beginPath();
    goal.moveTo(size / 2, size * 0.2);
    goal.lineTo(size * 0.65, size * 0.65);
    goal.lineTo(size * 0.2, size * 0.4);
    goal.lineTo(size * 0.8, size * 0.4);
    goal.lineTo(size * 0.35, size * 0.65);
    goal.closePath();
    goal.fillPath();
    goal.generateTexture('tile-goal', size, size);
    goal.destroy();

    const start = this.add.graphics({ x: 0, y: 0 });
    start.setVisible(false);
    start.fillStyle(0x1f3659, 1);
    start.fillRect(0, 0, size, size);
    start.fillStyle(0x52e0c1, 1);
    start.fillRect(6, 6, size - 12, size - 12);
    start.generateTexture('tile-start', size, size);
    start.destroy();

    const player = this.add.graphics({ x: 0, y: 0 });
    player.setVisible(false);
    player.fillStyle(0xf4c542, 1);
    player.fillRect(6, 6, size - 12, size - 12);
    player.lineStyle(2, 0x0b1323, 1);
    player.strokeRect(6, 6, size - 12, size - 12);
    player.generateTexture('player', size, size);
    player.destroy();
  }

  private coordFor(point: Point) {
    return { x: point.x * TILE_SIZE + TILE_SIZE / 2, y: point.y * TILE_SIZE + TILE_SIZE / 2 };
  }

  private textureFor(tile: TileType) {
    switch (tile) {
      case TileType.Wall:
        return 'tile-wall';
      case TileType.Ice:
        return 'tile-ice';
      case TileType.Ledge:
        return 'tile-ledge';
      case TileType.Goal:
        return 'tile-goal';
      case TileType.Start:
        return 'tile-start';
      default:
        return 'tile-floor';
    }
  }

  private drawGrid() {
    const { width, height } = this.puzzle;
    const group = this.add.group();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const tile = this.puzzle.tiles[y][x];
        const sprite = this.add.sprite(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, this.textureFor(tile));
        sprite.setOrigin(0.5);
        sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
        sprite.setName(`tile-${x}-${y}`);
        group.add(sprite);
      }
    }
    const goalPulse = this.add.ellipse(
      this.puzzle.goal.x * TILE_SIZE + TILE_SIZE / 2,
      this.puzzle.goal.y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE * 0.7,
      TILE_SIZE * 0.7,
      0xf4c542,
      0.2,
    );
    this.tweens.add({ targets: goalPulse, scale: 1.15, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private spawnPlayer() {
    const { x, y } = this.coordFor(this.playerPosition);
    this.playerSprite = this.add.sprite(x, y, 'player');
    this.playerSprite.setOrigin(0.5);
    this.playerSprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
    this.playerSprite.setDepth(5);
  }

  setPlayerPosition(point: Point) {
    this.playerPosition = point;
    if (this.playerSprite) {
      const { x, y } = this.coordFor(point);
      this.playerSprite.setPosition(x, y);
    }
  }

  setPuzzle(puzzle: Puzzle, position: Point) {
    this.puzzle = puzzle;
    this.playerPosition = position;
    this.children.removeAll();
    this.create();
  }

  playMove(animation: { path: Point[]; bumped: boolean }) {
    if (!this.playerSprite) return;
    if (animation.bumped || animation.path.length <= 1) {
      this.tweens.add({
        targets: this.playerSprite,
        duration: 90,
        yoyo: true,
        repeat: 1,
        props: { scale: { from: 1, to: 0.9 } },
        ease: 'Power1',
      });
      return;
    }

    const segments = animation.path.slice(1).map((p) => this.coordFor(p));
    let delay = 0;
    segments.forEach((coord) => {
      this.tweens.add({
        targets: this.playerSprite!,
        x: coord.x,
        y: coord.y,
        duration: 120,
        delay,
        ease: 'Sine.easeInOut',
      });
      delay += 110;
    });
    this.playerPosition = animation.path[animation.path.length - 1];
  }
}

export function GameCanvas({ puzzle, playerPosition, moveAnimation, snapVersion }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<MazleScene | null>(null);
  const lastAnimationId = useRef<number | null>(null);
  const latestPosition = useRef<Point>(playerPosition);
  const lastSnapVersion = useRef<number | null>(null);

  useEffect(() => {
    latestPosition.current = playerPosition;
  }, [playerPosition]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }

    sceneRef.current = new MazleScene(puzzle, puzzle.start);

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      width: puzzle.width * TILE_SIZE,
      height: puzzle.height * TILE_SIZE,
      parent: containerRef.current,
      backgroundColor: '#0a1422',
      pixelArt: true,
      scene: sceneRef.current,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [puzzle]);

  useEffect(() => {
    if (lastSnapVersion.current === snapVersion) return;
    lastSnapVersion.current = snapVersion ?? null;
    if (!sceneRef.current) return;
    sceneRef.current.setPlayerPosition(playerPosition);
  }, [playerPosition, snapVersion]);

  useEffect(() => {
    if (!moveAnimation || !sceneRef.current) return;
    if (moveAnimation.id === lastAnimationId.current) return;
    lastAnimationId.current = moveAnimation.id;
    sceneRef.current.playMove(moveAnimation);
  }, [moveAnimation]);

  return <div ref={containerRef} className="game-canvas-wrapper" />;
}
