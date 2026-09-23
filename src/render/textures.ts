import { Rectangle, Texture } from 'pixi.js';
import type { BodyKind } from '../sim/stages';

/**
 * Procedural textures, drawn once into canvases at start-up.
 *
 * The field used to draw every stage with the same soft radial gradient, additively blended.
 * That is exactly right for a star and exactly wrong for a rock, and it is why the early
 * ladder looked washed: additive blending onto a dark background can only *add* light, so a
 * boulder could never have a dark side, and a gradient with no edge could never have a
 * silhouette.
 *
 * So bodies come in kinds. Solid ones — motes, rocks, worlds, gas giants — carry their shape
 * in the alpha channel and their lighting in RGB, and are drawn with normal blending so they
 * occlude the field behind them and can be genuinely dark on one side. Luminous ones keep
 * the glow and the additive blend, because that is what light actually does.
 *
 * Everything is drawn white-to-grey and coloured by the sprite's tint, so one texture serves
 * every palette.
 */

/** Solid bodies occlude and can be dark; luminous ones add light. */
export const LUMINOUS: ReadonlySet<BodyKind> = new Set<BodyKind>(['mote', 'ember', 'star', 'remnant']);

const SIZE = 256;

/** Small deterministic PRNG, so craters land in the same place every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas2d(size = SIZE): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/** The light comes from the upper left in every body, so the ladder is lit consistently. */
function shade(ctx: CanvasRenderingContext2D, r: number, dark = '#1a1a1a'): CanvasGradient {
  const g = ctx.createLinearGradient(r * 0.35, r * 0.35, r * 1.75, r * 1.8);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#b4b4b4');
  g.addColorStop(1, dark);
  return g;
}

/** An irregular closed blob — a rock's silhouette, not a circle. */
function blobPath(ctx: CanvasRenderingContext2D, r: number, wobble: number, random: () => number): void {
  const points = 18;
  const radii: number[] = [];
  for (let i = 0; i < points; i++) radii.push(1 - wobble * random());

  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    // Average with the neighbour so the outline stays smooth rather than spiky.
    const rr = ((radii[i % points] as number) + (radii[(i + 1) % points] as number)) / 2;
    const x = r + Math.cos(a) * r * rr * 0.92;
    const y = r + Math.sin(a) * r * rr * 0.92;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A lit crescent along the illuminated limb, which is what sells a sphere. */
function rimLight(ctx: CanvasRenderingContext2D, r: number, strength: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(r * 0.62, r * 0.62, r * 0.1, r * 0.62, r * 0.62, r * 1.05);
  g.addColorStop(0, `rgba(255,255,255,${strength})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r * 2, r * 2);
  ctx.restore();
}

function craters(ctx: CanvasRenderingContext2D, r: number, count: number, random: () => number): void {
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * r * 0.72;
    const x = r + Math.cos(a) * d;
    const y = r + Math.sin(a) * d;
    const cr = r * (0.05 + random() * 0.13);

    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(x, y, cr, cr * (0.75 + random() * 0.25), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();

    // A bright lip on the side the light comes from.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, cr * 0.18);
    ctx.beginPath();
    ctx.arc(x, y, cr, Math.PI * 0.85, Math.PI * 1.75);
    ctx.stroke();
  }
}

function makeRock(seed: number): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;
  const random = rng(seed);

  blobPath(ctx, r, 0.22, random);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = shade(ctx, r, '#141414');
  ctx.fillRect(0, 0, SIZE, SIZE);
  craters(ctx, r, 11, random);
  rimLight(ctx, r, 0.28);
  ctx.restore();

  return Texture.from(canvas);
}

function makeWorld(seed: number): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;
  const random = rng(seed);

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r * 0.94, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = shade(ctx, r, '#0d0d0d');
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Continents: soft mottling, lighter and darker, so the disc is not a flat ball.
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * r * 0.85;
    const cr = r * (0.08 + random() * 0.2);
    ctx.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.ellipse(r + Math.cos(a) * d, r + Math.sin(a) * d, cr, cr * 0.7, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  rimLight(ctx, r, 0.34);
  ctx.restore();

  // A thin atmosphere on the lit limb.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = SIZE * 0.022;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.93, Math.PI * 0.72, Math.PI * 1.88);
  ctx.stroke();
  ctx.restore();

  return Texture.from(canvas);
}

function makeGas(seed: number): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;
  const random = rng(seed);

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r * 0.94, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = shade(ctx, r, '#101010');
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Horizontal bands. Unequal heights, or it reads as a barcode.
  let y = 0;
  while (y < SIZE) {
    const h = SIZE * (0.03 + random() * 0.09);
    ctx.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.13)';
    ctx.fillRect(0, y, SIZE, h);
    y += h;
  }

  // One storm, because a gas giant without a spot is a beach ball.
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(r * 1.32, r * 1.18, r * 0.2, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  rimLight(ctx, r, 0.3);
  ctx.restore();
  return Texture.from(canvas);
}

/** A brown dwarf: mostly dark, lit from within rather than from outside. */
function makeEmber(seed: number): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;
  const random = rng(seed);

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r * 0.92, 0, Math.PI * 2);
  ctx.clip();

  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#8a8a8a');
  g.addColorStop(1, '#242424');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  let y = 0;
  while (y < SIZE) {
    const h = SIZE * (0.05 + random() * 0.1);
    ctx.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, y, SIZE, h);
    y += h;
  }
  ctx.restore();
  return Texture.from(canvas);
}

/** A star: a hard bright disc that falls off fast, not a fog. */
function makeStar(): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;

  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.97)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return Texture.from(canvas);
}

/** A neutron star: a small fierce point with diffraction spikes. */
function makeRemnant(): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[SIZE * 0.9, SIZE * 0.012], [SIZE * 0.012, SIZE * 0.9]]) {
    const g = ctx.createLinearGradient(r - (w as number) / 2, 0, r + (w as number) / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(r - (w as number) / 2, r - (h as number) / 2, w as number, h as number);
  }
  const core = ctx.createRadialGradient(r, r, 0, r, r, r * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
  return Texture.from(canvas);
}

/** A black hole: an actual hole, with a ring. Opaque black, so it occludes the field. */
function makeHole(): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(r, r, r * 0.52, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = SIZE * 0.035;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = SIZE * 0.09;
  ctx.beginPath();
  ctx.ellipse(r, r, r * 0.82, r * 0.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  return Texture.from(canvas);
}

/** Dust has no body yet — only a thickening of the cloud. */
function makeMote(seed: number): Texture {
  const made = canvas2d();
  if (!made) return Texture.WHITE;
  const { canvas, ctx } = made;
  const r = SIZE / 2;
  const random = rng(seed);

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * r * 0.85;
    const cr = r * (0.03 + random() * 0.07);
    const g = ctx.createRadialGradient(r + Math.cos(a) * d, r + Math.sin(a) * d, 0, r + Math.cos(a) * d, r + Math.sin(a) * d, cr);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  return Texture.from(canvas);
}

export interface SceneTextures {
  body: Record<BodyKind, Texture>;
  /** Everything drawn as a sprite, cut from one canvas so the field still batches. */
  particles: ParticleAtlas;
  glow: Texture;
}

/**
 * Both particle variants live in a single canvas and are handed out as frames of one source.
 * Separate canvases would be separate GPU textures, which would break the particle
 * container's batching the moment a stage used the other one.
 */
/**
 * Everything drawn as a small sprite, cut from one canvas.
 *
 * One source texture, so the particle container still batches into a single draw call no
 * matter how many kinds of thing are in flight. A separate canvas per variant would be a
 * separate GPU texture and the batch would break the moment two stages shared the screen.
 *
 * The grid is 4 x 2 cells of 256px:
 *
 *   mote   grit   star   —
 *   rock0  rock1  rock2  rock3
 */
const ATLAS_CELL = 256;

function atlasCell(column: number, row: number): { x: number; y: number } {
  return { x: column * ATLAS_CELL, y: row * ATLAS_CELL };
}

/** A dust mote: no edge at all, just a thickening. The one the early field is made of. */
function drawMote(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = ATLAS_CELL / 2;
  const g = ctx.createRadialGradient(ox + r, oy + r, 0, ox + r, oy + r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, ATLAS_CELL, ATLAS_CELL);
}

/** Grit: a defined grain with a tight halo. Between a mote and a rock. */
function drawGrit(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = ATLAS_CELL / 2;
  const g = ctx.createRadialGradient(ox + r, oy + r, 0, ox + r, oy + r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.34, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.48, 'rgba(255,255,255,0.26)');
  g.addColorStop(0.66, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, ATLAS_CELL, ATLAS_CELL);
}

/**
 * A star for the background: a hard point with a short bloom and a pair of faint spikes.
 *
 * The bloom has to fall off fast. A star drawn as a soft blob reads as a smudge on the lens;
 * what makes a night sky look like one is that the bright ones are *points* with a little
 * light bleeding off them, and the faint ones are almost single pixels.
 */
function drawStar(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
  const r = ATLAS_CELL / 2;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.globalCompositeOperation = 'lighter';

  for (const [w, h] of [
    [ATLAS_CELL * 0.86, ATLAS_CELL * 0.012],
    [ATLAS_CELL * 0.012, ATLAS_CELL * 0.86],
  ] as const) {
    const g = ctx.createLinearGradient(r - w / 2, 0, r + w / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(r - w / 2, r - h / 2, w, h);
  }

  const core = ctx.createRadialGradient(r, r, 0, r, r, r * 0.34);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.36, 'rgba(255,255,255,0.28)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, ATLAS_CELL, ATLAS_CELL);
  ctx.restore();
}

/**
 * A meteoroid: an irregular lump, lit from the upper left like everything else on screen.
 *
 * This is the piece the late ladder was missing. A supergiant pulling in soft white blobs
 * reads as fog blowing past; the same stage pulling in lit rocks reads as a system sweeping
 * up what is left of its own disc. Four variants so a field of them does not look stamped,
 * handed out per particle through the atlas frame.
 *
 * Drawn white-to-black and tinted at draw time, like the bodies, so one set serves every
 * palette on the ladder.
 */
function drawRock(ctx: CanvasRenderingContext2D, ox: number, oy: number, seed: number): void {
  const random = rng(seed);
  const r = ATLAS_CELL / 2;

  ctx.save();
  ctx.translate(ox, oy);

  // Silhouette first, then everything else clipped inside it.
  blobPath(ctx, r, 0.3, random);
  ctx.clip();

  // Lit from the upper left, falling to nearly black on the far side. The dark side is the
  // whole point: an object has one, a glow does not.
  // Not pure white at the lit end. A rock reflects a few percent of what falls on it, and a
  // field of them drawn at full brightness reads as confetti rather than as matter.
  const g = ctx.createLinearGradient(r * 0.3, r * 0.3, r * 1.72, r * 1.78);
  g.addColorStop(0, '#e6e6e6');
  g.addColorStop(0.36, '#a8a8a8');
  g.addColorStop(0.68, '#3a3a3a');
  g.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ATLAS_CELL, ATLAS_CELL);

  // A few pits, and grain, so the lump has a surface rather than a gradient.
  craters(ctx, r, 5, random);
  for (let i = 0; i < 40; i++) {
    const x = random() * ATLAS_CELL;
    const y = random() * ATLAS_CELL;
    ctx.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.14)';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.09, r * 0.06, random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  rimLight(ctx, r, 0.22);
  ctx.restore();
}

export interface ParticleAtlas {
  /** The early field: soft, edgeless, many. */
  mote: Texture;
  /** The middle: defined grains. */
  grit: Texture;
  /** Background stars. */
  star: Texture;
  /** The late field: lit irregular bodies, four of them. */
  rocks: Texture[];
  /** Soft radial light, reused for the core halo. */
  glow: Texture;
}

function makeParticleAtlas(): ParticleAtlas {
  const made = canvas2d(ATLAS_CELL * 4);
  if (!made) {
    const w = Texture.WHITE;
    return { mote: w, grit: w, star: w, rocks: [w], glow: w };
  }
  const { canvas, ctx } = made;

  const mote = atlasCell(0, 0);
  const grit = atlasCell(1, 0);
  const star = atlasCell(2, 0);
  drawMote(ctx, mote.x, mote.y);
  drawGrit(ctx, grit.x, grit.y);
  drawStar(ctx, star.x, star.y);
  for (let i = 0; i < 4; i++) {
    const at = atlasCell(i, 1);
    drawRock(ctx, at.x, at.y, 17 + i * 91);
  }

  const source = Texture.from(canvas).source;
  const frame = (column: number, row: number): Texture =>
    new Texture({
      source,
      frame: new Rectangle(column * ATLAS_CELL, row * ATLAS_CELL, ATLAS_CELL, ATLAS_CELL),
    });

  return {
    mote: frame(0, 0),
    grit: frame(1, 0),
    star: frame(2, 0),
    rocks: [frame(0, 1), frame(1, 1), frame(2, 1), frame(3, 1)],
    glow: frame(0, 0),
  };
}

export function makeSceneTextures(): SceneTextures {
  const atlas = makeParticleAtlas();
  return {
    body: {
      mote: makeMote(7),
      rock: makeRock(11),
      world: makeWorld(23),
      gas: makeGas(31),
      ember: makeEmber(41),
      star: makeStar(),
      remnant: makeRemnant(),
      hole: makeHole(),
    },
    particles: atlas,
    glow: atlas.glow,
  };
}
