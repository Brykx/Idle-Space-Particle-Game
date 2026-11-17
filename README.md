# Idle Space Particle Game

An idle game about gravity. Loose particles drift through empty space; you pull them in. What
you catch becomes mass, mass is gravity, and gravity catches more. Eventually the thing you
have built ignites — and when you let it go, it takes a place in your night sky for good.

It is meant to be calm. Nothing asks for you: being present is pleasant and never required,
and being away costs nothing.

## What it is now

**A run is one star.** It condenses out of a cloud, climbs a ladder of real bodies — dust,
pebble, planetesimal, planet, gas giant, brown dwarf — ignites, and grows through the
spectral classes its cloud allows, M through O, until the cloud is spent. The field thins as
it happens, and a finished star sits alone in a cleared sky.

**Then you let it go.** What happens depends on its mass, as it does in the sky: a red dwarf
simply rises; a star up to eight solar masses sheds a shell of glowing gas around a white
dwarf; anything heavier ends in a supernova. Its light rises to its own place in your sky,
with its name and the day you made it, and every run after is played in front of the ones
before. Then you choose the next cloud — small and quick, or vast and slow — from three or
more on offer.

**The rest is quiet.** Each upgrade is a *current*: begun once by hand, after which it flows
by itself, buying whatever repays itself soonest and leaving alone whatever would not. The
screen is the field and a single caption — the stage, the mass in words, a hairline, and a
rough sense of when — with everything else in a sheet you summon. Sound, if you want it, is
a generated drone that follows the body in the middle of the screen.

The first star takes about two hours. The largest the sky allows is a couple of weeks of
looking in now and then. The reasoning behind all of it is in
[the zen redesign](docs/zen-redesign.md).

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run check` | Typecheck, including `.svelte` files |
| `npm run test` | Unit tests — economy, clouds, the sky, saves, pacing, careers |
| `npm run test:e2e` | Browser tests (Playwright), including a phone viewport and the audio |
| `npm run build` | Production bundle into `dist/` |
| `npm run balance` | Pacing report: the first star stage by stage, and whole careers on a calendar |
| `npm run bodies` | A gallery of every body, release and sky, at `/bodies.html?stage=…` |

## How it is put together

The economy simulation is authoritative and the particle field is a readout of it. Absorbed
particles are drawn at whatever rate makes the income legible; the number on screen would be
identical with the canvas switched off.

That split is the whole architecture. It means offline progress, exact big-number arithmetic
and the particle budget are three independent concerns rather than one tangle — and it means
`src/sim/` imports no DOM, no Pixi and no framework, so it runs in Node and gets real tests.

```
src/sim/      pure economy: numbers, upgrades, stages, clouds and the sky as data;
              rates, automation, offline, forecasts, saves
src/render/   the field, the sky, the release; the only place Pixi is imported
src/audio/    the generated ambience
src/ui/       Svelte components: the caption, the sheet and its pages
src/game.svelte.ts   the loop: 20 Hz fixed tick, wall-clock reconciliation, autosave
tools/        headless pacing and career simulation; the body gallery
```

## Documents

- [The zen redesign](docs/zen-redesign.md) — what the game asks of the player and gives back,
  and the measurements it was tuned to
- [Game design](docs/game-design.md) — the core formula, the ladder, the economy
- [Visual design](docs/visual-design.md) — real in the window, minimal in the margins
- [Implementation plan](docs/implementation-plan.md) — module layout, phases, testing, risks
- [Technology evaluation](docs/tech-evaluation.md) — the simulation/economy split, and the
  stack that follows from it

## Licence

All rights reserved. The source is public to read and to play; it is not licensed for reuse.
See [LICENSE](LICENSE).

## Stack

TypeScript · Vite · Svelte 5 · PixiJS v8 · Web Audio · break_infinity.js · Vitest · Playwright
