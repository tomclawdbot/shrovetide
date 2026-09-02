// test/sim.smoke.test.ts — `node --test` smoke tests for the sim.
// TICKET 002: world starts in 'placement' state. Anything that asserts on
// state changes (stamina, ball, tick counter) must call startMatch() first.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASHBOURNE_TOWN,
  createWorld,
  startMatch,
  stepWorld,
  type Input,
  type World,
} from '../sim/index.js';

function runTicks(world: World, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, input, 1 / 60);
  }
}

test('smoke: town map — runs 1000 ticks with 14 NPCs, no errors, no NaN', () => {
  const world = createWorld();
  // TICKET 002 verify-before-closing: world is 7v7 = 14 characters total
  // (1 controlled player + 6 teammates + 7 opponents).
  assert.equal(world.npcs.length, 13, '13 NPCs in world.npcs (14 total minus the controlled player)');
  assert.equal(world.player.radius, 16, 'controlled player has expected radius');
  // Map should be the Ashbourne town map, 2400×1600.
  assert.equal(world.map.width, ASHBOURNE_TOWN.width);
  assert.equal(world.map.height, ASHBOURNE_TOWN.height);
  // Must have obstacles, OOB zones, river, bridges, goals.
  assert.ok(world.map.obstacles.length > 0, 'town map has obstacles');
  assert.ok(world.map.outOfBounds.length > 0, 'town map has OOB zones');
  assert.ok(world.map.bridges.length >= 2, 'town map has at least 2 bridges');
  assert.equal(world.map.goals.length, 2, 'two millstone goals');

  // Start the match so stepWorld ticks.
  startMatch(world);
  assert.equal(world.matchState, 'playing');

  const input: Input = {
    move: { x: 0, y: 0 },
    sprint: false,
    charging: false,
    passAim: { x: 0, y: 0 },
    goalTap: false,
  };
  runTicks(world, input, 1000);

  assert.equal(world.tick, 1000, 'tick counter advanced 1000 times');
  // Controlled player position
  assert.ok(Number.isFinite(world.player.position.x), 'player x finite');
  assert.ok(Number.isFinite(world.player.position.y), 'player y finite');
  // Ball position
  assert.ok(Number.isFinite(world.ball.position.x), 'ball x finite');
  assert.ok(Number.isFinite(world.ball.position.y), 'ball y finite');
  // All 13 NPC positions
  for (const npc of world.npcs) {
    assert.ok(Number.isFinite(npc.position.x), `${npc.id} x finite`);
    assert.ok(Number.isFinite(npc.position.y), `${npc.id} y finite`);
  }
  // No NPC should have wandered into the OOB zones.
  for (const npc of world.npcs) {
    const inOOB = world.map.outOfBounds.some((z) =>
      npc.position.x >= z.position.x - z.width / 2 &&
      npc.position.x <= z.position.x + z.width / 2 &&
      npc.position.y >= z.position.y - z.height / 2 &&
      npc.position.y <= z.position.y + z.height / 2,
    );
    assert.ok(!inOOB, `${npc.id} stayed out of OOB zones`);
  }
});

test('smoke: runs 1000 ticks moving + sprinting with ball', () => {
  const world = createWorld();
  startMatch(world);
  const input: Input = {
    move: { x: 0.7, y: 0.3 },
    sprint: true,
    charging: false,
    passAim: { x: 0.7, y: 0.3 },
    goalTap: false,
  };
  runTicks(world, input, 1000);

  assert.equal(world.tick, 1000);
  assert.notEqual(world.player.position.x, world.width / 2, 'player moved off centre');
});

test('smoke: deterministic for same seed + same inputs', () => {
  const w1 = createWorld({ seed: 42 });
  const w2 = createWorld({ seed: 42 });
  startMatch(w1);
  startMatch(w2);
  const input: Input = {
    move: { x: 1, y: 0 },
    sprint: true,
    charging: false,
    passAim: { x: 1, y: 0 },
    goalTap: false,
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
  startMatch(world);
  const input: Input = {
    move: { x: 1, y: 0 },
    sprint: true,
    charging: false,
    passAim: { x: 1, y: 0 },
    goalTap: false,
  };
  // Force-pickup the ball (proximity pickup works fine too but this is faster).
  world.ball.ownerId = world.player.id;
  world.player.hasBall = true;

  // Now drain stamina for ~5 seconds (300 ticks).
  for (let i = 0; i < 300; i++) stepWorld(world, input, 1 / 60);

  assert.equal(world.player.stamina, 0, 'stamina should clamp at 0');
});

test('smoke: stamina regenerates when not sprinting', () => {
  const world = createWorld();
  startMatch(world);
  // Drain it.
  world.player.stamina = 0;
  world.player.hasBall = false;
  const input: Input = {
    move: { x: 0, y: 0 },
    sprint: false,
    charging: false,
    passAim: { x: 0, y: 0 },
    goalTap: false,
  };
  for (let i = 0; i < 180; i++) stepWorld(world, input, 1 / 60); // 3 sec
  assert.ok(world.player.stamina > 0, 'stamina should regenerate');
  assert.ok(world.player.stamina <= world.player.maxStamina);
});

test('smoke: goaling — 3 taps within spacing scores and ends match', () => {
  const world = createWorld();
  startMatch(world);
  // Teleport the controlled player right next to the opponent's goal with the ball.
  // Need to update BOTH the sim position AND the physics body, otherwise the
  // next stepWorld() will snap the player back to their spawn position.
  const goalToScoreOn = world.map.goals.find((g) => g.team !== world.player.team)!;
  world.player.position = { ...goalToScoreOn.position };
  const playerBody = world.physics.bodies.get(world.player.id);
  if (playerBody) {
    // Mutate via the engine — the body holds the source-of-truth position.
    (playerBody as { position: { x: number; y: number }; velocity: { x: number; y: number } }).position = { x: goalToScoreOn.position.x, y: goalToScoreOn.position.y };
    (playerBody as { velocity: { x: number; y: number } }).velocity = { x: 0, y: 0 };
  }
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  // Tap 3 times with valid spacing (60 ticks = 1s between taps, well over 0.5s min).
  const idle: Input = { move: { x: 0, y: 0 }, sprint: false, charging: false, passAim: { x: 0, y: 0 }, goalTap: false };
  const tap: Input = { move: { x: 0, y: 0 }, sprint: false, charging: false, passAim: { x: 0, y: 0 }, goalTap: true };
  for (let i = 0; i < 60; i++) stepWorld(world, idle, 1 / 60);
  stepWorld(world, tap, 1 / 60);
  for (let i = 0; i < 60; i++) stepWorld(world, idle, 1 / 60);
  stepWorld(world, tap, 1 / 60);
  for (let i = 0; i < 60; i++) stepWorld(world, idle, 1 / 60);
  stepWorld(world, tap, 1 / 60);

  assert.equal(world.matchState, 'over', 'match should be over after 3 taps');
  assert.equal(world.score[world.player.team], 1, 'scoring team gets +1');
  assert.ok(world.winState !== null, 'winState populated');
});