// test/event.test.ts — two-day event: early toss-up, day roll, aggregate draw.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  createWorld,
  DEFAULT_MATCH_DURATION_SECONDS,
  EARLY_GOAL_WINDOW_SECONDS,
  formatDayClock,
  isEarlyGoalWindow,
  nightfallAmount,
  startMatch,
  stepWorld,
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

const TAP: Input = { ...IDLE, goalTap: true };

function teleportPlayer(world: World, x: number, y: number): void {
  world.player.position = { x, y };
  world.player.velocity = { x: 0, y: 0 };
  const body = world.physics.bodies.get(world.player.id);
  if (body) {
    Matter.Body.setPosition(body, { x, y });
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
  }
}

function threeTapGoal(world: World): void {
  const goalToScoreOn = world.map.goals.find((g) => g.team !== world.player.team)!;
  teleportPlayer(world, goalToScoreOn.position.x, goalToScoreOn.position.y);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  world.goaling.carrierId = null;
  world.goaling.taps = 0;
  for (let tap = 0; tap < 3; tap++) {
    for (let i = 0; i < 60; i++) stepWorld(world, IDLE, 1 / 60);
    stepWorld(world, TAP, 1 / 60);
  }
}

test('event: day clock is five minutes and early window is three', () => {
  assert.equal(DEFAULT_MATCH_DURATION_SECONDS, 300);
  assert.equal(EARLY_GOAL_WINDOW_SECONDS, 180);
  const world = createWorld();
  startMatch(world);
  assert.equal(world.eventDay, 1);
  assert.equal(world.matchTimeRemaining, 300);
  assert.equal(isEarlyGoalWindow(world), true);
});

test('event: day clock reads 1pm at kickoff and 10pm at expiry', () => {
  const world = createWorld();
  startMatch(world);
  assert.equal(formatDayClock(world), '1:00 PM');
  assert.equal(nightfallAmount(world), 0, 'midday is still bright');

  // 7:00 PM — dusk well underway (dusk begins ~3pm).
  world.matchTimeRemaining = DEFAULT_MATCH_DURATION_SECONDS / 3;
  assert.equal(formatDayClock(world), '7:00 PM');
  assert.ok(nightfallAmount(world) > 0.45, 'evening has clearly darkened the pitch');
  assert.ok(nightfallAmount(world) < 0.7, 'not full night at 7pm');

  world.matchTimeRemaining = 0;
  assert.equal(formatDayClock(world), '10:00 PM');
  assert.ok(nightfallAmount(world) >= 0.85, '10pm is near-black');
});

test('event: early goal scores, tosses up, keeps remaining day time', () => {
  const world = createWorld();
  startMatch(world);
  world.matchTimeRemaining = 240; // 1:00 elapsed — inside 3-min window
  const before = world.matchTimeRemaining;
  threeTapGoal(world);

  assert.equal(world.matchState, 'playing', 'early goal must not end the event');
  assert.equal(world.eventDay, 1);
  assert.equal(world.score[world.player.team], 1);
  assert.equal(world.winState, null);
  assert.equal(world.ball.ownerId, null, 'stone returns to turn-up');
  assert.equal(world.player.hasBall, false);
  assert.ok(
    Math.abs(world.ball.position.x - world.map.turnUp.x) < 1,
    'ball at turn-up',
  );
  assert.ok(
    world.matchTimeRemaining <= before,
    'clock keeps running — no full reset',
  );
  assert.ok(world.matchTimeRemaining > 200, 'most of the remaining time is left');
  assert.equal(isEarlyGoalWindow(world), true);
  assert.ok(
    world.recoveryTimeRemaining > 9,
    'early goal opens a ~10s get-back window',
  );

  const clockAtRecovery = world.matchTimeRemaining;
  for (let i = 0; i < 60; i++) stepWorld(world, IDLE, 1 / 60);
  assert.ok(
    Math.abs(world.matchTimeRemaining - clockAtRecovery) < 1e-6,
    'day clock pauses during recovery',
  );
  assert.ok(world.recoveryTimeRemaining < 9.5, 'recovery counts down');
});

test('event: nightfall is obvious by mid-evening', () => {
  const world = createWorld();
  startMatch(world);
  // ~5:00 PM — dusk should have started (dusk begins ~3pm).
  world.matchTimeRemaining = DEFAULT_MATCH_DURATION_SECONDS * (5 / 9);
  assert.equal(formatDayClock(world), '5:00 PM');
  assert.ok(nightfallAmount(world) > 0.1, '5pm is past dusk start');
  world.matchTimeRemaining = 0;
  assert.ok(nightfallAmount(world) >= 0.85, '10pm is near-black');
});

test('event: late goal on day 1 rolls into day 2 placement', () => {
  const world = createWorld();
  startMatch(world);
  world.matchTimeRemaining = 90; // 3:30 elapsed — past early window
  threeTapGoal(world);

  assert.equal(world.matchState, 'placement', 'day 1 late goal returns to placement');
  assert.equal(world.eventDay, 2, 'day 1 late goal starts day 2');
  assert.equal(world.score[world.player.team], 1);
  assert.equal(world.winState, null);
  assert.equal(world.matchTimeRemaining, 0);
  assert.equal(world.ball.ownerId, null);

  startMatch(world);
  assert.equal(world.matchState, 'playing');
  assert.ok(world.matchTimeRemaining > 290, 'day 2 kickoff gets a fresh ~5:00');
});

test('event: day 1 timer expiry starts day 2 placement without a goal', () => {
  const world = createWorld();
  startMatch(world);
  world.matchTimeRemaining = 1 / 60;
  stepWorld(world, IDLE, 1 / 60);

  assert.equal(world.matchState, 'placement');
  assert.equal(world.eventDay, 2);
  assert.equal(world.score[0], 0);
  assert.equal(world.score[1], 0);
  assert.equal(world.winState, null);

  startMatch(world);
  assert.equal(world.matchState, 'playing');
  assert.ok(world.matchTimeRemaining > 290);
});

test('event: late goal on day 2 ends the event with aggregate winner', () => {
  const world = createWorld();
  startMatch(world);
  world.eventDay = 2;
  world.score = [1, 0];
  world.matchTimeRemaining = 60;
  threeTapGoal(world);

  assert.equal(world.matchState, 'over');
  assert.equal(world.score[world.player.team], world.player.team === 0 ? 2 : 1);
  assert.equal(world.winState?.winner, world.player.team);
  assert.equal(world.winState?.reason, 'goal');
});

test('event: day 2 timer expiry can draw when scores are level', () => {
  const world = createWorld();
  startMatch(world);
  world.eventDay = 2;
  world.score = [1, 1];
  world.matchTimeRemaining = 1 / 60;
  stepWorld(world, IDLE, 1 / 60);

  assert.equal(world.matchState, 'over');
  assert.equal(world.winState?.winner, null, 'level scores are a draw');
  assert.equal(world.winState?.reason, 'time');
  assert.deepEqual(world.score, [1, 1]);
});

test('event: day 2 timer expiry awards the side ahead on aggregate', () => {
  const world = createWorld();
  startMatch(world);
  world.eventDay = 2;
  world.score = [0, 2];
  world.matchTimeRemaining = 1 / 60;
  stepWorld(world, IDLE, 1 / 60);

  assert.equal(world.matchState, 'over');
  assert.equal(world.winState?.winner, 1);
  assert.equal(world.winState?.reason, 'time');
});
