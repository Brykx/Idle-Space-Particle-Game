import { describe, expect, it } from 'vitest';
import { runPacing, type PacingResult, type ShapeSample } from '../tools/balance';

/**
 * Pacing regression. The bounds are deliberately generous: this is not asserting that the
 * tuning is *good*, only that a change has not quietly doubled the first hour, opened a wall
 * in the middle, or collapsed the curve into a finite-time blowup. All three are easy to do
 * by accident and invisible in a five-minute play test.
 */

const MINUTE = 60;

const run = runPacing({ limitSeconds: 4 * 3600 });
const stage = (id: string): PacingResult => {
  const found = run.milestones.find((m) => m.id === id);
  if (!found) throw new Error(`No pacing result for stage "${id}"`);
  return found;
};

/** log10(mass) at a given minute, from the shape samples. */
const logAt = (minutes: number): number => {
  const sorted: ShapeSample[] = run.shape;
  let best = sorted[0];
  for (const sample of sorted) {
    if (sample.minutes <= minutes) best = sample;
  }
  return best?.log10 ?? 0;
};

describe('pacing', () => {
  it('reaches every stage on the ladder inside four hours', () => {
    for (const milestone of run.milestones) {
      expect(milestone.seconds, milestone.label).toBeLessThan(Infinity);
    }
  });

  it('gives the first promotion quickly enough to explain the game', () => {
    expect(stage('pebble').seconds).toBeGreaterThan(15);
    expect(stage('pebble').seconds).toBeLessThan(4 * MINUTE);
  });

  it('keeps the whole visible ladder inside a couple of sittings', () => {
    expect(stage('supergiant').seconds).toBeGreaterThan(40 * MINUTE);
    expect(stage('supergiant').seconds).toBeLessThan(3 * 60 * MINUTE);
  });

  it('keeps stages in order, with gaps that grow rather than spike', () => {
    let previous = 0;
    let previousGap = 0;
    run.milestones.forEach((milestone, index) => {
      const gap = milestone.seconds - previous;
      expect(milestone.seconds, milestone.label).toBeGreaterThan(previous);
      expect(gap, `${milestone.label} gap`).toBeLessThan(25 * MINUTE);

      // Only once the curve has settled. The opening two stages are a ramp by design — the
      // first arrives in under a minute, so any comparison against it is meaningless.
      if (index >= 2 && previousGap > 0) {
        expect(gap / previousGap, `${milestone.label} gap ratio`).toBeLessThan(2.5);
      }

      previous = milestone.seconds;
      previousGap = gap;
    });
  });

  /**
   * The one that matters most. With the upgrade cost exponents summing to about 1, mass
   * should climb at a near-constant number of orders of magnitude per minute. A sum below 1
   * flattens the late game into a wall; above 1 it blows up and the last stages arrive
   * seconds apart. Comparing the slope early against the slope late catches both.
   */
  it('climbs at a steady rate rather than stalling or blowing up', () => {
    const early = (logAt(50) - logAt(20)) / 30;
    const late = (logAt(80) - logAt(50)) / 30;

    expect(early).toBeGreaterThan(0.05);
    expect(late / early).toBeGreaterThan(0.6);
    expect(late / early).toBeLessThan(1.8);
  });

  it('keeps income visibly moving through the first hour', () => {
    expect(run.firstHour.doublingTime).toBeGreaterThan(45);
    expect(run.firstHour.doublingTime).toBeLessThan(150);
  });

  it('never leaves the player with nothing to buy for long', () => {
    expect(run.firstHour.worstGap).toBeLessThan(3 * MINUTE);
  });

  it('makes a purchase worth making, without burying them in noise', () => {
    expect(run.firstHour.gainPerPurchase).toBeGreaterThan(0.01);
    expect(run.firstHour.purchases).toBeLessThan(600);
  });
});
