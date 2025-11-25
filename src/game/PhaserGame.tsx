'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as Phaser from 'phaser';
import { GameScene } from './GameScene';
import { PuzzleData, COLORS, Direction } from './types';

export interface GameControls {
  restart: () => void;
  movePlayer: (dir: Direction) => void;
}

interface PhaserGameProps {
  puzzle: PuzzleData;
  onReady?: (controls: GameControls) => void;
}

export interface PhaserGameRef {
  restart: () => void;
  getScene: () => GameScene | null;
  movePlayer: (dir: Direction) => void;
}

export default function PhaserGame({ puzzle, onReady }: PhaserGameProps) {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  
  const getControls = useCallback((): GameControls => ({
    restart: () => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.restart();
    },
    movePlayer: (dir: Direction) => {
      const scene = gameRef.current?.scene.getScene('GameScene') as GameScene;
      scene?.movePlayer(dir);
    },
  }), []);

  useEffect(() => {
    if (!gameContainerRef.current) return;
    
    // Avoid duplicate initialization
    if (gameRef.current) {
      // If game already exists, just restart with new puzzle
      const existingScene = gameRef.current.scene.getScene('GameScene') as GameScene;
      if (existingScene) {
        existingScene.scene.restart({ puzzle });
      }
      return;
    }

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: gameContainerRef.current,
      backgroundColor: COLORS.BACKGROUND,
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 400,
        height: 500,
      },
      scene: [], // Don't auto-start any scenes
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;
    
    // Add and start scene with puzzle data after game is ready
    game.events.once('ready', () => {
      if (game.scene) {
        game.scene.add('GameScene', GameScene, true, { puzzle });
        onReady?.(getControls());
      }
    });

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [puzzle, onReady, getControls]);

  return (
    <div
      ref={gameContainerRef}
      className="game-container"
      style={{
        width: '100%',
        maxWidth: '400px',
        aspectRatio: '4/5',
        margin: '0 auto',
      }}
    />
  );
}

