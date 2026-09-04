// sim/switching.ts — controlled-character switching (TICKET 002 Part D).
//
// switchControl(world, targetId): makes a teammate NPC become the
// controlled player; the previously-controlled character reverts to its
// assignedRole.
//
// quickSwitch(world): switches to the teammate nearest the ball.
//
// cycleTeammate(world): steps to the next teammate in a stable ring.
//
// Switching is instant (no cooldown per spec). The physics body of the
// previously-controlled character is just relabelled — positions are
// preserved. The Map-keyed physics handle means no body shuffle.
//
// Allowed in 'placement' (walk a different teammate out) and 'playing'.
// quickSwitch (Switch pad / Q) is the ball-proximity jump — closest teammate
// to the stone, or the next-closest if you already are that body.
//
// TICKET 003a fixes:
//   - cycleTeammate actually cycles. It previously sorted the teammate ids
//     and always returned the first one, so TAB jumped to the same character
//     every time.
//   - Switching resets world._controlVel, so the newly-controlled character
//     starts from rest instead of inheriting the old one's momentum.

import type { NPC, Player, Role, Team } from './types.js';
import type { World } from './world.js';

/**
 * Switch control to a different character (must be on the same team as the
 * current player). Returns true on success.
 */
export function switchControl(world: World, targetId: string): boolean {
  if (targetId === world.player.id) return false;
  // Placement: walk a different teammate out. Playing: Tab / Switch / tap.
  if (world.matchState !== 'playing' && world.matchState !== 'placement') return false;
  const targetIdx = world.npcs.findIndex((n) => n.id === targetId);
  if (targetIdx < 0) return false;
  const target = world.npcs[targetIdx]!;
  if (target.team !== world.player.team) return false;

  // Demote: current player becomes an NPC with its assignedRole.
  const prev = world.player;
  const demoted: NPC = {
    id: prev.id,
    kind: 'npc',
    team: prev.team,
    role: prev.assignedRole,
    position: prev.position,
    velocity: prev.velocity,
    radius: prev.radius,
    maxSpeed: prev.maxSpeed,
    stamina: prev.stamina,
    maxStamina: prev.maxStamina,
    holdPosition: null,
  };

  // Promote: target NPC becomes the new controlled player.
  const promoted: Player = {
    id: target.id,
    kind: 'player',
    team: target.team,
    assignedRole: target.role,
    position: target.position,
    velocity: target.velocity,
    radius: target.radius,
    maxSpeed: target.maxSpeed,
    stamina: target.stamina,
    maxStamina: target.maxStamina,
    hasBall: world.ball.ownerId === target.id,
  };

  // Swap them in the world's arrays.
  world.npcs[targetIdx] = demoted;
  world.player = promoted;

  // Fresh legs: the new character shouldn't inherit the old one's momentum.
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  world._ripPressure = 0;
  world._ripGhostUntilTick = 0;

  // Re-tag the physics body label so debug overlays stay readable.
  const demotedBody = world.physics.bodies.get(prev.id);
  if (demotedBody) demotedBody.label = `npc-${prev.id}`;
  const promotedBody = world.physics.bodies.get(target.id);
  if (promotedBody) promotedBody.label = `player`;

  // Reset goaling chain — new carrier context.
  world.goaling.carrierId = null;
  world.goaling.taps = 0;
  return true;
}

/**
 * Teammates (not self) ranked by distance to the ball. Stable id tie-break.
 * Switch / Q walks this list: always the closest other body, which is the
 * next-closest when you already are the nearest.
 */
export function teammatesByBallDistance(world: World): { id: string; dist2: number }[] {
  const bx = world.ball.position.x;
  const by = world.ball.position.y;
  const out: { id: string; dist2: number }[] = [];
  for (const npc of world.npcs) {
    if (npc.team !== world.player.team) continue;
    const dx = npc.position.x - bx;
    const dy = npc.position.y - by;
    out.push({ id: npc.id, dist2: dx * dx + dy * dy });
  }
  out.sort((a, b) => a.dist2 - b.dist2 || a.id.localeCompare(b.id));
  return out;
}

/**
 * Switch / Q: jump to the teammate closest to the ball. If you already are
 * that player, jump to the next-closest (self is never a candidate).
 * Works in placement (ball sits at the turn-up) and play.
 */
export function quickSwitch(world: World): string | null {
  if (world.matchState !== 'playing' && world.matchState !== 'placement') return null;
  const ranked = teammatesByBallDistance(world);
  if (ranked.length === 0) return null;
  const target = ranked[0]!.id;
  return switchControl(world, target) ? target : null;
}

/**
 * Pitch tap/click: nearest teammate NPC inside `slop` (or their reach).
 * Used by the client; Goal / wrestle pads must win before this is asked.
 */
export function teammateAtPoint(
  world: World,
  x: number,
  y: number,
  slop = 56,
): string | null {
  let bestId: string | null = null;
  let best = Infinity;
  for (const n of world.npcs) {
    if (n.team !== world.player.team) continue;
    const d = Math.hypot(n.position.x - x, n.position.y - y);
    const reach = Math.max(slop, n.radius * 3);
    if (d <= reach && d < best) {
      best = d;
      bestId = n.id;
    }
  }
  return bestId;
}

/**
 * Build the full control ring for the player's team: every teammate plus the
 * currently-controlled character, in stable sorted-id order. Exported mainly
 * so the client can render a "next up" hint if it wants to.
 */
export function controlRing(world: World): string[] {
  const ids = world.npcs
    .filter((n) => n.team === world.player.team)
    .map((n) => n.id);
  ids.push(world.player.id);
  return ids.sort();
}

/**
 * Cycle to the next teammate in the ring (for TAB).
 * Returns the new controlled id, or null if the switch didn't happen.
 */
export function cycleTeammate(world: World): string | null {
  if (world.matchState !== 'playing' && world.matchState !== 'placement') return null;
  const ring = controlRing(world);
  if (ring.length < 2) return null;

  const currentIdx = ring.indexOf(world.player.id);
  if (currentIdx < 0) return null;

  // Walk forward around the ring until we land on someone switchable.
  // In practice the very next entry always works; the loop just makes the
  // function total rather than relying on that.
  for (let step = 1; step < ring.length; step++) {
    const candidate = ring[(currentIdx + step) % ring.length];
    if (!candidate || candidate === world.player.id) continue;
    if (switchControl(world, candidate)) return candidate;
  }
  return null;
}

/** Re-export types for clients that import from this barrel. */
export type { Role, Team };
