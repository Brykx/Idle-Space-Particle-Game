import {
  Application,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Texture,
} from 'pixi.js';
import { createBodies, type Bodies, type BodyState } from './impostor';
import { DEFAULT_TUNING, ParticlePool, type FieldGeometry } from './pool';
import { LUMINOUS, makeSceneTextures } from './textures';
import { createSky, type SkyStar } from './sky';
import { createRelease, type ReleaseSpec } from './release';
import { hueColour, makeNebula, makeShell } from './nebula';
import type { BodyKind, GrainKind } from '../sim/stages';

export type { SkyStar } from './sky';
export type { ReleaseSpec } from './release';

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
  /** How far out particles are drawn from, as a fraction of the screen's own reach. */
  width: number;
  /** What a single infalling particle is drawn as. */
  grain: GrainKind;
  /** 0 face-on, 1 strongly inclined. Squashes the field into a disc seen from above it. */
  tilt: number;
  /** Which family of body the core is, and therefore how it is drawn. */
  body: BodyKind;
  /** Maximum live particles. */
  budget: number;
  reducedMotion: boolean;
  /**
   * 0..1, how much of the cloud is left to fall in, as the eye should see it. Multiplies
   * emission after every floor and ceiling, so a finished star really does sit in a cleared
   * field, and between stars nothing falls at all.
   */
  density: number;
  /** Whether there is a body at the centre at all. Between stars there is not. */
  present: boolean;
}

export interface FieldHandle {
  setRates(rates: FieldRates): void;
  /** The stars you have made, in the sky behind everything. */
  setSky(stars: SkyStar[]): void;
  /** The cloud this run condenses from, drawn as a nebula that thins as it is spent. */
  setCloud(cloud: { seed: number; hue: number } | null): void;
  /** Let a star go: its shell or its supernova, and its light rising to its place. */
  release(spec: ReleaseSpec): void;
  destroy(): void;
}

const CORE_MIN_RADIUS = 14;
const CORE_MAX_RADIUS = 64;
/** Hard ceiling on emission so a late-game rate cannot flood the pool. */
const MAX_VISUAL_SPAWN = 260;
/**
 * Floor on emission. The field is cosmetic, and an empty screen in the opening minute reads
 * as broken rather than as sparse — so it always drifts, even when income is a trickle. The
 * one thing allowed under the floor is the cloud running out, through `density`.
 */
const MIN_VISUAL_SPAWN = 22;

/** Seconds over which the core's feeding is averaged. Long enough that no single hit shows. */
const FEEDING_SMOOTHING = 4;
/** Absorptions per second at which the feeding glow is halfway to its ceiling. */
const FEEDING_HALF = 25;

/** The radius the occluding disc is tessellated at, before it is scaled to the body. */
const OCCLUDER_RADIUS = 512;

/** Where the light comes from on every rock sprite: the upper left, as on every body. */
const SPRITE_LIGHT_ANGLE = Math.atan2(-0.58, -0.52);

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
 * becoming a planet is something you watch happen over several seconds — a promotion is a
 * moment, and moments are slow — rather than a palette swap.
 */
const MORPH_RATE = 0.5;

/** How fast one body dissolves into the next, per second. Four seconds for a promotion. */
const BODY_BLEND_RATE = 0.25;

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
  /** Called when the player touches the field. It pays nothing; it is a toy. */
  onStir?: () => void;
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
  const sky = createSky({ star: textures.particles.star, glow });
  const release = createRelease({ glow, star: textures.particles.star, shell: makeShell() });

  /** The cloud this run condenses from. Behind the field, in front of the sky. */
  const nebula = new Sprite(Texture.WHITE);
  nebula.anchor.set(0.5);
  nebula.blendMode = 'add';
  nebula.alpha = 0;
  let nebulaSeed = -1;
  let nebulaTarget = 0;

  const field = new ParticleContainer({
    // `scale` is not one of these — size and anchor are baked into `vertex`, so per-frame
    // scale changes need `vertex: true`. Without it the pool's per-particle size variation
    // is uploaded once at build time and every particle renders the same size forever.
    // `uvs` is dynamic so a particle can switch between the soft and hard dot without
    // rebuilding the pool, which would kill every particle in flight at each promotion.
    dynamicProperties: { position: true, color: true, rotation: true, vertex: true, uvs: true },
  });
  field.blendMode = 'add';

  /**
   * The few particles that are in front of the core rather than behind it.
   *
   * Everything used to pass behind, which is why a tilted disc read as a halo: a ring has a
   * near half that crosses the body, and without it the field is a glow around the core
   * rather than something orbiting it.
   *
   * Doing it properly would mean every sprite existing in both layers and swapping each
   * frame, which doubles the upload for a distinction nobody can see. A particle in front of
   * empty space looks identical either way — **only the ones overlapping the core matter** —
   * and at any moment that is a handful. So this is a small fixed pool, filled each frame
   * from whichever particles are both on the near side and over the body.
   */
  const fieldFront = new ParticleContainer({
    dynamicProperties: { position: true, color: true, rotation: true, vertex: true, uvs: true },
  });
  const FRONT_SLOTS = 96;
  let frontSprites: Particle[] = [];

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

  // Every stage is drawn by a shader when the renderer can run GLSL. If it cannot, this
  // stays null and the two core sprites above carry the body from `textures.ts` instead —
  // the same field, drawn less well, rather than no field at all.
  const bodies: Bodies | null = createBodies(app.renderer);

  /**
   * An opaque black disc, drawn under the body and over the field.
   *
   * A luminous body is additively blended, and additive blending cannot occlude: a meteoroid
   * passing *behind* a star had the star's light added on top of it and came out as a bright
   * blob sitting on the star's face. It is the same lesson as "additive light cannot be dark"
   * arriving from the other side — the body was not too dark, it was too transparent.
   *
   * So everything with a surface gets a hole punched for it first, and the light is added
   * onto that. Dust is the exception, because a cloud genuinely does not occlude.
   */
  const occluder = new Graphics();
  // Built large and scaled down, never small and scaled up: Pixi tessellates a circle by the
  // radius it is drawn at, and a unit circle blown up to a star's size is a visible polygon
  // showing through the soft edge of the limb.
  occluder.circle(0, 0, OCCLUDER_RADIUS).fill(0x000000);

  app.stage.addChild(sky.view, nebula, field, halo, corePrevious, core, occluder);
  if (bodies) app.stage.addChild(bodies.view);
  app.stage.addChild(release.view, fieldFront, effects);

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
    width: 1,
    grain: 'mote',
    tilt: 0,
    body: 'mote',
    budget: 1200,
    reducedMotion: false,
    density: 1,
    present: true,
  };

  /** 0..1, how much of a body there is at the centre. Eases, so a star leaves gradually. */
  let presence = 1;

  // What is actually drawn, chasing `rates`. Kept separate so a stage change is a morph.
  const shown = {
    scale: rates.coreScale,
    core: unpack(INITIAL_CORE),
    particle: unpack(INITIAL_PARTICLE),
    // Size, count and width ease too, so a promotion is a field that thins, coarsens and
    // draws in over a couple of seconds rather than a cut.
    particleSize: rates.particleSize,
    particleCount: rates.particleCount,
    width: rates.width,
    tilt: rates.tilt,
  };

  const geo: FieldGeometry = {
    centreX: 0,
    centreY: 0,
    spawnRadius: 400,
    viewRadius: 400,
    coreRadius: CORE_MIN_RADIUS,
  };

  /** Decays to 1; above 1 while a pulse is in flight. */
  /** 0..1, ramps up after a body change while the previous body fades out. */
  let bodyBlend = 1;
  let shownBody: BodyKind = 'mote';
  let previousBody: BodyKind = 'mote';

  /**
   * Lit bodies are drawn over the field rather than added to it, because a rock has a dark
   * side and additive light cannot. Motes and grit stay additive: a dust cloud really is
   * light summing, and that is the stage nobody wanted changed.
   */
  const GRAIN_BLEND: Record<GrainKind, 'add' | 'normal'> = {
    mote: 'add',
    grit: 'add',
    rock: 'normal',
  };

  /** Which atlas frame a given particle gets. Rocks are handed one of four, by index. */
  function grainTexture(grain: GrainKind, index: number): Texture {
    if (grain === 'mote') return textures.particles.mote;
    if (grain === 'grit') return textures.particles.grit;
    const rocks = textures.particles.rocks;
    return rocks[index % rocks.length] ?? textures.particles.grit;
  }

  let shownGrain: GrainKind = 'mote';

  let pulseStrength = 1;
  /**
   * How hard the core is feeding: absorptions per second, smoothed over several seconds, and
   * the 0..1 glow that follows from it.
   *
   * This was a flash. Every absorption pushed the body a little larger and a little brighter,
   * and at dozens a second the core never stopped jumping — the one thing on screen that was
   * meant to be the calmest. What it carried was true, that you are catching things, but it
   * said so once per rock. `warmth` is that, said once. Averaged, it says it once: the core glows a little warmer while
   * the infall is heavy and cools as the cloud thins, and its size never moves at all.
   */
  let feeding = 0;
  let warmth = 0;
  let time = 0;

  /** The record a release is carrying to its place, while it is in flight. */
  let releasingStar: number | null = null;

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
        texture: grainTexture(shownGrain, i),
        x: 0,
        y: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0,
      });
      p.scaleX = p.scaleY = 0.04;
      sprites.push(p);
      field.addParticle(p);
    }
    field.update();

    fieldFront.particleChildren.length = 0;
    frontSprites = [];
    for (let i = 0; i < FRONT_SLOTS; i++) {
      const p = new Particle({
        texture: grainTexture(shownGrain, i),
        x: 0,
        y: 0,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 0,
      });
      p.scaleX = p.scaleY = 0.04;
      frontSprites.push(p);
      fieldFront.addParticle(p);
    }
    fieldFront.update();
  }

  function layout(): void {
    const { width, height } = app.screen;
    geo.centreX = width / 2;
    geo.centreY = height / 2;
    // Just past the corner: far enough that nothing pops into view, close enough that the
    // field does not spend its whole budget on particles nobody can see.
    // Just past the corner: far enough that a full-width field never pops into view, close
    // enough that it does not spend its budget on particles nobody can see.
    geo.viewRadius = Math.max(220, (Math.hypot(width, height) / 2) * 1.04);
    sky.layout(width, height, rates.reducedMotion);
    nebula.position.set(geo.centreX, geo.centreY);
    // The texture is 256 pixels across; the cloud should overfill the screen.
    nebula.scale.set((Math.hypot(width, height) * 1.15) / 256);
    halo.position.set(geo.centreX, geo.centreY);
    core.position.set(geo.centreX, geo.centreY);
    corePrevious.position.set(geo.centreX, geo.centreY);
    occluder.position.set(geo.centreX, geo.centreY);
    bodies?.view.position.set(geo.centreX, geo.centreY);
  }

  rebuildPool(rates.budget);
  layout();

  const resizeObserver = new ResizeObserver(() => layout());
  resizeObserver.observe(parent);

  // --- interaction -------------------------------------------------------------------
  //
  // Touching the field stirs it: a ripple where you touched, and a tug on whatever is near.
  // It pays nothing, so there is no best rhythm to do it in. It is a toy.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  const onTap = (event: { global: { x: number; y: number } }): void => {
    stir(event.global.x, event.global.y);
    options.onStir?.();
  };
  app.stage.on('pointertap', onTap);

  function stir(x: number, y: number): void {
    const squash = 1 - shown.tilt * 0.72;
    // The pool lives in the orbital plane; the screen is that plane squashed.
    const planeY = geo.centreY + (y - geo.centreY) / Math.max(0.2, squash);
    const reach = Math.min(app.screen.width, app.screen.height) * 0.22;
    pool.stir(x, planeY, reach, rates.reducedMotion ? 40 : 140);

    if (rates.reducedMotion) return;
    const ring = rings.find((r) => r.life <= 0);
    if (!ring) return;
    ring.gfx.clear();
    ring.gfx.circle(0, 0, 40).stroke({ width: 1.5, color: pack(shown.particle), alpha: 1 });
    ring.gfx.position.set(x, y);
    ring.gfx.visible = true;
    ring.life = 1;
  }

  /**
   * Move a particle into the front layer if it is crossing the body on the near side.
   *
   * Copies the sprite rather than reassigning it, because a `ParticleContainer`'s membership
   * is fixed at build time — and hides the original, so it is the same particle in one place
   * rather than two. Returns the next free front slot.
   */
  function promote(sprite: Particle, used: number, crossing: number): number {
    if (crossing <= 0 || used >= frontSprites.length) return used;
    if (sprite.alpha <= 0) return used;

    const dy = sprite.y - geo.centreY;
    // Below centre is the near half of a plane seen from above.
    if (dy <= 0) return used;
    const dx = sprite.x - geo.centreX;
    if (dx * dx + dy * dy > crossing * crossing) return used;

    const front = frontSprites[used];
    if (!front) return used;
    front.x = sprite.x;
    front.y = sprite.y;
    front.tint = sprite.tint;
    front.rotation = sprite.rotation;
    front.scaleX = sprite.scaleX;
    front.scaleY = sprite.scaleY;
    front.alpha = sprite.alpha;
    sprite.alpha = 0;
    return used + 1;
  }

  // --- frame -------------------------------------------------------------------------
  function frame(dt: number): void {
    time += dt;

    // Ease everything the stage controls, rather than snapping to it.
    const k = 1 - Math.exp(-MORPH_RATE * dt);
    shown.scale += (rates.coreScale - shown.scale) * k;
    shown.particleSize += (rates.particleSize - shown.particleSize) * k;
    shown.particleCount += (rates.particleCount - shown.particleCount) * k;
    shown.width += (rates.width - shown.width) * k;
    shown.tilt += (rates.tilt - shown.tilt) * k;
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
      ) *
      (rates.reducedMotion ? 0.4 : 1) *
      Math.max(0, Math.min(1, rates.density));

    // The body comes and goes slowly: a star let go fades out from under its shell, and the
    // next run's first speck of dust fades in.
    presence += ((rates.present ? 1 : 0) - presence) * (1 - Math.exp(-0.8 * dt));
    sky.frame(dt, rates.reducedMotion);
    nebula.alpha += (nebulaTarget * Math.sqrt(Math.max(0, rates.density)) - nebula.alpha) * (1 - Math.exp(-0.4 * dt));

    // A trail is motion, so reduced motion takes it to nothing — one factor, not a branch.
    const trail = rates.reducedMotion ? 0 : 1;

    // How much the field is flattened on screen. Face-on at Dust, which is the one stage of
    // the field that was already right.
    const squash = 1 - shown.tilt * 0.72;

    geo.coreRadius = lerp(CORE_MIN_RADIUS, CORE_MAX_RADIUS, shown.scale);
    // Never inside the core itself, whatever a stage asks for.
    geo.spawnRadius = Math.max(geo.coreRadius * 2.5, geo.viewRadius * shown.width);

    pool.emit(dt, emission, geo, tuning, rates.captureFraction);
    pool.update(dt, geo, tuning, pulseStrength);

    const absorbed = pool.drainAbsorbed();
    if (dt > 0) feeding += (absorbed / dt - feeding) * (1 - Math.exp(-dt / FEEDING_SMOOTHING));
    // Saturating, so no rate of infall can push the glow past a gentle ceiling.
    warmth = feeding / (feeding + FEEDING_HALF);
    pulseStrength = 1 + (pulseStrength - 1) * Math.max(0, 1 - dt * 2.6);

    // Sync physics -> sprites. One pass, no allocation.
    //
    // A particle is in front of the core when it is on the near side of the disc — which, for
    // a plane we are looking down onto, is the half drawn below centre — and close enough to
    // overlap the body. Anywhere else the layer it sits in makes no visible difference, so it
    // stays in the cheap one.
    //
    // The test scales with the tilt: face-on there is no near half to speak of, and Dust is
    // face-on, which is the one stage of the field that was already right.
    const crossing = shown.tilt > 0.08 ? geo.coreRadius * 1.35 : 0;
    let frontUsed = 0;
    const luminousCore = LUMINOUS.has(shownBody) && presence > 0.5;

    const n = pool.capacity;
    for (let i = 0; i < n; i++) {
      const sprite = sprites[i];
      if (!sprite) continue;
      if (pool.active[i] === 0) {
        sprite.alpha = 0;
        continue;
      }
      sprite.x = pool.x[i] as number;
      // The simulation runs in the orbital plane and only the projection is tilted, which is
      // exactly what a circular orbit seen from above its plane looks like: unchanged in one
      // axis, squashed in the other. Nothing about the physics knows this is happening.
      sprite.y = geo.centreY + ((pool.y[i] as number) - geo.centreY) * squash;
      sprite.tint = particleTint;

      const s = (pool.size[i] as number) * 0.035 * shown.particleSize;
      const alpha = pool.alpha[i] as number;

      if (trail === 0) {
        sprite.rotation = 0;
        sprite.scaleX = s;
        sprite.scaleY = s;
        sprite.alpha = alpha;
        continue;
      }

      if (shownGrain === 'rock') {
        // A rock does not smear. Stretching the sprite along its velocity is what a streak
        // *is*, and it works because a soft dot has no shape to distort — the moment the
        // sprite has a silhouette, the same trick turns every meteoroid into a lozenge.
        //
        // Nor does it tumble, any more. The lighting is painted into the sprite, so a turning
        // rock turned its sunlit side with it. Around a dark body every rock keeps the light
        // where the body has it, upper left; around a star the star *is* the light, so each
        // rock turns its lit side towards the core.
        sprite.rotation = luminousCore
          ? Math.atan2(geo.centreY - sprite.y, geo.centreX - sprite.x) - SPRITE_LIGHT_ANGLE
          : 0;
        sprite.scaleX = s;
        sprite.scaleY = s;
        sprite.alpha = alpha;
        frontUsed = promote(sprite, frontUsed, crossing);
        continue;
      }

      const vx = pool.vx[i] as number;
      // Screen velocity, not plane velocity: the streak has to lie along the path as drawn,
      // and the drawn path is the squashed one.
      const vy = (pool.vy[i] as number) * squash;
      const speed = Math.hypot(vx, vy);
      // A streak is a distance, not a multiple of the body. At the same speed a dust mote
      // smears across many times its own width while a heavier grain barely elongates, so
      // the stretch is divided by how large the stage draws its particles.
      const stretchScale = 1 / Math.max(0.55, shown.particleSize);
      const stretch =
        1 + Math.min(TRAIL_MAX_STRETCH, (speed / TRAIL_SPEED_REF) * trail * stretchScale);

      sprite.rotation = Math.atan2(vy, vx);
      sprite.scaleX = s * stretch;
      sprite.scaleY = s;
      // Spreading the same dot over more pixels should not also make it brighter. Full
      // energy conservation (alpha / stretch) makes the fast ones vanish, which is the
      // opposite of the point, so this splits the difference.
      sprite.alpha = alpha / Math.sqrt(stretch);
      frontUsed = promote(sprite, frontUsed, crossing);
    }

    // Anything not claimed this frame is parked.
    for (let i = frontUsed; i < frontSprites.length; i++) {
      const spare = frontSprites[i];
      if (spare) spare.alpha = 0;
    }

    // A change of body starts a crossfade. The sprite path also swaps textures here, since
    // the blend mode itself changes between solid and luminous kinds and cannot be eased.
    if (rates.body !== shownBody) {
      if (!bodies) {
        corePrevious.texture = core.texture;
        corePrevious.blendMode = core.blendMode;
        corePrevious.tint = core.tint;
        core.texture = textures.body[rates.body];
        core.blendMode = LUMINOUS.has(rates.body) ? 'add' : 'normal';
      }
      previousBody = shownBody;
      shownBody = rates.body;
      bodyBlend = 0;
    }
    // Slow: a promotion is something you watch happen, not a palette swap.
    bodyBlend = Math.min(1, bodyBlend + dt * BODY_BLEND_RATE);

    if (rates.grain !== shownGrain) {
      shownGrain = rates.grain;
      field.blendMode = GRAIN_BLEND[shownGrain];
      fieldFront.blendMode = GRAIN_BLEND[shownGrain];
      for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        if (sprite) sprite.texture = grainTexture(shownGrain, i);
      }
      for (let i = 0; i < frontSprites.length; i++) {
        const sprite = frontSprites[i];
        if (sprite) sprite.texture = grainTexture(shownGrain, i);
      }
    }

    const luminous = LUMINOUS.has(shownBody);

    // Core: sized by progress and nothing else. A planet does not change size, so only what
    // shines breathes — a star's very slow, very slight pulse — and nothing reacts to a hit.
    const breath = rates.reducedMotion || !luminous ? 0 : Math.sin(time * 0.6) * 0.012;
    const coreScale = (geo.coreRadius / 64) * (1 + breath);

    // Slightly inside the body's own edge, so the disc never shows as a black rim outside an
    // antialiased silhouette. A mote has no surface to hide behind, and a body mid-crossfade
    // is only half there, so the hole fades with it.
    const solid = shownBody !== 'mote';
    occluder.visible = solid && presence > 0.01;
    if (solid) {
      occluder.scale.set((coreScale * 120 * 0.96) / OCCLUDER_RADIUS);
      occluder.alpha = (previousBody === 'mote' ? bodyBlend : 1) * presence;
    }

    if (bodies) {
      // The sprite bodies fill 94% of a 256px texture, so their drawn radius is 120 * scale.
      // The shader bodies inherit that number so the ladder keeps one sense of size.
      const radius = coreScale * 120;
      const body: Omit<BodyState, 'alpha'> = {
        radius,
        tint: coreTint,
        flash: warmth * 0.35,
        time: rates.reducedMotion ? 0 : time,
      };

      // Both sides of a promotion are on screen together while it happens, with the new one
      // in front so the old one dissolves out from under it.
      bodies.begin();
      if (presence > 0.01) {
        if (previousBody !== shownBody && bodyBlend < 1) {
          bodies.show(previousBody, { ...body, alpha: (1 - bodyBlend) * presence }, 0);
        }
        bodies.show(shownBody, { ...body, alpha: bodyBlend * presence }, 1);
      }
      bodies.end();

      core.alpha = 0;
      corePrevious.alpha = 0;
    } else {
      core.scale.set(coreScale);
      corePrevious.scale.set(coreScale);

      // Solid bodies keep their own colour. Washing a quarter of white through everything is
      // what made rock look like fog; only a luminous body should be near-white at rest.
      core.tint = luminous
        ? mixColour(coreTint, 0xffffff, 0.3 + warmth * 0.15)
        : mixColour(coreTint, 0xffffff, warmth * 0.08);
      core.alpha = (luminous ? 0.85 + warmth * 0.1 : bodyBlend) * presence;
      corePrevious.alpha = (1 - bodyBlend) * presence;
    }

    // The halo is light, so it belongs to bodies that emit it. A rock gets a hint of dust.
    // The shader bodies draw their own atmosphere and corona, so this is only the far-field
    // bloom for them, and most of it would be a second glow on top of a better one.
    const bloom = bodies ? 0.4 : 1;
    halo.scale.set(coreScale * (luminous ? 1.7 : 1.1));
    halo.alpha = (luminous ? 0.16 + warmth * 0.08 + shown.scale * 0.12 : 0.05 + warmth * 0.05) * bloom * presence;
    halo.tint = particleTint;

    if (release.running) {
      release.frame(
        dt,
        { x: geo.centreX, y: geo.centreY },
        Math.min(app.screen.width, app.screen.height) / 2,
        releasingStar === null ? null : sky.screenPositionOf(releasingStar),
        () => {
          sky.hold(null);
          releasingStar = null;
        },
      );
    }

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
      if (motionChanged) layout();
    },

    setSky(stars: SkyStar[]): void {
      sky.setStars(stars);
    },

    setCloud(cloud: { seed: number; hue: number } | null): void {
      if (!cloud) {
        nebulaTarget = 0;
        return;
      }
      if (cloud.seed !== nebulaSeed) {
        nebulaSeed = cloud.seed;
        const previous = nebula.texture;
        nebula.texture = makeNebula(cloud.seed);
        if (previous !== Texture.WHITE) previous.destroy(true);
      }
      nebula.tint = hueColour(cloud.hue);
      // Faint on purpose: the cloud is the setting, not the subject.
      nebulaTarget = 0.42;
    },

    release(spec: ReleaseSpec): void {
      if (rates.reducedMotion) {
        sky.hold(null);
        return;
      }
      releasingStar = spec.starId;
      sky.hold(spec.starId);
      release.start(spec, geo.coreRadius);
      // A supernova does not fade: the star is gone under the flash, all at once.
      if (spec.fate === 'supernova') presence = 0;
      // What the star threw off pushes the field outwards: gently for a shell of gas, hard for
      // a supernova. The particles already falling are the last of the cloud.
      pool.kick(geo, spec.fate === 'supernova' ? -360 : spec.fate === 'nebula' ? -90 : 0);
      pulseStrength = 1;
    },

    destroy(): void {
      resizeObserver.disconnect();
      app.stage.off('pointertap', onTap);
      app.destroy(true, { children: true });
    },
  };
}
