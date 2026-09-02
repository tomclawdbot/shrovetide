// sim/maps.ts — town map data + pure-data helpers.
//
// Map is pure data (no logic). Physics + rendering + AI all read from here.
// Adding a new map = adding a new const + exporting it. No code changes needed
// in physics.ts, npc.ts, or anywhere else.
//
// All positions are in sim-space pixels. TICKET 001 used 1200×800 for the v0
// field slice. TICKET 002 scales up to 2400×1600 (~2× viewport) so the camera
// has room to follow the controlled player around a real town.

// ---------------------------------------------------------------------------
// Shape primitives
// ---------------------------------------------------------------------------

export interface Vec2Like {
  x: number;
  y: number;
}

export interface RectZone {
  /** Center of the rect. */
  position: Vec2Like;
  /** Full width. */
  width: number;
  /** Full height. */
  height: number;
}

export interface Circle {
  position: Vec2Like;
  radius: number;
}

export type Obstacle = RectZone | Circle;

// ---------------------------------------------------------------------------
// Map definition
// ---------------------------------------------------------------------------

export interface GoalMarker {
  team: 0 | 1;
  position: Vec2Like;
}

export interface Bridge extends RectZone {}

export interface TownMap {
  width: number;
  height: number;
  /** Static bodies NPCs / ball / player collide with. Cannot enter. */
  obstacles: Obstacle[];
  /** Players can't enter with or without ball. Ball entering → teleport to nearest legal point. */
  outOfBounds: RectZone[];
  /** Water zone. Slow movement (50%) unless on a bridge. */
  river: RectZone;
  /** Walkable segments crossing the river. Fast movement. */
  bridges: Bridge[];
  /** Two millstones, one per team. */
  goals: GoalMarker[];
  /** "Turn-up" point — where the ball spawns at match start. */
  turnUp: Vec2Like;
}

// ---------------------------------------------------------------------------
// ASHBOURNE TOWN (abstracted, not to scale)
//
// Layout (looking down):
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ [churchyard]                                  [open field]  │
//   │   OOB                                          ▒▒▒▒▒▒▒       │
//   │                                                             │
//   │      ▲ bridge 1                  ▲ bridge 3                  │
//   │   ▒▒▒▒┼▒▒▒▒▒▒▒▒▒▒RIVER▒▒▒▒▒▒▒▒▒▒┼▒▒▒▒                       │
//   │      │             ▲ bridge 2 (turn-up)        │              │
//   │                                                             │
//   │   ▒▒▒▒ open field ▒▒▒                                          │
//   │              ┌──┐                                             │
//   │              │T │ town core                                   │
//   │              │C │ (buildings as obstacles)                     │
//   │              └──┘                                             │
//   │                                                             │
//   │                              [open field]              [memorial]│
//   │                                          ▒▒▒▒▒▒▒        OOB  │
//   └─────────────────────────────────────────────────────────────┘
//
//   Up'Ards millstone ◄────────  center  ────────► Down'Ards millstone
//   (team 0, left)                                  (team 1, right)
// ---------------------------------------------------------------------------

export const ASHBOURNE_TOWN: TownMap = {
  width: 2400,
  height: 1600,

  // Town core buildings — rectangles the NPCs / player / ball cannot pass.
  // Positions are center-of-rect.
  obstacles: [
    // Cluster north of river, around town center
    { position: { x: 1080, y: 600 }, width: 90, height: 90 },
    { position: { x: 1220, y: 560 }, width: 110, height: 70 },
    { position: { x: 1340, y: 620 }, width: 80, height: 80 },
    { position: { x: 1160, y: 720 }, width: 100, height: 60 },
    // Cluster south of river (between turn-up bridge and Down'Ards half)
    { position: { x: 1080, y: 1080 }, width: 100, height: 80 },
    { position: { x: 1260, y: 1140 }, width: 90, height: 90 },
    { position: { x: 1380, y: 1080 }, width: 70, height: 110 },
    // A couple out on the open flanks
    { position: { x: 600, y: 1280 }, width: 90, height: 70 },
    { position: { x: 1820, y: 320 }, width: 110, height: 80 },
  ],

  // OOB — players & ball physically can't enter (well, ball gets bounced back).
  outOfBounds: [
    // Churchyard (top-left)
    { position: { x: 180, y: 180 }, width: 220, height: 220 },
    // Memorial garden (bottom-right)
    { position: { x: 2220, y: 1420 }, width: 220, height: 220 },
  ],

  // River — runs roughly horizontal through the middle.
  river: { position: { x: 1200, y: 880 }, width: 2400, height: 120 },

  // Bridges — walkable cuts across the river. Fast movement (not slowed).
  bridges: [
    { position: { x: 400, y: 880 }, width: 110, height: 120 },
    { position: { x: 1200, y: 880 }, width: 110, height: 120 },
    { position: { x: 2000, y: 880 }, width: 110, height: 120 },
  ],

  goals: [
    { team: 0, position: { x: 90, y: 880 } },
    { team: 1, position: { x: 2310, y: 880 } },
  ],

  turnUp: { x: 1200, y: 880 },
};

// ---------------------------------------------------------------------------
// Zone helpers — — used by physics + AI + UI.
// ---------------------------------------------------------------------------

/** Point-in-rectangle test (inclusive bounds). */
export function pointInRect(p: Vec2Like, r: RectZone): boolean {
  return (
    p.x >= r.position.x - r.width / 2 &&
    p.x <= r.position.x + r.width / 2 &&
    p.y >= r.position.y - r.height / 2 &&
    p.y <= r.position.y + r.height / 2
  );
}

/** Point-in-circle test. */
export function pointInCircle(p: Vec2Like, c: Circle): boolean {
  const dx = p.x - c.position.x;
  const dy = p.y - c.position.y;
  return dx * dx + dy * dy <= c.radius * c.radius;
}

/** True iff the point lies inside any obstacle in the map. */
export function isInObstacle(p: Vec2Like, map: TownMap): boolean {
  for (const o of map.obstacles) {
    if ('radius' in o) {
      if (pointInCircle(p, o)) return true;
    } else {
      if (pointInRect(p, o)) return true;
    }
  }
  return false;
}

/** True iff the point lies in the river (any rect — currently one). */
export function isInRiver(p: Vec2Like, map: TownMap): boolean {
  return pointInRect(p, map.river);
}

/** True iff the point lies on any bridge. */
export function isOnBridge(p: Vec2Like, map: TownMap): boolean {
  return map.bridges.some((b) => pointInRect(p, b));
}

/** True iff the point is in water (river but not on a bridge). */
export function isInWater(p: Vec2Like, map: TownMap): boolean {
  return isInRiver(p, map) && !isOnBridge(p, map);
}

/** True iff the point lies in any out-of-bounds zone. */
export function isOutOfBounds(p: Vec2Like, map: TownMap): boolean {
  return map.outOfBounds.some((z) => pointInRect(p, z));
}

/** True iff the point is inside the map rectangle. */
export function isInMapBounds(p: Vec2Like, map: TownMap): boolean {
  return p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height;
}

/**
 * True iff the point is walkable for a player/NPC body.
 * Water, obstacles, and out-of-bounds are not walkable. Bridges over water are.
 */
export function isWalkable(p: Vec2Like, map: TownMap): boolean {
  if (!isInMapBounds(p, map)) return false;
  if (isInObstacle(p, map)) return false;
  if (isOutOfBounds(p, map)) return false;
  if (isInWater(p, map)) return false;
  return true;
}

/** Speed multiplier for a point — 0.5 in water, 1.0 elsewhere. */
export function speedMultiplierAt(p: Vec2Like, map: TownMap): number {
  return isInWater(p, map) ? 0.5 : 1.0;
}

/** Goal position for a given team. */
export function goalFor(team: 0 | 1, map: TownMap): Vec2Like {
  const g = map.goals.find((m) => m.team === team);
  if (!g) throw new Error(`No goal for team ${team}`);
  return g.position;
}

/** Opposite team's goal — the one a carrier can score on. */
export function opponentGoalFor(team: 0 | 1, map: TownMap): Vec2Like {
  return goalFor(team === 0 ? 1 : 0, map);
}

/**
 * Find the nearest legal (walkable) point to `from`. Used when the ball
 * enters out-of-bounds and needs to be teleported back. Walks outward from
 * `from` in expanding rings of 8px until it finds a walkable point.
 */
export function nearestLegalPoint(from: Vec2Like, map: TownMap): Vec2Like {
  if (isWalkable(from, map)) return from;
  const STEP = 8;
  const MAX_RADIUS_STEPS = 200;
  for (let r = 1; r <= MAX_RADIUS_STEPS; r++) {
    const radius = r * STEP;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const x = from.x + Math.cos(angle) * radius;
      const y = from.y + Math.sin(angle) * radius;
      if (isInMapBounds({ x, y }, map) && isWalkable({ x, y }, map)) {
        return { x, y };
      }
    }
  }
  return map.turnUp;
}