# Technology Evaluation

## The decision that shapes everything else

An idle game and a particle simulation want opposite things.

The simulation wants to be the truth: particles fly in, hit the core, the core gets heavier.
That is beautiful and it is unshippable. It means mass gain is capped by how many particles
the GPU can draw, background tabs stop earning, offline progress is impossible without
replaying hours of physics, and float drift makes two identical saves diverge.

So the architecture is fixed before any library choice:

```
          authoritative                     cosmetic
  ┌────────────────────────────┐   rates   ┌────────────────────────────┐
  │  Economy sim               │ ────────> │  Particle field            │
  │  pure, deterministic       │           │  reads massPerSecond,      │
  │  20 Hz fixed tick          │           │  captureFraction, tier     │
  │  closed-form offline       │ <──────── │  emits "nudge" impulses    │
  │  the only thing saved      │  events   │  never writes mass         │
  └────────────────────────────┘           └────────────────────────────┘
```

The particle field is a *readout* of the economy, not its cause. Absorbed particles are drawn
at whatever rate makes `massPerSecond` legible; the number would be identical with the canvas
switched off. This costs nothing in feel — players read density and speed, not arithmetic —
and it buys offline progress, testability, and a particle budget that is purely a graphics
setting.

Everything below follows from that split: the economy layer optimises for exactness, the
render layer for throughput, and they are allowed completely different number types.

---

## 1. Numbers

Mass in an idle game crosses 1e15 within hours and 1e300 by endgame. `number` (float64) dies
at ~1.8e308.

| Option | Ceiling | Speed | Verdict |
|---|---|---|---|
| `number` | 1.8e308 | fastest | Fine for a 1-prestige game, a wall for anything deeper |
| **break_infinity.js** | ~1e(9e15) | ~2-5x slower than float | **Recommended** |
| decimal.js / big.js | arbitrary | 50-100x slower | Arbitrary *precision*, which we don't need. No |
| BigInt | arbitrary ints | slow, no fractions | Rates are fractional. No |

**Recommendation: `break_infinity.js` in the economy layer, plain `number` in the renderer.**
It stores mantissa + exponent in two floats — exactly the trade an idle game wants: unlimited
range, 17 significant digits, no allocation storms.

Retrofitting big numbers onto a codebase full of `+` is a multi-day rewrite, so it goes in on
day one behind `src/sim/numbers.ts`:

```ts
export type Num = Decimal;
export const D = (v: Num | number | string): Num => new Decimal(v);
export const format = (v: Num, mode: NotationMode) => /* 1.23e45 | 1.23 Qa | 1.23M */;
```

The renderer never sees a `Decimal`. It receives `{ massPerSecond: number, tier: number }`
already downcast, because nothing on screen needs more than 6 digits.

## 2. Rendering the particle field

Target: **20,000 additive-blended sprites at 60 fps on a 2019 laptop**, scaling down to 2,000
on a phone and up to 200,000 on a desktop GPU.

| Option | Realistic budget | Effort | Notes |
|---|---|---|---|
| DOM / CSS | ~500 | trivial | Layout thrash. No |
| Canvas 2D | 3-8k | low | No additive blend without per-frame compositing cost |
| **PixiJS v8** | 100-200k | low | Batched WebGL/WebGPU sprites, `ParticleContainer`, additive blend built in |
| Three.js `Points` | 500k+ | medium | A 3D engine and camera for a 2D problem |
| Raw WebGL2 + transform feedback | 1M+ | high | Physics on GPU, but you write all of it |
| WebGPU compute | 5M+ | high | Uneven Safari support; premature |

**Recommendation: PixiJS v8.** It is the only option on that list where the glow aesthetic —
hundreds of overlapping additive sprites blooming into a bright core — is a blend-mode flag
rather than a rendering project. v8 auto-selects WebGPU or WebGL and falls back cleanly.

It still sits behind `src/render/Field.ts` exposing four methods
(`init / setRates / pulse / destroy`) so the raw-WebGL upgrade in Phase 4 is one file, and so
the economy can be tested with no canvas at all.

Particles are a **fixed pre-allocated pool**, never `new`-ed per spawn. A dead particle is
recycled by resetting its slot. This is the single most important perf rule in the codebase:
GC pauses are what actually breaks 60 fps here, not draw calls.

## 3. UI framework

Idle UI is ~40 upgrade rows whose numbers change constantly. The trap is re-rendering a
component tree 60 times a second to animate digits nobody reads that fast.

| Option | Fit | Notes |
|---|---|---|
| **Svelte 5 (runes)** | best | Fine-grained signals, no vdom, ~10 kB runtime, compiles updates to direct DOM writes |
| Vue 3 | very good | Same reactivity model, larger runtime |
| React + Zustand | good | Needs deliberate selector discipline; easiest to hire/ask for help with |
| Vanilla TS + signals | fine | You end up writing a small framework |

**Recommendation: Svelte 5 + TypeScript.** A `$state` holding the economy snapshot updates
only the text nodes that changed, which is precisely the workload.

**Switch to React + Zustand if you already know React** — the architecture is unaffected (the
economy layer has no framework imports at all), and a stack you can debug beats a stack that
benchmarks 2 ms faster. If you go React: subscribe with selectors, and never put the raw
mass value in context.

Either way the UI samples the economy at **10-15 Hz, not 60**. Decoupled from the render
loop, and unnoticeable.

## 4. Build, test, deploy

- **Vite** — dev server, TS, static build. No debate here.
- **TypeScript 6**, not 7 — `svelte-check` declares a peer range of `^5 || ^6` and npm
  refuses to resolve past it. Worth knowing before an afternoon disappears into it.
- **Vitest** — the economy is pure functions; this is where the real test value is.
- **Playwright** — one smoke test: load, buy an upgrade, reload, mass persisted.
- **GitHub Actions → GitHub Pages** — it's a static bundle; deploy on merge to `main`.
- **PWA (`vite-plugin-pwa`)** — offline play and add-to-homescreen. Phase 6, cheap.

Dependency count stays at four runtime packages (pixi, break_infinity, svelte, and the PWA
shim). Idle games live for years; every dependency is a future migration.

## 5. Time, persistence, and the awkward parts

**Fixed timestep.** Economy runs on a 20 Hz accumulator; render runs on `requestAnimationFrame`.
Never derive game state from frame delta — a 144 Hz monitor would otherwise earn 2.4x a 60 Hz one.

**Background tabs.** `requestAnimationFrame` stops when hidden and `setTimeout` clamps to ~1 s.
Do not fight it: stamp `lastTickWallClock = Date.now()` every tick, and on `visibilitychange`
reconcile the gap through the same offline path. A Worker is throttled less but not reliably,
and it's not worth the message-passing until the tick exceeds ~2 ms. It won't.

**Offline progress.** Closed-form where the rate is constant, coarse catch-up ticks where it
isn't (auto-buyers change the rate as they fire). Cap at ~12 h of credit, simulate in at most
~1000 steps regardless of gap length so a two-week absence resolves in under a second, and
show the player a "while you were away" summary. `Date.now()` is wall clock and the player can
change it — clamp negative deltas to zero and move on; this is single-player.

**Saves.** `localStorage`, JSON, every 10 s plus on `pagehide` and `visibilitychange`
(`beforeunload` does not fire reliably on mobile). Every save carries a `version`; every
version bump ships a migration function, tested. Base64 export/import string from day one —
it is how players recover from your bugs. IndexedDB only if the save passes ~1 MB, which it
won't.

**Anti-cheat: none.** It's single-player. A checksum to catch *corruption* is worth it;
obfuscation to catch *cheating* costs real time and punishes only the honest.

## Stack summary

| Layer | Choice |
|---|---|
| Numbers | break_infinity.js (economy only) |
| Particles | PixiJS v8, pooled sprites, additive blend |
| UI | Svelte 5 + TypeScript |
| Build | Vite |
| Tests | Vitest (economy) + Playwright (smoke) |
| Persistence | localStorage, versioned + migrations |
| Deploy | GitHub Actions → GitHub Pages, PWA |
