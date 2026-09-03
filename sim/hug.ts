// sim/hug.ts — pack-density helpers shared by shove, Rip, and Wriggle.

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
