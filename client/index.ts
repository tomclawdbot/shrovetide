// client/index.ts — entry point. Boots a Phaser game with the GameScene.

import Phaser from 'phaser';
import { GameScene } from './GameScene.js';
import { installGameShell } from './shell.js';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d1f12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1200,
    height: 800,
  },
  input: {
    activePointers: 3,
    windowEvents: false,
  },
  scene: [GameScene],
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  render: {
    pixelArt: false,
    antialias: true,
  },
};

const game = new Phaser.Game(config);
installGameShell({
  onUnlock: () => {
    try {
      game.sound.unlock();
    } catch {
      /* Phaser sound may not be ready yet */
    }
  },
});
