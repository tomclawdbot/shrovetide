// sim/pass.ts — ball pickup + pass release mechanics (TICKET 002 update).
//
// TICKET 002 changes:
//   - physics.bodies is now a Map keyed by character id (not _physics
//     with playerBody + npcBodies arrays).
//   - pickup checks distance from the controlled character (world.player),
//     not the hardcoded 'player' literal.
//   - carried-ball lock uses the carrier's current physics body.
//
// Breakaway window (snap-back feel): after a *player* Rip or kick, *no* NPC
// chase can claim for PLAYER_RELEASE_OPP_PICKUP_TICKS. Immunity / clearance
// only stop the releaser; teammates eating a kick felt like instant reclaim.
// Not a permanent AI nerf — dawdling still loses.

import Matter from 'matter-js';
import { clearPositionImpulse, setBallSensor, toMatterVelocity } from './physics.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

export const PICKUP_PADDING = 10;
/**
 * Extra gap past pickup range so the kick starts outside the hug bubble.
 * 8px left the first frame inside opposing reach; 18px gives a readable pop.
 */
export const RELEASE_CLEARANCE = 18;
export const MIN_CHARGE_SECONDS = 0.2;
export const MAX_CHARGE_SECONDS = 1.5;
const MIN_PASS_SPEED = 120;
const MAX_PASS_SPEED = 340;

/** 0 at a tap / min hold, 1 at a full hold. Same curve `releasePass` uses. */
export function passChargeRatio(chargeSeconds: number): number {
  const clamped = Math.max(MIN_CHARGE_SECONDS, Math.min(MAX_CHARGE_SECONDS, chargeSeconds));
  return (clamped - MIN_CHARGE_SECONDS) / (MAX_CHARGE_SECONDS - MIN_CHARGE_SECONDS);
}

/** ~0.5s at 60 Hz — kicker cannot re-grab while the stone is leaving. */
export const PASS_PICKUP_IMMUNITY_TICKS = 30;
/**
 * Ticks a kicked stone ignores character collisions (~0.4s). Same job as
 * RIP_GHOST_TICKS: the first physics steps must not bounce it back into the pack.
 * Kick is slower than a Rip pop, so this is a few frames longer.
 */
export const PASS_GHOST_TICKS = 24;
/**
 * After a *player* Rip or kick, NPC chase cannot claim (~1.6s at 60 Hz).
 * Gives a readable breakaway without a permanent AI nerf; dawdling still loses.
 */
export const PLAYER_RELEASE_OPP_PICKUP_TICKS = 96;

export function pickupReach(radius: number, ballRadius: number): number {
  return radius + ballRadius + PICKUP_PADDING;
}

function isPickupImmune(world: World, id: string): boolean {
  return world.passImmuneId === id && world.tick < world.passImmuneUntilTick;
}

/** True while NPC chase must not claim a player-released stone. */
export function isOpposingPickupBlocked(world: World): boolean {
  return world.tick < world._oppPickupBlockedUntilTick;
}

/** Start the short post-Rip / post-kick window (player release only). */
export function beginPlayerReleaseWindow(world: World): void {
  world._oppPickupBlockedUntilTick = world.tick + PLAYER_RELEASE_OPP_PICKUP_TICKS;
}

/** Sensor frames so a kick/drop is not bounced back by the bodies it left. */
function beginPassGhost(world: World): void {
  world._ripGhostUntilTick = world.tick + PASS_GHOST_TICKS;
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
  if (world.recoveryTimeRemaining > 0) return;
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
    // Window blocks every NPC, not only opposition — a packed teammate
    // claiming on tick 1 made kicks feel like instant reclaim.
    const blockNpcClaim = isOpposingPickupBlocked(world);
    for (const npc of world.npcs) {
      if (npc.role !== 'chase') continue;
      if (blockNpcClaim) continue;
      consider(npc.id, npc.position, npc.radius, false);
    }
  }

  if (bestId === null) return;
  ball.ownerId = bestId;
  player.hasBall = bestId === player.id;
  // Sensor + pair flags now, not next tick — otherwise the claim overlap rockets.
  setBallSensor(world.physics, true);
  const carrierBody = world.physics.bodies.get(bestId);
  if (carrierBody) clearPositionImpulse(carrierBody);
  clearPositionImpulse(world.physics.ballBody);
}

/**
 * Lock the ball to its current carrier every tick. Looks up the carrier's
 * physics body by id (so switching the controlled character preserves the
 * lock if the carrier is unchanged).
 *
 * While carried the ball is a sensor — otherwise Matter resolves the
 * overlapping solid bodies and rocket-launches the carrier (~10× speed).
 * `setBallSensor` also flips existing pair.isSensor flags; Matter only
 * sets that bit at pair creation, so a claim that started solid-on-solid
 * would keep exploding the overlap if we only set `body.isSensor`.
 */
export function syncCarriedBall(world: World): void {
  const { ball, physics } = world;
  const ownerId = ball.ownerId;
  if (ownerId === null) {
    if (physics.ballBody.isSensor) {
      setBallSensor(physics, false);
    }
    return;
  }
  const body = physics.bodies.get(ownerId);
  if (!body) return;
  setBallSensor(physics, true);
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
    beginPlayerReleaseWindow(world);
    beginPassGhost(world);
    setBallSensor(physics, true);
    Matter.Body.setVelocity(physics.ballBody, { x: 0, y: 0 });
    ball.velocity.x = 0;
    ball.velocity.y = 0;
    return false;
  }

  const dirX = aim.x / len;
  const dirY = aim.y / len;

  const chargeRatio = passChargeRatio(chargeSeconds);
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
  beginPlayerReleaseWindow(world);
  beginPassGhost(world);

  // Sensor while ghosting so the first physics steps cannot bounce the stone
  // back into the pack. stepWorld keeps the flag until PASS_GHOST_TICKS elapse.
  setBallSensor(physics, true);
  Matter.Body.setPosition(physics.ballBody, { x: releaseX, y: releaseY });
  // Pass speeds are authored in px/s; Matter wants px per baseDelta.
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  Matter.Body.setVelocity(physics.ballBody, toMatterVelocity({ x: vx, y: vy }));
  ball.position.x = releaseX;
  ball.position.y = releaseY;
  ball.velocity.x = vx;
  ball.velocity.y = vy;

  return true;
}