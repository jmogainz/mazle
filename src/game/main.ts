import { Boot } from './scenes/Boot';
import { Game as MainGame } from './scenes/Game';
import { Preloader } from './scenes/Preloader';
import { AUTO, Game } from 'phaser';

//  Find out more information about the Game Config at:
//  https://newdocs.phaser.io/docs/3.70.0/Phaser.Types.Core.GameConfig
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 400, // Start small, resizing handled by component
    height: 400,
    parent: 'game-container',
    backgroundColor: '#202020',
    pixelArt: true, // Critical for our style
    scene: [
        Boot,
        Preloader,
        MainGame
    ],
    scale: {
        mode: Phaser.Scale.RESIZE, // Or FIT? RESIZE allows us to control container better
        autoCenter: Phaser.Scale.CENTER_BOTH
    }
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
}

export default StartGame;
