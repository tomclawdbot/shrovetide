# Shrovetide

A top-down sports game (folk-football / "mob football" flavour) built on
**Phaser 3 + Vite**, with a **headless simulation core** that drives it.

This repo is **TICKET 002** — the v1 playable single-player match loop.
A scaled-down Ashbourne town map, 7v7 squads, switching, goaling, win state.

---

##Why split `/sim` from `/client`?

This codebase is structured around a single architectural decision:

> **The simulation is pure TypeScript with zero Phaser or DOM imports,
> and the client is a thin render + input layer.**

That exists for one reason: **when we add multiplayer, the same sim
runs on a Colyseus server** and the client just renders + sends inputs.
No game logic duplication. No "client is authoritative" exploits. No
desync between what the player sees and what the server simulates.

```
   ┌─────────────────────┐         ┌──────────────────────┐
   │      /client        │  reads  │        /sim          │
   │   (Phaser 3 only)   │ ───────▶│   (matter.js + TS)   │
   │                     │         │                      │
   │  · keyboard input   │  sends  │  · world state       │
   │  · camera + minimap │ ───────▶│  · physics step      │
   │  · HUD overlays     │ Input   │  · stamina model     │
   │  · no game logic    │         │  · NPC steering      │
   │                     │         │  · pass mechanic     │
   │                     │         │  · goaling (3-tap)   │
   │                     │         │  · match state mach. │
   │                     │         │  · role AI (HOLD/CHASE)│
   │                     │         │  · squad placement   │
   │                     │         │  · player switching  │
   └─────────────────────┘         └──────────────────────┘
                                            │
                                            ▼
                                    ┌──────────────────┐
                                    │   Node / Colyseus│
                                    │   (same code,    │
                                    │   no changes)    │
                                    └──────────────────┘
```

The contract between the two:

- **`/sim` exports** `createWorld`, `stepWorld(world, input, dt)`,
  `releasePass(world, aim, chargeSeconds)`, `tapGoal(world)`,
  `switchControl`, `quickSwitch`, `cycleTeammate`, `placeTeammate`,
  `setTeammateRole`, `startMatch`, `endMatch`. Everything else is internal.
- **`/client` calls** those functions. It reads `world.player`,
  `world.npcs`, `world.ball`, `world.map`, `world.score`,
  `world.matchState`, `world.winState` for rendering and writes
  `world.player.hasBall` only via the sim's `releasePass` API.
- The **`Input` struct** is pure state (`move`, `sprint`, `charging`,
  `passAim`, `goalTap`). The client maintains it; the sim consumes it.

### Multiplayer path (later ticket)

1. Server imports `/sim` directly — same physics, same AI, same RNG.
2. Client sends `Input` per tick.
3. Server runs `stepWorld(state, input, dt)` and broadcasts state.
4. Client renders. No client-side prediction in v1.

Determinism today: the sim uses a seeded RNG (`mulberry32`) and a fixed
timestep, so two clients running the same inputs from the same seed
produce byte-identical state. The 14-character town map runs cleanly
for 1000 ticks in `npm run test:sim`.

---

## Project layout

```
shrovetide/
├── client/                    # Phaser 3 scene + entry. NO game logic.
│   ├── GameScene.ts           # camera follow + minimap + switching + UI
│   └── index.ts               # Phaser game boot
├── sim/                       # Pure TypeScript. Imports only matter-js.
│   ├── index.ts               # public API barrel (the only import target)
│   ├── types.ts               # Vec2, Player, NPC, Ball, Input, SimState, etc.
│   ├── maps.ts                # TownMap data + zone helpers (NO logic)
│   ├── physics.ts             # matter.js wrapper; bodies keyed by id (Map)
│   ├── stamina.ts             # regen/drain model, speed mult at zero
│   ├── npc.ts                 # attraction steering + collision = "hug"
│   ├── pass.ts                # ball pickup + release with inaccuracy
│   ├── match.ts               # state machine + timer + opponent heuristic
│   ├── goaling.ts             # 3-tap scoring + adjacency check
│   ├── placement.ts           # squad placement (strategy phase)
│   ├── switching.ts           # controlled-character switching
│   └── world.ts               # createWorld + stepWorld orchestration
├── test/
│   └── sim.smoke.test.ts      # node --test, 6 tests incl. town map + goaling
├── index.html                 # Vite entry; mounts /client/index.ts
├── package.json
├── tsconfig.json              # strict mode
├── vite.config.ts
└── README.md
```

---

## Map data format (`sim/maps.ts`)

The town map is **pure data** — no logic. Physics, AI, and rendering all
read from it. Adding a new map = adding a new const + exporting it.

```ts
export interface TownMap {
  width: number;           // pixels
  height: number;          // pixels
  obstacles: Obstacle[];   // circle | rect — static collision bodies
  outOfBounds: RectZone[]; // player can't enter; ball teleports back
  river: RectZone;          // water — 50% speed
  bridges: RectZone[];      // walkable crossings over the river
  hedges: RectZone[];       // crawl — slower than river (~0.22×)
  goals: { team: 0 | 1; position: Vec2 }[]; // millstones
  turnUp: Vec2;             // ball spawn point (centre of map)
}
```

`ASHBOURNE_TOWN` is the default: 4800×3200 (2× the TICKET 002 town), two
millstones (one per team), horizontal river through the middle with
three bridges, hedgerows that crawl slower than water, nine town-core
building obstacles, two OOB zones (churchyard + memorial).

### Zone helpers (pure functions in `sim/maps.ts`)

| Helper                          | What it tells you |
| `pointInRect(p, r)`             | point inside rect (inclusive) |
| `isInObstacle(p, map)`          | inside any building |
| `isInRiver(p, map)` / `isOnBridge` | water vs walkable crossing |
| `isInWater(p, map)`             | in river but NOT on bridge → 50% speed |
| `isOutOfBounds(p, map)`         | churchyard / memorial — no entry |
| `isWalkable(p, map)`            | walkable for players/NPCs |
| `speedMultiplierAt(p, map)`     | 0.22 in hedge, 0.5 in water, 1.0 elsewhere |
| `goalFor(team, map)`            | millstone position |
| `opponentGoalFor(team, map)`    | the millstone a carrier can score on |
| `nearestLegalPoint(p, map)`     | snap-to-legal (used for ball OOB teleport) |

### Physics integration

`sim/physics.ts` turns obstacles + OOB zones into static matter.js
bodies. NPC steering (force-based) gets deflected around them naturally
via collision — the "hug" still works.

---

## Role AI (`sim/npc.ts`)

Every teammate NPC has a **role**: `hold` or `chase`. Opponents only
ever use `chase`. The player assigns roles during the strategy phase.

| Role   | Behaviour |
|--------|-----------|
| `chase` | Full commitment — steer toward ball (or carrier if player has ball). The TICKET 001 "hug". |
| `hold`  | Stay at `holdPosition`. Engage the ball only if it comes within `HOLD_BALL_ENGAGE_DISTANCE` (220px) of the hold spot. |

NPC speed is capped to `maxSpeed × speedMultiplierAt(position, map)`
so NPCs wade through water at 50%.

```
steerNPCs(world):
  for each NPC:
    target = pickTarget(npc, world)
    applyForce(toward target)
    clamp velocity to (maxSpeed × waterMult)
```

`pickTarget` is the role-aware bit — `chase` always, `hold` only when
ball is close. Water slow-down is universal.

---

## Switching (`sim/switching.ts`)

Only one character is controlled at a time (`world.player`). Switching
is instant — no cooldown per spec.

```
switchControl(world, targetId):
  if targetId is already controlled, return false
  if target is on the other team, return false
  if matchState !== 'playing', return false

  prev = world.player
  demoted = make NPC( id=prev.id, role=prev.assignedRole, ... )
  promoted = make Player( id=target.id, kind='player', ... )

  world.npcs[targetIdx] = demoted
  world.player = promoted
  relabel physics bodies

  reset goaling chain
  return true
```

The Map-keyed physics handle (`physics.bodies: Map<string, Body>`) is
what makes this cheap — no body shuffle, just label updates and a
swap swap of the player ↔ npcs reference.

Exposed to the client:

- **`switchControl(world, targetId)`** — direct.
- **`quickSwitch(world)`** — returns the id of the teammate nearest
  the ball, or `null` if already nearest.
- **`cycleTeammate(world)`** — switches to the first teammate (TAB
  binding cycles by re-calling).

The previously-controlled character reverts to its `assignedRole`
(stored on the player before the swap). The goaling chain resets
since the carrier context changed.

---

## Running

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc --noEmit && vite build → dist/
npm run preview      # serve dist/ at http://localhost:4173
npm run test:sim     # node --test, runs the sim smoke tests
npm run typecheck    # tsc --noEmit
```

---

## v1 scope (this ticket)

- **Town map**: Ashbourne — 4800×3200, river + 3 bridges, hedges, 9 obstacles
,
  2 OOB zones, 2 millstones. Camera follows the controlled player.
- **Match loop**: 8-minute timer, ball spawns at turn-up, goaling = 3
  taps with 0.5s spacing while adjacent to opponent's millstone, score
  ends match immediately. Timer expiry = draw.
- **Squad placement**: strategy phase before match. Player places 6
  teammates + assigns roles (HOLD/CHASE). Opponents (7) auto-place.
  "Start match" transitions to playing.
- **Player switching**: TAB cycles teammates, Q quick-switches to
  nearest teammate. Previous character reverts to its role AI.
- **HUD**: stamina bar, match timer, score, minimap (all 14 characters
  + ball, team-coloured), win screen on match end.

### Keys (default)

| Key | Action |
|---|---|
| WASD / Arrows | Move controlled character |
| Shift | Sprint (drains stamina when carrying ball) |
| Space (hold+release) | Pass |
| E | Goal-tap press |
| Tab | Cycle to next teammate |
| Q | Quick-switch to teammate nearest ball |

---

## Out of scope (later tickets)

Strategy-phase click-to-place UI + role-toggle UI (v1 ships with
autoPlace + startMatch from the client — playable end-to-end but no
manual placement yet). Multiplayer, grappling, Supabase.

---

## Architecture notes

- **Determinism**: `world._rng` is `mulberry32(world.rngSeed)`. Anything
  stochastic (pass inaccuracy, opponent placement jitter) reads from
  it, never from `Math.random()`. Matter.js itself is deterministic given
  identical initial state + identical `Engine.update(engine, dt)` calls.
  `npm run test:sim` includes a determinism check that runs 200 ticks
  on two identically-seeded worlds and asserts state match.
- **Fixed timestep**: `SIM_DT = 1/60`. The client uses an accumulator
  pattern and caps at 4 sub-steps per frame to prevent spiral-of-death
  after backgrounding.
- **Ball carrying**: when `ball.ownerId` matches a character's id, the
  sim syncs the ball's physics body to that character's position every
  tick (in `syncCarriedBall`). When the character passes, ownership
  clears and the ball becomes a free physics body with applied velocity.
- **Ball OOB teleport**: if `isOutOfBounds(ball.position)`, the ball is
  teleported to `nearestLegalPoint(ball.position)`. Used rarely — only
  if a pass lands in an OOB zone or physics kicks the ball there.
- **NPC speed cap**: matter.js force-based steering tends to drift past
  `maxSpeed` if you don't clamp, so `steerNPCs` clamps velocity each
  tick.
- **Map obstacles deflect the hug**: NPC steering is force-based toward
  the ball; matter.js collisions deflect them around buildings naturally.
  No pathfinding needed.
- **No client prediction in v1**: when multiplayer lands, the server is
  authoritative and the client renders whatever it last received.