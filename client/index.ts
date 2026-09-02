// client/index.ts — entry point. Boots a Phaser game with the GameScene.

import Phaser from 'phaser';
import { GameScene } from './GameScene.js';

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

new Phaser.Game(config);
