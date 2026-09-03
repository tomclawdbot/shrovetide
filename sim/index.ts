// sim/index.ts — public API barrel. The ONLY import surface for /client
// and for the future Colyseus server.

export type {
  Ball,
  Body,
  GoalTapState,
  Input,
  MatchState,
  NPC,
  Player,
  Role,
  SimState,
  Team,
  Vec2,
  WinState,
} from './types.js';

export {
  ASHBOURNE_TOWN,
  goalFor,
  isInObstacle,
  isInRiver,
  isInWater,
  isOnBridge,
  isOutOfBounds,
  isWalkable,
  nearestLegalPoint,
  opponentGoalFor,
  pointInRect,
  speedMultiplierAt,
  type Bridge,
  type Circle,
  type GoalMarker,
  type Obstacle,
  type RectZone,
  type TownMap,
  type Vec2Like,
} from './maps.js';

export {
  createWorld,
  integrateControlVelocity,
  stepWorld,
  MOVEMENT,
  PLAYER_RADIUS,
  NPC_RADIUS,
  BALL_RADIUS,
  PLAYER_MAX_SPEED,
  NPC_MAX_SPEED,
  SIM_DT,
  SQUAD_SIZE,
  type CreateWorldOptions,
  type MovementTuning,
  type World,
} from './world.js';

export { releasePass, PASS_PICKUP_IMMUNITY_TICKS } from './pass.js';
export {
  STAMINA_REGEN_RATE,
  STAMINA_MOVE_DRAIN,
  STAMINA_SPRINT_DRAIN,
  STAMINA_CARRY_DRAIN,
  EXHAUSTED_SPEED_MULT,
  SPRINT_SPEED_MULT,
} from './stamina.js';

export { GOAL_CONTEST_RADIUS, GOAL_DEFEND_SPEED_MULT, threatenedGoalTeam } from './npc.js';

// Match state machine + scoring
export {
  startMatch,
  endMatch,
  tickMatch,
  DEFAULT_MATCH_DURATION_SECONDS,
  GOAL_TAP_SPACING_TICKS,
  GOAL_TAP_MAX_CHAIN_TICKS,
} from './match.js';

export { tapGoal, GOAL_REACH_DISTANCE, isCarrierAtOpponentGoal } from './goaling.js';

// Squad placement (strategy phase)
export {
  placeTeammate,
  moveControlled,
  setTeammateRole,
  isValidPlacement,
  autoPlaceOpponents,
  autoPlaceHome,
} from './placement.js';

// Switching
export { switchControl, quickSwitch, cycleTeammate, controlRing } from './switching.js';
