// client/GameScene.ts — Phaser scene. Pure render + input. All game logic lives in /sim.
//
// First-run: HUD lives on a zoom-1 camera (main zoom was swallowing scrollFactor(0)
// overlays). Kickoff is title → ~20s place-your-people → whistle. Who-am-I follows
// control. Scoring has HOLD THE STONE + pips + hit-stop.
// Phone (Chrome iOS / WebKit): DOM stick + kick/switch (see touch.ts); keyboard still drives Input.move.

import Phaser from 'phaser';
import {
  createWorld,
  cycleTeammate,
  isBuilding,
  isCarrierAtOpponentGoal,
  moveControlled,
  opponentGoalFor,
  placeTeammate,
  quickSwitch,
  releasePass,
  startMatch,
  stepWorld,
  switchControl,
  teammateAtPoint,
  npcRipContest,
  wrestleMode,
  type Input,
  type Obstacle,
  type Team,
  type World,
} from '../sim/index.js';
import { canvasSafePad, unlockAudio } from './shell.js';
import { TouchControls } from './touch.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 2;

const VIEW_W = 1200;
const VIEW_H = 800;
const MINIMAP_W = 200;
const MINIMAP_H = 133;
const MINIMAP_PAD = 12;

const CAMERA_BASE_ZOOM = 1.5;
const CAMERA_CROWD_ZOOM_OUT = 0.35;
const CAMERA_ZOOM_MIN = 0.32;
const CAMERA_ZOOM_MAX = 2.35;
const CAMERA_PAN_SPEED = 520;
const CAMERA_DRAG_PX = 14;
const CROWD_RADIUS = 260;
const CAMERA_LEAD = 0.08;
const ZOOM_LERP = 0.04;
const PLACE_SECONDS = 20;
const KICKOFF_SECONDS = 3;
const PLACE_SPEED = 220;
const TEACH_WINDOW_MS = 30_000;

const PALETTE = {
  bg: 0x1a140c,
  grass: 0x3a4a28,
  grassAlt: 0x2f3e20,
  grassDark: 0x243218,
  mud: 0x5a3d28,
  mudDark: 0x3d291a,
  building: 0x6a4c36,
  buildingRoof: 0x3b2418,
  buildingEdge: 0x1a100a,
  pubTimber: 0x4a3020,
  pubRoof: 0x2e1c14,
  pubFascia: 0x6b2a22,
  pubSign: 0xc4a35a,
  shopBrick: 0x7a5340,
  shopFascia: 0x8a6844,
  shopAwning: 0x5a2a28,
  shopAwningAlt: 0xd8c4a0,
  timberBeam: 0x2a1810,
  brickLine: 0x5a382c,
  chimney: 0x4a3028,
  cobble: 0x6a5a48,
  church: 0x6e6a62,
  churchRoof: 0x3a3834,
  window: 0x2a4050,
  windowLite: 0x8ab0c4,
  door: 0x2a1810,
  water: 0x2d4a5c,
  waterEdge: 0x1a3040,
  hedge: 0x1c3a16,
  hedgeLeaf: 0x3a6a28,
  hedgeEdge: 0x0c1a0a,
  bridge: 0x8a6844,
  oob: 0x2a2218,
  oobEdge: 0x120e0a,
  millstone: 0xe4d4a8,
  millstoneEdge: 0x4a3a1c,
  teamUp: 0x3d6eaa,
  teamDown: 0xb43c2e,
  youRing: 0xfff6e8,
  ball: 0xf3ead4,
  ballEdge: 0x1a140c,
  shadow: 0x000000,
  staminaBg: 0x1a120c,
  staminaGood: 0xc4a35a,
  staminaLow: 0xc44a32,
} as const;

const FONT = '"Palatino Linotype", Palatino, Georgia, serif';

type Flow = 'title' | 'placing' | 'playing';
type Teach = 'move' | 'ball' | 'kick' | 'sprint' | 'goal' | 'done';

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
  F: Phaser.Input.Keyboard.Key;
  C: Phaser.Input.Keyboard.Key;
  HOME: Phaser.Input.Keyboard.Key;
  PLUS: Phaser.Input.Keyboard.Key;
  MINUS: Phaser.Input.Keyboard.Key;
  OPEN_BRACKET: Phaser.Input.Keyboard.Key;
  CLOSED_BRACKET: Phaser.Input.Keyboard.Key;
}

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
  private lastAim = { x: 1, y: 0 };

  private keys: KeyState | null = null;
  private touch: TouchControls | null = null;
  private hudPad = { l: 16, r: 16, t: 16, b: 16 };
  private bodySprites = new Map<string, Phaser.GameObjects.Arc>();
  private shadowSprites = new Map<string, Phaser.GameObjects.Ellipse>();
  private ballSprite!: Phaser.GameObjects.Arc;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private mapGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private followZoom = CAMERA_BASE_ZOOM;
  private userZoom = 1;
  private currentZoom = CAMERA_BASE_ZOOM;
  private camFollow = true;
  private camLook = { x: 0, y: 0 };
  private panPointerId: number | null = null;
  private panLast = { x: 0, y: 0 };
  private panDragging = false;
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };

  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private hudObjs: Phaser.GameObjects.GameObject[] = [];
  private worldObjs: Phaser.GameObjects.GameObject[] = [];

  private staminaBg!: Phaser.GameObjects.Rectangle;
  private staminaFill!: Phaser.GameObjects.Rectangle;
  private staminaLabel!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private overlayText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private titleCard!: Phaser.GameObjects.Text;
  private againBtn!: Phaser.GameObjects.Text;
  private pipGfx!: Phaser.GameObjects.Graphics;
  private minimapBg!: Phaser.GameObjects.Rectangle;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;
  private followBtn!: Phaser.GameObjects.Text;

  private flow: Flow = 'title';
  private placeLeft = 0;
  private placeTargetId: string | null = null;
  private spaceReady = false;
  private eatPointer = false;
  private teach: Teach = 'move';
  private playStartedAt = 0;
  private hitStopLeft = 0;
  private lastGoalingTaps = 0;
  private scoredJuice = false;
  private feedbackUntil = 0;
  private kickoffLeft = 0;
  private lastThumpAt = 0;
  private lastWall = 0;

  constructor() {
    super('GameScene');
  }

  /** Wall clock. Phaser game time can race and skip the kickoff beat. */
  private now(): number {
    return performance.now();
  }

  create(): void {
    this.world = createWorld();
    this.inputState = {
      move: { x: 0, y: 0 },
      sprint: false,
      charging: false,
      passAim: { x: 1, y: 0 },
      goalTap: false,
      rip: false,
      wriggle: false,
    };
    this.flow = 'title';
    this.teach = 'move';
    this.scoredJuice = false;
    this.lastGoalingTaps = 0;
    this.placeTargetId = this.world.npcs.find((n) => n.team === this.world.player.team)?.id ?? null;

    this.cameras.main.setBackgroundColor(PALETTE.bg);
    this.cameras.main.setSize(VIEW_W, VIEW_H);
    this.cameras.main.setBounds(0, 0, this.world.map.width, this.world.map.height);

    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('TAB,SPACE,E,Q,F,W,A,S,D,SHIFT,C');
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
        F: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F),
        C: kb.addKey(Phaser.Input.Keyboard.KeyCodes.C),
        HOME: kb.addKey(Phaser.Input.Keyboard.KeyCodes.HOME),
        PLUS: kb.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS),
        MINUS: kb.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS),
        OPEN_BRACKET: kb.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET),
        CLOSED_BRACKET: kb.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET),
      };
      kb.on('keydown-SPACE', this.handleSpace);
      kb.on('keyup-SPACE', this.handlePassRelease);
      kb.on('keydown-E', this.handleGoalTap);
      kb.on('keydown-TAB', this.handleTab);
      kb.on('keydown-Q', this.handleQuickSwitch);
      kb.on('keydown-C', this.handleFollowToggle);
      kb.on('keydown-HOME', this.returnToFollow);
    }

    this.input.on('pointerdown', this.handlePointerDown);
    this.input.on('pointermove', this.handlePointerMove);
    this.input.on('pointerup', this.handlePointerUp);
    this.input.on('pointerupoutside', this.handlePointerUp);
    this.input.on('wheel', this.handleWheel);

    this.touch = new TouchControls({
      onKickDown: () => this.beginTouchKick(),
      onKickUp: () => this.handlePassRelease(),
      onSwitch: () => this.handleQuickSwitch(),
      onReady: () => this.whistle(),
      onGoal: () => this.handleGoalTap(),
      onFollow: () => this.returnToFollow(),
    });
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layoutHud, this);
      window.visualViewport?.removeEventListener('resize', this.layoutHud);
      this.touch?.dispose();
      this.touch = null;
    });
    this.scale.on('resize', this.layoutHud, this);
    window.visualViewport?.addEventListener('resize', this.layoutHud);

    this.drawMapStatic();
    this.createSprites();
    this.createHUD();

    this.bindCameras();
    this.pinCam(this.world.player.position.x, this.world.player.position.y, this.currentZoom);

    this.setMatchHud(false);
    this.layoutHud();
    this.syncTouchFlow();
  }

  private syncTouchFlow(): void {
    if (!this.touch) return;
    const flow =
      this.world.matchState === 'over'
        ? 'over'
        : this.flow === 'title'
          ? 'title'
          : this.flow === 'placing'
            ? 'placing'
            : 'playing';
    this.touch.setFlow(flow);
  }

  private layoutHud = (): void => {
    this.hudPad = canvasSafePad(VIEW_W, VIEW_H);
    const { l, r, t, b } = this.hudPad;
    this.staminaBg?.setPosition(l, t);
    this.staminaFill?.setPosition(l + 2, t + 2);
    this.staminaLabel?.setPosition(l, t + 26);
    this.timerText?.setPosition(VIEW_W / 2, t);
    this.scoreText?.setPosition(VIEW_W / 2, t + 30);
    this.minimapBg?.setPosition(
      VIEW_W - MINIMAP_W / 2 - Math.max(MINIMAP_PAD, r),
      MINIMAP_H / 2 + Math.max(MINIMAP_PAD, t),
    );
    const promptY = VIEW_H - Math.max(56, b + 36);
    this.promptText?.setPosition(VIEW_W / 2, promptY);
    this.followBtn?.setPosition(VIEW_W / 2, t + 64);
  };

  private adoptWorld(obj: Phaser.GameObjects.GameObject): void {
    this.worldObjs.push(obj);
    this.hudCam?.ignore(obj);
  }

  private adoptHud<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.hudObjs.push(obj);
    this.cameras.main.ignore(obj);
    return obj;
  }

  private bindCameras(): void {
    this.hudCam = this.cameras.add(0, 0, VIEW_W, VIEW_H, false, 'hud');
    this.hudCam.setScroll(0, 0);
    this.hudCam.setZoom(1);
    this.cameras.main.ignore(this.hudObjs);
    this.hudCam.ignore(this.worldObjs);
  }

  private punchCamera(): void {
    this.returnToFollow();
    this.followZoom = CAMERA_BASE_ZOOM + 0.22;
    this.currentZoom = this.clampedZoom();
    this.pinCam(this.world.player.position.x, this.world.player.position.y, this.currentZoom);
  }

  /**
   * Put world point (x,y) in the middle of the screen.
   * Raw scroll — centerOn + setBounds + shake left the body off-screen.
   */
  private pinCam(x: number, y: number, zoom: number): void {
    const cam = this.cameras.main;
    const z = Math.max(CAMERA_ZOOM_MIN, zoom);
    cam.setZoom(z);
    cam.scrollX = x - VIEW_W / (2 * z);
    cam.scrollY = y - VIEW_H / (2 * z);
  }

  private camCenter(): { x: number; y: number } {
    const z = Math.max(CAMERA_ZOOM_MIN, this.cameras.main.zoom);
    return {
      x: this.cameras.main.scrollX + VIEW_W / (2 * z),
      y: this.cameras.main.scrollY + VIEW_H / (2 * z),
    };
  }

  private clampedZoom(): number {
    return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, this.followZoom * this.userZoom));
  }

  private nudgeUserZoom(factor: number): void {
    this.userZoom = Math.min(
      CAMERA_ZOOM_MAX / Math.max(0.2, this.followZoom),
      Math.max(CAMERA_ZOOM_MIN / Math.max(0.2, this.followZoom), this.userZoom * factor),
    );
    this.currentZoom = this.clampedZoom();
  }

  private breakFollow(): void {
    if (this.camFollow) {
      this.camLook = this.camCenter();
      this.camFollow = false;
    }
  }

  private returnToFollow = (): void => {
    this.camFollow = true;
    this.camLook.x = this.world.player.position.x;
    this.camLook.y = this.world.player.position.y;
    this.syncFollowHud();
  };

  private handleFollowToggle = (): void => {
    if (this.flow === 'title') return;
    if (this.camFollow) this.breakFollow();
    else this.returnToFollow();
    this.syncFollowHud();
  };

  private panLook(dx: number, dy: number): void {
    this.breakFollow();
    const map = this.world.map;
    this.camLook.x = Math.min(map.width, Math.max(0, this.camLook.x + dx));
    this.camLook.y = Math.min(map.height, Math.max(0, this.camLook.y + dy));
    this.syncFollowHud();
  }

  private panByScreen(sx: number, sy: number): void {
    const z = Math.max(CAMERA_ZOOM_MIN, this.currentZoom);
    this.panLook(sx / z, sy / z);
  }

  private trackPlayer(_snap: boolean): void {
    const p = this.world.player;
    this.camLook.x = p.position.x + p.velocity.x * CAMERA_LEAD;
    this.camLook.y = p.position.y + p.velocity.y * CAMERA_LEAD;
    this.pinCam(this.camLook.x, this.camLook.y, this.currentZoom);
  }

  /** Freeze-frame beat: you + their millstone in the same shot. */
  private frameKickoff(): void {
    const p = this.world.player;
    const g = opponentGoalFor(p.team, this.world.map);
    const pad = 180;
    const minX = Math.min(p.position.x, g.x) - pad;
    const maxX = Math.max(p.position.x, g.x) + pad;
    const minY = Math.min(p.position.y, g.y) - pad;
    const maxY = Math.max(p.position.y, g.y) + pad;
    const z = Math.max(
      0.28,
      Math.min(0.8, VIEW_W / Math.max(80, maxX - minX), VIEW_H / Math.max(80, maxY - minY)),
    );
    this.camFollow = true;
    this.pinCam((minX + maxX) / 2, (minY + maxY) / 2, z);
  }

  private applyLookKeys(dt: number): void {
    const k = this.keys;
    if (!k || this.camFollow || this.flow === 'title') return;
    let mx = 0;
    let my = 0;
    if (k.UP.isDown) my -= 1;
    if (k.DOWN.isDown) my += 1;
    if (k.LEFT.isDown) mx -= 1;
    if (k.RIGHT.isDown) mx += 1;
    if (mx === 0 && my === 0) return;
    const len = Math.hypot(mx, my) || 1;
    const speed = CAMERA_PAN_SPEED * dt;
    this.panLook((mx / len) * speed, (my / len) * speed);
  }

  private applyZoomKeys(): void {
    const k = this.keys;
    if (!k || this.flow === 'title') return;
    if (Phaser.Input.Keyboard.JustDown(k.PLUS) || Phaser.Input.Keyboard.JustDown(k.CLOSED_BRACKET)) {
      this.nudgeUserZoom(1.1);
    }
    if (Phaser.Input.Keyboard.JustDown(k.MINUS) || Phaser.Input.Keyboard.JustDown(k.OPEN_BRACKET)) {
      this.nudgeUserZoom(1 / 1.1);
    }
  }

  private applyCamera(): void {
    if (this.flow === 'playing' && this.kickoffLeft > 0) {
      this.frameKickoff();
      return;
    }
    this.currentZoom = this.clampedZoom();
    if (this.camFollow) {
      this.trackPlayer(true);
      return;
    }
    this.pinCam(this.camLook.x, this.camLook.y, this.currentZoom);
  }

  private syncFollowHud(): void {
    const show = !this.camFollow && this.flow !== 'title' && this.world.matchState !== 'over';
    this.followBtn?.setVisible(show);
    this.touch?.setLooking(show);
  }

  // -------------------------------------------------------------------------
  // Static map
  // -------------------------------------------------------------------------

  private drawMapStatic(): void {
    const map = this.world.map;
    this.mapGfx = this.add.graphics().setDepth(0);
    this.adoptWorld(this.mapGfx);

    this.mapGfx.fillStyle(PALETTE.grass, 1);
    this.mapGfx.fillRect(0, 0, map.width, map.height);

    let s = 0x9e3779b9;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 4000; i++) {
      const x = rand() * map.width;
      const y = rand() * map.height;
      this.mapGfx.fillStyle(rand() > 0.5 ? PALETTE.grassAlt : PALETTE.grassDark, 0.4);
      this.mapGfx.fillRect(x, y, 8 + rand() * 26, 4 + rand() * 10);
    }

    // Mud streets toward the millstones and along the river bank.
    this.mapGfx.fillStyle(PALETTE.mud, 0.55);
    this.mapGfx.fillRect(40, map.river.position.y - 70, map.width - 80, 40);
    this.mapGfx.fillRect(40, map.river.position.y + 30, map.width - 80, 40);
    this.mapGfx.fillStyle(PALETTE.mudDark, 0.35);
    for (let i = 0; i < 80; i++) {
      this.mapGfx.fillEllipse(rand() * map.width, map.river.position.y + (rand() - 0.5) * 160, 18 + rand() * 40, 8 + rand() * 10);
    }

    for (const z of map.outOfBounds) {
      const x = z.position.x - z.width / 2;
      const y = z.position.y - z.height / 2;
      this.mapGfx.fillStyle(PALETTE.oob, 1);
      this.mapGfx.fillRect(x, y, z.width, z.height);
      this.mapGfx.lineStyle(4, PALETTE.oobEdge, 1);
      this.mapGfx.strokeRect(x, y, z.width, z.height);
    }
    this.dressChurchyard(map.outOfBounds[0]!);
    this.dressMemorial(map.outOfBounds[1]!);

    for (const h of map.hedges) {
      const hx = h.position.x - h.width / 2;
      const hy = h.position.y - h.height / 2;
      this.mapGfx.fillStyle(PALETTE.hedge, 1);
      this.mapGfx.fillRect(hx, hy, h.width, h.height);
      this.mapGfx.lineStyle(3, PALETTE.hedgeEdge, 0.9);
      this.mapGfx.strokeRect(hx, hy, h.width, h.height);
      // Seeded leaf clumps so a hedge reads as a hedge, not a dark bar.
      const along = Math.max(h.width, h.height);
      const clumps = Math.max(3, Math.floor(along / 28));
      for (let i = 0; i < clumps; i++) {
        const t = (i + 0.5) / clumps;
        const px = hx + (h.width >= h.height ? t * h.width : h.width * (0.25 + (i % 3) * 0.25));
        const py = hy + (h.height > h.width ? t * h.height : h.height * (0.3 + (i % 2) * 0.4));
        this.mapGfx.fillStyle(PALETTE.hedgeLeaf, 0.85);
        this.mapGfx.fillCircle(px, py, 5 + (i % 3));
      }
    }

    const rx = map.river.position.x - map.river.width / 2;
    const ry = map.river.position.y - map.river.height / 2;
    this.mapGfx.fillStyle(PALETTE.water, 1);
    this.mapGfx.fillRect(rx, ry, map.river.width, map.river.height);
    this.mapGfx.fillStyle(PALETTE.waterEdge, 0.6);
    this.mapGfx.fillRect(rx, ry, map.river.width, 10);
    this.mapGfx.fillRect(rx, ry + map.river.height - 10, map.river.width, 10);

    for (const b of map.bridges) {
      const bx = b.position.x - b.width / 2;
      const by = b.position.y - b.height / 2;
      this.mapGfx.fillStyle(PALETTE.bridge, 1);
      this.mapGfx.fillRect(bx, by, b.width, b.height);
      this.mapGfx.lineStyle(2, PALETTE.buildingEdge, 0.45);
      for (let py = by + 8; py < by + b.height; py += 12) {
        this.mapGfx.lineBetween(bx, py, bx + b.width, py);
      }
    }

    for (const o of map.obstacles) {
      this.drawBuilding(o);
    }

    for (const o of map.obstacles) {
      if (!isBuilding(o)) continue;
      const oy = o.position.y - o.height / 2;
      const fasciaH = Math.min(18, o.height * 0.22);
      const label = this.add
        .text(o.position.x, oy + 4 + fasciaH * 0.5, o.name.toUpperCase(), {
          fontFamily: FONT,
          fontSize: o.kind === 'pub' ? '11px' : '10px',
          color: '#f3ead4',
          stroke: '#1a100a',
          strokeThickness: 3,
          align: 'center',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(1);
      this.adoptWorld(label);
    }

    for (const g of map.goals) {
      const tint = g.team === 0 ? PALETTE.teamUp : PALETTE.teamDown;
      this.mapGfx.lineStyle(8, tint, 0.85);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 42);
      this.mapGfx.fillStyle(PALETTE.millstone, 1);
      this.mapGfx.fillCircle(g.position.x, g.position.y, 22);
      this.mapGfx.lineStyle(4, PALETTE.millstoneEdge, 1);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 22);
      this.mapGfx.strokeCircle(g.position.x, g.position.y, 12);
      this.mapGfx.fillStyle(PALETTE.millstoneEdge, 1);
      this.mapGfx.fillCircle(g.position.x, g.position.y, 4);
    }

    this.mapGfx.lineStyle(3, 0x1a140c, 0.7);
    this.mapGfx.strokeRect(0, 0, map.width, map.height);
  }

  /** Timber-framed pub or brick shopfront — Ashbourne high street, not a labeled box. */
  private drawBuilding(o: Obstacle): void {
    const g = this.mapGfx;
    if ('radius' in o) {
      g.fillStyle(PALETTE.buildingRoof, 1);
      g.fillCircle(o.position.x + 4, o.position.y - 6, o.radius);
      g.fillStyle(PALETTE.building, 1);
      g.fillCircle(o.position.x, o.position.y, o.radius);
      g.lineStyle(3, PALETTE.buildingEdge, 1);
      g.strokeCircle(o.position.x, o.position.y, o.radius);
      return;
    }
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    const pub = isBuilding(o) && o.kind === 'pub';

    g.fillStyle(PALETTE.cobble, 0.35);
    g.fillRect(ox - 10, oy + o.height - 4, o.width + 20, 14);

    g.fillStyle(PALETTE.chimney, 1);
    g.fillRect(ox + o.width * 0.18, oy - 28, 10, 16);
    g.fillRect(ox + o.width * 0.72, oy - 26, 8, 14);

    g.fillStyle(pub ? PALETTE.pubRoof : PALETTE.buildingRoof, 1);
    g.fillTriangle(ox - 6, oy + 4, ox + o.width / 2, oy - 22, ox + o.width + 6, oy + 4);
    g.fillRect(ox + 4, oy - 8, o.width - 8, 14);

    g.fillStyle(pub ? PALETTE.pubTimber : PALETTE.shopBrick, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);

    if (pub) {
      g.lineStyle(5, PALETTE.timberBeam, 0.95);
      g.strokeRect(ox + 3, oy + 3, o.width - 6, o.height - 6);
      g.lineBetween(ox + 3, oy + o.height * 0.45, ox + o.width - 3, oy + o.height * 0.45);
      g.lineBetween(ox + o.width * 0.5, oy + 3, ox + o.width * 0.5, oy + o.height - 3);
      g.lineBetween(ox + 8, oy + 8, ox + o.width * 0.5 - 4, oy + o.height * 0.45 - 4);
      g.lineBetween(ox + o.width - 8, oy + 8, ox + o.width * 0.5 + 4, oy + o.height * 0.45 - 4);
    } else {
      g.lineStyle(1, PALETTE.brickLine, 0.55);
      for (let y = oy + 8; y < oy + o.height - 4; y += 7) {
        g.lineBetween(ox + 2, y, ox + o.width - 2, y);
      }
    }

    const fasciaH = Math.min(20, o.height * 0.24);
    g.fillStyle(pub ? PALETTE.pubFascia : PALETTE.shopFascia, 1);
    g.fillRect(ox + 4, oy + 4, o.width - 8, fasciaH);
    g.lineStyle(2, PALETTE.buildingEdge, 0.8);
    g.strokeRect(ox + 4, oy + 4, o.width - 8, fasciaH);

    const pane = (px: number, py: number, w: number, h: number): void => {
      g.fillStyle(PALETTE.window, 1);
      g.fillRect(px, py, w, h);
      g.fillStyle(PALETTE.windowLite, 0.28);
      g.fillRect(px + 1, py + 1, w * 0.45, h * 0.4);
      g.lineStyle(1, PALETTE.timberBeam, 0.9);
      g.lineBetween(px, py + h / 2, px + w, py + h / 2);
      g.lineBetween(px + w / 2, py, px + w / 2, py + h);
      g.strokeRect(px, py, w, h);
    };

    const winW = Math.min(20, o.width * 0.18);
    const winH = Math.min(18, o.height * 0.22);
    const winY = oy + o.height * 0.42;
    pane(ox + o.width * 0.18 - winW / 2, winY, winW, winH);
    pane(ox + o.width * 0.82 - winW / 2, winY, winW, winH);
    if (o.width > 90) {
      pane(ox + o.width * 0.5 - winW / 2, winY, winW, winH);
    }

    const doorW = Math.min(24, o.width * 0.24);
    const doorH = Math.min(36, o.height * 0.44);
    const dx = o.position.x - doorW / 2;
    const dy = oy + o.height - doorH - 2;
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(dx, dy, doorW, doorH);
    g.lineStyle(2, PALETTE.timberBeam, 1);
    g.strokeRect(dx, dy, doorW, doorH);
    g.fillStyle(PALETTE.pubSign, 0.85);
    g.fillCircle(dx + doorW - 5, dy + doorH * 0.5, 2);

    if (pub) {
      const hx = ox + o.width + 4;
      g.lineStyle(3, PALETTE.timberBeam, 1);
      g.lineBetween(hx, oy + 6, hx, oy + 28);
      g.fillStyle(PALETTE.pubFascia, 1);
      g.fillRoundedRect(hx - 16, oy + 26, 32, 22, 3);
      g.lineStyle(2, PALETTE.pubSign, 1);
      g.strokeRoundedRect(hx - 16, oy + 26, 32, 22, 3);
      g.fillStyle(PALETTE.pubSign, 1);
      g.fillCircle(hx, oy + 37, 5);
    } else {
      const awningY = oy + fasciaH + 3;
      const stripe = (o.width - 10) / 8;
      for (let i = 0; i < 8; i++) {
        g.fillStyle(i % 2 === 0 ? PALETTE.shopAwning : PALETTE.shopAwningAlt, 0.95);
        g.fillTriangle(
          ox + 5 + i * stripe,
          awningY,
          ox + 5 + (i + 1) * stripe,
          awningY,
          ox + 5 + (i + 0.5) * stripe,
          awningY + 12,
        );
      }
      g.fillStyle(PALETTE.windowLite, 0.35);
      g.fillRect(ox + 8, oy + o.height * 0.62, o.width - 16, o.height * 0.18);
    }
  }

  /** St Oswald's churchyard — render only; OOB collision unchanged. */
  private dressChurchyard(z: { position: { x: number; y: number }; width: number; height: number }): void {
    const g = this.mapGfx;
    const cx = z.position.x;
    const cy = z.position.y;
    g.fillStyle(PALETTE.church, 1);
    g.fillRect(cx - 28, cy - 8, 56, 48);
    g.fillStyle(PALETTE.churchRoof, 1);
    g.fillTriangle(cx - 36, cy - 8, cx, cy - 44, cx + 36, cy - 8);
    g.fillRect(cx + 10, cy - 58, 14, 28);
    g.fillStyle(PALETTE.pubSign, 0.9);
    g.fillCircle(cx + 17, cy - 62, 4);
    g.fillStyle(PALETTE.windowLite, 0.45);
    g.fillRect(cx - 10, cy + 8, 10, 16);
    g.fillRect(cx + 4, cy + 8, 10, 16);
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(cx - 6, cy + 22, 12, 18);
    for (let i = 0; i < 5; i++) {
      const gx = cx - 50 + i * 22;
      const gy = cy + 38;
      g.fillStyle(PALETTE.churchRoof, 1);
      g.fillRect(gx, gy, 8, 14);
      g.fillTriangle(gx - 2, gy, gx + 4, gy - 8, gx + 10, gy);
    }
  }

  /** Clifton memorial garden — render only; OOB collision unchanged. */
  private dressMemorial(z: { position: { x: number; y: number }; width: number; height: number }): void {
    const g = this.mapGfx;
    const cx = z.position.x;
    const cy = z.position.y;
    g.fillStyle(PALETTE.church, 1);
    g.fillRect(cx - 10, cy + 8, 20, 36);
    g.fillTriangle(cx - 16, cy + 8, cx, cy - 28, cx + 16, cy + 8);
    g.fillStyle(PALETTE.millstone, 0.85);
    g.fillCircle(cx, cy - 4, 8);
    g.lineStyle(3, PALETTE.millstoneEdge, 0.9);
    g.strokeCircle(cx, cy - 4, 8);
    g.fillStyle(PALETTE.hedgeLeaf, 0.5);
    g.fillCircle(cx - 40, cy + 20, 16);
    g.fillCircle(cx + 38, cy + 16, 14);
  }

  private createSprites(): void {
    for (const ch of this.collectCharacters()) {
      const shadow = this.add
        .ellipse(ch.x, ch.y + ch.radius * 0.55, ch.radius * 2.1, ch.radius, PALETTE.shadow, 0.35)
        .setDepth(1);
      this.shadowSprites.set(ch.id, shadow);
      this.adoptWorld(shadow);

      const body = this.add.circle(ch.x, ch.y, ch.radius, PALETTE.teamUp);
      body.setDepth(2);
      body.setStrokeStyle(3, PALETTE.buildingEdge, 1);
      this.bodySprites.set(ch.id, body);
      this.adoptWorld(body);
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
    this.adoptWorld(this.ballShadow);

    this.ballSprite = this.add.circle(
      this.world.ball.position.x,
      this.world.ball.position.y,
      this.world.ball.radius,
      PALETTE.ball,
    );
    this.ballSprite.setStrokeStyle(3, PALETTE.ballEdge);
    this.ballSprite.setDepth(4);
    this.adoptWorld(this.ballSprite);

    this.markerGfx = this.add.graphics().setDepth(5);
    this.adoptWorld(this.markerGfx);
  }

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
  // HUD (screen space — rendered by hudCam at zoom 1)
  // -------------------------------------------------------------------------

  private hudText(
    x: number,
    y: number,
    str: string,
    size: string,
    color: string,
    originX = 0,
    originY = 0,
  ): Phaser.GameObjects.Text {
    const t = this.add
      .text(x, y, str, {
        fontFamily: FONT,
        fontSize: size,
        color,
      })
      .setOrigin(originX, originY)
      .setScrollFactor(0)
      .setDepth(11);
    return this.adoptHud(t);
  }

  private createHUD(): void {
    const pad = 16;
    this.staminaBg = this.adoptHud(
      this.add.rectangle(pad, pad, 240, 22, PALETTE.staminaBg).setOrigin(0, 0).setScrollFactor(0).setDepth(10),
    );
    this.staminaFill = this.adoptHud(
      this.add.rectangle(pad + 2, pad + 2, 236, 18, PALETTE.staminaGood).setOrigin(0, 0).setScrollFactor(0).setDepth(11),
    );
    this.staminaLabel = this.hudText(pad, pad + 26, 'Breath', '16px', '#f3ead4');

    this.timerText = this.hudText(VIEW_W / 2, 14, '1:30', '26px', '#f3ead4', 0.5, 0);
    this.scoreText = this.hudText(VIEW_W / 2, 44, 'Up 0 — 0 Down', '18px', '#f3ead4', 0.5, 0);

    this.followBtn = this.adoptHud(
      this.add
        .text(VIEW_W / 2, 78, 'Follow  ·  C', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#1a140c',
          backgroundColor: '#e4d4a8',
          padding: { x: 16, y: 6 },
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(14)
        .setVisible(false)
        .setInteractive({ useHandCursor: true }),
    );
    this.followBtn.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      pointer.event?.stopPropagation?.();
      this.eatPointer = true;
      this.returnToFollow();
    });

    this.overlayText = this.adoptHud(
      this.add
        .text(VIEW_W / 2, VIEW_H / 2 - 24, '', {
          fontFamily: FONT,
          fontSize: '36px',
          color: '#f3ead4',
          align: 'center',
          backgroundColor: '#140e0acc',
          padding: { x: 24, y: 16 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(13)
        .setVisible(false),
    );

    this.titleCard = this.adoptHud(
      this.add
        .text(
          VIEW_W / 2,
          VIEW_H / 2,
          "SHROVETIDE\n\nUp'Ards  vs  Down'Ards\n\nUp play to the Down millstone (right).\nDown play the other way.\n\nSpace or tap — walk out",
          {
            fontFamily: FONT,
            fontSize: '28px',
            color: '#f3ead4',
            align: 'center',
            backgroundColor: '#140e0add',
            padding: { x: 36, y: 28 },
          },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(14),
    );

    this.promptText = this.hudText(VIEW_W / 2, VIEW_H - 56, '', '22px', '#f3ead4', 0.5, 0.5);
    this.promptText.setBackgroundColor('#140e0acc');
    this.promptText.setPadding(14, 8, 14, 8);

    this.againBtn = this.adoptHud(
      this.add
        .text(VIEW_W / 2, VIEW_H / 2 + 90, 'Again', {
          fontFamily: FONT,
          fontSize: '32px',
          color: '#1a140c',
          backgroundColor: '#e4d4a8',
          padding: { x: 48, y: 12 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(14)
        .setVisible(false),
    );
    this.againBtn.on('pointerdown', () => this.scene.restart());

    this.minimapBg = this.adoptHud(
      this.add
        .rectangle(
          VIEW_W - MINIMAP_W / 2 - MINIMAP_PAD,
          MINIMAP_H / 2 + MINIMAP_PAD,
          MINIMAP_W,
          MINIMAP_H,
          0x140e0a,
          0.7,
        )
        .setOrigin(0.5)
        .setStrokeStyle(2, 0xf3ead4, 0.45)
        .setScrollFactor(0)
        .setDepth(10),
    );
    this.minimapGfx = this.adoptHud(this.add.graphics().setScrollFactor(0).setDepth(11));
    this.pipGfx = this.adoptHud(this.add.graphics().setScrollFactor(0).setDepth(12));

    this.vignetteGfx = this.adoptHud(this.add.graphics().setScrollFactor(0).setDepth(9));
    this.drawVignette();
  }

  private drawVignette(): void {
    const g = this.vignetteGfx;
    const band = 110;
    const a = 0.55;
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, a, a, 0, 0);
    g.fillRect(0, 0, VIEW_W, band);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, a, a);
    g.fillRect(0, VIEW_H - band, VIEW_W, band);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, a, 0, a, 0);
    g.fillRect(0, 0, band, VIEW_H);
    g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, a, 0, a);
    g.fillRect(VIEW_W - band, 0, band, VIEW_H);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private clearPassCharge(): void {
    this.isPassing = false;
    this.inputState.charging = false;
  }

  /** Touch Kick: a new press must start a charge even if the last pointerup was dropped. */
  private beginTouchKick = (): void => {
    if (this.flow !== 'playing') return;
    this.clearPassCharge();
    this.beginPassCharge();
  };

  private beginPassCharge(): void {
    if (this.flow !== 'playing') return;
    if (this.isPassing) return;
    if (!this.world.player.hasBall) return;
    this.isPassing = true;
    this.passChargeStartedAt = this.now();
    this.inputState.charging = true;
    if (this.teach === 'kick') this.teach = 'sprint';
  }

  private handleSpace = (): void => {
    if (this.flow === 'title') {
      this.beginPlacement();
      return;
    }
    if (this.flow === 'placing') return;
    this.beginPassCharge();
  };

  private handlePassRelease = (): void => {
    this.spaceReady = true;
    if (this.flow !== 'playing' || !this.isPassing) {
      this.clearPassCharge();
      return;
    }
    const chargeSeconds = (this.now() - this.passChargeStartedAt) / 1000;
    const moving = this.inputState.move.x !== 0 || this.inputState.move.y !== 0;
    const aim = moving ? { ...this.inputState.move } : { ...this.lastAim };
    releasePass(this.world, aim, chargeSeconds);
    this.clearPassCharge();
    this.trackPlayer(true);
  };

  private handleGoalTap = (): void => {
    if (this.flow !== 'playing') return;
    this.inputState.goalTap = true;
    if (this.teach === 'goal') this.teach = 'done';
  };

  private handleTab = (): void => {
    if (this.flow === 'title') return;
    if (this.flow !== 'placing' && this.flow !== 'playing') return;
    const newId = cycleTeammate(this.world);
    if (!newId) return;
    this.clearPassCharge();
    this.retargetPlace();
    this.punchCamera();
  };

  private handleQuickSwitch = (): void => {
    if (this.flow !== 'placing' && this.flow !== 'playing') return;
    const newId = quickSwitch(this.world);
    if (!newId) return;
    this.clearPassCharge();
    this.retargetPlace();
    this.punchCamera();
  };

  private handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    void unlockAudio();
    if (this.eatPointer) {
      this.eatPointer = false;
      return;
    }
    if (this.flow === 'title') {
      this.beginPlacement();
      return;
    }
    const evTarget = pointer.event?.target;
    if (evTarget instanceof Element && evTarget.closest('#touch-layer .pad-btn, #touch-layer #follow-btn')) {
      return;
    }
    if (this.minimapContains(pointer.x, pointer.y)) {
      this.panToMinimap(pointer.x, pointer.y);
      return;
    }
    const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.flow === 'playing' && this.atStone() && this.millstoneHit(worldPt.x, worldPt.y)) {
      this.handleGoalTap();
      return;
    }
    const tappedMate = teammateAtPoint(this.world, worldPt.x, worldPt.y);
    if (tappedMate && (this.flow === 'placing' || this.flow === 'playing')) {
      if (switchControl(this.world, tappedMate)) {
        this.clearPassCharge();
        this.retargetPlace();
        this.punchCamera();
      }
      return;
    }
    this.panPointerId = pointer.id;
    this.panLast.x = pointer.x;
    this.panLast.y = pointer.y;
    this.panDragging = false;
  };

  private handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (this.flow === 'title') return;
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (a.isDown && b.isDown) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (this.pinchDist <= 1) {
        this.pinchDist = dist;
        this.pinchMid.x = midX;
        this.pinchMid.y = midY;
        return;
      }
      this.nudgeUserZoom(dist / this.pinchDist);
      this.pinchDist = dist;
      this.panByScreen(this.pinchMid.x - midX, this.pinchMid.y - midY);
      this.pinchMid.x = midX;
      this.pinchMid.y = midY;
      this.panDragging = true;
      return;
    }
    this.pinchDist = 0;
    if (this.panPointerId !== pointer.id) return;
    const dx = pointer.x - this.panLast.x;
    const dy = pointer.y - this.panLast.y;
    if (!this.panDragging && Math.hypot(dx, dy) < CAMERA_DRAG_PX) return;
    this.panDragging = true;
    this.panByScreen(-dx, -dy);
    this.panLast.x = pointer.x;
    this.panLast.y = pointer.y;
  };

  private handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    this.pinchDist = 0;
    if (this.panPointerId !== pointer.id) {
      this.eatPointer = false;
      return;
    }
    const dragged = this.panDragging;
    this.panPointerId = null;
    this.panDragging = false;
    this.eatPointer = false;
    if (dragged || this.flow !== 'placing' || !this.placeTargetId) return;
    const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    placeTeammate(this.world, this.placeTargetId, worldPt.x, worldPt.y);
  };

  private handleWheel = (
    pointer: Phaser.Input.Pointer,
    _currentlyOver: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
  ): void => {
    if (this.flow === 'title') return;
    void pointer;
    this.nudgeUserZoom(dy > 0 ? 0.92 : 1.08);
  };

  private minimapOrigin(): { ox: number; oy: number } {
    return {
      ox: VIEW_W - MINIMAP_W - Math.max(MINIMAP_PAD, this.hudPad.r),
      oy: Math.max(MINIMAP_PAD, this.hudPad.t),
    };
  }

  private minimapContains(x: number, y: number): boolean {
    if (this.flow !== 'playing' && this.flow !== 'placing') return false;
    const { ox, oy } = this.minimapOrigin();
    return x >= ox && x <= ox + MINIMAP_W && y >= oy && y <= oy + MINIMAP_H;
  }

  private panToMinimap(px: number, py: number): void {
    const { ox, oy } = this.minimapOrigin();
    const map = this.world.map;
    this.breakFollow();
    this.camLook.x = ((px - ox) / MINIMAP_W) * map.width;
    this.camLook.y = ((py - oy) / MINIMAP_H) * map.height;
    this.syncFollowHud();
  }

  /** After a control switch, map-tap placement must target an NPC, not the player. */
  private retargetPlace(): void {
    if (this.flow !== 'placing') return;
    const mates = this.world.npcs.filter((n) => n.team === this.world.player.team);
    if (mates.length === 0) {
      this.placeTargetId = null;
      return;
    }
    if (this.placeTargetId && mates.some((n) => n.id === this.placeTargetId)) return;
    this.placeTargetId = mates[0]!.id;
  }

  private millstoneHit(x: number, y: number): boolean {
    const g = opponentGoalFor(this.world.player.team, this.world.map);
    return Math.hypot(x - g.x, y - g.y) <= 80;
  }

  private beginPlacement(): void {
    if (this.flow !== 'title') return;
    this.flow = 'placing';
    this.placeLeft = PLACE_SECONDS;
    this.lastWall = this.now();
    this.spaceReady = false;
    this.eatPointer = true;
    this.titleCard.setVisible(false);
    this.syncTouchFlow();
    this.layoutHud();
  }

  private whistle(): void {
    if (this.flow !== 'placing') return;
    startMatch(this.world);
    this.flow = 'playing';
    this.playStartedAt = this.now();
    this.teach = 'move';
    this.lastWall = this.now();
    this.kickoffLeft = KICKOFF_SECONDS;
    this.syncTouchFlow();
    this.layoutHud();
  }

  private flash(msg: string): void {
    this.setCaption(msg);
    this.feedbackUntil = this.now() + 900;
  }

  private setCaption(text: string, pips: number | null = null): void {
    const touch = !!this.touch?.active;
    if (touch) {
      this.promptText.setText('');
      this.promptText.setVisible(false);
      this.touch?.setCaption(text);
      this.touch?.setPips(pips);
    } else {
      this.promptText.setVisible(true);
      this.promptText.setText(text);
      this.touch?.setCaption('');
      this.touch?.setPips(null);
    }
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  override update(_time: number, _deltaMs: number): void {
    this.readInput();
    const now = this.now();
    if (this.lastWall === 0) this.lastWall = now;
    // Cap per frame so a jumped performance.now() cannot skip 16s of countdown.
    const dt = Math.min(1 / 30, Math.max(0, (now - this.lastWall) / 1000));
    this.lastWall = now;

    if (this.flow === 'placing') {
      moveControlled(
        this.world,
        this.inputState.move.x * PLACE_SPEED * dt,
        this.inputState.move.y * PLACE_SPEED * dt,
      );
      this.placeLeft = Math.max(0, this.placeLeft - dt);
      if (this.spaceReady && this.keys && Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.whistle();
      else if (this.placeLeft <= 0) this.whistle();
    }

    if (this.flow === 'playing') {
      if (this.kickoffLeft > 0) this.kickoffLeft = Math.max(0, this.kickoffLeft - dt);
      if (this.hitStopLeft > 0) this.hitStopLeft = Math.max(0, this.hitStopLeft - dt);
    }

    if (this.flow === 'playing' && this.hitStopLeft <= 0 && this.kickoffLeft <= 0) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        stepWorld(this.world, this.inputState, FIXED_DT);
        this.inputState.goalTap = false;
        this.accumulator -= FIXED_DT;
        steps += 1;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;
      this.advanceTeach();
    }

    if (this.world.matchState === 'over') this.flow = 'playing';
    this.syncTouchFlow();

    this.applyLookKeys(dt);
    this.applyZoomKeys();
    this.render();
  }

  private readInput(): void {
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k) {
      if (k.W.isDown) my -= 1;
      if (k.S.isDown) my += 1;
      if (k.A.isDown) mx -= 1;
      if (k.D.isDown) mx += 1;
      if (this.camFollow) {
        if (k.UP.isDown) my -= 1;
        if (k.DOWN.isDown) my += 1;
        if (k.LEFT.isDown) mx -= 1;
        if (k.RIGHT.isDown) mx += 1;
      }
    }
    const keyLen = Math.hypot(mx, my);
    if (keyLen > 0) {
      mx /= keyLen;
      my /= keyLen;
    } else if (this.touch) {
      mx = this.touch.move.x;
      my = this.touch.move.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 0) {
      this.lastAim = { x: mx, y: my };
      if (this.teach === 'move' && this.flow === 'playing') this.teach = 'ball';
    }
    this.inputState.move = { x: mx, y: my };
    this.inputState.sprint = !!k?.SHIFT.isDown || !!this.touch?.sprint;
    const wrestle = !!k?.F.isDown || !!this.touch?.wrestle;
    this.inputState.rip = wrestle;
    this.inputState.wriggle = wrestle;
    if (this.isPassing && !this.world.player.hasBall) this.clearPassCharge();
    if (this.inputState.sprint && this.teach === 'sprint') this.teach = 'goal';
    if (this.inputState.charging) {
      this.inputState.passAim = len > 0 ? { x: mx, y: my } : { ...this.lastAim };
    }
  }

  private advanceTeach(): void {
    if (this.world.player.hasBall && this.teach === 'ball') this.teach = 'kick';
    if (this.now() - this.playStartedAt > TEACH_WINDOW_MS) this.teach = 'done';
  }

  private atStone(): boolean {
    return this.world.player.hasBall && isCarrierAtOpponentGoal(this.world);
  }

  /** Any carrier (player or NPC) in millstone reach — climax pips / copy. */
  private millstoneClimax(): boolean {
    return isCarrierAtOpponentGoal(this.world);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  private render(): void {
    const chars = this.collectCharacters();
    const p = this.world.player;
    const carrierId = this.world.ball.ownerId;

    let nearby = 0;
    for (const c of chars) {
      if (c.controlled) continue;
      const dx = c.x - p.position.x;
      const dy = c.y - p.position.y;
      if (dx * dx + dy * dy < CROWD_RADIUS * CROWD_RADIUS) nearby += 1;
    }
    const crowdFactor = Math.min(1, nearby / 8);
    const targetZoom = CAMERA_BASE_ZOOM - CAMERA_CROWD_ZOOM_OUT * crowdFactor;
    if (this.camFollow) {
      this.followZoom += (targetZoom - this.followZoom) * ZOOM_LERP;
    }
    this.currentZoom = this.clampedZoom();
    this.applyCamera();
    this.hudCam.setScroll(0, 0);
    this.syncFollowHud();

    this.markerGfx.clear();

    for (const c of chars) {
      const body = this.bodySprites.get(c.id);
      const shadow = this.shadowSprites.get(c.id);
      if (!body || !shadow) continue;

      body.setPosition(c.x, c.y);
      shadow.setPosition(c.x, c.y + c.radius * 0.55);

      const teamColor = c.team === 0 ? PALETTE.teamUp : PALETTE.teamDown;
      body.setFillStyle(teamColor);

      if (c.controlled) {
        body.setRadius(c.radius * 1.5);
        body.setStrokeStyle(6, PALETTE.youRing, 1);
        body.setDepth(3);
        const ty = c.y - c.radius * 1.5 - 16;
        this.markerGfx.fillStyle(PALETTE.youRing, 1);
        this.markerGfx.fillTriangle(c.x - 9, ty - 10, c.x + 9, ty - 10, c.x, ty);
      } else {
        body.setRadius(c.radius);
        body.setStrokeStyle(3, PALETTE.buildingEdge, 1);
        body.setDepth(2);
      }

      const speed = Math.hypot(c.vx, c.vy);
      if (speed > 4) {
        const ux = c.vx / speed;
        const uy = c.vy / speed;
        this.markerGfx.lineStyle(3, PALETTE.buildingEdge, 0.7);
        this.markerGfx.lineBetween(
          c.x + ux * c.radius * 0.2,
          c.y + uy * c.radius * 0.2,
          c.x + ux * (c.radius + 10),
          c.y + uy * (c.radius + 10),
        );
      }

      if (carrierId !== null && carrierId === c.id) {
        const pulse = 3 + Math.sin(this.now() / 130) * 2;
        this.markerGfx.lineStyle(3, PALETTE.ball, 0.95);
        this.markerGfx.strokeCircle(c.x, c.y, c.radius + 8 + pulse);
      }

      const rip = npcRipContest(this.world);
      if (rip && rip.id === c.id) {
        const pulse = 4 + Math.sin(this.now() / 90) * 2;
        this.markerGfx.lineStyle(4, PALETTE.staminaLow, 0.7 + rip.pressure * 0.3);
        this.markerGfx.strokeCircle(c.x, c.y, c.radius + 10 + pulse + rip.pressure * 8);
      }
    }

    const b = this.world.ball;
    this.ballSprite.setPosition(b.position.x, b.position.y);
    this.ballShadow.setPosition(b.position.x, b.position.y + 6);
    if (carrierId === null) {
      const pulse = 2 + Math.sin(this.now() / 90) * 2;
      this.markerGfx.lineStyle(2, PALETTE.ball, 0.6);
      this.markerGfx.strokeCircle(b.position.x, b.position.y, b.radius + 6 + pulse);
    }

    if (this.isPassing && p.hasBall) {
      const charge = Math.min(1, (this.now() - this.passChargeStartedAt) / 900);
      this.markerGfx.lineStyle(4, PALETTE.youRing, 0.9);
      this.markerGfx.strokeCircle(p.position.x, p.position.y, p.radius * 1.4 + charge * 28);
    }

    if (this.flow === 'playing' && this.kickoffLeft > 0) {
      const goal = opponentGoalFor(p.team, this.world.map);
      const dx = goal.x - p.position.x;
      const dy = goal.y - p.position.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const x1 = p.position.x + ux * 36;
      const y1 = p.position.y + uy * 36;
      const x2 = p.position.x + ux * 110;
      const y2 = p.position.y + uy * 110;
      this.markerGfx.lineStyle(6, PALETTE.youRing, 0.95);
      this.markerGfx.lineBetween(x1, y1, x2, y2);
      this.markerGfx.fillStyle(PALETTE.youRing, 1);
      this.markerGfx.fillTriangle(
        x2 + ux * 18,
        y2 + uy * 18,
        x2 - uy * 12,
        y2 + ux * 12,
        x2 + uy * 12,
        y2 - ux * 12,
      );
    }

    if (this.flow === 'playing') {
      let thump = false;
      for (const c of chars) {
        if (c.controlled) continue;
        const reach = p.radius + c.radius + 2;
        const dx = c.x - p.position.x;
        const dy = c.y - p.position.y;
        if (dx * dx + dy * dy <= reach * reach) {
          thump = true;
          break;
        }
      }
      if (thump && this.now() - this.lastThumpAt > 180) {
        this.lastThumpAt = this.now();
        this.hitStopLeft = Math.max(this.hitStopLeft, 0.045);
      }
    }

    this.renderHud();
    if (this.flow === 'playing') this.renderMinimap(chars);
    else this.minimapGfx.clear();
  }

  private setMatchHud(on: boolean): void {
    this.staminaBg.setVisible(on);
    this.staminaFill.setVisible(on);
    this.staminaLabel.setVisible(on);
    this.timerText.setVisible(on);
    this.scoreText.setVisible(on);
    this.minimapBg.setVisible(on);
  }

  private renderHud(): void {
    const live = this.flow === 'playing';
    this.setMatchHud(live);
    this.titleCard.setVisible(this.flow === 'title');
    this.touch?.setAtStone(live && this.world.matchState === 'playing' && this.atStone());
    this.touch?.setWrestle(
      live && this.world.matchState === 'playing' ? wrestleMode(this.world) : 'none',
      live ? this.world._ripPressure : 0,
    );

    if (!live) {
      this.pipGfx.clear();
      this.overlayText.setVisible(false);
      this.againBtn.setVisible(false);
      this.againBtn.disableInteractive();
      this.drawPrompts();
      return;
    }

    const p = this.world.player;
    const ratio = p.stamina / p.maxStamina;
    const exhausted = p.stamina <= 0;
    this.staminaFill.setSize(236 * ratio, 18);
    this.staminaFill.setFillStyle(exhausted || ratio < 0.3 ? PALETTE.staminaLow : PALETTE.staminaGood);
    if (exhausted) {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.now() / 120));
      this.staminaLabel.setAlpha(pulse);
      this.staminaLabel.setColor('#ff6a4a');
      this.staminaLabel.setText('SPENT');
    } else {
      this.staminaLabel.setAlpha(1);
      this.staminaLabel.setColor('#f3ead4');
      this.staminaLabel.setText('Breath');
    }

    const remain = Math.max(0, this.world.matchTimeRemaining);
    const mm = Math.floor(remain / 60);
    const ss = Math.floor(remain % 60).toString().padStart(2, '0');
    this.timerText.setText(`${mm}:${ss}`);
    this.scoreText.setText(`Up ${this.world.score[0]} — ${this.world.score[1]} Down`);

    this.pipGfx.clear();
    const over = this.world.matchState === 'over' && this.world.winState;
    if (over) {
      const ws = this.world.winState!;
      let msg: string;
      if (ws.winner === null) msg = 'Time. Nobody goaled.';
      else {
        const teamLabel = ws.winner === 0 ? "Up'Ards" : "Down'Ards";
        msg = `${teamLabel} have it.`;
      }
      this.overlayText.setText(msg);
      this.overlayText.setVisible(true);
      this.againBtn.setVisible(true);
      this.againBtn.setInteractive({ useHandCursor: true });
      this.setCaption('');
      if (ws.reason === 'goal' && !this.scoredJuice) {
        this.scoredJuice = true;
        this.hitStopLeft = 0.24;
      }
    } else {
      this.overlayText.setVisible(false);
      this.againBtn.setVisible(false);
      this.drawPrompts();
    }
  }

  private placeCountdown(): string {
    return `${Math.max(0, Math.ceil(this.placeLeft))}s`;
  }

  private drawPrompts(): void {
    if (this.now() < this.feedbackUntil) return;

    if (this.flow === 'placing') {
      const ready = this.touch?.active ? 'Whistle when ready' : 'Space when ready';
      this.setCaption(`Walk them out · ${this.placeCountdown()} · ${ready}`);
      return;
    }
    if (this.flow !== 'playing') {
      this.setCaption('');
      return;
    }
    if (this.kickoffLeft > 0) {
      const label = this.world.player.team === 0 ? "YOU ARE UP" : "YOU ARE DOWN";
      this.setCaption(`${label} — that way`);
      return;
    }
    if (!this.camFollow && !this.atStone()) {
      const copy = this.touch?.active ? 'Look — tap Follow to return' : 'Look — Follow / C to return · tap a teammate';
      this.setCaption(copy);
      return;
    }

    if (this.millstoneClimax()) {
      const taps = this.world.goaling.taps;
      this.lastGoalingTaps = taps;
      const ours = this.world.player.hasBall;
      const copy = ours
        ? this.touch?.active
          ? 'HOLD THE STONE — tap Goal'
          : 'HOLD THE STONE'
        : "They're goaling";
      this.setCaption(copy, this.touch?.active && ours ? taps : null);
      if (!this.touch?.active || !ours) {
        const cx = VIEW_W / 2;
        const cy = (this.promptText.y ?? VIEW_H - 56) - 40;
        for (let i = 0; i < 3; i++) {
          const filled = i < taps;
          this.pipGfx.lineStyle(3, 0xf3ead4, 1);
          if (filled) this.pipGfx.fillStyle(0xe4d4a8, 1);
          else this.pipGfx.fillStyle(0x140e0a, 0.4);
          this.pipGfx.fillCircle(cx + (i - 1) * 28, cy, 8);
          this.pipGfx.strokeCircle(cx + (i - 1) * 28, cy, 8);
        }
      }
      return;
    }

    const rip = npcRipContest(this.world);
    if (rip && this.world.player.hasBall) {
      this.setCaption("They're ripping the stone");
      return;
    }

    if (this.teach === 'done' || this.now() - this.playStartedAt > TEACH_WINDOW_MS) {
      this.setCaption('');
      return;
    }
    const touch = !!this.touch?.active;
    const copy: Record<Teach, string> = {
      move: touch ? 'Stick — run' : 'WASD — run',
      ball: 'Get the stone',
      kick: touch ? 'Hold Kick' : 'Hold Space — kick',
      sprint: touch ? 'Hold Sprint — burst' : 'Shift — burst',
      goal: touch ? 'At their millstone, tap Goal' : 'At their millstone, tap E',
      done: '',
    };
    this.setCaption(copy[this.teach]);
  }

  private renderMinimap(chars: RenderChar[]): void {
    const g = this.minimapGfx;
    g.clear();
    const map = this.world.map;
    const sx = MINIMAP_W / map.width;
    const sy = MINIMAP_H / map.height;
    const ox = VIEW_W - MINIMAP_W - Math.max(MINIMAP_PAD, this.hudPad.r);
    const oy = Math.max(MINIMAP_PAD, this.hudPad.t);

    g.fillStyle(PALETTE.grass, 0.7);
    g.fillRect(ox, oy, MINIMAP_W, MINIMAP_H);
    g.fillStyle(PALETTE.hedge, 0.95);
    for (const h of map.hedges) {
      g.fillRect(
        ox + (h.position.x - h.width / 2) * sx,
        oy + (h.position.y - h.height / 2) * sy,
        Math.max(1.5, h.width * sx),
        Math.max(1.5, h.height * sy),
      );
    }
    g.fillStyle(PALETTE.water, 0.9);
    g.fillRect(
      ox,
      oy + (map.river.position.y - map.river.height / 2) * sy,
      MINIMAP_W,
      map.river.height * sy,
    );

    g.fillStyle(PALETTE.building, 0.85);
    for (const b of map.obstacles) {
      if ('radius' in b) {
        g.fillCircle(ox + b.position.x * sx, oy + b.position.y * sy, 2);
        continue;
      }
      g.fillRect(
        ox + (b.position.x - b.width / 2) * sx,
        oy + (b.position.y - b.height / 2) * sy,
        Math.max(1.5, b.width * sx),
        Math.max(1.5, b.height * sy),
      );
    }

    for (const goal of map.goals) {
      g.fillStyle(PALETTE.millstone, 1);
      g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 3);
    }

    for (const c of chars) {
      if (c.controlled) continue;
      g.fillStyle(c.team === 0 ? PALETTE.teamUp : PALETTE.teamDown, 0.9);
      g.fillCircle(ox + c.x * sx, oy + c.y * sy, 2.2);
    }

    const b = this.world.ball;
    g.fillStyle(PALETTE.ball, 1);
    g.fillCircle(ox + b.position.x * sx, oy + b.position.y * sy, 3);

    const p = this.world.player;
    g.fillStyle(PALETTE.youRing, 1);
    g.fillCircle(ox + p.position.x * sx, oy + p.position.y * sy, 4);
    g.lineStyle(1, 0x000000, 0.8);
    g.strokeCircle(ox + p.position.x * sx, oy + p.position.y * sy, 4);

    const z = Math.max(CAMERA_ZOOM_MIN, this.currentZoom);
    const vw = VIEW_W / z;
    const vh = VIEW_H / z;
    const cx = this.camLook.x;
    const cy = this.camLook.y;
    g.lineStyle(1, PALETTE.youRing, this.camFollow ? 0.45 : 0.95);
    g.strokeRect(ox + (cx - vw / 2) * sx, oy + (cy - vh / 2) * sy, vw * sx, vh * sy);
  }
}
