// sim/builds.ts — runner vs hugger body types (equal on both teams).
//
// Runners: quicker in the open, burn Breath faster in a hug, shove less.
// Huggers: slower, hold Breath in the scrum, shove the pack harder.

import type { Build } from './types.js';

export type { Build };

/** Open-field speed vs baseline walk. */
export const RUNNER_SPEED_MULT = 1.18;
export const HUGGER_SPEED_MULT = 0.82;

/**
 * Extra Breath cost while packed on the stone.
 * Applied on top of normal move/carry/rip drains inside a hug.
 */
export const RUNNER_HUG_STAMINA_MULT = 1.5;
export const HUGGER_HUG_STAMINA_MULT = 0.55;

/** Packed-hug shove authority multiplier (higher = pushes the scrum more).
 * Runner open-speed × this must lose to a hugger in the pack so switching is felt. */
export const RUNNER_SHOVE_MULT = 0.62;
export const HUGGER_SHOVE_MULT = 1.45;

/** Physics radius scale vs baseline (runners leaner, huggers thicker). Client kit/silhouette is the readable cue. */
export const RUNNER_RADIUS_MULT = 0.92;
export const HUGGER_RADIUS_MULT = 1.08;

/**
 * Stable 9 runners + 8 huggers per 17-body side.
 * Index is 1-based squad slot (player is usually 1).
 */
export function buildForSlot(slotIndex: number): Build {
  return slotIndex % 2 === 1 ? 'runner' : 'hugger';
}

export function speedMultForBuild(build: Build): number {
  return build === 'runner' ? RUNNER_SPEED_MULT : HUGGER_SPEED_MULT;
}

export function hugStaminaMultForBuild(build: Build): number {
  return build === 'runner' ? RUNNER_HUG_STAMINA_MULT : HUGGER_HUG_STAMINA_MULT;
}

export function shoveMultForBuild(build: Build): number {
  return build === 'runner' ? RUNNER_SHOVE_MULT : HUGGER_SHOVE_MULT;
}

export function radiusMultForBuild(build: Build): number {
  return build === 'runner' ? RUNNER_RADIUS_MULT : HUGGER_RADIUS_MULT;
}
