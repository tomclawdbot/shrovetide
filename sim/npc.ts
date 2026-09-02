// sim/npc.ts — NPC AI steering. Force-based attraction toward the ball
// (or toward the player if they have it). matter.js handles the collisions
// that produce the "hug" scrum feel.

import Matter from 'matter-js';
import type { World } from './world.js';

/**
 * Per-NPC steering force magnitude. Tuned for matter.js force units +
 * frictionAir damping so NPCs reach ~80% of maxSpeed within a couple
 * of seconds and then settle at their terminal velocity.
 */
const NPC_STEER_FORCE = 0.00045;

export function steerNPCs(world: World): void {
  const { npcs, ball, player, _physics } = world;

  // When the player has the ball, NPCs swarm the player instead —
  // that's where the "hug" scrum lives.
  const targetIsPlayer = ball.ownerId === player.id;
  const tx = targetIsPlayer ? player.position.x : ball.position.x;
  const ty = targetIsPlayer ? player.position.y : ball.position.y;

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    const body = _physics.npcBodies[i];
    if (!npc || !body) continue;

    const dx = tx - npc.position.x;
    const dy = ty - npc.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;

    // Normalized direction + scaled force.
    const dirX = dx / dist;
    const dirY = dy / dist;

    Matter.Body.applyForce(
      body,
      body.position,
      { x: dirX * NPC_STEER_FORCE, y: dirY * NPC_STEER_FORCE },
    );

    // Clamp velocity to maxSpeed so we don't get out-of-control drift.
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.hypot(vx, vy);
    if (speed > npc.maxSpeed) {
      const k = npc.maxSpeed / speed;
      Matter.Body.setVelocity(body, { x: vx * k, y: vy * k });
    }
  }
}
