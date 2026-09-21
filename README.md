# Idle Space Particle Game

An idle game about gravity. Loose particles drift through empty space; you pull them in. What
you catch becomes mass, mass is gravity, and gravity catches more. Eventually the thing you
have built ignites, then collapses, then eats light itself.

Mass is the currency. You spend it on the pull, the reach, the density of the field, and the
worth of what you catch.

## Status

**Phase 1 — playable.** The core loop runs end to end: five upgrades, a live particle field,
Gravity Pulse, offline progress, versioned saves with an export string. Ignition at 1e12 mass
lands at roughly 43 minutes of play.

Next: Phase 2 — milestones, achievements, auto-buyers, the Energy resource and the element
chain.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run check` | Typecheck, including `.svelte` files |
| `npm run test` | Unit tests — economy, saves, pacing |
| `npm run test:e2e` | Browser smoke tests (Playwright) |
| `npm run build` | Production bundle into `dist/` |
| `npm run balance` | Pacing report: time to milestone, doubling time, gain per purchase |

## How it is put together

The economy simulation is authoritative and the particle field is a readout of it. Absorbed
particles are drawn at whatever rate makes the income legible; the number on screen would be
identical with the canvas switched off.

That split is the whole architecture. It means offline progress, exact big-number arithmetic
and the particle budget are three independent concerns rather than one tangle — and it means
`src/sim/` imports no DOM, no Pixi and no framework, so it runs in Node and gets real tests.

```
src/sim/      pure economy: numbers, upgrades-as-data, rates, offline, saves
src/render/   the particle field; the only place Pixi is imported
src/ui/       Svelte components, reading a view model refreshed at 12 Hz
src/game.svelte.ts   the loop: 20 Hz fixed tick, wall-clock reconciliation, autosave
tools/        headless pacing simulation
```

## Documents

- [Technology evaluation](docs/tech-evaluation.md) — the simulation/economy split, and the
  stack that follows from it
- [Game design](docs/game-design.md) — the core formula, upgrades, five acts, prestige layers
- [Implementation plan](docs/implementation-plan.md) — module layout, phases, testing, risks

## Stack

TypeScript · Vite · Svelte 5 · PixiJS v8 · break_infinity.js · Vitest · Playwright
