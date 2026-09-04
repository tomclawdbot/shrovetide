// sim/stamina.ts — pure stamina model. No side effects beyond the entity.
// Shared by the controlled player and NPCs so Breath economy is one rule.

/** Stamina per second drained while moving without Sprint. */
export const STAMINA_MOVE_DRAIN = 10;
/** Stamina per second drained while sprinting (with or without the ball). */
export const STAMINA_SPRINT_DRAIN = 28;
/** Extra stamina per second drained while carrying the stone. */
export const STAMINA_CARRY_DRAIN = 8;
/** Stamina per second drained while Ripping the stone in a hug. */
export const STAMINA_RIP_DRAIN = 30;
/** Stamina per second drained while Wriggling into a packed hug. */
export const STAMINA_WRIGGLE_DRAIN = 34;
/** Stamina per second regenerated when idle (not moving, not sprinting). */
export const STAMINA_REGEN_RATE = 18;
/** Speed multiplier when stamina hits zero — a crawl, not a jog. */
export const EXHAUSTED_SPEED_MULT = 0.35;
/** Speed multiplier while sprinting with Breath remaining. */
export const SPRINT_SPEED_MULT = 1.28;

/** Anyone with a Breath bar — player or NPC. */
export interface StaminaEntity {
  stamina: number;
  maxStamina: number;
}

export interface StaminaTick {
  sprinting: boolean;
  /** True when movement input is past the deadzone. */
  moving: boolean;
  carrying: boolean;
  ripping?: boolean;
  wriggling?: boolean;
}

/**
 * Update stamina for one tick. Clamped to [0, maxStamina].
 * Pure function — only mutates the passed entity's stamina.
 *
 * Drain rule: any movement costs Breath; Sprint costs more; carrying
 * adds a flat extra. Regen rule: only idle (no move, no Sprint) recovers.
 * Spent Breath stays spent until you stand still.
 */
export function updateStamina(entity: StaminaEntity, tick: StaminaTick, dt: number): void {
  const extra = tick.carrying ? STAMINA_CARRY_DRAIN : 0;
  let delta = 0;
  if (tick.ripping) {
    delta = entity.stamina > 0 ? -(STAMINA_RIP_DRAIN + extra) * dt : 0;
  } else if (tick.wriggling) {
    delta = entity.stamina > 0 ? -(STAMINA_WRIGGLE_DRAIN + extra) * dt : 0;
  } else if (tick.sprinting) {
    delta = entity.stamina > 0 ? -(STAMINA_SPRINT_DRAIN + extra) * dt : 0;
  } else if (tick.moving) {
    delta = entity.stamina > 0 ? -(STAMINA_MOVE_DRAIN + extra) * dt : 0;
  } else {
    delta = STAMINA_REGEN_RATE * dt;
  }
  entity.stamina = Math.max(0, Math.min(entity.maxStamina, entity.stamina + delta));
}

/** Walk/run multiplier from Breath: 1.0 normally, crawl when fully spent. */
export function getSpeedMultiplier(entity: StaminaEntity): number {
  return entity.stamina <= 0 ? EXHAUSTED_SPEED_MULT : 1.0;
}

/** Extra cap while sprinting with Breath left; spent Breath kills the burst. */
export function getSprintMultiplier(entity: StaminaEntity, sprinting: boolean): number {
  return sprinting && entity.stamina > 0 ? SPRINT_SPEED_MULT : 1;
}
