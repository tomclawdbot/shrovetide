// test/difficulty.hug.test.ts — difficulty presets + hug zone disband.

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  createWorld,
  difficultyTuning,
  EXHAUSTED_SPEED_MULT,
  hugShoveAt,
  hugShoveAuthority,
  isInHugZone,
  npcSpeedCap,
  PLAYER_MAX_SPEED,
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

test('difficulty: hard opponents are faster and rip quicker than easy', () => {
  const easy = createWorld({ seed: 2, playerTeam: 0, difficulty: 'easy' });
  const hard = createWorld({ seed: 2, playerTeam: 0, difficulty: 'hard' });
  startMatch(easy);
  startMatch(hard);
  const easyOpp = easy.npcs.find((n) => n.team === 1 && n.role === 'chase')!;
  const hardOpp = hard.npcs.find((n) => n.team === 1 && n.role === 'chase')!;
  easy.ball.ownerId = null;
  hard.ball.ownerId = null;
  const mid = { x: easy.map.width * 0.5, y: easy.map.height * 0.82 };
  teleportId(easy, easyOpp.id, mid.x, mid.y);
  teleportId(hard, hardOpp.id, mid.x, mid.y);
  Matter.Body.setPosition(easy.physics.ballBody, { x: mid.x + 40, y: mid.y });
  Matter.Body.setPosition(hard.physics.ballBody, { x: mid.x + 40, y: mid.y });
  easy.ball.position = { x: mid.x + 40, y: mid.y };
  hard.ball.position = { x: mid.x + 40, y: mid.y };

  const easyCap = npcSpeedCap(easyOpp, easy);
  const hardCap = npcSpeedCap(hardOpp, hard);
  assert.ok(hardCap > easyCap + 20, `hard ${hardCap.toFixed(0)} should beat easy ${easyCap.toFixed(0)}`);
  assert.ok(
    difficultyTuning('hard').opponentRipSeconds < difficultyTuning('easy').opponentRipSeconds,
  );
  assert.equal(easy.difficulty, 'easy');
  assert.equal(hard.difficulty, 'hard');
});

test('npc: empty-handed open-field cap matches player walk on normal', () => {
  const world = createWorld({ seed: 3, playerTeam: 0, difficulty: 'normal' });
  startMatch(world);
  const ally = world.npcs.find((n) => n.team === 0)!;
  const mid = { x: world.map.width * 0.5, y: world.map.height * 0.82 };
  teleportId(world, ally.id, mid.x, mid.y);
  // Owned ball far away so this body is not loose-bursting.
  world.ball.ownerId = world.player.id;
  world.player.hasBall = true;
  Matter.Body.setPosition(world.physics.ballBody, { x: 200, y: 200 });
  world.ball.position = { x: 200, y: 200 };
  teleportId(world, world.player.id, 200, 200);
  const cap = npcSpeedCap(ally, world);
  assert.ok(
    Math.abs(cap - PLAYER_MAX_SPEED) < 1,
    `ally walk should match player walk (${cap.toFixed(1)} vs ${PLAYER_MAX_SPEED})`,
  );
});

test('hug: pack shove only applies near the stone; clears once the ball breaks away', () => {
  const world = createWorld({ seed: 4, playerTeam: 0 });
  startMatch(world);
  const field = { x: world.map.width * 0.7, y: world.map.height * 0.82 };
  const huddle = { x: field.x, y: field.y };
  teleportId(world, world.player.id, huddle.x, huddle.y);
  const near = world.npcs.slice(0, 6);
  near.forEach((n, i) => {
    const a = (i / near.length) * Math.PI * 2;
    teleportId(world, n.id, huddle.x + Math.cos(a) * 28, huddle.y + Math.sin(a) * 28);
  });
  Matter.Body.setPosition(world.physics.ballBody, { x: huddle.x, y: huddle.y });
  world.ball.position = { x: huddle.x, y: huddle.y };
  world.ball.ownerId = null;

  assert.equal(isInHugZone(world, world.player.position), true);
  const packed = hugShoveAt(world, world.player.id, world.player.position);
  assert.ok(packed < 0.5, `on-stone pack should crawl, shove=${packed.toFixed(2)}`);

  // Ball pops clear of the old huddle — leftover bodies regain full shove.
  Matter.Body.setPosition(world.physics.ballBody, { x: huddle.x + 220, y: huddle.y });
  world.ball.position = { x: huddle.x + 220, y: huddle.y };
  assert.equal(isInHugZone(world, world.player.position), false);
  assert.equal(hugShoveAt(world, world.player.id, world.player.position), 1);
  assert.ok(hugShoveAuthority(6) < 0.3, 'raw pack math still crawls; zone gate is what frees them');
});

test('feel: Rip hold is long enough that a hug can grind before the pop', () => {
  assert.ok(RIP_SUCCESS_SECONDS >= 0.9, `Rip should take ~1s, got ${RIP_SUCCESS_SECONDS}`);
});

test('feel: spent Breath is a crawl, not a jog', () => {
  assert.ok(EXHAUSTED_SPEED_MULT <= 0.4, `exhausted mult ${EXHAUSTED_SPEED_MULT}`);
  const world = createWorld({ seed: 5 });
  startMatch(world);
  world.player.stamina = 0;
  const east: Input = { ...IDLE, move: { x: 1, y: 0 } };
  const x0 = world.player.position.x;
  for (let i = 0; i < 60; i++) stepWorld(world, east, 1 / 60);
  const dx = world.player.position.x - x0;
  assert.ok(
    dx < PLAYER_MAX_SPEED * 0.45,
    `0 Breath should crawl (~${(PLAYER_MAX_SPEED * EXHAUSTED_SPEED_MULT).toFixed(0)} px/s), got ${dx.toFixed(0)} px in 1s`,
  );
});
