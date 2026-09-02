// sim/index.ts — public API barrel. The ONLY import surface for /client
// and for the future Colyseus server.

export type { Ball, Body, Input, NPC, Player, SimState, Team, Vec2 } from './types.js';
export {
  createWorld,
  stepWorld,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  PLAYER_RADIUS,
  NPC_RADIUS,
  BALL_RADIUS,
  PLAYER_MAX_SPEED,
  NPC_MAX_SPEED,
  SIM_DT,
  type CreateWorldOptions,
  type World,
} from './world.js';
export { releasePass } from './pass.js';
export { STAMINA_REGEN_RATE, STAMINA_SPRINT_DRAIN, EXHAUSTED_SPEED_MULT } from './stamina.js';
