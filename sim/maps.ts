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
export type BuildingKind =
  | 'pub'
  | 'shop'
  | 'church'
  | 'school'
  | 'market'
  | 'hall'
  | 'trailhead'
  | 'house';

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

/**
 * Henmore centerline — a bent polyline strip (diagonal run, soft bends, one
 * tight hairpin switchback) rather than a single axis-aligned slab. `width`
 * is the full water breadth measured perpendicular to the local run.
 */
export interface RiverPath {
  /** Vertices in sim space. Consecutive points form the strip's segments. */
  points: Vec2Like[];
  /** Full width of the water strip. */
  width: number;
}

export interface Bridge extends RectZone {}

/** The road polyline a bridge deck should paint/collide along, plus its width. */
export interface BridgeCrossingSpan {
  /** Sub-polyline of the crossing road: river run + a short dry-bank apron on each end. */
  points: Vec2Like[];
  /** Width of the crossing road (deck width, no parapet collar). */
  width: number;
}

// Declared here (well before ASHBOURNE_TOWN's module-eval-time construction,
// which calls bridgeCrossingSpan indirectly via townLamps) to dodge TDZ.
const BRIDGE_SPAN_CACHE = new WeakMap<Bridge, BridgeCrossingSpan | null>();
/** Sampling step (sim px) used to densify a road's vertex list before extracting a span. */
const BRIDGE_SPAN_SAMPLE_STEP = 10;

/**
 * UK mini-roundabout — tarmac ring around a grass island. Visual — not collision.
 * Optional (0–2). Never sits on the turn-up / kickoff plinth.
 */
export interface Roundabout {
  position: Vec2Like;
  /** Outer kerb radius. */
  radius: number;
  /** Central island radius. */
  island: number;
}

/** Hedge-bordered English field parcel. Visual grass; hedges are the crawl. */
export interface FieldParcel extends RectZone {}

/** Edge woodland / tree belt. Visual boundary — not a hard OOB. */
export interface ForestStand extends RectZone {}

/** Town street, minor lane, or former-railway trail. Visual — not collision. */
export type RoadKind = 'street' | 'lane' | 'trail';

/** Polyline lane. Joints are mitred in the client — keep vertices on junctions / ring entries. */
export interface RoadSegment {
  kind: RoadKind;
  /** Full width of the strip in sim px. */
  width: number;
  /** Vertices in sim space. Prefer axis-aligned runs; L / T / 4-way only. */
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
  /** Henmore water strip. Slow movement (RIVER_SPEED_MULT) unless on a bridge. */
  river: RiverPath;
  /** Walkable segments crossing the river. Fast movement. */
  bridges: Bridge[];
  /**
   * Optional UK mini-roundabouts (0–2). Soft — same as roads.
   * Must not sit on the turn-up; plinth approach is a through-lane.
   */
  roundabouts: Roundabout[];
  /**
   * Hedgerows. Walkable at a crawl (HEDGE_SPEED_MULT) — slower than river.
   * Bridges (and any gap left between hedge rects) pierce them for routing.
   */
  hedges: RectZone[];
  /** Rectangular English field parcels. Visual; hedges on the borders crawl. */
  fields: FieldParcel[];
  /** Tree belts and edge woodland. Visual; pitch stays playable through them. */
  forests: ForestStand[];
  /**
   * Soft paths between buildings and out to the millstones.
   * Not collision — hug / fields / Henmore stay playable off the tarmac.
   */
  roads: RoadSegment[];
  /** Lamp posts on the road network. Render-only; glow is a client Nightfall hook. */
  streetLights: StreetLight[];
  /**
   * Named places that orient the town (plaza, tunnel).
   * Labels + massing in the client; art swap keys off `id`. Not collision.
   * Brook / trail strips are geometry only — no floating place sprites.
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
/**
 * Civic massing reads from a screenshot without walling off hug routes.
 * Second +30% on civic only (2.15 → ~2.795) so church/school/halls read
 * as destinations at play zoom (Tom 2026-09-14 evening).
 */
const LANDMARK_SIZE = 2.795;
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

const HOUSE_SIZE = 1;
/** Verge gap so a footprint kisses the tarmac without sitting in the lane. */
const FRONT_GAP = 8;

function makeBuilding(
  x: number,
  y: number,
  w: number,
  h: number,
  name: string,
  kind: BuildingKind,
): Building {
  return { id: landmarkId(name), position: { x, y }, width: w, height: h, name, kind };
}

/** Horizontal road frontage. `side` +1 = south of the carriageway. */
function frontY(
  x: number,
  roadY: number,
  roadHalf: number,
  w: number,
  h: number,
  side: 1 | -1,
  name: string,
  kind: BuildingKind,
  scale = BUILDING_SIZE,
): Building {
  const bw = w * scale;
  const bh = h * scale;
  return makeBuilding(
    sx(x),
    sx(roadY) + side * (sx(roadHalf) + bh / 2 + FRONT_GAP),
    bw,
    bh,
    name,
    kind,
  );
}

/** Vertical road frontage. `side` +1 = east of the carriageway. */
function frontX(
  y: number,
  roadX: number,
  roadHalf: number,
  w: number,
  h: number,
  side: 1 | -1,
  name: string,
  kind: BuildingKind,
  scale = BUILDING_SIZE,
): Building {
  const bw = w * scale;
  const bh = h * scale;
  return makeBuilding(
    sx(roadX) + side * (sx(roadHalf) + bw / 2 + FRONT_GAP),
    sx(y),
    bw,
    bh,
    name,
    kind,
  );
}

function shouseY(
  x: number,
  roadY: number,
  roadHalf: number,
  side: 1 | -1,
  name: string,
): Building {
  return frontY(x, roadY, roadHalf, 54, 38, side, name, 'house', HOUSE_SIZE);
}

function shouseX(
  y: number,
  roadX: number,
  roadHalf: number,
  side: 1 | -1,
  name: string,
): Building {
  return frontX(y, roadX, roadHalf, 54, 38, side, name, 'house', HOUSE_SIZE);
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

/** Quarter-circle fillets at interior vertices — real arcs, not Chaikin elbows. */
function roundedCorners(
  pts: ReadonlyArray<readonly [number, number]>,
  radius: number,
  steps = 8,
): [number, number][] {
  if (pts.length < 3 || radius <= 0) return pts.map(([x, y]) => [x, y]);
  const out: [number, number][] = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const ix = b[0] - a[0];
    const iy = b[1] - a[1];
    const ox = c[0] - b[0];
    const oy = c[1] - b[1];
    const il = Math.hypot(ix, iy) || 1;
    const ol = Math.hypot(ox, oy) || 1;
    const inx = ix / il;
    const iny = iy / il;
    const onx = ox / ol;
    const ony = oy / ol;
    const r = Math.min(radius, il * 0.42, ol * 0.42);
    if (r < 8) {
      out.push([b[0], b[1]]);
      continue;
    }
    const sx0 = b[0] - inx * r;
    const sy0 = b[1] - iny * r;
    const ex = b[0] + onx * r;
    const ey = b[1] + ony * r;
    const cross = inx * ony - iny * onx;
    const sign = cross >= 0 ? 1 : -1;
    const nx = -iny * sign;
    const ny = inx * sign;
    const cx = sx0 + nx * r;
    const cy = sy0 + ny * r;
    let a0 = Math.atan2(sy0 - cy, sx0 - cx);
    let a1 = Math.atan2(ey - cy, ex - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let s = 0; s <= steps; s++) {
      const ang = a0 + (da * s) / steps;
      out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
  }
  const last = pts[pts.length - 1]!;
  out.push([last[0], last[1]]);
  return out;
}

function sroad(
  kind: RoadKind,
  width: number,
  waypoints: ReadonlyArray<readonly [number, number]>,
  smoothOrOpts: number | { smooth?: number; radius?: number } = 0,
): RoadSegment {
  const opts = typeof smoothOrOpts === 'number' ? { smooth: smoothOrOpts } : smoothOrOpts;
  const poly = opts.radius
    ? roundedCorners(waypoints, opts.radius)
    : waypoints.map(([x, y]) => [x, y] as [number, number]);
  return {
    kind,
    width: sx(width),
    points: chaikin(
      poly.map(([x, y]) => sxy(x, y)),
      opts.smooth ?? 0,
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
  skip: { n?: boolean; s?: boolean; e?: boolean; w?: boolean } = {},
): RectZone[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [
    ...(skip.n ? [] : hedgeRow(y0, thick, x0, x1, gaps.n ?? [], gapHalf)),
    ...(skip.s ? [] : hedgeRow(y1, thick, x0, x1, gaps.s ?? [], gapHalf)),
    ...(skip.w ? [] : hedgeCol(x0, thick, y0, y1, gaps.w ?? [], gapHalf)),
    ...(skip.e ? [] : hedgeCol(x1, thick, y0, y1, gaps.e ?? [], gapHalf)),
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
      for (let d = start; d < len; d += 240) {
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
// Layout grammar (from the overworld refs, not their dirt / fantasy props):
//   one E–W trunk, one N–S through the plinth, a rounded secondary wrap,
//   trailhead ring. Generous grass. Never a circle on the plinth.
//   Millstones: mud/grass hedge corridor — no dedicated approach road.
//
// Henmore along the south edge of the historic core. High street and Market
// Place north of the brook. St Oswald’s west (churchyard OOB). Compton south.
// Former railway + tunnel on the north cutting. Clifton (W) / Sturston (E).
//
//   [Tunnel]──trail──(R)──[Baths]──lane──[Coach]  (pulled in toward HS)
//   [St Oswald's]──lane──[Old Grammar]  Market Place △ (U) halls
//        churchyard           Green Man / Dig St core
//              ║  centre street (through plinth — no circus)
//   ▒▒▒▒▒▒▒▒▒▒▒ HENMORE ▒▒▒▒▒▒▒▒▒▒▒  stone bridges
//        Compton wrap (curved corners)   [Wheel]
//   Clifton ◄──────────────────────────► Sturston
// ---------------------------------------------------------------------------

/** Trailhead mini-roundabout — Baths / Coach. Far from the plinth; flowered island. */
const TRAIL_R = 40;
const TRAIL_RBT = sroundabout(1660, 280, TRAIL_R, 18);

const TOWN_ROUNDABOUTS: Roundabout[] = [TRAIL_RBT];

const TOWN_ROADS: RoadSegment[] = [
  // Trunk — high street runs off both parish edges.
  sroad('street', 52, [
    [0, 660],
    [2400, 660],
  ]),
  // Trunk — Market Place south through the plinth, T onto Compton. Not off the south.
  sroad('street', 52, [
    [1200, 520],
    [1200, 1140],
  ]),
  // Market Place — short U onto the high street, rounded corners, halls sit on the top.
  sroad('street', 46, [
    [960, 660],
    [960, 520],
    [1420, 520],
    [1420, 660],
  ], { radius: 58, smooth: 1 }),
  // Secondary through street — church T south, Compton wrap, east column up to
  // the high street. A real through route (not a minor lane): broken-white centre.
  sroad('street', 44, [
    [400, 548],
    [400, 1140],
    [2000, 1140],
    [2000, 660],
  ], { radius: 170, smooth: 1 }),
  // St Oswald's south frontage — T on the wrap, then off the west edge.
  sroad('lane', 36, [
    [400, 548],
    [0, 548],
  ]),
  // Former railway cutting — north off the map to the trailhead ring.
  sroad('trail', 34, [
    [1660, 0],
    [1660, 280 - TRAIL_R],
  ]),
  // Trailhead south — ring to the high street (T).
  sroad('lane', 42, [
    [1660, 280 + TRAIL_R],
    [1660, 660],
  ]),
  // Coach lane — east off the ring, past the inn, off the east edge.
  sroad('lane', 40, [
    [1660 + TRAIL_R, 280],
    [2400, 280],
  ]),
];

/** Adjacent hedged parcels — shared edges read as a patchwork, not scattered stamps. */
const TOWN_FIELDS: FieldParcel[] = [
  // North of the high street — west parcel keeps full depth (NW grass playable).
  // East parcel stops above Market Place halls so civic verge is not field fill.
  sfield(700, 280, 520, 400),
  sfield(1290, 200, 660, 300),
  // North-east of the trail (Coach sits west of this parcel on the lane).
  sfield(2100, 200, 480, 280),
  // Between Henmore south bank and Compton carriageway (not over south-front pubs).
  // West cell shifted south of the diagonal west crossing (dry grass centre).
  sfield(220, 1300, 280, 200),
  sfield(700, 1060, 520, 160),
  sfield(1600, 1060, 720, 160),
  sfield(2200, 1060, 320, 160),
  // South of Compton — north edge clears road-front pubs (~y=1186), then patchwork.
  sfield(320, 1420, 480, 280),
  sfield(800, 1420, 480, 280),
  sfield(1280, 1420, 480, 280),
  sfield(1760, 1420, 480, 280),
];

const TOWN_HEDGES: RectZone[] = [
  // Shared edges get one hedge so the patchwork does not double-collar.
  ...parcelHedges(700, 280, 520, 400, 26, {}, 56, { e: true }),
  ...parcelHedges(1290, 200, 660, 300, 26),
  ...parcelHedges(2100, 200, 480, 280, 26),
  // Compton-band keeps its own south hedge — grass strip clears road-front pubs.
  ...parcelHedges(220, 1300, 280, 200, 24, {}, 56, { s: true }),
  ...parcelHedges(700, 1060, 520, 160, 24),
  ...parcelHedges(1600, 1060, 720, 160, 24),
  ...parcelHedges(2200, 1060, 320, 160, 24),
  ...parcelHedges(320, 1420, 480, 280, 26, {}, 56, { e: true }),
  ...parcelHedges(800, 1420, 480, 280, 26, {}, 56, { e: true }),
  ...parcelHedges(1280, 1420, 480, 280, 26, {}, 56, { e: true }),
  ...parcelHedges(1760, 1420, 480, 280, 26),
  // Goal approach — hedges flank the Sturston mud/grass mill corridor, clear of the stone.
  // Clifton (stone ~ (160, 1010), riverside west of x=400) is left open — no goal hedges,
  // so the riverside millstone stays reachable across mud/grass without a hedge gate.
  // Sturston stone ~ (2260, 768).
  srect(2045, 732, 270, 22),
  srect(2045, 804, 270, 18),
];

/**
 * Ashbourne edge woodland — one clustered canopy mass along the north edge
 * (split only by the trail cutting through), plus a tiny SW edge strip.
 * Clear of the trailhead ring, plinth approach, and both mill corridors.
 */
const TOWN_FORESTS: ForestStand[] = [
  srect(800, 60, 1520, 160),
  srect(2070, 60, 620, 160),
  srect(30, 1040, 100, 280),
];

/**
 * Henmore centerline — a real SW→NE diagonal (bottom-left to upper-right),
 * not a flat east–west slab, with soft bends and one tight open-U
 * hairpin that continues downstream (Tom 2026-09-14: "hairpin, not oxbow"
 * — FAIL if closed/nearly-closed pond). Endpoints run off-map on both ends
 * (no rectangular stub inside the frame). The WEST_X/CENTRE_X/EAST_X
 * crossings are exact vertices so the N–S roads (and their bridges) land on
 * the water without drift. The hairpin sits between the centre and east
 * bridges, south of the high street — an open U (tip clear of HS asphalt)
 * with clear parallel legs so the channel stays constant-width, not a lake.
 * Tip must not intersect the high street or trailhead T (bridges-only crossings).
 */
const RIVER_WIDTH = 60;
const RIVER_WEST_Y = 1020;
const RIVER_CENTRE_Y = 880;
const RIVER_EAST_Y = 740;

/** Off-map SW entry through the west bridge and on to the centre bridge. */
const TOWN_RIVER_RUN_A: ReadonlyArray<readonly [number, number]> = [
  [-160, 1240],
  [-40, 1185],
  [100, 1135],
  [260, 1075],
  [400, RIVER_WEST_Y],
  [560, 980],
  [720, 940],
  [900, 905],
  [1060, 888],
  [1200, RIVER_CENTRE_Y],
  [1320, 862],
  [1420, 848],
];
/**
 * Hairpin switchback — OPEN U that continues downstream (NE).
 * North-opening U: up the left arm, around the tip, down the right arm,
 * then on NE. Legs ~170 design-px apart (≫ RIVER_WIDTH) so inbound and
 * outbound stay visually separate — FAIL if nearly-touching oxbow/pond.
 * Apex south of the high street (y=660). Tom 2026-09-14: hairpin, not lake.
 */
const TOWN_RIVER_HAIRPIN: ReadonlyArray<readonly [number, number]> = [
  // Approach, then OPEN U (opens south, continues NE).
  // Leg gap ~170 ≫ RIVER_WIDTH — clear grass inside the U, not a pond silhouette.
  // Tip south of high street (y=660) + trailhead T (1660,660): clearance ≥
  // river half (30) + street half (26) + margin so asphalt never overlays water
  // except on bridge decks (Game Art FAIL).
  [1480, 860],
  [1540, 875],
  [1585, 882],
  [1620, 870],
  // Left arm north — stop well south of HS
  [1620, 840],
  [1615, 810],
  [1625, 780],
  [1660, 758],
  [1695, 748], // tip — south of HS/trail T, not through the carriageway
  [1730, 758],
  [1765, 780],
  [1775, 810],
  // Right arm south — wide open (FAIL if nearly-touching oxbow neck)
  [1780, 840],
  [1790, 870],
  // Resume NE toward the east bridge
  [1830, 860],
  [1880, 820],
  [1910, 780],
];
/**
 * East bridge then NE off-map — stays clear of the high street (y=660,
 * half-width 26) all the way to the east frame edge (x=2400) before
 * turning north, so no centerline sample near the map edge lands in water.
 * The x≈2220–2320 stretch also threads the Sturston millstone clearance
 * test (riverside, ≥72 design-px from (2260,768)) — a narrow but exact
 * (not sampled) window, so don't nudge these y-values without re-checking
 * both constraints.
 */
const TOWN_RIVER_RUN_B: ReadonlyArray<readonly [number, number]> = [
  [2000, RIVER_EAST_Y],
  [2100, 720],
  [2220, 696],
  [2320, 693],
  [2400, 701],
  [2560, 696],
  [2660, 600],
  [2760, 450],
  [2860, 300],
];

const TOWN_RIVER: RiverPath = {
  points: [
    ...TOWN_RIVER_RUN_A.map(([x, y]) => sxy(x, y)),
    ...TOWN_RIVER_HAIRPIN.map(([x, y]) => sxy(x, y)),
    ...TOWN_RIVER_RUN_B.map(([x, y]) => sxy(x, y)),
  ],
  width: sx(RIVER_WIDTH),
};

const TOWN_BRIDGES: Bridge[] = [
  srect(400, RIVER_WEST_Y, 44, 150),
  srect(1200, RIVER_CENTRE_Y, 52, 150),
  srect(2000, RIVER_EAST_Y, 44, 150),
];

function townLamps(): StreetLight[] {
  const lamps = vergeLights(TOWN_ROADS, TOWN_ROUNDABOUTS);
  const stones = [sxy(160, 1010), sxy(2260, 768)];
  const extra = [
    slight(400, 940),
    slight(2000, 690),
    slight(1200, 820),
    slight(1200, 940),
    slight(1660, 160),
    slight(1200, 600),
  ];
  // Partial map — enough for isOnBridge's crossing-span lookup (roads + river);
  // ASHBOURNE_TOWN itself isn't built yet at this point in module init.
  const spanMap = { bridges: TOWN_BRIDGES, roads: TOWN_ROADS, river: TOWN_RIVER } as TownMap;
  return [...lamps, ...extra].filter((l) => {
    const inRiver = pointInRiver(l.position, TOWN_RIVER);
    const onDeck = isOnBridge(l.position, spanMap);
    if (inRiver && !onDeck) return false;
    for (const g of stones) {
      if (Math.hypot(l.position.x - g.x, l.position.y - g.y) < 48) return false;
    }
    return true;
  });
}

const HS_Y = 660;
const HS_HALF = 26;
const PLAZA_Y = 520;
const PLAZA_HALF = 23;
const CENTRE_X = 1200;
const CENTRE_HALF = 26;
const COMPTON_Y = 1140;
const COMPTON_HALF = 22;
const WEST_X = 400;
const WEST_HALF = 22;
const EAST_X = 2000;
const EAST_HALF = 22;
const COACH_Y = 280;
const COACH_HALF = 20;
const TRAIL_X = 1660;
const TRAIL_HALF = 17;

const TOWN_BUILDINGS: Building[] = [
  // High street — south verge, spaced so boxes never stack. Tightened toward Dig St.
  frontY(800, HS_Y, HS_HALF, 84, 68, 1, 'The George & Dragon', 'pub'),
  frontY(980, HS_Y, HS_HALF, 88, 76, 1, 'The Green Man', 'pub'),
  frontY(1140, HS_Y, HS_HALF, 92, 58, 1, "Smith's Butcher", 'shop'),
  frontY(1320, HS_Y, HS_HALF, 80, 70, 1, 'The Horns', 'pub'),
  frontY(1480, HS_Y, HS_HALF, 90, 60, 1, 'Station Stores', 'shop'),
  // Market Place — halls on the north verge, shop on the south (plaza core).
  frontY(1100, PLAZA_Y, PLAZA_HALF, 78, 88, -1, 'Market Hall', 'market', LANDMARK_SIZE),
  frontY(1280, PLAZA_Y, PLAZA_HALF, 72, 80, -1, 'Town Hall', 'hall', LANDMARK_SIZE),
  frontY(1120, PLAZA_Y, PLAZA_HALF, 100, 62, 1, 'Gingerbread Shop', 'shop'),
  // Compton — south of the brook, road-front on the wrap (village row, not mid-field).
  frontY(1080, COMPTON_Y, COMPTON_HALF, 96, 70, 1, 'The Vaults', 'pub'),
  frontY(1340, COMPTON_Y, COMPTON_HALF, 88, 72, 1, 'The White Hart', 'pub'),
  frontY(780, COMPTON_Y, COMPTON_HALF, 86, 64, 1, 'The Wheel', 'pub'),
  // Trailhead destinations pulled in toward the high-street T (still north/east).
  frontY(1780, COACH_Y, COACH_HALF, 104, 72, 1, 'The Coach & Horses', 'pub'),
  frontX(400, TRAIL_X, TRAIL_HALF, 78, 64, 1, 'The Baths', 'trailhead', LANDMARK_SIZE),
  // St Oswald's — church lane north verge, west of Market Place / Dig St core.
  frontY(260, 548, 18, 118, 86, -1, "St Oswald's", 'church', LANDMARK_SIZE),
  frontY(780, HS_Y, HS_HALF, 140, 68, -1, 'Old Grammar', 'school', LANDMARK_SIZE),
  // Ordinary terrace / cottage markers — core density, not landmarks.
  // Keep clear of Dig St T (x≈1200) and civic footprints.
  shouseY(900, HS_Y, HS_HALF, -1, 'High St 1'),
  shouseY(1000, HS_Y, HS_HALF, -1, 'High St 2'),
  shouseY(1360, HS_Y, HS_HALF, -1, 'High St 3'),
  shouseY(1500, HS_Y, HS_HALF, -1, 'High St 4'),
  shouseY(880, HS_Y, HS_HALF, 1, 'High St 5'),
  shouseY(1400, HS_Y, HS_HALF, 1, 'High St 6'),
  // Infill terrace — thickens the high street frontage on both verges.
  shouseY(1080, HS_Y, HS_HALF, -1, 'High St 7'),
  shouseY(1440, HS_Y, HS_HALF, -1, 'High St 8'),
  shouseY(1580, HS_Y, HS_HALF, -1, 'High St 9'),
  shouseY(1680, HS_Y, HS_HALF, -1, 'High St 10'),
  shouseY(1060, HS_Y, HS_HALF, 1, 'High St 11'),
  shouseY(1720, HS_Y, HS_HALF, 1, 'High St 12'),
  shouseY(1540, HS_Y, HS_HALF, 1, 'High St 13'),
  shouseY(1620, HS_Y, HS_HALF, 1, 'High St 14'),
  shouseY(1360, PLAZA_Y, PLAZA_HALF, 1, 'Market Row 1'),
  // Dig / Market rows — west of centre street, clear of Gingerbread + HS kerb.
  shouseX(640, CENTRE_X, CENTRE_HALF, -1, 'Market Row 2'),
  shouseX(800, CENTRE_X, CENTRE_HALF, -1, 'Market Row 3'),
  shouseX(720, CENTRE_X, CENTRE_HALF, 1, 'Dig St 1'),
  shouseX(820, CENTRE_X, CENTRE_HALF, 1, 'Dig St 3'),
  shouseX(900, CENTRE_X, CENTRE_HALF, 1, 'Dig St 2'),
  shouseY(920, COMPTON_Y, COMPTON_HALF, 1, 'Compton 1'),
  shouseY(1520, COMPTON_Y, COMPTON_HALF, 1, 'Compton 2'),
  // Compton infill — fills the gaps between the pubs on the south frontage.
  shouseY(660, COMPTON_Y, COMPTON_HALF, 1, 'Compton 3'),
  shouseY(880, COMPTON_Y, COMPTON_HALF, 1, 'Compton 4'),
  shouseY(1160, COMPTON_Y, COMPTON_HALF, 1, 'Compton 5'),
  shouseY(1260, COMPTON_Y, COMPTON_HALF, 1, 'Compton 6'),
  shouseY(1437, COMPTON_Y, COMPTON_HALF, 1, 'Compton 7'),
  // Clifton village — west column east verge, clear of the riverside mill approach (no goal hedges).
  // Tightened spacing (evenly ~40 apart) so it reads as one cluster.
  shouseX(560, WEST_X, WEST_HALF, 1, 'Clifton 1'),
  shouseX(600, WEST_X, WEST_HALF, 1, 'Clifton 5'),
  shouseX(640, WEST_X, WEST_HALF, 1, 'Clifton 2'),
  shouseX(680, WEST_X, WEST_HALF, 1, 'Clifton 3'),
  shouseX(715, WEST_X, WEST_HALF, 1, 'Clifton 4'),
  // Sturston village — east column west verge + high-street end.
  // Extended to match Clifton's density, evenly spaced along the lane.
  shouseX(645, EAST_X, EAST_HALF, -1, 'Sturston 5'),
  shouseX(675, EAST_X, EAST_HALF, -1, 'Sturston 1'),
  shouseX(705, EAST_X, EAST_HALF, -1, 'Sturston 2'),
  shouseX(735, EAST_X, EAST_HALF, -1, 'Sturston 3'),
  shouseX(765, EAST_X, EAST_HALF, -1, 'Sturston 6'),
  shouseY(1880, HS_Y, HS_HALF, 1, 'Sturston 4'),
];

const GREEN_MAN = TOWN_BUILDINGS.find((b) => b.id === 'the-green-man')!;

export const ASHBOURNE_TOWN: TownMap = {
  width: sx(2400),
  height: sx(1600),

  obstacles: TOWN_BUILDINGS,

  outOfBounds: [
    srect(180, 320, 180, 160),
    srect(2220, 1420, 220, 220),
  ],

  river: TOWN_RIVER,

  bridges: TOWN_BRIDGES,

  roundabouts: TOWN_ROUNDABOUTS,

  hedges: TOWN_HEDGES,

  fields: TOWN_FIELDS,

  forests: TOWN_FORESTS,

  roads: TOWN_ROADS,

  streetLights: townLamps(),

  places: [
    smark(1200, 600, 'Market Place', 'plaza'),
    smark(1660, 48, 'The Tunnel', 'tunnel'),
    { id: 'green-man', kind: 'inn-sign', name: 'Green Man', position: { ...GREEN_MAN.position } },
  ],

  goals: [
    // Riverside / near bank (not mid-channel). Clearance ≥ half-width + ~42.
    { team: 0, name: MILL_CLIFTON, position: sxy(160, 1010) },
    { team: 1, name: MILL_STURSTON, position: sxy(2260, 768) },
  ],

  turnUp: sxy(1200, RIVER_CENTRE_Y),
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

/** True iff the point lies within `river.width` of the Henmore centerline. */
export function pointInRiver(p: Vec2Like, river: RiverPath): boolean {
  const half = river.width / 2;
  for (let i = 0; i < river.points.length - 1; i++) {
    if (distToSegment(p, river.points[i]!, river.points[i + 1]!) <= half) return true;
  }
  return false;
}

/** True iff the point lies in the river. */
export function isInRiver(p: Vec2Like, map: TownMap): boolean {
  return pointInRiver(p, map.river);
}

/**
 * Local Henmore centerline y at a given x — linear interpolation across the
 * nearest crossing segment (narrowest x-span, to favour a steep local crossing
 * — a bridge approach or the hairpin's near-vertical legs — over a long
 * near-horizontal reach sharing the same x). Used for "north of the brook"
 * placement checks, not collision.
 */
export function riverYAt(x: number, river: RiverPath): number {
  let best: number | null = null;
  let bestSpan = Infinity;
  for (let i = 0; i < river.points.length - 1; i++) {
    const a = river.points[i]!;
    const b = river.points[i + 1]!;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    if (x < lo || x > hi) continue;
    const span = hi - lo;
    if (span < 1e-6) continue;
    const t = (x - a.x) / (b.x - a.x);
    const y = a.y + t * (b.y - a.y);
    if (span < bestSpan) {
      bestSpan = span;
      best = y;
    }
  }
  return best ?? river.points[0]!.y;
}

/** True iff the point sits north of the local Henmore bank (historic core side). */
export function isNorthOfRiver(p: Vec2Like, map: TownMap): boolean {
  return p.y < riverYAt(p.x, map.river);
}

/**
 * The crossing road's sub-polyline through a bridge — the road nearest the
 * bridge centre, walked through its river crossing plus a short dry-bank
 * apron on each end (so abutments land on dry approaches, not mid-water).
 * Result is cached per bridge (map geometry is static once built).
 */
export function bridgeCrossingSpan(bridge: Bridge, map: TownMap): BridgeCrossingSpan | null {
  if (BRIDGE_SPAN_CACHE.has(bridge)) return BRIDGE_SPAN_CACHE.get(bridge)!;
  const span = computeBridgeCrossingSpan(bridge, map);
  BRIDGE_SPAN_CACHE.set(bridge, span);
  return span;
}

function computeBridgeCrossingSpan(bridge: Bridge, map: TownMap): BridgeCrossingSpan | null {
  const c = bridge.position;

  // Road whose centreline passes closest to the bridge centre.
  let road: RoadSegment | null = null;
  let bestDist = Infinity;
  for (const r of map.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      const d = distToSegment(c, r.points[i]!, r.points[i + 1]!);
      if (d < bestDist) {
        bestDist = d;
        road = r;
      }
    }
  }
  if (!road || bestDist > road.width) return null;

  // Densify the road's vertex list so a filleted / smoothed approach is
  // represented by more than its coarse corner vertices.
  const samples: Vec2Like[] = [road.points[0]!];
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i]!;
    const b = road.points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / BRIDGE_SPAN_SAMPLE_STEP));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  // Sample nearest the bridge centre anchors the crossing run.
  let anchor = 0;
  let anchorDist = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.hypot(samples[i]!.x - c.x, samples[i]!.y - c.y);
    if (d < anchorDist) {
      anchorDist = d;
      anchor = i;
    }
  }

  // Contiguous in-river run containing (or nearest to) the anchor.
  let lo = anchor;
  let hi = anchor;
  if (pointInRiver(samples[anchor]!, map.river)) {
    while (lo > 0 && pointInRiver(samples[lo - 1]!, map.river)) lo--;
    while (hi < samples.length - 1 && pointInRiver(samples[hi + 1]!, map.river)) hi++;
  }

  // Dry-bank apron on each end so abutments land off the water.
  const pad = Math.max(map.river.width, bridge.height * 0.5);
  const extend = (idx: number, dir: -1 | 1): number => {
    let d = 0;
    let i = idx;
    while (d < pad) {
      const ni = i + dir;
      if (ni < 0 || ni >= samples.length) break;
      d += Math.hypot(samples[ni]!.x - samples[i]!.x, samples[ni]!.y - samples[i]!.y);
      i = ni;
    }
    return i;
  };
  const loExt = extend(lo, -1);
  const hiExt = extend(hi, 1);
  if (hiExt <= loExt) return null;

  return { points: samples.slice(loExt, hiExt + 1), width: road.width };
}

/** True iff the point lies on any bridge (matches the painted deck, not the AABB). */
export function isOnBridge(p: Vec2Like, map: TownMap): boolean {
  return map.bridges.some((b) => {
    const span = bridgeCrossingSpan(b, map);
    if (!span) return pointInRect(p, b);
    const half = span.width / 2;
    for (let i = 0; i < span.points.length - 1; i++) {
      if (distToSegment(p, span.points[i]!, span.points[i + 1]!) <= half) return true;
    }
    return false;
  });
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
