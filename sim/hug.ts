// sim/hug.ts — pack-density helpers shared by shove, Rip, and Wriggle.

import { shoveMultForBuild } from './builds.js';
import type { Vec2 } from './types.js';
import type { World } from './world.js';

/**
 * Bodies inside this radius count toward hug density. ~2 overlapping
 * character radii — close enough to be in the scrum, not just nearby.
 */
export const HUG_NEIGHBOR_RADIUS = 54;
/** Neighbor count that is treated as a fully packed hug. */
export const HUG_PACK_COUNT = 6;
/** Residual shove when the hug is fully packed (attritional crawl). */
export const HUG_MIN_SHOVE = 0.18;
/**
 * Packing only slows shove inside this radius of the contest (stone / carrier).
 * Outside it the hug has broken — full shove so bodies peel toward the ball.
 */
export const HUG_ZONE_RADIUS = HUG_NEIGHBOR_RADIUS + 60;

/** Stone, or the carrier holding it — the only place a hug should stick. */
export function contestFocus(world: World): Vec2 {
  const ownerId = world.ball.ownerId;
  if (ownerId !== null) {
    if (ownerId === world.player.id) return world.player.position;
    const carrier = world.npcs.find((n) => n.id === ownerId);
    if (carrier) return carrier.position;
  }
  return world.ball.position;
}

/** True when `pos` is close enough to the stone for pack shove to apply. */
export function isInHugZone(world: World, pos: Vec2): boolean {
  const focus = contestFocus(world);
  const dx = pos.x - focus.x;
  const dy = pos.y - focus.y;
  return dx * dx + dy * dy <= HUG_ZONE_RADIUS * HUG_ZONE_RADIUS;
}

/**
 * Packed-hug shove cut, but only while still on the stone.
 * After a Rip pops the ball clear, leftover clusters regain full shove and disband.
 */
export function hugShoveAt(world: World, id: string, pos: Vec2): number {
  if (!isInHugZone(world, pos)) return 1;
  let authority = hugShoveAuthority(countHugNeighbors(world, id, pos));
  const build =
    id === world.player.id
      ? world.player.build
      : world.npcs.find((n) => n.id === id)?.build;
  if (build) authority *= shoveMultForBuild(build);
  return Math.max(0.08, Math.min(1, authority));
}

/** How many characters sit inside `radius` of `pos`, optionally skipping one id. */
export function countBodiesNear(
  world: World,
  pos: Vec2,
  radius: number,
  excludeId?: string,
): number {
  const r2 = radius * radius;
  let n = 0;
  if (excludeId !== world.player.id) {
    const dx = world.player.position.x - pos.x;
    const dy = world.player.position.y - pos.y;
    if (dx * dx + dy * dy < r2) n += 1;
  }
  for (const npc of world.npcs) {
    if (npc.id === excludeId) continue;
    const dx = npc.position.x - pos.x;
    const dy = npc.position.y - pos.y;
    if (dx * dx + dy * dy < r2) n += 1;
  }
  return n;
}

/** How many other characters sit inside the hug radius around `pos`. */
export function countHugNeighbors(world: World, id: string, pos: Vec2): number {
  return countBodiesNear(world, pos, HUG_NEIGHBOR_RADIUS, id);
}

/** 1.0 in open grass; HUG_MIN_SHOVE when HUG_PACK_COUNT+ bodies are on you. */
export function hugShoveAuthority(neighbors: number): number {
  if (neighbors <= 0) return 1;
  if (neighbors >= HUG_PACK_COUNT) return HUG_MIN_SHOVE;
  const packed = neighbors / HUG_PACK_COUNT;
  return 1 - packed * (1 - HUG_MIN_SHOVE);
}

/** Scrum around `around`: centroid, outer skin radius, and body count. */
export interface HugPackExtent {
  centroid: Vec2;
  /** Distance from centroid to the outer skin of the furthest packed body. */
  radius: number;
  count: number;
}

/**
 * Bodies close enough to `around` (usually the stone) to count as the scrum.
 * Wider than HUG_NEIGHBOR_RADIUS so a rim body still blocks a pop.
 */
export const HUG_PACK_GATHER_RADIUS = HUG_NEIGHBOR_RADIUS + 20;

/** Packed cluster around `around`, or null if nobody is that close. */
export function hugPackExtent(
  world: World,
  around: Vec2,
  gatherRadius = HUG_PACK_GATHER_RADIUS,
): HugPackExtent | null {
  const r2 = gatherRadius * gatherRadius;
  const members: { x: number; y: number; r: number }[] = [];

  const consider = (pos: Vec2, radius: number): void => {
    const dx = pos.x - around.x;
    const dy = pos.y - around.y;
    if (dx * dx + dy * dy <= r2) members.push({ x: pos.x, y: pos.y, r: radius });
  };

  consider(world.player.position, world.player.radius);
  for (const npc of world.npcs) consider(npc.position, npc.radius);
  if (members.length === 0) return null;

  let sx = 0;
  let sy = 0;
  for (const m of members) {
    sx += m.x;
    sy += m.y;
  }
  const centroid = { x: sx / members.length, y: sy / members.length };
  let radius = 0;
  for (const m of members) {
    const d = Math.hypot(m.x - centroid.x, m.y - centroid.y) + m.r;
    if (d > radius) radius = d;
  }
  return { centroid, radius, count: members.length };
}

/** Average position of hug-radius neighbours, or null if nobody is that close. */
export function hugNeighborCentroid(world: World, id: string, pos: Vec2): Vec2 | null {
  const r2 = HUG_NEIGHBOR_RADIUS * HUG_NEIGHBOR_RADIUS;
  let sx = 0;
  let sy = 0;
  let n = 0;
  if (id !== world.player.id) {
    const dx = world.player.position.x - pos.x;
    const dy = world.player.position.y - pos.y;
    if (dx * dx + dy * dy < r2) {
      sx += world.player.position.x;
      sy += world.player.position.y;
      n += 1;
    }
  }
  for (const npc of world.npcs) {
    if (npc.id === id) continue;
    const dx = npc.position.x - pos.x;
    const dy = npc.position.y - pos.y;
    if (dx * dx + dy * dy < r2) {
      sx += npc.position.x;
      sy += npc.position.y;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n };
}
