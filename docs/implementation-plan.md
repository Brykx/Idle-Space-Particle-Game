# Implementation Plan

## Module layout

```
src/
  sim/                 # pure TypeScript — zero DOM, zero framework imports
    numbers.ts         # Decimal wrapper + notation formatting
    state.ts           # GameState type + initialState()
    upgrades.ts        # upgrade defs as DATA (id, cost curve, effect, unlock)
    stages.ts          # the stage ladder as DATA (threshold, blurb, analogue, look)
    elements.ts        # the fusion chain as DATA (multiplier, throughput needed)
    economy.ts         # deriveRates(state) -> Rates ; tick(state, dt)
    offline.ts         # catch-up integration + away summary
    prestige.ts        # reset layers, stardust/singularity formulas
    save.ts            # serialize, deserialize, MIGRATIONS[]
  render/
    Field.ts           # the only file that imports pixi; init/setRates/pulse/destroy
    shading.ts         # the GLSL: a shared impostor preamble + one surface per BodyKind
    impostor.ts        # Pixi plumbing for the shader bodies
    textures.ts        # procedural canvas bodies — the fallback when WebGL is unavailable
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

### Phase 2 — Depth and automation — **done**

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

**Particle trails — done.** Moved here from Phase 4 because it is cheap, depends on nothing,
and the field's readability is worth more now than later. Each sprite is stretched along its
own velocity — rotation from `atan2`, long axis scaled by speed — rather than trailed by
history sprites, so the particle budget is untouched. See "Reading the field" in the design
doc.

Implementing it turned up a latent bug: `scale` is not one of Pixi's particle dynamic
properties (size and anchor live in `vertex`), so per-frame scale changes had never been
uploaded and every particle had been rendering at the size set when the pool was built. The
per-particle size variation had been dead since Phase 1.

**Auto-buyers — done.** Each upgrade buys itself once you have taken it to level 25 by hand,
so automation is earned per upgrade rather than handed over at a milestone. Cheapest-first is
the priority rule: buying the cheapest raises its cost, so spending spreads itself and keeps
the frontier level. What it cannot do is notice that an upgrade has saturated — Gravity Well
would absorb income forever — so every card now shows what one more level does to income, and
the per-upgrade toggle is how you act on it. A reserve slider keeps a fraction of your mass
back for manual purchases.

They run inside `tick`, which is what makes an absence buy upgrades exactly as being present
would — and which turned the offline step size from a performance knob into a correctness
one. See the risk table.

**Achievements — 23 of a planned ~60.** Each multiplies everything by 1.02. Deliberately not
a mirror of the stage ladder, which already rewards getting heavier: these are about what you
did to get there — pulses fired, levels bought, capture fraction crossed, time away. They are
awarded inside `tick` too, so an absence earns them, and the balance tool earns them exactly
as a player would. Their effect on pacing is therefore measured rather than assumed: the full
set pulls the climb to Supergiant in from 1:25 to 1:07.

**The energy economy — done.** Accretion disk, energy as a second currency, the element
chain, Magnetic Confinement and Field Lines, and a tabbed side column to hold it. Written up
in the design doc; the short version is that all of it is one system and none of it works
alone. Three attempts at the coupling collapsed the ladder before the fourth held — see the
risk table.

Still to do:

- **A promotion pays, and Density rebases — done.** Reaching a stage multiplies income by
  `10 ^ (share x gap)`, derived from the ladder's own thresholds rather than fixed, and
  Particle Density resets and reprices at every promotion. The two are one change: shipping
  either alone either makes a promotion a punishment or collapses the curve to polynomial.
  Written up in the design doc, including the two numbers the concept got wrong and the bot
  bug the tuning uncovered. Save version 2, with the first migration this project has
  actually run.
- **Achievements — done, 61 of them.** Landmarks on the ladder, mass milestones, the element
  chain, the disk, upgrade depth, how you play, and the supernova. Each is worth 2%, so the
  full set is x3.35 — bounded, which is why it shifts the curve by about ten minutes rather
  than changing its slope. Measured: Supergiant moved from 1:15 to 1:04.

  `awardAchievements` takes the whole `Rates` now instead of a handful of scalars off it, so
  a new condition never means changing the signature and every call site with it.
- **The iron wall** — iron is already listed as unreachable, but reaching the end of the
  chain does not yet *stall* anything. Making it bite belongs with Phase 3, because a wall
  with no way through it is the worst state to leave a player in.

**Done when:** a 6-hour session has something new every ~20 minutes.

### Phase 3 — Supernova prestige — done

`sim/prestige.ts` holds all of it: the Stardust formula, the five-card permanent tree, and
the collapse itself. Everything the tree does to income enters `deriveRates` at a single
point, because a prestige layer that reaches into four terms is one nobody can balance.

**Measured against the bar.** Collapsing ten minutes past the top of the ladder pays 115
stardust, and run 2 reaches Brown Dwarf 3.2x faster — the bar was "under a third". The whole
ladder comes in 2.8x faster. Collapsing the instant the ladder tops out pays 12 and is worth
1.7x; waiting twenty-five minutes pays 7,450 and is worth 16x. That spread is the decision
the layer is built around, and `npm run balance` prints all three so a tuning change cannot
quietly flatten it.

**Stardust is a `Decimal`.** It goes as mass to the 0.6 and mass has no ceiling, so a plain
number stops counting somewhere in run three or four. The project already carries an exact
big-number type; a prestige currency opting out of it is a bug with a long fuse.

**What survives a collapse is chosen, not incidental.** Achievements, because you did them.
Levels *ever* bought, so a collapse never takes back an auto-buyer — the tree has its own
answer to automation and removing the floor at the moment you start over would make run two a
worse run one for twenty minutes. Auto-buy toggles, because they are a preference. Everything
else goes, `stageSeen` included, so the ladder announces itself again.

**The iron wall** turned out to need no new mechanic. The chain already stops at silicon and
the ladder already stops at Supergiant; what was missing was a way *through*, which is what
this phase is. The Collapse tab says so in as many words.

Still open here: the second prestige (Act IV) is Phase 5, and the Neutron Star and Black Hole
stages remain unreachable by play — the remnant is shown for six seconds after a collapse,
which is the only place that body appears in the game.

### Phase 4 — Visual pass — **mostly done**

- **Field identity per stage — done.** `StageLook` carries particle size, count, orbit range,
  drag and lifetime; particles get bigger and fewer as the core climbs, with the lit area
  rising only 2.6x across the ladder. Field *width* is the one part not done.
- **Core surface detail — done.** `StageLook` carries a `BodyKind`, and
  `render/textures.ts` draws one procedural canvas per kind at start-up: cratered irregular
  rocks, mottled worlds with an atmosphere limb, a banded gas giant with a storm, a dim
  self-lit ember, a hard star, a spiked neutron remnant, and a black hole that is an actual
  opaque hole with a ring. Solid kinds draw with normal blending so they occlude the field and
  can be dark on one side; only luminous kinds keep the additive glow.
- **Sphere impostors — done, all eight kinds.** A canvas body is a *picture* of an object:
  the lighting is baked in at start-up, so the terminator never moves and the detail is
  whatever 256px could hold. `render/shading.ts` computes the disc per pixel instead --
  recovering the sphere normal from the fragment position, then doing the lighting in GLSL,
  with surface detail sampled in *body* space so it rotates with the object and compresses
  correctly towards the limb. One quad and one draw call each.

  What each kind is made of:

  | kind | what the shader does |
  |---|---|
  | mote | a density field, no surface at all — the only kind with no edge anywhere |
  | rock | a displaced silhouette (it is not a sphere), craters and grain as a height field, relief from its gradient |
  | world | ocean, continents, ice at the poles and on high ground, a specular that only water gets, cloud on its own slower rotation, a scattering rim |
  | gas | anisotropic cloud noise — belts fall out of the sampling — plus a latitude shear, a storm fixed in body space, wrap lighting for a deep atmosphere |
  | ember | lit from *inside*: no terminator, brightest where you look straight down into it, with silicate weather drifting across the heat |
  | star | granulation, the real limb-darkening law, starspots in two activity belts, faculae at the limb, a chromosphere, a fanned corona and prominences |
  | remnant | a hard point with a photon ring, a plasma torus, and two beams on a magnetic axis tilted off the spin axis |
  | hole | an opaque shadow, a photon ring, a Doppler-beamed disc seen at a shallow angle, and its far side lensed over the top |

  Three things are worth keeping in mind before touching this:

  - **Shade in body space, not view space.** The light has to make the same trip as the
    normal, or a turning body's own features are lit from a direction that drifts as it
    rotates. `toBody` returns a matrix rather than applying one for exactly this reason.
  - **Rotate every fbm octave.** Value noise is built on an axis-aligned lattice, and octaves
    that share those axes line up: the lattice planes cut the sphere in the same places at
    every scale. On the star it came out as a bright Y across the disc.
  - **Exposure is a feature.** A star is bright enough to clip, and the granules, the spots
    and the limb all live in the top fifth of the range that clipping throws away.

  `textures.ts` stays as the fallback for a renderer that cannot run GLSL, and `bodies.html`
  (dev only, not in the build) mounts the field on its own so the last two stages — which
  carry no mass threshold and arrive with the supernova — can be looked at at all.
- **Field width per stage — done, and it is the weakest of the five levers.** `StageLook`
  carries a `width`, and the field narrows from filling the frame at Dust to 0.46 of it at
  Supergiant. Narrowing the spawn ring alone changed nothing visible, because a flyby swings
  wider than it started: the field only reads as having an edge once particles dim beyond it,
  which is the rule that had to be added to make the feature exist at all. Even then the
  effect is subtle next to size, count, orbit and body. Kept, but it earns less than the
  other four.

  Two real things came out of building it. `spawnRadius` and the screen's own reach were one
  number, and every use of it meant one of the two — the kill radius and the approach
  brightening both wanted the screen, the emission ring wanted the stage. And the particle
  fade-in was computed against the stage's `lifetime` rather than against the particle's own,
  which is a *negative* alpha for the three in ten that draw a longer life than average. They
  had been invisible for their first seconds since the pool was written.
- **A field that reads as a system — done.** `StageLook` carries a `grain` and a `tilt`.
  Grain decides what a single particle *is*: motes for dust, grit through the rocky middle,
  lit irregular meteoroids from Protoplanet up, drawn with normal blending so they have a
  dark side. Tilt flattens the field from face-on at Dust towards a disc seen from above its
  plane — the simulation still runs in the orbital plane and only the projection is squashed,
  which is exactly what a circular orbit looks like from an angle.

  The size-and-count ladder was rebalanced with it. The first pass took "bigger and fewer"
  far too far, and that was invisible while the sprites were white dots: a solar system does
  not read as a star surrounded by moons, it reads as a large central body and small traffic.

  Two things it exposed. Stretching a sprite along its velocity is what a streak *is*, and it
  works only because a soft dot has no shape to distort — lit bodies now keep their outline
  and tumble. And additive blending cannot occlude, so a meteoroid passing behind a star had
  the star's light added on top of it; everything with a surface now has an opaque hole
  punched for it first.
- **A night sky — done.** ~1800 stars with a power-law magnitude distribution, colour by
  temperature weighted towards the cool end, and a galactic band tilted across the frame. The
  old version was 260 identical dots at one brightness, which reads as noise on a lens. None
  of the three fixes is "more dots", and the reasoning is in `visual-design.md`. Seeded, so a
  resize does not reshuffle the constellations; static after build, one draw call.
- Remaining visual work is catalogued in `visual-design.md` rather than listed here, because
  it stopped being a to-do list and became a set of choices with costs against them. The
  short version: depth sorting across the disc, the core acting as the light source, a real
  supernova sequence, and a slow zoom out as the core climbs. Bloom is explicitly **not** on
  the list — see the direction section of that document for why.

The Phase 1 renderer interface means all of this touches `render/` only.

**Done when:** the moment the core ignites is worth recording. *Not yet true — the supernova
is currently a six-second remnant and a banner, and that is the one moment in the game that
should be worth recording.*

---

## The plan, re-examined

*Phases 1 to 3 shipped roughly as written. The order of what is left no longer does, and it is
worth saying why rather than quietly renumbering.*

**The game is releasable now.** The risk table below has said since the beginning that it is
releasable from the end of Phase 3, and Phase 3 has shipped: there is a first run of about an
hour, a supernova, a permanent tree, sixty-one achievements and a second run that is three
times faster. That is a complete idle game.

**It is not playable, though, because there is no phone layout.** The genre lives on phones —
it is a game you leave running and glance at, which is a description of a phone. Every hour
spent on a second prestige before that is an hour spent on content for players who cannot
reach the first.

**So shipping moves ahead of the black hole.** What was Phase 6 becomes Phase 5, and what was
Phase 5 becomes Phase 6. Nothing else changes.

There is a second, smaller reversal. The old Phase 5 bundled "second prestige" with
"challenges". Those are not one thing: the second prestige is the *content* the ladder's last
two stages exist for, and challenges are a retention mechanic for players who have exhausted
it. Splitting them means the black hole can ship without waiting for a framework nobody has
asked for yet.

### Phase 5 — Ship (~3 days)

- **Mobile layout.** The one blocking item. Field above, panel below, tabs as a bottom bar.
  The renderer already resizes; it is the panel that has never been asked to be narrow.
- **Performance on a real low-end device**, not on a desktop with the profiler open. The
  particle budget slider exists for this and has never been tested against a phone.
- **Balance pass** driven by `tools/balance.ts`, now that the promotion multiplier, the
  rebase, the achievement set and the prestige tree all interact.
- **PWA**, so it survives being added to a home screen and closed.
- README and screenshots.

**Done when:** someone can play it on a phone on a train without being told how.

### Phase 6 — The black hole (~3 days)

Second prestige. Accrete past the TOV limit, reset Stardust for Singularities, and unlock
*mechanics* rather than numbers: Hawking radiation as offline income, relativistic jets as an
active layer that is not clicking, time dilation as a literal simulation-speed multiplier, and
the lensing shader — which is worth much more now that there is a real starfield behind it to
bend.

This is also what finally makes the Neutron Star and Black Hole stages reachable by playing.
They have shaders and nobody can get to them; the collapse shows the remnant for six seconds
and that is the entire appearance of two of the fourteen bodies.

**Done when:** the second prestige changes how the game is played, not how fast.

### Phase 7 — Challenges (~2 days)

Restricted runs with their own rewards — no auto-buyers, no energy, a hard time limit. Cheap
to build on top of the existing state, because a challenge is a flag plus a predicate over
`deriveRates`, and the economy is pure.

Deliberately after the black hole: challenges are what you give a player who has finished
everything, and there is currently no "everything" to have finished.

### Phase 8 — The Bounce and the second half (vision only)

A third prestige that ends the inward game and starts an outward one: the core's interior
becomes a Big Bang, and the universe it seeds grows life at the Planet stage, up a Kardashev
ladder to a galactic civilisation. The currency it grants is not a multiplier but the physical
constants of the next universe.

Written up in the design doc. **Not scheduled**, and not to be started before the black hole
ships and people have played the first half — it is larger than everything before it put
together. It is recorded now so the first half is built without closing the door on it, which
mostly means keeping what is already true: ladders as data, the renderer behind an interface,
and an economy with no DOM in it.

## Testing strategy

The economy is pure, so it gets real tests rather than token ones:

- **Determinism** — same seed + same inputs ⇒ byte-identical state after 10k ticks.
- **Offline fidelity** — an absence must pay close to what being present pays, measured
  *relative to what was gained* rather than in absolute orders of magnitude, and the
  integration must be converged at the step size offline actually uses. Auto-buyers turned
  this from a formality into the sharpest test in the suite.
- **Cost curves** — `buyMax` spends exactly the geometric sum, never one credit over.
- **Save migrations** — a stored fixture per version, each one loading into current state.
- **Pacing** — `balance.test.ts` asserts time-to-stage inside generous bounds, and compares
  the curve's early slope against its late slope, so a tuning tweak that doubles the first
  hour, opens a wall, or collapses the late game fails CI instead of shipping.

Rendering gets one Playwright smoke test (load, buy, reload, mass persisted) and otherwise
gets looked at by a human, which is the honest way to test a particle field.

## Risks

| Risk | Mitigation |
|---|---|
| Fun doesn't survive the slice | Phase 1 is deliberately front-loaded; retune or rethink before content exists |
| GC stutter in the field | Pre-allocated pool from the first commit; no per-particle allocation, ever |
| Float drift / save corruption | Fixed timestep, Decimal in the economy, versioned saves, export string |
| Balance collapses as systems stack | Every system multiplies one of four named terms; the cost exponents must keep summing to ~1, and `tests/balance.test.ts` compares the curve's early slope against its late slope to catch drift |
| A flat multiplier silently rescales the whole game | With cost exponents summing to ~1, income tracks capital, so any constant multiplier changes the growth *rate*. A x1500 element chain made the game ~70x faster. Multipliers stay small, and `tests/energy.test.ts` asserts the top of the chain stays under x10 |
| Feedback between the two currencies | Energy is taxed from the *raw* infall, before the element multiplier, so a tier can never fund the disk level that reaches the next tier. Gating tiers on throughput rather than on energy/second stops fixed thresholds from being crossed all at once as income inflates |
| Offline quietly pays less than being present | Auto-buyers make income a feedback loop, so the catch-up step size now sets accuracy, not just speed. Steps are capped at half a second while automation is running (60s when it is not, where the rate barely moves), and a test asserts the integration is converged at that step |
| Scope drift into Acts IV-V | Phases ship independently; the game is releasable from the end of Phase 3 |

## What is open

Phases 5 through 8, in the order above, plus the tail of Phase 4.

The game is complete enough to release: a first run of about an hour, a supernova that pays,
a permanent tree, sixty-one achievements, and a second run three times faster. What it is
missing is not content.

**The one blocking item is a mobile layout.** Everything else on the list is an improvement to
a game people can already play; that one decides whether they can play it at all.

After it, in order: depth sorting across the disc (`visual-design.md` F1), a real supernova
sequence (B5), the core acting as the light source (L1), then the black hole.

Two things are designed and not built, and both are recorded rather than forgotten:

- **Second-tier upgrades** — Frame Dragging, Tidal Shear, Radiation Pressure. The Core tab
  stops changing about twenty minutes in, and rebasing Density fixed its *pacing* without
  adding any variety. Each one adds to the cost-exponent sum, so each must take share from a
  tier-one upgrade or be tuned small.
- **Capture is finished by design and the cards say so.** Gravity Well and Capture Radius
  read `+0.00% income` for most of a run. Rebasing them was considered and rejected — capture
  is bounded at 1, so resetting it costs a fixed ~4x at every promotion and the promotion
  multiplier would have to be inflated by the same 4x to cancel it. Two large numbers whose
  visible net effect is what you would get from neither is bookkeeping, not a mechanic. The
  honest reading is that capture is an *onboarding* term: bounded, front-loaded, finished.
