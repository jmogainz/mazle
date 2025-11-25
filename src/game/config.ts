import * as Phaser from 'phaser';
import MainScene from './scenes/MainScene';
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from './utils/constants';

export const GameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'phaser-game',
  backgroundColor: '#1a1a1a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GRID_WIDTH * TILE_SIZE,
    height: GRID_HEIGHT * TILE_SIZE,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [MainScene],
};
