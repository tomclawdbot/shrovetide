// test/npc.steer.test.ts — NPC scoring-end intelligence.
// Up'Ards (team 0) score at the Down millstone (right).
// Down'Ards (team 1) score at the Up millstone (left).

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  CONTEST_STEER_RADIUS,
  createWorld,
  npcSteerTarget,
  opponentGoalFor,
  SHEPHERD_RADIUS,
  startMatch,
  stepWorld,
  TURN_UP_SWARM_RADIUS,
  type Input,
  type NPC,
  type World,
} from '../sim/index.js';

const IDLE: Input = {
  move: { x: 0, y: 0 },
  sprint: false,
  charging: false,
  passAim: { x: 0, y: 0 },
  goalTap: false,
  rip: false,
  wriggle: false,
};

function runTicks(world: World, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, input, 1 / 60);
  }
}

function teleportId(world: World, id: string, x: number, y: number): void {
  if (id === world.player.id) {
    world.player.position = { x, y };
    world.player.velocity = { x: 0, y: 0 };
  } else {
    const npc = world.npcs.find((n) => n.id === id);
    if (npc) {
      npc.position = { x, y };
      npc.velocity = { x: 0, y: 0 };
    }
  }
  const body = world.physics.bodies.get(id);
  if (body) {
    Matter.Body.setPosition(body, { x, y });
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }
}

function parkBall(world: World, x: number, y: number): void {
  Matter.Body.setPosition(world.physics.ballBody, { x, y });
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  world.ball.position = { x, y };
  world.ball.velocity = { x: 0, y: 0 };
}

/** Park everyone else far from `keepId` so they cannot shove the test subject. */
function isolate(world: World, keepId: string, x: number, y: number): void {
  teleportId(world, keepId, x, y);
  teleportId(world, world.player.id === keepId ? world.npcs[0]!.id : world.player.id, 80, 80);
  if (world.player.id !== keepId) {
    world.player.hasBall = false;
  }
  let i = 0;
  for (const npc of world.npcs) {
    if (npc.id === keepId) continue;
    const angle = (i / 12) * Math.PI * 2;
    teleportId(world, npc.id, x + Math.cos(angle) * 900, y + Math.sin(angle) * 900);
    i += 1;
  }
}

function giveBallTo(world: World, id: string): void {
  world.ball.ownerId = id;
  world.player.hasBall = id === world.player.id;
}

function npcOfTeam(world: World, team: 0 | 1): NPC {
  const npc = world.npcs.find((n) => n.team === team && n.role === 'chase');
  assert.ok(npc, `expected a chase NPC on team ${team}`);
  return npc!;
}

function openMid(world: World): { x: number; y: number } {
  return { x: world.map.width * 0.55, y: world.map.height * 0.82 };
}

function assertPointsAtScoringGoal(npc: NPC, world: World, target: { x: number; y: number }): void {
  const goal = opponentGoalFor(npc.team, world.map);
  const home = world.map.goals.find((g) => g.team === npc.team)!.position;
  const toGoalX = goal.x - npc.position.x;
  const toTargetX = target.x - npc.position.x;
  assert.ok(
    toGoalX * toTargetX > 0,
    `team ${npc.team} steer x=${toTargetX.toFixed(1)} should share sign with scoring millstone x=${toGoalX.toFixed(1)}`,
  );
  const dGoal = Math.hypot(target.x - goal.x, target.y - goal.y);
  const dHome = Math.hypot(target.x - home.x, target.y - home.y);
  assert.ok(
    dGoal < dHome,
    `team ${npc.team} target should be closer to the scoring millstone than home (${dGoal.toFixed(0)} vs ${dHome.toFixed(0)})`,
  );
}

test('npc: team 0 carrier preferred target is the Down millstone (right)', () => {
  const world = createWorld({ seed: 2, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const carrier = npcOfTeam(world, 0);
  isolate(world, carrier.id, field.x, field.y);
  giveBallTo(world, carrier.id);

  const target = npcSteerTarget(carrier, world);
  assert.ok(target);
  const goal = opponentGoalFor(0, world.map);
  assert.equal(target!.x, goal.x);
  assert.equal(target!.y, goal.y);
  assert.ok(goal.x > carrier.position.x, 'team 0 scores to the right');
  assertPointsAtScoringGoal(carrier, world, target!);
});

test('npc: team 1 carrier preferred target is the Up millstone (left)', () => {
  const world = createWorld({ seed: 2, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const carrier = npcOfTeam(world, 1);
  isolate(world, carrier.id, field.x, field.y);
  giveBallTo(world, carrier.id);

  const target = npcSteerTarget(carrier, world);
  assert.ok(target);
  const goal = opponentGoalFor(1, world.map);
  assert.equal(target!.x, goal.x);
  assert.equal(target!.y, goal.y);
  assert.ok(goal.x < carrier.position.x, 'team 1 scores to the left');
  assertPointsAtScoringGoal(carrier, world, target!);
});

test('npc: isolated team 0 carrier advances toward the Down millstone', () => {
  const world = createWorld({ seed: 8, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const carrier = npcOfTeam(world, 0);
  isolate(world, carrier.id, field.x, field.y);
  giveBallTo(world, carrier.id);
  const x0 = carrier.position.x;
  runTicks(world, IDLE, 90);
  assert.ok(
    carrier.position.x > x0 + 40,
    `team 0 carrier should run right, ${x0.toFixed(0)} → ${carrier.position.x.toFixed(0)}`,
  );
});

test('npc: isolated team 1 carrier advances toward the Up millstone', () => {
  const world = createWorld({ seed: 8, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const carrier = npcOfTeam(world, 1);
  isolate(world, carrier.id, field.x, field.y);
  giveBallTo(world, carrier.id);
  const x0 = carrier.position.x;
  runTicks(world, IDLE, 90);
  assert.ok(
    carrier.position.x < x0 - 40,
    `team 1 carrier should run left, ${x0.toFixed(0)} → ${carrier.position.x.toFixed(0)}`,
  );
});

test('npc: closest contesting a loose stone biases toward the scoring millstone', () => {
  const world = createWorld({ seed: 4, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  parkBall(world, field.x, field.y);
  world.ball.ownerId = null;
  world.player.hasBall = false;

  const team0 = npcOfTeam(world, 0);
  isolate(world, team0.id, field.x - 40, field.y);
  const team1 = npcOfTeam(world, 1);
  teleportId(world, team1.id, field.x + 40, field.y);

  const d0 = Math.hypot(team0.position.x - field.x, team0.position.y - field.y);
  const d1 = Math.hypot(team1.position.x - field.x, team1.position.y - field.y);
  assert.ok(d0 < SHEPHERD_RADIUS && d1 < SHEPHERD_RADIUS);
  assert.ok(d0 < CONTEST_STEER_RADIUS);

  const t0 = npcSteerTarget(team0, world);
  const t1 = npcSteerTarget(team1, world);
  assert.ok(t0 && t1);
  assertPointsAtScoringGoal(team0, world, t0!);
  assertPointsAtScoringGoal(team1, world, t1!);

  const goal0 = opponentGoalFor(0, world.map);
  const goal1 = opponentGoalFor(1, world.map);
  const ballTo0 = { x: t0!.x - world.ball.position.x, y: t0!.y - world.ball.position.y };
  const ballTo1 = { x: t1!.x - world.ball.position.x, y: t1!.y - world.ball.position.y };
  assert.ok(
    ballTo0.x * (goal0.x - world.ball.position.x) > 0,
    'team 0 shepherd lead should point at the Down millstone',
  );
  assert.ok(
    ballTo1.x * (goal1.x - world.ball.position.x) > 0,
    'team 1 shepherd lead should point at the Up millstone',
  );
});

test('npc: turn-up swarm still aims at the stone, not a millstone', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  const hunter = npcOfTeam(world, 1);
  const tu = world.map.turnUp;
  parkBall(world, tu.x, tu.y);
  world.ball.ownerId = null;
  teleportId(world, hunter.id, tu.x - 80, tu.y);
  const dTurn = Math.hypot(world.ball.position.x - tu.x, world.ball.position.y - tu.y);
  assert.ok(dTurn < TURN_UP_SWARM_RADIUS);

  const target = npcSteerTarget(hunter, world);
  assert.ok(target);
  assert.equal(target, world.ball.position);
});

test('npc: hold collapse still crashes the player, not the far millstone', () => {
  const world = createWorld({ seed: 5 });
  startMatch(world);
  const goal = world.map.goals.find((g) => g.team !== world.player.team)!;
  const holder = world.npcs.find((n) => n.team === goal.team && n.role === 'hold');
  assert.ok(holder);
  teleportId(world, world.player.id, goal.position.x - 180, goal.position.y);
  giveBallTo(world, world.player.id);
  teleportId(world, holder!.id, goal.position.x + 40, goal.position.y - 220);

  const target = npcSteerTarget(holder!, world);
  assert.ok(target);
  assert.equal(target, world.player.position);
  const scoreAt = opponentGoalFor(holder!.team, world.map);
  assert.notEqual(target!.x, scoreAt.x);
});
