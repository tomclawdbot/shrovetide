// client/GameScene.ts — Phaser scene. Pure render + input.
// All game logic lives in /sim; this file reads sim state and
// sends inputs back into it.

import Phaser from 'phaser';
import {
  createWorld,
  stepWorld,
  releasePass,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  type Input,
  type World,
} from '../sim/index.js';
import { EXHAUSTED_SPEED_MULT } from '../sim/stamina.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

const COLOR_FIELD = 0x2d6a3a;
const COLOR_FIELD_LINE = 0xffffff;
const COLOR_PLAYER = 0x60a5fa;
const COLOR_NPC_TEAM_0 = 0x4ade80;
const COLOR_NPC_TEAM_1 = 0xf87171;
const COLOR_BALL = 0xffffff;
const COLOR_STAMINA_BG = 0x222222;
const COLOR_STAMINA_GOOD = 0x4ade80;
const COLOR_STAMINA_LOW = 0xf87171;

interface KeyState {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
  UP: Phaser.Input.Keyboard.Key;
  DOWN: Phaser.Input.Keyboard.Key;
  LEFT: Phaser.Input.Keyboard.Key;
  RIGHT: Phaser.Input.Keyboard.Key;
  SHIFT: Phaser.Input.Keyboard.Key;
  SPACE: Phaser.Input.Keyboard.Key;
}

export class GameScene extends Phaser.Scene {
  private world!: World;
  private inputState!: Input;
  private accumulator = 0;
  private passChargeStartedAt = 0;
  private isPassing = false;

  private keys!: KeyState;
  private sprites = new Map<string, Phaser.GameObjects.Arc>();
  private staminaBg!: Phaser.GameObjects.Rectangle;
  private staminaFill!: Phaser.GameObjects.Rectangle;
  private staminaLabel!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.world = createWorld();
    this.inputState = {
      move: { x: 0, y: 0 },
      sprint: false,
      charging: false,
      passAim: { x: 0, y: -1 },
    };

    this.drawField();

    const kb = this.input.keyboard!;
    this.keys = {
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      DOWN: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      SHIFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    kb.on('keydown-SPACE', this.handlePassStart);
    kb.on('keyup-SPACE', this.handlePassRelease);

    this.createSprites();
    this.createHUD();
  }

  private drawField(): void {
    this.add.rectangle(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, FIELD_WIDTH, FIELD_HEIGHT, COLOR_FIELD);
    this.add.rectangle(FIELD_WIDTH / 2, 0, 2, FIELD_HEIGHT, COLOR_FIELD_LINE);
    this.add.rectangle(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 160, 2, COLOR_FIELD_LINE);
    this.add.rectangle(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 2, 160, COLOR_FIELD_LINE);
    const ring = this.add.circle(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 80, COLOR_FIELD);
    ring.setStrokeStyle(2, COLOR_FIELD_LINE);
    this.add.rectangle(40, 40, 80, 100, COLOR_FIELD).setStrokeStyle(2, COLOR_FIELD_LINE);
    this.add.rectangle(FIELD_WIDTH - 40, 40, 80, 100, COLOR_FIELD).setStrokeStyle(2, COLOR_FIELD_LINE);
  }

  private createSprites(): void {
    const playerSprite = this.add.circle(
      this.world.player.position.x,
      this.world.player.position.y,
      this.world.player.radius,
      COLOR_PLAYER,
    );
    playerSprite.setStrokeStyle(3, 0xffffff);
    playerSprite.setDepth(2);
    this.sprites.set('player', playerSprite);

    for (const npc of this.world.npcs) {
      const color = npc.team === 0 ? COLOR_NPC_TEAM_0 : COLOR_NPC_TEAM_1;
      const sprite = this.add.circle(npc.position.x, npc.position.y, npc.radius, color);
      sprite.setStrokeStyle(1, 0xffffff);
      sprite.setDepth(1);
      this.sprites.set(npc.id, sprite);
    }

    const ballSprite = this.add.circle(
      this.world.ball.position.x,
      this.world.ball.position.y,
      this.world.ball.radius,
      COLOR_BALL,
    );
    ballSprite.setStrokeStyle(1, 0x000000);
    ballSprite.setDepth(3);
    this.sprites.set('ball', ballSprite);
  }

  private createHUD(): void {
    const pad = 16;
    this.staminaBg = this.add.rectangle(pad, pad, 220, 22, COLOR_STAMINA_BG).setOrigin(0, 0).setDepth(10);
    this.staminaFill = this.add.rectangle(pad + 2, pad + 2, 216, 18, COLOR_STAMINA_GOOD).setOrigin(0, 0).setDepth(11);
    this.staminaLabel = this.add.text(pad, pad + 26, 'Stamina', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setDepth(11);

    this.hintText = this.add.text(pad, FIELD_HEIGHT - pad - 18,
      'WASD/Arrows move  ·  Shift sprint (with ball)  ·  Space hold+release pass',
      { fontFamily: 'monospace', fontSize: '14px', color: '#dddddd' }).setDepth(11);
  }

  private handlePassStart = (): void => {
    if (this.isPassing) return;
    if (!this.world.player.hasBall) return;
    this.isPassing = true;
    this.passChargeStartedAt = this.time.now;
    this.inputState.charging = true;
  };

  private handlePassRelease = (): void => {
    if (!this.isPassing) return;
    const chargeSeconds = (this.time.now - this.passChargeStartedAt) / 1000;
    const aim =
      this.inputState.move.x !== 0 || this.inputState.move.y !== 0
        ? { ...this.inputState.move }
        : { x: 0, y: -1 };
    releasePass(this.world, aim, chargeSeconds);
    this.isPassing = false;
    this.inputState.charging = false;
  };

  override update(_time: number, deltaMs: number): void {
    this.readInput();

    // Fixed-timestep accumulator. Clamp to MAX_STEPS_PER_FRAME to avoid
    // spiral-of-death if the tab was backgrounded.
    this.accumulator += deltaMs / 1000;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepWorld(this.world, this.inputState, FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) {
      this.accumulator = 0;
    }

    this.render();
  }

  private readInput(): void {
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k.W.isDown || k.UP.isDown) my -= 1;
    if (k.S.isDown || k.DOWN.isDown) my += 1;
    if (k.A.isDown || k.LEFT.isDown) mx -= 1;
    if (k.D.isDown || k.RIGHT.isDown) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0) {
      mx /= len;
      my /= len;
    }
    this.inputState.move = { x: mx, y: my };
    this.inputState.sprint = k.SHIFT.isDown;
    if (this.inputState.charging) {
      this.inputState.passAim = { x: mx, y: my };
    }
  }

  private render(): void {
    const playerSprite = this.sprites.get('player');
    if (playerSprite) {
      playerSprite.setPosition(this.world.player.position.x, this.world.player.position.y);
    }
    for (const npc of this.world.npcs) {
      const sprite = this.sprites.get(npc.id);
      if (sprite) sprite.setPosition(npc.position.x, npc.position.y);
    }
    const ballSprite = this.sprites.get('ball');
    if (ballSprite) ballSprite.setPosition(this.world.ball.position.x, this.world.ball.position.y);

    // Stamina bar
    const ratio = this.world.player.stamina / this.world.player.maxStamina;
    this.staminaFill.setSize(216 * ratio, 18);
    this.staminaFill.setFillStyle(ratio < 0.3 ? COLOR_STAMINA_LOW : COLOR_STAMINA_GOOD);

    const exhausted = this.world.player.stamina <= 0;
    const speedTag = exhausted ? ` · EXHAUSTED (×${EXHAUSTED_SPEED_MULT})` : '';
    const ballTag = this.world.player.hasBall ? ' · BALL' : '';
    this.staminaLabel.setText(
      `Stamina ${Math.round(this.world.player.stamina)}/${this.world.player.maxStamina}${ballTag}${speedTag}`,
    );
  }
}
