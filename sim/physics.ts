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

/** Convert a px/s vector into Matter setVelocity units. */
export function toMatterVelocity(pxPerSec: Vec2): Vec2 {
  return {
    x: pxPerSec.x * MATTER_VELOCITY_SCALE,
    y: pxPerSec.y * MATTER_VELOCITY_SCALE,
  };
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
  engine.positionIterations = 6;
  engine.velocityIterations = 4;
  engine.constraintIterations = 4;

  const bodies = new Map<string, Matter.Body>();
  for (const ch of characters) {
    const body = Matter.Bodies.circle(ch.position.x, ch.position.y, ch.radius, {
      label: ch.label,
      // Controlled movement rewrites velocity each tick; air drag only fought that model.
      frictionAir: 0.02,
      restitution: 0.05,
      density: 0.002,
      inertia: Infinity,
    });
    bodies.set(ch.id, body);
  }

  const ballBody = Matter.Bodies.circle(ballPosition.x, ballPosition.y, ballRadius, {
    label: 'ball',
    frictionAir: 0.05,
    restitution: 0.55,
    density: 0.001,
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