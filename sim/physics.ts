// sim/physics.ts — matter.js wrapper. Circle bodies for dynamic characters
// (controlled player + teammates + opponents + ball). Static rectangles for
// obstacles and walls.
//
// Top-down (no gravity). Deterministic given identical inputs + dt.
//
// v1 (TICKET 002): bodies are keyed by character id via a Map, so player
// switching is just a matter of changing world.player.id — no body shuffling.

import Matter from 'matter-js';
import type { Obstacle, RectZone, TownMap } from './maps.js';
import type { Vec2 } from './types.js';

export interface PhysicsWorldHandle {
  engine: Matter.Engine;
  /** All character bodies (controlled + teammates + opponents) keyed by id. */
  bodies: Map<string, Matter.Body>;
  ballBody: Matter.Body;
  obstacleBodies: Matter.Body[];
  walls: Matter.Body[];
}

export interface CharacterBodySpec {
  id: string;
  position: Vec2;
  radius: number;
  label: string;
}

/**
 * Matter.js normalises Body.velocity to px per Body._baseDelta (16.67ms).
 * Our sim thinks in px/s — multiply by this when calling setVelocity.
 * (Body._baseDelta / 1000 === 1/60 at the engine default.)
 */
export const MATTER_VELOCITY_SCALE = 1 / 60;

/** Character body density — heavy enough that a packed hug resists a shove. */
export const CHAR_DENSITY = 0.006;
/** Air damping on characters. Packs settle instead of sliding as a raft. */
export const CHAR_FRICTION_AIR = 0.08;
/** Contact friction so bodies grab each other in the scrum. */
export const CHAR_FRICTION = 0.35;
export const CHAR_FRICTION_STATIC = 0.45;
/** Ball stays light so it can still squirt out of a packed hug. */
export const BALL_DENSITY = 0.0008;
export const BALL_FRICTION_AIR = 0.04;
export const BALL_RESTITUTION = 0.7;

/** Convert a px/s vector into Matter setVelocity units. */
export function toMatterVelocity(pxPerSec: Vec2): Vec2 {
  return {
    x: pxPerSec.x * MATTER_VELOCITY_SCALE,
    y: pxPerSec.y * MATTER_VELOCITY_SCALE,
  };
}

type ImpulseBody = Matter.Body & { positionImpulse?: { x: number; y: number } };

/**
 * Matter records `pair.isSensor` only when the pair is created. Flipping
 * `body.isSensor` later does not update existing pairs — so a claim that
 * starts as solid-on-solid keeps resolving overlap and rocket-launches
 * the carrier (~7× the authored cap). Keep pair flags in sync.
 */
export function setBallSensor(physics: PhysicsWorldHandle, sensor: boolean): void {
  const ball = physics.ballBody;
  ball.isSensor = sensor;
  const pairs = physics.engine.pairs.list;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    if (!pair) continue;
    if (!pairTouchesBody(pair, ball)) continue;
    pair.isSensor = sensor || pair.bodyA.isSensor || pair.bodyB.isSensor;
  }
}

/** Drop warmed collision position-impulse so a just-claimed overlap cannot keep shoving. */
export function clearPositionImpulse(body: Matter.Body): void {
  const impulse = (body as ImpulseBody).positionImpulse;
  if (!impulse) return;
  impulse.x = 0;
  impulse.y = 0;
}

function pairTouchesBody(pair: Matter.Pair, body: Matter.Body): boolean {
  const c = pair.collision;
  return (
    pair.bodyA === body ||
    pair.bodyB === body ||
    c.bodyA === body ||
    c.bodyB === body ||
    c.parentA === body ||
    c.parentB === body
  );
}

export function createPhysicsWorld(
  map: TownMap,
  characters: CharacterBodySpec[],
  ballPosition: Vec2,
  ballRadius: number,
): PhysicsWorldHandle {
  // No gravity — top-down field.
  const engine = Matter.Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  engine.enableSleeping = false;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 4;

  const bodies = new Map<string, Matter.Body>();
  for (const ch of characters) {
    const body = Matter.Bodies.circle(ch.position.x, ch.position.y, ch.radius, {
      label: ch.label,
      // Heavy + grabby: a packed hug is a grinding mass, not a sliding raft.
      // Isolated running still uses setVelocity, so this does not rocket or stall open grass.
      frictionAir: CHAR_FRICTION_AIR,
      friction: CHAR_FRICTION,
      frictionStatic: CHAR_FRICTION_STATIC,
      restitution: 0.05,
      density: CHAR_DENSITY,
      inertia: Infinity,
    });
    bodies.set(ch.id, body);
  }

  const ballBody = Matter.Bodies.circle(ballPosition.x, ballPosition.y, ballRadius, {
    label: 'ball',
    frictionAir: BALL_FRICTION_AIR,
    restitution: BALL_RESTITUTION,
    density: BALL_DENSITY,
    inertia: Infinity,
  });

  // Obstacle bodies — static, derived from map data.
  const obstacleBodies: Matter.Body[] = map.obstacles.map((o: Obstacle) => {
    if ('radius' in o) {
      return Matter.Bodies.circle(o.position.x, o.position.y, o.radius, {
        isStatic: true,
        label: 'obstacle',
      });
    }
    return Matter.Bodies.rectangle(
      o.position.x,
      o.position.y,
      o.width,
      o.height,
      { isStatic: true, label: 'obstacle' },
    );
  });

  // Out-of-bounds — also static, so players physically can't enter.
  // Ball entering OOB is handled separately (teleport to nearest legal point).
  const oobBodies: Matter.Body[] = map.outOfBounds.map((z: RectZone) =>
    Matter.Bodies.rectangle(z.position.x, z.position.y, z.width, z.height, {
      isStatic: true,
      label: 'oob',
    }),
  );

  // Walls — thick static rectangles just outside the map boundary.
  const wallThickness = 200;
  const walls: Matter.Body[] = [
    Matter.Bodies.rectangle(map.width / 2, -wallThickness / 2, map.width + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(map.width / 2, map.height + wallThickness / 2, map.width + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(-wallThickness / 2, map.height / 2, wallThickness, map.height + wallThickness * 2, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(map.width + wallThickness / 2, map.height / 2, wallThickness, map.height + wallThickness * 2, {
      isStatic: true,
      label: 'wall',
    }),
  ];

  Matter.World.add(engine.world, [
    ...bodies.values(),
    ballBody,
    ...obstacleBodies,
    ...oobBodies,
    ...walls,
  ]);

  return { engine, bodies, ballBody, obstacleBodies, walls };
}

/**
 * Step the physics engine. dt is in seconds.
 * Deterministic for a given engine state and dt.
 */
export function stepPhysics(physics: PhysicsWorldHandle, dt: number): void {
  // matter.js takes delta in milliseconds.
  Matter.Engine.update(physics.engine, dt * 1000);
}