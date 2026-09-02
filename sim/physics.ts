// sim/physics.ts — matter.js wrapper. Circle bodies only.
// Top-down (no gravity). Deterministic given identical inputs + dt.

import Matter from 'matter-js';
import type { Vec2 } from './types.js';

export interface PhysicsWorld {
  engine: Matter.Engine;
  ballBody: Matter.Body;
  playerBody: Matter.Body;
  npcBodies: Matter.Body[];
  walls: Matter.Body[];
}

export interface PhysicsBodies {
  playerPosition: Vec2;
  npcPositions: Vec2[];
  ballPosition: Vec2;
}

export interface PhysicsRadii {
  player: number;
  npc: number;
  ball: number;
}

export function createPhysicsWorld(
  width: number,
  height: number,
  bodies: PhysicsBodies,
  radii: PhysicsRadii,
): PhysicsWorld {
  // No gravity — top-down field.
  const engine = Matter.Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = 0;
  engine.enableSleeping = false;
  engine.positionIterations = 6;
  engine.velocityIterations = 4;
  engine.constraintIterations = 4;

  const ballBody = Matter.Bodies.circle(bodies.ballPosition.x, bodies.ballPosition.y, radii.ball, {
    label: 'ball',
    frictionAir: 0.05,
    restitution: 0.55,
    density: 0.001,
    inertia: Infinity,
  });

  const playerBody = Matter.Bodies.circle(
    bodies.playerPosition.x,
    bodies.playerPosition.y,
    radii.player,
    {
      label: 'player',
      frictionAir: 0.25,
      restitution: 0.05,
      density: 0.002,
      inertia: Infinity,
    },
  );

  const npcBodies: Matter.Body[] = bodies.npcPositions.map((pos, i) =>
    Matter.Bodies.circle(pos.x, pos.y, radii.npc, {
      label: `npc-${i}`,
      frictionAir: 0.25,
      restitution: 0.05,
      density: 0.002,
      inertia: Infinity,
    }),
  );

  // Walls — thick static rectangles just outside the field boundary.
  const wallThickness = 200;
  const walls: Matter.Body[] = [
    Matter.Bodies.rectangle(width / 2, -wallThickness / 2, width + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(width / 2, height + wallThickness / 2, width + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(-wallThickness / 2, height / 2, wallThickness, height + wallThickness * 2, {
      isStatic: true,
      label: 'wall',
    }),
    Matter.Bodies.rectangle(width + wallThickness / 2, height / 2, wallThickness, height + wallThickness * 2, {
      isStatic: true,
      label: 'wall',
    }),
  ];

  Matter.World.add(engine.world, [ballBody, playerBody, ...npcBodies, ...walls]);

  return { engine, ballBody, playerBody, npcBodies, walls };
}

/**
 * Step the physics engine. dt is in seconds.
 * Deterministic for a given engine state and dt.
 */
export function stepPhysics(physics: PhysicsWorld, dt: number): void {
  // matter.js takes delta in milliseconds.
  Matter.Engine.update(physics.engine, dt * 1000);
}
