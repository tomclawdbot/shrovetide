// sim/pass.ts — ball pickup + pass release mechanics.

import Matter from 'matter-js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

const PICKUP_PADDING = 2;
const MIN_CHARGE_SECONDS = 0.2;
const MAX_CHARGE_SECONDS = 1.5;
const MIN_PASS_SPEED = 200;
const MAX_PASS_SPEED = 620;

/**
 * If the ball is loose and the player is close enough, pick it up.
 * Pure side effect: mutates ball.ownerId + player.hasBall.
 */
export function tryPickupBall(world: World): void {
  const { ball, player } = world;
  if (ball.ownerId !== null) return;

  const dx = ball.position.x - player.position.x;
  const dy = ball.position.y - player.position.y;
  const dist = Math.hypot(dx, dy);
  const pickupRadius = player.radius + ball.radius + PICKUP_PADDING;

  if (dist <= pickupRadius) {
    ball.ownerId = player.id;
    player.hasBall = true;
  }
}

/**
 * Lock the ball to the player when carried. Called every tick.
 * Ball position + velocity follow the player exactly.
 */
export function syncCarriedBall(world: World): void {
  const { ball, player, _physics } = world;
  if (ball.ownerId !== player.id) return;
  Matter.Body.setPosition(_physics.ballBody, { x: player.position.x, y: player.position.y });
  Matter.Body.setVelocity(_physics.ballBody, { x: player.velocity.x, y: player.velocity.y });
}

/**
 * Release a pass. Returns true if the pass fired.
 * - `aim` is a direction vector (need not be normalized, but length must be > 0).
 * - `chargeSeconds` is how long the pass key was held. Maps to power.
 * - Inaccuracy scales with charge — a quick tap is wilder than a full charge.
 *
 * Inaccuracy is sampled from the world's seeded RNG so multiplayer remains
 * deterministic across clients.
 */
export function releasePass(world: World, aim: Vec2, chargeSeconds: number): boolean {
  const { player, ball, _physics, _rng } = world;
  if (!player.hasBall) return false;

  const len = Math.hypot(aim.x, aim.y);
  if (len === 0) {
    // No aim direction → drop the ball in place rather than firing it.
    player.hasBall = false;
    ball.ownerId = null;
    Matter.Body.setVelocity(_physics.ballBody, { x: 0, y: 0 });
    return false;
  }

  // Normalize aim
  const dirX = aim.x / len;
  const dirY = aim.y / len;

  // Charge → speed (clamped)
  const clampedCharge = Math.max(MIN_CHARGE_SECONDS, Math.min(MAX_CHARGE_SECONDS, chargeSeconds));
  const chargeRatio = (clampedCharge - MIN_CHARGE_SECONDS) / (MAX_CHARGE_SECONDS - MIN_CHARGE_SECONDS);
  const speed = MIN_PASS_SPEED + chargeRatio * (MAX_PASS_SPEED - MIN_PASS_SPEED);

  // Inaccuracy: ±12° at min charge, ±2° at full charge.
  // (A short tap is a "lob it vaguely" pass; a full charge is a controlled strike.)
  const inaccuracyRad = (0.21 * (1 - chargeRatio) + 0.035) * (_rng() - 0.5) * 2;
  const angle = Math.atan2(dirY, dirX) + inaccuracyRad;

  // Release the ball from the player's edge in the aim direction.
  const offset = player.radius + ball.radius + 2;
  const releaseX = player.position.x + Math.cos(angle) * offset;
  const releaseY = player.position.y + Math.sin(angle) * offset;

  player.hasBall = false;
  ball.ownerId = null;

  Matter.Body.setPosition(_physics.ballBody, { x: releaseX, y: releaseY });
  Matter.Body.setVelocity(_physics.ballBody, {
    x: Math.cos(angle) * speed,
    y: Math.sin(angle) * speed,
  });

  return true;
}
