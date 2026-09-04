// test/wrestle.test.ts — Rip / Wriggle eligibility + deterministic pop / burrow.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  canNpcRip,
  canRip,
  canWriggle,
  countHugNeighbors,
  createWorld,
  hugPackExtent,
  inRipContest,
  NPC_RIP_SUCCESS_SECONDS,
  npcRipContest,
  popBallFree,
  RIP_REACH,
  RIP_SUCCESS_SECONDS,
  ripClearDistance,
  startMatch,
  stepWorld,
  teammateAtPoint,
  wrestleMode,
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

function runTicks(world: World, input: Input, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, input, 1 / 60);
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

function parkIsolated(world: World, x: number, y: number, clearRadius = 220): void {
  teleportId(world, world.player.id, x, y);
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  let i = 0;
  for (const npc of world.npcs) {
    const d = Math.hypot(npc.position.x - x, npc.position.y - y);
    if (d >= clearRadius) continue;
    const angle = (i / 10) * Math.PI * 2;
    teleportId(world, npc.id, x + Math.cos(angle) * (clearRadius + 100), y + Math.sin(angle) * (clearRadius + 100));
    i += 1;
  }
}

function openField(world: World): { x: number; y: number } {
  return { x: world.map.width * 0.70, y: world.map.height * 0.82 };
}

/** Pack `count` NPCs around (x,y). Player stays at `playerOffset` from the stone. */
function packHug(
  world: World,
  x: number,
  y: number,
  count: number,
  playerOffset = { x: 0, y: 0 },
  radius = 34,
): void {
  teleportId(world, world.player.id, x + playerOffset.x, y + playerOffset.y);
  world.player.hasBall = false;
  world.ball.ownerId = null;
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  Matter.Body.setPosition(world.physics.ballBody, { x, y });
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  world.ball.position = { x, y };
  world.ball.velocity = { x: 0, y: 0 };

  let packed = 0;
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i]!;
    if (packed < count) {
      const angle = (packed / count) * Math.PI * 2;
      teleportId(world, npc.id, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      packed += 1;
    } else {
      teleportId(world, npc.id, 80 + ((i * 47) % 400), 80 + ((i * 31) % 300));
    }
  }
}

test('rip: eligible only when empty-handed, near the stone, in a dense pack', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);

  parkIsolated(world, field.x, field.y);
  Matter.Body.setPosition(world.physics.ballBody, { x: field.x + 8, y: field.y });
  world.ball.position = { x: field.x + 8, y: field.y };
  world.player.hasBall = false;
  world.ball.ownerId = null;
  assert.equal(canRip(world), false, 'isolated near the ball is not a hug');
  assert.equal(wrestleMode(world), 'none');

  packHug(world, field.x, field.y, 8);
  assert.ok(countHugNeighbors(world, world.player.id, world.player.position) >= 3);
  assert.equal(canRip(world), true, 'deep in a packed hug with a loose stone');
  assert.equal(wrestleMode(world), 'rip');

  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  assert.equal(canRip(world), false, 'carrier cannot Rip — Kick stays the out');
  assert.equal(canWriggle(world), false);
  assert.equal(wrestleMode(world), 'none');
  world.player.hasBall = false;
  world.ball.ownerId = null;

  teleportId(world, world.player.id, field.x + 200, field.y);
  assert.equal(canRip(world), false, 'packed but far from the stone');
});

function distFrom(world: World, origin: { x: number; y: number }): number {
  return Math.hypot(world.ball.position.x - origin.x, world.ball.position.y - origin.y);
}

test('rip: popBallFree places the stone outside the packed hug', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const pack = hugPackExtent(world, field)!;
  const need = ripClearDistance(world, field);
  popBallFree(world, { x: 1, y: 0 }, 340);
  const d = distFrom(world, pack.centroid);
  assert.ok(
    d >= pack.radius + world.ball.radius,
    `stone must leave the scrum skin, d=${d.toFixed(1)} packR=${pack.radius.toFixed(1)} need=${need.toFixed(1)}`,
  );
  assert.ok(d >= need - 1, `placement should use the clear distance, d=${d.toFixed(1)} need=${need.toFixed(1)}`);
  assert.equal(world.ball.ownerId, null);
  assert.ok(world.ball.position.x > pack.centroid.x + 20, 'east pop should leave on the east side');
});

test('rip: holding F pops the stone clear of the pack; Breath drains', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const pack0 = hugPackExtent(world, field)!;
  const clear = pack0.radius + world.ball.radius + 8;
  const breath0 = world.player.stamina;
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 2);

  assert.ok(world.player.stamina < breath0 - 8, `Rip should spend Breath (${world.player.stamina} vs ${breath0})`);
  assert.equal(world.ball.ownerId, null);
  assert.equal(world.player.hasBall, false);
  const d = distFrom(world, field);
  const dx = world.ball.position.x - field.x;
  assert.ok(
    d > clear,
    `stone must pop clear of the packed scrum, d=${d.toFixed(1)} clear=${clear.toFixed(1)}`,
  );
  assert.ok(dx > 20, `pop should favour facing (east), dx=${dx.toFixed(1)}`);
});

test('rip: after pop the stone stays free of the original scrum', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const pack0 = hugPackExtent(world, field)!;
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 2);
  assert.equal(world.ball.ownerId, null);
  runTicks(world, IDLE, 30);
  assert.equal(world.ball.ownerId, null, 'ripper immunity must block instant re-grab');
  assert.equal(world.player.hasBall, false);
  const d = distFrom(world, field);
  assert.ok(
    d > pack0.radius,
    `stone must stay out of the original cluster, d=${d.toFixed(1)} packR=${pack0.radius.toFixed(1)}`,
  );
});

test('rip: facing into the pack still squirts the stone out the far side', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  // Player stands west of the stone, facing east — into the hug.
  packHug(world, field.x, field.y, 8, { x: -28, y: 0 });
  const pack0 = hugPackExtent(world, field)!;
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 2);
  const d = distFrom(world, field);
  assert.equal(world.ball.ownerId, null);
  assert.ok(
    d > pack0.radius + world.ball.radius,
    `inward facing must still clear the scrum, d=${d.toFixed(1)} packR=${pack0.radius.toFixed(1)}`,
  );
  assert.ok(world.ball.position.x > field.x, 'east facing pops out the east side of the pack');
});

test('rip: a brief shove out of Rip range does not reset a live hold', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  const holdTicks = Math.max(12, Math.ceil(RIP_SUCCESS_SECONDS * 60 * 0.45));
  runTicks(world, rip, holdTicks);
  assert.ok(
    world._ripPressure > 0.3 && world._ripPressure < 1,
    `contest should be building (pressure=${world._ripPressure.toFixed(2)})`,
  );
  teleportId(world, world.player.id, field.x + RIP_REACH + 8, field.y);
  assert.equal(canRip(world), false, 'now outside Rip reach');
  assert.equal(inRipContest(world), true, 'still in the wrestle');
  const pack0 = hugPackExtent(world, field)!;
  // Keep holding in place — walking away should not be required to finish.
  const hold: Input = { ...IDLE, rip: true, wriggle: true };
  runTicks(world, hold, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 4);
  const d = distFrom(world, field);
  assert.equal(world.ball.ownerId, null);
  assert.ok(
    d > pack0.radius,
    `grace hold should still pop clear, d=${d.toFixed(1)} packR=${pack0.radius.toFixed(1)}`,
  );
});

test('rip: early release spends Breath and does not pop', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const breath0 = world.player.stamina;
  const rip: Input = { ...IDLE, rip: true, wriggle: true };
  runTicks(world, rip, 8);
  assert.ok(world.player.stamina < breath0, 'trying still costs Breath');
  assert.ok(world._ripPressure > 0 && world._ripPressure < 1, 'contest is still building');
  runTicks(world, IDLE, 4);
  assert.equal(world._ripPressure, 0, 'release clears pressure');
  const d = Math.hypot(world.ball.position.x - field.x, world.ball.position.y - field.y);
  assert.ok(d < 55, `early release should not pop the stone out, dist=${d.toFixed(1)}`);
});

test('wriggle: eligible on the rim of a dense hug, not when isolated or carrying', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);

  parkIsolated(world, field.x + 70, field.y);
  Matter.Body.setPosition(world.physics.ballBody, { x: field.x, y: field.y });
  world.ball.position = { x: field.x, y: field.y };
  assert.equal(canWriggle(world), false, 'no pack to burrow into');

  packHug(world, field.x, field.y, 8, { x: 72, y: 0 });
  assert.equal(canRip(world), false, 'rim stand is not yet Rip range');
  assert.equal(canWriggle(world), true);
  assert.equal(wrestleMode(world), 'wriggle');

  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  assert.equal(canWriggle(world), false);
});

test('wriggle: hold makes measurable progress into a packed hug', () => {
  const idle = createWorld({ seed: 4 });
  const burrow = createWorld({ seed: 4 });
  startMatch(idle);
  startMatch(burrow);
  const field = openField(idle);
  packHug(idle, field.x, field.y, 8, { x: 70, y: 0 });
  packHug(burrow, field.x, field.y, 8, { x: 70, y: 0 });

  const wriggle: Input = { ...IDLE, wriggle: true, rip: true };
  const d0 = Math.hypot(burrow.player.position.x - field.x, burrow.player.position.y - field.y);
  runTicks(idle, IDLE, 45);
  runTicks(burrow, wriggle, 45);
  const dIdle = Math.hypot(idle.player.position.x - field.x, idle.player.position.y - field.y);
  const dWriggle = Math.hypot(burrow.player.position.x - field.x, burrow.player.position.y - field.y);
  assert.ok(dWriggle < d0 - 14, `wriggle should close on the stone (${d0.toFixed(0)} → ${dWriggle.toFixed(0)})`);
  assert.ok(
    dWriggle < dIdle - 10,
    `wriggle should beat standing in the pack (${dWriggle.toFixed(0)} vs idle ${dIdle.toFixed(0)})`,
  );
  assert.ok(d0 - dWriggle < 80, `must not teleport through the scrum (closed ${(d0 - dWriggle).toFixed(0)}px)`);
  assert.ok(burrow.player.stamina < idle.player.stamina - 8, 'Wriggle should cost extra Breath');
});

/** Pack opposing chase NPCs around the player so they can Rip a carrier. */
function packOpposingRip(world: World, x: number, y: number, count = 8, radius = 34): void {
  teleportId(world, world.player.id, x, y);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  Matter.Body.setPosition(world.physics.ballBody, { x, y });
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  world.ball.position = { x, y };
  world.ball.velocity = { x: 0, y: 0 };

  let packed = 0;
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i]!;
    if (npc.team !== world.player.team && packed < count) {
      const angle = (packed / count) * Math.PI * 2;
      teleportId(world, npc.id, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      packed += 1;
    } else {
      teleportId(world, npc.id, 80 + ((i * 47) % 400), 80 + ((i * 31) % 300));
    }
  }
}

test('npc rip: opposing pack strips the stone off a player carrier', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packOpposingRip(world, field.x, field.y);
  const pack0 = hugPackExtent(world, field)!;

  const eligible = world.npcs.filter((n) => n.team !== world.player.team && canNpcRip(world, n));
  assert.ok(eligible.length > 0, 'an opposing NPC should be Rip-eligible in the packed hug');
  const breath0 = new Map(eligible.map((n) => [n.id, n.stamina]));

  runTicks(world, IDLE, Math.ceil(NPC_RIP_SUCCESS_SECONDS * 60) + 4);

  const spent = world.npcs.some((n) => {
    const start = breath0.get(n.id);
    return start !== undefined && n.stamina < start - 8;
  });
  assert.ok(spent, 'the NPC who Ripped should spend Breath');
  assert.equal(world.player.hasBall, false, 'player must lose the stone');
  assert.equal(world.ball.ownerId, null, 'Rip pops the stone free of the pack');
  const d = distFrom(world, field);
  assert.ok(
    d > pack0.radius,
    `stone must pop clear of the packed hug, d=${d.toFixed(1)} packR=${pack0.radius.toFixed(1)}`,
  );
});

test('npc rip: contest is visible and rate-limited after a strip', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packOpposingRip(world, field.x, field.y);

  runTicks(world, IDLE, 10);
  const live = npcRipContest(world);
  assert.ok(live, 'HUD should see an NPC Rip contest while it builds');
  assert.ok(live!.pressure > 0 && live!.pressure < 1);

  runTicks(world, IDLE, Math.ceil(NPC_RIP_SUCCESS_SECONDS * 60) + 4);
  assert.equal(world.ball.ownerId, null);
  assert.equal(npcRipContest(world), null, 'contest clears after the pop');
  assert.ok(world._npcRipCooldownUntilTick > world.tick, 'successful NPC Rip starts a cooldown');

  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  Matter.Body.setPosition(world.physics.ballBody, world.player.position);
  world.ball.position = { ...world.player.position };
  const cooldownLeft = world._npcRipCooldownUntilTick - world.tick;
  runTicks(world, IDLE, Math.min(20, cooldownLeft));
  assert.equal(world.ball.ownerId, world.player.id, 'cooldown must block instant re-steal');
  assert.equal(world.player.hasBall, true);
});

test('tap: teammateAtPoint hits a nearby mate and ignores empty grass', () => {
  const world = createWorld({ seed: 2 });
  const mate = world.npcs.find((n) => n.team === world.player.team);
  assert.ok(mate);
  assert.equal(teammateAtPoint(world, mate!.position.x + 10, mate!.position.y), mate!.id);
  assert.equal(teammateAtPoint(world, 40, 40), null);
});

/** Player packed onto an opposing NPC carrier. */
function packPlayerOnNpcCarrier(world: World, x: number, y: number, count = 8, radius = 34): string {
  const carrier = world.npcs.find((n) => n.team !== world.player.team);
  assert.ok(carrier, 'need an opposing carrier');
  teleportId(world, carrier!.id, x, y);
  world.player.hasBall = false;
  world.ball.ownerId = carrier!.id;
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  Matter.Body.setPosition(world.physics.ballBody, { x, y });
  Matter.Body.setVelocity(world.physics.ballBody, { x: 0, y: 0 });
  world.ball.position = { x, y };
  world.ball.velocity = { x: 0, y: 0 };
  teleportId(world, world.player.id, x + 26, y);

  let packed = 0;
  for (let i = 0; i < world.npcs.length; i++) {
    const npc = world.npcs[i]!;
    if (npc.id === carrier!.id) continue;
    if (packed < count) {
      const angle = (packed / count) * Math.PI * 2;
      teleportId(world, npc.id, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      packed += 1;
    } else {
      teleportId(world, npc.id, 80 + ((i * 47) % 400), 80 + ((i * 31) % 300));
    }
  }
  return carrier!.id;
}

test('rip: player strips an opposing NPC carrier in a packed hug', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  const carrierId = packPlayerOnNpcCarrier(world, field.x, field.y);
  assert.equal(world.ball.ownerId, carrierId);
  assert.equal(world.player.hasBall, false);
  assert.ok(countHugNeighbors(world, world.player.id, world.player.position) >= 2);
  assert.equal(canRip(world), true, 'packed onto an opposing carrier should be Rip-eligible');
  assert.equal(wrestleMode(world), 'rip');

  const pack0 = hugPackExtent(world, field)!;
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 4);

  assert.equal(world.player.hasBall, false);
  assert.equal(world.ball.ownerId, null, 'Rip should pop the stone off the NPC carrier');
  const d = distFrom(world, field);
  assert.ok(
    d > pack0.radius,
    `stone must pop clear of the packed hug, d=${d.toFixed(1)} packR=${pack0.radius.toFixed(1)}`,
  );
});
