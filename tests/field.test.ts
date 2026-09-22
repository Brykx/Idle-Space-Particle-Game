import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, ParticlePool, type FieldGeometry } from '../src/render/pool';
import { ACCRETION_STAGES, STAGES } from '../src/sim/stages';

/**
 * The particle pool is pure arithmetic over typed arrays and imports nothing from Pixi, which
 * is the whole reason the renderer was split this way — the part with rules in it can be
 * tested without a browser.
 */

function geometry(width: number): FieldGeometry {
  const viewRadius = 600;
  return {
    centreX: 0,
    centreY: 0,
    viewRadius,
    spawnRadius: viewRadius * width,
    coreRadius: 30,
  };
}

/**
 * Put one particle at a given distance out, hold it there, and read its alpha.
 *
 * The pool hands out whichever slot its free list has next rather than index 0, so the live
 * one is found rather than assumed. Gravity is switched off and the position rewritten each
 * step so the particle stays where it is put while the fades settle.
 */
function alphaAt(distance: number, width: number): number {
  const pool = new ParticlePool(4);
  const geo = geometry(width);
  pool.spawn(geo, DEFAULT_TUNING, true);

  const i = [...pool.active].findIndex((live) => live === 1);
  expect(i, 'the pool handed out no particle').toBeGreaterThanOrEqual(0);

  const still = { ...DEFAULT_TUNING, gravity: 0 };
  for (let n = 0; n < 40; n++) {
    pool.x[i] = distance;
    pool.y[i] = 0;
    pool.vx[i] = 0;
    pool.vy[i] = 0;
    pool.update(0.05, geo, still);
  }
  return pool.alpha[i] as number;
}

describe('the field has an edge', () => {
  it('draws nothing much beyond where the stage says the matter is', () => {
    const inside = alphaAt(200, 0.45);
    const outside = alphaAt(560, 0.45);
    expect(inside).toBeGreaterThan(0.2);
    expect(outside).toBeLessThan(inside / 3);
  });

  it('leaves a full-width field alone right out to the corners', () => {
    // At width 1 the edge sits past the screen, so nothing visible should be touched by it.
    const near = alphaAt(200, 1);
    const far = alphaAt(590, 1);
    expect(far).toBeGreaterThan(near * 0.25);
  });
});

describe('a particle is visible for the whole of its life', () => {
  /**
   * Regression. A particle's life is the stage's `lifetime` times a random 0.7 to 1.3, and
   * the fade-in was computed against the stage figure rather than against the particle's own.
   * For the three in ten that drew a longer life than average that is a negative alpha, so
   * they were invisible for their first seconds — since the pool was written.
   */
  it('fades in from spawn however long it was given', () => {
    const geo = geometry(1);
    const pool = new ParticlePool(64);
    // Long enough that the random spread puts plenty of particles above the stage figure.
    const tuning = { ...DEFAULT_TUNING, gravity: 0, lifetime: 10 };

    pool.emit(1, 64, geo, tuning, 1);
    pool.update(0.5, geo, tuning);

    let live = 0;
    for (let i = 0; i < pool.capacity; i++) {
      if (pool.active[i] !== 1) continue;
      live += 1;
      expect(pool.alpha[i] as number, `particle ${i} alpha`).toBeGreaterThan(0);
      expect(pool.ttl[i] as number).toBeLessThanOrEqual(pool.life[i] as number);
    }
    expect(live, 'nothing spawned').toBeGreaterThan(10);
  });
});

describe('every stage declares a whole field', () => {
  it('narrows as the core climbs', () => {
    const widths = ACCRETION_STAGES.map((stage) => stage.look.width);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!, ACCRETION_STAGES[i]!.name).toBeLessThanOrEqual(widths[i - 1]!);
    }
    expect(widths[0]).toBe(1);
    expect(widths[widths.length - 1]).toBeLessThan(0.6);
  });

  it('never asks for a field the core would not fit inside', () => {
    for (const stage of STAGES) {
      expect(stage.look.width, stage.name).toBeGreaterThan(0.2);
      expect(stage.look.width, stage.name).toBeLessThanOrEqual(1);
    }
  });
});
