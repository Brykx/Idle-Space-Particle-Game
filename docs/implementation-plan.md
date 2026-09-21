# Implementation Plan

## Module layout

```
src/
  sim/                 # pure TypeScript — zero DOM, zero framework imports
    numbers.ts         # Decimal wrapper + notation formatting
    state.ts           # GameState type + initialState()
    upgrades.ts        # upgrade defs as DATA (id, cost curve, effect, unlock)
    stages.ts          # the stage ladder as DATA (threshold, blurb, analogue, look)
    economy.ts         # deriveRates(state) -> Rates ; tick(state, dt)
    offline.ts         # catch-up integration + away summary
    prestige.ts        # reset layers, stardust/singularity formulas
    save.ts            # serialize, deserialize, MIGRATIONS[]
  render/
    Field.ts           # the only file that imports pixi; init/setRates/pulse/destroy
    pool.ts            # pre-allocated particle pool, zero per-frame allocation
    effects.ts         # pulse, ignition, supernova, lensing
  ui/                  # Svelte components; read snapshots, dispatch intents
  game.ts              # the loop: accumulator, visibility, autosave — wires all three
  main.ts
tests/
  economy.test.ts  save-migration.test.ts  balance.test.ts
tools/
  balance.ts           # headless pacing sim -> time-to-milestone table
```

Three rules hold the whole thing together:

1. **`sim/` imports nothing.** Not pixi, not svelte, not `window`. It is testable in Node and
   replaceable wholesale.
2. **Upgrades are data, not code.** Adding one is an entry in `upgrades.ts`; the UI, the
   auto-buyers, the save format, and the balance tool all pick it up for free. This is what
   makes Acts II-V cheap instead of a rewrite each.
3. **The renderer never writes state.** It reads rates and emits intents. Turning the canvas
   off changes nothing but the view.

### The two functions everything hangs off

```ts
// pure: state -> every derived number. Called by UI, renderer, and tests alike.
export function deriveRates(s: GameState): Rates

// advance by exactly dt seconds, in place. The only place mass changes.
export function tick(s: GameState, dt: number): void
```

`tick` mutates rather than returning a clone: offline catch-up calls it up to a thousand
times in a row and the loop owns exactly one state object. `deriveRates` stays pure, which is
where purity actually buys something — the UI, the renderer, the balance tool and the tests
all call it freely.

Offline progress is then just `tick` in a loop with a coarse `dt`, which is why it stays
correct for free as systems are added.

## Phases

Each phase ends playable and committed. No phase depends on a later one existing.

### Phase 0 — Scaffold — **done**
Vite + TS + Svelte, strict mode, Vitest, ESLint/Prettier, GitHub Actions running typecheck
and tests, GitHub Pages deploy on `main`. Empty `GameState` that saves, loads, and survives
a refresh. Boring and load-bearing: a save system added in week three eats the week.

**Done when:** CI green, site deploys, a counter persists across reload.

### Phase 1 — Vertical slice — **done**
The full core loop, thin:
- `deriveRates` / `tick` with the four-term formula
- the five Act I upgrades, data-driven, with buy-1 / buy-max
- PixiJS field: pooled particles spawning at the rim, pulled toward the core, absorbed at the
  centre; density and speed driven by `Rates`
- Gravity Pulse on click
- offline progress + "while you were away"
- notation formatting, export/import save

**Done when:** it's fun for ten minutes with the sound off. If it isn't, the problem is
Act I's tuning and it is far cheaper to find now than after Act IV.

Shipped: 39 unit tests, 7 browser smoke tests, and a pacing report wired into CI. The tuning
went through three passes before the curve held its shape — see the balance section of the
design doc.

### Phase 2 — Depth and automation ← *in progress*

**Stage ladder — done.** Fourteen stages from dust to black hole, driven by lifetime mass,
each with its own core appearance that the renderer morphs between. It replaces the milestone
system rather than sitting alongside it: the stages *are* the milestones, they are the list
the balance tool reports against, and the two stages a collapse brings are shown greyed from
the first minute so the supernova is visible long before it is reachable.

Landing it meant retuning the economy. The ladder made an existing flaw impossible to ignore
— Density's additive effect decayed against an exponential cost, so minutes 5 to 25 gained
2.3 orders of magnitude while the following 15 gained 8, and five stages would have flown past
in seven minutes. Density is now multiplicative, the late-game cost exponents sum to 0.998,
and the curve is straight. See the balance section of the design doc.

Still to do:

- **Achievements** (~60), each a small global bonus
- **Accretion Disk** — an orbiting ring that sweeps particles passively; the first upgrade
  that changes the field's *shape*
- **Auto-buyers** — per upgrade, unlocked individually, with on/off and a priority rule
- **Energy** — a second resource from fusion, with sinks mass cannot buy
- **Element chain** — H → He → C → O → Fe, gating the star stages, multiplying mass per particle
- **Magnetic Field** — catches charged particles gravity misses
- **The iron wall** — fusing iron costs energy; the rate stalls, and that is the prestige prompt

**Done when:** a 6-hour session has something new every ~20 minutes.

### Phase 3 — Supernova prestige (~2 days)
Reset layers, stardust formula, the permanent tree, nebula restart state, the supernova
sequence itself. Tab navigation arrives here, because now there is enough to need it.

**Done when:** run 2 reaches the Brown Dwarf stage in under a third of run 1's time and feels
different doing it.

### Phase 4 — Visual pass (~2-3 days)
Custom shaders for core glow and bloom, particle trails, camera easing, audio layer. The
stage ladder gives this a concrete brief: fourteen distinct core appearances, of which the
current build has fourteen colour-and-size variations and no surface detail. The Phase 1
renderer interface means this touches `render/` only.

**Done when:** the moment the core ignites is worth recording.

### Phase 5 — Black hole + challenges (~3 days)
Second prestige, Hawking radiation, jets, time dilation, lensing shader, the challenge
framework, endgame content.

### Phase 6 — Ship (~2 days)
Balance pass driven by `tools/balance.ts`, mobile layout, PWA, Playwright smoke test,
performance profiling on a real low-end device, README and screenshots.

## Testing strategy

The economy is pure, so it gets real tests rather than token ones:

- **Determinism** — same seed + same inputs ⇒ byte-identical state after 10k ticks.
- **Offline equivalence** — 3600 ticks of 1 s and 36 ticks of 100 s land within tolerance.
  This is the bug that eats a weekend; catch it in Phase 1.
- **Cost curves** — `buyMax` spends exactly the geometric sum, never one credit over.
- **Save migrations** — a stored fixture per version, each one loading into current state.
- **Pacing** — `balance.test.ts` asserts time-to-milestone inside generous bounds, so a
  tuning tweak that doubles the first hour fails CI instead of shipping.

Rendering gets one Playwright smoke test (load, buy, reload, mass persisted) and otherwise
gets looked at by a human, which is the honest way to test a particle field.

## Risks

| Risk | Mitigation |
|---|---|
| Fun doesn't survive the slice | Phase 1 is deliberately front-loaded; retune or rethink before content exists |
| GC stutter in the field | Pre-allocated pool from the first commit; no per-particle allocation, ever |
| Float drift / save corruption | Fixed timestep, Decimal in the economy, versioned saves, export string |
| Balance collapses as systems stack | Every system multiplies one of four named terms; the cost exponents must keep summing to ~1, and `tests/balance.test.ts` compares the curve's early slope against its late slope to catch drift |
| Scope drift into Acts IV-V | Phases ship independently; the game is releasable from the end of Phase 3 |

## Suggested first commit after approval

Phase 0 and Phase 1 together, so the first thing reviewed is something playable rather than
a folder of config.
