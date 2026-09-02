// client/GameScene.ts — Phaser scene.
//
// Pure render + input. All game logic lives in /sim.
//
// TICKET 003a changes:
//   - Character colours are resolved EVERY FRAME from world.player.id rather
//     than baked in at sprite-creation time. Previously the gold "you" marker
//     stayed stuck on whichever character you started as, because switching
//     changes world.player.id but nothing ever recoloured the sprites.
//   - Camera now zooms in and uses startFollow with lerp + velocity lead,
//     instead of centerOn() at zoom 1. At zoom 1 the 1200x800 viewport on a
//     2400x1600 map meant the camera clamped within 600px of the left/right
//     edges — and both millstones sit inside that dead zone, so the camera
//     froze during the most important moments of a match.
//   - Ball carrier gets a pulsing halo; the HUD names the carrier.
//   - Palette consolidated into one object; ground gets seeded noise texture,
//     characters get drop shadows and a heading tick, screen gets a vignette.
//
// Deliberately still missing (needs its own ticket):
//   - Strategy-phase click-to-place teammates + role-toggle UI. autoPlaceHome
//     / autoPlaceOpponents in the sim still produce a sensible default
//     formation, so the game is playable start-to-finish without it.
//   - Accumulating trampled-ground texture where the hug has been.

import Phaser from 'phaser';
import {
  createWorld,
  cycleTeammate,
  quickSwitch,
  releasePass,
  startMatch,
  stepWorld,
  type Input,
  type Team,
  type World,
} from '../sim/index.js';
import { EXHAUSTED_SPEED_MULT } from '../sim/stamina.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

const VIEW_W = 1200;
const VIEW_H = 800;
const MINIMAP_W = 200;
const MINIMAP_H = 133;
const MINIMAP_PAD = 12;

/** Base camera zoom. >1 means we see less of the map but the camera can
 *  actually pan almost everywhere instead of clamping at the bounds. */
const CAMERA_BASE_ZOOM = 1.5;
/** How far the camera zooms out when you're deep in a crowd. */
const CAMERA_CROWD_ZOOM_OUT = 0.35;
/** Radius (px) used to measure how crowded it is around you. */
const CROWD_RADIUS = 260;
/** Camera follow smoothing (0..1 per frame; lower = floatier). */
const CAMERA_LERP = 0.09;
/** Seconds of velocity the camera looks ahead by. */
const CAMERA_LEAD = 0.22;
/** Zoom easing per frame. */
const ZOOM_LERP = 0.04;

const PALETTE = {
  bg: 0x0d1f12,
  grass: 0x35603c,
  grassAlt: 0x2f5636,
  grassDark: 0x264a2d,
  building: 0x6b5240,
  buildingEdge: 0x3f2f24,
  water: 0x3f6f96,
  waterEdge: 0x2e5470,
  bridge: 0xa9855f,
  oob: 0x2b2118,
  oobEdge: 0x171009,
  millstone: 0xe8d8a8,
  millstoneEdge: 0x6b5a33,
  teamUp: 0x4f9dd9,
  teamDown: 0xd9614f,
  controlled: 0xffd24a,
  ball: 0xf5f0e6,
  ballEdge: 0x2a2419,
  shadow: 0x000000,
  staminaBg: 0x1a1a1a,
  staminaGood: 0x6ede8a,
  staminaLow: 0xe8705f,
} as const;

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

/** Flattened view of a character for rendering. */
interface RenderChar {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  team: Team;
  controlled: boolean;
}

export class GameScene extends Phaser.Scene {
  private world!: World;
  private inputState!: Input;
  private accumulator = 0;
  private passChargeStartedAt = 0;
  private isPassing = false;
  /** Last non-zero movement direction — used as the default pass aim. */
  private lastAim = { x: 1, y: 0 };

  private keys!: KeyState;
  private bodySprites = new Map<string, Phaser.GameObjects.Arc>();
  private shadowSprites = new Map<string, Phaser.GameObjects.Ellipse>();
  private ballSprite!: Phaser.GameObjects.Arc;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private mapGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private followTarget!: Phaser.GameObjects.Arc;
  private currentZoom = CAMERA_BASE_ZOOM;

  private staminaBg!: Phaser.GameObjects.Rectangle;
  private staminaFill!: Phaser.GameObjects.Rectangle;
  private staminaLabel!: Phaser.GameObjects.Text;
  private carrierLabel!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private minimapBg!: Phaser.GameObjects.Rectangle;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;

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
      passAim: { x: 1, y: 0 },
      goalTap: false,
    };

    // Strategy phase → auto-place + skip directly into playing.
    startMatch(this.world);

    this.cameras.main.setBackgroundColor(PALETTE.bg);
    this.cameras.main.setBounds(0, 0, this.world.map.width, this.world.map.height);

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

    // Camera follows an invisible proxy so switching control doesn't require
    // re-targeting the camera at a different sprite.
    this.followTarget = this.add
      .circle(this.world.player.position.x, this.world.player.position.y, 1, 0xffffff, 0)
      .setVisible(false);
    this.cameras.main.startFollow(this.followTarget, false, CAMERA_LERP, CAMERA_LERP);
    this.cameras.main.setZoom(this.currentZoom);
  }

  // -------------------------------------------------------------------------
  // Static map rendering
  // -------------------------------------------------------------------------

  private drawMapStatic(): void {
    const map = this.world.map;
    this.mapGfx = this.add.graphics().setDepth(0);

    // Field base
    this.mapGfx.fillStyle(PALETTE.grass, 1);
    this.mapGfx.fillRect(0, 0, map.width, map.height);

    // Seeded noise so the turf isn't a flat slab of green. Deterministic —
    // same layout every load, no Math.random.
    let s = 0x9e3779b9;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1400; i++) {
      const x = rand() * map.width;
      const y = rand() * map.height;
      const w = 6 + rand() * 22;
      const h = 3 + rand() * 8;
      this.mapGfx.fillStyle(rand() > 0.5 ? PALETTE.grassAlt : PALETTE.grassDark, 0.35);
      this.mapGfx.fillRect(x, y, w, h);
    }

    // OOB zones (drawn before obstacles/river so those overlay them)
    for (const z of map.outOfBounds) {
      const x = z.position.x - z.width / 2;
      const y = z.position.y - z.height / 2;
      this.mapGfx.fillStyle(PALETTE.oob, 1);
      this.mapGfx.fillRect(x, y, z.width, z.height);
      this.mapGfx.lineStyle(3, PALETTE.oobEdge, 0.9);
      this.mapGfx.strokeRect(x, y, z.width, z.height);
    }

    // River
    const rx = map.river.position.x - map.river.width / 2;
    const ry = map.river.position.y - map.river.height / 2;
    this.mapGfx.fillStyle(PALETTE.water, 1);
    this.mapGfx.fillRect(rx, ry, map.river.width, map.river.height);
    // Bank shading
    this.mapGfx.fillStyle(PALETTE.waterEdge, 0.55);
    this.mapGfx.fillRect(rx, ry, map.river.width, 8);
    this.mapGfx.fillRect(rx, ry + map.river.height - 8, map.river.width, 8);

    // Bridges (drawn over river)
    for (const b of map.bridges) {
      const bx = b.position.x - b.width / 2;
      const by = b.position.y - b.height / 2;
      this.mapGfx.fillStyle(PALETTE.bridge, 1);
      this.mapGfx.fillRect(bx, by, b.width, b.height);
      // Plank lines
      this.mapGfx.lineStyle(1, PALETTE.buildingEdge, 0.35);
      for (let py = by + 8; py < by + b.height; py += 14) {
        this.mapGfx.lineBetween(bx, py, bx + b.width, py);
      }
    }

    // Obstacles (town buildings)
    for (const o of map.obstacles) {
      this.mapGfx.fillStyle(PALETTE.building, 1);
      if ('radius' in o) {
        this.mapGfx.fillCircle(o.position.x, o.position.y, o.radius);
        this.mapGfx.lineStyle(2, PALETTE.buildingEdge, 0.9);
        this.mapGfx.strokeCircle(o.position.x, o.position.y, o.radius);
      } else {
        const ox = o.position.x - o.width / 2;
        const oy = o.position.y - o.height / 2;
        this.mapGfx.fillRect(ox, oy, o.width, o.height);
        this.mapGfx.lineStyle(2, PALETTE.buildingEdge, 0.9);
        this.mapGfx.strokeRect(ox, oy, o.width, o.height);
      }
    }

    // Goals (millstones)
    for (const g of map.goals) {
      const tint = g.team === 0 ? PALETTE.teamUp : PALETTE.teamDown;
      this.mapGfx.lineStyle(4, tint, 0.7);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 30);
      this.mapGfx.fillStyle(PALETTE.millstone, 1);
      this.mapGfx.fillCircle(g.position.x, g.position.y, 18);
      this.mapGfx.lineStyle(3, PALETTE.millstoneEdge, 1);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 18);
      this.mapGfx.fillStyle(PALETTE.millstoneEdge, 1);
      this.mapGfx.fillCircle(g.position.x, g.position.y, 4);
    }

    // Turn-up marker
    this.mapGfx.lineStyle(2, 0xffffff, 0.5);
    this.mapGfx.strokeCircle(map.turnUp.x, map.turnUp.y, 10);

    // Map border
    this.mapGfx.lineStyle(3, 0xffffff, 0.35);
    this.mapGfx.strokeRect(0, 0, map.width, map.height);
  }

  // -------------------------------------------------------------------------
  // Sprites
  // -------------------------------------------------------------------------

  private createSprites(): void {
    // One sprite per character id. Colours are NOT decided here — render()
    // resolves them every frame from the current world.player.id.
    for (const ch of this.collectCharacters()) {
      const shadow = this.add
        .ellipse(ch.x, ch.y + ch.radius * 0.55, ch.radius * 1.9, ch.radius * 0.9, PALETTE.shadow, 0.28)
        .setDepth(1);
      this.shadowSprites.set(ch.id, shadow);

      const body = this.add.circle(ch.x, ch.y, ch.radius, PALETTE.teamUp);
      body.setDepth(2);
      this.bodySprites.set(ch.id, body);
    }

    this.ballShadow = this.add
      .ellipse(
        this.world.ball.position.x,
        this.world.ball.position.y + 6,
        this.world.ball.radius * 1.8,
        this.world.ball.radius * 0.9,
        PALETTE.shadow,
        0.3,
      )
      .setDepth(3);

    this.ballSprite = this.add.circle(
      this.world.ball.position.x,
      this.world.ball.position.y,
      this.world.ball.radius,
      PALETTE.ball,
    );
    this.ballSprite.setStrokeStyle(2, PALETTE.ballEdge);
    this.ballSprite.setDepth(4);

    // World-space overlay for control rings, heading ticks, carrier halo.
    this.markerGfx = this.add.graphics().setDepth(5);
  }

  /** Flatten player + npcs into one render-friendly list. */
  private collectCharacters(): RenderChar[] {
    const p = this.world.player;
    const out: RenderChar[] = [
      {
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        radius: p.radius,
        team: p.team,
        controlled: true,
      },
    ];
    for (const n of this.world.npcs) {
      out.push({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        vx: n.velocity.x,
        vy: n.velocity.y,
        radius: n.radius,
        team: n.team,
        controlled: false,
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  private createHUD(): void {
    const pad = 16;
    this.staminaBg = this.add
      .rectangle(pad, pad, 240, 22, PALETTE.staminaBg)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(10);
    this.staminaFill = this.add
      .rectangle(pad + 2, pad + 2, 236, 18, PALETTE.staminaGood)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(11);
    this.staminaLabel = this.add
      .text(pad, pad + 26, 'Stamina', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setScrollFactor(0)
      .setDepth(11);

    this.carrierLabel = this.add
      .text(pad, pad + 46, 'Ball: loose', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffd24a',
      })
      .setScrollFactor(0)
      .setDepth(11);

    this.timerText = this.add
      .text(VIEW_W / 2, 14, '08:00', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(11);

    this.scoreText = this.add
      .text(VIEW_W / 2, 42, "Up'Ards 0 — 0 Down'Ards", {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(11);

    this.overlayText = this.add
      .text(VIEW_W / 2, VIEW_H / 2, '', {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
        backgroundColor: '#000000cc',
        padding: { x: 20, y: 14 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(13);

    // Minimap (top-right)
    this.minimapBg = this.add
      .rectangle(
        VIEW_W - MINIMAP_W / 2 - MINIMAP_PAD,
        MINIMAP_H / 2 + MINIMAP_PAD,
        MINIMAP_W,
        MINIMAP_H,
        0x000000,
        0.55,
      )
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xffffff, 0.5)
      .setScrollFactor(0)
      .setDepth(10);
    this.minimapGfx = this.add.graphics().setScrollFactor(0).setDepth(11);

    // Vignette — drawn once, sits above the world but below text.
    this.vignetteGfx = this.add.graphics().setScrollFactor(0).setDepth(9);
    this.drawVignette();

    // Hint text bottom-left
    this.add
      .text(
        pad,
        VIEW_H - pad - 20,
        'WASD/Arrows move  ·  Shift sprint  ·  Space pass  ·  E goal-tap  ·  Tab cycle  ·  Q nearest',
        { fontFamily: 'monospace', fontSize: '13px', color: '#dddddd' },
      )
      .setScrollFactor(0)
      .setDepth(11);
  }

  private drawVignette(): void {
    const g = this.vignetteGfx;
    const band = 120;
    const a = 0.5;
    // top
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, a, a, 0, 0);
    g.fillRect(0, 0, VIEW_W, band);
    // bottom
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, a, a);
    g.fillRect(0, VIEW_H - band, VIEW_W, band);
    // left
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, a, 0, a, 0);
    g.fillRect(0, 0, band, VIEW_H);
    // right
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, a, 0, a);
    g.fillRect(VIEW_W - band, 0, band, VIEW_H);
  }

  // -------------------------------------------------------------------------
  // Input handlers
  // -------------------------------------------------------------------------

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
    const moving =
      this.inputState.move.x !== 0 || this.inputState.move.y !== 0;
    // Aim where you're heading; if you're stationary, aim where you last were
    // heading rather than defaulting to north.
    const aim = moving ? { ...this.inputState.move } : { ...this.lastAim };
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
    const text = this.add
      .text(VIEW_W / 2, VIEW_H - 70, `${fromId} → ${toId}`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffd24a',
        backgroundColor: '#000000aa',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(12);
    this.switchToast = { text, expires: this.time.now + 1400 };
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

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
      this.lastAim = { x: mx, y: my };
    }
    this.inputState.move = { x: mx, y: my };
    this.inputState.sprint = k.SHIFT.isDown;
    if (this.inputState.charging) {
      this.inputState.passAim = len > 0 ? { x: mx, y: my } : { ...this.lastAim };
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(): void {
    const chars = this.collectCharacters();
    const p = this.world.player;
    const carrierId = this.world.ball.ownerId;

    // --- Camera -------------------------------------------------------------
    this.followTarget.setPosition(
      p.position.x + p.velocity.x * CAMERA_LEAD,
      p.position.y + p.velocity.y * CAMERA_LEAD,
    );

    let nearby = 0;
    for (const c of chars) {
      if (c.controlled) continue;
      const dx = c.x - p.position.x;
      const dy = c.y - p.position.y;
      if (dx * dx + dy * dy < CROWD_RADIUS * CROWD_RADIUS) nearby += 1;
    }
    const crowdFactor = Math.min(1, nearby / 8);
    const targetZoom = CAMERA_BASE_ZOOM - CAMERA_CROWD_ZOOM_OUT * crowdFactor;
    this.currentZoom += (targetZoom - this.currentZoom) * ZOOM_LERP;
    this.cameras.main.setZoom(this.currentZoom);

    // --- Characters ---------------------------------------------------------
    this.markerGfx.clear();

    for (const c of chars) {
      const body = this.bodySprites.get(c.id);
      const shadow = this.shadowSprites.get(c.id);
      if (!body || !shadow) continue;

      body.setPosition(c.x, c.y);
      shadow.setPosition(c.x, c.y + c.radius * 0.55);

      // Colour is resolved from live state every frame, so it follows control.
      const teamColor = c.team === 0 ? PALETTE.teamUp : PALETTE.teamDown;
      body.setFillStyle(teamColor);
      if (c.controlled) {
        body.setStrokeStyle(4, PALETTE.controlled);
        body.setDepth(3);
      } else {
        body.setStrokeStyle(2, 0x000000, 0.45);
        body.setDepth(2);
      }

      // Heading tick — a short spoke in the direction of travel.
      const speed = Math.hypot(c.vx, c.vy);
      if (speed > 4) {
        const ux = c.vx / speed;
        const uy = c.vy / speed;
        this.markerGfx.lineStyle(3, 0x000000, 0.5);
        this.markerGfx.lineBetween(
          c.x + ux * c.radius * 0.3,
          c.y + uy * c.radius * 0.3,
          c.x + ux * (c.radius + 9),
          c.y + uy * (c.radius + 9),
        );
      }

      // Carrier halo — pulses so a loose ball reads differently from a held one.
      if (carrierId !== null && carrierId === c.id) {
        const pulse = 3 + Math.sin(this.time.now / 130) * 2;
        this.markerGfx.lineStyle(3, PALETTE.ball, 0.9);
        this.markerGfx.strokeCircle(c.x, c.y, c.radius + 7 + pulse);
      }

      // "You" chevron above the controlled character.
      if (c.controlled) {
        const ty = c.y - c.radius - 14;
        this.markerGfx.fillStyle(PALETTE.controlled, 1);
        this.markerGfx.fillTriangle(c.x - 8, ty - 9, c.x + 8, ty - 9, c.x, ty);
      }
    }

    // --- Ball ---------------------------------------------------------------
    const b = this.world.ball;
    this.ballSprite.setPosition(b.position.x, b.position.y);
    this.ballShadow.setPosition(b.position.x, b.position.y + 6);
    if (carrierId === null) {
      // Loose ball: give it a faint ring so it's findable in a scrum.
      const pulse = 2 + Math.sin(this.time.now / 90) * 2;
      this.markerGfx.lineStyle(2, PALETTE.ball, 0.55);
      this.markerGfx.strokeCircle(b.position.x, b.position.y, b.radius + 6 + pulse);
    }

    // --- HUD ----------------------------------------------------------------
    const ratio = p.stamina / p.maxStamina;
    this.staminaFill.setSize(236 * ratio, 18);
    this.staminaFill.setFillStyle(ratio < 0.3 ? PALETTE.staminaLow : PALETTE.staminaGood);
    const exhausted = p.stamina <= 0;
    const speedTag = exhausted ? ` · EXHAUSTED (×${EXHAUSTED_SPEED_MULT})` : '';
    this.staminaLabel.setText(
      `${p.id}  ${Math.round(p.stamina)}/${p.maxStamina}${speedTag}`,
    );

    if (carrierId === null) {
      this.carrierLabel.setText('Ball: loose');
      this.carrierLabel.setColor('#ffffff');
    } else if (carrierId === p.id) {
      this.carrierLabel.setText('Ball: YOU');
      this.carrierLabel.setColor('#ffd24a');
    } else {
      const carrier = this.world.npcs.find((n) => n.id === carrierId);
      const side = carrier && carrier.team === p.team ? 'teammate' : 'opponent';
      this.carrierLabel.setText(`Ball: ${carrierId} (${side})`);
      this.carrierLabel.setColor(
        carrier && carrier.team === p.team ? '#6ede8a' : '#e8705f',
      );
    }

    const t = Math.max(0, this.world.matchTimeRemaining);
    const mm = Math.floor(t / 60).toString().padStart(2, '0');
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);

    this.scoreText.setText(
      `Up'Ards ${this.world.score[0]} — ${this.world.score[1]} Down'Ards`,
    );

    if (this.world.matchState === 'over' && this.world.winState) {
      const ws = this.world.winState;
      let msg: string;
      if (ws.winner === null) {
        msg = 'Draw — time up';
      } else {
        const teamLabel = ws.winner === 0 ? "Up'Ards" : "Down'Ards";
        msg = `${teamLabel} win!\nGoaled by ${ws.scorerId ?? '?'}`;
      }
      this.overlayText.setText(msg);
      this.overlayText.setVisible(true);
    } else {
      this.overlayText.setVisible(false);
    }

    this.renderMinimap(chars);
  }

  private renderMinimap(chars: RenderChar[]): void {
    const g = this.minimapGfx;
    g.clear();
    const map = this.world.map;
    const sx = MINIMAP_W / map.width;
    const sy = MINIMAP_H / map.height;
    const ox = VIEW_W - MINIMAP_W - MINIMAP_PAD;
    const oy = MINIMAP_PAD;

    g.fillStyle(PALETTE.grass, 0.6);
    g.fillRect(ox, oy, MINIMAP_W, MINIMAP_H);
    g.fillStyle(PALETTE.water, 0.85);
    g.fillRect(
      ox,
      oy + (map.river.position.y - map.river.height / 2) * sy,
      MINIMAP_W,
      map.river.height * sy,
    );

    // Millstones
    for (const goal of map.goals) {
      g.fillStyle(PALETTE.millstone, 1);
      g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 3);
    }

    // Everyone else first, so the controlled marker and ball draw on top.
    for (const c of chars) {
      if (c.controlled) continue;
      g.fillStyle(c.team === 0 ? PALETTE.teamUp : PALETTE.teamDown, 0.85);
      g.fillCircle(ox + c.x * sx, oy + c.y * sy, 2.2);
    }

    const b = this.world.ball;
    g.fillStyle(PALETTE.ball, 1);
    g.fillCircle(ox + b.position.x * sx, oy + b.position.y * sy, 3);

    const p = this.world.player;
    g.fillStyle(PALETTE.controlled, 1);
    g.fillCircle(ox + p.position.x * sx, oy + p.position.y * sy, 4);
    g.lineStyle(1, 0x000000, 0.8);
    g.strokeCircle(ox + p.position.x * sx, oy + p.position.y * sy, 4);
  }
}
