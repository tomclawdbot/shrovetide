# Shrovetide — agent operating model

Shared contract for **Grok/Clawdbot Cos** and **Cursor Cloud**.
Do not stand up four permanent Cursor agents. Roles are lenses on one coding agent, plus Cos for planning/triage.

## Division of labour

| Role | Owns | Does not own |
|------|------|--------------|
| **Chief of Staff (Cos)** | Intent, priorities, tickets, trade-offs, “what next”, Grok↔Cursor routing | Large code edits, PRs, running the game |
| **Developer** | Code in `/sim` + `/client`, architecture, focused PRs | Product priority calls, UX taste debates without evidence |
| **Tester** | Smoke tests, repro steps, playability checks, “prove it works” | Feature design, drive-by refactors |
| **UX** | First-run feel, HUD/teach chain, clarity of controls, climax moments | Backend/sim internals unless they break feel |

In **Cursor**: one agent wears Developer + Tester + UX for the task at hand.
In **Grok**: Cos stays Cos; Dev/Tester/UX personas advise Cos, they do not fork conflicting instructions to Cursor.

## Architecture invariants (non-negotiable)

- `/sim` is pure TypeScript (matter.js + TS only). No Phaser/DOM imports.
- `/client` is thin: render + input only. Game logic lives in `/sim`.
- Public sim API stays the barrel in `sim/index.ts`. Prefer extending it over leaking internals.
- Determinism: seeded RNG (`mulberry32`), fixed `SIM_DT`, no `Math.random()` in sim.
- Prefer small, focused PRs that leave the match loop playable.

## Playability bar (Tester + UX)

- First run must feel like running (~human pace), not rocket motion.
- Carrier must be able to reach and hold the millstone long enough for the 3-tap goal.
- Teach/HUD must not sabotage the climax (e.g. teaching Shift right before a stamina-critical goal).
- HUD and sim must agree on goal reach / scores / state.
- Preserve flow: title → place → kickoff → match → Again.

## Handoff protocol

### Cos → Cursor (implementation request)

Paste a short brief:

```
Goal: <one sentence>
Why: <player-facing or tech reason>
Scope: <files / systems; what is out of scope>
Done when:
- <observable playability or behaviour>
- npm run test:sim passes
- npm run typecheck passes
Constraints: <from AGENTS.md / tickets>
```

### Cursor → Cos (result)

```
Done: <what changed>
PR: <url>
Verified: <tests / browser notes>
Not done / risks: <honest leftovers>
Suggested next: <one Cos decision, if any>
```

## Anti-patterns

- Parallel permanent Cursor agents named Cos / Dev / Tester / UX.
- Cos rewriting code while Cursor has an open PR on the same files.
- Cursor inventing product priority without Cos when Cos already set a queue.
- “Full rewrite” when a focused fix restores the playable loop.
