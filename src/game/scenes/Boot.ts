import { Scene } from 'phaser';

export class Boot extends Scene {
    constructor() {
        super('Boot');
    }

    preload() {
        // Load any minimal assets needed for the preloader (like a logo or progress bar background)
    }

    create() {
        this.scene.start('Preloader');
    }
}
