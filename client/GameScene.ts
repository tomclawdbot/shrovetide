// client/GameScene.ts — Phaser scene for TICKET 002.
//
// Pure render + input. All game logic lives in /sim.
//
// New in v1:
//   - Camera follows the controlled character (not the centre of the field).
//   - Minimap HUD (top-right) shows all 14 characters + ball.
//   - TAB cycles teammates, Q quick-switches to nearest teammate.
//   - E (rising edge) is the goal-tap press.
//   - Match state overlays: placement hints, in-play HUD, win screen.
//   - Map rendering: obstacles, river, bridges, OOB zones, goals, turn-up.
//
// Deliberately skipped for v1 (out of scope of this rewrite, can be TICKET 003):
//   - Strategy-phase click-to-place teammates + role-toggle UI.
//     (autoPlaceHome / autoPlaceOpponents in sim still produce a sensible
//     default formation, so the game is playable start-to-finish without it.)

import Phaser from 'phaser';
import {
  ASHBOURNE_TOWN,
  createWorld,
  cycleTeammate,
  endMatch,
  quickSwitch,
  releasePass,
  startMatch,
  stepWorld,
  type Input,
  type World,
} from '../sim/index.js';
import { EXHAUSTED_SPEED_MULT } from '../sim/stamina.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

const VIEW_W = 1200;
const VIEW_H = 800;
const MINIMAP_W = 180;
const MINIMAP_H = 120;
const MINIMAP_PAD = 12;

const COLOR_FIELD = 0x2d6a3a;
const COLOR_FIELD_LINE = 0xffffff;
const COLOR_OBSTACLE = 0x6b4f3a;
const COLOR_RIVER = 0x4a86c5;
const COLOR_BRIDGE = 0xb5936a;
const COLOR_OOB = 0x4a3322;
const COLOR_GOAL = 0xfacc15;
const COLOR_PLAYER = 0x60a5fa;
const COLOR_NPC_TEAM_0 = 0x4ade80;
const COLOR_NPC_TEAM_1 = 0xf87171;
const COLOR_BALL = 0xffffff;
const COLOR_BG = 0x0d1f12;
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
  E: Phaser.Input.Keyboard.Key;
  TAB: Phaser.Input.Keyboard.Key;
  Q: Phaser.Input.Keyboard.Key;
}

export class GameScene extends Phaser.Scene {
  private world!: World;
  private inputState!: Input;
  private accumulator = 0;
  private passChargeStartedAt = 0;
  private isPassing = false;

  private keys!: KeyState;
  private sprites = new Map<string, Phaser.GameObjects.Arc>();
  private mapGfx!: Phaser.GameObjects.Graphics;

  private staminaBg!: Phaser.GameObjects.Rectangle;
  private staminaFill!: Phaser.GameObjects.Rectangle;
  private staminaLabel!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private minimapBg!: Phaser.GameObjects.Rectangle;
  private minimapGfx!: Phaser.GameObjects.Graphics;

  private switchToast: { text: Phaser.GameObjects.Text; expires: number } | null = null;

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
      goalTap: false,
    };

    // Strategy phase → auto-place + skip directly into playing.
    // (Full strategy-phase click-to-place UI is TICKET 003.)
    startMatch(this.world);

    this.cameras.main.setBackgroundColor(COLOR_BG.toString(16).padStart(6, '0'));
    this.cameras.main.setBounds(0, 0, this.world.map.width, this.world.map.height);
    this.cameras.main.setViewport(0, 0, VIEW_W, VIEW_H);

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
      E: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      TAB: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
      Q: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
    };

    kb.on('keydown-SPACE', this.handlePassStart);
    kb.on('keyup-SPACE', this.handlePassRelease);
    kb.on('keydown-E', this.handleGoalTap);
    kb.on('keydown-TAB', this.handleCycle);
    kb.on('keydown-Q', this.handleQuickSwitch);

    this.drawMapStatic();
    this.createSprites();
    this.createHUD();
  }

  private drawMapStatic(): void {
    const map = this.world.map;
    this.mapGfx = this.add.graphics().setDepth(0);

    // Field base
    this.mapGfx.fillStyle(COLOR_FIELD, 1);
    this.mapGfx.fillRect(0, 0, map.width, map.height);

    // OOB zones (drawn first so obstacles/river overlay them)
    for (const z of map.outOfBounds) {
      this.mapGfx.fillStyle(COLOR_OOB, 1);
      this.mapGfx.fillRect(
        z.position.x - z.width / 2,
        z.position.y - z.height / 2,
        z.width,
        z.height,
      );
      this.mapGfx.lineStyle(1, 0x000000, 0.6);
      this.mapGfx.strokeRect(
        z.position.x - z.width / 2,
        z.position.y - z.height / 2,
        z.width,
        z.height,
      );
    }

    // River
    this.mapGfx.fillStyle(COLOR_RIVER, 1);
    this.mapGfx.fillRect(
      map.river.position.x - map.river.width / 2,
      map.river.position.y - map.river.height / 2,
      map.river.width,
      map.river.height,
    );

    // Bridges (drawn over river)
    for (const b of map.bridges) {
      this.mapGfx.fillStyle(COLOR_BRIDGE, 1);
      this.mapGfx.fillRect(
        b.position.x - b.width / 2,
        b.position.y - b.height / 2,
        b.width,
        b.height,
      );
    }

    // Obstacles (town buildings)
    for (const o of map.obstacles) {
      this.mapGfx.fillStyle(COLOR_OBSTACLE, 1);
      if ('radius' in o) {
        this.mapGfx.fillCircle(o.position.x, o.position.y, o.radius);
      } else {
        this.mapGfx.fillRect(
          o.position.x - o.width / 2,
          o.position.y - o.height / 2,
          o.width,
          o.height,
        );
      }
    }

    // Goals (millstones)
    for (const g of map.goals) {
      this.mapGfx.fillStyle(COLOR_GOAL, 1);
      this.mapGfx.fillCircle(g.position.x, g.position.y, 14);
      this.mapGfx.lineStyle(2, 0x000000, 0.8);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 14);
    }

    // Turn-up marker
    this.mapGfx.fillStyle(0xffffff, 0.7);
    this.mapGfx.fillCircle(map.turnUp.x, map.turnUp.y, 4);

    // Map border
    this.mapGfx.lineStyle(2, COLOR_FIELD_LINE, 0.5);
    this.mapGfx.strokeRect(0, 0, map.width, map.height);
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
    this.sprites.set(this.world.player.id, playerSprite);

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
    this.staminaBg = this.add.rectangle(pad, pad, 220, 22, COLOR_STAMINA_BG).setOrigin(0, 0).setScrollFactor(0).setDepth(10);
    this.staminaFill = this.add.rectangle(pad + 2, pad + 2, 216, 18, COLOR_STAMINA_GOOD).setOrigin(0, 0).setScrollFactor(0).setDepth(11);
    this.staminaLabel = this.add.text(pad, pad + 26, 'Stamina', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(11);

    this.timerText = this.add.text(VIEW_W / 2, 14, '08:00', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11);

    this.scoreText = this.add.text(VIEW_W / 2, 40, 'Up 0 — 0 Down', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11);

    this.overlayText = this.add.text(VIEW_W / 2, VIEW_H / 2, '', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
      align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 16, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(12);

    // Minimap (top-right)
    this.minimapBg = this.add.rectangle(
      VIEW_W - MINIMAP_W / 2 - MINIMAP_PAD,
      MINIMAP_H / 2 + MINIMAP_PAD,
      MINIMAP_W,
      MINIMAP_H,
      0x000000,
      0.55,
    ).setOrigin(0.5).setStrokeStyle(1, 0xffffff, 0.5).setScrollFactor(0).setDepth(10);
    this.minimapGfx = this.add.graphics().setScrollFactor(0).setDepth(11);

    // Hint text bottom-left
    this.add.text(pad, VIEW_H - pad - 36,
      'WASD/Arrows move  ·  Shift sprint  ·  Space pass  ·  E goal-tap  ·  Tab/Q switch',
      { fontFamily: 'monospace', fontSize: '13px', color: '#dddddd' },
    ).setScrollFactor(0).setDepth(11);
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

  private handleGoalTap = (): void => {
    // Rising-edge tap — only consumed on the step where the key first goes down.
    this.inputState.goalTap = true;
  };

  private handleCycle = (): void => {
    if (this.world.matchState !== 'playing') return;
    const prevId = this.world.player.id;
    const newId = cycleTeammate(this.world);
    if (newId) this.flashSwitch(prevId, newId);
  };

  private handleQuickSwitch = (): void => {
    if (this.world.matchState !== 'playing') return;
    const prevId = this.world.player.id;
    const newId = quickSwitch(this.world);
    if (newId) this.flashSwitch(prevId, newId);
  };

  private flashSwitch(fromId: string, toId: string): void {
    if (this.switchToast) this.switchToast.text.destroy();
    const text = this.add.text(VIEW_W / 2, VIEW_H - 60, `Switch: ${fromId} → ${toId}`, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(13);
    this.switchToast = { text, expires: this.time.now + 1500 };
  }

  override update(_time: number, deltaMs: number): void {
    this.readInput();

    this.accumulator += deltaMs / 1000;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepWorld(this.world, this.inputState, FIXED_DT);
      // goalTap is rising-edge — consume it after one step.
      this.inputState.goalTap = false;
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;

    // Switch toast expiry
    if (this.switchToast && this.time.now > this.switchToast.expires) {
      this.switchToast.text.destroy();
      this.switchToast = null;
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
    if (this.inputState.charging) this.inputState.passAim = { x: mx, y: my };
  }

  private render(): void {
    // Camera follow controlled player
    this.cameras.main.centerOn(this.world.player.position.x, this.world.player.position.y);

    // Update sprite positions
    const playerSprite = this.sprites.get(this.world.player.id);
    if (playerSprite) playerSprite.setPosition(this.world.player.position.x, this.world.player.position.y);
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
    const ballTag = this.world.player.hasBall ? ' · BALL' : '';
    const speedTag = exhausted ? ` · EXHAUSTED (×${EXHAUSTED_SPEED_MULT})` : '';
    this.staminaLabel.setText(
      `Stamina ${Math.round(this.world.player.stamina)}/${this.world.player.maxStamina}${ballTag}${speedTag}`,
    );

    // Timer
    const t = Math.max(0, this.world.matchTimeRemaining);
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);

    // Score
    this.scoreText.setText(`Up ${this.world.score[0]} — ${this.world.score[1]} Down`);

    // Overlay: end-of-match banner
    if (this.world.matchState === 'over' && this.world.winState) {
      const ws = this.world.winState;
      let msg: string;
      if (ws.winner === null) msg = `Draw — time up`;
      else {
        const teamLabel = ws.winner === 0 ? 'Up\'Ards' : 'Down\'Ards';
        const scorerLabel = ws.scorerId ?? '?';
        msg = `${teamLabel} win!\nScorer: ${scorerLabel}`;
      }
      this.overlayText.setText(msg);
      this.overlayText.setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }

    // Minimap
    this.renderMinimap();
  }

  private renderMinimap(): void {
    const g = this.minimapGfx;
    g.clear();
    const map = this.world.map;
    const sx = MINIMAP_W / map.width;
    const sy = MINIMAP_H / map.height;
    const ox = VIEW_W - MINIMAP_W - MINIMAP_PAD;
    const oy = MINIMAP_PAD;

    // Map background tint
    g.fillStyle(COLOR_FIELD, 0.6);
    g.fillRect(ox, oy, MINIMAP_W, MINIMAP_H);
    // River on minimap
    g.fillStyle(COLOR_RIVER, 0.8);
    g.fillRect(ox, oy + (map.river.position.y - map.river.height / 2) * sy, MINIMAP_W, map.river.height * sy);

    // All characters
    const draw = (x: number, y: number, color: number, r = 2.5) => {
      g.fillStyle(color, 1);
      g.fillCircle(ox + x * sx, oy + y * sy, r);
    };
    // Controlled player
    draw(this.world.player.position.x, this.world.player.position.y, COLOR_PLAYER, 3.5);
    // Teammates
    for (const npc of this.world.npcs) {
      if (npc.team === this.world.player.team) {
        draw(npc.position.x, npc.position.y, COLOR_NPC_TEAM_0, 2.5);
      } else {
        draw(npc.position.x, npc.position.y, COLOR_NPC_TEAM_1, 2.5);
      }
    }
    // Ball
    draw(this.world.ball.position.x, this.world.ball.position.y, COLOR_BALL, 2);
  }
}

// (no unused aliases — staminaBg uses Phaser.GameObjects.Rectangle directly)