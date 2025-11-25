import * as Phaser from 'phaser';
import { COLORS, TILE_SIZE } from '../utils/constants';

export default class Player extends Phaser.GameObjects.Container {
  private graphics: Phaser.GameObjects.Graphics;
  public isMoving: boolean = false;
  public gridX: number;
  public gridY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, gridX: number, gridY: number) {
    super(scene, x, y);
    this.gridX = gridX;
    this.gridY = gridY;

    this.graphics = scene.add.graphics();
    this.graphics.fillStyle(COLORS.PLAYER, 1);
    // Draw a slightly smaller square to fit inside the tile
    const padding = 4;
    this.graphics.fillRoundedRect(padding, padding, TILE_SIZE - padding * 2, TILE_SIZE - padding * 2, 4);
    
    this.add(this.graphics);
    scene.add.existing(this);
  }

  moveToTile(gridX: number, gridY: number, onComplete?: () => void) {
    this.isMoving = true;
    this.gridX = gridX;
    this.gridY = gridY;

    this.scene.tweens.add({
      targets: this,
      x: gridX * TILE_SIZE,
      y: gridY * TILE_SIZE,
      duration: 150,
      ease: 'Linear',
      onComplete: () => {
        this.isMoving = false;
        if (onComplete) onComplete();
      },
    });
  }
  
  // Instant move (teleport/spawn)
  setPosition(gridX: number, gridY: number) {
      this.x = gridX * TILE_SIZE;
      this.y = gridY * TILE_SIZE;
      this.gridX = gridX;
      this.gridY = gridY;
      return this;
  }
}
