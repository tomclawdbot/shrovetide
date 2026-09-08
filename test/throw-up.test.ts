// test/throw-up.test.ts — Ashbourne plinth throw-up (turned up) at kickoff.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  createWorld,
  DEFAULT_MATCH_DURATION_SECONDS,
  isBallAirborne,
  KICKOFF_THROW_SECONDS,
  PLINTH_HEIGHT,
  startMatch,
  stepWorld,
  THROW_OUT_MAX,
  THROW_OUT_MIN,
  THROW_SPIN_MAX,
  THROW_SPIN_MIN,
  THROW_UP_MAX,
  THROW_UP_MIN,
  type Input,
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

function runTicks(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, IDLE, 1 / 60);
}

function teleportPlayer(world: World, x: number, y: number): void {
  world.player.position = { x, y };
  world.player.velocity = { x: 0, y: 0 };
  const body = world.physics.bodies.get(world.player.id);
  if (body) {
    Matter.Body.setPosition(body, { x, y });
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }
}

test('throw-up: placement sits the stone on the plinth', () => {
  const world = createWorld({ seed: 3 });
  assert.equal(world.matchState, 'placement');
  assert.equal(world.ball.height, PLINTH_HEIGHT);
  assert.equal(world.ball.velocity.x, 0);
  assert.equal(world.ball.velocity.y, 0);
  assert.equal(world._ballHeightVel, 0);
  assert.equal(world.kickoffTimeRemaining, 0);
  assert.ok(
    Math.abs(world.ball.position.x - world.map.turnUp.x) < 1,
    'stone is on the turn-up plinth',
  );
});

test('throw-up: startMatch launches up and out with seeded spin in bounds', () => {
  const world = createWorld({ seed: 11 });
  startMatch(world);
  assert.equal(world.matchState, 'playing');
  assert.ok(world.kickoffTimeRemaining > KICKOFF_THROW_SECONDS - 0.01);
  assert.equal(world.ball.height, PLINTH_HEIGHT);
  assert.ok(world._ballHeightVel >= THROW_UP_MIN && world._ballHeightVel <= THROW_UP_MAX);
  const out = Math.hypot(world.ball.velocity.x, world.ball.velocity.y);
  assert.ok(out >= THROW_OUT_MIN - 1e-6 && out <= THROW_OUT_MAX + 1e-6, `out speed ${out}`);
  const spin = Math.abs(world._ballSpinRate);
  assert.ok(spin >= THROW_SPIN_MIN - 1e-6 && spin <= THROW_SPIN_MAX + 1e-6, `spin ${spin}`);
  assert.equal(world.ball.ownerId, null);
  assert.equal(isBallAirborne(world), true);
});

test('throw-up: same seed same launch; different seed different launch', () => {
  const a = createWorld({ seed: 42 });
  const b = createWorld({ seed: 42 });
  const c = createWorld({ seed: 7 });
  startMatch(a);
  startMatch(b);
  startMatch(c);
  assert.equal(a.ball.velocity.x, b.ball.velocity.x);
  assert.equal(a.ball.velocity.y, b.ball.velocity.y);
  assert.equal(a._ballHeightVel, b._ballHeightVel);
  assert.equal(a._ballSpinRate, b._ballSpinRate);
  assert.equal(a.ball.spin, b.ball.spin);
  const same =
    a.ball.velocity.x === c.ball.velocity.x &&
    a.ball.velocity.y === c.ball.velocity.y &&
    a._ballHeightVel === c._ballHeightVel &&
    a._ballSpinRate === c._ballSpinRate;
  assert.equal(same, false, 'different seeds must not clone the throw');
});

test('throw-up: stone cannot be claimed while airborne', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  for (let i = 0; i < 20; i++) {
    teleportPlayer(world, world.ball.position.x, world.ball.position.y);
    stepWorld(world, IDLE, 1 / 60);
  }
  assert.equal(isBallAirborne(world), true);
  assert.equal(world.ball.ownerId, null, 'airborne stone is not claimable');
  assert.ok(world.ball.height > PLINTH_HEIGHT, 'throw goes up from the plinth');
});

test('throw-up: day clock pauses for the ritual; stone lands; hug still packs', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  const clockAtThrow = world.matchTimeRemaining;
  assert.equal(clockAtThrow, DEFAULT_MATCH_DURATION_SECONDS);

  runTicks(world, 60);
  assert.ok(world.kickoffTimeRemaining > 0, 'still in the turn-up beat');
  assert.equal(world.matchTimeRemaining, clockAtThrow, 'day clock pauses during throw-up');

  runTicks(world, Math.ceil(KICKOFF_THROW_SECONDS * 60));
  assert.equal(isBallAirborne(world), false);
  assert.equal(world.ball.height, 0);
  assert.equal(world.kickoffTimeRemaining, 0);

  runTicks(world, 180);
  const near = world.npcs.filter((n) => {
    const d = Math.hypot(n.position.x - world.ball.position.x, n.position.y - world.ball.position.y);
    return d < 300;
  }).length;
  assert.ok(near >= 12, `hug should pack after the throw, got ${near} within 300px`);
  const drift = Math.hypot(
    world.ball.position.x - world.map.turnUp.x,
    world.ball.position.y - world.map.turnUp.y,
  );
  assert.ok(drift < 240, `throw should stay near the plinth, drift=${drift.toFixed(0)}`);
});

test('throw-up: 200 ticks stays deterministic across two worlds', () => {
  const w1 = createWorld({ seed: 42 });
  const w2 = createWorld({ seed: 42 });
  startMatch(w1);
  startMatch(w2);
  runTicks(w1, 200);
  runTicks(w2, 200);
  assert.equal(w1.ball.position.x, w2.ball.position.x);
  assert.equal(w1.ball.position.y, w2.ball.position.y);
  assert.equal(w1.ball.height, w2.ball.height);
  assert.equal(w1.ball.spin, w2.ball.spin);
  assert.equal(w1.player.position.x, w2.player.position.x);
});
