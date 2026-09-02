// sim/types.ts — pure type definitions. Zero runtime code, zero deps.
// Imported by both /sim internals and /client. Safe in Node and browser.

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 0 | 1;

export interface Body {
  position: Vec2;
  velocity: Vec2;
  radius: number;
}

export interface Player extends Body {
  readonly id: 'player';
  readonly kind: 'player';
  readonly team: Team;
  maxSpeed: number;
  stamina: number;
  maxStamina: number;
  hasBall: boolean;
}

export interface NPC extends Body {
  id: string;
  readonly kind: 'npc';
  readonly team: Team;
  maxSpeed: number;
  stamina: number;
  maxStamina: number;
}

export interface Ball extends Body {
  readonly id: 'ball';
  readonly kind: 'ball';
  ownerId: string | null;
}

/**
 * Per-tick input from the client (or AI) into the sim.
 * Pure state — no callbacks, no events. Discrete actions
 * (pass release, etc.) go through dedicated sim functions.
 */
export interface Input {
  /** Normalized movement direction. Magnitude 0..1. */
  move: Vec2;
  /** Sprint key held. Drains stamina only when player has the ball. */
  sprint: boolean;
  /** Pass key currently held (charging). */
  charging: boolean;
  /** Aim direction snapshot for the pass (used on release). */
  passAim: Vec2;
}

/** Serializable sim state. The /client reads from this for rendering. */
export interface SimState {
  width: number;
  height: number;
  player: Player;
  npcs: NPC[];
  ball: Ball;
  tick: number;
  rngSeed: number;
}
