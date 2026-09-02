// sim/stamina.ts — pure stamina model. No side effects beyond the entity.

import type { Player } from './types.js';

/** Stamina per second drained while sprinting with the ball. */
export const STAMINA_SPRINT_DRAIN = 30;
/** Stamina per second regenerated when not sprinting OR not carrying the ball. */
export const STAMINA_REGEN_RATE = 22;
/** Speed multiplier when stamina hits zero. */
export const EXHAUSTED_SPEED_MULT = 0.6;

/**
 * Update stamina for one tick. Clamped to [0, maxStamina].
 * Pure function — only mutates the passed player's stamina.
 */
export function updateStamina(player: Player, sprinting: boolean, dt: number): void {
  const draining = sprinting && player.hasBall;
  const delta = draining ? -STAMINA_SPRINT_DRAIN * dt : STAMINA_REGEN_RATE * dt;
  player.stamina = Math.max(0, Math.min(player.maxStamina, player.stamina + delta));
}

/** Speed multiplier: 1.0 normally, 0.6 when fully exhausted. */
export function getSpeedMultiplier(player: Player): number {
  return player.stamina <= 0 ? EXHAUSTED_SPEED_MULT : 1.0;
}
