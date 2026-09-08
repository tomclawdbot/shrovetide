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

/** Mini-roundabout — tarmac ring around a grass/cobble island. Visual — not collision. */
export interface Roundabout {
  position: Vec2Like;
  /** Outer kerb radius. */
  radius: number;
  /** Central island radius. */
  island: number;
}

/** Hedge-bordered English field parcel. Visual grass; hedges are the crawl. */
export interface FieldParcel extends RectZone {}

/** Town street, millstone-approach track, or former-railway trail. Visual — not collision. */
export type RoadKind = 'street' | 'lane' | 'trail';

/** Polyline lane. Joints are mitred in the client — keep vertices on junctions. */
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
  /** Mini-roundabouts on the lane network. Soft — same as roads. */
  roundabouts: Roundabout[];
  /**
   * Hedgerows. Walkable at a crawl (HEDGE_SPEED_MULT) — slower than river.
   * Bridges (and any gap left between hedge rects) pierce them for routing.
   */
  hedges: RectZone[];
  /** Rectangular English field parcels. Visual; hedges on the borders crawl. */
  fields: FieldParcel[];
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

function sfield(x: number, y: number, w: number, h: number): FieldParcel {
  return srect(x, y, w, h);
}

/** Hedge border of a rectangular parcel, with optional gaps (design-space). */
function parcelHedges(
  cx: number,
  cy: number,
  w: number,
  h: number,
  thick: number,
  gaps: { n?: number[]; s?: number[]; e?: number[]; w?: number[] } = {},
  gapHalf = 56,
): RectZone[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [
    ...hedgeRow(y0, thick, x0, x1, gaps.n ?? [], gapHalf),
    ...hedgeRow(y1, thick, x0, x1, gaps.s ?? [], gapHalf),
    ...hedgeCol(x0, thick, y0, y1, gaps.w ?? [], gapHalf),
    ...hedgeCol(x1, thick, y0, y1, gaps.e ?? [], gapHalf),
  ];
}

/** Verge lamps along polylines + roundabout kerbs. Positions already in sim space. */
function vergeLights(roads: RoadSegment[], roundabouts: Roundabout[]): StreetLight[] {
  const out: StreetLight[] = [];
  for (const r of roads) {
    let acc = 0;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i]!;
      const b = r.points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 8) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const verge = r.width / 2 + 10;
      const start = acc === 0 ? 48 : 0;
      for (let d = start; d < len; d += 150) {
        const t = d / len;
        const side = out.length % 2 === 0 ? 1 : -1;
        out.push({
          position: {
            x: a.x + (b.x - a.x) * t + nx * verge * side,
            y: a.y + (b.y - a.y) * t + ny * verge * side,
          },
        });
      }
      acc += len;
    }
  }
  for (const rbt of roundabouts) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.35;
      out.push({
        position: {
          x: rbt.position.x + Math.cos(a) * (rbt.radius + 14),
          y: rbt.position.y + Math.sin(a) * (rbt.radius + 14),
        },
      });
    }
  }
  return out;
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

/** Distance from `p` to a roundabout carriageway (0 = on the ring). */
export function distToRoundabout(p: Vec2Like, r: Roundabout): number {
  const d = Math.hypot(p.x - r.position.x, p.y - r.position.y);
  if (d <= r.island) return r.island - d;
  if (d >= r.radius) return d - r.radius;
  return 0;
}

/** Distance from `p` to the nearest road centreline (includes roundabout rings). */
export function distanceToRoad(p: Vec2Like, map: TownMap): number {
  let best = Infinity;
  for (const r of map.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegment(p, r.points[i]!, r.points[i + 1]!);
      if (d < best) best = d;
    }
  }
  for (const rbt of map.roundabouts) {
    const d = distToRoundabout(p, rbt);
    if (d < best) best = d;
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
// ASHBOURNE TOWN — Derbyshire market-town homage (not GPS).
//
// Henmore along the south edge of the historic core. Long main street and
// triangular Market Place north of the brook. St Oswald’s west. Compton
// crossings south toward Clifton (W) and Sturston (E). Tissington Trail
// and tunnel on the north cutting. Mini-roundabouts at Market/Compton and
// the trailhead. Fields are hedge-bordered rectangles outside the core.
//
//   [Tunnel / Trail]  (R2)  [Baths]
//   [St Oswald's]  Market Place △  [Old Grammar]     Coach
//        churchyard   Green Man / Halls
//              (R1) ── centre bridge / turn-up
//   ▒▒▒▒▒▒▒▒▒▒▒ HENMORE ▒▒▒▒▒▒▒▒▒▒▒  stone bridges
//        Compton  Vaults / White Hart
//   Clifton ◄──────────────────────────► Sturston
// ---------------------------------------------------------------------------

const BRIDGE_XS = [400, 1200, 2000];
const LANE_GAP_HALF = 80;
const RIVER_GAP_HALF = 140;

/** Market / Compton mini-roundabout — south of the square, on the centre crossing. */
const MARKET_RBT = sroundabout(1200, 760, 70, 30);
/** Trailhead mini-roundabout — Baths / Tissington / Coach. */
const TRAIL_RBT = sroundabout(1660, 300, 56, 24);

const TOWN_ROUNDABOUTS: Roundabout[] = [MARKET_RBT, TRAIL_RBT];

const TOWN_ROADS: RoadSegment[] = [
  // St John / high street west — church through George to R1 west entry.
  sroad('street', 50, [
    [320, 530],
    [420, 560],
    [580, 630],
    [740, 670],
    [920, 720],
    [1130, 760],
  ]),
  // R1 north arm through Market Place (keeps 1200,660 on tarmac).
  sroad('street', 48, [
    [1200, 690],
    [1200, 660],
    [1200, 620],
    [1140, 600],
    [1080, 590],
  ]),
  // Market Place frontage — Green Man / halls, T-joins the north arm.
  sroad('street', 46, [
    [980, 650],
    [1080, 630],
    [1140, 620],
    [1240, 610],
    [1260, 600],
  ]),
  // R1 east — Station Stores toward the east (Sturston) bridge.
  sroad('street', 48, [
    [1270, 760],
    [1420, 720],
    [1520, 680],
    [1640, 660],
    [1840, 720],
    [2000, 830],
    [2000, 880],
  ]),
  // R1 south — Compton crossing / turn-up deck / south street.
  sroad('street', 48, [
    [1200, 830],
    [1200, 880],
    [1200, 1040],
    [1230, 1110],
    [1280, 1160],
  ]),
  // Clifton millstone → west bridge (hedge corridor — keep straight).
  sroad('lane', 48, [
    [150, 790],
    [250, 790],
    [320, 790],
    [400, 790],
    [400, 880],
  ]),
  // West T — bridge north into the high street at (580, 630).
  sroad('lane', 42, [
    [400, 848],
    [500, 720],
    [580, 630],
  ]),
  // West T — bridge south to The Wheel.
  sroad('lane', 42, [
    [400, 912],
    [520, 1100],
    [600, 1280],
  ]),
  // Compton west — Wheel along to the south street sample (1230, 1110).
  sroad('lane', 42, [
    [600, 1280],
    [860, 1180],
    [1080, 1120],
    [1230, 1110],
  ]),
  // Sturston millstone → east bridge.
  sroad('lane', 48, [
    [2250, 790],
    [2168, 790],
    [2080, 790],
    [2000, 790],
    [2000, 880],
  ]),
  // Church gate — high street west up to St Oswald's (stops short of the yard).
  sroad('lane', 36, [
    [320, 530],
    [280, 510],
    [240, 500],
  ]),
  // Old Grammar — north off the high street.
  sroad('lane', 36, [
    [740, 670],
    [720, 600],
    [700, 540],
  ]),
  // Tissington Trail — tunnel to R2 north entry.
  sroad('trail', 34, [
    [1660, 48],
    [1660, 140],
    [1660, 244],
  ]),
  // R2 east — Baths/Coach, then south to join the east high street at (1640, 660).
  sroad('lane', 42, [
    [1716, 300],
    [1820, 360],
    [1740, 500],
    [1640, 660],
  ]),
  // R2 south stub onto the Coach lane (three-arm mini-roundabout).
  sroad('lane', 40, [
    [1660, 356],
    [1680, 380],
    [1820, 360],
  ]),
];

const TOWN_FIELDS: FieldParcel[] = [
  sfield(520, 300, 400, 240),
  sfield(980, 220, 360, 180),
  sfield(2140, 420, 400, 320),
  sfield(1980, 160, 280, 200),
  sfield(260, 1280, 200, 200),
  sfield(1320, 1320, 300, 250),
  sfield(1700, 1320, 420, 260),
  sfield(2140, 1200, 360, 240),
  sfield(820, 1360, 280, 180),
  sfield(280, 1040, 260, 160),
];

const TOWN_HEDGES: RectZone[] = [
  ...parcelHedges(520, 300, 400, 240, 26),
  ...parcelHedges(980, 220, 360, 180, 24, { s: [980] }),
  ...parcelHedges(2140, 420, 400, 320, 26),
  ...parcelHedges(1980, 160, 280, 200, 24, { w: [160] }),
  ...parcelHedges(260, 1280, 200, 200, 26),
  ...parcelHedges(1320, 1320, 300, 250, 26, { n: [1320], e: [1320], w: [1320] }, 80),
  ...parcelHedges(1700, 1320, 420, 260, 26, { n: [1700], w: [1320], e: [1700] }, 80),
  ...parcelHedges(2140, 1200, 360, 240, 26),
  ...parcelHedges(820, 1360, 280, 180, 24, { n: [820] }),
  ...parcelHedges(280, 1040, 260, 160, 24, { e: [1040] }),
  ...hedgeRow(1480, 32, 80, 2080, BRIDGE_XS, LANE_GAP_HALF),
  ...hedgeCol(360, 22, 620, 1120, [790, 880], RIVER_GAP_HALF),
  ...hedgeCol(2080, 22, 520, 1120, [790, 880], RIVER_GAP_HALF),
  // Goal approaches — hedges flank the millstone lanes, clear of the stones.
  srect(355, 754, 270, 22),
  srect(355, 826, 270, 18),
  srect(2045, 754, 270, 22),
  srect(2045, 826, 270, 18),
  srect(300, 980, 200, 28),
  srect(2100, 980, 200, 28),
];

function townLamps(): StreetLight[] {
  const lamps = vergeLights(TOWN_ROADS, TOWN_ROUNDABOUTS);
  const riverY = sx(880);
  const riverH = sx(58);
  const decks = [sx(400), sx(1200), sx(2000)];
  const stones = [sxy(140, 790), sxy(2260, 790)];
  const extra = [
    slight(400, 766),
    slight(2000, 766),
    slight(1200, 808),
    slight(1200, 952),
    slight(1660, 160),
    slight(1140, 640),
  ];
  return [...lamps, ...extra].filter((l) => {
    const inRiver = Math.abs(l.position.y - riverY) < riverH;
    const onDeck = decks.some((bx) => Math.abs(l.position.x - bx) < sx(80));
    if (inRiver && !onDeck) return false;
    for (const g of stones) {
      if (Math.hypot(l.position.x - g.x, l.position.y - g.y) < 48) return false;
    }
    return true;
  });
}

export const ASHBOURNE_TOWN: TownMap = {
  width: sx(2400),
  height: sx(1600),

  obstacles: [
    // Historic core — north of the Henmore / Market Place.
    sbuilding(1000, 660, 90, 90, 'The Green Man', 'pub'),
    sbuilding(1100, 560, 110, 70, 'Gingerbread Shop', 'shop'),
    sbuilding(1280, 660, 80, 80, 'The Horns', 'pub'),
    sbuilding(1040, 710, 100, 60, "Smith's Butcher", 'shop'),
    sbuilding(840, 640, 84, 70, 'The George & Dragon', 'pub'),
    sbuilding(1520, 640, 90, 64, 'Station Stores', 'shop'),
    // Compton — south of the brook.
    sbuilding(1100, 1080, 100, 80, 'The Vaults', 'pub'),
    sbuilding(1280, 1160, 90, 90, 'The White Hart', 'pub'),
    slandmark(1080, 580, 78, 112, 'Market Hall', 'market'),
    slandmark(1260, 590, 72, 86, 'Town Hall', 'hall'),
    sbuilding(600, 1280, 90, 70, 'The Wheel', 'pub'),
    sbuilding(1820, 360, 110, 80, 'The Coach & Horses', 'pub'),
    slandmark(220, 500, 118, 86, "St Oswald's", 'church'),
    slandmark(700, 540, 150, 72, 'Old Grammar', 'school'),
    slandmark(1700, 200, 78, 64, 'The Baths', 'trailhead'),
  ],

  outOfBounds: [
    srect(180, 240, 200, 200),
    srect(2220, 1420, 220, 220),
  ],

  river: srect(1200, 880, 2400, 120),

  bridges: [
    srect(400, 880, 150, 140),
    srect(1200, 880, 150, 140),
    srect(2000, 880, 150, 140),
  ],

  roundabouts: TOWN_ROUNDABOUTS,

  hedges: TOWN_HEDGES,

  fields: TOWN_FIELDS,

  roads: TOWN_ROADS,

  streetLights: townLamps(),

  places: [
    smark(640, 818, 'Henmore Brook', 'brook'),
    smark(1140, 640, 'Market Place', 'plaza'),
    smark(1670, 150, 'Tissington Trail', 'trail'),
    smark(1660, 48, 'The Tunnel', 'tunnel'),
    smark(1000, 660, 'Green Man', 'inn-sign'),
  ],

  goals: [
    { team: 0, name: MILL_CLIFTON, position: sxy(140, 790) },
    { team: 1, name: MILL_STURSTON, position: sxy(2260, 790) },
  ],

  turnUp: sxy(1200, 880),
};

// ---------------------------------------------------------------------------
// Zone helpers — used by physics + AI + UI.
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
  for (const rbt of map.roundabouts) {
    if (distToRoundabout(p, rbt) === 0) return true;
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
  for (const rbt of map.roundabouts) {
    if (distToRoundabout(p, rbt) <= pad) return true;
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
