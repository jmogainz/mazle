import { Scene } from 'phaser';

export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    preload() {
        // Since we don't have external assets, we will generate textures here in 'create'
        // usually, but for Phaser we can generate textures in 'preload' or 'create'.
        // We'll use Graphics to generate placeholder pixel art.
    }

    create() {
        // Generate textures
        this.generateTextures();
        
        // Move to the main game
        this.scene.start('Game');
    }

    generateTextures() {
        const graphics = this.make.graphics({ x: 0, y: 0 });

        // 1. Floor Tile (Light Gray/Blueish for Ice Gym feel)
        graphics.fillStyle(0xe0e0e0); // Standard floor
        graphics.fillRect(0, 0, 32, 32);
        graphics.lineStyle(2, 0xc0c0c0); // Border
        graphics.strokeRect(0, 0, 32, 32);
        graphics.generateTexture('floor', 32, 32);
        graphics.clear();

        // 2. Wall Tile (Dark Rock)
        graphics.fillStyle(0x4a4a4a);
        graphics.fillRect(0, 0, 32, 32);
        graphics.lineStyle(2, 0x2a2a2a);
        graphics.strokeRect(0, 0, 32, 32);
        // Detail
        graphics.fillStyle(0x3a3a3a);
        graphics.fillRect(4, 4, 10, 10);
        graphics.fillRect(18, 18, 10, 10);
        graphics.generateTexture('wall', 32, 32);
        graphics.clear();

        // 3. Ice Tile (Light Blue, Shiny)
        graphics.fillStyle(0xadd8e6); // Light Blue
        graphics.fillRect(0, 0, 32, 32);
        graphics.lineStyle(2, 0x87ceeb);
        graphics.strokeRect(0, 0, 32, 32);
        // Shine
        graphics.fillStyle(0xffffff);
        graphics.alpha = 0.6;
        graphics.fillRect(4, 4, 8, 8);
        graphics.alpha = 1;
        graphics.generateTexture('ice', 32, 32);
        graphics.clear();

        // 4. Start Tile (Green hint)
        graphics.fillStyle(0x90ee90);
        graphics.fillRect(0, 0, 32, 32);
        graphics.lineStyle(2, 0x006400);
        graphics.strokeRect(0, 0, 32, 32);
        graphics.generateTexture('start', 32, 32);
        graphics.clear();

        // 5. Goal Tile (Red Flag/Carpet)
        graphics.fillStyle(0xff6b6b);
        graphics.fillRect(0, 0, 32, 32);
        graphics.generateTexture('goal', 32, 32);
        graphics.clear();

        // 6. Ledge (Down)
        graphics.fillStyle(0xe0e0e0); // Floor background
        graphics.fillRect(0, 0, 32, 32);
        // The ledge drop
        graphics.fillStyle(0x888888);
        graphics.fillRect(0, 24, 32, 8);
        graphics.lineStyle(2, 0x555555);
        graphics.beginPath();
        graphics.moveTo(0, 24);
        graphics.lineTo(32, 24);
        graphics.strokePath();
        graphics.generateTexture('ledge_down', 32, 32);
        graphics.clear();

        // 7. Player (Red Hat Character)
        graphics.fillStyle(0xff0000); // Hat
        graphics.fillRect(8, 4, 16, 8);
        graphics.fillStyle(0xffccaa); // Face
        graphics.fillRect(8, 12, 16, 8);
        graphics.fillStyle(0x0000cc); // Shirt
        graphics.fillRect(6, 20, 20, 12);
        graphics.generateTexture('player', 32, 32);
        graphics.clear();
    }
}
