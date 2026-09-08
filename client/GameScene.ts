// client/GameScene.ts — Phaser scene. Pure render + input. All game logic lives in /sim.
//
// First-run: HUD lives on a zoom-1 camera (main zoom was swallowing scrollFactor(0)
// overlays). Kickoff is title → ~20s place-your-people → plinth throw-up. Who-am-I follows
// control. Scoring has HOLD THE STONE + pips + hit-stop.
// Phone (Chrome iOS / WebKit): DOM stick + kick/switch (see touch.ts); keyboard still drives Input.move.

import Phaser from 'phaser';
import {
  createWorld,
  cycleTeammate,
  DEFAULT_DIFFICULTY,
  formatDayClock,
  countHugNeighbors,
  hugPackExtent,
  isBuilding,
  isCivicBuilding,
  distToSegment,
  isBallAirborne,
  isCarrierAtOpponentGoal,
  isInHugZone,
  isNightfall,
  MILL_CLIFTON,
  moveControlled,
  nightfallAmount,
  opponentGoalFor,
  passChargeRatio,
  placeTeammate,
  quickSwitch,
  releasePass,
  RIP_MIN_STAMINA,
  scoringGoalMarker,
  startMatch,
  stepWorld,
  switchControl,
  teammateAtPoint,
  npcRipContest,
  wrestleMode,
  type Build,
  type Building,
  type Difficulty,
  type Input,
  type Obstacle,
  type Team,
  type World,
} from '../sim/index.js';
import { canvasSafePad, unlockAudio } from './shell.js';
import { resolveKickAim, shouldCommitAim, TouchControls } from './touch.js';

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
const PLACE_SPEED = 220;
const TEACH_WINDOW_MS = 30_000;

const PALETTE = {
  bg: 0x1a140c,
  grass: 0x3a4a28,
  grassAlt: 0x2f3e20,
  grassDark: 0x243218,
  fieldA: 0x3a4a28,
  fieldB: 0x2f3e20,
  fieldC: 0x243218,
  plough: 0x243218,
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
  cobbleEdge: 0x4a3e30,
  /** Dark UK carriageway — not pale grey, not US asphalt blue. */
  tarmac: 0x3a3228,
  tarmacWear: 0x2a2218,
  grit: 0x32281e,
  verge: 0x3a3c28,
  lampPole: 0x2a2218,
  lampHead: 0x3a3428,
  lampGlass: 0x6a5a40,
  lampGlow: 0xffe08a,
  church: 0x7a7670,
  churchAshlar: 0x8c8880,
  churchRoof: 0x3a3834,
  churchSpire: 0x2e2c28,
  schoolBrick: 0x8a4034,
  schoolStone: 0x9a8a78,
  schoolRoof: 0x3a2a22,
  hallStone: 0x7a7064,
  hallRoof: 0x3a3228,
  marketArch: 0x5a4a3a,
  trail: 0x6b5340,
  trailWear: 0x4a3a2c,
  trailEdge: 0x8a6a4a,
  tunnelDark: 0x1a1612,
  tunnelRing: 0x4a443c,
  greenMan: 0x3a6a32,
  bathsBlue: 0x3a6a78,
  window: 0x2a4050,
  windowLite: 0x8ab0c4,
  door: 0x2a1810,
  water: 0x2d4a5c,
  waterEdge: 0x1a3040,
  hedge: 0x1c3a16,
  hedgeLeaf: 0x3a6a28,
  hedgeEdge: 0x0c1a0a,
  bridge: 0x8a6844,
  stone: 0x8a8274,
  stoneLite: 0xb0a898,
  stoneDark: 0x5a5448,
  stoneMortar: 0x6e685c,
  archShadow: 0x1a2830,
  paint: 0xf2f4ee,
  paintWorn: 0xd8dcd0,
  oob: 0x2a2218,
  oobEdge: 0x120e0a,
  millstone: 0xe4d4a8,
  millstoneEdge: 0x4a3a1c,
  plinth: 0xb8a078,
  plinthDark: 0x6a5434,
  plinthEdge: 0x3a2a14,
  teamUp: 0x3d6eaa,
  teamUpTrim: 0xf5d76e,
  teamDown: 0x161616,
  teamDownEdge: 0xe8dcc8,
  /** Cream/ivory jersey — Down'ards kit, distinct from black trousers and hair. */
  teamDownKit: 0xe8dcc8,
  youRing: 0xfff6e8,
  /** Foot-mark fill — chevron (runner) vs block (hugger). Not a body bar. */
  kitCue: 0xf3ead4,
  ball: 0xf3ead4,
  ballEdge: 0x1a140c,
  shadow: 0x000000,
  staminaBg: 0x1a120c,
  staminaGood: 0xc4a35a,
  staminaLow: 0xc44a32,
} as const;

/** Visual overscale vs sim BALL_RADIUS (10). Physics diameter stays 20px. */
const BALL_DRAW_PX = 24;
const BALL_TEX = 'ball-24';
const BALL_ROLL_TEX = 'ball-roll-sheet';
const BALL_ROLL_ANIM = 'ball-roll';
/** Loose stone slower than this stays on the static floral frame. */
const BALL_ROLL_MIN_SPEED = 18;

/** Native art size. Physics stays PLAYER_RADIUS=16 / NPC_RADIUS=14. */
const PLAYER_SPRITE_PX = 40;
const NPC_SPRITE_PX = 32;
const POSE_RUN = 0;
const POSE_HUG = 1;
const TEX_UP_SHEET = 'player-upards-poses-40';
const TEX_DOWN_SHEET = 'player-downards-poses-40';
const TEX_UP_RUN_32 = 'player-upards-runner-32';
const TEX_UP_HUG_32 = 'player-upards-hug-32';
const TEX_DOWN_RUN_32 = 'player-downards-runner-32';
const TEX_DOWN_HUG_32 = 'player-downards-hug-32';
/** Neighbours in the stone-hug that flip runner → outstretched hug pose. */
const HUG_POSE_NEIGHBORS = 2;

/**
 * Tom-approved Ashbourne landmark art. Filenames match Building.id / PlaceMark.id
 * from sim/maps.ts. Layout (#40 footprints) stays; this is a client art swap.
 */
const LANDMARK_SPRITE_IDS = [
  'st-oswalds',
  'old-grammar',
  'market-hall',
  'town-hall',
  'the-baths',
  'the-tunnel',
  'tissington-trail',
  'henmore-brook',
  'market-place',
  'green-man',
] as const;

const LANDMARK_TEX_PREFIX = 'landmark-';
const LANDMARK_GROUND_DEPTH = 0.12;
const LANDMARK_BUILDING_DEPTH = 0.22;
const LANDMARK_SIGN_DEPTH = 0.32;

function landmarkTextureKey(id: string): string {
  return `${LANDMARK_TEX_PREFIX}${id}`;
}

/** Mitred offset polygon for a polyline strip (square ends, no round caps). */
function mitredStripPolygon(
  points: { x: number; y: number }[],
  width: number,
): { x: number; y: number }[] | null {
  if (points.length < 2 || width <= 0) return null;
  const hw = width / 2;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]!;
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    let ix = cur.x - prev.x;
    let iy = cur.y - prev.y;
    let ox = next.x - cur.x;
    let oy = next.y - cur.y;
    const il = Math.hypot(ix, iy);
    const ol = Math.hypot(ox, oy);
    if (i === 0 || il < 1e-6) {
      ix = ox;
      iy = oy;
    } else {
      ix /= il;
      iy /= il;
    }
    if (i === points.length - 1 || ol < 1e-6) {
      ox = ix;
      oy = iy;
    } else {
      ox /= ol;
      oy /= ol;
    }
    const inLen = Math.hypot(ix, iy) || 1;
    const outLen = Math.hypot(ox, oy) || 1;
    ix /= inLen;
    iy /= inLen;
    ox /= outLen;
    oy /= outLen;
    const inNx = -iy;
    const inNy = ix;
    const outNx = -oy;
    const outNy = ox;
    let mx = inNx + outNx;
    let my = inNy + outNy;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-4) {
      mx = inNx;
      my = inNy;
    } else {
      mx /= ml;
      my /= ml;
    }
    const dot = mx * inNx + my * inNy;
    const miter = Math.min(hw * 2.6, hw / Math.max(0.38, Math.abs(dot)));
    left.push({ x: cur.x + mx * miter, y: cur.y + my * miter });
    right.push({ x: cur.x - mx * miter, y: cur.y - my * miter });
  }
  return [...left, ...right.reverse()];
}

function buildTag(build: Build): string {
  return build === 'runner' ? 'RUNNER' : 'HUGGER';
}

const FONT = '"Palatino Linotype", Palatino, Georgia, serif';

type Flow = 'title' | 'placing' | 'playing';
type Teach = 'move' | 'build' | 'ball' | 'kick' | 'sprint' | 'breath' | 'goal' | 'done';

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
  build: Build;
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
  private shadowSprites = new Map<string, Phaser.GameObjects.Ellipse>();
  private personSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private buildLabels = new Map<string, Phaser.GameObjects.Text>();
  private lastFacing = new Map<string, { x: number; y: number }>();
  private ballSprite!: Phaser.GameObjects.Sprite;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballBlotch!: Phaser.GameObjects.Arc;
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
  private teamPickAbort: AbortController | null = null;
  private pipGfx!: Phaser.GameObjects.Graphics;
  private minimapBg!: Phaser.GameObjects.Rectangle;
  private minimapGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private lightGfx!: Phaser.GameObjects.Graphics;
  private windedOverlay!: Phaser.GameObjects.Rectangle;
  private feelBanner!: Phaser.GameObjects.Text;
  private kickLabel!: Phaser.GameObjects.Text;
  private followBtn!: Phaser.GameObjects.Text;

  private flow: Flow = 'title';
  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  private placeLeft = 0;
  private placeTargetId: string | null = null;
  private spaceReady = false;
  private eatPointer = false;
  private teach: Teach = 'move';
  private buildTeachAt = 0;
  private playStartedAt = 0;
  private hitStopLeft = 0;
  private lastGoalingTaps = 0;
  private scoredJuice = false;
  private feedbackUntil = 0;
  private lastThumpAt = 0;
  private lastWall = 0;
  private lastScore: [number, number] = [0, 0];
  private lastEventDay: 1 | 2 = 1;
  private lastStamina = 100;
  private windedUntil = 0;
  private nightfallShownDay = 0;
  private kickJuiceUntil = 0;
  private kickJuice = { x: 0, y: 0, ux: 1, uy: 0, power: 0 };
  private feelBannerUntil = 0;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    this.load.image(BALL_TEX, 'sprites/ball/ball-24.png');
    this.load.spritesheet(BALL_ROLL_TEX, 'sprites/ball/ball-roll-sheet-24.png', {
      frameWidth: BALL_DRAW_PX,
      frameHeight: BALL_DRAW_PX,
    });
    this.load.spritesheet(TEX_UP_SHEET, 'sprites/players/sheets/upards-poses-40.png', {
      frameWidth: PLAYER_SPRITE_PX,
      frameHeight: PLAYER_SPRITE_PX,
    });
    this.load.spritesheet(TEX_DOWN_SHEET, 'sprites/players/sheets/downards-poses-40.png', {
      frameWidth: PLAYER_SPRITE_PX,
      frameHeight: PLAYER_SPRITE_PX,
    });
    this.load.image(TEX_UP_RUN_32, 'sprites/players/play/upards-runner-32.png');
    this.load.image(TEX_UP_HUG_32, 'sprites/players/play/upards-hug-32.png');
    this.load.image(TEX_DOWN_RUN_32, 'sprites/players/play/downards-runner-32.png');
    this.load.image(TEX_DOWN_HUG_32, 'sprites/players/play/downards-hug-32.png');
    for (const id of LANDMARK_SPRITE_IDS) {
      this.load.image(landmarkTextureKey(id), `sprites/landmarks/${id}.png`);
    }
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
    this.difficulty = DEFAULT_DIFFICULTY;
    this.teach = 'move';
    this.buildTeachAt = 0;
    this.scoredJuice = false;
    this.lastGoalingTaps = 0;
    this.lastScore = [0, 0];
    this.lastEventDay = 1;
    this.lastStamina = 100;
    this.nightfallShownDay = 0;
    this.windedUntil = 0;
    this.kickJuiceUntil = 0;
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
      kb.on('keydown-E', () => {
        if (this.flow === 'title') this.setDifficulty('easy');
        else this.handleGoalTap();
      });
      kb.on('keydown-TAB', this.handleTab);
      kb.on('keydown-Q', this.handleQuickSwitch);
      kb.on('keydown-C', this.handleFollowToggle);
      kb.on('keydown-HOME', this.returnToFollow);
      kb.on('keydown-U', () => this.chooseTeam(0));
      kb.on('keydown-ONE', () => this.chooseTeam(0));
      kb.on('keydown-TWO', () => this.chooseTeam(1));
      kb.on('keydown-D', () => this.chooseTeam(1));
      kb.on('keydown-N', () => this.setDifficulty('normal'));
      kb.on('keydown-H', () => this.setDifficulty('hard'));
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
      this.teamPickAbort?.abort();
      this.teamPickAbort = null;
      this.setTeamPickVisible(false);
      this.touch?.dispose();
      this.touch = null;
    });
    this.scale.on('resize', this.layoutHud, this);
    window.visualViewport?.addEventListener('resize', this.layoutHud);

    this.textures.get(BALL_TEX).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get(BALL_ROLL_TEX).setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const key of [
      TEX_UP_SHEET,
      TEX_DOWN_SHEET,
      TEX_UP_RUN_32,
      TEX_UP_HUG_32,
      TEX_DOWN_RUN_32,
      TEX_DOWN_HUG_32,
      ...LANDMARK_SPRITE_IDS.map(landmarkTextureKey),
    ]) {
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    this.ensureBallRollAnim();

    this.drawMapStatic();
    this.createSprites();
    this.createHUD();
    this.bindTeamPick();
    this.setTeamPickVisible(true);

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
    this.kickLabel?.setPosition(l + 248, t + 44);
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

  /** Freeze-frame beat: the plinth throw-up, then the chase. */
  private frameKickoff(): void {
    const tu = this.world.map.turnUp;
    this.camFollow = true;
    this.pinCam(tu.x, tu.y - 20, 1.15);
  }

  private inKickoff(): boolean {
    return this.world.kickoffTimeRemaining > 0;
  }

  /** Early-goal recovery throw — same plinth ritual as kickoff, no sim timer. */
  private inRecoveryThrow(): boolean {
    return this.world.recoveryTimeRemaining > 0 && isBallAirborne(this.world);
  }

  private inPlinthThrow(): boolean {
    return this.inKickoff() || this.inRecoveryThrow();
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
    if (this.flow === 'playing' && this.inPlinthThrow()) {
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
    for (let i = 0; i < 2800; i++) {
      const x = rand() * map.width;
      const y = rand() * map.height;
      this.mapGfx.fillStyle(rand() > 0.5 ? PALETTE.grassAlt : PALETTE.grassDark, 0.28);
      this.mapGfx.fillRect(x, y, 8 + rand() * 26, 4 + rand() * 10);
    }
    this.drawFields(rand);

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

    this.drawApproachMud();

    const rx = map.river.position.x - map.river.width / 2;
    const ry = map.river.position.y - map.river.height / 2;
    this.mapGfx.fillStyle(PALETTE.water, 1);
    this.mapGfx.fillRect(rx, ry, map.river.width, map.river.height);
    this.mapGfx.fillStyle(PALETTE.waterEdge, 0.6);
    this.mapGfx.fillRect(rx, ry, map.river.width, 10);
    this.mapGfx.fillRect(rx, ry + map.river.height - 10, map.river.width, 10);

    this.drawStoneBridgeDecks();
    this.drawRoundaboutDiscs();
    this.drawRoads(rand);
    this.drawRoundaboutIslands();
    this.drawRoadMarkings();
    this.drawStoneBridgeParapets();
    this.drawMarketPlaza();
    this.drawTunnelPortal();
    this.drawPlaceSprites();

    for (const o of map.obstacles) {
      this.drawBuilding(o);
    }
    this.drawGreenManSign();
    this.drawLampPosts();
    this.drawPlaceLabels();

    for (const o of map.obstacles) {
      if (!isBuilding(o)) continue;
      const civic = isCivicBuilding(o);
      const oy = o.position.y - o.height / 2;
      const fasciaH = Math.min(18, o.height * 0.22);
      const sprite = this.hasLandmarkSprite(o.id);
      const labelY = civic
        ? oy - (o.kind === 'church' && !sprite ? 118 : 10)
        : oy + 4 + fasciaH * 0.5;
      const label = this.add
        .text(o.position.x, labelY, o.name.toUpperCase(), {
          fontFamily: FONT,
          fontSize: civic ? '15px' : o.kind === 'pub' ? '11px' : '10px',
          color: '#f3ead4',
          stroke: '#1a100a',
          strokeThickness: civic ? 5 : 3,
          align: 'center',
        })
        .setOrigin(0.5, civic ? 1 : 0.5)
        .setDepth(1);
      this.adoptWorld(label);
    }

    for (const g of map.goals) {
      this.drawMillstone(g.position.x, g.position.y, g.name);
      const label = this.add
        .text(g.position.x, g.position.y + 58, g.name.toUpperCase(), {
          fontFamily: FONT,
          fontSize: '22px',
          color: g.name === MILL_CLIFTON ? '#f3ead4' : '#f5d76e',
          stroke: '#1a100a',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5, 0)
        .setDepth(1);
      this.adoptWorld(label);
    }

    this.drawPlinth(map.turnUp.x, map.turnUp.y);

    this.mapGfx.lineStyle(3, 0x1a140c, 0.7);
    this.mapGfx.strokeRect(0, 0, map.width, map.height);
  }

  /** Worn mud toward the millstones — channels the approach, does not seal it. */
  private drawApproachMud(): void {
    const g = this.mapGfx;
    let s = 0x5a3d28;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const m of this.world.map.goals) {
      const towardMid = m.position.x < this.world.map.width * 0.5 ? 1 : -1;
      const x = m.position.x;
      const y = m.position.y;
      g.fillStyle(PALETTE.mud, 0.42);
      g.fillEllipse(x + towardMid * 90, y + 8, 280, 150);
      g.fillStyle(PALETTE.mudDark, 0.28);
      g.fillEllipse(x + towardMid * 40, y + 18, 160, 90);
      g.fillStyle(PALETTE.mud, 0.22);
      for (let i = 0; i < 18; i++) {
        const ox = (rand() - 0.5) * 240 + towardMid * 50;
        const oy = (rand() - 0.5) * 110;
        g.fillCircle(x + ox, y + oy, 8 + rand() * 16);
      }
    }
  }

  /** English hedge-bordered parcels — slightly different grass, faint plough. */
  private drawFields(rand: () => number): void {
    const g = this.mapGfx;
    const tints = [PALETTE.fieldA, PALETTE.fieldB, PALETTE.fieldC];
    for (let i = 0; i < this.world.map.fields.length; i++) {
      const f = this.world.map.fields[i]!;
      const x = f.position.x - f.width / 2;
      const y = f.position.y - f.height / 2;
      g.fillStyle(tints[i % tints.length]!, 1);
      g.fillRect(x, y, f.width, f.height);
      g.lineStyle(2, PALETTE.plough, 0.22);
      const rows = Math.max(4, Math.floor(f.height / 20));
      for (let r = 1; r < rows; r++) {
        const py = y + (r / rows) * f.height;
        g.lineBetween(x + 8, py, x + f.width - 8, py);
      }
      g.lineStyle(2, PALETTE.hedgeEdge, 0.15);
      g.strokeRect(x + 2, y + 2, f.width - 4, f.height - 4);
    }
  }

  /** Mitred UK lanes — square caps, no sausage round-ends. */
  private drawRoads(rand: () => number): void {
    const g = this.mapGfx;
    for (const road of this.world.map.roads) {
      const street = road.kind === 'street';
      const trail = road.kind === 'trail';
      this.drawMitredStrip(g, road.points, road.width + 14, trail ? PALETTE.trailEdge : PALETTE.verge, trail ? 0.4 : 0.55);
      this.drawMitredStrip(
        g,
        road.points,
        road.width,
        trail ? PALETTE.trail : street ? PALETTE.tarmac : PALETTE.grit,
        0.96,
      );
      this.drawMitredStrip(
        g,
        road.points,
        road.width * 0.36,
        trail ? PALETTE.trailWear : PALETTE.tarmacWear,
        trail ? 0.28 : street ? 0.2 : 0.14,
      );
      this.stippleRoad(g, road.points, road.width, rand);
    }
  }

  /** Closed mitred polygon — joints meet square, ends are butt-capped. */
  private drawMitredStrip(
    g: Phaser.GameObjects.Graphics,
    points: { x: number; y: number }[],
    width: number,
    color: number,
    alpha: number,
  ): void {
    const poly = mitredStripPolygon(points, width);
    if (!poly || poly.length < 4) return;
    g.fillStyle(color, alpha);
    g.beginPath();
    g.moveTo(poly[0]!.x, poly[0]!.y);
    for (let i = 1; i < poly.length; i++) {
      g.lineTo(poly[i]!.x, poly[i]!.y);
    }
    g.closePath();
    g.fillPath();
  }

  /** Sparse grit — texture without a grid of seams. */
  private stippleRoad(
    g: Phaser.GameObjects.Graphics,
    points: { x: number; y: number }[],
    width: number,
    rand: () => number,
  ): void {
    g.fillStyle(PALETTE.tarmacWear, 0.16);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.floor(len / 36));
      for (let k = 0; k < n; k++) {
        const t = (k + rand()) / (n + 1);
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const ox = (rand() - 0.5) * width * 0.5;
        const oy = (rand() - 0.5) * width * 0.32;
        g.fillEllipse(x + ox, y + oy, 6 + rand() * 10, 3 + rand() * 4);
      }
    }
  }

  private drawRoundaboutDiscs(): void {
    const g = this.mapGfx;
    for (const rbt of this.world.map.roundabouts) {
      g.fillStyle(PALETTE.verge, 0.55);
      g.fillCircle(rbt.position.x, rbt.position.y, rbt.radius + 8);
      g.fillStyle(PALETTE.tarmac, 1);
      g.fillCircle(rbt.position.x, rbt.position.y, rbt.radius);
    }
  }

  private drawRoundaboutIslands(): void {
    const g = this.mapGfx;
    for (const rbt of this.world.map.roundabouts) {
      g.fillStyle(PALETTE.grass, 1);
      g.fillCircle(rbt.position.x, rbt.position.y, rbt.island);
      g.fillStyle(PALETTE.cobble, 0.45);
      g.fillCircle(rbt.position.x, rbt.position.y, rbt.island * 0.72);
      g.fillStyle(PALETTE.hedgeLeaf, 0.7);
      g.fillCircle(rbt.position.x, rbt.position.y, rbt.island * 0.32);
      g.lineStyle(3, PALETTE.paint, 0.95);
      g.strokeCircle(rbt.position.x, rbt.position.y, rbt.island + 3);
    }
  }

  /** UK lane paint: broken white centre, optional edge, give-way dashes on the minor arm. */
  private drawRoadMarkings(): void {
    const g = this.mapGfx;
    const map = this.world.map;
    for (const road of map.roads) {
      if (road.kind === 'trail') continue;
      this.dashCentreLine(g, road.points);
      if (road.kind === 'street') this.strokeEdgeLines(g, road.points, road.width);
      this.paintGiveWays(g, road, map.roads, map.roundabouts);
    }
    for (const rbt of map.roundabouts) {
      g.lineStyle(4, PALETTE.paintWorn, 0.9);
      g.strokeCircle(rbt.position.x, rbt.position.y, rbt.radius - 6);
    }
  }

  private dashCentreLine(
    g: Phaser.GameObjects.Graphics,
    points: { x: number; y: number }[],
  ): void {
    // Fat enough to read at ~0.35× camera zoom; UK broken white, not US yellow.
    const on = 28;
    const off = 20;
    const hw = 3.6;
    let phase = 0;
    g.fillStyle(PALETTE.paint, 0.95);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      let d = 0;
      while (d < len) {
        const cycle = on + off;
        const pos = (phase + d) % cycle;
        if (pos < on) {
          const remain = Math.min(on - pos, len - d, 22);
          const x0 = a.x + ux * d;
          const y0 = a.y + uy * d;
          const x1 = a.x + ux * (d + remain);
          const y1 = a.y + uy * (d + remain);
          g.beginPath();
          g.moveTo(x0 + nx * hw, y0 + ny * hw);
          g.lineTo(x1 + nx * hw, y1 + ny * hw);
          g.lineTo(x1 - nx * hw, y1 - ny * hw);
          g.lineTo(x0 - nx * hw, y0 - ny * hw);
          g.closePath();
          g.fillPath();
          d += remain;
        } else {
          d += Math.min(cycle - pos, len - d);
        }
      }
      phase = (phase + len) % (on + off);
    }
  }

  /** Thin solid white kerb line on streets — skipped on lanes/trails so zoom stays quiet. */
  private strokeEdgeLines(
    g: Phaser.GameObjects.Graphics,
    points: { x: number; y: number }[],
    width: number,
  ): void {
    const inset = width * 0.42;
    g.lineStyle(3, PALETTE.paintWorn, 0.55);
    for (const side of [-1, 1]) {
      g.beginPath();
      let started = false;
      for (let i = 0; i < points.length; i++) {
        const cur = points[i]!;
        const prev = points[Math.max(0, i - 1)]!;
        const next = points[Math.min(points.length - 1, i + 1)]!;
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * inset * side;
        const ny = (dx / len) * inset * side;
        if (!started) {
          g.moveTo(cur.x + nx, cur.y + ny);
          started = true;
        } else {
          g.lineTo(cur.x + nx, cur.y + ny);
        }
      }
      g.strokePath();
    }
  }

  private paintGiveWays(
    g: Phaser.GameObjects.Graphics,
    road: { points: { x: number; y: number }[]; width: number },
    roads: { points: { x: number; y: number }[]; width: number }[],
    roundabouts: { position: { x: number; y: number }; radius: number }[],
  ): void {
    if (road.points.length < 2) return;
    const ends = [
      { p: road.points[0]!, q: road.points[1]! },
      { p: road.points[road.points.length - 1]!, q: road.points[road.points.length - 2]! },
    ];
    for (const end of ends) {
      let junction = false;
      for (const other of roads) {
        if (other === road || other.points === road.points) continue;
        for (let i = 0; i < other.points.length - 1; i++) {
          if (distToSegment(end.p, other.points[i]!, other.points[i + 1]!) <= other.width / 2 + 8) {
            const d0 = Math.hypot(end.p.x - other.points[0]!.x, end.p.y - other.points[0]!.y);
            const last = other.points[other.points.length - 1]!;
            const d1 = Math.hypot(end.p.x - last.x, end.p.y - last.y);
            if (d0 > other.width && d1 > other.width) junction = true;
          }
        }
      }
      for (const rbt of roundabouts) {
        const d = Math.hypot(end.p.x - rbt.position.x, end.p.y - rbt.position.y);
        if (Math.abs(d - rbt.radius) < 16) junction = true;
      }
      if (!junction) continue;
      const dx = end.p.x - end.q.x;
      const dy = end.p.y - end.q.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const back = road.width * 0.55;
      const cx = end.p.x - ux * back;
      const cy = end.p.y - uy * back;
      const half = road.width * 0.38;
      g.fillStyle(PALETTE.paint, 0.95);
      for (const offset of [-6, 6]) {
        const ox = cx + ux * offset;
        const oy = cy + uy * offset;
        this.paintDashRow(g, ox, oy, nx, ny, half);
      }
    }
  }

  private paintDashRow(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    nx: number,
    ny: number,
    half: number,
  ): void {
    const dash = 7;
    const gap = 5;
    let t = -half;
    while (t < half) {
      const a = t;
      const b = Math.min(t + dash, half);
      g.beginPath();
      g.moveTo(x + nx * a, y + ny * a - 2.4);
      g.lineTo(x + nx * b, y + ny * b - 2.4);
      g.lineTo(x + nx * b, y + ny * b + 2.4);
      g.lineTo(x + nx * a, y + ny * a + 2.4);
      g.closePath();
      g.fillPath();
      t += dash + gap;
    }
  }

  /** Stone packhorse decks + river arches, before the roadway paint. */
  private drawStoneBridgeDecks(): void {
    const g = this.mapGfx;
    for (const b of this.world.map.bridges) {
      const x = b.position.x;
      const y = b.position.y;
      const w = b.width;
      const h = b.height;
      const bx = x - w / 2;
      const by = y - h / 2;
      const parapet = 28;
      // Arch voids in the Henmore — water showing under a single packhorse span.
      g.fillStyle(PALETTE.archShadow, 0.92);
      g.fillEllipse(x, y + 4, w * 0.72, h * 0.78);
      g.fillStyle(PALETTE.water, 0.7);
      g.fillEllipse(x, y + 6, w * 0.5, 22);
      // Bank abutments
      g.fillStyle(PALETTE.stoneDark, 1);
      g.fillRect(bx - 18, by - 16, w + 36, 28);
      g.fillRect(bx - 18, by + h - 12, w + 36, 28);
      g.fillStyle(PALETTE.stone, 1);
      g.fillRect(bx - 12, by - 12, w + 24, 18);
      g.fillRect(bx - 12, by + h - 6, w + 24, 18);
      // Walkable stone cheeks beside the tarmac (not a full plank deck).
      g.fillStyle(PALETTE.stone, 1);
      g.fillRect(bx, by, parapet + 6, h);
      g.fillRect(bx + w - parapet - 6, by, parapet + 6, h);
      g.lineStyle(2, PALETTE.stoneMortar, 0.75);
      for (let py = by + 6; py < by + h; py += 14) {
        g.lineBetween(bx + 3, py, bx + parapet + 2, py);
        g.lineBetween(bx + w - parapet - 2, py, bx + w - 3, py);
      }
      g.lineStyle(4, PALETTE.stoneDark, 0.9);
      g.beginPath();
      g.arc(x, y + 10, w * 0.34, Math.PI * 1.05, -0.05, false);
      g.strokePath();
    }
  }

  /** Chunkier stone parapets + cutwaters after the lane so the roadway stays continuous. */
  private drawStoneBridgeParapets(): void {
    const g = this.mapGfx;
    for (const b of this.world.map.bridges) {
      const x = b.position.x;
      const y = b.position.y;
      const w = b.width;
      const h = b.height;
      const parapet = 22;
      const bx = x - w / 2;
      const by = y - h / 2;
      const drawWall = (wx: number): void => {
        g.fillStyle(PALETTE.stoneDark, 1);
        g.fillRect(wx - 3, by - 10, parapet + 6, h + 20);
        g.fillStyle(PALETTE.stone, 1);
        g.fillRect(wx, by - 6, parapet, h + 12);
        g.lineStyle(1.5, PALETTE.stoneMortar, 0.8);
        for (let py = by; py < by + h; py += 11) {
          g.lineBetween(wx + 2, py, wx + parapet - 2, py);
        }
        for (let i = 0; i < 3; i++) {
          g.lineBetween(wx + 4 + i * 6, by, wx + 4 + i * 6, by + h);
        }
        g.fillStyle(PALETTE.stoneLite, 1);
        g.fillRect(wx - 3, by - 10, parapet + 6, 7);
        g.fillRect(wx - 3, by + h + 3, parapet + 6, 7);
        for (let py = by + 10; py < by + h - 4; py += 26) {
          g.fillRect(wx - 5, py, parapet + 10, 9);
        }
      };
      drawWall(bx);
      drawWall(bx + w - parapet);
      // Cutwaters pointing upstream / downstream.
      g.fillStyle(PALETTE.stoneLite, 1);
      g.fillTriangle(bx - 10, y, bx + 12, y - 22, bx + 12, y + 22);
      g.fillTriangle(bx + w + 10, y, bx + w - 12, y - 22, bx + w - 12, y + 22);
      g.fillStyle(PALETTE.stoneDark, 0.85);
      g.fillCircle(bx + 8, y, 7);
      g.fillCircle(bx + w - 8, y, 7);
    }
  }

  /** Daytime lamp posts. Glow is drawn on the HUD veil at Nightfall. */
  private drawLampPosts(): void {
    const g = this.mapGfx;
    for (const lamp of this.world.map.streetLights) {
      const x = lamp.position.x;
      const y = lamp.position.y;
      g.fillStyle(PALETTE.shadow, 0.28);
      g.fillEllipse(x + 2, y + 6, 10, 5);
      g.fillStyle(PALETTE.lampPole, 1);
      g.fillRect(x - 2, y - 18, 4, 22);
      g.fillStyle(PALETTE.lampHead, 1);
      g.fillRect(x - 6, y - 26, 12, 10);
      g.fillStyle(PALETTE.lampGlass, 0.85);
      g.fillRect(x - 4, y - 24, 8, 6);
    }
  }

  /** Sturston (Up goal) blue/yellow hoops; Clifton (Down goal) black. */
  private drawMillstone(x: number, y: number, name: string): void {
    const g = this.mapGfx;
    if (name === MILL_CLIFTON) {
      g.lineStyle(11, PALETTE.teamDownEdge, 0.95);
      g.strokeCircle(x, y, 42);
      g.lineStyle(8, PALETTE.teamDown, 1);
      g.strokeCircle(x, y, 42);
    } else {
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
        g.lineStyle(10, i % 2 === 0 ? PALETTE.teamUp : PALETTE.teamUpTrim, 0.95);
        g.beginPath();
        g.arc(x, y, 42, a0, a1, false);
        g.strokePath();
      }
    }
    g.fillStyle(PALETTE.millstone, 1);
    g.fillCircle(x, y, 22);
    g.lineStyle(4, PALETTE.millstoneEdge, 1);
    g.strokeCircle(x, y, 22);
    g.strokeCircle(x, y, 12);
    g.fillStyle(PALETTE.millstoneEdge, 1);
    g.fillCircle(x, y, 4);
  }

  /** Placeholder Ashbourne turn-up plinth — render only, no collision. */
  private drawPlinth(x: number, y: number): void {
    const g = this.mapGfx;
    g.fillStyle(PALETTE.plinthDark, 0.55);
    g.fillEllipse(x + 2, y + 18, 54, 22);
    g.fillStyle(PALETTE.plinthDark, 1);
    g.fillRoundedRect(x - 22, y - 6, 44, 28, 4);
    g.fillStyle(PALETTE.plinth, 1);
    g.fillRoundedRect(x - 24, y - 18, 48, 22, 5);
    g.lineStyle(3, PALETTE.plinthEdge, 0.95);
    g.strokeRoundedRect(x - 24, y - 18, 48, 22, 5);
    g.lineStyle(2, PALETTE.millstone, 0.5);
    g.strokeRoundedRect(x - 18, y - 12, 36, 10, 3);
    g.fillStyle(PALETTE.millstone, 0.35);
    g.fillCircle(x, y - 8, 6);
  }

  /** Native pixel size of a loaded landmark texture, or null. */
  private landmarkNativeSize(id: string): { w: number; h: number } | null {
    const key = landmarkTextureKey(id);
    if (!this.textures.exists(key)) return null;
    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
    if (!src?.width || !src?.height) return null;
    return { w: src.width, h: src.height };
  }

  private hasLandmarkSprite(id: string): boolean {
    return this.textures.exists(landmarkTextureKey(id));
  }

  /**
   * Landmark art centered on the #40 footprint. Collision stays on the sim rect;
   * this only swaps what the player sees.
   */
  private placeLandmarkSprite(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    depth: number,
  ): Phaser.GameObjects.Image | null {
    const key = landmarkTextureKey(id);
    if (!this.textures.exists(key)) return null;
    const img = this.add.image(x, y, key).setDepth(depth);
    img.setOrigin(0.5, 0.5);
    img.setDisplaySize(width, height);
    this.adoptWorld(img);
    return img;
  }

  /** Brook / trail / plaza / tunnel cues — places have no collision box, so size to native art. */
  private drawPlaceSprites(): void {
    for (const p of this.world.map.places) {
      if (p.kind === 'inn-sign') continue;
      const size = this.landmarkNativeSize(p.id);
      if (!size) continue;
      this.placeLandmarkSprite(
        p.id,
        p.position.x,
        p.position.y,
        size.w,
        size.h,
        LANDMARK_GROUND_DEPTH,
      );
    }
  }

  /** Hanging inn sign beside The Green Man — overlay, not a building footprint. */
  private drawGreenManSign(): void {
    const size = this.landmarkNativeSize('green-man');
    if (!size) return;
    const pub = this.world.map.obstacles.find((o): o is Building => isBuilding(o) && o.id === 'the-green-man');
    const mark = this.world.map.places.find((p) => p.id === 'green-man');
    const x = pub ? pub.position.x + pub.width / 2 + size.w * 0.42 : (mark?.position.x ?? 0) + 36;
    const y = pub ? pub.position.y - pub.height * 0.18 : (mark?.position.y ?? 0) - 18;
    this.placeLandmarkSprite('green-man', x, y, size.w, size.h, LANDMARK_SIGN_DEPTH);
  }

  /** Timber-framed pub, brick shop, or civic massing — art keys off `id`. */
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
    if (isBuilding(o) && this.hasLandmarkSprite(o.id)) {
      this.placeLandmarkSprite(
        o.id,
        o.position.x,
        o.position.y,
        o.width,
        o.height,
        LANDMARK_BUILDING_DEPTH,
      );
      return;
    }
    if (isBuilding(o)) {
      if (o.kind === 'church') {
        this.drawChurch(o);
        return;
      }
      if (o.kind === 'school') {
        this.drawSchool(o);
        return;
      }
      if (o.kind === 'market') {
        this.drawMarketHall(o);
        return;
      }
      if (o.kind === 'hall') {
        this.drawTownHall(o);
        return;
      }
      if (o.kind === 'trailhead') {
        this.drawTrailhead(o);
        return;
      }
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
      const greenMan = isBuilding(o) && o.id === 'the-green-man';
      if (!(greenMan && this.hasLandmarkSprite('green-man'))) {
        const hx = ox + o.width + 4;
        g.lineStyle(3, PALETTE.timberBeam, 1);
        g.lineBetween(hx, oy + 6, hx, oy + (greenMan ? 40 : 28));
        if (greenMan) {
          // Hanging inn sign — Green Man homage, not a crest.
          g.fillStyle(PALETTE.pubFascia, 1);
          g.fillRoundedRect(hx - 22, oy + 38, 44, 36, 4);
          g.lineStyle(3, PALETTE.pubSign, 1);
          g.strokeRoundedRect(hx - 22, oy + 38, 44, 36, 4);
          g.fillStyle(PALETTE.greenMan, 1);
          g.fillCircle(hx, oy + 54, 10);
          g.fillStyle(PALETTE.hedgeLeaf, 0.95);
          g.fillCircle(hx - 9, oy + 50, 5);
          g.fillCircle(hx + 9, oy + 50, 5);
          g.fillCircle(hx, oy + 44, 5);
        } else {
          g.fillStyle(PALETTE.pubFascia, 1);
          g.fillRoundedRect(hx - 16, oy + 26, 32, 22, 3);
          g.lineStyle(2, PALETTE.pubSign, 1);
          g.strokeRoundedRect(hx - 16, oy + 26, 32, 22, 3);
          g.fillStyle(PALETTE.pubSign, 1);
          g.fillCircle(hx, oy + 37, 5);
        }
      }
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

  /** St Oswald's–inspired nave + tall recessed spire. Collision is the nave; spire is massing. */
  private drawChurch(o: Building): void {
    const g = this.mapGfx;
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    const cx = o.position.x;
    g.fillStyle(PALETTE.cobble, 0.3);
    g.fillRect(ox - 8, oy + o.height - 4, o.width + 16, 12);
    g.fillStyle(PALETTE.church, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(2, PALETTE.churchAshlar, 0.55);
    for (let y = oy + 10; y < oy + o.height - 6; y += 10) {
      g.lineBetween(ox + 3, y, ox + o.width - 3, y);
    }
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);
    g.fillStyle(PALETTE.churchRoof, 1);
    g.fillTriangle(ox - 8, oy + 6, cx + 10, oy - 28, ox + o.width + 4, oy + 6);
    const tx = ox + o.width * 0.18;
    const tw = Math.max(28, o.width * 0.22);
    g.fillStyle(PALETTE.churchAshlar, 1);
    g.fillRect(tx, oy - 92, tw, 98);
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(tx, oy - 92, tw, 98);
    const mid = tx + tw / 2;
    g.fillStyle(PALETTE.window, 1);
    g.fillRect(mid - 6, oy - 78, 12, 22);
    g.lineStyle(1, PALETTE.timberBeam, 0.8);
    g.lineBetween(mid, oy - 78, mid, oy - 56);
    g.fillStyle(PALETTE.churchSpire, 1);
    g.fillTriangle(tx - 10, oy - 90, mid, oy - 168, tx + tw + 10, oy - 90);
    g.fillStyle(PALETTE.churchRoof, 1);
    g.fillTriangle(tx - 4, oy - 90, mid, oy - 118, tx + tw + 4, oy - 90);
    g.fillStyle(PALETTE.pubSign, 0.95);
    g.fillCircle(mid, oy - 172, 4);
    g.lineStyle(2, PALETTE.pubSign, 1);
    g.lineBetween(mid, oy - 172, mid + 8, oy - 180);
    const pane = (px: number, py: number, w: number, h: number): void => {
      g.fillStyle(PALETTE.window, 1);
      g.fillRect(px, py, w, h);
      g.fillStyle(PALETTE.windowLite, 0.28);
      g.fillRect(px + 1, py + 1, w * 0.4, h * 0.35);
      g.lineStyle(1, PALETTE.timberBeam, 0.85);
      g.lineBetween(px + w / 2, py, px + w / 2, py + h);
      g.strokeRect(px, py, w, h);
    };
    pane(ox + o.width * 0.48, oy + o.height * 0.28, 14, 22);
    pane(ox + o.width * 0.68, oy + o.height * 0.28, 14, 22);
    pane(ox + o.width * 0.86, oy + o.height * 0.28, 14, 22);
    const doorW = 18;
    const doorH = Math.min(32, o.height * 0.42);
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(cx + 8, oy + o.height - doorH - 2, doorW, doorH);
    g.lineStyle(2, PALETTE.timberBeam, 1);
    g.strokeRect(cx + 8, oy + o.height - doorH - 2, doorW, doorH);
  }

  /** Old Grammar School–inspired hall — brick range + bellcote, no crest. */
  private drawSchool(o: Building): void {
    const g = this.mapGfx;
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    g.fillStyle(PALETTE.cobble, 0.28);
    g.fillRect(ox - 10, oy + o.height - 4, o.width + 20, 14);
    g.fillStyle(PALETTE.schoolRoof, 1);
    g.fillRect(ox - 4, oy - 16, o.width + 8, 20);
    g.fillTriangle(ox - 8, oy - 4, o.position.x, oy - 28, ox + o.width + 8, oy - 4);
    g.fillStyle(PALETTE.schoolStone, 1);
    g.fillRect(o.position.x - 8, oy - 40, 16, 18);
    g.fillStyle(PALETTE.pubSign, 0.85);
    g.fillCircle(o.position.x, oy - 44, 4);
    g.fillStyle(PALETTE.schoolBrick, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(1, PALETTE.brickLine, 0.6);
    for (let y = oy + 6; y < oy + o.height - 4; y += 7) {
      g.lineBetween(ox + 2, y, ox + o.width - 2, y);
    }
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);
    g.fillStyle(PALETTE.schoolStone, 1);
    g.fillRect(ox + 4, oy + 4, o.width - 8, 12);
    const winW = 10;
    const winH = 16;
    const count = Math.max(4, Math.floor(o.width / 28));
    for (let i = 0; i < count; i++) {
      const px = ox + 12 + i * ((o.width - 24) / count);
      g.fillStyle(PALETTE.window, 1);
      g.fillRect(px, oy + o.height * 0.38, winW, winH);
      g.fillStyle(PALETTE.windowLite, 0.25);
      g.fillRect(px + 1, oy + o.height * 0.38 + 1, 4, 6);
    }
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(o.position.x - 10, oy + o.height - 28, 20, 26);
    g.lineStyle(2, PALETTE.timberBeam, 1);
    g.strokeRect(o.position.x - 10, oy + o.height - 28, 20, 26);
  }

  /** Market Hall — arched arcade under an upper hall. */
  private drawMarketHall(o: Building): void {
    const g = this.mapGfx;
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    g.fillStyle(PALETTE.cobble, 0.4);
    g.fillRect(ox - 12, oy + o.height - 2, o.width + 24, 16);
    g.fillStyle(PALETTE.hallRoof, 1);
    g.fillRect(ox - 2, oy - 14, o.width + 4, 18);
    g.fillStyle(PALETTE.hallStone, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);
    g.fillStyle(PALETTE.shopFascia, 1);
    g.fillRect(ox + 4, oy + 4, o.width - 8, 16);
    const arches = 3;
    const aw = (o.width - 16) / arches;
    for (let i = 0; i < arches; i++) {
      const ax = ox + 8 + i * aw;
      const ay = oy + o.height * 0.42;
      g.fillStyle(PALETTE.marketArch, 1);
      g.fillRect(ax + 4, ay, aw - 10, o.height * 0.5);
      g.fillStyle(PALETTE.oob, 0.55);
      g.fillCircle(ax + aw / 2, ay + 8, (aw - 12) / 2);
      g.fillRect(ax + 6, ay + 8, aw - 14, o.height * 0.42);
    }
    g.fillStyle(PALETTE.window, 1);
    g.fillRect(ox + o.width * 0.2, oy + 22, 12, 12);
    g.fillRect(ox + o.width * 0.7, oy + 22, 12, 12);
  }

  /** Town Hall massing — clock pediment, civic steps. */
  private drawTownHall(o: Building): void {
    const g = this.mapGfx;
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    g.fillStyle(PALETTE.cobble, 0.35);
    g.fillRect(ox - 8, oy + o.height - 2, o.width + 16, 14);
    g.fillStyle(PALETTE.hallRoof, 1);
    g.fillTriangle(ox - 6, oy + 4, o.position.x, oy - 26, ox + o.width + 6, oy + 4);
    g.fillStyle(PALETTE.hallStone, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);
    g.fillStyle(PALETTE.schoolStone, 1);
    g.fillRect(ox + 6, oy + 6, o.width - 12, 18);
    g.fillStyle(PALETTE.millstone, 0.9);
    g.fillCircle(o.position.x, oy + 15, 7);
    g.fillStyle(PALETTE.buildingEdge, 1);
    g.fillCircle(o.position.x, oy + 15, 2);
    g.fillStyle(PALETTE.window, 1);
    g.fillRect(ox + o.width * 0.18, oy + o.height * 0.4, 14, 16);
    g.fillRect(ox + o.width * 0.7, oy + o.height * 0.4, 14, 16);
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(o.position.x - 10, oy + o.height - 30, 20, 28);
    g.fillStyle(PALETTE.schoolStone, 1);
    g.fillRect(o.position.x - 16, oy + o.height - 6, 32, 6);
    g.fillRect(o.position.x - 20, oy + o.height - 2, 40, 5);
  }

  /** Leisure-centre / trailhead cue beside the Tissington Trail. */
  private drawTrailhead(o: Building): void {
    const g = this.mapGfx;
    const ox = o.position.x - o.width / 2;
    const oy = o.position.y - o.height / 2;
    g.fillStyle(PALETTE.trail, 0.35);
    g.fillRect(ox - 14, oy + o.height - 2, o.width + 40, 16);
    g.fillStyle(PALETTE.hallRoof, 1);
    g.fillRect(ox - 2, oy - 10, o.width + 4, 14);
    g.fillStyle(PALETTE.schoolStone, 1);
    g.fillRect(ox, oy, o.width, o.height);
    g.lineStyle(3, PALETTE.buildingEdge, 1);
    g.strokeRect(ox, oy, o.width, o.height);
    g.fillStyle(PALETTE.bathsBlue, 0.85);
    g.fillRect(ox + 8, oy + 10, o.width - 16, o.height * 0.32);
    g.fillStyle(PALETTE.windowLite, 0.35);
    g.fillRect(ox + 10, oy + 12, o.width - 20, 8);
    g.fillStyle(PALETTE.door, 1);
    g.fillRect(o.position.x - 8, oy + o.height - 22, 16, 20);
    const px = ox + o.width + 10;
    g.fillStyle(PALETTE.timberBeam, 1);
    g.fillRect(px, oy + 8, 4, 36);
    g.fillStyle(PALETTE.trailEdge, 1);
    g.fillTriangle(px + 4, oy + 10, px + 22, oy + 18, px + 4, oy + 26);
  }

  /** Market Place cobbles — triangular Ashbourne square. Hug still crosses. */
  private drawMarketPlaza(): void {
    const mark = this.world.map.places.find((p) => p.kind === 'plaza');
    if (!mark) return;
    const g = this.mapGfx;
    g.fillStyle(PALETTE.cobble, 0.5);
    g.fillTriangle(
      mark.position.x - 110,
      mark.position.y + 78,
      mark.position.x + 128,
      mark.position.y + 62,
      mark.position.x + 8,
      mark.position.y - 88,
    );
    g.fillStyle(PALETTE.cobbleEdge, 0.32);
    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      g.fillRect(mark.position.x - 70 + t * 150, mark.position.y - 20 + (i % 3) * 18, 14, 5);
    }
  }

  /** Tissington Trail tunnel mouth — hillside cutting, not a tourist maze. */
  private drawTunnelPortal(): void {
    const mark = this.world.map.places.find((p) => p.kind === 'tunnel');
    if (!mark || this.hasLandmarkSprite(mark.id)) return;
    const g = this.mapGfx;
    const x = mark.position.x;
    const y = mark.position.y;
    g.fillStyle(PALETTE.grassDark, 1);
    g.fillEllipse(x, y + 8, 90, 48);
    g.fillStyle(PALETTE.hedge, 0.85);
    g.fillEllipse(x - 38, y + 4, 28, 22);
    g.fillEllipse(x + 38, y + 4, 28, 22);
    g.fillStyle(PALETTE.tunnelRing, 1);
    g.fillCircle(x, y + 6, 28);
    g.fillStyle(PALETTE.tunnelDark, 1);
    g.fillCircle(x, y + 8, 20);
    g.fillRect(x - 20, y + 8, 40, 22);
    g.lineStyle(3, PALETTE.buildingEdge, 0.8);
    g.strokeCircle(x, y + 6, 28);
    g.fillStyle(PALETTE.trail, 0.9);
    g.fillRect(x - 12, y + 26, 24, 16);
  }

  /** Place names that orient the parish — homage labels, not wayfinding to real doors. */
  private drawPlaceLabels(): void {
    for (const p of this.world.map.places) {
      if (p.kind === 'inn-sign') continue;
      const size = p.kind === 'brook' || p.kind === 'trail' ? '16px' : '14px';
      const art = this.landmarkNativeSize(p.id);
      const lift = art
        ? -(art.h / 2 + 8)
        : p.kind === 'tunnel'
          ? -36
          : p.kind === 'brook'
            ? -6
            : -18;
      const label = this.add
        .text(p.position.x, p.position.y + lift, p.name.toUpperCase(), {
          fontFamily: FONT,
          fontSize: size,
          color: p.kind === 'brook' ? '#c8dce8' : '#f3ead4',
          stroke: '#1a100a',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5, 1)
        .setDepth(1);
      this.adoptWorld(label);
    }
  }

  /** Churchyard graves — St Oswald's massing is the civic footprint south of the yard. */
  private dressChurchyard(z: { position: { x: number; y: number }; width: number; height: number }): void {
    const g = this.mapGfx;
    const cx = z.position.x;
    const cy = z.position.y;
    g.fillStyle(PALETTE.hedgeLeaf, 0.45);
    g.fillCircle(cx - 70, cy - 20, 22);
    g.fillCircle(cx + 64, cy - 8, 18);
    g.fillStyle(PALETTE.churchRoof, 1);
    g.fillRect(cx - 6, cy - 28, 12, 22);
    g.fillTriangle(cx - 10, cy - 28, cx, cy - 42, cx + 10, cy - 28);
    for (let i = 0; i < 6; i++) {
      const gx = cx - 58 + i * 20;
      const gy = cy + 28;
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
        .ellipse(ch.x, ch.y + ch.radius * 0.7, ch.radius * 1.8, ch.radius * 0.7, PALETTE.shadow, 0.32)
        .setDepth(1);
      this.shadowSprites.set(ch.id, shadow);
      this.adoptWorld(shadow);
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

    this.ballSprite = this.add
      .sprite(this.world.ball.position.x, this.world.ball.position.y, BALL_TEX)
      .setDisplaySize(BALL_DRAW_PX, BALL_DRAW_PX)
      .setDepth(4);
    this.adoptWorld(this.ballSprite);

    this.ballBlotch = this.add
      .circle(
        this.world.ball.position.x,
        this.world.ball.position.y,
        this.world.ball.radius * 0.32,
        PALETTE.ballEdge,
        0.55,
      )
      .setDepth(4.1);
    this.adoptWorld(this.ballBlotch);

    for (const ch of this.collectCharacters()) {
      this.ensurePersonSprite(ch);
    }

    this.markerGfx = this.add.graphics().setDepth(5);
    this.adoptWorld(this.markerGfx);
  }

  private ensureBallRollAnim(): void {
    if (this.anims.exists(BALL_ROLL_ANIM)) return;
    this.anims.create({
      key: BALL_ROLL_ANIM,
      frames: this.anims.generateFrameNumbers(BALL_ROLL_TEX, { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });
  }

  /** Patterned cork sprite with throw-up lift/shadow; roll only on open ground. */
  private syncBallSprite(b: World['ball']): void {
    const h = b.height;
    const lift = h * 0.55;
    const scale = 1 + h / 180;
    const airborne = isBallAirborne(this.world);

    this.ballSprite.setPosition(b.position.x, b.position.y - lift);
    this.ballShadow.setPosition(b.position.x + h * 0.06, b.position.y + 6 + h * 0.12);
    this.ballShadow.setAlpha(Math.max(0.08, 0.32 * (1 - Math.min(0.75, h / 240))));
    this.ballShadow.setScale(1 + h / 280, 1);

    const hugged = hugPackExtent(this.world, b.position) !== null;
    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    const rolling = !airborne && b.ownerId === null && !hugged && speed > BALL_ROLL_MIN_SPEED;

    if (rolling) {
      if (this.ballSprite.anims.currentAnim?.key !== BALL_ROLL_ANIM) {
        this.ballSprite.play(BALL_ROLL_ANIM);
      }
      this.ballSprite.setDisplaySize(BALL_DRAW_PX, BALL_DRAW_PX);
      this.ballSprite.setScale(scale);
      this.ballSprite.setRotation(0);
      this.ballSprite.anims.timeScale = Math.min(1.8, Math.max(0.55, speed / 90));
    } else {
      if (this.ballSprite.anims.isPlaying) this.ballSprite.anims.stop();
      if (this.ballSprite.texture.key !== BALL_TEX) this.ballSprite.setTexture(BALL_TEX);
      this.ballSprite.setDisplaySize(BALL_DRAW_PX, BALL_DRAW_PX);
      this.ballSprite.setScale(scale);
      this.ballSprite.setRotation(airborne ? b.spin : 0);
    }

    const br = b.radius * scale;
    this.ballBlotch.setPosition(
      b.position.x + Math.cos(b.spin) * br * 0.38,
      b.position.y - lift + Math.sin(b.spin) * br * 0.38,
    );
    this.ballBlotch.setScale(scale);
    this.ballBlotch.setVisible(b.ownerId === null);
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
        build: p.build,
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
        build: n.build,
        controlled: false,
      });
    }
    return out;
  }

  /** Strategy-phase labels on your side. Screen-stable so zoomed-out look still reads. */
  private syncBuildLabels(chars: RenderChar[]): void {
    const placing = this.flow === 'placing';
    const home = this.world.player.team;
    const zoom = Math.max(0.4, this.cameras.main.zoom);
    const scale = 1 / zoom;
    const seen = new Set<string>();
    for (const c of chars) {
      seen.add(c.id);
      let label = this.buildLabels.get(c.id);
      const mine = c.team === home;
      if (!placing || !mine) {
        label?.setVisible(false);
        continue;
      }
      if (!label) {
        label = this.add
          .text(c.x, c.y, '', {
            fontFamily: FONT,
            fontSize: '14px',
            color: '#f3ead4',
            stroke: '#1a100a',
            strokeThickness: 5,
            align: 'center',
          })
          .setOrigin(0.5, 1)
          .setDepth(6);
        this.adoptWorld(label);
        this.buildLabels.set(c.id, label);
      }
      const tag = buildTag(c.build);
      label.setText(c.controlled ? `YOU · ${tag}` : tag);
      const headLift = c.radius * (c.controlled ? 2.4 : 1.85);
      label.setPosition(c.x, c.y - headLift);
      label.setScale(scale);
      label.setVisible(true);
    }
    for (const [id, label] of this.buildLabels) {
      if (!seen.has(id)) {
        label.destroy();
        this.buildLabels.delete(id);
      }
    }
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

    this.timerText = this.hudText(VIEW_W / 2, 14, 'Day 1 · 1:00 PM', '26px', '#f3ead4', 0.5, 0);
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
          "SHROVETIDE\n\nTwo days · 1pm–10pm each.\nCarry the stone to their millstone.\nThree taps to goal.\n\nGoal before dusk → toss-up.\nNightfall ends the day.\n\nBreath returns only when still.\nSpent Breath = crawl.\n\nE/N/H — difficulty\nU/1 or D/2 — pick a side",
          {
            fontFamily: FONT,
            fontSize: '24px',
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

    // Full-viewport night veil on the HUD camera so zoom never breaks it.
    this.nightOverlay = this.adoptHud(
      this.add
        .rectangle(0, 0, VIEW_W, VIEW_H, 0x050814, 0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(8),
    );
    // Warm lamps sit above the night veil so they still read when the day closes.
    this.lightGfx = this.adoptHud(this.add.graphics().setScrollFactor(0).setDepth(8.5));
    this.windedOverlay = this.adoptHud(
      this.add
        .rectangle(0, 0, VIEW_W, VIEW_H, 0x3a0808, 0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(8),
    );
    this.feelBanner = this.adoptHud(
      this.add
        .text(VIEW_W / 2, VIEW_H * 0.34, '', {
          fontFamily: FONT,
          fontSize: '40px',
          color: '#f3ead4',
          align: 'center',
          backgroundColor: '#140e0add',
          padding: { x: 28, y: 14 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(13)
        .setVisible(false),
    );
    this.kickLabel = this.hudText(16, 56, 'Kick', '14px', '#f3ead4');
    this.kickLabel.setVisible(false);
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
    this.inputState.passAim = this.kickAimUnit();
    if (this.teach === 'kick') this.teach = 'sprint';
  }

  private handleSpace = (): void => {
    if (this.flow === 'title') {
      this.chooseTeam(0);
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
    const aim = this.kickAimUnit();
    const aimLen = Math.hypot(aim.x, aim.y);
    if (aimLen > 0) {
      this.kickJuice = {
        x: this.world.player.position.x,
        y: this.world.player.position.y,
        ux: aim.x / aimLen,
        uy: aim.y / aimLen,
        power: passChargeRatio(chargeSeconds),
      };
      this.kickJuiceUntil = this.now() + 650;
      this.hitStopLeft = Math.max(this.hitStopLeft, 0.055);
    }
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
    const prev = this.world.player.build;
    const newId = cycleTeammate(this.world);
    if (!newId) return;
    this.onSwitched(prev);
  };

  private handleQuickSwitch = (): void => {
    if (this.flow !== 'placing' && this.flow !== 'playing') return;
    const prev = this.world.player.build;
    const newId = quickSwitch(this.world);
    if (!newId) return;
    this.onSwitched(prev);
  };

  private handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    void unlockAudio();
    if (this.eatPointer) {
      this.eatPointer = false;
      return;
    }
    if (this.flow === 'title') return;
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
    if (this.trySelectTeammate(worldPt.x, worldPt.y)) return;
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
    if (dragged) return;
    const worldPt = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (this.trySelectTeammate(worldPt.x, worldPt.y)) return;
    if (this.flow !== 'placing' || !this.placeTargetId) return;
    placeTeammate(this.world, this.placeTargetId, worldPt.x, worldPt.y);
  };

  /** Screen-stable hit size so zoomed-out look view can still tap a mate. */
  private tapSlop(): number {
    const z = Math.max(CAMERA_ZOOM_MIN, this.cameras.main.zoom);
    return Math.max(56, 52 / z);
  }

  private trySelectTeammate(x: number, y: number): boolean {
    if (this.flow !== 'placing' && this.flow !== 'playing') return false;
    const tappedMate = teammateAtPoint(this.world, x, y, this.tapSlop());
    if (!tappedMate) return false;
    const prev = this.world.player.build;
    if (!switchControl(this.world, tappedMate)) return false;
    this.onSwitched(prev);
    return true;
  }

  private onSwitched(prevBuild: Build): void {
    this.clearPassCharge();
    this.retargetPlace();
    this.punchCamera();
    this.announceBuild(prevBuild);
  }

  /** Short switch beat — skip kickoff / recovery / millstone climax. */
  private announceBuild(prevBuild: Build): void {
    const build = this.world.player.build;
    if (build === prevBuild) return;
    if (this.flow !== 'playing') return;
    if (this.world.matchState === 'over') return;
    if (this.inKickoff()) return;
    if (this.world.recoveryTimeRemaining > 0) return;
    if (this.millstoneClimax()) return;
    const copy =
      build === 'runner' ? 'Runner — pace in the open' : 'Hugger — shove the pack';
    this.flash(copy, 2400);
    if (this.teach === 'build') this.teach = 'ball';
  }

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

  private bindTeamPick(): void {
    this.teamPickAbort?.abort();
    this.teamPickAbort = new AbortController();
    const { signal } = this.teamPickAbort;
    const up = document.getElementById('pick-up');
    const down = document.getElementById('pick-down');
    up?.addEventListener(
      'pointerdown',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.chooseTeam(0);
      },
      { signal },
    );
    down?.addEventListener(
      'pointerdown',
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.chooseTeam(1);
      },
      { signal },
    );
    for (const id of ['diff-easy', 'diff-normal', 'diff-hard'] as const) {
      const btn = document.getElementById(id);
      btn?.addEventListener(
        'pointerdown',
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const level = btn.getAttribute('data-difficulty') as Difficulty | null;
          if (level === 'easy' || level === 'normal' || level === 'hard') {
            this.setDifficulty(level);
          }
        },
        { signal },
      );
    }
    this.syncDifficultyButtons();
  }

  private setDifficulty(level: Difficulty): void {
    if (this.flow !== 'title') return;
    this.difficulty = level;
    this.syncDifficultyButtons();
  }

  private syncDifficultyButtons(): void {
    for (const id of ['diff-easy', 'diff-normal', 'diff-hard'] as const) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      const level = btn.getAttribute('data-difficulty');
      btn.setAttribute('aria-pressed', level === this.difficulty ? 'true' : 'false');
    }
  }

  private setTeamPickVisible(on: boolean): void {
    const el = document.getElementById('team-pick');
    if (el) el.hidden = !on;
    this.titleCard?.setVisible(on && !el);
    if (on) this.syncDifficultyButtons();
  }

  private chooseTeam = (team: Team): void => {
    if (this.flow !== 'title') return;
    void unlockAudio();
    this.rebuildWorld(team);
    this.beginPlacement();
  };

  private rebuildWorld(team: Team): void {
    for (const s of this.shadowSprites.values()) s.destroy();
    this.shadowSprites.clear();
    for (const s of this.personSprites.values()) s.destroy();
    this.personSprites.clear();
    for (const t of this.buildLabels.values()) t.destroy();
    this.buildLabels.clear();
    this.lastFacing.clear();
    this.ballSprite?.destroy();
    this.ballShadow?.destroy();
    this.ballBlotch?.destroy();
    this.markerGfx?.destroy();
    this.worldObjs = this.worldObjs.filter((o) => o.active);
    this.world = createWorld({ playerTeam: team, difficulty: this.difficulty });
    this.lastAim = team === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    this.cameras.main.setBounds(0, 0, this.world.map.width, this.world.map.height);
    this.createSprites();
    this.placeTargetId = this.world.npcs.find((n) => n.team === team)?.id ?? null;
    this.pinCam(this.world.player.position.x, this.world.player.position.y, this.currentZoom);
  }

  private beginPlacement(): void {
    if (this.flow !== 'title') return;
    this.flow = 'placing';
    this.placeLeft = PLACE_SECONDS;
    this.lastWall = this.now();
    this.spaceReady = false;
    this.eatPointer = true;
    this.setTeamPickVisible(false);
    this.syncTouchFlow();
    this.layoutHud();
  }

  private whistle(): void {
    if (this.flow !== 'placing') return;
    startMatch(this.world);
    this.flow = 'playing';
    this.playStartedAt = this.now();
    this.teach = 'move';
    this.buildTeachAt = 0;
    this.lastWall = this.now();
    this.lastScore = [...this.world.score];
    this.lastEventDay = this.world.eventDay;
    this.lastStamina = this.world.player.stamina;
    this.nightfallShownDay = 0;
    this.windedUntil = 0;
    this.kickJuiceUntil = 0;
    this.feelBannerUntil = 0;
    this.scoredJuice = false;
    this.syncTouchFlow();
    this.layoutHud();
  }

  private flash(msg: string, ms = 900): void {
    this.setCaption(msg);
    this.feedbackUntil = this.now() + ms;
  }

  /** One-shot center banner. Yields to kickoff, recovery, climax, and match over. */
  private showFeelBanner(msg: string, ms: number): boolean {
    if (this.world.matchState === 'over') return false;
    if (this.inKickoff()) return false;
    if (this.world.recoveryTimeRemaining > 0) return false;
    if (this.millstoneClimax()) return false;
    this.feelBanner.setText(msg);
    this.feelBanner.setVisible(true);
    this.feelBannerUntil = this.now() + ms;
    return true;
  }

  private syncFeelBanner(): void {
    const show =
      this.flow === 'playing' &&
      this.world.matchState === 'playing' &&
      !this.millstoneClimax() &&
      this.now() < this.feelBannerUntil;
    this.feelBanner.setVisible(show);
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
      if (this.hitStopLeft > 0) this.hitStopLeft = Math.max(0, this.hitStopLeft - dt);
    }

    if (this.flow === 'playing' && this.hitStopLeft <= 0) {
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
    if (shouldCommitAim({ x: mx, y: my })) {
      this.lastAim = { x: mx / len, y: my / len };
      if (this.teach === 'move' && this.flow === 'playing') {
        this.teach = 'build';
        this.buildTeachAt = this.now();
      }
    }
    this.inputState.move = { x: mx, y: my };
    this.inputState.sprint = !!k?.SHIFT.isDown || !!this.touch?.sprint;
    const wrestle = !!k?.F.isDown || !!this.touch?.wrestle;
    this.inputState.rip = wrestle;
    this.inputState.wriggle = wrestle;
    if (this.isPassing && !this.world.player.hasBall) this.clearPassCharge();
    if (this.inputState.sprint && this.teach === 'sprint') this.teach = 'breath';
    if (this.inputState.charging) {
      this.inputState.passAim = this.kickAimUnit();
    }
  }

  private advanceTeach(): void {
    if (this.teach === 'build' && this.buildTeachAt > 0 && this.now() - this.buildTeachAt > 4500) {
      this.teach = 'ball';
    }
    if (this.world.player.hasBall && (this.teach === 'ball' || this.teach === 'build')) {
      this.teach = 'kick';
    }
    if (this.teach === 'breath' && this.world.player.stamina < this.world.player.maxStamina * 0.85) {
      this.teach = 'goal';
    }
    if (this.now() - this.playStartedAt > TEACH_WINDOW_MS) this.teach = 'done';
  }

  private atStone(): boolean {
    return this.world.player.hasBall && isCarrierAtOpponentGoal(this.world);
  }

  /** Any carrier (player or NPC) in millstone reach — climax pips / copy. */
  private millstoneClimax(): boolean {
    return isCarrierAtOpponentGoal(this.world);
  }

  private facingOf(c: RenderChar): { x: number; y: number } {
    if (c.controlled) {
      const mx = this.inputState.move.x;
      const my = this.inputState.move.y;
      const ml = Math.hypot(mx, my);
      if (ml > 0.15) {
        const f = { x: mx / ml, y: my / ml };
        this.lastFacing.set(c.id, f);
        return f;
      }
    }
    const sp = Math.hypot(c.vx, c.vy);
    if (sp > 8) {
      const f = { x: c.vx / sp, y: c.vy / sp };
      this.lastFacing.set(c.id, f);
      return f;
    }
    return this.lastFacing.get(c.id) ?? { x: c.team === 0 ? 1 : -1, y: 0 };
  }

  /**
   * Art faces UP. Phaser y-down, so facing (ux, uy) is rotation from -Y.
   */
  private facingRotation(c: RenderChar): number {
    const { x: ux, y: uy } = this.facingOf(c);
    return Math.atan2(uy, ux) + Math.PI / 2;
  }

  /** Outstretched hug when packed on the stone / wrestling; else runner. */
  private inHugPose(c: RenderChar): boolean {
    const pos = { x: c.x, y: c.y };
    if (!isInHugZone(this.world, pos)) return false;
    if (countHugNeighbors(this.world, c.id, pos) >= HUG_POSE_NEIGHBORS) return true;
    if (!c.controlled) return false;
    const mode = wrestleMode(this.world);
    return mode === 'rip' || mode === 'wriggle';
  }

  private personTexture(c: RenderChar, hug: boolean): { key: string; frame?: number } {
    if (c.controlled) {
      return { key: c.team === 0 ? TEX_UP_SHEET : TEX_DOWN_SHEET, frame: hug ? POSE_HUG : POSE_RUN };
    }
    if (c.team === 0) {
      return { key: hug ? TEX_UP_HUG_32 : TEX_UP_RUN_32 };
    }
    return { key: hug ? TEX_DOWN_HUG_32 : TEX_DOWN_RUN_32 };
  }

  private ensurePersonSprite(c: RenderChar): Phaser.GameObjects.Sprite {
    let sprite = this.personSprites.get(c.id);
    if (sprite) return sprite;
    const hug = this.inHugPose(c);
    const tex = this.personTexture(c, hug);
    sprite = this.add.sprite(c.x, c.y, tex.key, tex.frame ?? 0).setDepth(2);
    sprite.setOrigin(0.5, 0.5);
    this.personSprites.set(c.id, sprite);
    this.adoptWorld(sprite);
    return sprite;
  }

  private syncPersonSprite(c: RenderChar, depth: number): void {
    const sprite = this.ensurePersonSprite(c);
    const hug = this.inHugPose(c);
    const tex = this.personTexture(c, hug);
    if (sprite.texture.key !== tex.key) {
      sprite.setTexture(tex.key, tex.frame ?? 0);
    } else if (tex.frame !== undefined) {
      const curFrame =
        typeof sprite.frame.name === 'number' ? sprite.frame.name : Number(sprite.frame.name);
      if (curFrame !== tex.frame) sprite.setFrame(tex.frame);
    }
    const px = c.controlled ? PLAYER_SPRITE_PX : NPC_SPRITE_PX;
    sprite.setPosition(c.x, c.y);
    sprite.setDisplaySize(px, px);
    sprite.setRotation(this.facingRotation(c));
    sprite.setDepth(depth);
    sprite.setVisible(true);
  }

  /** Cream you-ring stays client-side — not baked into the sprite. */
  private drawYouRing(c: RenderChar): void {
    const winded = c.controlled && this.world.player.stamina <= 0;
    const ring = winded ? PALETTE.staminaLow : PALETTE.youRing;
    const r = c.radius * (c.controlled ? 1.22 : 1);
    this.markerGfx.lineStyle(3, ring, 1);
    this.markerGfx.strokeCircle(c.x, c.y, r * 1.32);
    const { y: uy } = this.facingOf(c);
    const headR = r * 0.5;
    const headY = c.y + uy * r * 0.78;
    const ty = Math.min(c.y, headY) - headR - 12;
    this.markerGfx.fillStyle(ring, 1);
    this.markerGfx.fillTriangle(c.x - 8, ty - 9, c.x + 8, ty - 9, c.x, ty);
  }

  /**
   * Runner vs hugger sits just behind the sprite — never a sash through the torso.
   */
  private drawKitCue(c: RenderChar): void {
    const { x: ux, y: uy } = this.facingOf(c);
    const pxSize = c.controlled ? PLAYER_SPRITE_PX : NPC_SPRITE_PX;
    this.drawBuildMark(c, ux, uy, -uy, ux, pxSize);
  }

  /** World-space glyph: chevron (runner) vs block (hugger). Outside the body. */
  private drawBuildMark(
    c: RenderChar,
    ux: number,
    uy: number,
    px: number,
    py: number,
    pxSize: number,
  ): void {
    const g = this.markerGfx;
    const dist = pxSize * 0.58;
    const mx = c.x - ux * dist;
    const my = c.y - uy * dist;
    const s = Math.max(4.2, pxSize * 0.13);
    g.fillStyle(PALETTE.kitCue, c.controlled ? 0.95 : 0.82);
    g.lineStyle(1.4, PALETTE.ballEdge, 0.95);
    if (c.build === 'hugger') {
      const half = s * 0.62;
      g.fillRect(mx - half, my - half, half * 2, half * 2);
      g.strokeRect(mx - half, my - half, half * 2, half * 2);
    } else {
      const tipX = mx + ux * s * 0.35;
      const tipY = my + uy * s * 0.35;
      const backX = mx - ux * s * 0.85;
      const backY = my - uy * s * 0.85;
      g.fillTriangle(
        tipX,
        tipY,
        backX - px * s * 0.7,
        backY - py * s * 0.7,
        backX + px * s * 0.7,
        backY + py * s * 0.7,
      );
      g.strokeTriangle(
        tipX,
        tipY,
        backX - px * s * 0.7,
        backY - py * s * 0.7,
        backX + px * s * 0.7,
        backY + py * s * 0.7,
      );
    }
  }

  private prunePersonSprites(chars: RenderChar[]): void {
    const seen = new Set(chars.map((c) => c.id));
    for (const [id, sprite] of this.personSprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.personSprites.delete(id);
    }
  }

  private kickAimUnit(): { x: number; y: number } {
    return resolveKickAim(this.inputState.move, this.lastAim, this.controlledFacing());
  }

  /** Facing the runner is pointed, or the team's scoring-end default. */
  private controlledFacing(): { x: number; y: number } {
    const stored = this.lastFacing.get(this.world.player.id);
    if (stored) return stored;
    return this.world.player.team === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }

  private drawAimArrow(
    x: number,
    y: number,
    ux: number,
    uy: number,
    length: number,
    color: number,
    alpha: number,
    width = 6,
  ): void {
    const x1 = x + ux * 28;
    const y1 = y + uy * 28;
    const x2 = x + ux * length;
    const y2 = y + uy * length;
    this.markerGfx.lineStyle(width, color, alpha);
    this.markerGfx.lineBetween(x1, y1, x2, y2);
    const head = 14 + width;
    this.markerGfx.fillStyle(color, alpha);
    this.markerGfx.fillTriangle(
      x2 + ux * head * 0.7,
      y2 + uy * head * 0.7,
      x2 - uy * (head * 0.45),
      y2 + ux * (head * 0.45),
      x2 + uy * (head * 0.45),
      y2 - ux * (head * 0.45),
    );
  }

  private drawKickCharge(x: number, y: number, radius: number): void {
    const charge = passChargeRatio((this.now() - this.passChargeStartedAt) / 1000);
    const { x: ux, y: uy } = this.kickAimUnit();
    const color = charge > 0.72 ? PALETTE.pubSign : PALETTE.youRing;
    const minR = radius * 1.45;
    const span = 34;
    this.markerGfx.lineStyle(2, PALETTE.youRing, 0.28);
    this.markerGfx.strokeCircle(x, y, minR + span);
    this.markerGfx.lineStyle(5, color, 0.92);
    this.markerGfx.strokeCircle(x, y, minR + charge * span);
    this.drawAimArrow(x, y, ux, uy, 58 + charge * 86, color, 0.96, 5);
  }

  private drawKickRelease(): void {
    const life = 650;
    const t = 1 - Math.max(0, (this.kickJuiceUntil - this.now()) / life);
    const { x, y, ux, uy, power } = this.kickJuice;
    const fade = 1 - t;
    const color = power > 0.72 ? PALETTE.pubSign : PALETTE.youRing;
    this.markerGfx.lineStyle(4, color, 0.75 * fade);
    this.markerGfx.strokeCircle(x, y, 18 + t * (36 + power * 28));
    this.drawAimArrow(x, y, ux, uy, 70 + power * 70 + t * 40, color, 0.85 * fade, 7);
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

    const drawOrder = [...chars].sort((a, b) => {
      if (a.controlled !== b.controlled) return a.controlled ? 1 : -1;
      return a.y - b.y;
    });
    this.prunePersonSprites(chars);
    for (let i = 0; i < drawOrder.length; i++) {
      const c = drawOrder[i]!;
      const shadow = this.shadowSprites.get(c.id);
      if (shadow) shadow.setPosition(c.x, c.y + c.radius * 0.7);
      this.syncPersonSprite(c, 2 + i * 0.01);
      this.drawKitCue(c);
      if (c.controlled) this.drawYouRing(c);
    }
    this.syncBuildLabels(chars);

    for (const c of chars) {
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
    this.syncBallSprite(b);
    if (carrierId === null) {
      const pulse = 2 + Math.sin(this.now() / 90) * 2;
      this.markerGfx.lineStyle(2, PALETTE.ball, isBallAirborne(this.world) ? 0.9 : 0.6);
      this.markerGfx.strokeCircle(b.position.x, b.position.y, b.radius + 6 + pulse);
    }

    if (this.isPassing && p.hasBall) {
      this.drawKickCharge(p.position.x, p.position.y, p.radius);
    }

    if (this.now() < this.kickJuiceUntil) {
      this.drawKickRelease();
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
    if (this.flow === 'playing' || this.flow === 'placing') this.renderMinimap(chars);
    else this.minimapGfx.clear();
  }

  private setMatchHud(on: boolean): void {
    this.staminaBg.setVisible(on);
    this.staminaFill.setVisible(on);
    this.staminaLabel.setVisible(on);
    this.timerText.setVisible(on);
    this.scoreText.setVisible(on);
    this.minimapBg.setVisible(on);
    if (!on) {
      this.nightOverlay.setAlpha(0);
      this.nightOverlay.setVisible(false);
      this.lightGfx.clear();
      this.windedOverlay.setAlpha(0);
      this.windedOverlay.setVisible(false);
      this.feelBanner.setVisible(false);
      this.kickLabel.setVisible(false);
      this.cameras.main.setBackgroundColor(PALETTE.bg);
    }
  }

  private renderHud(): void {
    const live = this.flow === 'playing';
    this.setMatchHud(live);
    if (this.flow === 'placing') this.minimapBg.setVisible(true);
    this.setTeamPickVisible(this.flow === 'title');
    this.touch?.setAtStone(live && this.world.matchState === 'playing' && this.atStone());
    const mode =
      live && this.world.matchState === 'playing' ? wrestleMode(this.world) : 'none';
    const ripReady =
      mode === 'rip' && this.world.player.stamina >= RIP_MIN_STAMINA;
    this.touch?.setWrestle(
      mode,
      live ? this.world._ripPressure : 0,
      ripReady || mode === 'wriggle',
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
      this.staminaBg.setFillStyle(PALETTE.staminaLow, 0.55 + 0.35 * pulse);
    } else {
      this.staminaLabel.setAlpha(1);
      this.staminaLabel.setColor('#f3ead4');
      this.staminaLabel.setText(`Breath · ${p.build}`);
      this.staminaBg.setFillStyle(PALETTE.staminaBg, 1);
    }
    this.updateWindedVeil(exhausted);

    this.timerText.setText(`Day ${this.world.eventDay} · ${formatDayClock(this.world)}`);
    this.scoreText.setText(`Up ${this.world.score[0]} — ${this.world.score[1]} Down`);
    this.updateNightfall();

    this.noteEventBeats();
    this.noteFeelBeats();
    this.syncFeelBanner();

    this.pipGfx.clear();
    this.drawKickMeter();
    const over = this.world.matchState === 'over' && this.world.winState;
    if (over) {
      const ws = this.world.winState!;
      const tally = `Up ${this.world.score[0]} — ${this.world.score[1]} Down`;
      let msg: string;
      if (ws.winner === null) {
        msg =
          this.world.score[0] === 0 && this.world.score[1] === 0
            ? 'Two days. Nobody goaled.'
            : `Draw.\n${tally}`;
      } else {
        const teamLabel = ws.winner === 0 ? "Up'Ards" : "Down'Ards";
        msg = `${teamLabel} have it.\n${tally}`;
      }
      this.overlayText.setText(msg);
      this.overlayText.setVisible(true);
      this.againBtn.setVisible(true);
      this.againBtn.setInteractive({ useHandCursor: true });
      this.setCaption('');
      if (!this.scoredJuice) {
        this.scoredJuice = true;
        this.hitStopLeft = 0.24;
      }
    } else {
      this.overlayText.setVisible(false);
      this.againBtn.setVisible(false);
      this.drawPrompts();
    }
  }

  private drawKickMeter(): void {
    const charging = this.isPassing && this.world.player.hasBall;
    this.kickLabel.setVisible(charging);
    if (!charging) return;
    const { l, t } = this.hudPad;
    const ratio = passChargeRatio((this.now() - this.passChargeStartedAt) / 1000);
    const x = l;
    const y = t + 46;
    const w = 240;
    const h = 10;
    this.pipGfx.fillStyle(0x1a120c, 0.92);
    this.pipGfx.fillRect(x, y, w, h);
    this.pipGfx.fillStyle(ratio > 0.72 ? PALETTE.pubSign : PALETTE.youRing, 0.95);
    this.pipGfx.fillRect(x, y, Math.max(10, w * ratio), h);
    this.pipGfx.lineStyle(1, 0xf3ead4, 0.7);
    this.pipGfx.strokeRect(x, y, w, h);
  }

  private updateWindedVeil(exhausted: boolean): void {
    if (!exhausted) {
      this.windedOverlay.setAlpha(0);
      this.windedOverlay.setVisible(false);
      return;
    }
    const punch = this.now() < this.windedUntil ? 0.2 : 0;
    const pulse = 0.1 + 0.08 * Math.abs(Math.sin(this.now() / 140));
    this.windedOverlay.setVisible(true);
    this.windedOverlay.setAlpha(pulse + punch);
  }

  /** Darken the pitch as the day clock runs toward 10pm. Timer/score stay above. */
  private updateNightfall(): void {
    const live = this.flow === 'playing';
    const amount = live ? nightfallAmount(this.world) : 0;
    this.nightOverlay.setAlpha(amount);
    this.nightOverlay.setVisible(amount > 0.01);
    // Cool the clear-color behind the map so edges don't flash daylight.
    const dayBg = PALETTE.bg;
    const nightBg = 0x02040a;
    const mix = Math.min(1, amount / 0.88);
    const lerp = (a: number, b: number): number => Math.round(a + (b - a) * mix);
    const r = lerp((dayBg >> 16) & 0xff, (nightBg >> 16) & 0xff);
    const g = lerp((dayBg >> 8) & 0xff, (nightBg >> 8) & 0xff);
    const b = lerp(dayBg & 0xff, nightBg & 0xff);
    this.cameras.main.setBackgroundColor((r << 16) | (g << 8) | b);
    this.drawStreetLightGlow(amount);
  }

  /** Street lamps punch through the HUD night veil once dusk starts. */
  private drawStreetLightGlow(amount: number): void {
    this.lightGfx.clear();
    const glow = Math.min(1, Math.max(0, (amount - 0.06) / 0.38));
    if (glow <= 0.01) return;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const pulse = 0.85 + 0.15 * Math.abs(Math.sin(this.now() / 420));
    for (const lamp of this.world.map.streetLights) {
      const sx = ((lamp.position.x - view.x) / view.width) * VIEW_W;
      const sy = ((lamp.position.y - view.y) / view.height) * VIEW_H;
      if (sx < -40 || sy < -40 || sx > VIEW_W + 40 || sy > VIEW_H + 40) continue;
      const r = 36 * cam.zoom;
      this.lightGfx.fillStyle(PALETTE.lampGlow, 0.16 * glow * pulse);
      this.lightGfx.fillCircle(sx, sy - 14 * cam.zoom, r);
      this.lightGfx.fillStyle(0xfff6c8, 0.42 * glow);
      this.lightGfx.fillCircle(sx, sy - 18 * cam.zoom, 6 + 3 * cam.zoom);
    }
  }

  /** Enter Day 2 placement — same walk-them-out beat as Day 1. */
  private beginDay2Placement(): void {
    this.flow = 'placing';
    this.placeLeft = PLACE_SECONDS;
    this.lastWall = this.now();
    this.spaceReady = false;
    this.eatPointer = true;
    this.hitStopLeft = 0;
    this.teach = 'move';
    this.buildTeachAt = 0;
    this.scoredJuice = false;
    this.lastScore = [...this.world.score];
    this.lastEventDay = 2;
    this.lastStamina = this.world.player.stamina;
    this.nightfallShownDay = 0;
    this.windedUntil = 0;
    this.placeTargetId = this.world.npcs.find((n) => n.team === this.world.player.team)?.id ?? null;
    this.flash('Day 2 — place your people');
    this.syncTouchFlow();
    this.layoutHud();
  }

  /** Early-goal recovery + Day 2 placement handoff. */
  private noteEventBeats(): void {
    // Day 1 ended → sim returned to placement for Day 2.
    if (
      this.world.matchState === 'placement' &&
      this.world.eventDay === 2 &&
      this.lastEventDay === 1 &&
      this.flow === 'playing'
    ) {
      this.beginDay2Placement();
      return;
    }

    if (this.world.matchState !== 'playing') {
      this.lastScore = [...this.world.score];
      this.lastEventDay = this.world.eventDay;
      return;
    }

    const scored =
      this.world.score[0] > this.lastScore[0] || this.world.score[1] > this.lastScore[1];
    if (scored) {
      this.hitStopLeft = Math.max(this.hitStopLeft, 0.2);
      const up = this.world.score[0] > this.lastScore[0];
      const side = up ? "Up'Ards" : "Down'Ards";
      this.flash(`${side} goal`);
    }
    this.lastScore = [...this.world.score];
    this.lastEventDay = this.world.eventDay;
  }

  /** Winded crawl + Nightfall — once each, never over a climax banner. */
  private noteFeelBeats(): void {
    if (this.flow !== 'playing' || this.world.matchState !== 'playing') {
      this.lastStamina = this.world.player.stamina;
      return;
    }

    const stamina = this.world.player.stamina;
    if (this.lastStamina > 0 && stamina <= 0) {
      this.windedUntil = this.now() + 800;
      this.showFeelBanner('Winded — stand still', 3200);
    }
    this.lastStamina = stamina;

    if (isNightfall(this.world) && this.nightfallShownDay !== this.world.eventDay) {
      if (this.showFeelBanner('Nightfall\nThe day is closing', 3200)) {
        this.nightfallShownDay = this.world.eventDay;
      }
    }
  }

  private placeCountdown(): string {
    return `${Math.max(0, Math.ceil(this.placeLeft))}s`;
  }

  private drawPrompts(): void {
    if (this.now() < this.feedbackUntil) return;

    if (this.flow === 'placing') {
      const ready = this.touch?.active ? 'Whistle when ready' : 'Space when ready';
      const body = this.world.player.build;
      this.setCaption(`Walk them out · ${body} · ${this.placeCountdown()} · ${ready}`);
      return;
    }
    if (this.flow !== 'playing') {
      this.setCaption('');
      return;
    }
    if (this.inKickoff()) {
      const mill = scoringGoalMarker(this.world.player.team, this.world.map).name.toUpperCase();
      const day = this.world.eventDay === 2 ? 'DAY 2 — ' : '';
      this.setCaption(
        isBallAirborne(this.world)
          ? `${day}Turned up`
          : `${day}Turned up — play to ${mill}`,
      );
      return;
    }
    if (this.inRecoveryThrow()) {
      this.setCaption('Turned up');
      return;
    }
    if (this.world.recoveryTimeRemaining > 0) {
      const secs = Math.max(1, Math.ceil(this.world.recoveryTimeRemaining));
      this.setCaption(`Toss-up — get back in · ${secs}s`);
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
    const mill = scoringGoalMarker(this.world.player.team, this.world.map).name;
    const copy: Record<Teach, string> = {
      move: touch ? 'Stick — run' : 'WASD — run',
      build: touch
        ? 'Arrow at feet = runner. Block = hugger.'
        : 'Arrow at feet = runner (open). Block = hugger (pack). Tab to switch',
      ball: 'Get the stone',
      kick: touch ? 'Hold Kick' : 'Hold Space — kick',
      sprint: touch ? 'Hold Sprint — burst' : 'Shift — burst',
      breath: 'Breath returns only when still',
      goal: touch ? `At ${mill}, tap Goal` : `At ${mill}, tap E`,
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
    g.fillStyle(PALETTE.fieldA, 0.55);
    for (const f of map.fields) {
      g.fillRect(
        ox + (f.position.x - f.width / 2) * sx,
        oy + (f.position.y - f.height / 2) * sy,
        Math.max(2, f.width * sx),
        Math.max(2, f.height * sy),
      );
    }
    for (const road of map.roads) {
      if (road.points.length < 2) continue;
      g.lineStyle(1.6, road.kind === 'trail' ? PALETTE.trailEdge : PALETTE.tarmac, 0.9);
      g.beginPath();
      g.moveTo(ox + road.points[0]!.x * sx, oy + road.points[0]!.y * sy);
      for (let i = 1; i < road.points.length; i++) {
        g.lineTo(ox + road.points[i]!.x * sx, oy + road.points[i]!.y * sy);
      }
      g.strokePath();
    }
    g.fillStyle(PALETTE.tarmac, 0.9);
    for (const rbt of map.roundabouts) {
      g.fillCircle(ox + rbt.position.x * sx, oy + rbt.position.y * sy, Math.max(3, rbt.radius * sx));
      g.fillStyle(PALETTE.grass, 0.95);
      g.fillCircle(ox + rbt.position.x * sx, oy + rbt.position.y * sy, Math.max(1.5, rbt.island * sx));
      g.fillStyle(PALETTE.tarmac, 0.9);
    }
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
      if (goal.name === MILL_CLIFTON) {
        g.fillStyle(PALETTE.teamDownEdge, 1);
        g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 3.6);
        g.fillStyle(PALETTE.teamDown, 1);
        g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 2.4);
      } else {
        g.fillStyle(PALETTE.teamUp, 1);
        g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 3.4);
        g.fillStyle(PALETTE.teamUpTrim, 1);
        g.fillCircle(ox + goal.position.x * sx, oy + goal.position.y * sy, 1.6);
      }
    }

    for (const c of chars) {
      if (c.controlled) continue;
      const mx = ox + c.x * sx;
      const my = oy + c.y * sy;
      const hugger = c.build === 'hugger';
      if (c.team === 0) {
        g.fillStyle(PALETTE.teamUp, 0.95);
        if (hugger) g.fillRect(mx - 2.2, my - 2.2, 4.4, 4.4);
        else g.fillTriangle(mx, my - 3.1, mx - 2.6, my + 2.2, mx + 2.6, my + 2.2);
        g.fillStyle(PALETTE.teamUpTrim, 0.95);
        if (hugger) g.fillRect(mx - 1.1, my - 1.1, 2.2, 2.2);
        else g.fillCircle(mx, my, 1.1);
      } else {
        g.fillStyle(PALETTE.teamDownKit, 0.95);
        if (hugger) g.fillRect(mx - 2.4, my - 2.4, 4.8, 4.8);
        else g.fillTriangle(mx, my - 3.2, mx - 2.7, my + 2.3, mx + 2.7, my + 2.3);
        g.fillStyle(PALETTE.teamDown, 0.9);
        if (hugger) g.fillRect(mx - 1.5, my - 1.5, 3, 3);
        else g.fillCircle(mx, my, 1.7);
      }
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
