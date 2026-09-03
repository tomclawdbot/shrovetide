// sim/stamina.ts — pure stamina model. No side effects beyond the entity.

import type { Player } from './types.js';

/** Stamina per second drained while sprinting (with or without the ball). */
export const STAMINA_SPRINT_DRAIN = 30;
/** Stamina per second regenerated when not sprinting. */
export const STAMINA_REGEN_RATE = 22;
/** Speed multiplier when stamina hits zero. */
export const EXHAUSTED_SPEED_MULT = 0.6;
/** Speed multiplier while sprinting with Breath remaining. */
export const SPRINT_SPEED_MULT = 1.28;

/**
 * Update stamina for one tick. Clamped to [0, maxStamina].
 * Pure function — only mutates the passed player's stamina.
 * Sprint drains whenever the sprint input is held; Breath must matter on
 * the opening run, not only after picking up the ball.
 */
export function updateStamina(player: Player, sprinting: boolean, dt: number): void {
  const draining = sprinting && player.stamina > 0;
  const delta = draining ? -STAMINA_SPRINT_DRAIN * dt : STAMINA_REGEN_RATE * dt;
  player.stamina = Math.max(0, Math.min(player.maxStamina, player.stamina + delta));
}

/** Walk/run multiplier from Breath: 1.0 normally, 0.6 when fully spent. */
export function getSpeedMultiplier(player: Player): number {
  return player.stamina <= 0 ? EXHAUSTED_SPEED_MULT : 1.0;
}

/** Extra cap while sprinting with Breath left; spent Breath kills the burst. */
export function getSprintMultiplier(player: Player, sprinting: boolean): number {
  return sprinting && player.stamina > 0 ? SPRINT_SPEED_MULT : 1;
}
