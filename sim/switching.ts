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
// quickSwitch stays playing-only — it keys off the live ball.
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
 * Quick-switch: switch to the teammate nearest the ball. Returns the
 * switched-to character's id, or null if already nearest / no teammates.
 */
export function quickSwitch(world: World): string | null {
  if (world.matchState !== 'playing') return null;
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const npc of world.npcs) {
    if (npc.team !== world.player.team) continue;
    const dx = npc.position.x - world.ball.position.x;
    const dy = npc.position.y - world.ball.position.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestId = npc.id;
    }
  }
  if (bestId === null) return null;
  // Don't bother switching if we're already closest teammate.
  const myDx = world.player.position.x - world.ball.position.x;
  const myDy = world.player.position.y - world.ball.position.y;
  if (myDx * myDx + myDy * myDy <= bestDist) return null;
  return switchControl(world, bestId) ? bestId : null;
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
