'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as Phaser from 'phaser';
import { GameScene } from './GameScene';
import { PuzzleData, COLORS, Direction, TILE_SIZE } from './types';

export interface GameControls {
  restart: () => void;
  movePlayer: (dir: Direction) => void;
  start: () => void;
  showAnalysis: (attempts: any[]) => void;
  getSerializableState: () => ReturnType<GameScene['getSerializableState']> | null;
  restoreState: (state: Parameters<GameScene['restoreState']>[0]) => void;
}

interface PhaserGameProps {
  puzzle: PuzzleData;
  viewportWidth?: number;
  viewportHeight?: number;
  onReady?: (controls: GameControls) => void;
}

export interface PhaserGameRef {
  restart: () => void;
  getScene: () => GameScene | null;
  movePlayer: (dir: Direction) => void;
  start: () => void;
}

export default function PhaserGame({ puzzle, viewportWidth, viewportHeight, onReady }: PhaserGameProps) {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const baseWidth = viewportWidth ?? Math.max(420, puzzle.width * TILE_SIZE + 64);
  const baseHeight = viewportHeight ?? Math.max(520, puzzle.height * TILE_SIZE + 120);

  const getControls = useCallback((): GameControls => ({
    restart: () => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.restart();
    },
    movePlayer: (dir: Direction) => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.movePlayer(dir);
    },
    start: () => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.startGame();
    },
    showAnalysis: (attempts: any[]) => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.showAnalysis(attempts);
    },
    getSerializableState: () => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      return scene?.getSerializableState() ?? null;
    },
    restoreState: (state) => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.restoreState(state);
    },
  }), []);


  useEffect(() => {
    if (!gameContainerRef.current) return;

    // Avoid duplicate initialization
    if (gameRef.current) {
      const game = gameRef.current;
      // Resize the canvas to fit larger puzzles before restarting
      if (game.scale.width !== baseWidth || game.scale.height !== baseHeight) {
        game.scale.resize(baseWidth, baseHeight);
        game.scale.refresh();
      }
      // If game already exists, just restart with new puzzle
      const existingScene = game.scene.getScene('GameScene') as GameScene;
      if (existingScene) {
        existingScene.scene.restart({ puzzle });
      }
      return;
    }

    // Detect mobile devices for renderer selection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth <= 768;

    const config: Phaser.Types.Core.GameConfig = {
      type: isMobile ? Phaser.CANVAS : Phaser.WEBGL, // Canvas on mobile for stability, WebGL on desktop for performance
      parent: gameContainerRef.current,
      backgroundColor: COLORS.BACKGROUND,
      audio: {
        noAudio: true,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: baseWidth,
        height: baseHeight,
      },
      scene: [], // We'll add scene manually
      // Mobile-specific settings
      input: {
        touch: true,
      },
      // High-Quality Rendering for Smooth Jelly Animations
      render: {
        pixelArt: false,
        antialias: true,
        roundPixels: false, // Enable sub-pixel positioning for smooth ease functions
      },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    // Add scene immediately after game creation, then start it
    game.scene.add('GameScene', GameScene, false);
    game.scene.start('GameScene', { puzzle });

    // Notify when ready (use a small delay to ensure scene is initialized)
    setTimeout(() => {
      onReady?.(getControls());
    }, 100);

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [puzzle, onReady, getControls, baseWidth, baseHeight]);

  return (
    <div
      ref={gameContainerRef}
      className="game-container"
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
}
