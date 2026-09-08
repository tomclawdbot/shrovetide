// test/breakaway.test.ts — post-Rip / post-kick loose-stone window.
// After a player Rip or kick the stone must stay clear of opposing pickup
// long enough to chase (~1.5s), then reclaim is still possible if you dawdle.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  createWorld,
  groundBall,
  isOpposingPickupBlocked,
  pickupReach,
  PLAYER_RELEASE_OPP_PICKUP_TICKS,
  releasePass,
  RIP_SUCCESS_SECONDS,
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

function openField(world: World): { x: number; y: number } {
  return { x: world.map.width * 0.70, y: world.map.height * 0.82 };
}

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
  groundBall(world);

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

/** Park player + teammates far; pin opposing chase on the loose stone. */
function pinOpposingChaseOnBall(world: World, count = 2): string[] {
  const { x, y } = world.ball.position;
  teleportId(world, world.player.id, x + 420, y + 80);
  world._controlVel.x = 0;
  world._controlVel.y = 0;

  const pinned: string[] = [];
  for (const npc of world.npcs) {
    if (npc.team === world.player.team) {
      teleportId(world, npc.id, 80, 80);
      continue;
    }
    if (npc.role !== 'chase') {
      teleportId(world, npc.id, 120, 400);
      continue;
    }
    if (pinned.length < count) {
      const angle = (pinned.length / count) * Math.PI * 2;
      teleportId(world, npc.id, x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
      pinned.push(npc.id);
    } else {
      teleportId(world, npc.id, 80, 220 + pinned.length * 20);
    }
  }
  return pinned;
}

function opposingOwner(world: World): boolean {
  const id = world.ball.ownerId;
  if (id === null || id === world.player.id) return false;
  const npc = world.npcs.find((n) => n.id === id);
  return npc !== undefined && npc.team !== world.player.team;
}

function unownedTicksWhilePinned(world: World, ticks: number): number {
  let free = 0;
  for (let i = 0; i < ticks; i++) {
    const pinned = world.npcs.filter((n) => n.team !== world.player.team && n.role === 'chase').slice(0, 2);
    for (const npc of pinned) {
      const reach = pickupReach(npc.radius, world.ball.radius);
      const d = Math.hypot(world.ball.position.x - npc.position.x, world.ball.position.y - npc.position.y);
      if (d > reach * 0.6) {
        teleportId(world, npc.id, world.ball.position.x, world.ball.position.y);
      }
    }
    stepWorld(world, IDLE, 1 / 60);
    if (world.ball.ownerId === null) free += 1;
    else break;
  }
  return free;
}

test('breakaway: after player Rip, opposing chase cannot claim for ~1.6s', () => {
  const world = createWorld({ seed: 4 });
  startMatch(world);
  const field = openField(world);
  packHug(world, field.x, field.y, 8);
  const rip: Input = { ...IDLE, rip: true, wriggle: true, move: { x: 1, y: 0 } };
  runTicks(world, rip, Math.ceil(RIP_SUCCESS_SECONDS * 60) + 2);

  assert.equal(world.ball.ownerId, null, 'Rip must pop the stone free');
  assert.equal(isOpposingPickupBlocked(world), true, 'player Rip starts the breakaway window');

  const pinned = pinOpposingChaseOnBall(world);
  assert.ok(pinned.length >= 2, 'need opposing chase on the stone');

  const windowLeft = world._oppPickupBlockedUntilTick - world.tick;
  assert.ok(windowLeft >= PLAYER_RELEASE_OPP_PICKUP_TICKS - 4, `window should still be ~1.6s (left=${windowLeft})`);

  const free = unownedTicksWhilePinned(world, windowLeft);
  assert.ok(
    free >= windowLeft,
    `stone must stay unowned of opposing pickup for the window (free=${free} need=${windowLeft})`,
  );
  assert.equal(world.ball.ownerId, null);
  assert.equal(world.player.hasBall, false);
});

test('breakaway: after player kick, opposing chase cannot claim for ~1.6s', () => {
  const world = createWorld({ seed: 11 });
  startMatch(world);
  const field = openField(world);
  teleportId(world, world.player.id, field.x, field.y);
  world._controlVel.x = 0;
  world._controlVel.y = 0;
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  Matter.Body.setPosition(world.physics.ballBody, { x: field.x, y: field.y });
  world.ball.position = { x: field.x, y: field.y };
  groundBall(world);

  assert.equal(releasePass(world, { x: 1, y: 0 }, 0.8), true);
  assert.equal(world.ball.ownerId, null);
  assert.equal(isOpposingPickupBlocked(world), true, 'player kick starts the breakaway window');

  const pinned = pinOpposingChaseOnBall(world);
  assert.ok(pinned.length >= 2, 'need opposing chase on the kicked stone');

  const windowLeft = world._oppPickupBlockedUntilTick - world.tick;
  const free = unownedTicksWhilePinned(world, windowLeft);
  assert.ok(
    free >= windowLeft,
    `kicked stone must stay clear of opposing pickup (free=${free} need=${windowLeft})`,
  );
  assert.equal(world.ball.ownerId, null);
  assert.equal(opposingOwner(world), false);
});

test('breakaway: opposing chase can reclaim after the window if the player dawdles', () => {
  const world = createWorld({ seed: 11 });
  startMatch(world);
  const field = openField(world);
  teleportId(world, world.player.id, field.x, field.y);
  world.player.hasBall = true;
  world.ball.ownerId = world.player.id;
  Matter.Body.setPosition(world.physics.ballBody, { x: field.x, y: field.y });
  world.ball.position = { x: field.x, y: field.y };
  groundBall(world);

  assert.equal(releasePass(world, { x: 1, y: 0 }, 0.8), true);
  pinOpposingChaseOnBall(world);

  const windowLeft = world._oppPickupBlockedUntilTick - world.tick;
  const free = unownedTicksWhilePinned(world, windowLeft);
  assert.ok(free >= windowLeft, 'window must hold before reclaim');
  assert.equal(isOpposingPickupBlocked(world), false);

  const after = unownedTicksWhilePinned(world, 8);
  assert.ok(after < 8, `dawdling must allow opposing reclaim (unowned ${after} more ticks)`);
  assert.equal(opposingOwner(world), true, 'an opposing chase should claim once the window ends');
});
