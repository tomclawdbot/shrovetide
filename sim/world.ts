// sim/world.ts — world construction + the per-tick step function.
// Orchestrates: stamina, controlled input, NPC steering, physics step,
// state sync, ball pickup, ball OOB teleport, goaling, match timer.
//
// TICKET 002 changes:
//   - map: TownMap data attached to world
//   - 14 characters total (7 per team), one is controlled (world.player)
//   - match state machine: 'placement' | 'playing' | 'over'
//   - match timer + score + goaling + win state
//   - physics bodies are Map-keyed by character id (for instant switching)

import Matter from 'matter-js';
import { ASHBOURNE_TOWN, TownMap, isInWater, isOutOfBounds, nearestLegalPoint, speedMultiplierAt } from './maps.js';
import { createPhysicsWorld, stepPhysics, type PhysicsWorldHandle } from './physics.js';
import { getSpeedMultiplier, updateStamina } from './stamina.js';
import { steerNPCs } from './npc.js';
import { tryPickupBall, syncCarriedBall } from './pass.js';
import { tickMatch } from './match.js';
import { tapGoal } from './goaling.js';
import { autoPlaceHome, autoPlaceOpponents } from './placement.js';
import type { Ball, Input, NPC, Player, SimState, Team, Vec2 } from './types.js';

export const PLAYER_RADIUS = 16;
export const NPC_RADIUS = 14;
export const BALL_RADIUS = 10;
export const PLAYER_MAX_SPEED = 240; // pixels/sec
export const NPC_MAX_SPEED = 180;
export const SIM_DT = 1 / 60;
/** Number of characters per team (including the controlled one). */
export const SQUAD_SIZE = 7;

/** Full world. Extends SimState with internal handles (physics + RNG). */
export interface World extends SimState {
  /** Town map data — read-only after createWorld. */
  map: TownMap;
  /** Internal — not broadcast over the wire in a future Colyseus deploy. */
  physics: PhysicsWorldHandle;
  /** Internal — seeded RNG. */
  _rng: () => number;
}

export interface CreateWorldOptions {
  map?: TownMap;
  seed?: number;
  /** Which team the controlled player is on. Default 0 (Up'Ards). */
  playerTeam?: Team;
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

/** Build all 14 character records (7 home + 7 away). */
function buildCharacters(
  map: TownMap,
  rng: () => number,
  playerTeam: Team,
): { player: Player; npcs: NPC[] } {
  const opponentTeam: Team = playerTeam === 0 ? 1 : 0;

  // Home team: 1 controlled player + 6 teammates.
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

  // Build all 14 NPCs (6 teammates + 7 opponents).
  const npcs: NPC[] = [];

  // Home teammates: 6 (up-2..up-7 or down-2..down-7).
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

  // Opponent team: 7 NPCs on the other half.
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

  // Build physics for all 14 characters + ball.
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
 * Step the world by `dt` seconds.
 *
 * Order of operations (matters for determinism):
 *   1. Tick match state machine (timer + end-on-expiry).
 *   2. Update controlled character stamina.
 *   3. Lock carried ball to carrier.
 *   4. Apply controlled character velocity (input + water/stamina mult).
 *   5. Steer NPCs (role-based AI).
 *   6. Step matter.js physics.
 *   7. Sync sim positions/velocities from physics bodies.
 *   8. Handle ball OOB (teleport to nearest legal point).
 *   9. Try ball pickup.
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

  // 2. Stamina
  updateStamina(player, input.sprint, dt);

  // 3. Lock carried ball to carrier (must come before step so physics uses correct pos)
  syncCarriedBall(world);

  // 4. Controlled character movement — direct velocity for responsiveness.
  const staminaMult = getSpeedMultiplier(player);
  const waterMult = speedMultiplierAt(player.position, map);
  const len = Math.hypot(input.move.x, input.move.y);
  let mx = 0;
  let my = 0;
  if (len > 0) {
    mx = input.move.x / len;
    my = input.move.y / len;
  }
  const controlledBody = physics.bodies.get(player.id);
  if (controlledBody) {
    Matter.Body.setVelocity(controlledBody, {
      x: mx * player.maxSpeed * staminaMult * waterMult,
      y: my * player.maxSpeed * staminaMult * waterMult,
    });
  }

  // 5. NPC steering (role-based; collisions deflect them around obstacles)
  steerNPCs(world);

  // 6. Physics
  stepPhysics(physics, dt);

  // 7. Sync state from physics bodies (Map iteration).
  for (const [id, body] of physics.bodies) {
    if (id === player.id) {
      player.position.x = body.position.x;
      player.position.y = body.position.y;
      player.velocity.x = body.velocity.x;
      player.velocity.y = body.velocity.y;
    } else {
      const npc = npcs.find((n) => n.id === id);
      if (npc) {
        npc.position.x = body.position.x;
        npc.position.y = body.position.y;
        npc.velocity.x = body.velocity.x;
        npc.velocity.y = body.velocity.y;
      }
    }
  }
  ball.position.x = physics.ballBody.position.x;
  ball.position.y = physics.ballBody.position.y;
  ball.velocity.x = physics.ballBody.velocity.x;
  ball.velocity.y = physics.ballBody.velocity.y;

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

  // 9. Pickup (proximity check after physics has resolved collisions).
  tryPickupBall(world);

  // 10. Goal tap (rising-edge driven by input.goalTap).
  if (input.goalTap) tapGoal(world);

  // 11. Tick.
  world.tick += 1;
}

/** Pure helper — re-export here for backwards compat with TICKET 001 callers. */
void isInWater;