# Game Design

## Premise

You are a gravitational seed in cold, empty space. Loose particles drift past. You pull them
in. What you catch becomes mass; mass is gravity; gravity catches more. Eventually the thing
you have built ignites, then collapses, then eats light itself.

**Core loop:** particles → core → mass → upgrades → stronger pull → more particles.

## The screen

```
┌──────────────────────────────────────────────┬──────────────────┐
│                                              │  MASS  1.24e9 kg │
│              ·  ·        ·                   │  +4.82e6 /s      │
│         ·      ╲   ·   ╱      ·              ├──────────────────┤
│      ·     ·    ╲    ╱    ·                  │ Gravity Well  L7 │
│   ·      ·    ·  ╲ ╱  ·      ·   ·           │   ×1.12  4.2e5   │
│          ·  ·  ·(CORE) ·  ·  ·               │ Capture Radius L4│
│   ·      ·    ·  ╱ ╲  ·      ·   ·           │   +1.5   9.1e5   │
│      ·     ·    ╱    ╲    ·                  │ Density       L2 │
│         ·      ╱   ·   ╲      ·              │   +0.5   2.2e6   │
│              ·  ·        ·                   │ ...              │
│         [click anywhere: GRAVITY PULSE]      │                  │
└──────────────────────────────────────────────┴──────────────────┘
```

Left: the field. Right: the upgrade column. Everything the player needs in one view, no tabs
until Phase 3 earns them.

## The one number

```
massPerSecond = spawnRate × captureFraction × massPerParticle × globalMultiplier
```

Four terms, one per early upgrade, each visible in a tooltip breakdown. A player who reads
that tooltip understands the whole game. Every later system enters by multiplying one of
these four terms — that constraint keeps a 40-upgrade endgame comprehensible.

### Capture, and why it saturates

```
effectiveReach  = captureRadius × sqrt(gravity)
captureFraction = effectiveReach / (effectiveReach + K)        // K = 30, tuned
```

Asymptotic to 1, never reaching it. Radius and gravity always do something, never break the
game, and the curve gives Phase 2's "efficiency" upgrades room to matter without needing a
hard cap the player can bump into.

### Upgrade formulas

Base values: gravity 1, radius 10, spawn 4/s, mass 1 per particle — an opening rate of
1.00 mass/s against a first upgrade costing 10.

| Upgrade | Base cost | Growth | Effect / level | Unlocks at |
|---|---|---|---|---|
| Gravity Well | 10 | 1.25 | gravity ×1.20 | — |
| Capture Radius | 25 | 1.28 | radius +2.5 | — |
| Particle Density | 80 | 1.25 | spawnRate +1/s | 50 |
| Particle Mass | 300 | 1.35 | massPerParticle ×1.25 | 150 |
| Accretion Efficiency | 2,500 | 2.00 | global ×1.22 | 1,500 |

These came out of the balance tool, not out of the air. The ratio that decides everything is
`ln(effect) / ln(growth)`: below 1 an upgrade returns less than it costs and progress is
polynomial; at 1 income tracks spending and mass grows exponentially; above 1 it blows up in
finite time. The first tuning pass had every upgrade under 1 and took over two hours to reach
1e6. The second summed to ~1.5 across the late-game upgrades and collapsed 1e6 → 1e12 into
37 seconds. The shipped numbers put the two upgrades that survive to the late game
(Particle Mass at 0.74, Efficiency at 0.29) just over 1 combined.

Capture and reach saturate, so Gravity Well and Capture Radius are deliberately an opening:
they carry the first ten minutes and then hand over. Particle Density is additive against an
exponential cost, which makes it the cheap, frequent, always-something-to-buy upgrade rather
than an engine.

`cost(n) = base × growth^n`, so total for n levels is a geometric sum — closed form, which
"buy max" needs to stay instant at level 400.

Mixed growth rates are deliberate: cheap-and-frequent upgrades keep the early minutes clicky;
expensive-and-rare ones become the goals you save toward. The design target is a purchase
every **15-60 seconds** for the first hour.

### Active play: Gravity Pulse

Click the field (or press space) to emit a pulse that yanks nearby particles into the core: a
real visual event, worth 5 s of production or 3 particles outright — whichever is kinder, so
it is worth something on the very first click — on a 10 s cooldown. Active play is a modest bonus, never a
requirement — upgrades later automate it entirely. Idle games that punish you for closing the
tab don't get reopened.

## Progression

### Act I — Accretion (0-45 min)
The five upgrades above. Particles are grey hydrogen. First milestones at 1e3 / 1e6 / 1e9 mass
unlock, in order: the mass-rate readout, the Accretion Disk, and auto-buy.

- **Accretion Disk** — an orbiting ring that sweeps particles passively; tiered, and the first
  upgrade that visibly changes the field's shape.
- **Auto-buyers** — per upgrade, unlocked individually, each with an on/off toggle and a
  "keep under X% of income" priority. Automation is a reward, not a chore transfer.

### Act II — Ignition (45 min - 6 h)
At **1e12 kg** the core ignites. Fusion begins; a second resource appears.

- **Energy** accumulates from fusion, spends on multipliers mass cannot buy. Two currencies
  with genuinely different sinks — the standard fix for a single-currency game going flat.
- **Elements**: hydrogen → helium → carbon → oxygen → iron. Each tier needs a *fusion
  temperature* upgrade to unlock and multiplies `massPerParticle`. Particle colour in the
  field shifts with your dominant element, so the screen reports your progress without a
  number.
- **Magnetic Field** captures charged particles the gravity well misses — a second, parallel
  capture stat so the build has a choice in it.
- **Iron is a wall.** Fusing iron costs energy instead of producing it. Rate stalls. That's
  the prestige prompt, and it's the real astrophysics, which is worth something.

### Act III — Supernova (first prestige, ~6 h)
Collapse the core. Lose all mass, upgrades, energy, elements. Gain **Stardust**:

```
stardust = floor( 12 × (mass / 1e12) ^ 0.6 )
```

Exponent 0.6 means prestiging later earns more total but at falling efficiency, so there is a
real decision every run instead of one correct answer.

Stardust buys a permanent tree — global multiplier, starting mass, spawn rate, offline
efficiency, faster auto-buyers, cheaper upgrade scaling. The field becomes a nebula, pre-seeded
with heavy elements: run 2 reaches Act II in a fraction of the time and *feels* different, not
just faster.

### Act IV — Collapse (second prestige, ~40 h)
Enough stardust and the core collapses past its Schwarzschild radius. Reset stardust for
**Singularities**, and unlock mechanics rather than numbers:

- **Hawking Radiation** — passive mass while fully offline, the black hole's version of idle.
- **Relativistic Jets** — periodic burst production, an active layer that isn't clicking.
- **Time Dilation** — a literal simulation speed multiplier. Rare in the genre, obvious here.
- **Gravitational Lensing** — a shader that warps the starfield around the core. Pure spectacle
  and the best screenshot in the game.

### Act V — Galactic (endgame)
Core becomes a galactic nucleus; particles become stars, then dust lanes, then satellite
galaxies. Content here is **challenges** — runs under a restriction ("particles repel", "no
capture radius", "10x costs") that pay permanent multipliers. Cheap to author, high replay,
and they exercise systems that already exist.

## Supporting systems

- **Achievements** (~60), each a small global bonus. The cheapest retention mechanic there is.
- **Milestones** — automatic unlocks at mass thresholds; how the game teaches itself without
  tutorial text.
- **Statistics** — playtime, total mass ever, best run, prestige count, time-to-milestone.
- **Number notation** — scientific / engineering / letters, player's choice. Non-negotiable
  for this genre.
- **Settings** — particle budget slider (perf and taste), reduced motion, save export/import,
  hard reset behind a confirm.
- **Audio** — low drone that thickens with mass, a pitched swell per element tier, and one
  genuinely loud supernova. Muted by default; autoplay policies mean it must be anyway.

## Accessibility and performance targets

- `prefers-reduced-motion` → fewer particles, no camera shake, no bloom pulse.
- Colourblind-safe element palette; element tier is never signalled by colour alone.
- Full keyboard navigation of the upgrade column; the field is decorative and `aria-hidden`.
- 60 fps at 20k particles mid-range, 2k on mobile; economy tick < 1 ms; UI at 10-15 Hz.

## Balance methodology

Pacing gets tested, not guessed. A headless sim (`npm run balance`) plays the game with a
greedy buy-cheapest-first policy and prints time-to-milestone:

```
  1e3  mass                   4:48    gravity 11  radius 6  density 2
  1e6  mass                  29:13    gravity 39  radius 31  density 29  particleMass 19
  1e9  mass                  38:24    gravity 70  radius 59  density 60  particleMass 42
  1e12 mass  (ignition)      42:56    gravity 101 radius 87  density 92  particleMass 64

  first hour: 369 purchases   income doubles every 111s   (target 45-150s)
              +1.4% per purchase   (target 1-15%)   longest wait 25s
```

Counting purchases turned out to measure the bot's policy rather than the design — an agent
that buys the moment it can afford anything always buys one level at a time, whatever the
curve. Income doubling time and gain per purchase describe how the game *feels*, so those are
what get asserted.

The bounds in `tests/balance.test.ts` are generous on purpose. They are not claiming the
tuning is good; they catch a change that quietly doubles the first hour or collapses the last
three orders of magnitude into nothing. Both are easy to do by accident and invisible in a
five-minute play test.
