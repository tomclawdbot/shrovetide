// sim/wrestle.ts — Wriggle into a packed hug, then Rip the stone free.
//
// One hold (desktop F / touch Wriggle·Rip): the sim picks the mode.
//   • Wriggle — empty-handed, in contact with a dense pack, not yet on the stone.
//     Inward impulse + a shove-floor so you can grind in; costly Breath; not a teleport.
//   • Rip — empty-handed, already deep / near the stone, dense pack.
//     Hold builds pressure; on success the ball pops along facing (or away
//     from the densest cluster). Early release spends Breath and does not pop.
//
// Deterministic: no Math.random, no wall-clock. Pickup is suppressed while
// the hold is active so a wrestle can finish instead of auto-grabbing.

import Matter from 'matter-js';
import { CHAR_FRICTION, CHAR_FRICTION_STATIC, toMatterVelocity } from './physics.js';
import { PASS_PICKUP_IMMUNITY_TICKS } from './pass.js';
import {
  countBodiesNear,
  countHugNeighbors,
  hugNeighborCentroid,
  HUG_NEIGHBOR_RADIUS,
} from './hug.js';
import type { Input, Vec2 } from './types.js';
import type { World } from './world.js';

/** Matches MOVEMENT.inputDeadzone — avoid importing world.ts (cycle). */
const AIM_DEADZONE = 0.15;

/** Must be this close to the stone to Rip (deeper than a rim stand). */
export const RIP_REACH = 42;
/** Several bodies nearby — a real scrum, not a 1v1. */
export const RIP_MIN_NEIGHBORS = 3;
/** Hold time to pop the stone once Rip is eligible. */
export const RIP_SUCCESS_SECONDS = 0.5;
/** Pop speed (px/s) on a successful Rip. Between a short and long pass. */
export const RIP_POP_SPEED = 280;
export const RIP_IMMUNITY_TICKS = PASS_PICKUP_IMMUNITY_TICKS;

/** Touching this many bodies counts as “in contact with the hug”. */
export const WRIGGLE_CONTACT_NEIGHBORS = 2;
/** Bodies around the ball that make the hug worth burrowing into. */
export const WRIGGLE_PACK_AROUND_BALL = 3;
/** Must already be next to the scrum — no long-range wriggle. */
export const WRIGGLE_APPROACH_RADIUS = 110;
/** Extra inward speed (px/s) while wriggling — modest so collisions do not launch you. */
export const WRIGGLE_INWARD_SPEED = 40;
/**
 * Packed-hug shove floor while wriggling. Lets you grind inward without
 * turning the scrum into a slide. Still well below open-grass authority.
 */
export const WRIGGLE_SHOVE_FLOOR = 0.55;
/**
 * Guaranteed inward step after physics (px/tick). Caps ejection and makes
 * progress measurable (~54px/s) without blinking through the pack.
 */
export const WRIGGLE_NUDGE = 0.9;

export type WrestleMode = 'rip' | 'wriggle' | 'none';

export interface WrestleTick {
  mode: WrestleMode;
  /** Skip auto-pickup this tick so a hold can finish. */
  suppressPickup: boolean;
  /** Unit vector toward the ball while wriggling; null otherwise. */
  wriggleDir: Vec2 | null;
}

function distToBall(world: World): number {
  const dx = world.ball.position.x - world.player.position.x;
  const dy = world.ball.position.y - world.player.position.y;
  return Math.hypot(dx, dy);
}

function toward(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return null;
  return { x: dx / len, y: dy / len };
}

export function canRip(world: World): boolean {
  if (world.player.hasBall) return false;
  if (world.ball.ownerId === world.player.id) return false;
  if (distToBall(world) > RIP_REACH) return false;
  return countHugNeighbors(world, world.player.id, world.player.position) >= RIP_MIN_NEIGHBORS;
}

export function canWriggle(world: World): boolean {
  if (world.player.hasBall) return false;
  if (world.ball.ownerId === world.player.id) return false;
  if (canRip(world)) return false;
  if (distToBall(world) > WRIGGLE_APPROACH_RADIUS) return false;
  const touching = countHugNeighbors(world, world.player.id, world.player.position);
  if (touching < WRIGGLE_CONTACT_NEIGHBORS) return false;
  const pack = countBodiesNear(world, world.ball.position, HUG_NEIGHBOR_RADIUS);
  return pack >= WRIGGLE_PACK_AROUND_BALL;
}

/** Button / prompt mode. Rip wins when both could apply. */
export function wrestleMode(world: World): WrestleMode {
  if (canRip(world)) return 'rip';
  if (canWriggle(world)) return 'wriggle';
  return 'none';
}

function wrestleHeld(input: Input): boolean {
  return input.rip || input.wriggle;
}

function popDirection(world: World, input: Input): Vec2 {
  const moveLen = Math.hypot(input.move.x, input.move.y);
  if (moveLen > AIM_DEADZONE) {
    return { x: input.move.x / moveLen, y: input.move.y / moveLen };
  }
  const cv = Math.hypot(world._controlVel.x, world._controlVel.y);
  if (cv > 1) {
    return { x: world._controlVel.x / cv, y: world._controlVel.y / cv };
  }
  const cluster = hugNeighborCentroid(world, world.player.id, world.player.position);
  if (cluster) {
    const away = toward(cluster, world.player.position);
    if (away) return away;
  }
  const fromBall = toward(world.ball.position, world.player.position);
  if (fromBall) return fromBall;
  return { x: 1, y: 0 };
}

function clearBallOwner(world: World): void {
  if (world.ball.ownerId === world.player.id) {
    world.player.hasBall = false;
  }
  world.ball.ownerId = null;
}

/** Squirt the stone free along `dir` (unit). */
export function popBallFree(world: World, dir: Vec2, speed: number): void {
  const { player, ball, physics } = world;
  const offset = player.radius + ball.radius + 8;
  const releaseX = player.position.x + dir.x * offset;
  const releaseY = player.position.y + dir.y * offset;

  clearBallOwner(world);
  world.passImmuneId = player.id;
  world.passImmuneUntilTick = world.tick + RIP_IMMUNITY_TICKS;

  physics.ballBody.isSensor = false;
  Matter.Body.setPosition(physics.ballBody, { x: releaseX, y: releaseY });
  Matter.Body.setVelocity(
    physics.ballBody,
    toMatterVelocity({
      x: dir.x * speed,
      y: dir.y * speed,
    }),
  );
  ball.position.x = releaseX;
  ball.position.y = releaseY;
  ball.velocity.x = dir.x * speed;
  ball.velocity.y = dir.y * speed;
}

/**
 * Advance wrestle state for one tick. Mutates pressure and may pop the ball.
 * Movement application (inward vel + post-physics nudge) stays in stepWorld.
 */
export function tickWrestle(world: World, input: Input, dt: number): WrestleTick {
  const held = wrestleHeld(input);
  const mode = held ? wrestleMode(world) : 'none';
  const canWork = mode !== 'none' && world.player.stamina > 0;

  if (mode !== 'rip') {
    world._ripPressure = 0;
  }

  if (mode === 'rip' && canWork) {
    world._ripPressure += dt / RIP_SUCCESS_SECONDS;
    if (world._ripPressure >= 1) {
      world._ripPressure = 0;
      popBallFree(world, popDirection(world, input), RIP_POP_SPEED);
    }
  }

  const wriggleDir =
    mode === 'wriggle' && canWork ? toward(world.player.position, world.ball.position) : null;

  return {
    mode: canWork ? mode : held ? mode : 'none',
    suppressPickup: held && mode !== 'none',
    wriggleDir,
  };
}

/** Slippery while wriggling so grabby bodies do not pin you on the rim. */
export function setWriggleFriction(world: World, wriggling: boolean): void {
  const body = world.physics.bodies.get(world.player.id);
  if (!body) return;
  body.friction = wriggling ? 0.04 : CHAR_FRICTION;
  body.frictionStatic = wriggling ? 0.04 : CHAR_FRICTION_STATIC;
}

/**
 * After physics: keep a short inward step and undo ejection.
 * `distBefore` is player↔ball distance before the physics step.
 */
export function applyWriggleProgress(world: World, dir: Vec2, distBefore: number): void {
  const { player, ball, physics } = world;
  const distAfter = Math.hypot(ball.position.x - player.position.x, ball.position.y - player.position.y);
  const kept = Math.min(distAfter, distBefore);
  const target = Math.max(0, kept - WRIGGLE_NUDGE);
  const pull = distAfter - target;
  if (pull > 0.01) {
    player.position.x += dir.x * pull;
    player.position.y += dir.y * pull;
    const body = physics.bodies.get(player.id);
    if (body) Matter.Body.setPosition(body, { x: player.position.x, y: player.position.y });
  }
  const body = physics.bodies.get(player.id);
  if (!body) return;
  const away = body.velocity.x * -dir.x + body.velocity.y * -dir.y;
  if (away > 0) {
    Matter.Body.setVelocity(body, {
      x: body.velocity.x + dir.x * away,
      y: body.velocity.y + dir.y * away,
    });
  }
}
