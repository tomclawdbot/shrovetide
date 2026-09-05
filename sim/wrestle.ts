// sim/wrestle.ts — Wriggle into a packed hug, then Rip the stone free.
//
// One hold (desktop F / touch Wriggle·Rip): the sim picks the mode.
//   • Wriggle — empty-handed, in contact with a dense pack, not yet on the stone.
//     Inward impulse + a shove-floor so you can grind in; costly Breath; not a teleport.
//   • Rip — empty-handed, already deep / near the stone, dense pack.
//     Hold builds pressure; on success the ball pops *clear of the scrum*
//     along facing (or out through the player's side). Early release spends
//     Breath and does not pop. Brief jostles do not reset a live contest.
//
// Deterministic: no Math.random, no wall-clock. Pickup is suppressed while
// the hold is active so a wrestle can finish instead of auto-grabbing.

import Matter from 'matter-js';
import { isInMapBounds, isInObstacle, isOutOfBounds, nearestLegalPoint } from './maps.js';
import { CHAR_FRICTION, CHAR_FRICTION_STATIC, setBallSensor, toMatterVelocity } from './physics.js';
import { PASS_PICKUP_IMMUNITY_TICKS } from './pass.js';
import {
  countBodiesNear,
  countHugNeighbors,
  hugNeighborCentroid,
  hugPackExtent,
  HUG_NEIGHBOR_RADIUS,
} from './hug.js';
import { difficultyTuning } from './difficulty.js';
import { opponentGoalFor } from './maps.js';
import type { Input, NPC, Team, Vec2 } from './types.js';
import type { World } from './world.js';

/** Matches MOVEMENT.inputDeadzone — avoid importing world.ts (cycle). */
const AIM_DEADZONE = 0.15;

/** Must be this close to the stone to start Rip (hug-neighbour distance). */
export const RIP_REACH = HUG_NEIGHBOR_RADIUS;
/** Minimum Breath required to start a Rip contest. */
export const RIP_MIN_STAMINA = 25;
/** Several bodies nearby — a real scrum, not a 1v1. */
export const RIP_MIN_NEIGHBORS = 3;
/** Packed hug around an opposing carrier: 2 neighbours is enough to start the strip. */
export const RIP_CARRIER_MIN_NEIGHBORS = 2;
/** Hold time to pop the stone once Rip is eligible — long enough for the hug to grind. */
export const RIP_SUCCESS_SECONDS = 1.0;
/** Pop speed (px/s) after the stone is already placed outside the pack. */
export const RIP_POP_SPEED = 340;
/** Ripper cannot re-grab while the stone is leaving the scrum. */
export const RIP_IMMUNITY_TICKS = 48;
/**
 * Ticks the popped stone ignores character collisions so the first physics
 * step cannot bounce it back into the bodies it just left.
 */
export const RIP_GHOST_TICKS = 12;
/** Extra gap past the pack's outer skin so the stone is visibly free. */
export const RIP_CLEAR_PADDING = 26;
/** Keep a live Rip contest this many ticks after a jostle leaves Rip range. */
export const RIP_GRACE_TICKS = 24;
/** After an NPC pops the stone, nobody NPC-rips again until this many ticks (normal). */
export const NPC_RIP_COOLDOWN_TICKS = 210;
/** Default NPC hold (normal). Overridden per match by difficulty tuning. */
export const NPC_RIP_SUCCESS_SECONDS = 1.15;

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
  if (world.player.stamina < RIP_MIN_STAMINA) return false;
  if (world.player.hasBall) return false;
  if (world.ball.ownerId === world.player.id) return false;
  if (distToBall(world) > RIP_REACH) return false;
  const neighbors = countHugNeighbors(world, world.player.id, world.player.position);
  const ownerId = world.ball.ownerId;
  if (ownerId !== null) {
    const carrier = charPose(world, ownerId);
    if (carrier && carrier.team !== world.player.team) {
      return neighbors >= RIP_CARRIER_MIN_NEIGHBORS;
    }
  }
  return neighbors >= RIP_MIN_NEIGHBORS;
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

/** Still in the wrestle — empty-handed and near the scrum — even if Rip range flickers. */
export function inRipContest(world: World): boolean {
  if (world.player.hasBall) return false;
  if (world.ball.ownerId === world.player.id) return false;
  if (distToBall(world) > WRIGGLE_APPROACH_RADIUS) return false;
  const near = countHugNeighbors(world, world.player.id, world.player.position);
  if (near >= 1) return true;
  return countBodiesNear(world, world.ball.position, HUG_NEIGHBOR_RADIUS) >= WRIGGLE_PACK_AROUND_BALL;
}

/** Button / prompt mode. Live Rip pressure keeps the pad on Rip through a jostle. */
export function wrestleMode(world: World): WrestleMode {
  if (
    canRip(world) ||
    (world._ripPressure > 0 && (inRipContest(world) || world._ripGraceTicks > 0))
  ) {
    return 'rip';
  }
  if (canWriggle(world)) return 'wriggle';
  return 'none';
}

function wrestleHeld(input: Input): boolean {
  return input.rip || input.wriggle;
}

function facingDir(world: World, input: Input): Vec2 | null {
  const moveLen = Math.hypot(input.move.x, input.move.y);
  if (moveLen > AIM_DEADZONE) {
    return { x: input.move.x / moveLen, y: input.move.y / moveLen };
  }
  const cv = Math.hypot(world._controlVel.x, world._controlVel.y);
  if (cv > 1) {
    return { x: world._controlVel.x / cv, y: world._controlVel.y / cv };
  }
  return null;
}

/**
 * Facing wins (a ray from the pack centroid along facing leaves the far side
 * if you are looking into the stone). Otherwise out through the player's side.
 */
function popDirection(world: World, input: Input, centroid: Vec2): Vec2 {
  const facing = facingDir(world, input);
  if (facing) return facing;
  const throughPlayer = toward(centroid, world.player.position);
  if (throughPlayer) return throughPlayer;
  const cluster = hugNeighborCentroid(world, world.player.id, world.player.position);
  if (cluster) {
    const away = toward(cluster, world.player.position);
    if (away) return away;
  }
  const fromBall = toward(world.ball.position, world.player.position);
  if (fromBall) return fromBall;
  return { x: 1, y: 0 };
}

function rotate(dir: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
}

function legalPopSpot(world: World, pos: Vec2): boolean {
  if (!isInMapBounds(pos, world.map)) return false;
  if (isOutOfBounds(pos, world.map)) return false;
  if (isInObstacle(pos, world.map)) return false;
  return true;
}

/** Place the stone outside the pack along `dir`, or the next legal angle. */
export function clearPopPose(
  world: World,
  centroid: Vec2,
  dir: Vec2,
  dist: number,
): { pos: Vec2; dir: Vec2 } {
  const angles = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI];
  for (const a of angles) {
    const d = a === 0 ? dir : rotate(dir, a);
    const pos = { x: centroid.x + d.x * dist, y: centroid.y + d.y * dist };
    if (legalPopSpot(world, pos)) return { pos, dir: d };
  }
  const raw = { x: centroid.x + dir.x * dist, y: centroid.y + dir.y * dist };
  const legal = nearestLegalPoint(raw, world.map);
  return { pos: { x: legal.x, y: legal.y }, dir };
}

function clearBallOwner(world: World): void {
  if (world.ball.ownerId === world.player.id) {
    world.player.hasBall = false;
  }
  world.ball.ownerId = null;
}

/** How far from the pack centroid the stone must sit to be clear of the scrum. */
export function ripClearDistance(world: World, around: Vec2 = world.ball.position): number {
  const pack = hugPackExtent(world, around);
  const skin = pack?.radius ?? HUG_NEIGHBOR_RADIUS;
  return skin + world.ball.radius + RIP_CLEAR_PADDING;
}

/** Squirt the stone free along `dir` (unit) — placed outside the packed scrum. */
export function popBallFree(world: World, dir: Vec2, speed: number, ripperId?: string): void {
  const { ball, physics } = world;
  const pack = hugPackExtent(world, ball.position);
  const centroid = pack?.centroid ?? { ...ball.position };
  const dist = ripClearDistance(world, ball.position);
  const pose = clearPopPose(world, centroid, dir, dist);

  const ripper = ripperId ?? world.player.id;
  clearBallOwner(world);
  world.passImmuneId = ripper;
  world.passImmuneUntilTick = world.tick + RIP_IMMUNITY_TICKS;
  world._ripGhostUntilTick = world.tick + RIP_GHOST_TICKS;

  setBallSensor(physics, true);
  Matter.Body.setPosition(physics.ballBody, { x: pose.pos.x, y: pose.pos.y });
  Matter.Body.setVelocity(
    physics.ballBody,
    toMatterVelocity({
      x: pose.dir.x * speed,
      y: pose.dir.y * speed,
    }),
  );
  ball.position.x = pose.pos.x;
  ball.position.y = pose.pos.y;
  ball.velocity.x = pose.dir.x * speed;
  ball.velocity.y = pose.dir.y * speed;
}

/**
 * Advance wrestle state for one tick. Mutates pressure and may pop the ball.
 * Movement application (inward vel + post-physics nudge) stays in stepWorld.
 */
export function tickWrestle(world: World, input: Input, dt: number): WrestleTick {
  const held = wrestleHeld(input);
  const staminaOk = world.player.stamina > 0;
  const contest = inRipContest(world);
  let ripping =
    held && staminaOk && (canRip(world) || (world._ripPressure > 0 && contest));
  if (!ripping && held && staminaOk && world._ripPressure > 0 && world._ripGraceTicks > 0) {
    ripping = true;
    world._ripGraceTicks -= 1;
  } else if (ripping) {
    world._ripGraceTicks = RIP_GRACE_TICKS;
  } else {
    world._ripGraceTicks = 0;
  }

  let mode: WrestleMode = 'none';
  if (ripping) {
    mode = 'rip';
  } else if (held && staminaOk && canWriggle(world)) {
    mode = 'wriggle';
  } else if (held) {
    mode = wrestleMode(world);
  }

  if (!ripping) {
    world._ripPressure = 0;
  } else {
    world._ripPressure += dt / RIP_SUCCESS_SECONDS;
    if (world._ripPressure >= 1) {
      world._ripPressure = 0;
      const pack = hugPackExtent(world, world.ball.position);
      const centroid = pack?.centroid ?? { ...world.ball.position };
      popBallFree(world, popDirection(world, input, centroid), RIP_POP_SPEED);
    }
  }

  const wriggleDir =
    mode === 'wriggle' && staminaOk ? toward(world.player.position, world.ball.position) : null;

  return {
    mode,
    // Hold near the stone never auto-grabs — a wrestle must be allowed to finish.
    suppressPickup: held && distToBall(world) <= WRIGGLE_APPROACH_RADIUS,
    wriggleDir,
  };
}

function charPose(world: World, id: string): { position: Vec2; team: Team } | null {
  if (id === world.player.id) return world.player;
  return world.npcs.find((n) => n.id === id) ?? null;
}

function distIdToBall(world: World, id: string): number {
  const body = charPose(world, id);
  if (!body) return Infinity;
  const dx = world.ball.position.x - body.position.x;
  const dy = world.ball.position.y - body.position.y;
  return Math.hypot(dx, dy);
}

/** Opposing NPC in a dense hug on a carrier — same reach/pack bar as player Rip. */
export function canNpcRip(world: World, npc: NPC): boolean {
  const ownerId = world.ball.ownerId;
  if (ownerId === null || ownerId === npc.id) return false;
  if (npc.stamina < RIP_MIN_STAMINA) return false;
  const carrier = charPose(world, ownerId);
  if (!carrier || carrier.team === npc.team) return false;
  if (distIdToBall(world, npc.id) > RIP_REACH) return false;
  return countHugNeighbors(world, npc.id, npc.position) >= RIP_MIN_NEIGHBORS;
}

/** Still on the carrier's scrum — used to keep a live NPC contest through a jostle. */
export function inNpcRipContest(world: World, npc: NPC): boolean {
  const ownerId = world.ball.ownerId;
  if (ownerId === null || ownerId === npc.id) return false;
  const carrier = charPose(world, ownerId);
  if (!carrier || carrier.team === npc.team) return false;
  if (distIdToBall(world, npc.id) > WRIGGLE_APPROACH_RADIUS) return false;
  if (countHugNeighbors(world, npc.id, npc.position) >= 1) return true;
  return countBodiesNear(world, world.ball.position, HUG_NEIGHBOR_RADIUS) >= WRIGGLE_PACK_AROUND_BALL;
}

export function npcRipContest(world: World): { id: string; pressure: number } | null {
  if (!world._npcRipId || world._npcRipPressure <= 0) return null;
  return { id: world._npcRipId, pressure: Math.min(1, world._npcRipPressure) };
}

export function resetNpcRip(world: World): void {
  world._npcRipId = null;
  world._npcRipPressure = 0;
  world._npcRipGraceTicks = 0;
}

function pickNpcRipper(world: World): NPC | null {
  if (world.tick < world._npcRipCooldownUntilTick) return null;
  if (world.ball.ownerId === null) return null;
  let best: NPC | null = null;
  let bestD = Infinity;
  for (const npc of world.npcs) {
    if (npc.team === world.player.team) continue;
    if (!canNpcRip(world, npc)) continue;
    const d = distIdToBall(world, npc.id);
    if (d < bestD || (d === bestD && best !== null && npc.id < best.id)) {
      bestD = d;
      best = npc;
    }
  }
  return best;
}

function npcRipDirection(world: World, npc: NPC): Vec2 {
  const scoreAt = opponentGoalFor(npc.team, world.map);
  const toGoal = toward(world.ball.position, { x: scoreAt.x, y: scoreAt.y });
  if (toGoal) return toGoal;
  const pack = hugPackExtent(world, world.ball.position);
  const centroid = pack?.centroid ?? world.ball.position;
  const through = toward(centroid, npc.position);
  if (through) return through;
  return { x: 1, y: 0 };
}

/**
 * Nearest eligible opposing NPC holds Rip on a player-team (or any enemy)
 * carrier. Rate-limited so a packed hug is a contest, not steal spam.
 * Player Rip wins if the controlled body is already in a wrestle.
 */
export function tickNpcRip(world: World, dt: number, playerWrestling: boolean): void {
  if (playerWrestling) {
    resetNpcRip(world);
    return;
  }

  let npc: NPC | null = null;
  if (world._npcRipId) {
    npc = world.npcs.find((n) => n.id === world._npcRipId) ?? null;
  }

  let ripping = false;
  if (npc && npc.stamina > 0 && (canNpcRip(world, npc) || (world._npcRipPressure > 0 && inNpcRipContest(world, npc)))) {
    ripping = true;
    world._npcRipGraceTicks = RIP_GRACE_TICKS;
  } else if (npc && npc.stamina > 0 && world._npcRipPressure > 0 && world._npcRipGraceTicks > 0) {
    ripping = true;
    world._npcRipGraceTicks -= 1;
  } else {
    resetNpcRip(world);
    npc = pickNpcRipper(world);
    ripping = npc !== null;
    if (npc) {
      world._npcRipId = npc.id;
      world._npcRipGraceTicks = RIP_GRACE_TICKS;
    }
  }

  if (!npc || !ripping) {
    resetNpcRip(world);
    return;
  }

  world._npcRipId = npc.id;
  const ripSeconds = difficultyTuning(world.difficulty).opponentRipSeconds;
  world._npcRipPressure += dt / ripSeconds;
  if (world._npcRipPressure < 1) return;

  popBallFree(world, npcRipDirection(world, npc), RIP_POP_SPEED, npc.id);
  world._npcRipCooldownUntilTick =
    world.tick + difficultyTuning(world.difficulty).opponentRipCooldownTicks;
  resetNpcRip(world);
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
