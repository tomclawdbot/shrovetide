// sim/world.ts — world construction + the per-tick step function.
// Orchestrates: stamina update, player velocity set, NPC steering,
// physics step, state sync, ball pickup, ball-carry lock.

import Matter from 'matter-js';
import { createPhysicsWorld, stepPhysics, type PhysicsWorld } from './physics.js';
import { getSpeedMultiplier, updateStamina } from './stamina.js';
import { steerNPCs } from './npc.js';
import { tryPickupBall, syncCarriedBall } from './pass.js';
import type { Ball, Input, NPC, Player, SimState, Team, Vec2 } from './types.js';

export const FIELD_WIDTH = 1200;
export const FIELD_HEIGHT = 800;
export const PLAYER_RADIUS = 16;
export const NPC_RADIUS = 14;
export const BALL_RADIUS = 10;
export const PLAYER_MAX_SPEED = 240; // pixels/sec
export const NPC_MAX_SPEED = 180;
export const SIM_DT = 1 / 60;

/**
 * Full world object. Extends SimState with internal handles that are NOT
 * part of the serialized sim state (physics bodies + RNG). The server in
 * a future Colyseus deployment would broadcast SimState and reconstruct
 * physics locally if needed for prediction.
 */
export interface World extends SimState {
  /** Internal — not broadcast over the wire. */
  _physics: PhysicsWorld;
  /** Internal — seeded RNG so multiplayer stays deterministic. */
  _rng: () => number;
}

export interface CreateWorldOptions {
  width?: number;
  height?: number;
  npcCount?: number;
  seed?: number;
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

export function createWorld(opts: CreateWorldOptions = {}): World {
  const width = opts.width ?? FIELD_WIDTH;
  const height = opts.height ?? FIELD_HEIGHT;
  const npcCount = opts.npcCount ?? 30;
  const seed = opts.seed ?? 1;

  const rng = mulberry32(seed);

  const player: Player = {
    id: 'player',
    kind: 'player',
    team: 0,
    position: { x: width / 2, y: height / 2 },
    velocity: { x: 0, y: 0 },
    radius: PLAYER_RADIUS,
    maxSpeed: PLAYER_MAX_SPEED,
    stamina: 100,
    maxStamina: 100,
    hasBall: false,
  };

  const ball: Ball = {
    id: 'ball',
    kind: 'ball',
    position: { x: width / 2 + 40, y: height / 2 },
    velocity: { x: 0, y: 0 },
    radius: BALL_RADIUS,
    ownerId: null,
  };

  // 15 per team — split the field in two halves at kickoff.
  const npcs: NPC[] = [];
  const npcPositions: Vec2[] = [];
  for (let i = 0; i < npcCount; i++) {
    const team: Team = i < npcCount / 2 ? 0 : 1;
    const x =
      team === 0
        ? width * 0.2 + rng() * width * 0.15
        : width * 0.65 + rng() * width * 0.15;
    const y = height * 0.15 + rng() * height * 0.7;
    npcPositions.push({ x, y });
    npcs.push({
      id: `npc-${i}`,
      kind: 'npc',
      team,
      position: { x, y },
      velocity: { x: 0, y: 0 },
      radius: NPC_RADIUS,
      maxSpeed: NPC_MAX_SPEED,
      stamina: 100,
      maxStamina: 100,
    });
  }

  const physics = createPhysicsWorld(
    width,
    height,
    { playerPosition: player.position, npcPositions, ballPosition: ball.position },
    { player: PLAYER_RADIUS, npc: NPC_RADIUS, ball: BALL_RADIUS },
  );

  return {
    width,
    height,
    player,
    npcs,
    ball,
    tick: 0,
    rngSeed: seed,
    _physics: physics,
    _rng: rng,
  };
}

/**
 * Step the world by `dt` seconds with the given input.
 *
 * Order of operations (matters for determinism):
 *   1. Update player stamina
 *   2. Lock carried ball to player (so physics doesn't drift it)
 *   3. Apply player velocity (direct set, force-based feels sluggish for the player)
 *   4. Steer NPCs toward target (force-based so they pile up via collisions)
 *   5. Step the physics engine
 *   6. Sync sim positions/velocities from physics bodies
 *   7. Try ball pickup (proximity check after physics)
 *   8. Tick++
 */
export function stepWorld(world: World, input: Input, dt: number = SIM_DT): void {
  const { player, npcs, ball, _physics } = world;

  // 1. Stamina
  updateStamina(player, input.sprint, dt);

  // 2. Lock ball to player if carried (must come before step so physics uses correct pos)
  syncCarriedBall(world);

  // 3. Player movement — direct velocity for responsiveness.
  const speedMult = getSpeedMultiplier(player);
  const len = Math.hypot(input.move.x, input.move.y);
  let mx = 0;
  let my = 0;
  if (len > 0) {
    mx = input.move.x / len;
    my = input.move.y / len;
  }
  const targetVx = mx * player.maxSpeed * speedMult;
  const targetVy = my * player.maxSpeed * speedMult;
  Matter.Body.setVelocity(_physics.playerBody, { x: targetVx, y: targetVy });

  // 4. NPC steering (force-based — collisions create the "hug").
  steerNPCs(world);

  // 5. Physics
  stepPhysics(_physics, dt);

  // 6. Sync state from physics bodies.
  player.position.x = _physics.playerBody.position.x;
  player.position.y = _physics.playerBody.position.y;
  player.velocity.x = _physics.playerBody.velocity.x;
  player.velocity.y = _physics.playerBody.velocity.y;

  ball.position.x = _physics.ballBody.position.x;
  ball.position.y = _physics.ballBody.position.y;
  ball.velocity.x = _physics.ballBody.velocity.x;
  ball.velocity.y = _physics.ballBody.velocity.y;

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const body = _physics.npcBodies[i];
    if (!npc || !body) continue;
    npc.position.x = body.position.x;
    npc.position.y = body.position.y;
    npc.velocity.x = body.velocity.x;
    npc.velocity.y = body.velocity.y;
  }

  // 7. Pickup (proximity check after physics has resolved collisions).
  tryPickupBall(world);

  // 8. Tick.
  world.tick += 1;
}
