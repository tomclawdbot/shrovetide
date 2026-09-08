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

export const CIVIC_KINDS = [
  'church',
  'school',
  'market',
  'hall',
  'trailhead',
] as const satisfies readonly BuildingKind[];

export type CivicKind = (typeof CIVIC_KINDS)[number];

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

export function isCivicBuilding(o: Obstacle): o is Building & { kind: CivicKind } {
  return isBuilding(o) && (CIVIC_KINDS as readonly BuildingKind[]).includes(o.kind);
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

/** Soft strip — polyline of short segments. Joints mitre in the client; not collision. */
export interface RoadSegment {
  kind: RoadKind;
  /** Full width of the strip in sim px. */
  width: number;
  /** Vertices in sim space. */
  points: Vec2Like[];
}

/** Small civic gyratory — circulatory tarmac around a grass island. Soft, like roads. */
export interface Roundabout {
  position: Vec2Like;
  /** Outer kerb radius of the carriageway. */
  radius: number;
  /** Grass island radius. */
  island: number;
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
   * English field parcels — roughly rectangular interiors. Visual in the client;
   * hedges on the borders are the crawl. Not collision.
   */
  fields: RectZone[];
  /**
   * Soft paths between buildings and out to the millstones.
   * Not collision — hug / fields / Henmore stay playable off the tarmac.
   */
  roads: RoadSegment[];
  /** 1–2 small roundabouts at civic nodes. Soft — same as roads. */
  roundabouts: Roundabout[];
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
  smooth = 0,
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

function sroundabout(x: number, y: number, radius: number, island: number): Roundabout {
  return { position: sxy(x, y), radius: sx(radius), island: sx(island) };
}

function sfield(x: number, y: number, w: number, h: number): RectZone {
  return srect(x, y, w, h);
}

/** Point on a circle. 0° east, 90° south — screen space. */
function rim(cx: number, cy: number, r: number, deg: number): readonly [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

/**
 * Hedge ring around a rectangular parcel. `gapN`/`gapS` are design-space X
 * cuts; `gapE`/`gapW` are Y cuts. Gaps let lanes pierce without a crawl.
 */
function ringHedges(
  x: number,
  y: number,
  w: number,
  h: number,
  thick: number,
  gapN: number[] = [],
  gapS: number[] = [],
  gapE: number[] = [],
  gapW: number[] = [],
  gapHalf = 56,
): RectZone[] {
  const left = x - w / 2;
  const right = x + w / 2;
  const top = y - h / 2;
  const bot = y + h / 2;
  return [
    ...hedgeRow(top, thick, left, right, gapN, gapHalf),
    ...hedgeRow(bot, thick, left, right, gapS, gapHalf),
    ...hedgeCol(left, thick, top, bot, gapW, gapHalf),
    ...hedgeCol(right, thick, top, bot, gapE, gapHalf),
  ];
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

/** Distance from `p` to the nearest road centreline (or roundabout carriageway). */
export function distanceToRoad(p: Vec2Like, map: TownMap): number {
  let best = Infinity;
  for (const r of map.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegment(p, r.points[i]!, r.points[i + 1]!);
      if (d < best) best = d;
    }
  }
  for (const rab of map.roundabouts) {
    const d = Math.hypot(p.x - rab.position.x, p.y - rab.position.y);
    const ring = d <= rab.radius ? 0 : d - rab.radius;
    if (ring < best) best = ring;
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
// ASHBOURNE TOWN (homage, 2× the TICKET 002 2400×1600 design space)
//
// Not GPS. Relative cues:
//   St Oswald's west edge, north of the Henmore
//   Long high street + triangular Market Place north of the brook
//   Compton crossings south of the brook, millstones at Clifton (W) / Sturston (E)
//   Tissington Trail + tunnel + The Baths on the north cutting
//   Old Grammar in the civic fabric, not a lonely field
//
//   ┌────────────── fields ─────────── [Tunnel] [Trail] [Baths] ──┐
//   │ [St Oswald's]  Church St   [Old Grammar]     ○ trail gyratory │
//   │   churchyard     │              │              │              │
//   │                  └── high street / Market Place ──○── Station │
//   │                         ▲ market gyratory                     │
//   │   ▒▒▒▒┼▒▒▒▒ HENMORE BROOK ▒▒▒▒▒┼▒▒▒▒▒▒▒▒▒┼▒▒▒▒               │
//   │      Compton (W)     turn-up     Compton (E)                  │
//   │   Clifton ◄════ fields / hedges ════► Sturston                │
//   └──────────────────────────────────────────────────────────────┘
// ---------------------------------------------------------------------------

const BRIDGE_XS = [400, 1200, 2000];
const LANE_GAP_HALF = 80;
const HEDGE_T = 22;

/** Market Place gyratory — sits on the centre-bridge axis, north of the Henmore. */
const MARKET_X = 1200;
const MARKET_Y = 720;
const MARKET_R = 52;
const MARKET_ISLAND = 22;

/** Trailhead gyratory — The Baths / Tissington Trail / town spur. */
const TRAIL_X = 1560;
const TRAIL_Y = 230;
const TRAIL_R = 44;
const TRAIL_ISLAND = 18;

/** North–south spines that may pierce a field's north/south hedge. */
const ROAD_GAP_XS = [...BRIDGE_XS, TRAIL_X];
/** East–west spines that may pierce a field's east/west hedge. */
const ROAD_GAP_YS = [TRAIL_Y, 560, 720, 790, 880, 1100];

const MARKET_W = rim(MARKET_X, MARKET_Y, MARKET_R, 180);
const MARKET_E = rim(MARKET_X, MARKET_Y, MARKET_R, 0);
const MARKET_S = rim(MARKET_X, MARKET_Y, MARKET_R, 90);
const MARKET_N = rim(MARKET_X, MARKET_Y, MARKET_R, 270);
const TRAIL_S = rim(TRAIL_X, TRAIL_Y, TRAIL_R, 90);
const TRAIL_N = rim(TRAIL_X, TRAIL_Y, TRAIL_R, 270);
const TRAIL_E = rim(TRAIL_X, TRAIL_Y, TRAIL_R, 0);
const TRAIL_W = rim(TRAIL_X, TRAIL_Y, TRAIL_R, 180);

const FIELD_PARCELS: ReadonlyArray<readonly [number, number, number, number]> = [
  // NW countryside (west / north of St Oswald's)
  [200, 110, 300, 150],
  [520, 100, 300, 140],
  [180, 640, 200, 170],
  // North of the civic core, west of the trail cutting
  [700, 95, 340, 150],
  [1080, 90, 300, 140],
  [1320, 100, 260, 130],
  // NE of the trail / Coach
  [1900, 100, 400, 170],
  [2080, 320, 280, 190],
  [1940, 540, 300, 160],
  // SW Compton / Clifton approaches — clear of the millstone reach
  [200, 1240, 280, 190],
  [220, 1460, 320, 140],
  [560, 1460, 340, 140],
  // South-central parcels — sit below the 0.82 feel-test corridor
  [900, 1450, 400, 160],
  [1380, 1455, 340, 150],
  // SE — interior at ~0.70×0.82 stays walkable grass for feel tests
  [1680, 1310, 380, 200],
  [2100, 1240, 250, 210],
  [1880, 1480, 420, 140],
];

function countrysideHedges(): RectZone[] {
  const out: RectZone[] = [];
  const gate = 72;
  for (const [x, y, w, h] of FIELD_PARCELS) {
    const left = x - w / 2;
    const right = x + w / 2;
    const top = y - h / 2;
    const bot = y + h / 2;
    const onEdge = (v: number, a: number, b: number) => v > a + 16 && v < b - 16;
    const gapN = ROAD_GAP_XS.filter((rx) => onEdge(rx, left, right));
    const gapS = [...gapN];
    const gapE = ROAD_GAP_YS.filter((ry) => onEdge(ry, top, bot));
    const gapW = [...gapE];
    // A gate on each side so hug / chase can leave the tarmac. Hedges still read as parcel borders.
    if (onEdge(x, left, right)) {
      gapN.push(x);
      gapS.push(x);
    }
    if (onEdge(y, top, bot)) {
      gapE.push(y);
      gapW.push(y);
    }
    out.push(...ringHedges(x, y, w, h, HEDGE_T, gapN, gapS, gapE, gapW, gate));
  }
  return out;
}

export const ASHBOURNE_TOWN: TownMap = {
  width: sx(2400),
  height: sx(1600),

  // High street + Compton — named Ashbourne pubs/shops. Rectangles bodies cannot pass.
  // Positions are center-of-rect, in the original 2400×1600 design space.
  obstacles: [
    // Historic core, north of the Henmore
    sbuilding(1040, 740, 90, 90, 'The Green Man', 'pub'),
    sbuilding(1100, 690, 110, 70, 'Gingerbread Shop', 'shop'),
    sbuilding(1340, 700, 80, 80, 'The Horns', 'pub'),
    sbuilding(1110, 820, 100, 60, "Smith's Butcher", 'shop'),
    sbuilding(820, 740, 84, 70, 'The George & Dragon', 'pub'),
    sbuilding(1480, 720, 90, 64, 'Station Stores', 'shop'),
    slandmark(1080, 800, 78, 112, 'Market Hall', 'market'),
    slandmark(1188, 798, 72, 86, 'Town Hall', 'hall'),
    // Civic — west church, grammar in the fabric, baths at the trailhead
    slandmark(250, 500, 118, 86, "St Oswald's", 'church'),
    slandmark(820, 560, 150, 72, 'Old Grammar', 'school'),
    slandmark(1688, 214, 78, 64, 'The Baths', 'trailhead'),
    // Compton, south of the brook
    sbuilding(1000, 1120, 100, 80, 'The Vaults', 'pub'),
    sbuilding(1280, 1160, 90, 90, 'The White Hart', 'pub'),
    sbuilding(560, 1280, 90, 70, 'The Wheel', 'pub'),
    sbuilding(1780, 380, 110, 80, 'The Coach & Horses', 'pub'),
  ],

  outOfBounds: [
    // Churchyard north of St Oswald's
    srect(220, 300, 220, 200),
    // Memorial garden (bottom-right)
    srect(2220, 1420, 220, 220),
  ],

  river: srect(1200, 880, 2400, 120),

  bridges: [
    srect(400, 880, 110, 120),
    srect(1200, 880, 110, 120),
    srect(2000, 880, 110, 120),
  ],

  fields: FIELD_PARCELS.map(([x, y, w, h]) => sfield(x, y, w, h)),

  hedges: [
    ...countrysideHedges(),
    // Bank hedges either side of town, gapped at the three Compton bridges.
    ...hedgeRow(980, 26, 80, 360, [400], LANE_GAP_HALF),
    ...hedgeRow(980, 26, 2040, 2320, [2000], LANE_GAP_HALF),
    ...hedgeCol(360, 26, 980, 1460, [], LANE_GAP_HALF),
    ...hedgeCol(2080, 26, 980, 1280, [], LANE_GAP_HALF),
    // Millstone approaches — flanks only; GOAL_REACH around the stones stays grass.
    srect(355, 754, 270, 22),
    srect(355, 826, 270, 18),
    srect(2045, 754, 270, 22),
    srect(2045, 826, 270, 18),
  ],

  // Mitred polyline network. Shared vertices = T / cross junctions.
  // Arms stop on roundabout rims. Country lanes stay almost-straight (no Chaikin).
  roads: [
    // High street west — Church Street / St John flavour into the market gyratory.
    sroad('street', 48, [
      [400, 720],
      [560, 720],
      [720, 720],
      [900, 720],
      [1040, 720],
      MARKET_W,
    ]),
    // High street east — Dig Street flavour out to Station and the Sturston spine.
    sroad('street', 48, [
      MARKET_E,
      [1340, 720],
      [1480, 720],
      [1680, 750],
      [1880, 775],
      [2000, 790],
    ]),
    // Market Place triangle — Hall / Town Hall / butcher front the square.
    sroad('street', 42, [
      MARKET_W,
      [1080, 800],
      [1188, 800],
      MARKET_S,
    ]),
    // Centre spine — gyratory south over the Henmore (turn-up) into Compton.
    sroad('street', 46, [
      MARKET_S,
      [1200, 830],
      [1200, 880],
      [1200, 980],
      [1200, 1105],
    ]),
    // North off the market — Old Grammar in the civic fabric.
    sroad('street', 40, [
      MARKET_N,
      [1200, 600],
      [1000, 560],
      [820, 560],
    ]),
    // Church gate — high street up to St Oswald's (stops short of the yard).
    sroad('lane', 36, [
      [400, 720],
      [320, 640],
      [280, 560],
      [250, 510],
    ]),
    // Clifton millstone → west Compton cross → west bridge.
    sroad('lane', 48, [
      [150, 790],
      [250, 790],
      [320, 790],
      [400, 790],
    ]),
    sroad('lane', 44, [
      [400, 720],
      [400, 790],
      [400, 880],
      [400, 1100],
    ]),
    // Sturston millstone → east Compton cross → east bridge.
    sroad('lane', 48, [
      [2250, 790],
      [2168, 790],
      [2080, 790],
      [2000, 790],
    ]),
    sroad('lane', 44, [
      [2000, 790],
      [2000, 880],
      [2000, 1100],
    ]),
    // Compton — south of the brook, west to Clifton / east to Sturston.
    sroad('street', 44, [
      [400, 1100],
      [560, 1110],
      [900, 1100],
      [1200, 1105],
      [1500, 1100],
      [1800, 1110],
      [2000, 1100],
    ]),
    // The Wheel south of Compton; White Hart off the centre cross.
    sroad('lane', 40, [
      [560, 1110],
      [560, 1280],
    ]),
    sroad('lane', 40, [
      [1200, 1105],
      [1280, 1160],
    ]),
    // Tissington Trail — former railway cutting into the trailhead gyratory.
    sroad('trail', 34, [
      [1560, 40],
      [1560, 110],
      TRAIL_N,
    ]),
    sroad('lane', 40, [
      TRAIL_S,
      [1560, 400],
      [1520, 560],
      [1480, 720],
    ]),
    sroad('lane', 36, [
      TRAIL_E,
      [1688, 214],
    ]),
    sroad('lane', 36, [
      TRAIL_W,
      [1480, 230],
      [1400, 280],
      [1340, 400],
      [1200, 600],
    ]),
    // Coach & Horses on the NE spur into the trailhead.
    sroad('lane', 40, [
      [1780, 380],
      [1660, 390],
      [1560, 400],
    ]),
  ],

  roundabouts: [
    sroundabout(MARKET_X, MARKET_Y, MARKET_R, MARKET_ISLAND),
    sroundabout(TRAIL_X, TRAIL_Y, TRAIL_R, TRAIL_ISLAND),
  ],

  streetLights: [
    slight(400, 700),
    slight(560, 700),
    slight(820, 700),
    slight(1040, 700),
    slight(1148, 700),
    slight(1252, 740),
    slight(1340, 700),
    slight(1480, 700),
    slight(1680, 730),
    slight(1880, 755),
    slight(1100, 800),
    slight(1188, 780),
    slight(1200, 800),
    slight(1200, 848),
    slight(1200, 952),
    slight(1200, 1080),
    slight(1200, 620),
    slight(1000, 540),
    slight(820, 540),
    slight(280, 560),
    slight(250, 790),
    slight(400, 770),
    slight(400, 1000),
    slight(2168, 770),
    slight(2000, 770),
    slight(2000, 1000),
    slight(560, 1090),
    slight(900, 1080),
    slight(1500, 1080),
    slight(1800, 1090),
    slight(560, 1220),
    slight(1260, 1140),
    slight(1560, 110),
    slight(1560, 400),
    slight(1520, 560),
    slight(1660, 220),
    slight(1760, 380),
    slight(1400, 280),
  ],

  places: [
    smark(640, 880, 'Henmore Brook', 'brook'),
    smark(1100, 770, 'Market Place', 'plaza'),
    smark(1560, 130, 'Tissington Trail', 'trail'),
    smark(1560, 40, 'The Tunnel', 'tunnel'),
    smark(1040, 740, 'Green Man', 'inn-sign'),
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

/** True iff the point lies on a roundabout disc (island included — hug can cut the green). */
export function isOnRoundabout(p: Vec2Like, map: TownMap): boolean {
  for (const r of map.roundabouts) {
    const d = Math.hypot(p.x - r.position.x, p.y - r.position.y);
    if (d <= r.radius) return true;
  }
  return false;
}

/** True iff the point sits on a road strip. Roads do not block or slow. */
export function isOnRoad(p: Vec2Like, map: TownMap): boolean {
  if (isOnRoundabout(p, map)) return true;
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
  if (isOnRoundabout(p, map)) return true;
  for (const r of map.roundabouts) {
    const d = Math.hypot(p.x - r.position.x, p.y - r.position.y);
    if (d <= r.radius + pad) return true;
  }
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
