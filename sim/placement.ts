// sim/placement.ts — strategy-phase squad placement (TICKET 002 Part C).
//
// During matchState === 'placement', the player places their 6 teammates
// on the map by tapping/clicking. Each placed teammate gets a role (HOLD
// or CHASE). Opponents (7) auto-place via a heuristic. confirmPlacement
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
 * Auto-place all 7 opponents. Called once when the world is created
 * (and again if needed). Uses a defensive spread biased toward their
 * millstone and the river crossings.
 */
export function autoPlaceOpponents(world: World): void {
  const opponentTeam: Team = world.player.team === 0 ? 1 : 0;
  const opponents = world.npcs.filter((n) => n.team === opponentTeam);
  const w = world.map.width;
  const h = world.map.height;
  const slots: { xRatio: number; y: number; role: Role }[] = [
    { xRatio: 0.54, y: 0.38, role: 'chase' },
    { xRatio: 0.54, y: 0.62, role: 'chase' },
    { xRatio: 0.58, y: 0.50, role: 'chase' },
    { xRatio: 0.70, y: 0.32, role: 'hold' },
    { xRatio: 0.70, y: 0.68, role: 'hold' },
    { xRatio: 0.82, y: 0.42, role: 'hold' },
    { xRatio: 0.82, y: 0.58, role: 'hold' },
  ];
  for (let i = 0; i < opponents.length; i++) {
    const npc = opponents[i]!;
    const slot = slots[i % slots.length]!;
    const raw = { x: w * slot.xRatio + (world._rng() - 0.5) * 40, y: h * slot.y + (world._rng() - 0.5) * 40 };
    npc.position = nearestLegalPoint(raw, world.map);
    npc.velocity = { x: 0, y: 0 };
    npc.role = slot.role;
    npc.holdPosition = slot.role === 'hold' ? { ...npc.position } : null;
    pinBody(world, npc.id, npc.position.x, npc.position.y);
  }
}

/**
 * Default placement for the player's 7 home characters during strategy phase.
 * 1 controlled player on home half + 6 teammates spread out, all CHASE by
 * default. Player can move + re-role them via placeTeammate/setTeammateRole.
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
  const baseX = homeTeam === 0 ? w * 0.30 : w * 0.70;
  const slots: { x: number; y: number }[] = [
    { x: baseX - 80, y: h * 0.50 },
    { x: baseX - 60, y: h * 0.40 },
    { x: baseX - 60, y: h * 0.60 },
    { x: baseX - 40, y: h * 0.30 },
    { x: baseX - 40, y: h * 0.70 },
    { x: baseX - 20, y: h * 0.45 },
    { x: baseX - 20, y: h * 0.55 },
  ];
  for (let i = 0; i < homeChars.length; i++) {
    const target = homeChars[i]!;
    const slot = slots[i]!;
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
