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

### Reading the field

The field's job is to make the economy legible at a glance: how much is arriving, how much of
it you are catching, and how hard you are pulling. Three things carry that.

**Density** — how many particles are on screen, driven by `spawnRate`.

**The catch ratio** — every particle rolls against `captureFraction` when it spawns, so the
proportion that spiral in versus swing past is the same proportion the number is built from.
The near-misses are not decoration; they are what makes the capture upgrades legible.

**Motion** — and this is the one the current build under-serves.

#### Particle trails

A still frame of the field reads as a starfield: a scatter of dots with no direction. In
motion the inward drift is there, but it is subtle, and the moment a Gravity Pulse yanks
everything toward the core should be unmistakable. A short trail on each particle makes speed
and direction readable in a single frame.

How it is done matters, because the field is a pooled `ParticleContainer` holding exactly one
sprite per particle with no per-frame allocation. The obvious implementation — a few history
sprites trailing each particle — multiplies the particle budget by that number and throws
away the property the pool exists to protect.

Instead: **stretch each sprite along its own velocity vector.** Take rotation from
`atan2(vy, vx)` and scale the sprite's long axis with speed, leaving the short axis alone.
The particle texture is a soft radial dot, so stretching it produces a streak for free.

- No extra sprites and no extra draw calls; the budget slider keeps meaning what it says
- Costs one more dynamic property on the container (`rotation`) and an `atan2` per particle
- Falls out of the physics rather than being layered on top: particles accelerate as they
  fall, so streaks lengthen towards the core exactly where the motion is most interesting,
  and a pulse turns the whole field into inward streaks in a single frame

Two things to watch. Additive blending means overlapping streaks stack, so the stretch needs
a ceiling or the centre blows out at high particle counts. And a trail is motion, so under
`prefers-reduced-motion` it shortens to nothing — which the stretch factor makes a one-line
change rather than a separate code path.

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

| Upgrade | Base cost | Growth | Effect / level | Unlocks at | Ratio |
|---|---|---|---|---|---|
| Gravity Well | 10 | 1.425 | gravity ×1.34 | — | 0.41 (saturates) |
| Capture Radius | 25 | 1.50 | radius +4 | — | additive (saturates) |
| Particle Density | 30 | 1.685 | spawnRate ×1.165 | 20 | 0.29 |
| Particle Mass | 100 | 1.826 | massPerParticle ×1.34 | 250 | 0.49 |
| Accretion Efficiency | 750 | 3.79 | global ×1.34 | 1,200 | 0.22 |

### The ratio that decides everything

`ln(effect) / ln(growth)` is how much income an upgrade returns per order of magnitude spent.
Below 1 it returns less than it costs and progress is polynomial. **At exactly 1, income
tracks spending and mass climbs at a constant number of orders of magnitude per minute.**
Above 1 it blows up in finite time.

The three upgrades that survive to the late game sum to
**0.998** — near enough to 1 that the curve is a straight line in log
space. Gravity Well and Capture Radius sit outside that sum on purpose: both feed a capture
fraction that saturates towards 1, so they are cheap, strong, and finished within ten minutes.
They are the opening, not an engine.

Getting here took five passes:

1. Every upgrade below 1 → polynomial. 1e6 took over two hours.
2. Late-game upgrades summing to ~1.5 → finite-time blowup. 1e6 to 1e12 in 37 seconds.
3. Density additive against an exponential cost → its returns decayed to nothing, opening a
   dead zone where minutes 5-25 gained 2.3 orders and the next 15 gained 8. Making density
   multiplicative closed it.
4. Sum at 1.00 → dead straight, but 275s per doubling. Too slow.
5. Base costs cut to raise the rate constant, then effects and growth scaled together to make
   purchases chunkier without touching pacing. 89s per doubling, +2.1% per purchase.

The rate constant and the shape are separate dials, which is what made the last two passes
possible: `Π baseCost^ratio` sets how fast, the ratio sum sets whether it stays straight.

### Active play: Gravity Pulse

Click the field (or press space) to emit a pulse that yanks nearby particles into the core: a
real visual event, worth 5 s of production or 3 particles outright — whichever is kinder, so
it is worth something on the very first click — on a 10 s cooldown. Active play is a modest bonus, never a
requirement — upgrades later automate it entirely. Idle games that punish you for closing the
tab don't get reopened.

## The stage ladder

The number is abstract; the thing in the middle of the screen is not. Every threshold on the
ladder changes what you are, and the core visibly morphs into it.

```
dust → pebble → boulder → planetesimal → asteroid → protoplanet → planet   accretion,  mass ↑
planet → gas giant → brown dwarf → red dwarf → star → supergiant           accretes H, mass ↑
★ supergiant ──SUPERNOVA──> neutron star                                   mass ↓ ~90%: RESET
neutron star → black hole                                                  past TOV,   mass ↑
```

Driven by lifetime mass, not current mass, so spending never demotes your core. You built
those upgrades out of what you caught; the core keeps what it was.

### Why the ladder resets where it does

The physics is mostly honest, and where it isn't, the break is useful.

**Dust through planet is core accretion** — real, and gravity-driven once you pass about a
kilometre. Below that, grains stick by electrostatic and van der Waals forces rather than by
gravity, which is why Planetesimal's blurb is the first to mention your own gravity holding
you together.

**Planet through star works, as long as what you accrete is hydrogen.** A rocky planet does
not become a star by putting on more rock; stars form top-down from collapsing gas clouds.
But gas giant → brown dwarf (13 Jupiter masses, deuterium fusion) → red dwarf (~0.08 solar
masses, hydrogen fusion) is a real, mass-gated sequence. Phase 2's element chain is what
gates it in the game, which means the correction pays for a system already planned.

**Star to neutron star is the one that runs backwards.** A star does not become a neutron
star by gaining mass. It runs out of fuel, its core collapses, and it throws roughly ninety
percent of itself away. A 20-solar-mass star leaves a 1.4-solar-mass remnant.

That is a prestige reset. You lose nearly everything and keep a far denser core plus the
heavy elements you scattered — and supernovae genuinely are where most heavy elements come
from, so Stardust stops being a game-ism and becomes the mechanism. The last two stages
therefore carry no threshold at all: no amount of accretion reaches them.

**Neutron star to black hole is correct and mass-driven.** Past the Tolman-Oppenheimer-
Volkoff limit (~2.2-2.9 solar masses) nothing holds it up. A pure threshold, no reset.

### Units

Mass is unitless, and each stage carries its real-world analogue as flavour — "≈ Earth",
"≈ Ceres". Making the currency literal kilograms was tempting, and the thresholds would have
written themselves, but prestige multipliers blow past any real threshold within two runs, at
which point literal units become a lie you have to keep maintaining.

### Thresholds

Placed against the measured curve rather than on round numbers, so promotions arrive on a
rhythm: roughly four minutes apart at the start, stretching to eleven by the top.

| Stage | Threshold | Reached at | Analogue |
|---|---|---|---|
| Dust | 0 | start | a grain of interstellar dust |
| Pebble | 100 | 0:50 | a handful of gravel |
| Boulder | 2e3 | 4:46 | a boulder |
| Planetesimal | 4e4 | 11:06 | a 1 km planetesimal |
| Asteroid | 6e5 | 17:02 | Ceres |
| Protoplanet | 1.5e7 | 23:57 | the Moon |
| Planet | 6e8 | 32:08 | Earth |
| Gas Giant | 4e10 | 41:12 | Jupiter |
| Brown Dwarf | 4e12 | 51:06 | 13 Jupiter masses |
| Red Dwarf | 6e14 | 1:02:06 | 0.08 solar masses |
| Star | 1.2e17 | 1:13:52 | the Sun |
| Supergiant | 1.5e19 | 1:24:42 | 20 solar masses |
| Neutron Star | — | supernova | 1.4 solar masses |
| Black Hole | — | past TOV | beyond 2.3 solar masses |

## Progression

### Act I — Accretion (0-30 min)
The five upgrades. Particles are grey hydrogen, and the core climbs from dust to protoplanet.

### Act II — Ignition (30 min - 2 h)
The core passes Gas Giant and starts keeping the hydrogen it catches.

- **Energy** accumulates from fusion and spends on multipliers mass cannot buy. Two currencies
  with genuinely different sinks — the standard fix for a single-currency game going flat.
- **Elements**: hydrogen → helium → carbon → oxygen → iron. Each tier needs a *fusion
  temperature* upgrade and multiplies `massPerParticle`. Particle colour in the field already
  tracks your stage, so the screen reports progress without a number.
- **Magnetic Field** captures charged particles the gravity well misses — a second, parallel
  capture stat so the build has a choice in it.
- **Iron is a wall.** Fusing iron costs energy instead of producing it. The rate stalls. That
  is the prestige prompt, it is the real astrophysics, and it is the brake the curve needs.

### Act III — Supernova (first prestige)
Collapse the supergiant. Lose the mass, the upgrades, the energy, the elements. Gain
**Stardust**:

```
stardust = floor( 12 × (mass / threshold) ^ 0.6 )
```

Exponent 0.6 means prestiging later earns more in total but at falling efficiency, so there is
a real decision every run instead of one correct answer.

Stardust buys a permanent tree — global multiplier, starting mass, spawn rate, offline
efficiency, faster auto-buyers, cheaper upgrade scaling. You restart as a neutron star in a
nebula seeded with heavy elements: run 2 reaches Act II in a fraction of the time and *feels*
different, not just faster.

### Act IV — Collapse (second prestige)
Accrete past the TOV limit and the neutron star becomes a black hole. Reset Stardust for
**Singularities**, and unlock mechanics rather than numbers:

- **Hawking Radiation** — passive mass while fully offline, the black hole's version of idle.
- **Relativistic Jets** — periodic burst production, an active layer that isn't clicking.
- **Time Dilation** — a literal simulation speed multiplier. Rare in the genre, obvious here.
- **Gravitational Lensing** — a shader that warps the starfield around the core. Pure
  spectacle and the best screenshot in the game.

### Act V — Galactic (endgame)
The black hole becomes a galactic nucleus; particles become stars, then dust lanes, then
satellite galaxies. Content here is **challenges** — runs under a restriction ("particles
repel", "no capture radius", "10x costs") that pay permanent multipliers. Cheap to author,
high replay, and they exercise systems that already exist.

## Supporting systems

### Automation

**Auto-buyers** unlock per upgrade, at level 25 of that upgrade. Automation is earned where
you have already invested, which makes it a reward for engaging with an upgrade rather than a
single milestone that hands the game over.

The priority rule is cheapest-first, and it self-balances: buying the cheapest raises its
cost, so spending spreads across everything enabled and keeps the next costs roughly level.
Its blind spot is saturation — Gravity Well feeds a capture fraction that asymptotes, and
cheapest-first would happily pour income into it forever. So every upgrade card shows what
one more level does to income, and the per-upgrade toggle is how the player acts on it. The
information and the control are the same feature.

A **reserve** slider holds back a fraction of your mass, so automation can handle the cheap
end while you save towards something by hand.

### Achievements

23 so far, of a planned ~60. Each multiplies everything by 1.02.

That sounds small and is not: a constant multiplier scales the growth *rate*, not just the
total, so across a run that gains 26 orders of magnitude a single 2% achievement is worth
about half an order. The full set pulls the climb to Supergiant in from 1:25 to 1:07.

They avoid mirroring the stage ladder, which already rewards getting heavier. These are about
what you did to get there: pulses fired, levels bought, crossing half and then ninety percent
capture, switching on automation, coming back after a day away.

### The rest

- **Statistics** — playtime, purchases, pulses, achievements.
- **Number notation** — scientific / engineering / letters, player's choice. Non-negotiable
  for this genre.
- **Settings** — particle budget slider (perf and taste), reduced motion, auto-buy reserve,
  save export/import, hard reset behind a confirm.
- **Audio** — low drone that thickens with mass, a pitched swell per stage, and one genuinely
  loud supernova. Muted by default; autoplay policies mean it must be anyway.

## Accessibility and performance targets

- `prefers-reduced-motion` → fewer particles, no particle trails, no camera shake, no bloom pulse.
- Colourblind-safe element palette; element tier is never signalled by colour alone.
- Full keyboard navigation of the upgrade column; the field is decorative and `aria-hidden`.
- 60 fps at 20k particles mid-range, 2k on mobile; economy tick < 1 ms; UI at 10-15 Hz.

## Balance methodology

Pacing gets tested, not guessed. A headless sim (`npm run balance`) plays the game with a
greedy buy-cheapest-first policy and prints time-to-milestone:

```
  Pebble                100        50s
  Boulder           2.000e3       4:46
  Planetesimal      4.000e4      11:06
  Asteroid          6.000e5      17:02
  Protoplanet       1.500e7      23:57
  Planet            6.000e8      32:08
  Gas Giant        4.000e10      41:12
  Brown Dwarf      4.000e12      51:06
  Red Dwarf        6.000e14    1:02:06
  Star             1.200e17    1:13:52
  Supergiant       1.500e19    1:24:42

  curve shape — log10(mass) every 5 minutes
  0m:0.7  5m:3.3  10m:4.4  15m:5.4  20m:6.4  25m:7.4  30m:8.4  35m:9.4  40m:10.4
  45m:11.4  50m:12.4  55m:13.4  60m:14.4  65m:15.4  70m:16.3  75m:17.3  80m:18.3

  first hour: 265 purchases   income doubles every 89s   (target 45-150s)
              +2.1% per purchase   (target 1-15%)   longest wait 20s
```

The stage ladder *is* the milestone list, so a threshold moved in `sim/stages.ts` shows up
here without anything else changing.

Two metrics were wrong before they were right. Counting purchases turned outCounting purchases turned out to measure the bot's policy rather than the design — an agent
that buys the moment it can afford anything always buys one level at a time, whatever the
curve. And doubling time was first computed as a median of per-interval rates, which measured
the sampling cadence rather than the game: income only moves when something is bought, so
most intervals gain nothing and the ones that gain a sliver report an enormous seconds-per-
doubling. It is now measured across the whole window.

The assertion that matters most compares the slope of the curve early against the slope late.
A ratio outside 0.6-1.8 means the exponent sum has drifted off 1, which is the single change
that can quietly ruin the whole game.

The bounds in `tests/balance.test.ts` are generous on purpose. They are not claiming the
tuning is good; they catch a change that doubles the first hour, opens a wall in the middle,
or collapses the late game into nothing. All three are easy to do by accident and invisible
in a five-minute play test.
