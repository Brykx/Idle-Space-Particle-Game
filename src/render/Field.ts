import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
} from 'pixi.js';
import { DEFAULT_TUNING, ParticlePool, type FieldGeometry } from './pool';
import { LUMINOUS, makeSceneTextures } from './textures';
import type { BodyKind } from '../sim/stages';

/**
 * The particle field — the only file in the project that imports Pixi.
 *
 * It reads rates and draws them. It never writes game state, and switching it off changes
 * nothing but the view. That is what lets the economy have offline progress and exact
 * arithmetic while this side gets to be pure cosmetics at whatever budget the device allows.
 */

export interface FieldRates {
  /** Particles per second to emit. A visual rate, clamped — not the economy's. */
  spawnRate: number;
  /** 0..1. Decides the ratio of catches to near-misses on screen. */
  captureFraction: number;
  /** 0..1, how large to draw the core. Comes from the current stage. */
  coreScale: number;
  /** Packed RGB for the core, from the current stage. */
  coreColour: number;
  /** Packed RGB for the particles falling in, from the current stage. */
  particleColour: number;
  /** Sprite size multiplier, from the current stage. */
  particleSize: number;
  /** Multiplier on emission. Falls as size rises, so the lit area stays in a band. */
  particleCount: number;
  /** Tangential speed of a capture trajectory, as a fraction of orbital speed. */
  orbit: [number, number];
  /** Per-second damping on capture trajectories. */
  drag: number;
  /** Seconds before an unabsorbed particle gives up. */
  lifetime: number;
  /** Which family of body the core is, and therefore how it is drawn. */
  body: BodyKind;
  /** Maximum live particles. */
  budget: number;
  reducedMotion: boolean;
}

export interface FieldHandle {
  setRates(rates: FieldRates): void;
  /** Play the visible half of a Gravity Pulse. */
  pulse(): void;
  destroy(): void;
}

const CORE_MIN_RADIUS = 14;
const CORE_MAX_RADIUS = 64;
/** Hard ceiling on emission so a late-game rate cannot flood the pool. */
const MAX_VISUAL_SPAWN = 260;
/**
 * Floor on emission. The field is cosmetic, and an empty screen in the opening minute reads
 * as broken rather than as sparse — so it always drifts, even when income is a trickle.
 */
const MIN_VISUAL_SPAWN = 22;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function unpack(colour: number): Rgb {
  return { r: (colour >> 16) & 0xff, g: (colour >> 8) & 0xff, b: colour & 0xff };
}

function pack(c: Rgb): number {
  return (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
}

/** Ease a live colour towards a target, in place. */
function easeColour(current: Rgb, target: number, k: number): void {
  const to = unpack(target);
  current.r += (to.r - current.r) * k;
  current.g += (to.g - current.g) * k;
  current.b += (to.b - current.b) * k;
}

/** Blend two packed RGB colours. Used to warm the palette as the core grows. */
function mixColour(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t))
  );
}

/** What the field looks like before the first `setRates` arrives — the dust stage. */
const INITIAL_CORE = 0x8892a6;
const INITIAL_PARTICLE = 0x9fc6ff;

/**
 * How fast the core morphs when the stage changes, in e-folds per second. Slow enough that
 * becoming a planet is something you watch happen rather than a palette swap.
 */
const MORPH_RATE = 1.2;

/**
 * Trails.
 *
 * Not history sprites — the pool holds exactly one sprite per particle, and trailing three
 * more behind each would triple the budget and make the particle slider a lie. Instead each
 * sprite is stretched along its own velocity: rotation from atan2, long axis scaled by speed,
 * short axis left alone. The texture is a soft radial dot, so a stretched one is a streak.
 *
 * It falls out of the physics rather than being layered on top. Particles accelerate as they
 * fall, so streaks lengthen towards the core where the motion is most worth seeing, and a
 * Gravity Pulse turns the whole field into inward streaks in a single frame.
 */
const TRAIL_SPEED_REF = 190;
const TRAIL_MAX_STRETCH = 5;

export interface FieldOptions {
  /** Called when the player clicks the field. */
  onPulse: () => void;
}

export async function createField(parent: HTMLElement, options: FieldOptions): Promise<FieldHandle> {
  const app = new Application();
  await app.init({
    resizeTo: parent,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl',
  });

  parent.appendChild(app.canvas);
  app.canvas.style.display = 'block';
  app.canvas.style.width = '100%';
  app.canvas.style.height = '100%';

  const textures = makeSceneTextures();
  const glow = textures.glow;

  // --- scene graph -------------------------------------------------------------------
  const stars = new ParticleContainer({ dynamicProperties: {} });
  stars.blendMode = 'add';

  const field = new ParticleContainer({
    // `scale` is not one of these — size and anchor are baked into `vertex`, so per-frame
    // scale changes need `vertex: true`. Without it the pool's per-particle size variation
    // is uploaded once at build time and every particle renders the same size forever.
    // `uvs` is dynamic so a particle can switch between the soft and hard dot without
    // rebuilding the pool, which would kill every particle in flight at each promotion.
    dynamicProperties: { position: true, color: true, rotation: true, vertex: true, uvs: true },
  });
  field.blendMode = 'add';

  const effects = new Container();

  const halo = new Sprite(glow);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';
  halo.tint = INITIAL_PARTICLE;

  // Two core sprites. A stage change swaps the body on one and fades the other out, so the
  // blend mode can change from additive to normal without the core visibly cutting.
  const core = new Sprite(textures.body.mote);
  core.anchor.set(0.5);
  core.blendMode = 'add';

  const corePrevious = new Sprite(textures.body.mote);
  corePrevious.anchor.set(0.5);
  corePrevious.blendMode = 'add';
  corePrevious.alpha = 0;

  app.stage.addChild(stars, field, halo, corePrevious, core, effects);

  // --- state -------------------------------------------------------------------------
  const tuning = { ...DEFAULT_TUNING };
  let pool = new ParticlePool(1200);
  let sprites: Particle[] = [];

  let rates: FieldRates = {
    spawnRate: 4,
    captureFraction: 0.25,
    coreScale: 0.02,
    coreColour: INITIAL_CORE,
    particleColour: INITIAL_PARTICLE,
    particleSize: 0.3,
    particleCount: 8,
    orbit: [0.6, 0.9],
    drag: 0.06,
    lifetime: 26,
    body: 'mote',
    budget: 1200,
    reducedMotion: false,
  };

  // What is actually drawn, chasing `rates`. Kept separate so a stage change is a morph.
  const shown = {
    scale: rates.coreScale,
    core: unpack(INITIAL_CORE),
    particle: unpack(INITIAL_PARTICLE),
    // Size and count ease too, so a promotion is a field that thins and coarsens over a
    // couple of seconds rather than a cut.
    particleSize: rates.particleSize,
    particleCount: rates.particleCount,
  };

  const geo: FieldGeometry = { centreX: 0, centreY: 0, spawnRadius: 400, coreRadius: CORE_MIN_RADIUS };

  /** Decays to 1; above 1 while a pulse is in flight. */
  /** 0..1, ramps up after a body change while the previous body fades out. */
  let bodyBlend = 1;
  let shownBody: BodyKind = 'mote';
  let particlesAreHard = false;

  let pulseStrength = 1;
  /** 0..1, brightens the core briefly on each absorption. */
  let flash = 0;
  let time = 0;

  const rings: Array<{ gfx: Graphics; life: number }> = [];
  for (let i = 0; i < 4; i++) {
    const gfx = new Graphics();
    gfx.visible = false;
    gfx.blendMode = 'add';
    effects.addChild(gfx);
    rings.push({ gfx, life: 0 });
  }

  function rebuildPool(capacity: number): void {
    pool = new ParticlePool(capacity);
    field.particleChildren.length = 0;
    sprites = [];
    for (let i = 0; i < capacity; i++) {
      const p = new Particle({
        texture: particlesAreHard ? textures.particleHard : textures.particleSoft,
        x: 0,
        y: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0,
      });
      p.scaleX = p.scaleY = 0.08;
      sprites.push(p);
      field.addParticle(p);
    }
    field.update();
  }

  function rebuildStars(): void {
    const { width, height } = app.screen;
    stars.particleChildren.length = 0;
    const count = rates.reducedMotion ? 120 : 260;
    for (let i = 0; i < count; i++) {
      const p = new Particle({
        texture: glow,
        x: Math.random() * width,
        y: Math.random() * height,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0.06 + Math.random() * 0.2,
      });
      p.scaleX = p.scaleY = 0.012 + Math.random() * 0.03;
      p.tint = 0xcfe2ff;
      stars.addParticle(p);
    }
    stars.update();
  }

  function layout(): void {
    const { width, height } = app.screen;
    geo.centreX = width / 2;
    geo.centreY = height / 2;
    // Just past the corner: far enough that nothing pops into view, close enough that the
    // field does not spend its whole budget on particles nobody can see.
    geo.spawnRadius = Math.max(220, (Math.hypot(width, height) / 2) * 1.04);
    halo.position.set(geo.centreX, geo.centreY);
    core.position.set(geo.centreX, geo.centreY);
    corePrevious.position.set(geo.centreX, geo.centreY);
  }

  rebuildPool(rates.budget);
  layout();
  rebuildStars();

  const resizeObserver = new ResizeObserver(() => {
    layout();
    rebuildStars();
  });
  resizeObserver.observe(parent);

  // --- interaction -------------------------------------------------------------------
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.cursor = 'pointer';
  const onTap = (): void => options.onPulse();
  app.stage.on('pointertap', onTap);

  // --- frame -------------------------------------------------------------------------
  function frame(dt: number): void {
    time += dt;

    // Ease everything the stage controls, rather than snapping to it.
    const k = 1 - Math.exp(-MORPH_RATE * dt);
    shown.scale += (rates.coreScale - shown.scale) * k;
    shown.particleSize += (rates.particleSize - shown.particleSize) * k;
    shown.particleCount += (rates.particleCount - shown.particleCount) * k;
    easeColour(shown.core, rates.coreColour, k);
    easeColour(shown.particle, rates.particleColour, k);

    // Trajectory and lifetime come from the stage. They apply at spawn, so they do not need
    // easing — new particles simply start behaving like the stage you are now in.
    tuning.captureTangential = rates.orbit;
    tuning.captureDrag = rates.drag;
    tuning.lifetime = rates.lifetime;

    const particleTint = pack(shown.particle);
    const coreTint = pack(shown.core);

    // The stage's count multiplier lands *inside* the clamp, so a dust field is allowed to
    // ask for far more than the pool can hold — it saturates the budget, which is the point.
    const emission =
      Math.min(
        MAX_VISUAL_SPAWN,
        Math.max(MIN_VISUAL_SPAWN, rates.spawnRate) * shown.particleCount,
      ) * (rates.reducedMotion ? 0.4 : 1);

    // A trail is motion, so reduced motion takes it to nothing — one factor, not a branch.
    const trail = rates.reducedMotion ? 0 : 1;

    geo.coreRadius = lerp(CORE_MIN_RADIUS, CORE_MAX_RADIUS, shown.scale);

    pool.emit(dt, emission, geo, tuning, rates.captureFraction);
    pool.update(dt, geo, tuning, pulseStrength);

    const absorbed = pool.drainAbsorbed();
    if (absorbed > 0) flash = Math.min(1, flash + absorbed * 0.04);
    flash *= Math.max(0, 1 - dt * 3.2);
    pulseStrength = 1 + (pulseStrength - 1) * Math.max(0, 1 - dt * 2.6);

    // Sync physics -> sprites. One pass, no allocation.
    const n = pool.capacity;
    for (let i = 0; i < n; i++) {
      const sprite = sprites[i];
      if (!sprite) continue;
      if (pool.active[i] === 0) {
        sprite.alpha = 0;
        continue;
      }
      sprite.x = pool.x[i] as number;
      sprite.y = pool.y[i] as number;
      sprite.tint = particleTint;

      const s = (pool.size[i] as number) * 0.07 * shown.particleSize;
      const alpha = pool.alpha[i] as number;

      if (trail === 0) {
        sprite.rotation = 0;
        sprite.scaleX = s;
        sprite.scaleY = s;
        sprite.alpha = alpha;
        continue;
      }

      const vx = pool.vx[i] as number;
      const vy = pool.vy[i] as number;
      const speed = Math.hypot(vx, vy);
      const stretch = 1 + Math.min(TRAIL_MAX_STRETCH, (speed / TRAIL_SPEED_REF) * trail);

      sprite.rotation = Math.atan2(vy, vx);
      sprite.scaleX = s * stretch;
      sprite.scaleY = s;
      // Spreading the same dot over more pixels should not also make it brighter. Full
      // energy conservation (alpha / stretch) makes the fast ones vanish, which is the
      // opposite of the point, so this splits the difference.
      sprite.alpha = alpha / Math.sqrt(stretch);
    }

    // A change of body starts a crossfade: the old sprite keeps what it had and fades.
    if (rates.body !== shownBody) {
      corePrevious.texture = core.texture;
      corePrevious.blendMode = core.blendMode;
      corePrevious.tint = core.tint;
      core.texture = textures.body[rates.body];
      core.blendMode = LUMINOUS.has(rates.body) ? 'add' : 'normal';
      shownBody = rates.body;
      bodyBlend = 0;
    }
    bodyBlend = Math.min(1, bodyBlend + dt * 0.9);

    const wantHard = !LUMINOUS.has(rates.body);
    if (wantHard !== particlesAreHard) {
      particlesAreHard = wantHard;
      const texture = wantHard ? textures.particleHard : textures.particleSoft;
      for (const sprite of sprites) sprite.texture = texture;
    }

    const luminous = LUMINOUS.has(shownBody);

    // Core: sized by progress, brightened by what it just ate, with a slow idle breath.
    const breath = rates.reducedMotion ? 0 : Math.sin(time * 1.1) * 0.025;
    const coreScale = (geo.coreRadius / 64) * (1 + breath + flash * 0.18);
    core.scale.set(coreScale);
    corePrevious.scale.set(coreScale);

    // Solid bodies keep their own colour. Washing a quarter of white through everything is
    // what made rock look like fog; only a luminous body should be near-white at rest.
    core.tint = luminous
      ? mixColour(coreTint, 0xffffff, 0.3 + flash * 0.4)
      : mixColour(coreTint, 0xffffff, flash * 0.35);
    core.alpha = luminous ? 0.85 + flash * 0.15 : bodyBlend;
    corePrevious.alpha = 1 - bodyBlend;

    // The halo is light, so it belongs to bodies that emit it. A rock gets a hint of dust.
    halo.scale.set(coreScale * (luminous ? 3.4 : 2.2));
    halo.alpha = luminous
      ? 0.16 + flash * 0.2 + shown.scale * 0.12
      : 0.05 + flash * 0.12;
    halo.tint = particleTint;

    for (const ring of rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt * 1.6;
      if (ring.life <= 0) {
        ring.gfx.visible = false;
        continue;
      }
      const t = 1 - ring.life;
      ring.gfx.scale.set(0.2 + t * 2.6);
      ring.gfx.alpha = ring.life * 0.7;
    }
  }

  app.ticker.add((ticker) => {
    // Clamp: a backgrounded tab returns one enormous delta, which would teleport everything
    // through the core in a single step.
    frame(Math.min(ticker.deltaMS / 1000, 0.05));
  });

  return {
    setRates(next: FieldRates): void {
      const budgetChanged = next.budget !== rates.budget;
      const motionChanged = next.reducedMotion !== rates.reducedMotion;
      rates = next;
      if (budgetChanged) rebuildPool(next.budget);
      if (motionChanged) rebuildStars();
    },

    pulse(): void {
      pulseStrength = 9;
      pool.kick(geo, 260);
      flash = Math.min(1, flash + 0.5);

      if (rates.reducedMotion) return;
      const ring = rings.find((r) => r.life <= 0);
      if (!ring) return;
      ring.gfx.clear();
      ring.gfx.circle(0, 0, 90).stroke({ width: 3, color: pack(shown.particle), alpha: 1 });
      ring.gfx.position.set(geo.centreX, geo.centreY);
      ring.gfx.visible = true;
      ring.life = 1;
    },

    destroy(): void {
      resizeObserver.disconnect();
      app.stage.off('pointertap', onTap);
      app.destroy(true, { children: true });
    },
  };
}
