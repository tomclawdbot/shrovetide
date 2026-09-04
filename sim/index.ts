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
  HEDGE_SPEED_MULT,
  RIVER_SPEED_MULT,
  TOWN_SCALE,
  goalFor,
  isInHedge,
  isInHedgeSlow,
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
  countHugNeighbors,
  hugPackExtent,
  hugShoveAuthority,
  integrateControlVelocity,
  stepWorld,
  HUG_MIN_SHOVE,
  HUG_NEIGHBOR_RADIUS,
  HUG_PACK_COUNT,
  HUG_PACK_GATHER_RADIUS,
  type HugPackExtent,
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
  STAMINA_RIP_DRAIN,
  STAMINA_WRIGGLE_DRAIN,
  EXHAUSTED_SPEED_MULT,
  SPRINT_SPEED_MULT,
} from './stamina.js';

export {
  applyWriggleProgress,
  canRip,
  canWriggle,
  clearPopPose,
  inRipContest,
  popBallFree,
  ripClearDistance,
  setWriggleFriction,
  tickWrestle,
  wrestleMode,
  RIP_CLEAR_PADDING,
  RIP_GHOST_TICKS,
  RIP_GRACE_TICKS,
  RIP_IMMUNITY_TICKS,
  RIP_MIN_NEIGHBORS,
  RIP_POP_SPEED,
  RIP_REACH,
  RIP_SUCCESS_SECONDS,
  WRIGGLE_APPROACH_RADIUS,
  WRIGGLE_CONTACT_NEIGHBORS,
  WRIGGLE_INWARD_SPEED,
  WRIGGLE_NUDGE,
  WRIGGLE_PACK_AROUND_BALL,
  WRIGGLE_SHOVE_FLOOR,
  type WrestleMode,
  type WrestleTick,
} from './wrestle.js';

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
export {
  switchControl,
  quickSwitch,
  cycleTeammate,
  controlRing,
  teammatesByBallDistance,
  teammateAtPoint,
} from './switching.js';
