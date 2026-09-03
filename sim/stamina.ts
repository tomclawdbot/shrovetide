// sim/stamina.ts — pure stamina model. No side effects beyond the entity.

import type { Player } from './types.js';

/** Stamina per second drained while moving without Sprint. */
export const STAMINA_MOVE_DRAIN = 10;
/** Stamina per second drained while sprinting (with or without the ball). */
export const STAMINA_SPRINT_DRAIN = 28;
/** Extra stamina per second drained while carrying the stone. */
export const STAMINA_CARRY_DRAIN = 8;
/** Stamina per second regenerated when idle (not moving, not sprinting). */
export const STAMINA_REGEN_RATE = 18;
/** Speed multiplier when stamina hits zero. */
export const EXHAUSTED_SPEED_MULT = 0.6;
/** Speed multiplier while sprinting with Breath remaining. */
export const SPRINT_SPEED_MULT = 1.28;

export interface StaminaTick {
  sprinting: boolean;
  /** True when movement input is past the deadzone. */
  moving: boolean;
  carrying: boolean;
}

/**
 * Update stamina for one tick. Clamped to [0, maxStamina].
 * Pure function — only mutates the passed player's stamina.
 *
 * Drain rule: any movement costs Breath; Sprint costs more; carrying
 * adds a flat extra. Regen rule: only idle (no move, no Sprint) recovers.
 * Spent Breath stays spent until you stand still.
 */
export function updateStamina(player: Player, tick: StaminaTick, dt: number): void {
  const extra = tick.carrying ? STAMINA_CARRY_DRAIN : 0;
  let delta = 0;
  if (tick.sprinting) {
    delta = player.stamina > 0 ? -(STAMINA_SPRINT_DRAIN + extra) * dt : 0;
  } else if (tick.moving) {
    delta = player.stamina > 0 ? -(STAMINA_MOVE_DRAIN + extra) * dt : 0;
  } else {
    delta = STAMINA_REGEN_RATE * dt;
  }
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
