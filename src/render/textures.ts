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
  /** Soft and hard particle dots, cut from one canvas so the field still batches. */
  particleSoft: Texture;
  particleHard: Texture;
  glow: Texture;
}

/**
 * Both particle variants live in a single canvas and are handed out as frames of one source.
 * Separate canvases would be separate GPU textures, which would break the particle
 * container's batching the moment a stage used the other one.
 */
function makeParticleAtlas(): { soft: Texture; hard: Texture; glow: Texture } {
  const made = canvas2d(256);
  if (!made) return { soft: Texture.WHITE, hard: Texture.WHITE, glow: Texture.WHITE };
  const { canvas, ctx } = made;

  const soft = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  soft.addColorStop(0, 'rgba(255,255,255,1)');
  soft.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  soft.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  soft.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = soft;
  ctx.fillRect(0, 0, 128, 128);

  // The hard variant: a defined grain with a small halo, so rock reads as grit not fog.
  const hard = ctx.createRadialGradient(192, 64, 0, 192, 64, 64);
  hard.addColorStop(0, 'rgba(255,255,255,1)');
  hard.addColorStop(0.28, 'rgba(255,255,255,1)');
  hard.addColorStop(0.36, 'rgba(255,255,255,0.55)');
  hard.addColorStop(0.55, 'rgba(255,255,255,0.10)');
  hard.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hard;
  ctx.fillRect(128, 0, 128, 128);

  const source = Texture.from(canvas).source;
  return {
    soft: new Texture({ source, frame: new Rectangle(0, 0, 128, 128) }),
    hard: new Texture({ source, frame: new Rectangle(128, 0, 128, 128) }),
    glow: new Texture({ source, frame: new Rectangle(0, 0, 128, 128) }),
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
    particleSoft: atlas.soft,
    particleHard: atlas.hard,
    glow: atlas.glow,
  };
}
