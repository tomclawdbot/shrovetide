# Shrovetide

A top-down sports game (folk-football / "mob football" flavour) built on
**Phaser 3 + Vite**, with a **headless simulation core** that drives it.

This repo is **TICKET 001** — the scaffold that everything else will hang
off. v0 is a one-field physics/stamina/pass playground so the architecture
is real before the gameplay gets ambitious.

---

## Why split `/sim` from `/client`?

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
   │  · sprites + HUD    │ ───────▶│  · physics step      │
   │  · no game logic    │ Input   │  · stamina model     │
   │                     │         │  · NPC steering      │
   │                     │         │  · pass mechanic     │
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
  and `releasePass(world, aim, chargeSeconds)`. That's it. Everything
  else is internal.
- **`/client` calls** those functions. It reads `world.player`,
  `world.npcs`, `world.ball` for rendering and writes
  `world.player.hasBall` only via the sim's `releasePass` API.
- The **`Input` struct** is pure state (`move`, `sprint`, `charging`,
  `passAim`). The client maintains it; the sim consumes it.

### Multiplayer path (later ticket)

1. Server imports `/sim` directly — same physics, same AI, same RNG.
2. Client sends `Input` per tick.
3. Server runs `stepWorld(state, input, dt)` and broadcasts state.
4. Client renders. No client-side prediction in v0.

Determinism today: the sim uses a seeded RNG (`mulberry32`) and a fixed
timestep, so two clients running the same inputs from the same seed
produce byte-identical state. That's the foundation for lockstep or
server-authoritative multiplayer.

---

## Project layout

```
shrovetide/
├── client/                    # Phaser 3 scene + entry. NO game logic.
│   ├── GameScene.ts           # input → stepWorld → render
│   └── index.ts               # Phaser game boot
├── sim/                       # Pure TypeScript. Imports only matter-js.
│   ├── index.ts               # public API barrel (the only import target)
│   ├── types.ts               # Vec2, Player, NPC, Ball, Input, SimState
│   ├── physics.ts             # matter.js wrapper, circle bodies, walls
│   ├── stamina.ts             # regen/drain model, speed mult at zero
│   ├── npc.ts                 # attraction steering + collision = "hug"
│   ├── pass.ts                # ball pickup + release with inaccuracy
│   └── world.ts               # createWorld + stepWorld orchestration
├── test/
│   └── sim.smoke.test.ts      # node --test, 1000 ticks, determinism, stamina
├── index.html                 # Vite entry; mounts /client/index.ts
├── package.json
├── tsconfig.json              # strict mode
├── vite.config.ts
└── README.md
```

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

## v0 scope (this ticket)

- One green field (1200×800), one ball
- 1 player-controlled character (WASD/arrows)
- 30 NPCs split into two teams (15 green, 15 red) that swarm the ball
  with attraction steering — collisions pile them up into a "hug"
- Stamina bar: sprint-with-ball drains (−30/sec), idle regens (+22/sec);
  at 0 → 40% slower (×0.6)
- Pass: hold `Space` to charge, release in the current movement
  direction. Inaccuracy scales with charge (short tap = wild,
  full charge = controlled).

## Out of scope (later tickets)

Town map, squad placement, switching, multiplayer, grappling, Supabase.

---

## Architecture notes

- **Determinism**: `world._rng` is `mulberry32(world.rngSeed)`. Anything
  stochastic (currently just pass inaccuracy) reads from it, never from
  `Math.random()`. Matter.js itself is deterministic given identical
  initial state + identical `Engine.update(engine, dt)` calls.
- **Fixed timestep**: `SIM_DT = 1/60`. The client uses an accumulator
  pattern and caps at 4 sub-steps per frame to prevent spiral-of-death
  after backgrounding.
- **Ball carrying**: when `ball.ownerId === player.id`, the sim syncs
  the ball's physics body to the player's position every tick (in
  `syncCarriedBall`). When the player passes, ownership clears and the
  ball becomes a free physics body with an applied velocity.
- **NPC speed cap**: matter.js force-based steering tends to drift past
  `maxSpeed` if you don't clamp, so `steerNPCs` clamps velocity each tick.
- **No client prediction in v0**: when multiplayer lands, the server is
  authoritative and the client renders whatever it last received.
