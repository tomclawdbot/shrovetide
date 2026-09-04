// sim/match.ts — two-day event state machine + scorekeeping + timer.
//
// State machine:
//   placement ──confirmMatchStart()──▶ playing (Day 1)
//     early goal (<3 min elapsed) ──▶ toss-up, same day clock continues
//     late goal / timer expiry ──▶ Day 2 (fresh 5:00, toss-up)
//     Day 2 late goal / timer expiry ──▶ over (aggregate score / draw)
//
// Pure functions over World state — no callbacks, no events.
// stepWorld() in world.ts calls tickMatch() each frame to advance the timer
// and detect state transitions.

import Matter from 'matter-js';
import { setBallSensor } from './physics.js';
import type { Team } from './types.js';
import type { World } from './world.js';

/** Seconds of play per day. */
export const DEFAULT_MATCH_DURATION_SECONDS = 5 * 60;
/**
 * Goals scored before this many seconds have elapsed on the day clock
 * count, then the ball is tossed up again with the remaining time left.
 * Goals at or after this mark end the day.
 */
export const EARLY_GOAL_WINDOW_SECONDS = 3 * 60;

/** In-world hour the day starts (1pm). */
export const DAY_CLOCK_START_HOUR = 13;
/** In-world hour the day ends (10pm). */
export const DAY_CLOCK_END_HOUR = 22;

/** Tick count for goaling tap spacing — 0.5s at 60 Hz. */
export const GOAL_TAP_SPACING_TICKS = 30;
/** Max ticks the tap chain can stay open before reset (~3s). */
export const GOAL_TAP_MAX_CHAIN_TICKS = 180;

/** Elapsed seconds on the current day's clock. */
export function dayElapsedSeconds(world: World): number {
  return Math.max(0, DEFAULT_MATCH_DURATION_SECONDS - world.matchTimeRemaining);
}

/**
 * 0 at kickoff (1pm) → 1 at day end (10pm).
 * Placement / idle worlds with no clock read as midday start.
 */
export function dayProgress(world: World): number {
  if (world.matchState === 'placement') return 0;
  return Math.min(1, Math.max(0, dayElapsedSeconds(world) / DEFAULT_MATCH_DURATION_SECONDS));
}

/**
 * Minutes since midnight on the in-world day clock (1pm→10pm over the day).
 * Clamped so the HUD never reads past 10:00 PM.
 */
export function dayClockMinutes(world: World): number {
  const startMin = DAY_CLOCK_START_HOUR * 60;
  const spanMin = (DAY_CLOCK_END_HOUR - DAY_CLOCK_START_HOUR) * 60;
  return startMin + dayProgress(world) * spanMin;
}

/** HUD clock label, e.g. "1:00 PM" … "10:00 PM". */
export function formatDayClock(world: World): string {
  const total = Math.round(dayClockMinutes(world));
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

/**
 * How dark the pitch should look (0 midday → ~0.72 at 10pm).
 * Stays bright through early afternoon, then deepens into night.
 */
export function nightfallAmount(world: World): number {
  if (world.matchState !== 'playing' && world.matchState !== 'over') return 0;
  const p = dayProgress(world);
  // Hold daylight until ~4pm (progress ≈ 3/9), then ramp to night.
  const duskStart = 3 / 9;
  if (p <= duskStart) return 0;
  const t = (p - duskStart) / (1 - duskStart);
  // Smoothstep for a natural dusk curve.
  const s = t * t * (3 - 2 * t);
  return s * 0.72;
}

/** True when a goal should toss-up and continue the day (not end it). */
export function isEarlyGoalWindow(world: World): boolean {
  return dayElapsedSeconds(world) < EARLY_GOAL_WINDOW_SECONDS && world.matchTimeRemaining > 0;
}

/** Reset the stone to turn-up and clear ownership / contest state. */
export function tossUpBall(world: World): void {
  world.ball.position = { ...world.map.turnUp };
  world.ball.velocity = { x: 0, y: 0 };
  world.ball.ownerId = null;
  world.player.hasBall = false;
  world.passImmuneId = null;
  world.passImmuneUntilTick = 0;
  world._ripPressure = 0;
  world._ripGraceTicks = 0;
  world._ripGhostUntilTick = 0;
  world._npcRipId = null;
  world._npcRipPressure = 0;
  world._npcRipGraceTicks = 0;
  world._npcRipCooldownUntilTick = 0;
  world.goaling.carrierId = null;
  world.goaling.taps = 0;
  world.goaling.lastTapTick = 0;
  Matter.Body.setPosition(world.physics.ballBody, world.ball.position);
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  setBallSensor(world.physics, false);
}

export function startMatch(world: World): void {
  if (world.matchState !== 'placement') return;
  world.matchState = 'playing';
  world.eventDay = 1;
  world.winState = null;
  tossUpBall(world);
  world.matchTimeRemaining = DEFAULT_MATCH_DURATION_SECONDS;
}

/** Per-frame match tick. Decrements timer, ends the day on expiry. */
export function tickMatch(world: World, dt: number): void {
  if (world.matchState !== 'playing') return;
  world.matchTimeRemaining = Math.max(0, world.matchTimeRemaining - dt);
  if (world.matchTimeRemaining <= 0) {
    endDay(world, null, null, 'time');
  }
}

/**
 * Record a goal. Early goals toss the ball up again with remaining day
 * time; late goals end the day (or the whole event on Day 2).
 */
export function scoreGoal(world: World, scorerId: string, scorerTeam: Team): void {
  if (world.matchState !== 'playing') return;
  world.score[scorerTeam] += 1;
  if (isEarlyGoalWindow(world)) {
    tossUpBall(world);
    return;
  }
  endDay(world, scorerId, scorerTeam, 'goal');
}

/** End the current day — advance to Day 2, or finish the event. */
export function endDay(
  world: World,
  scorerId: string | null,
  scorerTeam: Team | null,
  reason: 'goal' | 'time',
): void {
  if (world.matchState !== 'playing') return;
  if (world.eventDay === 1) {
    startDay2(world);
    return;
  }
  endEvent(world, scorerId, scorerTeam, reason);
}

function startDay2(world: World): void {
  world.eventDay = 2;
  world.matchTimeRemaining = DEFAULT_MATCH_DURATION_SECONDS;
  tossUpBall(world);
}

/**
 * Finish the two-day event. Winner is whoever leads on aggregate goals;
 * equal scores are a draw (winner null).
 */
export function endEvent(
  world: World,
  scorerId: string | null,
  scorerTeam: Team | null,
  reason: 'goal' | 'time',
): void {
  if (world.matchState === 'over') return;
  world.matchState = 'over';
  const winner: Team | null =
    world.score[0] > world.score[1] ? 0 : world.score[1] > world.score[0] ? 1 : null;
  world.winState = { winner, reason, scorerId, scorerTeam };
}

/** @deprecated Prefer endEvent / endDay — kept for callers that force-end. */
export function endMatch(
  world: World,
  scorerId: string | null,
  scorerTeam: Team | null,
  reason: 'goal' | 'time',
): void {
  endEvent(world, scorerId, scorerTeam, reason);
}
