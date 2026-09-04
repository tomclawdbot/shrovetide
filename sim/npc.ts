// sim/npc.ts — NPC AI steering. Role-based (TICKET 002):
//   - chase: swarm a loose stone; once carrying / shepherding, drive the
//     millstone that team scores at (opponentGoalFor) — never their home stone
//   - hold: stay near holdPosition, but engage ball if it's within range;
//     collapse onto a carrier who threatens their own millstone
//
// NPCs are steered via matter.js applyForce; obstacles deflect them naturally
// via collision (the "hug" still works). Terrain slow-down (river / hedge)
// is applied at the velocity-clamp step using speedMultiplierAt(map).
// Packed bodies lose shove authority so the scrum grinds instead of skating.

import Matter from 'matter-js';
import { opponentGoalFor, speedMultiplierAt } from './maps.js';
import { MATTER_VELOCITY_SCALE } from './physics.js';
import type { NPC, Team, Vec2 } from './types.js';
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
/**
 * Kickoff: stay in a pure swarm while the stone is still at the turn-up.
 * After it squirts clear, chase intelligence drives the scoring end.
 */
export const TURN_UP_SWARM_RADIUS = 240;
/** Close enough to a loose stone to shepherd it instead of only swarming. */
export const SHEPHERD_RADIUS = 130;
/**
 * The single closest contesting body may start driving the scoring end
 * from a little farther out than contact — still on the stone, not mid-pitch.
 */
export const CONTEST_STEER_RADIUS = 180;
/** Lead past a loose stone toward the millstone that team scores at. */
const SHEPHERD_LEAD = 220;
/** Lead ahead of a teammate carrier so chase support advances the right way. */
const ESCORT_LEAD = 200;
/** Extra steer while carrying / shepherding so the scoring end actually moves. */
export const SCORE_DRIVE_FORCE_MULT = 1.55;
/** Modest extra cap for an NPC carrier grinding upfield. */
export const SCORE_DRIVE_SPEED_MULT = 1.12;
/**
 * Packed-hug shove floor while carrying. Lets a claimed stone keep crawling
 * toward the millstone instead of stalling on top of it.
 */
export const CARRY_SHOVE_FLOOR = 0.40;
/** Overlap with the stone — drive the millstone, do not stand on it. */
const ON_STONE_RADIUS = 36;

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

    const carrying = world.ball.ownerId === npc.id;
    const drivingScore = isDrivingScoreEnd(npc, world, collapsing);
    let shove = hugShoveAuthority(countHugNeighbors(world, npc.id, npc.position));
    if (carrying) shove = Math.max(shove, CARRY_SHOVE_FLOOR);
    const forceMult = drivingScore ? SCORE_DRIVE_FORCE_MULT : 1;
    Matter.Body.applyForce(
      body,
      body.position,
      { x: dirX * NPC_STEER_FORCE * shove * forceMult, y: dirY * NPC_STEER_FORCE * shove * forceMult },
    );

    const looseBoost =
      world.ball.ownerId === null && target === world.ball.position ? LOOSE_BALL_SPEED_MULT : 1;
    const carryMult = carrying ? MOVEMENT.carrierSpeedMult : 1;
    const driveBoost = carrying ? SCORE_DRIVE_SPEED_MULT : 1;
    const defendBoost = collapsing ? GOAL_DEFEND_SPEED_MULT : 1;
    const terrainMult = speedMultiplierAt(npc.position, world.map);
    const maxMatter =
      npc.maxSpeed * looseBoost * terrainMult * carryMult * driveBoost * defendBoost * MATTER_VELOCITY_SCALE;
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

/**
 * Public steer target for tests and HUD/debug.
 * Carriers and shepherds aim at the millstone their team scores at.
 */
export function npcSteerTarget(npc: NPC, world: World): Vec2 | null {
  const threatened = threatenedGoalTeam(world);
  const collapsing = threatened !== null && npc.team === threatened;
  return pickTarget(npc, world, collapsing);
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
  npc: NPC,
  world: World,
  collapsing: boolean,
): Vec2 | null {
  const scoreAt = opponentGoalFor(npc.team, world.map);

  // Carrier: always the millstone this team scores at — never home stone.
  if (world.ball.ownerId === npc.id) {
    return { x: scoreAt.x, y: scoreAt.y };
  }

  // Threatened hold/chase: crash the stone to stop a breakaway.
  if (collapsing) {
    return contestFocus(world);
  }

  if (world.ball.ownerId !== null) {
    const carrier = findCharacter(world, world.ball.ownerId);
    if (npc.role === 'chase') {
      if (carrier && carrier.team === npc.team) {
        return advanceToward(carrier.position, scoreAt, ESCORT_LEAD);
      }
      if (carrier) return carrier.position;
    }
    return holdTarget(npc, world);
  }

  // Loose stone: swarm at the turn-up; once it squirts, shepherd the scoring end.
  if (npc.role === 'chase') {
    if (!isTurnUpSwarm(world) && isShepherding(npc, world)) {
      return shepherdTarget(npc, world, scoreAt);
    }
    return world.ball.position;
  }

  return holdTarget(npc, world);
}

function holdTarget(npc: NPC, world: World): Vec2 {
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

export function isTurnUpSwarm(world: World): boolean {
  const tu = world.map.turnUp;
  const dx = world.ball.position.x - tu.x;
  const dy = world.ball.position.y - tu.y;
  return Math.hypot(dx, dy) < TURN_UP_SWARM_RADIUS;
}

function isDrivingScoreEnd(npc: NPC, world: World, collapsing: boolean): boolean {
  if (collapsing) return false;
  if (world.ball.ownerId === npc.id) return true;
  if (world.ball.ownerId !== null) {
    const carrier = findCharacter(world, world.ball.ownerId);
    return npc.role === 'chase' && carrier !== null && carrier.team === npc.team;
  }
  return !isTurnUpSwarm(world) && isShepherding(npc, world);
}

function shepherdTarget(npc: NPC, world: World, scoreAt: { x: number; y: number }): Vec2 {
  const dx = world.ball.position.x - npc.position.x;
  const dy = world.ball.position.y - npc.position.y;
  // Standing on the stone: run the millstone, do not park on it.
  if (Math.hypot(dx, dy) < ON_STONE_RADIUS) {
    return { x: scoreAt.x, y: scoreAt.y };
  }
  return advanceToward(world.ball.position, scoreAt, SHEPHERD_LEAD);
}

function isShepherding(npc: NPC, world: World): boolean {
  const dx = world.ball.position.x - npc.position.x;
  const dy = world.ball.position.y - npc.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= SHEPHERD_RADIUS) return true;
  return closestContestingId(world) === npc.id && dist <= CONTEST_STEER_RADIUS;
}

function closestContestingId(world: World): string {
  let bestId = world.player.id;
  let bestD = hypot2(world.player.position, world.ball.position);
  for (const other of world.npcs) {
    const d = hypot2(other.position, world.ball.position);
    if (d < bestD) {
      bestD = d;
      bestId = other.id;
    }
  }
  return bestId;
}

function advanceToward(from: Vec2, goal: { x: number; y: number }, lead: number): Vec2 {
  const dx = goal.x - from.x;
  const dy = goal.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: goal.x, y: goal.y };
  const k = Math.min(lead, dist);
  return { x: from.x + (dx / dist) * k, y: from.y + (dy / dist) * k };
}

function hypot2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function findCharacter(world: World, id: string): { position: Vec2; team: Team } | null {
  if (id === world.player.id) return world.player;
  const npc = world.npcs.find((n) => n.id === id);
  return npc ?? null;
}
