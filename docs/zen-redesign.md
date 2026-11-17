# The zen redesign

*What changed when the brief became "calmer, and satisfying for longer", and why. The economy
and the fiction are still in `game-design.md`; the visual direction is still in
`visual-design.md`. This document is the reasoning that reshaped both.*

---

## 1. Two diagnoses

**Why it was not calm.** Nothing about the picture — the picture was already slow. It was the
*logic*. The game kept asking for you:

- **Gravity Pulse** paid five seconds of income on a ten-second cooldown. That is a tax on
  attention with a timer attached: the optimal way to play was to click every ten seconds,
  forever, and three achievements were named after doing exactly that.
- **Upgrades cost attention, not mass.** Two hundred purchases in the first hour, with every
  second of not-clicking a second of lost compounding. Automation existed, but it had to be
  earned with twenty-five manual levels per card — a hundred and twenty-five clicks of
  proof that you wanted not to click.
- **Automation could not tell when to stop**, so the default way to use it poured over half
  of everything into two cards reading `+0.00% income`, and the fix was for the player to
  supervise it.
- **Absence had an edge.** Twelve hours, then nothing, and an achievement for hitting the cap.
- **Everything announced itself**: a pip on a tab, a banner in a box, a number repainting
  twelve times a second.

**Why it did not last.** The first run was a good hour. The trouble was everything after it:

- The supernova paid `12 x (mass / threshold) ^ 0.6`, and mass keeps growing after the ladder
  ends. One night left at the top of the ladder was worth millions of Stardust, the tree
  swallowed it, and every run after that took minutes. The long game ended the first time
  the player slept.
- What a collapse *gave* was a bigger multiplier on the same hour. Nothing persisted that you
  could look at. The second run was the first run, faster; the tenth was the same, in a blur.
- Nothing about one run differed from the next.

Neither diagnosis is about content. Both are about what the game asks of the player and what
it gives back.

## 2. Three rules

### Nothing asks for you

Being present should be pleasant and never required; being absent should cost nothing and
never be scolded. Concretely:

- **The pulse is a toy.** Touching the field stirs it — a ripple, a tug on whatever is near.
  It pays nothing, so there is no best rhythm to click it in. The opening minute no longer
  leans on it.
- **Open a current once; then it flows.** Each upgrade is begun by hand — one deliberate act,
  about eight per run on the first run and none at all on later ones — and from then on it
  grows by itself. A current can be *held* if you would rather tend it by hand.
- **Automation is value-aware.** It buys whatever pays itself back soonest and leaves alone
  anything that would not soon enough, so a saturated card *settles* instead of eating the
  run. "Soon enough" is measured in the run's own time — a dozen tenfolds of its present
  growth, which is about an hour in the first run and much longer in a vast, slow cloud. The
  default behaviour is now the sensible one, which is the precondition for it being the
  default at all.
- **An absence is just time.** The horizon is thirty days with an adaptive step, the report
  says what happened rather than what was forfeited, and the cap achievement is gone.
- **The interface recedes.** One quiet caption; the rest behind a sheet you summon. It dims
  when you stop moving. Announcements are a line of text that fades, not a box that arrives.

### Tend, do not click

The frequent decisions were never decisions — buy everything, cheapest first. Those are now
the game's job. What is left to the player is rarer and weightier:

- *which cloud* to condense the next star from,
- *when to let a star go*, and as what,
- *what the sky should remember* (the tree),
- and whether to hold a current back.

### The sky remembers

A run is no longer a lap. **A run is one star.** It condenses out of a cloud, grows until
the cloud is spent, and when you let it go it takes a place in your night sky — permanently,
in its own colour, with its name and the day you made it. The background of every later run
is made of the ones before.

That is the long game: not a larger number but a sky that fills.

## 3. The logic, concretely

### 3.1 Clouds

Every run condenses from a **cloud**, and a cloud is finite:

| Property | What it does |
|---|---|
| **ceiling** | The largest class of star this cloud can make. Its mass budget is where that class ends. |
| **pace** | Small clouds are dense and quick; vast ones are thin and slow. A flat multiplier: M x1.6, K x1.25, G x1, F x0.5, A x0.22, B x0.12, O x0.065, each cloud within 12% of its class. |
| **trait** | *quiet*, *icy*, *ferrous* or *turning*. Changes what the infall looks like and shifts the shape of the run a little. Near-equal by design: there is no wrong one. |
| **hue** | The colour of the nebula behind the run. |

The first cloud is fixed and can make a Sun. After each star you are offered three, drawn
from a seed — no rerolls, nothing to gamble on — and the run does not begin until you choose.
One of them is always as large as you can currently reach, so the summit you are working
towards is never withheld by a roll. Each comes with a rough forecast — *within the hour*,
*overnight* — made by running the star on a copy, because a word still has to be true.
**Between stars the field is empty.** That pause is deliberate; it is the one moment the game
has nothing happening in it.

**The cloud runs out.** Income is multiplied by the fraction of the cloud still unspent, so
growth is logistic: exponential for almost all of the run, then easing off over the last
order of magnitude until the star has everything the cloud held. The field thins as it
happens. *Completion looks like stillness* — a finished star alone in a cleared sky, which
is also what a real young star does to its disc.

This is what fixes the overnight exploit, and it does it without a rule. There is no "top of
the ladder" to sit at accumulating: a finished star is finished, and waiting longer earns
nothing because there is nothing left to fall in.

### 3.2 The top of the ladder is the spectral sequence

Red Dwarf, Star and Supergiant become the seven real classes, by mass:

| Class | Stage | Colour | What it leaves |
|---|---|---|---|
| M | Red Dwarf | ember red | nothing yet — it will burn for a trillion years |
| K | Orange Dwarf | orange | a white dwarf in a shell of its own gas |
| G | Yellow Dwarf | the Sun's white-gold | the same |
| F | White Star | white | the same |
| A | Blue-White Star | blue-white | the same |
| B | Blue Giant | blue | a supernova |
| O | Blue Supergiant | deep blue | a supernova |

The colours are blackbody colours and the fates are the real ones, so the release sequence
is decided by physics rather than taste: under eight solar masses a star sheds a planetary
nebula; over it, it explodes. Hot stars have radiative envelopes and no surface convection,
so the granulation and the starspots fade out towards the blue end. That is correct, and it
is also why a blue giant looks *smooth* next to a red dwarf.

### 3.3 Letting go

Any star can be released, from the moment it ignites.

```
u        = log10( mass / mass at ignition )        orders of magnitude grown as a star
stardust = 1 + floor( 3 x u ^ 1.4 )
```

Log-based on purpose. The old yield was a power of mass and mass is exponential in time, so
it rewarded waiting without limit. This one is a gentle power of *orders of magnitude*,
bounded by the cloud — so the best time to let a star go is simply when it is finished, and
there is no clock to optimise against.

The one real choice is **as what**. A cloud that could make a Sun can be stopped as a red
dwarf, and the first star of each class pays a discovery bonus and fills a slot in the
catalogue. That is a decision about what you want in your sky, not about efficiency.

### 3.4 What the sky remembers

Stardust buys a small, **bounded** tree. Every card ends.

| Card | Levels | Does | Costs |
|---|---|---|---|
| **Reach** | 4 | Larger clouds can be found: F, then A, B, O | 150, 400, 1,000, 2,500 |
| **Enrichment** | 8 | x1.15 to all mass | 6 rising to 250 |
| **Prior Ignition** | 4 | Begin one element further up the chain | 20, 80, 250, 700 |
| **Wider Gaze** | 2 | A fourth and a fifth cloud to choose between | 40, 200 |

The first star of each class pays a discovery bonus on top: 5, 20, 45, 80, 125, 180 and 245
from M to O. And one thing that is not bought: **every star in your sky adds 2% to all
mass**, up to fifty of them. The collection is the progression.

Bounded matters. Total permanent speed-up is finite, so a run never collapses into seconds,
and the summit — a blue supergiant in your own sky — stays a long way up.

The first draft of this tree had ten levels of x1.25 and costs a third of these, and the
career simulation finished it in six days, with a blue supergiant on day six and late Suns
taking minutes. That is the failure this section exists to prevent, arrived at by the
numbers rather than by intent, so the tree was weakened, repriced and the pace ladder
steepened until the measurements below came out.

### 3.5 What was removed, and why it is not coming back

| Removed | Because |
|---|---|
| Gravity Pulse income, its cooldown, its four achievements | A timer that pays is a chore with a reward attached |
| The 25-level gate on automation | Proving you want not to click, by clicking |
| Seed Mass | It deleted the dust stage from every later run, and the dust stage is the best part |
| Deep Slumber, Muscle Memory | Both patched problems that no longer exist |
| The twelve-hour offline cap and its achievement | An edge on absence |
| Yield as a power of mass | See 3.3 |
| Tab pips, the banner box, the 12 Hz mass readout | Each one is the interface asking to be looked at |

## 4. The picture, concretely

`visual-design.md` settled the direction — *real in the window, minimal in the margins* —
and this is that sentence taken literally.

- **The window is the whole screen.** The field is full-bleed; there is no panel beside it.
- **The margin is one caption.** Stage, mass in words, a hairline towards the next stage, and
  a rough sense of when: *moments*, *a few minutes*, *within the hour*, *overnight*. Coarse
  on purpose — a countdown is a clock to watch.
- **Everything else is a sheet** you open: System, Energy, Sky, Journal, Settings. At the
  side on a desk, from the bottom on a phone. This is also, finally, the phone layout.
- **Numbers are words.** `4.15 billion`, not `4.151 B`. The readout in the caption repaints
  once a second, not twelve times.
- **The accent is the body's own colour.** The interface takes its one colour from whatever
  is in the middle of the screen.
- **Your stars are in the sky**, brighter than the background, in their class colours. The
  run's nebula hangs behind the field in the cloud's hue and thins as the cloud is spent.
  The whole sky turns, once every couple of hours.
- **The core is the light.** When the body in the middle is luminous, the rocks falling into
  it are lit from it rather than from the upper left.
- **Moments are slow.** A promotion takes several seconds to happen. Letting a star go is a
  sequence — a shell of gas or a supernova, according to its mass — and then a point of light
  rising from the centre to its place in the sky.
- **Sound, if you want it.** A generated drone that follows the stage, a few sparse notes, a
  bell when something changes. Off until asked for.

### As built

All of the above is built. Where the build differs from the plan, the build won:

- **Your stars are scattered over the whole turning sky**, not kept inside the circle that
  never leaves the screen. That was tried first and drew them as a ring round the middle,
  which no sky looks like; now they rise past the edge and set again.
- **Hot stars are smooth because the shader reads their temperature from their colour.** The
  first star shader multiplied every class by the red dwarf's colour ramp, which rendered the
  Sun tan and blue stars beige.
- **Rocks stopped tumbling.** Their light is painted on, so tumbling turned their sunlit side
  round with them; around a star each turns its lit side to the core instead.
- **The automation's horizon is relative.** A flat hour throttled the vast, slow clouds,
  where nearly every sound purchase takes longer than that to repay.

## 5. Deliberately not done

- **Forks at promotions** — rings or moons, ocean or desert. Good, and the natural next
  layer of per-run identity; each needs its own visuals to be worth choosing.
- **Constellations** — lines between your stars. Wants a sky with enough stars in it first.
- **Second-tier upgrades.** Still designed, still unbuilt; they add to the exponent sum and
  the automation changes what a "new card" is for.
- **The black hole.** Phase 6, unchanged. The remnants B and O stars leave are where it
  will start.

## 6. Measured

From `npm run balance`. The career is simulated star by star — choose a cloud, let the star
finish, let it go, spend the Stardust cheapest-first — and placed on a calendar of someone
who looks in at 8:00, 12:30, 18:00 and 22:00 and not overnight. A star that finishes at three
in the morning is let go at eight.

**The first star.** Pebble at 1:09, Red Dwarf at 1:07, a Sun at 1:29, and the cloud spent
at 1:59 — the last half hour is the star easing to a finish as the field thins. Income
doubles every 98 seconds through the first hour. The eight currents arrive to be opened at
9 s, 53 s, 1:23, 4:01, 10:09, 35:00, 39:40 and 41:20.

**The four kinds of cloud**, the same Sun from each: within 4% of each other.

**A career, choosing the largest cloud every time:**

| | Day | A star of the frontier class takes |
|---|---|---|
| First Sun (G) | 0.5 | 1:59, then 25–50 min |
| First white star (F) | 3.3 | about an hour, falling to 35 min |
| First blue-white (A) | 7.3 | 1:40, falling to 1:20 |
| First blue giant (B) | 10.8 | 3:25, falling to 2:55 |
| First blue supergiant (O) | 14.5 | 10:20, settling near 8:40 |
| Tree complete | 13.9 | |

Someone looking in twice a day takes roughly twice as long. Choosing the smallest cloud
every time instead fills the sky with red dwarfs at a quarter of an hour each, and never
reaches past them — the two policies bracket every real player.

**At the end of everything** — every card full, fifty stars, every achievement — a blue
supergiant still takes over four hours and a red dwarf about two minutes. The red dwarf is
quick on purpose: by then it pays nothing the tree still wants and the sky's bonus is full,
so speed there rewards no one for hovering. It is still the whole ladder, from dust.
