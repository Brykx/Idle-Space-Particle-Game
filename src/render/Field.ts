import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Texture,
} from 'pixi.js';
import { DEFAULT_TUNING, ParticlePool, type FieldGeometry } from './pool';

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
  /** 0..1 overall progress, used for core size and palette drift. */
  progress: number;
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

/** A soft radial dot, built once and shared by every sprite in the scene. */
function makeGlowTexture(size = 128): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

const COLD = 0x9fc6ff;
const WARM = 0xffd9a0;

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

  const glow = makeGlowTexture();

  // --- scene graph -------------------------------------------------------------------
  const stars = new ParticleContainer({ dynamicProperties: {} });
  stars.blendMode = 'add';

  const field = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false, uvs: false, vertex: false },
  });
  field.blendMode = 'add';

  const effects = new Container();

  const halo = new Sprite(glow);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';
  halo.tint = COLD;

  const core = new Sprite(glow);
  core.anchor.set(0.5);
  core.blendMode = 'add';

  app.stage.addChild(stars, field, halo, core, effects);

  // --- state -------------------------------------------------------------------------
  const tuning = { ...DEFAULT_TUNING };
  let pool = new ParticlePool(1200);
  let sprites: Particle[] = [];

  let rates: FieldRates = {
    spawnRate: 4,
    captureFraction: 0.25,
    progress: 0,
    budget: 1200,
    reducedMotion: false,
  };

  const geo: FieldGeometry = { centreX: 0, centreY: 0, spawnRadius: 400, coreRadius: CORE_MIN_RADIUS };

  /** Decays to 1; above 1 while a pulse is in flight. */
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
      const p = new Particle({ texture: glow, x: 0, y: 0, anchorX: 0.5, anchorY: 0.5, alpha: 0 });
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

    const colour = mixColour(COLD, WARM, rates.progress);
    const emission =
      Math.min(MAX_VISUAL_SPAWN, Math.max(MIN_VISUAL_SPAWN, rates.spawnRate)) *
      (rates.reducedMotion ? 0.4 : 1);

    geo.coreRadius = lerp(CORE_MIN_RADIUS, CORE_MAX_RADIUS, rates.progress);

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
      sprite.alpha = pool.alpha[i] as number;
      const s = (pool.size[i] as number) * 0.13;
      sprite.scaleX = s;
      sprite.scaleY = s;
      sprite.tint = colour;
    }

    // Core: sized by progress, brightened by what it just ate, with a slow idle breath.
    const breath = rates.reducedMotion ? 0 : Math.sin(time * 1.1) * 0.025;
    const coreScale = (geo.coreRadius / 64) * (1 + breath + flash * 0.18);
    core.scale.set(coreScale);
    core.tint = mixColour(0xfff4de, 0xffffff, flash);
    core.alpha = 0.85 + flash * 0.15;

    halo.scale.set(coreScale * 3.4);
    halo.alpha = 0.16 + flash * 0.20 + rates.progress * 0.12;
    halo.tint = colour;

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
      ring.gfx.circle(0, 0, 90).stroke({ width: 3, color: 0xbfe0ff, alpha: 1 });
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
