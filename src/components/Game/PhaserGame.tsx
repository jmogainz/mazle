'use client';
import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { GameConfig } from '@/game/config';
import { EventBus } from '@/game/EventBus';

export default function PhaserGame() {
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && !gameRef.current) {
      gameRef.current = new Phaser.Game(GameConfig);
      
      EventBus.on('request-restart', () => {
          if(gameRef.current) {
             const scene = gameRef.current.scene.getScene('MainScene');
             if(scene) scene.scene.restart();
          }
      });
    }

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      EventBus.off('request-restart');
    };
  }, []);

  return <div id="phaser-game" className="aspect-square w-full max-w-[500px] rounded-lg overflow-hidden shadow-2xl" />;
}
