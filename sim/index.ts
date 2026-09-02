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
  stepWorld,
  PLAYER_RADIUS,
  NPC_RADIUS,
  BALL_RADIUS,
  PLAYER_MAX_SPEED,
  NPC_MAX_SPEED,
  SIM_DT,
  SQUAD_SIZE,
  type CreateWorldOptions,
  type World,
} from './world.js';

export { releasePass } from './pass.js';
export { STAMINA_REGEN_RATE, STAMINA_SPRINT_DRAIN, EXHAUSTED_SPEED_MULT } from './stamina.js';

// Match state machine + scoring
export {
  startMatch,
  endMatch,
  tickMatch,
  DEFAULT_MATCH_DURATION_SECONDS,
  GOAL_TAP_SPACING_TICKS,
  GOAL_TAP_MAX_CHAIN_TICKS,
} from './match.js';

export { tapGoal, GOAL_REACH_DISTANCE } from './goaling.js';

// Squad placement (strategy phase)
export {
  placeTeammate,
  setTeammateRole,
  isValidPlacement,
  autoPlaceOpponents,
  autoPlaceHome,
} from './placement.js';

// Switching
export { switchControl, quickSwitch, cycleTeammate } from './switching.js';