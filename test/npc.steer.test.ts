// test/npc.steer.test.ts — NPC scoring-end intelligence.
// Up'Ards (team 0) score at the Down millstone (right).
// Down'Ards (team 1) score at the Up millstone (left).

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  CONTEST_STEER_RADIUS,
  createWorld,
  EXHAUSTED_SPEED_MULT,
  goalFor,
  isAmongClosestHolders,
  isCarrierAtOpponentGoal,
  isTurnUpSwarm,
  npcIsBursting,
  npcSpeedCap,
  npcSteerTarget,
  opponentGoalFor,
  SCORE_DRIVE_FORCE_MULT,
  SCORE_DRIVE_SPEED_MULT,
  SHEPHERD_RADIUS,
  startMatch,
  stepWorld,
  TURN_UP_SWARM_RADIUS,
  NPC_VS_SPRINT_BUDGET,
  PLAYER_MAX_SPEED,
  SPRINT_SPEED_MULT,
  MOVEMENT,
  NPC_MAX_SPEED,
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
  const from = world.ball.ownerId === npc.id ? npc.position : world.ball.position;
  const toGoalX = goal.x - from.x;
  const toHomeX = home.x - from.x;
  const toTargetX = target.x - from.x;
  assert.ok(
    toGoalX * toTargetX > 0,
    `team ${npc.team} steer x=${toTargetX.toFixed(1)} should share sign with scoring millstone x=${toGoalX.toFixed(1)}`,
  );
  assert.ok(
    toHomeX * toTargetX < 0,
    `team ${npc.team} must not steer toward their home millstone`,
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
  const dx = carrier.position.x - x0;
  const goal = opponentGoalFor(0, world.map);
  const home = world.map.goals.find((g) => g.team === 0)!.position;
  assert.ok(
    dx > 55 && dx * (goal.x - x0) > 0,
    `team 0 carrier should run right, ${x0.toFixed(0)} → ${carrier.position.x.toFixed(0)}`,
  );
  assert.ok(
    dx * (home.x - x0) < 0,
    'team 0 displacement must not be toward the home millstone',
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
  const dx = carrier.position.x - x0;
  const goal = opponentGoalFor(1, world.map);
  const home = world.map.goals.find((g) => g.team === 1)!.position;
  assert.ok(
    dx < -55 && dx * (goal.x - x0) > 0,
    `team 1 carrier should run left, ${x0.toFixed(0)} → ${carrier.position.x.toFixed(0)}`,
  );
  assert.ok(
    dx * (home.x - x0) < 0,
    'team 1 displacement must not be toward the home millstone',
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

test('npc: chase NPC picks up a loose stone and drives the scoring millstone', () => {
  const world = createWorld({ seed: 6, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const hunter = npcOfTeam(world, 1);
  isolate(world, hunter.id, field.x, field.y);
  parkBall(world, field.x + 8, field.y);
  world.ball.ownerId = null;
  world.player.hasBall = false;
  assert.equal(isTurnUpSwarm(world), false, 'setup is off the turn-up');

  runTicks(world, IDLE, 8);
  assert.equal(world.ball.ownerId, hunter.id, 'nearest chase NPC should claim the loose stone');
  assert.equal(world.player.hasBall, false);

  const goal = opponentGoalFor(hunter.team, world.map);
  const target = npcSteerTarget(hunter, world);
  assert.ok(target);
  assert.equal(target!.x, goal.x);
  assert.equal(target!.y, goal.y);
  assertPointsAtScoringGoal(hunter, world, target!);

  const x0 = hunter.position.x;
  runTicks(world, IDLE, 90);
  assert.equal(world.ball.ownerId, hunter.id, 'carrier should keep the stone');
  const goalX = opponentGoalFor(hunter.team, world.map).x;
  const homeX = world.map.goals.find((g) => g.team === hunter.team)!.position.x;
  const dx = hunter.position.x - x0;
  assert.ok(
    dx * (goalX - x0) > 0 && Math.abs(dx) > 55,
    `after claim, team ${hunter.team} must progress toward the scoring millstone, ${x0.toFixed(0)} → ${hunter.position.x.toFixed(0)}`,
  );
  assert.ok(
    dx * (homeX - x0) < 0,
    `after claim, team ${hunter.team} must not run the home millstone`,
  );
});

test('npc: turn-up hug does not auto-claim the stone', () => {
  const world = createWorld({ seed: 3 });
  startMatch(world);
  const hunter = npcOfTeam(world, 1);
  const tu = world.map.turnUp;
  parkBall(world, tu.x, tu.y);
  world.ball.ownerId = null;
  world.player.hasBall = false;
  isolate(world, hunter.id, tu.x + 6, tu.y);
  assert.equal(isTurnUpSwarm(world), true);

  runTicks(world, IDLE, 20);
  assert.equal(world.ball.ownerId, null, 'kickoff hug should pack before anyone claims');
  assert.ok(
    Math.hypot(hunter.position.x - tu.x, hunter.position.y - tu.y) < TURN_UP_SWARM_RADIUS,
    'chaser should stay on the turn-up stone',
  );
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

function playerSprintCap(): number {
  return PLAYER_MAX_SPEED * SPRINT_SPEED_MULT;
}

function npcBudgetPxPerSec(): number {
  return playerSprintCap() * NPC_VS_SPRINT_BUDGET;
}

test('npc: carrier drive stays under the player-Sprint budget (no rocket)', () => {
  const world = createWorld({ seed: 8, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const carrier = npcOfTeam(world, 1);
  isolate(world, carrier.id, field.x, field.y);
  giveBallTo(world, carrier.id);
  const p0 = { x: carrier.position.x, y: carrier.position.y };
  const ticks = 90;
  runTicks(world, IDLE, ticks);
  const dist = Math.hypot(carrier.position.x - p0.x, carrier.position.y - p0.y);
  const mean = dist / (ticks / 60);
  const budget = npcBudgetPxPerSec();
  assert.ok(
    mean < budget,
    `NPC carrier mean ${mean.toFixed(1)} px/s must stay under Sprint budget ${budget.toFixed(1)}`,
  );
  assert.ok(dist > 40, `carrier should still progress, dist=${dist.toFixed(0)}`);
  const authored = NPC_MAX_SPEED * MOVEMENT.carrierSpeedMult * 1.05;
  assert.ok(
    mean < authored + 20,
    `carrier should sit near the authored carry cap (~${authored.toFixed(0)}), got ${mean.toFixed(1)}`,
  );
});

test('npc: claiming a loose overlapping stone does not rocket toward the millstone', () => {
  const world = createWorld({ seed: 6, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  const hunter = npcOfTeam(world, 1);
  isolate(world, hunter.id, field.x, field.y);
  parkBall(world, field.x + 8, field.y);
  world.ball.ownerId = null;
  world.player.hasBall = false;
  const p0 = { x: hunter.position.x, y: hunter.position.y };
  const ticks = 90;
  runTicks(world, IDLE, ticks);
  assert.equal(world.ball.ownerId, hunter.id, 'chase NPC should claim off the turn-up');
  const dist = Math.hypot(hunter.position.x - p0.x, hunter.position.y - p0.y);
  const mean = dist / (ticks / 60);
  const budget = npcBudgetPxPerSec();
  assert.ok(
    mean < budget,
    `post-claim drive ${mean.toFixed(1)} px/s must be contestable vs Sprint budget ${budget.toFixed(1)} (rocket was ~700)`,
  );
  assert.ok(
    hunter.position.x < p0.x - 55,
    `team 1 carrier should still run toward the Up millstone, ${p0.x.toFixed(0)} → ${hunter.position.x.toFixed(0)}`,
  );
  const home = world.map.goals.find((g) => g.team === 1)!.position;
  assert.ok(
    hunter.position.x - p0.x < 0 && home.x - p0.x > 0,
    'post-claim drive must not head for the Down (home) millstone',
  );
});

test('npc: player Sprint covers more ground than an NPC carrier in the same window', () => {
  const npcWorld = createWorld({ seed: 8, playerTeam: 0 });
  startMatch(npcWorld);
  const field = openMid(npcWorld);
  const carrier = npcOfTeam(npcWorld, 1);
  isolate(npcWorld, carrier.id, field.x, field.y);
  giveBallTo(npcWorld, carrier.id);
  const npcX0 = carrier.position.x;
  runTicks(npcWorld, IDLE, 90);
  const npcDx = Math.abs(carrier.position.x - npcX0);

  const playerWorld = createWorld({ seed: 8, playerTeam: 0 });
  startMatch(playerWorld);
  isolate(playerWorld, playerWorld.player.id, field.x, field.y);
  const sprint: Input = { ...IDLE, move: { x: -1, y: 0 }, sprint: true };
  const px0 = playerWorld.player.position.x;
  runTicks(playerWorld, sprint, 90);
  const playerDx = Math.abs(playerWorld.player.position.x - px0);

  assert.ok(
    playerDx > npcDx + 40,
    `Sprint (${playerDx.toFixed(0)}px) must outrun an NPC carrier (${npcDx.toFixed(0)}px) so a breakaway is contestable`,
  );
});

test('npc: SCORE_DRIVE force is a scoring nudge, not a rocket multiplier', () => {
  assert.ok(
    SCORE_DRIVE_FORCE_MULT >= 1.28,
    `SCORE_DRIVE_FORCE_MULT ${SCORE_DRIVE_FORCE_MULT} must be strong enough to progress after the #19 clamp`,
  );
  assert.ok(
    SCORE_DRIVE_FORCE_MULT <= 1.45,
    `SCORE_DRIVE_FORCE_MULT ${SCORE_DRIVE_FORCE_MULT} should stay a nudge so physics cannot overshoot the cap`,
  );
  assert.ok(
    SCORE_DRIVE_SPEED_MULT <= 1.05,
    `SCORE_DRIVE_SPEED_MULT ${SCORE_DRIVE_SPEED_MULT} must not raise NPC carriers above a defendable walk`,
  );
});

test('npc: carrier at the scoring millstone auto-taps and goals without the player', () => {
  const world = createWorld({ seed: 7, playerTeam: 0 });
  startMatch(world);
  const hunter = npcOfTeam(world, 1);
  const goal = opponentGoalFor(hunter.team, world.map);
  isolate(world, hunter.id, goal.x, goal.y - 24);
  giveBallTo(world, hunter.id);
  assert.equal(isCarrierAtOpponentGoal(world), true, 'setup: NPC is in millstone reach');
  assert.equal(world.player.hasBall, false);

  runTicks(world, IDLE, 20);
  assert.ok(world.goaling.taps >= 1, `first tap should land, taps=${world.goaling.taps}`);
  assert.equal(world.goaling.carrierId, hunter.id);
  assert.equal(world.matchState, 'playing', 'one tap is not a goal');

  runTicks(world, IDLE, 100);
  assert.equal(world.matchState, 'over', 'NPC 3-tap contest should finish the match');
  assert.equal(world.winState?.reason, 'goal');
  assert.equal(world.winState?.scorerId, hunter.id);
  assert.equal(world.winState?.scorerTeam, 1);
  assert.equal(world.score[1], 1);
  assert.equal(world.score[0], 0);
});

test('npc: team 0 carrier goals at the Down millstone, not home', () => {
  const world = createWorld({ seed: 7, playerTeam: 0 });
  startMatch(world);
  const hunter = npcOfTeam(world, 0);
  const down = opponentGoalFor(0, world.map);
  isolate(world, hunter.id, down.x, down.y - 24);
  giveBallTo(world, hunter.id);
  runTicks(world, IDLE, 120);
  assert.equal(world.matchState, 'over');
  assert.equal(world.winState?.scorerTeam, 0);
  assert.equal(world.score[0], 1);
});

test('npc: carrier at the home millstone cannot score', () => {
  const world = createWorld({ seed: 7, playerTeam: 0 });
  startMatch(world);
  const hunter = npcOfTeam(world, 1);
  const home = world.map.goals.find((g) => g.team === hunter.team)!.position;
  isolate(world, hunter.id, home.x, home.y - 24);
  giveBallTo(world, hunter.id);
  assert.equal(isCarrierAtOpponentGoal(world), false, 'home millstone is the wrong end');
  runTicks(world, IDLE, 120);
  assert.equal(world.matchState, 'playing', 'must not goal at the home stone');
  assert.equal(world.score[0], 0);
  assert.equal(world.score[1], 0);
  assert.equal(world.goaling.taps, 0);
});

test('npc: chasing a loose stone spends Breath; spent Breath kills the burst', () => {
  const world = createWorld({ seed: 4, playerTeam: 0 });
  startMatch(world);
  const field = openMid(world);
  parkBall(world, field.x, field.y);
  world.ball.ownerId = null;
  world.player.hasBall = false;
  const hunter = npcOfTeam(world, 1);
  isolate(world, hunter.id, field.x - 420, field.y);
  hunter.stamina = 100;
  assert.equal(npcIsBursting(hunter, world), true, 'loose-ball chase is a Sprint-like burst');
  const capFresh = npcSpeedCap(hunter, world);
  runTicks(world, IDLE, 90);
  assert.ok(
    hunter.stamina < 100 - 20,
    `open-field chase should spend Breath, stamina=${hunter.stamina.toFixed(1)}`,
  );
  hunter.stamina = 0;
  const capSpent = npcSpeedCap(hunter, world);
  assert.ok(
    capSpent < capFresh * 0.75,
    `spent Breath must drop the cap (${capSpent.toFixed(0)} vs ${capFresh.toFixed(0)})`,
  );
  assert.ok(
    Math.abs(capSpent - NPC_MAX_SPEED * EXHAUSTED_SPEED_MULT) < 8,
    `spent chase cap should sit on exhausted walk, got ${capSpent.toFixed(1)}`,
  );
});

test('npc: idle hold regenerates Breath', () => {
  const world = createWorld({ seed: 5, playerTeam: 0 });
  startMatch(world);
  const holder = world.npcs.find((n) => n.team === world.player.team && n.role === 'hold');
  assert.ok(holder);
  const home = goalFor(holder!.team, world.map);
  isolate(world, holder!.id, home.x, home.y);
  holder!.holdPosition = { x: home.x, y: home.y };
  holder!.stamina = 12;
  holder!.velocity = { x: 0, y: 0 };
  // Park the stone on the far millstone so this holder is covering, not chasing.
  const away = opponentGoalFor(holder!.team, world.map);
  parkBall(world, away.x, away.y);
  world.ball.ownerId = world.player.id;
  world.player.hasBall = true;
  teleportId(world, world.player.id, away.x - 80, away.y);
  runTicks(world, IDLE, 90);
  assert.ok(
    holder!.stamina > 12 + 8,
    `idle cover should regen Breath (${holder!.stamina.toFixed(1)})`,
  );
});

test('npc: hold reclaimers chase an enemy carrier; others cover the home millstone', () => {
  const world = createWorld({ seed: 5, playerTeam: 0 });
  startMatch(world);
  const mid = { x: world.map.width * 0.5, y: world.map.height * 0.82 };
  const enemy = world.npcs.find((n) => n.team !== world.player.team && n.role === 'chase');
  assert.ok(enemy);
  isolate(world, enemy!.id, mid.x, mid.y);
  giveBallTo(world, enemy!.id);

  const holders = world.npcs.filter((n) => n.team === world.player.team && n.role === 'hold');
  assert.ok(holders.length >= 4, 'home side should have hold bodies');
  const home = goalFor(0, world.map);
  holders.forEach((h, i) => {
    teleportId(world, h.id, home.x + 80 + i * 30, home.y + 120 + (i % 2) * 40);
    h.holdPosition = { ...h.position };
  });

  const reclaimers = holders.filter((h) => isAmongClosestHolders(h, world, 2));
  assert.equal(reclaimers.length, 2);
  for (const h of reclaimers) {
    const t = npcSteerTarget(h, world);
    assert.ok(t);
    assert.equal(t, enemy!.position, `${h.id} should hunt the enemy carrier`);
  }
  const cover = holders.filter((h) => !isAmongClosestHolders(h, world, 2));
  assert.ok(cover.length >= 1);
  for (const h of cover) {
    const t = npcSteerTarget(h, world);
    assert.ok(t);
    assert.equal(t!.x, home.x, `${h.id} should fall back to the home millstone`);
    assert.equal(t!.y, home.y);
  }
});
