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

/**
 * High-street frontage plus civic massing.
 * `id` is the stable art key — Game Art can swap a sprite without moving the footprint.
 */
export type BuildingKind = 'pub' | 'shop' | 'church' | 'school' | 'market' | 'hall' | 'trailhead';

export const CIVIC_KINDS: readonly BuildingKind[] = [
  'church',
  'school',
  'market',
  'hall',
  'trailhead',
];

export interface Building extends RectZone {
  name: string;
  kind: BuildingKind;
  /** Stable slug for later landmark sprites. Layout stays; art keys off this. */
  id: string;
}

/** Labeled place — render / art swap. Collision lives on OOB or a matching Building. */
export type PlaceKind = 'brook' | 'plaza' | 'trail' | 'tunnel' | 'inn-sign';

export interface PlaceMark {
  id: string;
  kind: PlaceKind;
  name: string;
  position: Vec2Like;
}

export type Obstacle = Building | Circle;

export function isBuilding(o: Obstacle): o is Building {
  return 'kind' in o && 'name' in o;
}

export function isCivicBuilding(o: Obstacle): o is Building {
  return isBuilding(o) && CIVIC_KINDS.includes(o.kind);
}

/** Homage slug — art key, not a trademark or street address. */
export function landmarkId(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

/** Town street, millstone-approach track, or former-railway trail. Visual — not collision. */
export type RoadKind = 'street' | 'lane' | 'trail';

/** Soft winding strip — polyline of short segments, not an axis-aligned slab. */
export interface RoadSegment {
  kind: RoadKind;
  /** Full width of the strip in sim px. */
  width: number;
  /** Vertices in sim space. */
  points: Vec2Like[];
}

/** Lamp post along a road. Client lights the lantern at dusk / Nightfall. */
export interface StreetLight {
  position: Vec2Like;
}

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
  /**
   * Soft paths between buildings and out to the millstones.
   * Not collision — hug / fields / Henmore stay playable off the tarmac.
   */
  roads: RoadSegment[];
  /** Lamp posts on the road network. Render-only; glow is a client Nightfall hook. */
  streetLights: StreetLight[];
  /**
   * Named places that orient the town (brook, plaza, trail, tunnel).
   * Labels + massing in the client; art swap keys off `id`. Not collision.
   */
  places: PlaceMark[];
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
/** Civic massing reads from a screenshot without walling off hug routes. */
const LANDMARK_SIZE = 1.65;
function sbuilding(
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  kind: BuildingKind,
): Building {
  return {
    id: landmarkId(name),
    position: sxy(x, y),
    width: w * BUILDING_SIZE,
    height: h * BUILDING_SIZE,
    name,
    kind,
  };
}

function slandmark(
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  kind: BuildingKind,
): Building {
  return {
    id: landmarkId(name),
    position: sxy(x, y),
    width: w * LANDMARK_SIZE,
    height: h * LANDMARK_SIZE,
    name,
    kind,
  };
}

function smark(x: number, y: number, name: string, kind: PlaceKind): PlaceMark {
  return { id: landmarkId(name), kind, name, position: sxy(x, y) };
}

function slight(x: number, y: number): StreetLight {
  return { position: sxy(x, y) };
}

/** Chaikin corner-cut — turns a few waypoints into a windy UK lane. */
function chaikin(pts: Vec2Like[], rounds: number): Vec2Like[] {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    if (cur.length < 2) break;
    const next: Vec2Like[] = [{ x: cur[0]!.x, y: cur[0]!.y }];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    next.push({ x: cur[cur.length - 1]!.x, y: cur[cur.length - 1]!.y });
    cur = next;
  }
  return cur;
}

function sroad(
  kind: RoadKind,
  width: number,
  waypoints: ReadonlyArray<readonly [number, number]>,
  smooth = 2,
): RoadSegment {
  return {
    kind,
    width: sx(width),
    points: chaikin(
      waypoints.map(([x, y]) => sxy(x, y)),
      smooth,
    ),
  };
}

/** Distance from `p` to the closest point on segment `a`–`b`. */
export function distToSegment(p: Vec2Like, a: Vec2Like, b: Vec2Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the nearest road centreline. */
export function distanceToRoad(p: Vec2Like, map: TownMap): number {
  let best = Infinity;
  for (const r of map.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegment(p, r.points[i]!, r.points[i + 1]!);
      if (d < best) best = d;
    }
  }
  return best;
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
//   │ [St Oswald's] ══ hedge ══  [Old Grammar]   [Trail / Tunnel] │
//   │   churchyard                                                │
//   │      ▲ lane 1                  ▲ lane 3                      │
//   │   ▒▒▒▒┼▒▒▒▒ HENMORE BROOK ▒▒▒▒▒▒┼▒▒▒▒                       │
//   │      │             ▲ lane 2 (turn-up)          │              │
//   │   ══ hedge ══                                      ══ hedge ═│
//   │              ┌──┐  Green Man / high street                    │
//   │              │T │  Market Place / Town Hall (south)           │
//   │              └──┘                                             │
//   │                              [open field]              [memorial]│
//   └─────────────────────────────────────────────────────────────┘
//
//   Clifton (Down score, west) ◄── Henmore ──► Sturston (Up score, east)
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
    slandmark(1380, 1080, 78, 112, 'Market Hall', 'market'),
    slandmark(1464, 1088, 72, 86, 'Town Hall', 'hall'),
    // Flank inns — readable from a millstone run, not blocking the stones
    sbuilding(600, 1280, 90, 70, 'The Wheel', 'pub'),
    sbuilding(1820, 320, 110, 80, 'The Coach & Horses', 'pub'),
    // Civic landmarks — homage names, not crests or street addresses.
    slandmark(250, 360, 118, 86, "St Oswald's", 'church'),
    slandmark(740, 400, 150, 72, 'Old Grammar', 'school'),
    slandmark(1654, 228, 78, 64, 'The Baths', 'trailhead'),
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
    ...hedgeRow(200, 36, 80, 2320, [...BRIDGE_XS, 1680], LANE_GAP_HALF),
    ...hedgeRow(1480, 36, 80, 2080, BRIDGE_XS, LANE_GAP_HALF),
    // Starts south of the church/school lanes so those stubs are not a hedge crawl.
    ...hedgeCol(360, 28, 600, 1460, [880], RIVER_GAP_HALF),
    ...hedgeCol(2080, 28, 320, 1280, [880], RIVER_GAP_HALF),
    // Goal approaches — hedges flank the millstone lanes, clear of the stones.
    srect(355, 754, 270, 22),
    srect(355, 826, 270, 18),
    srect(2045, 754, 270, 22),
    srect(2045, 826, 270, 18),
    // South-bank channeling — keep the centre turn-up corridor open for kickoff.
    srect(300, 980, 200, 28),
    srect(2100, 980, 200, 28),
  ],

  // Winding market-town lanes. Pubs/shops ↔ bridges ↔ millstones ↔ turn-up.
  // Soft — no collision. Hedge-flanked approaches stay straight so the stones read.
  roads: [
    // St John flavour — north high street through the pubs, hook at Gingerbread.
    sroad('street', 48, [
      [900, 680],
      [1000, 648],
      [1080, 658],
      [1160, 672],
      [1200, 660],
      [1224, 598],
      [1288, 638],
      [1348, 668],
      [1420, 692],
      [1500, 708],
    ]),
    // Butcher yard down to the turn-up bridge.
    sroad('street', 44, [
      [1160, 672],
      [1168, 736],
      [1192, 808],
      [1200, 868],
    ]),
    // Centre bridge deck — high street meets south market at the plinth.
    sroad('street', 46, [
      [1200, 848],
      [1200, 880],
      [1200, 912],
    ], 0),
    // South market — Vaults, White Hart, Market Hall.
    sroad('street', 48, [
      [1040, 1098],
      [1140, 1122],
      [1230, 1110],
      [1272, 1160],
      [1348, 1124],
      [1408, 1094],
    ]),
    // South market up to the turn-up bridge.
    sroad('street', 44, [
      [1230, 1110],
      [1208, 1036],
      [1214, 978],
      [1200, 918],
    ]),
    // Clifton millstone → west bridge (hedge corridor — keep straight).
    sroad('lane', 48, [
      [150, 790],
      [250, 790],
      [320, 790],
      [400, 790],
      [400, 880],
    ], 0),
    // West bridge up into the high street at the George.
    sroad('lane', 42, [
      [400, 848],
      [508, 758],
      [668, 712],
      [808, 692],
      [900, 680],
    ]),
    // West bridge down to The Wheel.
    sroad('lane', 42, [
      [400, 912],
      [458, 1024],
      [528, 1148],
      [584, 1244],
      [600, 1280],
    ]),
    // The Wheel along to the south market.
    sroad('lane', 42, [
      [600, 1280],
      [728, 1222],
      [888, 1158],
      [1040, 1098],
    ]),
    // Sturston millstone → east bridge (hedge corridor — keep straight).
    sroad('lane', 48, [
      [2250, 790],
      [2168, 790],
      [2080, 790],
      [2000, 790],
      [2000, 880],
    ], 0),
    // Coach & Horses down to Station Stores (no stub into empty grass).
    sroad('lane', 42, [
      [1820, 338],
      [1764, 418],
      [1684, 528],
      [1584, 628],
      [1500, 708],
    ]),
    // Station Stores along to the east bridge / Sturston approach.
    sroad('lane', 42, [
      [1500, 708],
      [1624, 724],
      [1768, 756],
      [1912, 778],
      [2000, 828],
      [2000, 880],
    ]),
    // Church gate — west-bridge lane up to St Oswald's (stops short of the yard).
    sroad('lane', 36, [
      [508, 758],
      [400, 580],
      [300, 440],
      [250, 380],
    ]),
    // Old Grammar — north off the George / west-bridge lane.
    sroad('lane', 36, [
      [668, 712],
      [710, 540],
      [740, 420],
    ]),
    // Tissington Trail — former railway cutting, joins the Coach lane.
    sroad('trail', 34, [
      [1630, 48],
      [1650, 140],
      [1688, 240],
      [1740, 340],
      [1764, 418],
    ]),
    // Market Place east — Town Hall fronts the same square as Market Hall.
    sroad('street', 40, [
      [1408, 1094],
      [1464, 1088],
    ], 0),
  ],

  // Verge lamps — sit on the new lanes, not in the Henmore, not on the stones.
  streetLights: [
    slight(900, 700),
    slight(1080, 678),
    slight(1210, 640),
    slight(1348, 688),
    slight(1488, 728),
    slight(1180, 760),
    slight(1220, 828),
    slight(1060, 1118),
    slight(1236, 1132),
    slight(1388, 1112),
    slight(1210, 1020),
    slight(280, 766),
    slight(400, 766),
    slight(520, 742),
    slight(760, 704),
    slight(460, 1028),
    slight(568, 1212),
    slight(792, 1196),
    slight(2200, 766),
    slight(2000, 766),
    slight(1788, 380),
    slight(1688, 536),
    slight(1704, 740),
    slight(1916, 792),
    slight(1200, 808),
    slight(1200, 952),
    slight(428, 968),
    slight(360, 540),
    slight(268, 400),
    slight(708, 548),
    slight(736, 428),
    slight(1660, 160),
    slight(1728, 320),
    slight(1460, 1096),
  ],

  places: [
    smark(720, 818, 'Henmore Brook', 'brook'),
    smark(1288, 1104, 'Market Place', 'plaza'),
    smark(1708, 168, 'Tissington Trail', 'trail'),
    smark(1630, 52, 'The Tunnel', 'tunnel'),
    smark(1080, 600, 'Green Man', 'inn-sign'),
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

/** True iff the point sits on a road strip. Roads do not block or slow. */
export function isOnRoad(p: Vec2Like, map: TownMap): boolean {
  for (const r of map.roads) {
    const half = r.width / 2;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegment(p, r.points[i]!, r.points[i + 1]!) <= half) return true;
    }
  }
  return false;
}

/** True iff the point is on or within `pad` px of a road (verge lamps). */
export function isNearRoad(p: Vec2Like, map: TownMap, pad = 24): boolean {
  for (const r of map.roads) {
    const reach = r.width / 2 + pad;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegment(p, r.points[i]!, r.points[i + 1]!) <= reach) return true;
    }
  }
  return false;
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
