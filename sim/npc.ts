// sim/npc.ts — NPC AI steering. Role-based (TICKET 002):
//   - chase: full commitment to ball/player (the "hug" from TICKET 001)
//   - hold: stay near holdPosition, but engage ball if it's within range
//
// NPCs are steered via matter.js applyForce; obstacles deflect them naturally
// via collision (the "hug" still works). Water slow-down is applied at the
// velocity-clamp step using speedMultiplierAt(map).

import Matter from 'matter-js';
import { speedMultiplierAt } from './maps.js';
import { MATTER_VELOCITY_SCALE } from './physics.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

const NPC_STEER_FORCE = 0.00022;
/** Distance (px) at which a HOLD-roled NPC engages the ball over its hold point. */
const HOLD_BALL_ENGAGE_DISTANCE = 140;

export function steerNPCs(world: World): void {
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i];
    if (!npc) continue;
    const body = world.physics.bodies.get(npc.id);
    if (!body) continue;

    const target = pickTarget(npc, world);
    if (!target) continue;

    const dx = target.x - npc.position.x;
    const dy = target.y - npc.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;

    const dirX = dx / dist;
    const dirY = dy / dist;

    Matter.Body.applyForce(
      body,
      body.position,
      { x: dirX * NPC_STEER_FORCE, y: dirY * NPC_STEER_FORCE },
    );

    // Clamp Matter velocity (px/baseDelta) to maxSpeed px/s × water mult.
    const waterMult = speedMultiplierAt(npc.position, world.map);
    const maxMatter = npc.maxSpeed * waterMult * MATTER_VELOCITY_SCALE;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.hypot(vx, vy);
    if (speed > maxMatter) {
      const k = maxMatter / speed;
      Matter.Body.setVelocity(body, { x: vx * k, y: vy * k });
    }
  }
}

/** Pick the target position for an NPC based on its role + ball/player state. */
function pickTarget(npc: World['npcs'][number], world: World): Vec2 | null {
  if (npc.role === 'chase') {
    // First-run: opponents hesitate so a human can actually carry.
    if (npc.team !== world.player.team) {
      const bx = world.ball.position.x - npc.position.x;
      const by = world.ball.position.y - npc.position.y;
      if (Math.hypot(bx, by) > 420) return npc.holdPosition ?? npc.position;
    }
    if (world.ball.ownerId !== null) {
      const carrier = findCharacter(world, world.ball.ownerId);
      if (carrier) return carrier.position;
    }
    return world.ball.position;
  }

  // HOLD — guard holdPosition, but engage ball if it drifts into the zone.
  if (!npc.holdPosition) {
    // No placement yet (pre-confirm) — default to ball.
    return world.ball.position;
  }
  const dxBall = world.ball.position.x - npc.holdPosition.x;
  const dyBall = world.ball.position.y - npc.holdPosition.y;
  if (Math.hypot(dxBall, dyBall) < HOLD_BALL_ENGAGE_DISTANCE) {
    return world.ball.position;
  }
  return npc.holdPosition;
}

function findCharacter(world: World, id: string): { position: Vec2 } | null {
  if (id === world.player.id) return world.player;
  const npc = world.npcs.find((n) => n.id === id);
  return npc ?? null;
}