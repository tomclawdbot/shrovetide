// client/GameScene.ts — Phaser scene. Pure render + input. All game logic lives in /sim.
//
// First-run: HUD lives on a zoom-1 camera (main zoom was swallowing scrollFactor(0)
// overlays). Kickoff is title → ~20s place-your-people → whistle. Who-am-I follows
// control. Scoring has HOLD THE STONE + pips + hit-stop.
// Phone: DOM stick + kick/switch (see touch.ts); keyboard still drives Input.move.

import Phaser from 'phaser';
import {
  createWorld,
  cycleTeammate,
  GOAL_REACH_DISTANCE,
  moveControlled,
  opponentGoalFor,
  placeTeammate,
  quickSwitch,
  releasePass,
  startMatch,
  stepWorld,
  switchControl,
  type Input,
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
  water: 0x2d4a5c,
  waterEdge: 0x1a3040,
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
  private currentZoom = CAMERA_BASE_ZOOM;

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
      kb.addCapture('TAB,SPACE,E,Q,W,A,S,D,SHIFT');
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
      kb.on('keydown-SPACE', this.handleSpace);
      kb.on('keyup-SPACE', this.handlePassRelease);
      kb.on('keydown-E', this.handleGoalTap);
      kb.on('keydown-TAB', this.handleTab);
      kb.on('keydown-Q', this.handleQuickSwitch);
    }

    this.input.on('pointerdown', this.handlePointer);
    this.input.on('pointerup', () => {
      this.eatPointer = false;
    });

    this.touch = new TouchControls({
      onKickDown: () => this.handleSpace(),
      onKickUp: () => this.handlePassRelease(),
      onSwitch: () => this.handleTab(),
      onReady: () => this.whistle(),
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
    const touch = !!this.touch?.active && this.flow !== 'title';
    this.staminaBg?.setPosition(l, t);
    this.staminaFill?.setPosition(l + 2, t + 2);
    this.staminaLabel?.setPosition(l, t + 26);
    this.timerText?.setPosition(VIEW_W / 2, t);
    this.scoreText?.setPosition(VIEW_W / 2, t + 30);
    this.minimapBg?.setPosition(
      VIEW_W - MINIMAP_W / 2 - Math.max(MINIMAP_PAD, r),
      MINIMAP_H / 2 + Math.max(MINIMAP_PAD, t),
    );
    const promptY = touch ? VIEW_H - Math.max(176, b + 148) : VIEW_H - Math.max(56, b + 36);
    this.promptText?.setPosition(VIEW_W / 2, promptY);
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
    this.currentZoom = CAMERA_BASE_ZOOM + 0.22;
    this.pinCam(
      this.world.player.position.x,
      this.world.player.position.y,
      this.currentZoom,
    );
  }

  /**
   * Put world point (x,y) in the middle of the screen.
   * Raw scroll — centerOn + setBounds + shake left the body off-screen.
   */
  private pinCam(x: number, y: number, zoom: number): void {
    const cam = this.cameras.main;
    const z = Math.max(0.25, zoom);
    cam.setZoom(z);
    cam.scrollX = x - VIEW_W / (2 * z);
    cam.scrollY = y - VIEW_H / (2 * z);
  }

  private trackPlayer(_snap: boolean): void {
    const p = this.world.player;
    this.pinCam(
      p.position.x + p.velocity.x * CAMERA_LEAD,
      p.position.y + p.velocity.y * CAMERA_LEAD,
      this.currentZoom,
    );
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
    this.pinCam((minX + maxX) / 2, (minY + maxY) / 2, z);
  }

  private applyCamera(): void {
    if (this.flow === 'playing' && this.kickoffLeft > 0) {
      this.frameKickoff();
      return;
    }
    this.trackPlayer(true);
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
    for (let i = 0; i < 1800; i++) {
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
      if ('radius' in o) {
        this.mapGfx.fillStyle(PALETTE.buildingRoof, 1);
        this.mapGfx.fillCircle(o.position.x + 4, o.position.y - 6, o.radius);
        this.mapGfx.fillStyle(PALETTE.building, 1);
        this.mapGfx.fillCircle(o.position.x, o.position.y, o.radius);
        this.mapGfx.lineStyle(3, PALETTE.buildingEdge, 1);
        this.mapGfx.strokeCircle(o.position.x, o.position.y, o.radius);
      } else {
        const ox = o.position.x - o.width / 2;
        const oy = o.position.y - o.height / 2;
        this.mapGfx.fillStyle(PALETTE.buildingRoof, 1);
        this.mapGfx.fillRect(ox + 6, oy - 14, o.width, 18);
        this.mapGfx.fillStyle(PALETTE.building, 1);
        this.mapGfx.fillRect(ox, oy, o.width, o.height);
        this.mapGfx.lineStyle(3, PALETTE.buildingEdge, 1);
        this.mapGfx.strokeRect(ox, oy, o.width, o.height);
      }
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

  private handleSpace = (): void => {
    if (this.flow === 'title') {
      this.beginPlacement();
      return;
    }
    if (this.flow === 'placing') return;
    if (this.isPassing) return;
    if (!this.world.player.hasBall) return;
    this.isPassing = true;
    this.passChargeStartedAt = this.now();
    this.inputState.charging = true;
    if (this.teach === 'kick') this.teach = this.touch?.active ? 'goal' : 'sprint';
  };

  private handlePassRelease = (): void => {
    this.spaceReady = true;
    if (this.flow !== 'playing' || !this.isPassing) return;
    const chargeSeconds = (this.now() - this.passChargeStartedAt) / 1000;
    const moving = this.inputState.move.x !== 0 || this.inputState.move.y !== 0;
    const aim = moving ? { ...this.inputState.move } : { ...this.lastAim };
    releasePass(this.world, aim, chargeSeconds);
    this.isPassing = false;
    this.inputState.charging = false;
    this.trackPlayer(true);
  };

  private handleGoalTap = (): void => {
    if (this.flow !== 'playing') return;
    this.inputState.goalTap = true;
    if (this.teach === 'goal') this.teach = 'done';
  };

  private handleTab = (): void => {
    if (this.flow === 'title') return;
    if (this.flow === 'placing') {
      const mates = this.world.npcs.filter((n) => n.team === this.world.player.team);
      if (mates.length === 0) return;
      const idx = mates.findIndex((n) => n.id === this.placeTargetId);
      this.placeTargetId = mates[(idx + 1) % mates.length]!.id;
      this.flash('Place this one');
      return;
    }
    if (this.flow !== 'playing') return;
    const newId = cycleTeammate(this.world);
    if (newId) this.punchCamera();
  };

  private handleQuickSwitch = (): void => {
    if (this.flow !== 'playing') return;
    const newId = quickSwitch(this.world);
    if (newId) this.punchCamera();
    else this.flash('Already nearest the stone');
  };

  private handlePointer = (pointer: Phaser.Input.Pointer): void => {
    void unlockAudio();
    if (this.eatPointer) {
      this.eatPointer = false;
      return;
    }
    if (this.flow === 'title') {
      this.beginPlacement();
      return;
    }
    const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tappedMate = this.teammateAt(worldPt.x, worldPt.y);
    if (this.flow === 'placing') {
      if (tappedMate) {
        this.placeTargetId = tappedMate;
        this.flash('Place this one');
        return;
      }
      if (!this.placeTargetId) return;
      placeTeammate(this.world, this.placeTargetId, worldPt.x, worldPt.y);
      return;
    }
    if (this.flow !== 'playing') return;
    if (tappedMate) {
      if (switchControl(this.world, tappedMate)) this.punchCamera();
      return;
    }
    if (this.atStone() && this.millstoneHit(worldPt.x, worldPt.y)) {
      this.handleGoalTap();
    }
  };

  private teammateAt(x: number, y: number): string | null {
    const team = this.world.player.team;
    let bestId: string | null = null;
    let best = 48;
    for (const n of this.world.npcs) {
      if (n.team !== team) continue;
      const d = Math.hypot(n.position.x - x, n.position.y - y);
      const reach = n.radius * 2.4;
      if (d <= reach && d < best) {
        best = d;
        bestId = n.id;
      }
    }
    return bestId;
  }

  private millstoneHit(x: number, y: number): boolean {
    const g = opponentGoalFor(this.world.player.team, this.world.map);
    return Math.hypot(x - g.x, y - g.y) <= 48;
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
    this.promptText.setText(msg);
    this.feedbackUntil = this.now() + 900;
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

    this.render();
  }

  private readInput(): void {
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k) {
      if (k.W.isDown || k.UP.isDown) my -= 1;
      if (k.S.isDown || k.DOWN.isDown) my += 1;
      if (k.A.isDown || k.LEFT.isDown) mx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) mx += 1;
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
    this.inputState.sprint = !!k?.SHIFT.isDown;
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
    if (!this.world.player.hasBall) return false;
    const g = opponentGoalFor(this.world.player.team, this.world.map);
    const dx = this.world.player.position.x - g.x;
    const dy = this.world.player.position.y - g.y;
    // Same radius as tapGoal — no HUD slop that shows HOLD then eats taps.
    return Math.hypot(dx, dy) <= GOAL_REACH_DISTANCE;
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
    this.currentZoom += (targetZoom - this.currentZoom) * ZOOM_LERP;
    this.applyCamera();
    this.hudCam.setScroll(0, 0);

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
      this.promptText.setText('');
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
      this.promptText.setText(`Walk them out · ${this.placeCountdown()} · ${ready}`);
      return;
    }
    if (this.flow !== 'playing') {
      this.promptText.setText('');
      return;
    }
    if (this.kickoffLeft > 0) {
      const label = this.world.player.team === 0 ? "YOU ARE UP" : "YOU ARE DOWN";
      this.promptText.setText(`${label} — that way`);
      return;
    }

    if (this.atStone()) {
      const taps = this.world.goaling.taps;
      if (taps > this.lastGoalingTaps) {
      }
      this.lastGoalingTaps = taps;
      this.promptText.setText(this.touch?.active ? 'HOLD THE STONE — tap the millstone' : 'HOLD THE STONE');
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
      return;
    }

    if (this.teach === 'done' || this.now() - this.playStartedAt > TEACH_WINDOW_MS) {
      this.promptText.setText('');
      return;
    }
    const touch = !!this.touch?.active;
    const copy: Record<Teach, string> = {
      move: touch ? 'Stick — run' : 'WASD — run',
      ball: 'Get the stone',
      kick: touch ? 'Hold Kick' : 'Hold Space — kick',
      sprint: 'Shift — burst',
      goal: touch ? 'At their millstone, tap it' : 'At their millstone, tap E',
      done: '',
    };
    this.promptText.setText(copy[this.teach]);
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
    g.fillStyle(PALETTE.water, 0.9);
    g.fillRect(
      ox,
      oy + (map.river.position.y - map.river.height / 2) * sy,
      MINIMAP_W,
      map.river.height * sy,
    );

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
  }
}
