// sim/match.ts — match state machine + scorekeeping + timer.
//
// State machine:
//   placement ──confirmMatchStart()──▶ playing ──completeGoal()|timerExpiry──▶ over
//
// Pure functions over World state — no callbacks, no events.
// stepWorld() in world.ts calls tickMatch() each frame to advance the timer
// and detect state transitions.

import type { Team } from './types.js';
import type { World } from './world.js';

export const DEFAULT_MATCH_DURATION_SECONDS = 90; // first-run: 90s to a millstone

/** Tick count for goaling tap spacing — 0.5s at 60 Hz. */
export const GOAL_TAP_SPACING_TICKS = 30;
/** Max ticks the tap chain can stay open before reset (~3s). */
export const GOAL_TAP_MAX_CHAIN_TICKS = 180;

export function startMatch(world: World): void {
  if (world.matchState !== 'placement') return;
  world.matchState = 'playing';
  // Reset ball to turn-up, clear ownership.
  world.ball.position = { ...world.map.turnUp };
  world.ball.velocity = { x: 0, y: 0 };
  world.ball.ownerId = null;
  world.player.hasBall = false;
  // Reset timer.
  world.matchTimeRemaining = DEFAULT_MATCH_DURATION_SECONDS;
}

/** Per-frame match tick. Decrements timer, ends match on expiry. */
export function tickMatch(world: World, dt: number): void {
  if (world.matchState !== 'playing') return;
  world.matchTimeRemaining = Math.max(0, world.matchTimeRemaining - dt);
  if (world.matchTimeRemaining <= 0) {
    endMatch(world, null, null, 'time');
  }
}

export function endMatch(
  world: World,
  scorerId: string | null,
  scorerTeam: Team | null,
  reason: 'goal' | 'time',
): void {
  if (world.matchState === 'over') return;
  world.matchState = 'over';
  const winner: Team | null = reason === 'goal' && scorerTeam !== null ? scorerTeam : null;
  world.winState = { winner, reason, scorerId, scorerTeam };
}