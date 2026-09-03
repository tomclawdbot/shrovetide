// sim/npc.ts — NPC AI steering. Role-based (TICKET 002):
//   - chase: full commitment to ball/player (the "hug" from TICKET 001)
//   - hold: stay near holdPosition, but engage ball if it's within range
//
// NPCs are steered via matter.js applyForce; obstacles deflect them naturally
// via collision (the "hug" still works). Terrain slow-down (river / hedge)
// is applied at the velocity-clamp step using speedMultiplierAt(map).
// Packed bodies lose shove authority so the scrum grinds instead of skating.

import Matter from 'matter-js';
import { speedMultiplierAt } from './maps.js';
import { MATTER_VELOCITY_SCALE } from './physics.js';
import type { Team, Vec2 } from './types.js';
import { countHugNeighbors, hugShoveAuthority, MOVEMENT, type World } from './world.js';

/**
 * Scaled with CHAR_DENSITY so an isolated chaser still hits cap in ~1s.
 * Packed bodies get this cut (see hugShoveAuthority) so the scrum grinds.
 */
const NPC_STEER_FORCE = 0.0015;
/** Distance (px) at which a HOLD NPC engages a carried ball over its hold point. */
const HOLD_BALL_ENGAGE_DISTANCE = 220;
/** Loose ball: hold players join the scrum from much further out. */
const HOLD_LOOSE_ENGAGE_DISTANCE = 780;
/** Extra speed while the ball is free so either side can contest the turn-up. */
const LOOSE_BALL_SPEED_MULT = 1.22;
/**
 * When the stone is this close to a millstone, that team's hold line
 * collapses and defenders get a burst so a clean breakaway dies in the last third.
 */
export const GOAL_CONTEST_RADIUS = 680;
/** Speed boost for NPCs defending their threatened millstone. */
export const GOAL_DEFEND_SPEED_MULT = 1.16;

export function steerNPCs(world: World): void {
  const threatened = threatenedGoalTeam(world);
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i];
    if (!npc) continue;
    const body = world.physics.bodies.get(npc.id);
    if (!body) continue;

    const collapsing = threatened !== null && npc.team === threatened;
    const target = pickTarget(npc, world, collapsing);
    if (!target) continue;

    const dx = target.x - npc.position.x;
    const dy = target.y - npc.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;

    const dirX = dx / dist;
    const dirY = dy / dist;

    const shove = hugShoveAuthority(countHugNeighbors(world, npc.id, npc.position));
    Matter.Body.applyForce(
      body,
      body.position,
      { x: dirX * NPC_STEER_FORCE * shove, y: dirY * NPC_STEER_FORCE * shove },
    );

    const looseBoost =
      world.ball.ownerId === null && target === world.ball.position ? LOOSE_BALL_SPEED_MULT : 1;
    const carryMult = world.ball.ownerId === npc.id ? MOVEMENT.carrierSpeedMult : 1;
    const defendBoost = collapsing ? GOAL_DEFEND_SPEED_MULT : 1;
    const terrainMult = speedMultiplierAt(npc.position, world.map);
    const maxMatter =
      npc.maxSpeed * looseBoost * terrainMult * carryMult * defendBoost * MATTER_VELOCITY_SCALE;
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.hypot(vx, vy);
    if (speed > maxMatter) {
      const k = maxMatter / speed;
      Matter.Body.setVelocity(body, { x: vx * k, y: vy * k });
    }
  }
}

/** Team whose millstone is currently under threat, or null. */
export function threatenedGoalTeam(world: World): Team | null {
  const pos = contestFocus(world);
  for (const goal of world.map.goals) {
    const d = Math.hypot(pos.x - goal.position.x, pos.y - goal.position.y);
    if (d < GOAL_CONTEST_RADIUS) return goal.team;
  }
  return null;
}

function contestFocus(world: World): Vec2 {
  if (world.ball.ownerId !== null) {
    const carrier = findCharacter(world, world.ball.ownerId);
    if (carrier) return carrier.position;
  }
  return world.ball.position;
}

/** Pick the target position for an NPC based on its role + ball/player state. */
function pickTarget(
  npc: World['npcs'][number],
  world: World,
  collapsing: boolean,
): Vec2 | null {
  if (collapsing || npc.role === 'chase') {
    // Commit immediately — a 420px hesitate left kickoff as open grass.
    if (world.ball.ownerId !== null) {
      const carrier = findCharacter(world, world.ball.ownerId);
      if (carrier) return carrier.position;
    }
    return world.ball.position;
  }

  // HOLD — guard holdPosition, but crash the loose ball from a long way out.
  if (!npc.holdPosition) {
    return world.ball.position;
  }
  const dxBall = world.ball.position.x - npc.holdPosition.x;
  const dyBall = world.ball.position.y - npc.holdPosition.y;
  const engage =
    world.ball.ownerId === null ? HOLD_LOOSE_ENGAGE_DISTANCE : HOLD_BALL_ENGAGE_DISTANCE;
  if (Math.hypot(dxBall, dyBall) < engage) {
    return world.ball.position;
  }
  return npc.holdPosition;
}

function findCharacter(world: World, id: string): { position: Vec2 } | null {
  if (id === world.player.id) return world.player;
  const npc = world.npcs.find((n) => n.id === id);
  return npc ?? null;
}
