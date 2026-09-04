// sim/goaling.ts — 3-tap goaling mechanic.
//
// Carrier must be ADJACENT to the opponent's millstone (within
// GOAL_REACH_DISTANCE) and land 3 taps with ≥0.5s spacing
// (per TICKET 002 spec). On third tap → scoreGoal (early toss-up or end day).
//
// Player taps come from input.goalTap (rising edge). NPC carriers at the
// correct millstone auto-hold the same contest so a drive can finish.

import { goalFor } from './maps.js';
import type { World } from './world.js';
import { scoreGoal as recordGoal, GOAL_TAP_MAX_CHAIN_TICKS, GOAL_TAP_SPACING_TICKS } from './match.js';

/** Distance from carrier centre to goal centre to count as "adjacent". */
export const GOAL_REACH_DISTANCE = 56;

/** True when the current carrier is in millstone reach (HUD and Goal pad). */
export function isCarrierAtOpponentGoal(world: World): boolean {
  return carrierAtOpponentGoal(world) !== null;
}

/** Check whether the ball's carrier is currently tap-eligible. */
function carrierAtOpponentGoal(world: World): { carrierId: string; goalX: number; goalY: number } | null {
  const ownerId = world.ball.ownerId;
  if (ownerId === null) return null;
  if (ownerId === world.player.id) {
    if (!world.player.hasBall) return null;
  }
  // Locate the character carrying the ball.
  let cx = 0, cy = 0;
  if (ownerId === world.player.id) {
    cx = world.player.position.x;
    cy = world.player.position.y;
  } else {
    const npc = world.npcs.find((n) => n.id === ownerId);
    if (!npc) return null;
    cx = npc.position.x;
    cy = npc.position.y;
  }
  // Whose goal are we tapping? The opponent's.
  const carrierTeam = ownerId === world.player.id ? world.player.team
    : world.npcs.find((n) => n.id === ownerId)!.team;
  const opponentGoal = goalFor(carrierTeam === 0 ? 1 : 0, world.map);
  const dx = opponentGoal.x - cx;
  const dy = opponentGoal.y - cy;
  if (Math.hypot(dx, dy) > GOAL_REACH_DISTANCE) return null;
  return { carrierId: ownerId, goalX: opponentGoal.x, goalY: opponentGoal.y };
}

/**
 * Register a single tap for the current carrier. Player rising-edge or
 * NPC auto-contest both use this. No-op if not in position, too soon, or
 * the chain has gone stale. Only the opponent millstone counts.
 */
export function tapGoal(world: World): void {
  if (world.matchState !== 'playing') return;
  const at = carrierAtOpponentGoal(world);
  if (!at) {
    // Missed the stone — do not wipe the chain; only GOAL_TAP_MAX_CHAIN_TICKS does.
    return;
  }
  const g = world.goaling;
  const t = world.tick;

  if (g.carrierId !== at.carrierId) {
    // Different carrier (or first tap of a new chain) — start fresh.
    g.carrierId = at.carrierId;
    g.taps = 1;
    g.lastTapTick = t;
    return;
  }

  // Same carrier. Check spacing.
  if (t - g.lastTapTick < GOAL_TAP_SPACING_TICKS) {
    // Too soon — ignore. Don't penalise, just drop this tap.
    return;
  }
  if (t - g.lastTapTick > GOAL_TAP_MAX_CHAIN_TICKS) {
    // Chain went stale — restart from 1.
    g.taps = 1;
    g.lastTapTick = t;
    return;
  }
  g.taps += 1;
  g.lastTapTick = t;
  if (g.taps >= 3) {
    scoreGoal(world, at.carrierId);
  }
}

/**
 * NPC carrier at the millstone they score at: hold the same 3-tap contest.
 * Spacing / stale-chain rules live in tapGoal. Player carriers are skipped
 * — they must press Goal.
 */
export function tickNpcGoalTap(world: World): void {
  if (world.matchState !== 'playing') return;
  const ownerId = world.ball.ownerId;
  if (ownerId === null || ownerId === world.player.id) return;
  tapGoal(world);
}

function scoreGoal(world: World, scorerId: string): void {
  const scorerTeam = scorerId === world.player.id
    ? world.player.team
    : world.npcs.find((n) => n.id === scorerId)!.team;
  recordGoal(world, scorerId, scorerTeam);
}