// sim/placement.ts — strategy-phase squad placement (TICKET 002 Part C).
//
// During matchState === 'placement', the player places their teammates
// on the map by tapping/clicking. Each placed teammate gets a role (HOLD
// or CHASE). Opponents auto-place via a heuristic. confirmPlacement
// transitions matchState to 'playing'.

import Matter from 'matter-js';
import { ASHBOURNE_TOWN, isWalkable, nearestLegalPoint } from './maps.js';
import type { Role, Team } from './types.js';
import type { World } from './world.js';

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
 * Auto-place the full away squad. Chase pack sits near mid so kickoff
 * hugs; hold ranks sit deeper toward their millstone.
 */
export function autoPlaceOpponents(world: World): void {
  const opponentTeam: Team = world.player.team === 0 ? 1 : 0;
  const opponents = world.npcs.filter((n) => n.team === opponentTeam);
  const w = world.map.width;
  const h = world.map.height;
  const flip = (ratio: number) => (world.player.team === 0 ? ratio : 1 - ratio);

  const chaseCount = Math.min(opponents.length, 9);
  const holdCount = opponents.length - chaseCount;
  const northChase = Math.ceil(chaseCount / 2);
  const southChase = chaseCount - northChase;
  const northHold = Math.ceil(holdCount / 2);
  const southHold = holdCount - northHold;

  const slots: { x: number; y: number; role: Role }[] = [
    ...spreadRanks(northChase, [w * flip(0.52), w * flip(0.58)], h * 0.36, h * 0.48).map((s) => ({
      ...s,
      role: 'chase' as const,
    })),
    ...spreadRanks(southChase, [w * flip(0.53), w * flip(0.59)], h * 0.60, h * 0.72).map((s) => ({
      ...s,
      role: 'chase' as const,
    })),
    ...spreadRanks(northHold, [w * flip(0.70), w * flip(0.84)], h * 0.20, h * 0.46).map((s) => ({
      ...s,
      role: 'hold' as const,
    })),
    ...spreadRanks(southHold, [w * flip(0.72), w * flip(0.86)], h * 0.62, h * 0.82).map((s) => ({
      ...s,
      role: 'hold' as const,
    })),
  ];

  for (let i = 0; i < opponents.length; i++) {
    const npc = opponents[i]!;
    const slot = slots[i] ?? slots[slots.length - 1]!;
    const raw = {
      x: slot.x + (world._rng() - 0.5) * 36,
      y: slot.y + (world._rng() - 0.5) * 36,
    };
    npc.position = nearestLegalPoint(raw, world.map);
    npc.velocity = { x: 0, y: 0 };
    npc.role = slot.role;
    npc.holdPosition = slot.role === 'hold' ? { ...npc.position } : null;
    pinBody(world, npc.id, npc.position.x, npc.position.y);
  }
}

/**
 * Default placement for the player's home squad during strategy phase.
 * 1 controlled player + teammates spread north/south of the river, all CHASE
 * by default. Player can move + re-role them via placeTeammate/setTeammateRole.
 */
export function autoPlaceHome(world: World): void {
  const homeTeam: Team = world.player.team;
  const homeChars: ({ position: { x: number; y: number }; id: string })[] = [];
  homeChars.push({ id: world.player.id, position: world.player.position });
  for (const npc of world.npcs) {
    if (npc.team === homeTeam) homeChars.push({ id: npc.id, position: npc.position });
  }
  const w = world.map.width;
  const h = world.map.height;
  const towardMid = homeTeam === 0 ? 1 : -1;
  const baseX = homeTeam === 0 ? w * 0.26 : w * 0.74;
  const north = Math.ceil(homeChars.length / 2);
  const south = homeChars.length - north;
  const slots = [
    ...spreadRanks(north, [baseX, baseX + towardMid * 80, baseX + towardMid * 160], h * 0.18, h * 0.46),
    ...spreadRanks(south, [baseX + towardMid * 20, baseX + towardMid * 100, baseX + towardMid * 180], h * 0.62, h * 0.84),
  ];

  for (let i = 0; i < homeChars.length; i++) {
    const target = homeChars[i]!;
    const slot = slots[i] ?? slots[slots.length - 1]!;
    const next = nearestLegalPoint(slot, world.map);
    target.position.x = next.x;
    target.position.y = next.y;
    pinBody(world, target.id, next.x, next.y);
  }
  for (const npc of world.npcs) {
    if (npc.team === homeTeam) {
      npc.role = 'chase';
      npc.holdPosition = null;
    }
  }
  world.player.assignedRole = 'chase';
}

/** Default map export so the rest of sim can refer to it. */
export { ASHBOURNE_TOWN };
