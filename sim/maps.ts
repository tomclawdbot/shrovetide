// sim/maps.ts — town map data + pure-data helpers.
//
// Map is pure data (no logic). Physics + rendering + AI all read from here.
// Adding a new map = adding a new const + exporting it. No code changes needed
// in physics.ts, npc.ts, or anywhere else.
//
// All positions are in sim-space pixels. TICKET 001 used 1200×800 for the v0
// field slice. TICKET 002 used 2400×1600 (~2× viewport). This pass scales
// that town by TOWN_SCALE so millstones sit farther apart (Ashbourne-scale)
// without rewriting the match loop.

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

/** High-street frontage — pubs and shops, not blank boxes. */
export type BuildingKind = 'pub' | 'shop';

export interface Building extends RectZone {
  name: string;
  kind: BuildingKind;
}

export type Obstacle = Building | Circle;

export function isBuilding(o: Obstacle): o is Building {
  return 'kind' in o && 'name' in o;
}

// ---------------------------------------------------------------------------
// Map definition
// ---------------------------------------------------------------------------

/** Parish mill. Down'Ards score at Clifton (west); Up'Ards score at Sturston (east). */
export type MillName = 'Clifton' | 'Sturston';

export const MILL_CLIFTON: MillName = 'Clifton';
export const MILL_STURSTON: MillName = 'Sturston';

export interface GoalMarker {
  /**
   * Defending team for this millstone (home).
   * Team 0 (Up'Ards) defend Clifton and score at Sturston.
   * Team 1 (Down'Ards) defend Sturston and score at Clifton.
   */
  team: 0 | 1;
  position: Vec2Like;
  name: MillName;
}

export interface Bridge extends RectZone {}

export interface TownMap {
  width: number;
  height: number;
  /** Static bodies NPCs / ball / player collide with. Cannot enter. */
  obstacles: Obstacle[];
  /** Players can't enter with or without ball. Ball entering → teleport to nearest legal point. */
  outOfBounds: RectZone[];
  /** Water zone. Slow movement (RIVER_SPEED_MULT) unless on a bridge. */
  river: RectZone;
  /** Walkable segments crossing the river. Fast movement. */
  bridges: Bridge[];
  /**
   * Hedgerows. Walkable at a crawl (HEDGE_SPEED_MULT) — slower than river.
   * Bridges (and any gap left between hedge rects) pierce them for routing.
   */
  hedges: RectZone[];
  /** Two millstones, one per team. */
  goals: GoalMarker[];
  /** "Turn-up" point — where the ball spawns at match start. */
  turnUp: Vec2Like;
}

/** Speed in the river (not on a bridge). */
export const RIVER_SPEED_MULT = 0.5;
/** Speed inside a hedge (not on a bridge). Harder than water. */
export const HEDGE_SPEED_MULT = 0.22;

/**
 * Linear scale vs the TICKET 002 2400×1600 town. Positions, river, bridges,
 * buildings, OOB, and millstones all go through this so the pitch grows
 * without a layout rewrite.
 */
export const TOWN_SCALE = 2;

function sx(n: number): number {
  return n * TOWN_SCALE;
}

function sxy(x: number, y: number): Vec2Like {
  return { x: sx(x), y: sx(y) };
}

function srect(x: number, y: number, w: number, h: number): RectZone {
  return { position: sxy(x, y), width: sx(w), height: sx(h) };
}

/** Buildings move with the parish but do not become fortresses. */
const BUILDING_SIZE = 1.25;
function sbuilding(
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  kind: BuildingKind,
): Building {
  return {
    position: sxy(x, y),
    width: w * BUILDING_SIZE,
    height: h * BUILDING_SIZE,
    name,
    kind,
  };
}

/**
 * Split a horizontal hedge into segments, leaving gaps at `gapXs`
 * (design-space centres) so bridges / lanes can pierce the row.
 */
function hedgeRow(
  y: number,
  height: number,
  x0: number,
  x1: number,
  gapXs: number[],
  gapHalf: number,
): RectZone[] {
  const cuts = [x0];
  for (const gx of gapXs) {
    cuts.push(gx - gapHalf, gx + gapHalf);
  }
  cuts.push(x1);
  const out: RectZone[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const left = cuts[i]!;
    const right = cuts[i + 1]!;
    const w = right - left;
    if (w < 24) continue;
    out.push(srect((left + right) / 2, y, w, height));
  }
  return out;
}

/** Vertical hedge with gaps (design-space), used to clear the river. */
function hedgeCol(
  x: number,
  width: number,
  y0: number,
  y1: number,
  gapYs: number[],
  gapHalf: number,
): RectZone[] {
  const cuts = [y0];
  for (const gy of gapYs) {
    cuts.push(gy - gapHalf, gy + gapHalf);
  }
  cuts.push(y1);
  const out: RectZone[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const top = cuts[i]!;
    const bot = cuts[i + 1]!;
    const h = bot - top;
    if (h < 24) continue;
    out.push(srect(x, (top + bot) / 2, width, h));
  }
  return out;
}

// ---------------------------------------------------------------------------
// ASHBOURNE TOWN (abstracted, 2× the TICKET 002 layout)
//
// Layout is the same as 2400×1600, just farther millstones and more grass
// between turn-up and the stones. Hedges channel north/south through the
// three bridge lanes and east/west along the banks — slower than the river.
//
//   ┌─────────────────────────────────────────────────────────────┐
//   │ [churchyard]          ══ hedge ══             [open field]  │
//   │   OOB                                                       │
//   │      ▲ lane 1                  ▲ lane 3                      │
//   │   ▒▒▒▒┼▒▒▒▒▒▒▒▒▒▒RIVER▒▒▒▒▒▒▒▒▒▒┼▒▒▒▒                       │
//   │      │             ▲ lane 2 (turn-up)          │              │
//   │   ══ hedge ══                                      ══ hedge ═│
//   │              ┌──┐                                             │
//   │              │T │ town core                                   │
//   │              └──┘                                             │
//   │                              [open field]              [memorial]│
//   └─────────────────────────────────────────────────────────────┘
//
//   Up'Ards millstone ◄────────  center  ────────► Down'Ards millstone
//   (team 0, left)                                  (team 1, right)
// ---------------------------------------------------------------------------

const BRIDGE_XS = [400, 1200, 2000];
/** Shoulder past each bridge so a body can run the lane without hedge-crawl. */
const LANE_GAP_HALF = 80;
const RIVER_GAP_HALF = 140;

export const ASHBOURNE_TOWN: TownMap = {
  width: sx(2400),
  height: sx(1600),

  // High street — named Ashbourne pubs/shops. Rectangles the bodies cannot pass.
  // Positions are center-of-rect, in the original 2400×1600 design space.
  // Keep the turn-up corridor and millstone approaches open.
  obstacles: [
    // North of the Henmore: town core / St John Street flavour
    sbuilding(1080, 600, 90, 90, 'The Green Man', 'pub'),
    sbuilding(1220, 560, 110, 70, 'Gingerbread Shop', 'shop'),
    sbuilding(1340, 620, 80, 80, 'The Horns', 'pub'),
    sbuilding(1160, 720, 100, 60, "Smith's Butcher", 'shop'),
    sbuilding(920, 640, 84, 70, 'The George & Dragon', 'pub'),
    sbuilding(1480, 680, 90, 64, 'Station Stores', 'shop'),
    // South of the river (between turn-up bridge and Down'Ards half)
    sbuilding(1080, 1080, 100, 80, 'The Vaults', 'pub'),
    sbuilding(1260, 1140, 90, 90, 'The White Hart', 'pub'),
    sbuilding(1380, 1080, 70, 110, 'Market Hall', 'shop'),
    // Flank inns — readable from a millstone run, not blocking the stones
    sbuilding(600, 1280, 90, 70, 'The Wheel', 'pub'),
    sbuilding(1820, 320, 110, 80, 'The Coach & Horses', 'pub'),
  ],

  // OOB — players & ball physically can't enter (well, ball gets bounced back).
  outOfBounds: [
    // Churchyard (top-left)
    srect(180, 180, 220, 220),
    // Memorial garden (bottom-right)
    srect(2220, 1420, 220, 220),
  ],

  // River — runs roughly horizontal through the middle.
  river: srect(1200, 880, 2400, 120),

  // Bridges — walkable cuts across the river. Fast movement (not slowed).
  bridges: [
    srect(400, 880, 110, 120),
    srect(1200, 880, 110, 120),
    srect(2000, 880, 110, 120),
  ],

  // Hedgerows — thicker crawl than water. Gaps line up with the three bridges
  // so play is channelled, not sealed. Rows sit outside the 0.18–0.46 /
  // 0.62–0.84 placement bands so 17v17 does not spawn inside a crawl.
  hedges: [
    ...hedgeRow(200, 36, 80, 2320, BRIDGE_XS, LANE_GAP_HALF),
    ...hedgeRow(1480, 36, 80, 2080, BRIDGE_XS, LANE_GAP_HALF),
    ...hedgeCol(360, 28, 320, 1460, [880], RIVER_GAP_HALF),
    ...hedgeCol(2080, 28, 320, 1280, [880], RIVER_GAP_HALF),
    // Flank closes — keep the centre turn-up corridor open for kickoff.
    srect(300, 780, 220, 28),
    srect(2100, 780, 220, 28),
    srect(300, 980, 200, 28),
    srect(2100, 980, 200, 28),
  ],

  // Millstones sit on the north bank (river spans design y 820–940), inland
  // of the sideline pad so a body can stand inside GOAL_REACH without wall-clamping.
  // Clifton (west / left) is the Down'Ards scoring mill; Sturston (east / right)
  // is the Up'Ards scoring mill — Ashbourne geography, not a colour invert.
  goals: [
    { team: 0, name: MILL_CLIFTON, position: sxy(140, 790) },
    { team: 1, name: MILL_STURSTON, position: sxy(2260, 790) },
  ],

  turnUp: sxy(1200, 880),
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

/** True iff the point lies inside any hedge rect. */
export function isInHedge(p: Vec2Like, map: TownMap): boolean {
  return map.hedges.some((h) => pointInRect(p, h));
}

/**
 * True iff the point is crawling a hedge (inside a hedge, not on a bridge).
 * Gaps between hedge rects are ordinary grass.
 */
export function isInHedgeSlow(p: Vec2Like, map: TownMap): boolean {
  return isInHedge(p, map) && !isOnBridge(p, map);
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
 * Water, hedges, obstacles, and out-of-bounds are not walkable.
 * Bridges over water (and gaps through hedges) are.
 */
export function isWalkable(p: Vec2Like, map: TownMap): boolean {
  if (!isInMapBounds(p, map)) return false;
  if (isInObstacle(p, map)) return false;
  if (isOutOfBounds(p, map)) return false;
  if (isInWater(p, map)) return false;
  if (isInHedgeSlow(p, map)) return false;
  return true;
}

/**
 * Speed multiplier for a point — hedge crawl, then river, else open.
 * Hedge is strictly slower than water. Bridges cancel both.
 */
export function speedMultiplierAt(p: Vec2Like, map: TownMap): number {
  let mult = 1;
  if (isInWater(p, map)) mult = Math.min(mult, RIVER_SPEED_MULT);
  if (isInHedgeSlow(p, map)) mult = Math.min(mult, HEDGE_SPEED_MULT);
  return mult;
}

/** Home millstone for a given team (the one they defend). */
export function goalMarkerFor(team: 0 | 1, map: TownMap): GoalMarker {
  const g = map.goals.find((m) => m.team === team);
  if (!g) throw new Error(`No goal for team ${team}`);
  return g;
}

/** Goal position for a given team (home / defend). */
export function goalFor(team: 0 | 1, map: TownMap): Vec2Like {
  return goalMarkerFor(team, map).position;
}

/**
 * Millstone this team tries to goal at.
 * Up'Ards (0) → Sturston (east). Down'Ards (1) → Clifton (west).
 */
export function scoringGoalMarker(team: 0 | 1, map: TownMap): GoalMarker {
  return goalMarkerFor(team === 0 ? 1 : 0, map);
}

/** Opposite team's goal — the one a carrier can score on. */
export function opponentGoalFor(team: 0 | 1, map: TownMap): Vec2Like {
  return scoringGoalMarker(team, map).position;
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
