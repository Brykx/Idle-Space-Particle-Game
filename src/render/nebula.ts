import { Texture } from 'pixi.js';

/**
 * Two textures made once on a canvas: the cloud a run condenses from, and the shell a star
 * throws off when it is let go.
 *
 * Both are greyscale with the shape in alpha, so the colour is a tint applied at draw time —
 * a cloud's hue, a nebula's oxygen teal — and one texture serves every cloud.
 */

/** Seeded value noise, smoothly interpolated. Small and good enough for something this soft. */
function noise2(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number): number => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(n: (x: number, y: number) => number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

const SIZE = 256;

/**
 * The cloud: a soft, uneven haze, densest towards the middle and torn at the edges.
 *
 * Generated per cloud from its seed, so the same cloud looks the same after a reload and two
 * clouds never look alike. A quarter of a megapixel of noise takes a few milliseconds, once
 * per star.
 */
export function makeNebula(seed: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const image = ctx.createImageData(SIZE, SIZE);
  const n = noise2(seed % 100000);
  const warp = noise2((seed + 17) % 100000);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE - 0.5;
      const v = y / SIZE - 0.5;
      // Domain warp: what makes a cloud look like gas rather than like a texture.
      const wx = fbm(warp, u * 3 + 11, v * 3, 3) - 0.5;
      const wy = fbm(warp, u * 3, v * 3 + 7, 3) - 0.5;
      const density = fbm(n, (u + wx * 0.6) * 4 + 3, (v + wy * 0.6) * 4 + 5, 5);
      const falloff = Math.max(0, 1 - Math.hypot(u, v) * 2);
      const t = Math.min(1, Math.max(0, (density - 0.32) / 0.4));
      const a = t * t * (3 - 2 * t) * Math.pow(falloff, 1.4);

      const at = (y * SIZE + x) * 4;
      image.data[at] = 255;
      image.data[at + 1] = 255;
      image.data[at + 2] = 255;
      image.data[at + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

/**
 * A shell of gas seen from outside: brightest where you look through the most of it, which is
 * at its edge. Clumped, because a real one is.
 */
export function makeShell(seed = 7): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const image = ctx.createImageData(SIZE, SIZE);
  const n = noise2(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE - 0.5) * 2;
      const v = (y / SIZE - 0.5) * 2;
      const r = Math.hypot(u, v);
      // Limb brightening of a thin shell: path length through it peaks just inside its edge.
      const shell = r < 0.97 ? 0.07 + 0.93 * Math.pow(r / 0.97, 7) : Math.max(0, 1 - (r - 0.97) / 0.03);
      const clumps = 0.35 + 1.3 * fbm(n, u * 3.5 + 4, v * 3.5 + 9, 4);
      const a = Math.max(0, Math.min(1, shell * clumps * 0.85));
      const at = (y * SIZE + x) * 4;
      image.data[at] = 255;
      image.data[at + 1] = 255;
      image.data[at + 2] = 255;
      image.data[at + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

/** An HSL hue as packed RGB at a fixed, muted saturation: what a nebula photographs as. */
export function hueColour(hue: number, saturation = 0.42, lightness = 0.56): number {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}
