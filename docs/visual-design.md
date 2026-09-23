# Visual design: direction, principles, and a catalogue of ideas

*Written after the sphere impostors, the field rework and the night sky, when there is enough
built to argue from evidence rather than taste. The first half is a recommendation. The second
half is a catalogue — including things I would advise against, with the reason.*

---

## 1. The question: minimalist, or real?

This is the fork worth settling before anything else is built, because almost every later
decision is downstream of it and reversing it later is expensive.

### The four honest options

**A — Minimalist / abstract.** *Universal Paperclips, Antimatter Dimensions, Kittens Game.*
Flat colour, typography-led, numbers as the whole interface. No simulation on screen.

- **Buys:** instant legibility, trivial performance, works on any device, ages perfectly,
  and every hour of work goes into systems rather than pixels.
- **Costs:** it throws away the premise. The thing that makes this game not a spreadsheet is
  that you can *watch the mass arrive*. An abstract version of this game is a different game,
  and a more crowded one — the abstract idle genre is extremely well served already.
- **Verdict:** wrong for this game, and the reason is specific rather than aesthetic.

**B — Stylised.** *Kurzgesagt, Mini Motorways, Outer Wilds' UI.* Flat or near-flat shapes, a
strong restricted palette, a few high-quality motifs, no attempt at photographic truth.

- **Buys:** distinctive identity, strong mobile legibility, cheap per asset, very forgiving of
  a small colour budget. A stylised planet is a circle and two arcs and it reads at 40px.
- **Costs:** it needs an art director more than it needs a programmer. The quality ceiling is
  set by the strength of the motif, and a weak stylisation looks amateur in a way that a weak
  realism merely looks unfinished. It also throws away the one advantage this project
  actually has, below.
- **Verdict:** a real option, and the right one if the goal were to ship fastest. Not the one
  I would take.

**C — Physically grounded.** *Where the game is now.* Procedural bodies shaded by real
lighting laws, a starfield with a real magnitude distribution, a disc with an inclination.
No claim to photography; a claim to being *correct*.

- **Buys:** something unusual — **the physics keeps supplying the design decisions**. This has
  happened over and over and it is not a coincidence:
  - Limb darkening is a real law with a real coefficient, and putting it in is what made the
    star stop looking like a sticker.
  - Shading in body space rather than view space is required by the physics, and it is also
    the thing that stopped craters being lit from a drifting direction.
  - "Additive light cannot be dark" killed the washed-out early ladder; the same fact from the
    other side ("additive light cannot occlude") explained meteoroids appearing on a star's
    face months later.
  - A supergiant's traffic is close-in and fast *because* it swept the far field long ago,
    which is both the astrophysics and the answer to "why does the late field look empty".

  When you are stuck on how something should look, there is an answer to look up. That is
  worth a great deal and it is not available in options A or B.
- **Costs:** each body is real work, and the failure mode is real too — see below.
- **Verdict:** **this one.**

**D — Photoreal / simulation showcase.** Volumetric dust, real N-body, HDR pipeline, post
effects, LOD systems.

- **Buys:** screenshots.
- **Costs:** enormous, phone-hostile, and — the important one — **the information per pixel
  stops rising**. A volumetric dust cloud tells the player nothing a good sprite cloud does
  not. Past a certain point realism stops being a source of answers and becomes a budget.
- **Verdict:** no. Name the line and do not cross it.

### The recommendation

> **Real in the window. Minimal in the margins.**

The field is physically grounded and gets the effort. The interface beside it stays
typographic, quiet, and nearly flat — the numbers panel is a *readout*, not a HUD. The
contrast between the two is the identity: a real window onto something, with a calm
instrument next to it.

Two consequences worth stating as rules:

1. **Every effect must carry information.** Limb darkening tells you where the light is.
   A tilted disc tells you this is a system. Bloom tells you nothing. Chromatic aberration,
   lens flare, film grain, vignettes and screen-shake all tell you nothing — they are the
   texture of *a camera*, and there is no camera in this fiction.
2. **When stuck, look it up.** The physically true answer has been the good-looking answer
   every single time so far. That is the whole reason for choosing option C.

### Where the "zen" ask fits

Calm is a constraint on *motion and palette*, not on detail. They are independent axes, and
the current build is evidence: the star has granulation, spots, faculae, a chromosphere and
prominences, and it is still restful, because everything moves slowly, nothing flickers, and
the palette stays inside one stage tint. Detail without agitation reads as depth. Detail with
agitation reads as noise. **Realism is what you draw; zen is how fast it moves.**

---

## 2. Principles that have actually held

Not aspirations — each of these was learned by getting it wrong first, and each has a commit
behind it.

| Principle | Where it came from |
|---|---|
| Additive light cannot be dark | The whole early ladder looked washed; a boulder could not have a dark side |
| Additive light cannot occlude | Meteoroids behind a star came out as bright blobs on its face |
| Shade in body space, not view space | Craters lit from a direction that drifted as the rock turned |
| Rotate every fbm octave | Axis-aligned lattices lined up across scales and drew a bright Y on the red dwarf |
| Exposure is a feature | The first star clipped to a flat white disc and threw away everything worth seeing |
| A streak is a distance, not a multiple | Dust should smear across many times its width; a moon should barely elongate |
| A stretched sprite needs no silhouette | The same streak trick turned every lit meteoroid into a lozenge |
| Seed anything generated | A sky that reshuffles when you resize the window stops being a place |
| Measure, do not squint | A "dark rounded square" around the star turned out to be a uniform 7.2 either side |

---

## 3. The catalogue

Costs are rough: **S** is an afternoon, **M** is a day or two, **L** is a week or more.
"Verdict" is my recommendation, not a decision.

### 3.1 The field

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| F1 | **Depth sorting across the disc** — particles on the near half of the orbit draw *in front* of the body, the far half behind | M | The single biggest remaining win for "this is a system". Right now everything passes behind, so the disc reads as a halo rather than a ring | **Do it.** Two containers, membership chosen at spawn by the sign of plane-y |
| F2 | **A visible orbital plane** — a very faint elliptical haze in the disc plane | S | Makes the inclination explicit rather than implied | Do it, at low alpha. Risk: looks like a UI ring if too crisp |
| F3 | **Impact flashes** — a brief bloom where a particle is absorbed | S | The moment of capture currently has no punctuation | Do it, tiny and warm. It is the one effect that carries information: *that* is where your mass came from |
| F4 | **Tails on infalling ice** — comet-like, pointing away from the star | M | Beautiful, and real: sublimation drives a tail anti-sunward | Later. Only makes sense once bodies have composition |
| F5 | **Collision fragmentation** — two particles meet and become several smaller ones | L | Very pretty, genuinely how accretion discs work | **No.** Needs broad-phase collision in the pool, which is the one part that is currently O(n) and allocation-free |
| F6 | **Gravitational focusing** — a visible over-density downstream of the core | M | The real effect that makes capture cross-section exceed geometric radius | Interesting, subtle. Low priority |
| F7 | **Per-particle composition tint** — ice pale blue, silicate grey, iron warm | S | Ties the field to the element chain, which currently only shows as a number | **Do it.** Cheap, and it makes a system the player already has legible |
| F8 | **Resonance gaps** — Kirkwood-style gaps in the disc | M | Instantly reads as "a real disc" to anyone who knows, invisible to everyone else | Skip. Cost falls on the wrong audience |

### 3.2 The bodies

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| B1 | **Rings on the gas giant** | S | The single most recognisable planetary silhouette there is | **Do it.** One more ellipse in the existing shader, with the shadow the planet casts on it |
| B2 | **Moons** — one or two small bodies on stable orbits, appearing from Protoplanet up | M | Scale. A planet with a moon is unmistakably a planet | **Do it.** Also the cheapest way to make the core feel *inhabited* |
| B3 | **Terminator city lights on the world** | S | A beloved image, and it would foreshadow the Bounce vision's life phase | Hold for Phase 7. Using it now spends the idea early |
| B4 | **Axial tilt per stage** | S | Bodies stop all spinning about the same vertical | Do it. Nearly free — it is one more constant in `toBody` |
| B5 | **A real supernova sequence** — the star swells, whitens, then blows a shell that becomes the next run's dust | M | The one moment in the game that should be worth recording. Currently a six-second remnant and a banner | **Do it.** This is the biggest single visual payoff left |
| B6 | **Lensing shader on the black hole** — warp the actual starfield behind it | M | The best screenshot in the game, and now that there *is* a starfield it would land | Phase 6, with the second prestige |
| B7 | **Accretion-disc shading on the hole from the real disc** rather than a painted ellipse | L | Correctness | No. The painted version already reads |

### 3.3 The sky

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| S1 | **Parallax on the starfield** — two layers drifting at different rates | S | Depth, and a sense that you are somewhere rather than in front of a backdrop | **Do it,** extremely slowly. Fast parallax is the opposite of zen |
| S2 | **Nebulae** — a few large, very soft coloured clouds | M | Warmth. The sky is currently true but cold | **Do it,** at very low alpha. Highest risk of looking like a screensaver — the discipline is that they must be *barely* there |
| S3 | **The sky reddens as you climb** — the run's own enrichment tinting the background | M | Makes the ladder visible in the one place that never changes | Interesting. Try it; revert if it reads as a filter |
| S4 | **Real constellations** | M | Nothing, for a player who is not on Earth | No. It is a fiction error as well as a cost |
| S5 | **The band aligns with the disc plane** | S | One coherent geometry instead of two unrelated ones | **Do it.** It is a two-line change and it makes the whole frame agree with itself |

### 3.4 Camera and scale

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| C1 | **Slow zoom out as the core climbs** | M | The core stays a constant fraction of the frame while the *field* grows around it, which is how scale is actually communicated | **Strong candidate.** The single best answer to "the late game does not feel bigger" |
| C2 | **A scale reference** — a faint ring at a known distance, labelled | S | Turns an abstract field into a measured one | Do it in the Progress tab, not in the field. The field should not carry labels |
| C3 | **Screen shake on promotion** | S | — | **No.** There is no camera. It is the most common "juice" reflex and it is wrong here |
| C4 | **Free pan and zoom** | M | Player agency | No. It would need LOD, culling and a minimap, and this is a game you leave running |

### 3.5 Light and colour

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| L1 | **The core lights the field** — particles tinted by proximity and angle to the core | M | Enormous coherence win. Right now the light comes from the upper left and the star in the middle emits nothing | **Do it.** Once the core is a star, it *is* the light source, and everything currently ignores that |
| L2 | **Bloom / HDR** | M | Glow | **No,** for the reasons in §1. The corona and halo already do this, in the shader, where it is controlled |
| L3 | **A tighter palette per act** | S | Identity | Do it as a pass over `StageLook`, not as code |
| L4 | **Colour-blind safe tints** | S | Reach | Do it as part of the ship phase. The ladder currently leans on hue alone in two places |

### 3.6 Interface

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| U1 | **Mobile layout** | M | The genre lives on phones. There is currently no phone layout at all | **The highest-value item in this entire document.** It is not a visual nicety, it is the platform |
| U2 | **Number formatting people can read at a glance** | S | Already good; could be better with a fixed-width column | Small |
| U3 | **An "at a glance" collapsed mode** — the field and one number | S | For leaving it on a second monitor | Nice, cheap, fits the zen direction |
| U4 | **Animated number counters** | S | — | No. It makes a calm readout twitchy |
| U5 | **Tooltips explaining the astrophysics** | S | The game's best asset is that it is *true*, and it currently never says so | **Do it.** One line per stage and per element |

### 3.7 Motion and moments

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| M1 | **Promotion sequence** — the field visibly reorganises over a few seconds | M | Promotions are the spine of the run and currently pass as a crossfade and a banner | **Do it.** It is the second-biggest payoff after the supernova |
| M2 | **Pulse feedback** — the existing ring, but shaped by the disc | S | The one interaction in the game should feel like it lands | Do it |
| M3 | **Idle breathing on everything** | S | Already there on the core | Leave it |

### 3.8 Sound

| # | Idea | Cost | Buys | Verdict |
|---|---|---|---|---|
| A1 | **Ambient drone that changes by stage** | M | The single cheapest way to make a quiet game feel deep | Do it, muted by default. Autoplay policy requires it anyway |
| A2 | **A note on absorption** | S | — | No. At hundreds of absorptions a second it is a machine gun |
| A3 | **One sound for the supernova** | S | Punctuation on the one big moment | Do it, with the sequence |

---

## 4. If I had to order it

1. **U1, mobile layout.** Not a visual choice. The platform.
2. **F1, depth sorting.** The disc becomes a ring instead of a halo.
3. **B5, the supernova sequence.** The biggest moment has the least made of it.
4. **L1, the core as light source.** The largest coherence win available.
5. **C1, slow zoom.** The best answer to late-game scale.
6. **M1, promotion sequence**, then **B1/B2 rings and moons**, then **S1/S2 sky depth**.

Everything in §3 marked *No* should stay that way unless the reason it was rejected changes.
