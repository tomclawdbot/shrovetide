// sim/placement.ts — strategy-phase squad placement (TICKET 002 Part C).
//
// During matchState === 'placement', the player places their teammates
// on the map by tapping/clicking. Each placed teammate gets a role (HOLD
// or CHASE). Opponents auto-place via a heuristic. confirmPlacement
// transitions matchState to 'playing'.

import Matter from 'matter-js';
import { ASHBOURNE_TOWN, isWalkable, nearestLegalPoint } from './maps.js';
import type { NPC, Role, Team, Vec2 } from './types.js';
import type { World } from './world.js';

/** Chase bodies clustered on the stone at toss-up, per side. */
export const TOSS_UP_PACK_PER_SIDE = 10;
/** Distance from turn-up that counts as "at the ball" for packing asserts. */
export const TOSS_UP_NEAR_RADIUS = 160;
/** Beyond this, a body is a scattered starter — not in the hug. */
export const TOSS_UP_SCATTER_MIN = 520;

function pinBody(world: World, id: string, x: number, y: number): void {
  const body = world.physics.bodies.get(id);
  if (!body) return;
  Matter.Body.setPosition(body, { x, y });
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
}

/** Spread `count` bodies across `xs` ranks between y0 and y1. */
function spreadRanks(
  count: number,
  xs: number[],
  y0: number,
  y1: number,
): { x: number; y: number }[] {
  const ranks = xs.length;
  if (ranks === 0 || count <= 0) return [];
  const base = Math.floor(count / ranks);
  const extra = count % ranks;
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < ranks; r++) {
    const n = base + (r < extra ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      slots.push({ x: xs[r]!, y: y0 + (y1 - y0) * t });
    }
  }
  return slots;
}

/** Move a teammate to (x, y) — snap to nearest legal point if invalid. */
export function placeTeammate(world: World, npcId: string, x: number, y: number): boolean {
  if (world.matchState !== 'placement') return false;
  const npc = world.npcs.find((n) => n.id === npcId);
  if (!npc) return false;
  if (npc.team !== world.player.team) return false;
  const target = nearestLegalPoint({ x, y }, world.map);
  npc.position = { ...target };
  npc.velocity = { x: 0, y: 0 };
  if (npc.role === 'hold') npc.holdPosition = { ...target };
  pinBody(world, npc.id, target.x, target.y);
  return true;
}

/** Walk the controlled player during placement. Physics is pinned so kickoff doesn't snap. */
export function moveControlled(world: World, dx: number, dy: number): boolean {
  if (world.matchState !== 'placement') return false;
  if (dx === 0 && dy === 0) return false;
  const pad = world.player.radius + 4;
  const rawX = Math.min(world.map.width - pad, Math.max(pad, world.player.position.x + dx));
  const rawY = Math.min(world.map.height - pad, Math.max(pad, world.player.position.y + dy));
  const target = nearestLegalPoint({ x: rawX, y: rawY }, world.map);
  world.player.position = { ...target };
  world.player.velocity = { x: 0, y: 0 };
  pinBody(world, world.player.id, target.x, target.y);
  return true;
}

/** Set role for a teammate. */
export function setTeammateRole(world: World, npcId: string, role: Role): boolean {
  if (world.matchState !== 'placement') return false;
  const npc = world.npcs.find((n) => n.id === npcId);
  if (!npc) return false;
  if (npc.team !== world.player.team) return false;
  npc.role = role;
  if (role === 'hold') {
    npc.holdPosition = { ...npc.position };
  } else {
    npc.holdPosition = null;
  }
  return true;
}

/** Returns true iff (x, y) is a valid placement target for a teammate. */
export function isValidPlacement(world: World, x: number, y: number): boolean {
  return isWalkable({ x, y }, world.map);
}

/**
 * How many of `team` (including the controlled player) sit within `radius`
 * of the turn-up. Used by tests to lock toss-up packing.
 */
export function countSideNearTurnUp(world: World, team: Team, radius: number): number {
  const tu = world.map.turnUp;
  let n = 0;
  if (world.player.team === team) {
    if (Math.hypot(world.player.position.x - tu.x, world.player.position.y - tu.y) < radius) n += 1;
  }
  for (const npc of world.npcs) {
    if (npc.team !== team) continue;
    if (Math.hypot(npc.position.x - tu.x, npc.position.y - tu.y) < radius) n += 1;
  }
  return n;
}

/** Interleaved rings around the turn-up so the hug packs instead of a 17v17 wall. */
function tossUpPackSlots(
  count: number,
  team: Team,
  turnUp: Vec2,
  rng: () => number,
): Vec2[] {
  const innerCount = Math.ceil(count / 2);
  const outerCount = count - innerCount;
  const teamPhase = team === 0 ? 0 : Math.PI / Math.max(count, 1);
  const slots: Vec2[] = [];
  const ring = (n: number, radius: number, phase: number): void => {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.1;
      const r = radius + (rng() - 0.5) * 8;
      slots.push({
        x: turnUp.x + Math.cos(a) * r,
        y: turnUp.y + Math.sin(a) * r,
      });
    }
  };
  ring(innerCount, 62, teamPhase);
  ring(outerCount, 96, teamPhase + Math.PI / Math.max(outerCount, 1));
  return slots;
}

/** Sparse hold spots on that team's half — not a second ring at mid. */
function scatterSlots(count: number, team: Team, map: { width: number; height: number }): Vec2[] {
  const w = map.width;
  const h = map.height;
  const xs = team === 0 ? [w * 0.16, w * 0.24, w * 0.32] : [w * 0.84, w * 0.76, w * 0.68];
  const north = Math.ceil(count / 2);
  const south = count - north;
  return [
    ...spreadRanks(north, xs.slice(0, 2), h * 0.18, h * 0.42),
    ...spreadRanks(south, xs.slice(1), h * 0.62, h * 0.84),
  ];
}

function pinNpc(
  world: World,
  npc: NPC,
  raw: Vec2,
  role: Role,
): void {
  npc.position = nearestLegalPoint(raw, world.map);
  npc.velocity = { x: 0, y: 0 };
  npc.role = role;
  npc.holdPosition = role === 'hold' ? { ...npc.position } : null;
  pinBody(world, npc.id, npc.position.x, npc.position.y);
}

/**
 * ~10 chase clustered on the stone, remainder sparse hold on that team's half.
 * `includePlayer` puts the controlled body in the hug (home toss-up).
 */
function placeSide(
  world: World,
  npcs: NPC[],
  team: Team,
  includePlayer: boolean,
): void {
  const packBudget = Math.min(TOSS_UP_PACK_PER_SIDE, npcs.length + (includePlayer ? 1 : 0));
  const packNpcCount = includePlayer ? Math.max(0, packBudget - 1) : packBudget;
  const packNpcs = npcs.slice(0, packNpcCount);
  const scatterNpcs = npcs.slice(packNpcCount);
  const packSlots = tossUpPackSlots(packBudget, team, world.map.turnUp, world._rng);
  const scattered = scatterSlots(scatterNpcs.length, team, world.map);

  let packIndex = 0;
  for (const npc of packNpcs) {
    const slot = packSlots[packIndex++] ?? world.map.turnUp;
    pinNpc(world, npc, slot, 'chase');
  }
  if (includePlayer) {
    // Outer ring — in the hug, not overlapping the stone (avoids instant claim).
    const slot = packSlots[packIndex++] ?? world.map.turnUp;
    const next = nearestLegalPoint(slot, world.map);
    world.player.position.x = next.x;
    world.player.position.y = next.y;
    world.player.velocity = { x: 0, y: 0 };
    world.player.assignedRole = 'chase';
    pinBody(world, world.player.id, next.x, next.y);
  }
  for (let i = 0; i < scatterNpcs.length; i++) {
    const npc = scatterNpcs[i]!;
    const slot = scattered[i] ?? scattered[scattered.length - 1] ?? world.map.turnUp;
    const raw = {
      x: slot.x + (world._rng() - 0.5) * 40,
      y: slot.y + (world._rng() - 0.5) * 40,
    };
    pinNpc(world, npc, raw, 'hold');
  }
}

/**
 * Auto-place the away squad: ~10 chase on the stone, a few hold scattered
 * toward their millstone — not a full 17-body ring at toss-up.
 */
export function autoPlaceOpponents(world: World): void {
  const opponentTeam: Team = world.player.team === 0 ? 1 : 0;
  const opponents = world.npcs.filter((n) => n.team === opponentTeam);
  placeSide(world, opponents, opponentTeam, false);
}

/**
 * Default home placement: controlled player + teammates in the toss-up hug,
 * remainder sparse hold. Player can still walk / re-role during strategy.
 */
export function autoPlaceHome(world: World): void {
  const homeTeam: Team = world.player.team;
  const teammates = world.npcs.filter((n) => n.team === homeTeam);
  placeSide(world, teammates, homeTeam, true);
}

/** Default map export so the rest of sim can refer to it. */
export { ASHBOURNE_TOWN };
