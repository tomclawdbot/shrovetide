import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveKickAim, shouldCommitAim, stickVector } from '../client/touch.js';
import { allowsPageScroll, readVisibleBox } from '../client/shell.js';

test('stick: rest at origin, full tilt matches WASD magnitude 1', () => {
  assert.deepEqual(stickVector(0, 0), { x: 0, y: 0 });
  const east = stickVector(56, 0, 56);
  assert.equal(east.x, 1);
  assert.equal(east.y, 0);
  const south = stickVector(0, 56, 56);
  assert.equal(south.x, 0);
  assert.equal(south.y, 1);
});

test('stick: beyond the well still clamps to 1', () => {
  const v = stickVector(200, 0, 56);
  assert.ok(Math.abs(v.x - 1) < 1e-9);
  assert.equal(v.y, 0);
});

test('stick: diagonal is normalized, not 1.41', () => {
  const v = stickVector(56, 56, 56);
  const mag = Math.hypot(v.x, v.y);
  assert.ok(Math.abs(mag - 1) < 1e-9);
  assert.ok(v.x > 0.7 && v.y > 0.7);
});

test('stick: half tilt is analog (sim applies the WASD damping)', () => {
  const v = stickVector(28, 0, 56);
  assert.ok(Math.abs(v.x - 0.5) < 1e-9);
  assert.equal(v.y, 0);
});

test('kick aim: live stick above deadzone wins', () => {
  const aim = resolveKickAim({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
  assert.ok(Math.abs(aim.x - 1) < 1e-9);
  assert.ok(Math.abs(aim.y) < 1e-9);
});

test('kick aim: stick recenter noise does not overwrite last committed aim', () => {
  assert.equal(shouldCommitAim({ x: 0.04, y: -0.02 }), false);
  const aim = resolveKickAim({ x: 0.04, y: -0.02 }, { x: 1, y: 0 }, { x: -1, y: 0 });
  assert.ok(aim.x > 0.99 && Math.abs(aim.y) < 0.01, `recenter must keep last east aim, got ${aim.x},${aim.y}`);
});

test('kick aim: idle stick falls back to facing (Down Ards west)', () => {
  const aim = resolveKickAim({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 });
  assert.ok(aim.x < -0.99 && Math.abs(aim.y) < 0.01);
});

test('visible box: falls back to inner size when visualViewport is missing', () => {
  assert.deepEqual(readVisibleBox(null, 844, 390), { left: 0, top: 0, width: 844, height: 390 });
});

test('visible box: Chrome iOS toolbar shrinks height and offsets top', () => {
  const box = readVisibleBox({ offsetLeft: 0, offsetTop: 48, width: 844, height: 300 }, 844, 390);
  assert.equal(box.top, 48);
  assert.equal(box.height, 300);
  assert.equal(box.width, 844);
});

test('scroll allow: title menu opt-in unlocks pan; everything else stays locked', () => {
  assert.equal(allowsPageScroll(null), false);
  assert.equal(
    allowsPageScroll({
      closest: (_sel: string) => null,
    } as unknown as EventTarget),
    false,
  );
  const scrollRegion = { id: 'team-pick-scroll' };
  assert.equal(
    allowsPageScroll({
      closest: (sel: string) => (sel === '[data-allow-scroll]' ? scrollRegion : null),
    } as unknown as EventTarget),
    true,
  );
});
