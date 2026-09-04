// sim/pass.ts — ball pickup + pass release mechanics (TICKET 002 update).
//
// TICKET 002 changes:
//   - physics.bodies is now a Map keyed by character id (not _physics
//     with playerBody + npcBodies arrays).
//   - pickup checks distance from the controlled character (world.player),
//     not the hardcoded 'player' literal.
//   - carried-ball lock uses the carrier's current physics body.

import Matter from 'matter-js';
import { toMatterVelocity } from './physics.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

export const PICKUP_PADDING = 10;
/** Extra gap past pickup range so the kicker does not re-grab on the next tick. */
const RELEASE_CLEARANCE = 8;
const MIN_CHARGE_SECONDS = 0.2;
const MAX_CHARGE_SECONDS = 1.5;
const MIN_PASS_SPEED = 120;
const MAX_PASS_SPEED = 340;
/** ~0.3s at 60 Hz — covers the first kick's pickup bubble. */
export const PASS_PICKUP_IMMUNITY_TICKS = 18;

export function pickupReach(radius: number, ballRadius: number): number {
  return radius + ballRadius + PICKUP_PADDING;
}

function isPickupImmune(world: World, id: string): boolean {
  return world.passImmuneId === id && world.tick < world.passImmuneUntilTick;
}

/**
 * If the ball is loose, the nearest in-range body claims it.
 * Chase NPCs compete with the player using the same reach rule; the player
 * wins an exact-distance tie. `includeNpcs` is false at the turn-up so the
 * kickoff hug can pack before anyone claims.
 */
export function tryPickupBall(world: World, opts: { includeNpcs?: boolean } = {}): void {
  const { ball, player } = world;
  if (ball.ownerId !== null) return;
  if (world.tick < world._ripGhostUntilTick) return;

  const includeNpcs = opts.includeNpcs !== false;
  let bestId: string | null = null;
  let bestDist = Infinity;
  let bestIsPlayer = false;

  const consider = (id: string, pos: { x: number; y: number }, radius: number, isPlayer: boolean): void => {
    if (isPickupImmune(world, id)) return;
    const dx = ball.position.x - pos.x;
    const dy = ball.position.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > pickupReach(radius, ball.radius)) return;
    if (dist < bestDist || (dist === bestDist && isPlayer && !bestIsPlayer)) {
      bestDist = dist;
      bestId = id;
      bestIsPlayer = isPlayer;
    }
  };

  consider(player.id, player.position, player.radius, true);
  if (includeNpcs) {
    for (const npc of world.npcs) {
      if (npc.role !== 'chase') continue;
      consider(npc.id, npc.position, npc.radius, false);
    }
  }

  if (bestId === null) return;
  ball.ownerId = bestId;
  player.hasBall = bestId === player.id;
}

/**
 * Lock the ball to its current carrier every tick. Looks up the carrier's
 * physics body by id (so switching the controlled character preserves the
 * lock if the carrier is unchanged).
 *
 * While carried the ball is a sensor — otherwise Matter resolves the
 * overlapping solid bodies and rocket-launches the carrier (~10× speed).
 */
export function syncCarriedBall(world: World): void {
  const { ball, physics } = world;
  const ownerId = ball.ownerId;
  if (ownerId === null) {
    if (physics.ballBody.isSensor) {
      physics.ballBody.isSensor = false;
    }
    return;
  }
  const body = physics.bodies.get(ownerId);
  if (!body) return;
  physics.ballBody.isSensor = true;
  Matter.Body.setPosition(physics.ballBody, { x: body.position.x, y: body.position.y });
  Matter.Body.setVelocity(physics.ballBody, { x: 0, y: 0 });
}

/**
 * Release a pass from the controlled character.
 */
export function releasePass(world: World, aim: Vec2, chargeSeconds: number): boolean {
  const { player, ball, physics, _rng } = world;
  if (!player.hasBall) return false;

  const len = Math.hypot(aim.x, aim.y);
  if (len === 0) {
    // No aim direction → drop the ball in place rather than firing it.
    player.hasBall = false;
    ball.ownerId = null;
    world.passImmuneId = player.id;
    world.passImmuneUntilTick = world.tick + PASS_PICKUP_IMMUNITY_TICKS;
    physics.ballBody.isSensor = false;
    Matter.Body.setVelocity(physics.ballBody, { x: 0, y: 0 });
    return false;
  }

  const dirX = aim.x / len;
  const dirY = aim.y / len;

  const clampedCharge = Math.max(MIN_CHARGE_SECONDS, Math.min(MAX_CHARGE_SECONDS, chargeSeconds));
  const chargeRatio = (clampedCharge - MIN_CHARGE_SECONDS) / (MAX_CHARGE_SECONDS - MIN_CHARGE_SECONDS);
  const speed = MIN_PASS_SPEED + chargeRatio * (MAX_PASS_SPEED - MIN_PASS_SPEED);

  const inaccuracyRad = (0.10 * (1 - chargeRatio) + 0.02) * (_rng() - 0.5) * 2;
  const angle = Math.atan2(dirY, dirX) + inaccuracyRad;

  const offset = player.radius + ball.radius + PICKUP_PADDING + RELEASE_CLEARANCE;
  const releaseX = player.position.x + Math.cos(angle) * offset;
  const releaseY = player.position.y + Math.sin(angle) * offset;

  player.hasBall = false;
  ball.ownerId = null;
  world.passImmuneId = player.id;
  world.passImmuneUntilTick = world.tick + PASS_PICKUP_IMMUNITY_TICKS;

  // Solid again before the kick impulse so the ball interacts with the pitch.
  physics.ballBody.isSensor = false;
  Matter.Body.setPosition(physics.ballBody, { x: releaseX, y: releaseY });
  // Pass speeds are authored in px/s; Matter wants px per baseDelta.
  Matter.Body.setVelocity(
    physics.ballBody,
    toMatterVelocity({
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    }),
  );

  return true;
}