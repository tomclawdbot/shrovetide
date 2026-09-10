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

export interface Bridge extends RectZone {}

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

/** Town street, millstone-approach track, or former-railway trail. Visual — not collision. */
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
  /** Water zone. Slow movement (RIVER_SPEED_MULT) unless on a bridge. */
  river: RectZone;
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
//   trunk streets on a cross, secondary lanes as L / T, large adjacent
//   hedged fields, edge woodland belts, landmarks as destinations.
//   One UK mini-roundabout at the trailhead — never a circle on the plinth.
//
// Henmore along the south edge of the historic core. High street and Market
// Place north of the brook. St Oswald’s west (churchyard OOB). Compton south.
// Tissington Trail + tunnel on the north cutting. Clifton (W) / Sturston (E).
//
//   [Tunnel]──trail──(R)──[Baths]──lane──[Coach]
//   [St Oswald's]── [Old Grammar]  Market Place △
//        churchyard      Green Man / halls
//              ║  centre street (through plinth — no circus)
//   ▒▒▒▒▒▒▒▒▒▒▒ HENMORE ▒▒▒▒▒▒▒▒▒▒▒  stone bridges
//        Compton  Vaults / White Hart     [Wheel]
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
  // Trunk — centre street through Market Place, plinth, Compton, off the south edge.
  sroad('street', 52, [
    [1200, 520],
    [1200, 1600],
  ]),
  // Civic terrace — west column to the trailhead lane (halls sit on this).
  sroad('street', 46, [
    [400, 520],
    [1660, 520],
  ]),
  // West column — off the north edge, church T, mill T, Compton, off the south.
  sroad('lane', 44, [
    [400, 0],
    [400, 1600],
  ]),
  // East column — off the north edge, Coach T, high street, east bridge, Compton, off south.
  sroad('lane', 44, [
    [2000, 0],
    [2000, 1600],
  ]),
  // Clifton millstone — hedge corridor, then off the west edge.
  sroad('lane', 48, [
    [0, 790],
    [400, 790],
  ]),
  // Sturston millstone — hedge corridor, then off the east edge.
  sroad('lane', 48, [
    [2000, 790],
    [2400, 790],
  ]),
  // Compton — south trunk off both edges.
  sroad('lane', 44, [
    [0, 1140],
    [2400, 1140],
  ]),
  // St Oswald's frontage — T on the west column, then off the west edge.
  sroad('lane', 36, [
    [400, 500],
    [0, 500],
  ]),
  // Old Grammar — T onto the civic terrace, south onto the high street.
  sroad('lane', 36, [
    [700, 520],
    [700, 660],
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
  // Coach lane — east off the ring, through the inn, off the east edge.
  sroad('lane', 40, [
    [1660 + TRAIL_R, 280],
    [2400, 280],
  ]),
];

/** Adjacent hedged parcels — shared edges read as a patchwork, not scattered stamps. */
const TOWN_FIELDS: FieldParcel[] = [
  // North of the high street, west of the trail (two neighbours sharing x=960).
  sfield(700, 280, 520, 400),
  sfield(1290, 280, 660, 400),
  // North-east of the trail.
  sfield(2100, 200, 480, 280),
  // Between Henmore south bank and Compton (cells between the N–S columns).
  sfield(220, 1050, 280, 140),
  sfield(700, 1050, 520, 140),
  sfield(1600, 1050, 720, 140),
  sfield(2200, 1050, 320, 140),
  // South of Compton — one row of neighbouring parcels.
  sfield(320, 1400, 480, 320),
  sfield(800, 1400, 480, 320),
  sfield(1280, 1400, 480, 320),
  sfield(1760, 1400, 480, 320),
];

const TOWN_HEDGES: RectZone[] = [
  // Shared edges get one hedge so the patchwork does not double-collar.
  ...parcelHedges(700, 280, 520, 400, 26, {}, 56, { e: true }),
  ...parcelHedges(1290, 280, 660, 400, 26),
  ...parcelHedges(2100, 200, 480, 280, 26),
  ...parcelHedges(220, 1050, 280, 140, 24),
  ...parcelHedges(700, 1050, 520, 140, 24),
  ...parcelHedges(1600, 1050, 720, 140, 24),
  ...parcelHedges(2200, 1050, 320, 140, 24),
  ...parcelHedges(320, 1400, 480, 320, 26, {}, 56, { e: true }),
  ...parcelHedges(800, 1400, 480, 320, 26, {}, 56, { e: true }),
  ...parcelHedges(1280, 1400, 480, 320, 26, {}, 56, { e: true }),
  ...parcelHedges(1760, 1400, 480, 320, 26),
  // Goal approaches — hedges flank the millstone lanes, clear of the stones.
  srect(355, 754, 270, 22),
  srect(355, 826, 270, 18),
  srect(2045, 754, 270, 22),
  srect(2045, 826, 270, 18),
];

/** Ashbourne edge woodland — readable tree blocks, not fantasy clutter. */
const TOWN_FORESTS: ForestStand[] = [
  // North belt above the north parcels (trail cuts the gap to the NE block).
  srect(620, 72, 1240, 168),
  srect(2180, 170, 400, 280),
  srect(70, 560, 168, 340),
  srect(70, 1460, 200, 260),
  srect(2384, 720, 128, 500),
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
    slight(1200, 600),
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
  // High street — south verge, spaced so boxes never stack.
  frontY(760, HS_Y, HS_HALF, 84, 68, 1, 'The George & Dragon', 'pub'),
  frontY(980, HS_Y, HS_HALF, 88, 76, 1, 'The Green Man', 'pub'),
  frontY(1140, HS_Y, HS_HALF, 92, 58, 1, "Smith's Butcher", 'shop'),
  frontY(1340, HS_Y, HS_HALF, 80, 70, 1, 'The Horns', 'pub'),
  frontY(1560, HS_Y, HS_HALF, 90, 60, 1, 'Station Stores', 'shop'),
  // Market Place — halls on the north verge, shop on the south.
  frontY(1080, PLAZA_Y, PLAZA_HALF, 78, 88, -1, 'Market Hall', 'market', LANDMARK_SIZE),
  frontY(1300, PLAZA_Y, PLAZA_HALF, 72, 80, -1, 'Town Hall', 'hall', LANDMARK_SIZE),
  frontY(1120, PLAZA_Y, PLAZA_HALF, 100, 62, 1, 'Gingerbread Shop', 'shop'),
  // Compton — south of the brook, on the south trunk (not in a mid-band field).
  frontY(1080, COMPTON_Y, COMPTON_HALF, 96, 70, 1, 'The Vaults', 'pub'),
  frontY(1340, COMPTON_Y, COMPTON_HALF, 88, 72, 1, 'The White Hart', 'pub'),
  frontY(620, COMPTON_Y, COMPTON_HALF, 86, 64, 1, 'The Wheel', 'pub'),
  // Destinations on their own lanes.
  frontY(1900, COACH_Y, COACH_HALF, 104, 72, 1, 'The Coach & Horses', 'pub'),
  frontX(160, TRAIL_X, TRAIL_HALF, 78, 64, 1, 'The Baths', 'trailhead', LANDMARK_SIZE),
  slandmark(240, 500, 118, 86, "St Oswald's", 'church'),
  frontY(700, HS_Y, HS_HALF, 140, 68, -1, 'Old Grammar', 'school', LANDMARK_SIZE),
  // Ordinary terrace / cottage markers — core density, not landmarks.
  shouseY(900, HS_Y, HS_HALF, -1, 'High St 1'),
  shouseY(1040, HS_Y, HS_HALF, -1, 'High St 2'),
  shouseY(1360, HS_Y, HS_HALF, -1, 'High St 3'),
  shouseY(1500, HS_Y, HS_HALF, -1, 'High St 4'),
  shouseY(870, HS_Y, HS_HALF, 1, 'High St 5'),
  shouseY(1440, HS_Y, HS_HALF, 1, 'High St 6'),
  shouseY(1280, PLAZA_Y, PLAZA_HALF, 1, 'Market Row 1'),
  shouseX(615, CENTRE_X, CENTRE_HALF, -1, 'Market Row 2'),
  shouseX(615, CENTRE_X, CENTRE_HALF, 1, 'Dig St 1'),
  shouseX(760, CENTRE_X, CENTRE_HALF, 1, 'Dig St 2'),
  shouseY(780, COMPTON_Y, COMPTON_HALF, 1, 'Compton 1'),
  shouseY(1520, COMPTON_Y, COMPTON_HALF, 1, 'Compton 2'),
  // Clifton village — west column east verge, clear of the millstone hedges.
  shouseX(560, WEST_X, WEST_HALF, 1, 'Clifton 1'),
  shouseX(640, WEST_X, WEST_HALF, 1, 'Clifton 2'),
  shouseX(680, WEST_X, WEST_HALF, 1, 'Clifton 3'),
  shouseX(715, WEST_X, WEST_HALF, 1, 'Clifton 4'),
  // Sturston village — east column west verge + high-street end.
  shouseX(675, EAST_X, EAST_HALF, -1, 'Sturston 1'),
  shouseX(705, EAST_X, EAST_HALF, -1, 'Sturston 2'),
  shouseX(735, EAST_X, EAST_HALF, -1, 'Sturston 3'),
  shouseY(1880, HS_Y, HS_HALF, 1, 'Sturston 4'),
];

const GREEN_MAN = TOWN_BUILDINGS.find((b) => b.id === 'the-green-man')!;

export const ASHBOURNE_TOWN: TownMap = {
  width: sx(2400),
  height: sx(1600),

  obstacles: TOWN_BUILDINGS,

  outOfBounds: [
    srect(180, 240, 200, 200),
    srect(2220, 1420, 220, 220),
  ],

  river: srect(1200, 880, 2400, 120),

  bridges: [
    srect(400, 880, 64, 150),
    srect(1200, 880, 72, 150),
    srect(2000, 880, 64, 150),
  ],

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
