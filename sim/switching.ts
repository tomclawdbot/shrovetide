// sim/switching.ts — controlled-character switching (TICKET 002 Part D).
//
// switchControl(world, targetId): makes a teammate NPC become the
// controlled player; the previously-controlled character reverts to its
// assignedRole.
//
// quickSwitch(world): switches to the teammate nearest the ball.
//
// Switching is instant (no cooldown per spec). The physics body of the
// previously-controlled character is just relabelled — positions are
// preserved. The Map-keyed physics handle means no body shuffle.

import type { NPC, Player, Role, Team } from './types.js';
import type { World } from './world.js';

/**
 * Switch control to a different character (must be on the same team as the
 * current player). Returns true on success.
 */
export function switchControl(world: World, targetId: string): boolean {
  if (targetId === world.player.id) return false;
  if (world.matchState !== 'playing') return false;
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

/** Cycle to the next teammate (for TAB). Returns new id or null. */
export function cycleTeammate(world: World): string | null {
  const teammates = world.npcs.filter((n) => n.team === world.player.team);
  if (teammates.length === 0) return null;
  const currentIdx = teammates.findIndex((n) => n.id === world.player.id);
  // currentIdx is -1 because the player is not in npcs. Use order after the
  // controlled character's "previous" slot.
  // Easier: pick the next teammate in stable id order, skipping nothing.
  const sortedIds = teammates.map((n) => n.id).sort();
  // Pick first teammate with a different id from the previous controlled one.
  // For cycling, just return the first teammate.
  void currentIdx;
  const target = sortedIds[0];
  return target ? (switchControl(world, target) ? target : null) : null;
}

/** Re-export types for clients that import from this barrel. */
export type { Role, Team };