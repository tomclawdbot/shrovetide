// test/sim.smoke.test.ts — `node --test` smoke tests for the sim.
// TICKET 002: world starts in 'placement' state. Anything that asserts on
// state changes (stamina, ball, tick counter) must call startMatch() first.
// TICKET 003a: added idle-drift, acceleration and TAB-cycling assertions.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  ASHBOURNE_TOWN,
  createWorld,
  cycleTeammate,
  isCarrierAtOpponentGoal,
  moveControlled,
  PASS_PICKUP_IMMUNITY_TICKS,
  quickSwitch,
  releasePass,
  startMatch,
  stepWorld,
  switchControl,
  type Input,
  type World,
} from '../sim/index.js';

function runTicks(world: World, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, input, 1 / 60);
  }
}

const IDLE: Input = {
  move: { x: 0, y: 0 },
  sprint: false,
  charging: false,
  passAim: { x: 0, y: 0 },
  goalTap: false,
};

/** Move a character in both the sim record and its physics body. */
function teleportPlayer(world: World, x: number, y: number): void {
  teleportId(world, world.player.id, x, y);
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

  runTicks(world, IDLE, 1000);

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

// ---------------------------------------------------------------------------
// TICKET 003a — game feel
// ---------------------------------------------------------------------------

test('feel: zero input in open ground produces zero drift', () => {
  const world = createWorld();
  startMatch(world);
  // Park the player in open ground well away from the ball and the hug —
  // south-east quadrant, clear of obstacles, river, and both OOB zones.
  teleportPlayer(world, 1700, 1300);
  const startX = world.player.position.x;
  const startY = world.player.position.y;

  runTicks(world, IDLE, 100);

  assert.ok(
    Math.abs(world.player.position.x - startX) < 0.001,
    `player x drifted: ${world.player.position.x} vs ${startX}`,
  );
  assert.ok(
    Math.abs(world.player.position.y - startY) < 0.001,
    `player y drifted: ${world.player.position.y} vs ${startY}`,
  );
});

test('feel: acceleration ramps rather than snapping to full speed', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);

  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };

  // One tick in, the character should be moving but nowhere near full tilt.
  stepWorld(world, east, 1 / 60);
  const firstTickSpeed = Math.hypot(world._controlVel.x, world._controlVel.y);
  assert.ok(firstTickSpeed > 0, 'character starts moving on the first tick');
  assert.ok(
    firstTickSpeed < world.player.maxSpeed * 0.5,
    `first-tick speed should be well under max, got ${firstTickSpeed}`,
  );

  // After ~0.3s it should be at (or very near) full speed.
  runTicks(world, east, 30);
  const settledSpeed = Math.hypot(world._controlVel.x, world._controlVel.y);
  assert.ok(
    settledSpeed > world.player.maxSpeed * 0.95,
    `should reach near-max speed, got ${settledSpeed}`,
  );
});

test('feel: releasing input brings the character to a dead stop', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);

  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  runTicks(world, east, 30);
  assert.ok(Math.hypot(world._controlVel.x, world._controlVel.y) > 0, 'moving');

  // timeToStop is 0.1s — 12 ticks is comfortably past that.
  runTicks(world, IDLE, 12);
  assert.equal(world._controlVel.x, 0, 'control velocity x fully stopped');
  assert.equal(world._controlVel.y, 0, 'control velocity y fully stopped');
});

test('switch: TAB cycles the controlled player during placement', () => {
  const world = createWorld();
  assert.equal(world.matchState, 'placement');
  const startId = world.player.id;
  const next = cycleTeammate(world);
  assert.ok(next, 'cycle during placement returned a teammate');
  assert.notEqual(next, startId);
  assert.equal(world.player.id, next);

  const x0 = world.player.position.x;
  const y0 = world.player.position.y;
  moveControlled(world, 48, 0);
  const moved = Math.hypot(world.player.position.x - x0, world.player.position.y - y0);
  assert.ok(moved > 1, 'stick/WASD walk the newly controlled teammate');
});

test('switch: tap-id switchControl works before whistle', () => {
  const world = createWorld();
  const mate = world.npcs.find((n) => n.team === world.player.team);
  assert.ok(mate);
  const from = world.player.id;
  assert.equal(switchControl(world, mate!.id), true);
  assert.equal(world.player.id, mate!.id);
  assert.ok(world.npcs.some((n) => n.id === from));
});

test('switch: Q / quickSwitch stays playing-only', () => {
  const world = createWorld();
  assert.equal(world.matchState, 'placement');
  assert.equal(quickSwitch(world), null, 'no quick-switch before whistle');
  startMatch(world);
  // May no-op if already nearest the stone; must not throw.
  quickSwitch(world);
});

test('feel: TAB cycles through every teammate rather than repeating one', () => {
  const world = createWorld();
  startMatch(world);

  const seen: string[] = [world.player.id];
  for (let i = 0; i < 6; i++) {
    const next = cycleTeammate(world);
    assert.ok(next !== null, `cycle ${i} returned a teammate`);
    seen.push(next!);
  }

  const unique = new Set(seen);
  assert.equal(unique.size, 7, `expected 7 distinct controlled characters, saw ${[...unique].join(', ')}`);

  // One more cycle should wrap back to where we started.
  const wrapped = cycleTeammate(world);
  assert.equal(wrapped, seen[0], 'ring wraps back to the original character');
});

test('feel: switching control resets the control velocity', () => {
  const world = createWorld();
  startMatch(world);
  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  runTicks(world, east, 30);
  assert.ok(Math.hypot(world._controlVel.x, world._controlVel.y) > 0, 'moving before switch');

  cycleTeammate(world);
  assert.equal(world._controlVel.x, 0, 'control velocity cleared on switch');
  assert.equal(world._controlVel.y, 0, 'control velocity cleared on switch');
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
  for (let i = 0; i < 180; i++) stepWorld(world, IDLE, 1 / 60); // 3 sec
  assert.ok(world.player.stamina > 0, 'stamina should regenerate');
  assert.ok(world.player.stamina <= world.player.maxStamina);
});

test('smoke: goaling — 3 taps within spacing scores and ends match', () => {
  const world = createWorld();
  startMatch(world);
  // Teleport the controlled player right next to the opponent's goal with the ball.
  const goalToScoreOn = world.map.goals.find((g) => g.team !== world.player.team)!;
  teleportPlayer(world, goalToScoreOn.position.x, goalToScoreOn.position.y);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  // Tap 3 times with valid spacing (60 ticks = 1s between taps, well over 0.5s min).
  const tap: Input = { ...IDLE, goalTap: true };
  for (let i = 0; i < 60; i++) stepWorld(world, IDLE, 1 / 60);
  stepWorld(world, tap, 1 / 60);
  for (let i = 0; i < 60; i++) stepWorld(world, IDLE, 1 / 60);
  stepWorld(world, tap, 1 / 60);
  for (let i = 0; i < 60; i++) stepWorld(world, IDLE, 1 / 60);
  stepWorld(world, tap, 1 / 60);

  assert.equal(world.matchState, 'over', 'match should be over after 3 taps');
  assert.equal(world.score[world.player.team], 1, 'scoring team gets +1');
  assert.ok(world.winState !== null, 'winState populated');
});

test('feel: holding one direction stays on the pitch', () => {
  const world = createWorld();
  startMatch(world);
  const west: Input = { ...IDLE, move: { x: -1, y: 0 } };
  runTicks(world, west, 600);
  assert.ok(world.player.position.x >= world.player.radius, 'not past the left sideline');
  assert.ok(world.player.position.x <= world.map.width - world.player.radius, 'not past the right sideline');
  assert.ok(world.player.position.y >= world.player.radius, 'not past the top');
  assert.ok(world.player.position.y <= world.map.height - world.player.radius, 'not past the bottom');
});

test('feel: 1s of east input displaces about maxSpeed, not the whole pitch', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);
  const x0 = world.player.position.x;
  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  runTicks(world, east, 60);
  const dx = world.player.position.x - x0;
  assert.ok(dx > 140, `should cover most of a second of run, got ${dx}`);
  assert.ok(dx < 210, `should not rocket across the map, got ${dx}`);
});

test('feel: carrying the ball does not rocket-launch the player', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  const x0 = world.player.position.x;
  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  runTicks(world, east, 60);
  const dx = world.player.position.x - x0;
  // Carrier is slower (carrierSpeedMult 0.78) — still px/s, not px/tick.
  assert.ok(dx > 100, `carrier should still run, got ${dx}`);
  assert.ok(dx < 180, `carrier must not be collision-launched, got ${dx}`);
});

test('feel: millstones are reachable from walkable bank ground', () => {
  const world = createWorld();
  startMatch(world);
  const goal = world.map.goals.find((g) => g.team !== world.player.team)!;
  // Stand on the dry bank just north of the stone — must be inside GOAL_REACH.
  teleportPlayer(world, goal.position.x, goal.position.y - 40);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  const dx = world.player.position.x - goal.position.x;
  const dy = world.player.position.y - goal.position.y;
  assert.ok(
    Math.hypot(dx, dy) <= 56,
    `bank stand should be within GOAL_REACH, dist=${Math.hypot(dx, dy)}`,
  );
  assert.equal(isCarrierAtOpponentGoal(world), true);
});

test('goal: millstone reach is false until the carrier is next to the stone', () => {
  const world = createWorld();
  startMatch(world);
  assert.equal(isCarrierAtOpponentGoal(world), false);
  teleportPlayer(world, 1700, 1300);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  assert.equal(isCarrierAtOpponentGoal(world), false, 'carrying mid-field is not a goal');
});

test('pass: kicker cannot instantly re-grab the ball', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  assert.equal(releasePass(world, { x: 1, y: 0 }, 0.8), true);
  assert.equal(world.player.hasBall, false);
  assert.equal(world.physics.ballBody.isSensor, false);
  runTicks(world, IDLE, PASS_PICKUP_IMMUNITY_TICKS - 1);
  assert.equal(world.player.hasBall, false, 'still immune');
  assert.equal(world.ball.ownerId, null);
});

test('pass: a second kick works after picking the ball up again', () => {
  const world = createWorld();
  startMatch(world);
  teleportPlayer(world, 1700, 1300);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  assert.equal(releasePass(world, { x: 1, y: 0 }, 0.5), true);

  runTicks(world, IDLE, PASS_PICKUP_IMMUNITY_TICKS + 4);
  world.ball.ownerId = null;
  world.player.hasBall = false;
  Matter.Body.setPosition(world.physics.ballBody, world.player.position);
  world.ball.position = { ...world.player.position };
  runTicks(world, IDLE, 4);
  assert.equal(world.player.hasBall, true, 'picked up again');

  assert.equal(releasePass(world, { x: 0, y: 1 }, 0.6), true);
  assert.equal(world.player.hasBall, false);
  assert.equal(world.ball.ownerId, null);
  assert.equal(world.physics.ballBody.isSensor, false);
});

test('feel: sprint is faster than a walk and drains Breath without the ball', () => {
  const walk = createWorld({ seed: 7 });
  const burst = createWorld({ seed: 7 });
  startMatch(walk);
  startMatch(burst);
  teleportPlayer(walk, 1700, 1300);
  teleportPlayer(burst, 1700, 1300);
  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  const eastSprint: Input = { ...east, sprint: true };
  runTicks(walk, east, 60);
  runTicks(burst, eastSprint, 60);
  const dxWalk = walk.player.position.x - 1700;
  const dxBurst = burst.player.position.x - 1700;
  assert.ok(dxBurst > dxWalk + 20, `sprint should outrun a walk (${dxBurst} vs ${dxWalk})`);
  assert.ok(burst.player.stamina < burst.player.maxStamina - 10, 'Breath should drop while sprinting');
  assert.equal(walk.player.stamina, walk.player.maxStamina, 'a walk does not drain Breath');
});

test('feel: chase NPCs close on a loose ball within a few seconds', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  teleportPlayer(world, 400, 1300);
  const hunter = world.npcs.find((n) => n.team !== world.player.team && n.role === 'chase');
  assert.ok(hunter);
  Matter.Body.setPosition(world.physics.ballBody, { x: 1700, y: 1300 });
  world.ball.position = { x: 1700, y: 1300 };
  world.ball.velocity = { x: 0, y: 0 };
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  teleportId(world, hunter!.id, 1200, 1300);
  const d0 = Math.hypot(
    hunter!.position.x - world.ball.position.x,
    hunter!.position.y - world.ball.position.y,
  );
  runTicks(world, IDLE, 180);
  const d1 = Math.hypot(
    hunter!.position.x - world.ball.position.x,
    hunter!.position.y - world.ball.position.y,
  );
  assert.ok(d1 < d0 - 180, `should close hard on the ball (${d0.toFixed(0)} → ${d1.toFixed(0)})`);
  assert.ok(d1 < 260, `should be in the scrum within 3s, dist=${d1.toFixed(0)}`);
});

test('feel: kickoff packs bodies around the turn-up', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  runTicks(world, IDLE, 180);
  const near = world.npcs.filter((n) => {
    const d = Math.hypot(n.position.x - world.ball.position.x, n.position.y - world.ball.position.y);
    return d < 300;
  }).length;
  assert.ok(near >= 3, `expected a scrum at the turn-up, got ${near} NPCs within 300px`);
});

