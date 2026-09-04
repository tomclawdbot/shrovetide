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
import { goalFor, opponentGoalFor, speedMultiplierAt } from './maps.js';
import { MATTER_VELOCITY_SCALE } from './physics.js';
import { getSpeedMultiplier, updateStamina } from './stamina.js';
import type { NPC, Team, Vec2 } from './types.js';
import { countHugNeighbors, hugShoveAuthority, MOVEMENT, type World } from './world.js';

/**
 * Scaled with CHAR_DENSITY so an isolated chaser still hits cap in ~1s.
 * Packed bodies get this cut (see hugShoveAuthority) so the scrum grinds.
 */
const NPC_STEER_FORCE = 0.0015;
/** Distance (px) at which a HOLD NPC engages a carried ball over its hold point. */
export const HOLD_BALL_ENGAGE_DISTANCE = 480;
/** Loose ball: hold players join the scrum from much further out. */
export const HOLD_LOOSE_ENGAGE_DISTANCE = 1200;
/** Closest hold bodies who leave the millstone to reclaim an enemy carrier. */
export const HOLD_RECLAIM_COUNT = 2;
/** Closest hold bodies who help swarm a loose stone from anywhere. */
export const HOLD_LOOSE_HELP_COUNT = 3;
/** Speed above this counts as moving for NPC Breath (px/s). */
const NPC_MOVE_SPEED = 18;
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
const SHEPHERD_LEAD = 200;
/** Lead ahead of a teammate carrier so chase support advances the right way. */
const ESCORT_LEAD = 180;
/**
 * Extra steer while carrying / escorting so the scoring end actually moves.
 * #19 clamped the rocket (Matter pair overlap); this is a nudge on top of
 * the authored carry cap — keep it under NPC_VS_SPRINT_BUDGET in tests.
 */
export const SCORE_DRIVE_FORCE_MULT = 1.36;
/** Tiny extra cap while carrying — still a defendable walk, not a burst. */
export const SCORE_DRIVE_SPEED_MULT = 1.04;
/**
 * Peak NPC open-field / carrier speed as a fraction of player Sprint
 * (`PLAYER_MAX_SPEED * SPRINT_SPEED_MULT`). Sprint must be able to contest
 * a breakaway; 0.88 leaves the player a catch-up margin.
 */
export const NPC_VS_SPRINT_BUDGET = 0.88;
/**
 * Packed-hug shove floor while carrying. Lets a claimed stone keep crawling
 * toward the millstone instead of stalling on top of it.
 */
export const CARRY_SHOVE_FLOOR = 0.46;
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

    clampBodyToCap(body, npcSpeedCap(npc, world, collapsing, target === world.ball.position));
  }
}

/**
 * Same Breath rules as the player: move drains, Sprint-like bursts drain
 * faster, idle at a hold regenerates, spent Breath kills the burst.
 */
export function tickNpcStamina(world: World, dt: number): void {
  const threatened = threatenedGoalTeam(world);
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i];
    if (!npc) continue;
    const collapsing = threatened !== null && npc.team === threatened;
    const carrying = world.ball.ownerId === npc.id;
    const ripping = world._npcRipId === npc.id && world._npcRipPressure > 0;
    const bursting = npcIsBursting(npc, world, collapsing);
    const moving = Math.hypot(npc.velocity.x, npc.velocity.y) > NPC_MOVE_SPEED;
    updateStamina(
      npc,
      {
        sprinting: bursting,
        moving,
        carrying,
        ripping,
      },
      dt,
    );
  }
}

/** True when this NPC is using a Sprint-like speed burst (loose contest / last-third defend). */
export function npcIsBursting(npc: NPC, world: World, collapsing?: boolean): boolean {
  if (npc.stamina <= 0) return false;
  if (world.ball.ownerId === npc.id) return false;
  const threatened = collapsing === undefined ? threatenedGoalTeam(world) : null;
  const isCollapsing = collapsing ?? (threatened !== null && npc.team === threatened);
  if (isCollapsing) return true;
  if (world.ball.ownerId !== null) return false;
  const target = pickTarget(npc, world, isCollapsing);
  return target === world.ball.position;
}

/**
 * Authored NPC speed cap in px/s (before Matter scale). Isolated carriers
 * sit on `maxSpeed * carrierSpeedMult`; open-field chase is `maxSpeed`.
 */
export function npcSpeedCap(
  npc: NPC,
  world: World,
  collapsing?: boolean,
  targetingLooseBall?: boolean,
): number {
  const threatened = collapsing === undefined ? threatenedGoalTeam(world) : null;
  const isCollapsing =
    collapsing ?? (threatened !== null && npc.team === threatened);
  const carrying = world.ball.ownerId === npc.id;
  let aimingAtLoose = targetingLooseBall;
  if (aimingAtLoose === undefined) {
    const target = pickTarget(npc, world, isCollapsing);
    aimingAtLoose = target === world.ball.position;
  }
  const breathMult = getSpeedMultiplier(npc);
  const canBurst = npc.stamina > 0;
  const looseBoost =
    canBurst && world.ball.ownerId === null && aimingAtLoose ? LOOSE_BALL_SPEED_MULT : 1;
  const carryMult = carrying ? MOVEMENT.carrierSpeedMult : 1;
  const driveBoost = carrying ? SCORE_DRIVE_SPEED_MULT : 1;
  const defendBoost = canBurst && isCollapsing ? GOAL_DEFEND_SPEED_MULT : 1;
  const terrainMult = speedMultiplierAt(npc.position, world.map);
  return npc.maxSpeed * looseBoost * terrainMult * carryMult * driveBoost * defendBoost * breathMult;
}

/** After physics: enforce the cap so a leftover collision impulse cannot stick. */
export function clampNpcVelocities(world: World): void {
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i];
    if (!npc) continue;
    const body = world.physics.bodies.get(npc.id);
    if (!body) continue;
    clampBodyToCap(body, npcSpeedCap(npc, world));
  }
}

function clampBodyToCap(body: Matter.Body, capPxPerSec: number): void {
  const maxMatter = capPxPerSec * MATTER_VELOCITY_SCALE;
  const vx = body.velocity.x;
  const vy = body.velocity.y;
  const speed = Math.hypot(vx, vy);
  if (speed > maxMatter) {
    const k = maxMatter / speed;
    Matter.Body.setVelocity(body, { x: vx * k, y: vy * k });
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

/**
 * Hold role bias: help reclaim/claim when assigned or in range; otherwise
 * cover the millstone this team defends (home stone), not mill at scatter.
 */
function holdTarget(npc: NPC, world: World): Vec2 {
  const home = goalFor(npc.team, world.map);
  const focus = contestFocus(world);
  const from = npc.holdPosition ?? npc.position;
  const range = Math.hypot(focus.x - from.x, focus.y - from.y);

  if (world.ball.ownerId === null) {
    const help =
      range < HOLD_LOOSE_ENGAGE_DISTANCE ||
      isAmongClosestHolders(npc, world, HOLD_LOOSE_HELP_COUNT);
    return help ? world.ball.position : { x: home.x, y: home.y };
  }

  const carrier = findCharacter(world, world.ball.ownerId);
  if (!carrier) return { x: home.x, y: home.y };

  // Teammate has the stone — stay home and cover the millstone we defend.
  if (carrier.team === npc.team) {
    return { x: home.x, y: home.y };
  }

  const reclaim =
    range < HOLD_BALL_ENGAGE_DISTANCE || isAmongClosestHolders(npc, world, HOLD_RECLAIM_COUNT);
  if (reclaim) return carrier.position;
  return { x: home.x, y: home.y };
}

/** Nearest `count` hold-role NPCs on this team to the contest, stable by id. */
export function isAmongClosestHolders(npc: NPC, world: World, count: number): boolean {
  if (npc.role !== 'hold') return false;
  const focus = contestFocus(world);
  const holders = world.npcs.filter((n) => n.team === npc.team && n.role === 'hold');
  holders.sort((a, b) => {
    const da = hypot2(a.position, focus);
    const db = hypot2(b.position, focus);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const n = Math.max(0, Math.min(count, holders.length));
  for (let i = 0; i < n; i++) {
    if (holders[i]!.id === npc.id) return true;
  }
  return false;
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
  if (world.ball.ownerId === null) {
    return npc.role === 'chase' && !isTurnUpSwarm(world) && isShepherding(npc, world);
  }
  const carrier = findCharacter(world, world.ball.ownerId);
  return npc.role === 'chase' && carrier !== null && carrier.team === npc.team;
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
