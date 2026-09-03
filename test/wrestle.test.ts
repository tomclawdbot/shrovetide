// test/wrestle.test.ts — Rip / Wriggle eligibility + deterministic pop / burrow.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  canRip,
  canWriggle,
  countHugNeighbors,
  createWorld,
  RIP_POP_SPEED,
  RIP_SUCCESS_SECONDS,
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

test('rip: holding F pops the stone along facing; Breath drains', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const breath0 = world.player.stamina;
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 2);

  assert.ok(world.player.stamina < breath0 - 8, `Rip should spend Breath (${world.player.stamina} vs ${breath0})`);
  assert.equal(world.ball.ownerId, null);
  assert.equal(world.player.hasBall, false);
  const dx = world.ball.position.x - field.x;
  const speed = Math.hypot(world.ball.velocity.x, world.ball.velocity.y);
  assert.ok(
    dx > 20 || speed > RIP_POP_SPEED * 0.4,
    `stone should squirt free, dx=${dx.toFixed(1)} speed=${speed.toFixed(0)}`,
  );
  assert.ok(world.ball.velocity.x > 0 || dx > 0, 'pop should favour facing (east)');
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
  assert.ok(dWriggle < d0 - 18, `wriggle should close on the stone (${d0.toFixed(0)} → ${dWriggle.toFixed(0)})`);
  assert.ok(
    dWriggle < dIdle - 10,
    `wriggle should beat standing in the pack (${dWriggle.toFixed(0)} vs idle ${dIdle.toFixed(0)})`,
  );
  assert.ok(d0 - dWriggle < 80, `must not teleport through the scrum (closed ${(d0 - dWriggle).toFixed(0)}px)`);
  assert.ok(burrow.player.stamina < idle.player.stamina - 8, 'Wriggle should cost extra Breath');
});

test('tap: teammateAtPoint hits a nearby mate and ignores empty grass', () => {
  const world = createWorld({ seed: 2 });
  const mate = world.npcs.find((n) => n.team === world.player.team);
  assert.ok(mate);
  assert.equal(teammateAtPoint(world, mate!.position.x + 10, mate!.position.y), mate!.id);
  assert.equal(teammateAtPoint(world, 40, 40), null);
});
