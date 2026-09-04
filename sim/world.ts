// sim/world.ts — world construction + the per-tick step function.
// Orchestrates: stamina, controlled input, NPC steering, physics step,
// state sync, ball pickup, ball OOB teleport, goaling, match timer.
//
// TICKET 002 changes:
//   - map: TownMap data attached to world
//   - squad: SQUAD_SIZE per team (17v17), one is controlled (world.player)
//   - match state machine: 'placement' | 'playing' | 'over' (two-day event)
//   - match timer + aggregate score + goaling + win state
//   - physics bodies are Map-keyed by character id (for instant switching)
//
// TICKET 003a changes (game feel):
//   - Controlled movement is no longer "velocity = input x maxSpeed". It now
//     runs through an acceleration / deceleration / turn-rate model held in
//     world._controlVel. See MOVEMENT below for the tuning constants.
//   - Input deadzone + rescale so small analog/touch inputs don't snap the
//     character to full tilt.
//   - Ball carriers are slower and turn more widely, so breakaways
//     have weight and defenders can cut angles.
//   - All of this is pure math: no Math.random, no wall-clock time, so the
//     sim stays deterministic.

import Matter from 'matter-js';
import { ASHBOURNE_TOWN, TownMap, isInObstacle, isInWater, isOutOfBounds, nearestLegalPoint, speedMultiplierAt } from './maps.js';
import { createPhysicsWorld, setBallSensor, stepPhysics, toMatterVelocity, MATTER_VELOCITY_SCALE, type PhysicsWorldHandle } from './physics.js';
import { getSpeedMultiplier, getSprintMultiplier, updateStamina } from './stamina.js';
import { isTurnUpSwarm, steerNPCs, tickNpcStamina, clampNpcVelocities } from './npc.js';
import { tryPickupBall, syncCarriedBall } from './pass.js';
import { tickMatch } from './match.js';
import { tapGoal, tickNpcGoalTap } from './goaling.js';
import { autoPlaceHome, autoPlaceOpponents } from './placement.js';
import { hugShoveAt } from './hug.js';
import {
  applyWriggleProgress,
  setWriggleFriction,
  tickNpcRip,
  tickWrestle,
  WRIGGLE_INWARD_SPEED,
  WRIGGLE_SHOVE_FLOOR,
} from './wrestle.js';
import type { Ball, Input, NPC, Player, SimState, Team, Vec2 } from './types.js';
import { DEFAULT_DIFFICULTY, type Difficulty } from './difficulty.js';

export {
  contestFocus as hugContestFocus,
  countBodiesNear,
  countHugNeighbors,
  hugNeighborCentroid,
  hugPackExtent,
  hugShoveAt,
  hugShoveAuthority,
  isInHugZone,
  HUG_MIN_SHOVE,
  HUG_NEIGHBOR_RADIUS,
  HUG_PACK_COUNT,
  HUG_PACK_GATHER_RADIUS,
  HUG_ZONE_RADIUS,
  type HugPackExtent,
} from './hug.js';

export const PLAYER_RADIUS = 16;
export const NPC_RADIUS = 14;
export const BALL_RADIUS = 10;
export const PLAYER_MAX_SPEED = 190; // pixels/sec
/** Empty-handed NPC walk matches the player walk (difficulty scales opponents in npcSpeedCap). */
export const NPC_MAX_SPEED = PLAYER_MAX_SPEED;
export const SIM_DT = 1 / 60;
/** Number of characters per team (including the controlled one). 17v17 scrum. */
export const SQUAD_SIZE = 17;


// ---------------------------------------------------------------------------
// Movement tuning (TICKET 003a)
//
// Every constant that governs how the controlled character *feels* lives here
// and nowhere else. Tune these, re-run, repeat. They are deliberately plain
// numbers rather than a config file so the sim stays dependency-free.
// ---------------------------------------------------------------------------

export interface MovementTuning {
  /** Seconds from standstill to full speed. Lower = twitchier. */
  timeToMaxSpeed: number;
  /** Seconds from full speed to standstill once input is released. */
  timeToStop: number;
  /** Maximum heading change in radians per second while moving. */
  maxTurnRateRad: number;
  /** Input magnitudes at or below this are treated as no input at all. */
  inputDeadzone: number;
  /** Speed multiplier applied while carrying the ball. */
  carrierSpeedMult: number;
  /** Turn-rate multiplier applied while carrying the ball (wider arcs). */
  carrierTurnMult: number;
  /** Speeds below this with no input snap to a dead stop (kills micro-slide). */
  restSpeedEpsilon: number;
}

export const MOVEMENT: MovementTuning = {
  timeToMaxSpeed: 0.28,
  timeToStop: 0.18,
  maxTurnRateRad: Math.PI * 1.7,
  inputDeadzone: 0.15,
  carrierSpeedMult: 0.62,
  carrierTurnMult: 0.40,
  restSpeedEpsilon: 0.5,
};

/** Full world. Extends SimState with internal handles (physics + RNG). */
export interface World extends SimState {
  /** Town map data — read-only after createWorld. */
  map: TownMap;
  /** Internal — not broadcast over the wire in a future Colyseus deploy. */
  physics: PhysicsWorldHandle;
  /** Internal — seeded RNG. */
  _rng: () => number;
  /**
   * Internal — the controlled character's *intended* velocity, integrated
   * across ticks by the acceleration model. This is separate from the physics
   * body's velocity, which also carries collision impulses from the hug.
   * Reset to zero whenever control switches to a different character.
   */
  _controlVel: Vec2;
  /**
   * After a pass/kick, this character cannot pick the ball up until
   * `passImmuneUntilTick`. Stops instant re-grab of a just-released ball.
   */
  passImmuneId: string | null;
  passImmuneUntilTick: number;
  /** 0..1 Rip contest. Resets on release, leaving the scrum, or switch. */
  _ripPressure: number;
  /** Ticks of Rip grace left after a jostle leaves Rip range. */
  _ripGraceTicks: number;
  /** While `tick < this`, the popped stone is a sensor so it cannot re-glue. */
  _ripGhostUntilTick: number;
  /** NPC currently holding Rip on a carrier, or null. */
  _npcRipId: string | null;
  /** 0..1 NPC Rip contest. */
  _npcRipPressure: number;
  /** Ticks of NPC Rip grace left after a jostle. */
  _npcRipGraceTicks: number;
  /** Next tick an NPC may start a new Rip (rate-limit). */
  _npcRipCooldownUntilTick: number;
  /** Opponent pressure preset chosen on the title screen. */
  difficulty: Difficulty;
}

export interface CreateWorldOptions {
  map?: TownMap;
  seed?: number;
  /** Which team the controlled player is on. Default 0 (Up'Ards). */
  playerTeam?: Team;
  /** Opponent pressure. Default normal. */
  difficulty?: Difficulty;
}

/** mulberry32 — fast, deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap an angle delta into [-PI, PI]. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** Build all character records (SQUAD_SIZE home + SQUAD_SIZE away). */
function buildCharacters(
  map: TownMap,
  rng: () => number,
  playerTeam: Team,
): { player: Player; npcs: NPC[] } {
  const opponentTeam: Team = playerTeam === 0 ? 1 : 0;

  // Home team: 1 controlled player + (SQUAD_SIZE - 1) teammates.
  const controlledId = `${playerTeam === 0 ? 'up' : 'down'}-1`;
  // Spawn controlled player on home half, near their goal.
  const controlledSpawn: Vec2 = playerTeam === 0
    ? { x: map.width * 0.20, y: map.height * 0.50 }
    : { x: map.width * 0.80, y: map.height * 0.50 };

  const player: Player = {
    id: controlledId,
    kind: 'player',
    team: playerTeam,
    assignedRole: 'chase',
    position: { ...controlledSpawn },
    velocity: { x: 0, y: 0 },
    radius: PLAYER_RADIUS,
    maxSpeed: PLAYER_MAX_SPEED,
    stamina: 100,
    maxStamina: 100,
    hasBall: false,
  };

  const npcs: NPC[] = [];

  // Home teammates: up-2..up-N or down-2..down-N.
  for (let i = 2; i <= SQUAD_SIZE; i++) {
    const id = `${playerTeam === 0 ? 'up' : 'down'}-${i}`;
    const angle = (i / SQUAD_SIZE) * Math.PI;
    const r = map.height * 0.25;
    const cx = playerTeam === 0 ? map.width * 0.30 : map.width * 0.70;
    const cy = map.height * 0.50;
    const raw = {
      x: cx + Math.cos(angle) * r * (0.5 + rng()),
      y: cy + Math.sin(angle) * r * (0.5 + rng()),
    };
    npcs.push({
      id,
      kind: 'npc',
      team: playerTeam,
      role: 'chase',
      holdPosition: null,
      position: { ...nearestLegalPoint(raw, map) },
      velocity: { x: 0, y: 0 },
      radius: NPC_RADIUS,
      maxSpeed: NPC_MAX_SPEED,
      stamina: 100,
      maxStamina: 100,
    });
  }

  // Opponent team: full squad on the other half.
  for (let i = 1; i <= SQUAD_SIZE; i++) {
    const id = `${opponentTeam === 0 ? 'up' : 'down'}-${i}`;
    const angle = ((i + 0.5) / SQUAD_SIZE) * Math.PI;
    const r = map.height * 0.25;
    const cx = opponentTeam === 0 ? map.width * 0.30 : map.width * 0.70;
    const cy = map.height * 0.50;
    const raw = {
      x: cx + Math.cos(angle) * r * (0.5 + rng()),
      y: cy + Math.sin(angle) * r * (0.5 + rng()),
    };
    npcs.push({
      id,
      kind: 'npc',
      team: opponentTeam,
      role: 'chase',
      holdPosition: null,
      position: { ...nearestLegalPoint(raw, map) },
      velocity: { x: 0, y: 0 },
      radius: NPC_RADIUS,
      maxSpeed: NPC_MAX_SPEED,
      stamina: 100,
      maxStamina: 100,
    });
  }

  return { player, npcs };
}

export function createWorld(opts: CreateWorldOptions = {}): World {
  const map = opts.map ?? ASHBOURNE_TOWN;
  const seed = opts.seed ?? 1;
  const playerTeam: Team = opts.playerTeam ?? 0;
  const difficulty = opts.difficulty ?? DEFAULT_DIFFICULTY;
  const rng = mulberry32(seed);

  const { player, npcs } = buildCharacters(map, rng, playerTeam);

  const ball: Ball = {
    id: 'ball',
    kind: 'ball',
    position: { ...map.turnUp },
    velocity: { x: 0, y: 0 },
    radius: BALL_RADIUS,
    ownerId: null,
  };

  // Build physics for every character + ball.
  const characterBodies = [
    { id: player.id, position: player.position, radius: player.radius, label: 'player' },
    ...npcs.map((n) => ({ id: n.id, position: n.position, radius: n.radius, label: `npc-${n.id}` })),
  ];
  const physics = createPhysicsWorld(map, characterBodies, ball.position, ball.radius);

  // Compose world so placement helpers can mutate it.
  const world: World = {
    width: map.width,
    height: map.height,
    map,
    player,
    npcs,
    ball,
    tick: 0,
    rngSeed: seed,
    matchState: 'placement',
    eventDay: 1,
    matchTimeRemaining: 0,
    score: [0, 0],
    goaling: {
      carrierId: null,
      taps: 0,
      lastTapTick: 0,
      spacing: 30,
      maxChainTicks: 180,
    },
    winState: null,
    physics,
    _rng: rng,
    _controlVel: { x: 0, y: 0 },
    passImmuneId: null,
    passImmuneUntilTick: 0,
    _ripPressure: 0,
    _ripGraceTicks: 0,
    _ripGhostUntilTick: 0,
    _npcRipId: null,
    _npcRipPressure: 0,
    _npcRipGraceTicks: 0,
    _npcRipCooldownUntilTick: 0,
    difficulty,
  };

  // Default strategy-phase placement — player can re-place teammates + re-role.
  autoPlaceHome(world);
  autoPlaceOpponents(world);

  // Re-sync physics bodies to the placed positions so the first tick
  // doesn't teleport characters between the build-time spawn and their
  // strategy-phase spots.
  for (const [id, body] of physics.bodies) {
    if (id === player.id) {
      Matter.Body.setPosition(body, player.position);
    } else {
      const npc = npcs.find((n) => n.id === id);
      if (npc) Matter.Body.setPosition(body, npc.position);
    }
  }
  Matter.Body.setPosition(physics.ballBody, ball.position);

  return world;
}

/**
 * Integrate the controlled character's velocity for one tick.
 *
 * Pure function of (previous control velocity, input, limits, dt) — mutates
 * `out` in place and returns it. Extracted so it can be unit-tested without
 * standing up a whole world.
 */
export function integrateControlVelocity(
  out: Vec2,
  input: Input,
  maxSpeed: number,
  carrying: boolean,
  dt: number,
): Vec2 {
  // --- 1. Deadzone + rescale ------------------------------------------------
  // Rescaling means the character eases in from the deadzone edge instead of
  // jumping to full tilt the instant the threshold is crossed.
  const rawLen = Math.hypot(input.move.x, input.move.y);
  let desiredX = 0;
  let desiredY = 0;
  if (rawLen > MOVEMENT.inputDeadzone) {
    const scaled = Math.min(
      1,
      (rawLen - MOVEMENT.inputDeadzone) / (1 - MOVEMENT.inputDeadzone),
    );
    desiredX = (input.move.x / rawLen) * scaled;
    desiredY = (input.move.y / rawLen) * scaled;
  }

  const desiredLen = Math.hypot(desiredX, desiredY);
  const targetSpeed =
    desiredLen * maxSpeed * (carrying ? MOVEMENT.carrierSpeedMult : 1);

  // --- 2. Heading, turn-rate limited ---------------------------------------
  let curSpeed = Math.hypot(out.x, out.y);
  let heading: number;
  if (curSpeed > 1e-3) {
    heading = Math.atan2(out.y, out.x);
  } else if (desiredLen > 0) {
    // From a standstill, snap straight to the input heading — no turn lag.
    heading = Math.atan2(desiredY, desiredX);
  } else {
    heading = 0;
  }

  if (desiredLen > 0 && curSpeed > 1e-3) {
    const desiredHeading = Math.atan2(desiredY, desiredX);
    const delta = wrapAngle(desiredHeading - heading);
    const maxTurn =
      MOVEMENT.maxTurnRateRad * (carrying ? MOVEMENT.carrierTurnMult : 1) * dt;
    heading += Math.max(-maxTurn, Math.min(maxTurn, delta));
  }

  // --- 3. Accelerate / decelerate toward the target speed -------------------
  const accel = (maxSpeed / MOVEMENT.timeToMaxSpeed) * dt;
  const decel = (maxSpeed / MOVEMENT.timeToStop) * dt;
  if (targetSpeed > curSpeed) {
    curSpeed = Math.min(targetSpeed, curSpeed + accel);
  } else {
    curSpeed = Math.max(targetSpeed, curSpeed - decel);
  }
  if (targetSpeed === 0 && curSpeed < MOVEMENT.restSpeedEpsilon) {
    curSpeed = 0;
  }

  out.x = curSpeed === 0 ? 0 : Math.cos(heading) * curSpeed;
  out.y = curSpeed === 0 ? 0 : Math.sin(heading) * curSpeed;
  return out;
}


/** Keep a body on the pitch. Physics walls can miss a tick; the camera then follows you into the void. */
function pinOnPitch(
  world: World,
  id: string,
  pos: Vec2,
  vel: Vec2,
  radius: number,
): void {
  const map = world.map;
  const pad = radius + 4;
  let x = Math.min(map.width - pad, Math.max(pad, pos.x));
  let y = Math.min(map.height - pad, Math.max(pad, pos.y));
  let stopped = x !== pos.x || y !== pos.y;
  // Water and hedges are legal (slow). Only bounce OOB/buildings, never the millstone in the river.
  if (isOutOfBounds({ x, y }, map) || isInObstacle({ x, y }, map)) {
    const legal = nearestLegalPoint({ x, y }, map);
    x = legal.x;
    y = legal.y;
    stopped = true;
  }
  const moved = x !== pos.x || y !== pos.y;
  pos.x = x;
  pos.y = y;
  if (stopped) {
    vel.x = 0;
    vel.y = 0;
  }
  if (!moved && !stopped) return;
  const body = world.physics.bodies.get(id);
  if (!body) return;
  Matter.Body.setPosition(body, { x, y });
  if (stopped) Matter.Body.setVelocity(body, { x: 0, y: 0 });
}

/**
 * Step the world by `dt` seconds.
 *
 * Order of operations (matters for determinism):
 *   1. Tick match state machine (timer + end-on-expiry).
 *   2. Update wrestle (player Rip / Wriggle, then NPC Rip) and stamina
 *      (player + NPCs share the same Breath economy).
 *   3. Lock carried ball to carrier.
 *   4. Integrate + apply controlled character velocity (Wriggle adds inward).
 *   5. Steer NPCs (role-based AI).
 *   6. Step matter.js physics.
 *   7. Sync sim positions/velocities from physics bodies.
 *   8. Handle ball OOB (teleport to nearest legal point).
 *   9. Try ball pickup unless a wrestle hold is live.
 *   10. Register goal tap if input.goalTap.
 *   11. Increment tick.
 *
 * During matchState 'placement' or 'over', this function is a no-op.
 */
export function stepWorld(world: World, input: Input, dt: number = SIM_DT): void {
  if (world.matchState === 'placement' || world.matchState === 'over') {
    return;
  }

  // 1. Match timer + auto-end on expiry
  tickMatch(world, dt);
  if ((world.matchState as string) === 'over') return;

  const { player, npcs, ball, map, physics } = world;

  // 2. Wrestle mode (Rip / Wriggle) then stamina.
  // Rip may pop the stone here so physics carries the squirt this tick.
  const wrestle = tickWrestle(world, input, dt);
  tickNpcRip(world, dt, wrestle.mode !== 'none');
  const moving =
    Math.hypot(input.move.x, input.move.y) > MOVEMENT.inputDeadzone;
  updateStamina(
    player,
    {
      sprinting: input.sprint,
      moving,
      carrying: player.hasBall,
      ripping: wrestle.mode === 'rip',
      wriggling: wrestle.mode === 'wriggle',
    },
    dt,
  );
  tickNpcStamina(world, dt);

  // 3. Lock carried ball to carrier (must come before step so physics uses correct pos)
  syncCarriedBall(world);
  // A just-ripped stone stays a sensor for a few ticks so the scrum cannot
  // bounce it straight back into the bodies it left.
  if (world.tick < world._ripGhostUntilTick) {
    setBallSensor(physics, true);
  }

  // 4. Controlled character movement.
  //
  // The acceleration model runs on world._controlVel, then environmental
  // multipliers (exhaustion, water, hedge) scale the result. Multiplying
  // *after* integration means wading into the river or a hedge slows you
  // immediately rather than bleeding speed over timeToStop seconds.
  // A packed hug further cuts shove authority so the scrum crawls —
  // but only while still on the stone. After a break, full shove returns.
  const staminaMult = getSpeedMultiplier(player);
  const sprintMult = getSprintMultiplier(player, input.sprint);
  const terrainMult = speedMultiplierAt(player.position, map);
  integrateControlVelocity(
    world._controlVel,
    input,
    player.maxSpeed * sprintMult,
    player.hasBall,
    dt,
  );
  let shove = hugShoveAt(world, player.id, player.position);
  if (wrestle.wriggleDir) shove = Math.max(shove, WRIGGLE_SHOVE_FLOOR);
  const envMult = staminaMult * terrainMult * shove;
  let vx = world._controlVel.x * envMult;
  let vy = world._controlVel.y * envMult;
  if (wrestle.wriggleDir) {
    vx += wrestle.wriggleDir.x * WRIGGLE_INWARD_SPEED;
    vy += wrestle.wriggleDir.y * WRIGGLE_INWARD_SPEED;
  }
  const controlledBody = physics.bodies.get(player.id);
  setWriggleFriction(world, !!wrestle.wriggleDir);
  if (controlledBody) {
    // _controlVel is px/s; Matter setVelocity expects px per baseDelta.
    Matter.Body.setVelocity(
      controlledBody,
      toMatterVelocity({ x: vx, y: vy }),
    );
  }
  const wriggleDistBefore = wrestle.wriggleDir
    ? Math.hypot(ball.position.x - player.position.x, ball.position.y - player.position.y)
    : 0;

  // 5. NPC steering (role-based; collisions deflect them around obstacles)
  steerNPCs(world);

  // 6. Physics, then re-clamp NPC speed so a collision impulse cannot stick.
  stepPhysics(physics, dt);
  clampNpcVelocities(world);

  // 7. Sync state from physics bodies (Map iteration).
  // Matter stores velocity as px/baseDelta; expose px/s on sim records.
  const fromMatter = 1 / MATTER_VELOCITY_SCALE;
  for (const [id, body] of physics.bodies) {
    if (id === player.id) {
      player.position.x = body.position.x;
      player.position.y = body.position.y;
      player.velocity.x = body.velocity.x * fromMatter;
      player.velocity.y = body.velocity.y * fromMatter;
    } else {
      const npc = npcs.find((n) => n.id === id);
      if (npc) {
        npc.position.x = body.position.x;
        npc.position.y = body.position.y;
        npc.velocity.x = body.velocity.x * fromMatter;
        npc.velocity.y = body.velocity.y * fromMatter;
      }
    }
  }
  ball.position.x = physics.ballBody.position.x;
  ball.position.y = physics.ballBody.position.y;
  ball.velocity.x = physics.ballBody.velocity.x * fromMatter;
  ball.velocity.y = physics.ballBody.velocity.y * fromMatter;

  pinOnPitch(world, player.id, player.position, player.velocity, player.radius);
  for (const npc of npcs) {
    pinOnPitch(world, npc.id, npc.position, npc.velocity, npc.radius);
  }

  // 8. Ball OOB teleport (rare — happens if a pass lands inside an OOB zone
  // or physics kicks the ball into one).
  if (isOutOfBounds(ball.position, map)) {
    const legal = nearestLegalPoint(ball.position, map);
    ball.position.x = legal.x;
    ball.position.y = legal.y;
    ball.velocity.x = 0;
    ball.velocity.y = 0;
    Matter.Body.setPosition(physics.ballBody, { x: legal.x, y: legal.y });
    Matter.Body.setVelocity(physics.ballBody, { x: 0, y: 0 });
    ball.ownerId = null;
    player.hasBall = false;
  }

  // 9. Wriggle inward correction (undo pack ejection), then pickup —
  // skipped while a wrestle hold is live so Rip can finish.
  if (wrestle.wriggleDir && player.stamina > 0) {
    applyWriggleProgress(world, wrestle.wriggleDir, wriggleDistBefore);
  }
  if (!wrestle.suppressPickup) {
    tryPickupBall(world, { includeNpcs: !isTurnUpSwarm(world) });
  }

  // 10. Goal tap: player rising-edge, then NPC auto-contest at their millstone.
  if (input.goalTap) tapGoal(world);
  tickNpcGoalTap(world);

  // 11. Tick.
  world.tick += 1;
}

/** Pure helper — re-export here for backwards compat with TICKET 001 callers. */
void isInWater;
