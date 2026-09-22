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

### What a stage controls, and what it should

`StageLook` currently carries three things: a core colour, a particle colour, and a core
scale. That is enough to tell Dust from Gas Giant at a glance, and not enough to make them
feel like different places.

Four things are missing, in rough order of how much they'd buy:

**Core form.** Every stage is the same soft glow sprite at a different size and hue. A gas
giant wants bands, a planet a lit limb and a terminator, a star a corona, a neutron star a
hard bright point far smaller than the stage before it, a black hole a dark disc with a
bright ring. This is the single biggest visual gap in the game.

**Particle size and count, traded against each other.** This is the one that carries the
ladder, and it is a single rule rather than two settings:

> As the core climbs, particles get **bigger** and **fewer**.

Dust is a haze of hundreds of specks that barely fall — your gravity is feeble, and what you
catch is catching *itself* as much as you. By Planet it should be sparse traffic of
individually visible meteors, each one an event. By Supergiant you are swallowing whole
moons: a handful of large bodies on screen at a time, each arriving with weight.

Indicative shape across the twelve accretion stages:

| Stage | Size | Count | Reads as |
|---|---|---|---|
| Dust | ×0.3 | ×4 | a haze, barely moving inward |
| Planetesimal | ×0.7 | ×2 | gravel, starting to fall |
| Asteroid | ×0.9 | ×1.5 | rocks on visible arcs |
| Planet | ×1.6 | ×0.8 | meteors, each one an event |
| Brown Dwarf | ×2.5 | ×0.45 | large bodies, sparse |
| Supergiant | ×4.2 | ×0.22 | moons, one or two at a time |

**Count falls roughly as the inverse square of size**, so the total lit area stays in a narrow
band. That matters because the field blends additively: hold area roughly constant and the
screen stays evenly bright while its *character* changes completely. Let the area climb freely
and the late game is a white blowout; hold it exactly constant and the late game feels no
weightier than the early. A gentle rise — perhaps two-fold across the whole ladder — is right.

Keep a per-particle size spread at every stage and just move its centre, so each stage has
variety and the transitions read as gradual rather than as a costume change.

None of this touches the economy. Income is what it was; what changes is what income *looks
like*. The particle budget slider still caps the whole thing, and at the top of the ladder it
will barely be reached.

**Field density.** A stage can also widen or narrow the band the particles arrive in, so the
cloud visibly tightens as the core grows.

The first needs shader work. The other three are extra fields on `StageLook` threaded through
`FieldRates` — cheap, and they would make the early game read very differently from the late.

### More to buy as you climb

Measured on the current curve: the last new upgrade card — Field Lines, at 1e8 lifetime mass
— appears about **20 minutes** in. The ladder runs to about **55**. So for the last
thirty-five minutes the Core tab never changes: the same five cards with bigger numbers on
them.

The stage ladder tells you that you are growing; the thing you actually interact with does
not. Two ways to fix it:

- **Second-tier upgrades gated on stages** — a new line that appears at Planet, another at
  Brown Dwarf, each feeding a term the opening upgrades already feed but from a fresh cost
  base. Recommended: it reuses the whole upgrades-as-data pipeline, so each one is an entry
  in `upgrades.ts` and nothing else.
- **Stage perks** — a one-off choice presented on arrival at each stage. More interesting,
  much more to author and to balance.

**The constraint either way:** any new multiplicative upgrade adds to the cost-exponent sum,
and that sum is 0.998 for a reason. A second-tier upgrade must either take over a saturating
upgrade's share or be tuned so the total still lands near 1. Adding one "because it feels
good" is precisely how the ×1500 element chain made the game seventy times faster.

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

## Beyond the black hole — the second half of the game

*Vision, not a plan. Nothing below should start before Phase 5 ships and people have actually
played the first half.*

### Why the game needs a third act at all

Acts I to V are one verb: **accretion**. You pull things in, and the reward for pulling well
is being able to pull harder. The arc ends at a black hole because that is where gravity ends
— there is nothing further down that road. Adding a fourth prestige that grants more
multipliers would be the same game with bigger numbers.

The way out is to change the verb. Not "pull harder" but **propagate**: stop being a thing in
the universe and become the thing a universe comes from.

### The Bounce

The last collapse does not deepen. The core's interior reaches a density where it stops being
a hole and starts being a beginning: a **Big Bang**, and a new universe on the other side.

This is not invented for the game. Black-hole cosmology — the idea that the interior of a
black hole buds a new spacetime, and Smolin's cosmological natural selection built on top of
it — is a real, if speculative, line of thought. It is the one place in this game where the
physics is a live hypothesis rather than settled, and the game should say so rather than
pretend otherwise.

**What the Bounce grants is different in kind from Stardust and Singularities.** Those were
currencies you spent on multipliers. The Bounce grants **Constants**: you tune the physics of
the universe you are about to create. Stronger gravity means faster accretion but shorter-lived
stars. A denser early universe means more seeds but a hotter, more hostile start. That is a
build, not a number — and it is cosmological natural selection as a game mechanic, which is
exactly what the idea is for.

### Life

In the new universe you seed, a planet does something the last one never did: it stays wet
long enough. **Life starts at the Planet stage** — the first ladder rung that could ever have
hosted it — and the second half of the game runs on a ladder that mirrors the first, pointing
outward instead of inward.

```
inward, gravity   dust ────────────────────────────> black hole
                                    ↓ Bounce
outward, life     tide pool ──────────────────────> Type III civilisation
```

The natural spine for the outward ladder already exists and is real: the **Kardashev scale**.

| Rung | What you are | What you harvest |
|---|---|---|
| Abiogenesis | chemistry that copies itself | gradients |
| Multicellular | bodies | sunlight |
| Intelligence | a species that models the world | fire, agriculture |
| Type I | a planetary civilisation | a planet's energy budget |
| Type II | a Dyson swarm | a whole star's output |
| Type III | a galactic civilisation | a galaxy's stars |

Mass stops being the currency somewhere around Type I — you cannot weigh a civilisation
usefully — and **energy captured** takes over, which is what Kardashev actually measures and
what the disk already taught the player to think about.

### What this reuses

The particle field does not need replacing, it needs **inverting**. The same pool, the same
trails, the same budget — but particles are no longer things falling *in* to be eaten. They
are stars you reach, and they **light up and stay** rather than being absorbed. The core stops
being a sink and becomes an origin. One renderer, two meanings, and the transition from one
to the other is the single best visual moment the game could have.

### The honest caveat

This is a second game bolted to the first. It is larger than Acts I to V put together: a new
economy, a new ladder, a new verb, and a UI that has to hold both. It earns its place only if
the first half is finished and people want more of it. Written down now so the first half can
be built without closing the door on it — the stage ladder as data, the renderer behind an
interface, and the economy with no DOM in it are all already the right shape for this.

## Supporting systems

### The energy economy

Five planned features turned out to be one system: the disk is where energy comes from, the
element chain is what it is for, and the two upgrades bought with energy bring the chain
closer. Nothing here is worth shipping alone.

**The disk** forms once the core is heavy enough to have one, and taxes the infall:

```
energyPerSecond = rawMassPerSecond × diskThroughput
```

*Raw* infall — before the element multiplier. That ordering is load-bearing, not cosmetic:
energy decides the element tier, the tier multiplies mass income, and if mass income then fed
energy the loop would close. It did, in the first attempt, and each tier funded the disk level
that reached the next one. The whole chain fired in under a second.

**The element chain** is gated on `diskThroughput` — the fraction of infall converted — not on
energy per second. Absolute energy requirements looked right and were not: energy income is
proportional to mass income, which spans twenty orders of magnitude over a run, so any fixed
set of thresholds is crossed almost simultaneously somewhere in the middle. A fraction does
not inflate, so tiers are paced by the disk's cost curve, which is a dial that behaves.

| Tier | Element | mass/particle × | Throughput needed |
|---|---|---|---|
| 0 | Hydrogen | ×1.00 | — |
| 1 | Helium | ×1.35 | 0.006% |
| 2 | Carbon | ×1.80 | 0.15% |
| 3 | Oxygen | ×2.40 | 3% |
| 4 | Silicon | ×3.00 | 60% |
| 5 | Iron | — | nothing reaches it |

**Those multipliers look timid and are not.** With the mass upgrades' cost exponents summing
to about 1, income tracks capital, so a flat multiplier scales the growth *rate* rather than
the total. The first attempt gave the chain a ×1500 top end and made the entire game roughly
seventy times faster — the last four stages arrived within one second of each other. A ×3
chain is worth about a doubling of pace, which is already a lot. **This is the single easiest
way to wreck the tuning, and it does not look dangerous while you are doing it.**

**Energy is the stock.** It buys two things, and both bring the next element closer from
opposite directions: *Accretion Disk* raises throughput, *Magnetic Confinement* lowers what
each tier asks for. Spending the stock never costs a tier, so the two pressures never fight.

**Iron is where it stops**, and that is astrophysics rather than a balance decision: fusing
iron consumes energy instead of releasing it, so no throughput reaches it. It is listed with
no requirement at all, the way the ladder lists the stages only a collapse can reach.

The stall it causes is Phase 3's prestige prompt. Until prestige exists it is *only* the end
of the chain — everything else keeps climbing, so there is no dead end. Shipping a real wall
before there is a way through it would be the worst state to leave a player in.

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
- **Tabs** — Core, Energy, Progress, Settings. The Energy tab does not exist until there is a
  disk: a game that unfolds beats one that opens with four empty rooms.
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
