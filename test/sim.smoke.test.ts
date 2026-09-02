// test/sim.smoke.test.ts — `node --test` smoke test for the sim.
// Runs a fresh world for 1000 fixed-timestep ticks under varied inputs
// and asserts no errors + all positions stay finite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, type Input, type World } from '../sim/index.js';

function runTicks(world: World, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, input, 1 / 60);
  }
}

test('smoke: runs 1000 ticks with no input without error', () => {
  const world = createWorld();
  const input: Input = {
    move: { x: 0, y: 0 },
    sprint: false,
    charging: false,
    passAim: { x: 0, y: 0 },
  };
  runTicks(world, input, 1000);

  assert.equal(world.tick, 1000);
  assert.ok(Number.isFinite(world.player.position.x));
  assert.ok(Number.isFinite(world.player.position.y));
  assert.ok(Number.isFinite(world.ball.position.x));
  assert.ok(Number.isFinite(world.ball.position.y));
  for (const npc of world.npcs) {
    assert.ok(Number.isFinite(npc.position.x), `${npc.id} x finite`);
    assert.ok(Number.isFinite(npc.position.y), `${npc.id} y finite`);
  }
});

test('smoke: runs 1000 ticks while moving + sprinting with ball', () => {
  const world = createWorld();
  const input: Input = {
    move: { x: 0.7, y: 0.3 },
    sprint: true,
    charging: false,
    passAim: { x: 0.7, y: 0.3 },
  };
  runTicks(world, input, 1000);

  assert.equal(world.tick, 1000);
  // Player should have moved noticeably.
  assert.notEqual(world.player.position.x, world.width / 2);
});

test('smoke: deterministic for same seed + same inputs', () => {
  const w1 = createWorld({ seed: 42 });
  const w2 = createWorld({ seed: 42 });
  const input: Input = {
    move: { x: 1, y: 0 },
    sprint: true,
    charging: false,
    passAim: { x: 1, y: 0 },
  };
  runTicks(w1, input, 200);
  runTicks(w2, input, 200);

  assert.equal(w1.player.position.x, w2.player.position.x);
  assert.equal(w1.player.position.y, w2.player.position.y);
  assert.equal(w1.ball.position.x, w2.ball.position.x);
  assert.equal(w1.ball.position.y, w2.ball.position.y);
  for (let i = 0; i < w1.npcs.length; i++) {
    const a = w1.npcs[i]!;
    const b = w2.npcs[i]!;
    assert.equal(a.position.x, b.position.x, `npc ${i} x`);
    assert.equal(a.position.y, b.position.y, `npc ${i} y`);
  }
});

test('smoke: stamina drains to zero under sustained sprint-with-ball', () => {
  const world = createWorld();
  const input: Input = {
    move: { x: 1, y: 0 },
    sprint: true,
    charging: false,
    passAim: { x: 1, y: 0 },
  };
  // Pick up the ball first by stepping close to it.
  for (let i = 0; i < 60; i++) stepWorld(world, input, 1 / 60);
  // Force pickup regardless of where physics ended up.
  world.ball.ownerId = world.player.id;
  world.player.hasBall = true;

  // Now drain stamina for ~5 seconds (300 ticks).
  for (let i = 0; i < 300; i++) stepWorld(world, input, 1 / 60);

  assert.equal(world.player.stamina, 0, 'stamina should clamp at 0');
});

test('smoke: stamina regenerates when not sprinting', () => {
  const world = createWorld();
  // Drain it.
  world.player.stamina = 0;
  world.player.hasBall = false;
  const input: Input = {
    move: { x: 0, y: 0 },
    sprint: false,
    charging: false,
    passAim: { x: 0, y: 0 },
  };
  for (let i = 0; i < 180; i++) stepWorld(world, input, 1 / 60); // 3 sec
  assert.ok(world.player.stamina > 0, 'stamina should regenerate');
  assert.ok(world.player.stamina <= world.player.maxStamina);
});
