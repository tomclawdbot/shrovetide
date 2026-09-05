// sim/types.ts — pure type definitions. Zero runtime code, zero deps.
// Imported by both /sim internals and /client. Safe in Node and browser.

export interface Vec2 {
  x: number;
  y: number;
}

export type Team = 0 | 1;

/**
 * NPC roles.
 * - hold: stay in their assigned zone, engage ball if it comes near
 * - chase: full commitment — join the hug scrum at the ball
 *
 * Opponents default to a toss-up chase pack plus a few hold on their half.
 * Teammates get whichever the player assigned during the strategy phase.
 */
export type Role = 'hold' | 'chase';

/**
 * Body build — equal counts on both teams.
 * - runner: quick in the open, Breath burns faster in a hug
 * - hugger: slower, holds Breath in the scrum, shoves the pack harder
 */
export type Build = 'runner' | 'hugger';

/** Match state machine. */
export type MatchState = 'placement' | 'playing' | 'over';

export interface Body {
  position: Vec2;
  velocity: Vec2;
  radius: number;
}

/**
 * Player is the currently-controlled character. Only one at a time.
 * The id is dynamic — switching makes a different character become the Player.
 *
 * `assignedRole` is the role this character reverts to when it stops being
 * controlled (only meaningful on the player's team).
 */
export interface Player extends Body {
  /** Was 'player' literal in v0. Now dynamic — id of the controlled character. */
  id: string;
  readonly kind: 'player';
  readonly team: Team;
  /** Role to fall back to when control switches away. */
  assignedRole: Role;
  /** Runner or hugger — fixed for the character's life. */
  build: Build;
  maxSpeed: number;
  stamina: number;
  maxStamina: number;
  hasBall: boolean;
}

/** NPC is every non-controlled character on the field. */
export interface NPC extends Body {
  id: string;
  readonly kind: 'npc';
  readonly team: Team;
  role: Role;
  /** Runner or hugger — fixed for the character's life. */
  build: Build;
  /**
   * For hold-role NPCs on the player's team: the position they should defend.
   * For chase-role NPCs: ignored.
   */
  holdPosition: Vec2 | null;
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
 * (pass release, switch, etc.) go through dedicated sim functions.
 */
export interface Input {
  /** Normalized movement direction. Magnitude 0..1. */
  move: Vec2;
  /** Sprint input held. Drains Breath and raises speed while Breath remains. */
  sprint: boolean;
  /** Pass key currently held (charging). */
  charging: boolean;
  /** Aim direction snapshot for the pass (used on release). */
  passAim: Vec2;
  /** Goal-tap press (rising edge per tick). 3 taps with 0.5s spacing = score. */
  goalTap: boolean;
  /**
   * Rip held — wrestle a trapped stone out of a packed hug.
   * Desktop F / touch Wriggle·Rip (shared hold with wriggle; sim picks mode).
   */
  rip: boolean;
  /**
   * Wriggle held — burrow into a packed hug toward the stone.
   * Same desktop F / touch pad as rip.
   */
  wriggle: boolean;
}

/** Goaling tap state. Three taps within window = score. */
export interface GoalTapState {
  /** Carrier id currently tap-targeting the millstone. */
  carrierId: string | null;
  /** Number of taps registered so far (0..3). */
  taps: number;
  /** Tick at which the last tap was registered. */
  lastTapTick: number;
  /** Min ticks between taps (≈ 0.5s at 60 Hz). */
  spacing: number;
  /** Max ticks the tap chain can stay open before reset. */
  maxChainTicks: number;
}

/** Match result once state === 'over' (after both days). */
export interface WinState {
  /** Winning team by aggregate score, or null for a draw. */
  winner: Team | null;
  /** How the final day ended. */
  reason: 'goal' | 'time';
  /** id of the character who scored the closing goal (null if time / draw). */
  scorerId: string | null;
  /** Team of that scorer (for the win screen label). */
  scorerTeam: Team | null;
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
  /** Current match state. */
  matchState: MatchState;
  /** Day of the two-day event (1 or 2). */
  eventDay: 1 | 2;
  /** Seconds remaining on the current day's clock. */
  matchTimeRemaining: number;
  /**
   * After an early-goal toss-up: seconds left before the stone can be claimed.
   * Day clock is paused while this is > 0 so sides can run back into place.
   */
  recoveryTimeRemaining: number;
  /** Aggregate [team0Score, team1Score] across both days. */
  score: [number, number];
  /** Goaling tap-progress state. */
  goaling: GoalTapState;
  /** Set when matchState === 'over' (event finished). */
  winState: WinState | null;
}