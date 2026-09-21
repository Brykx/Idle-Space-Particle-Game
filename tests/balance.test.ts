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

/**
 * Orders of magnitude gained per minute between two shape samples.
 *
 * Indexed by sample rather than by clock time on purpose. The run stops once the last stage
 * is reached, so a fixed window like "minute 50 to 80" silently becomes "minute 50 to
 * whenever it ended, divided by 30" as the tuning gets faster — which flatters or punishes
 * the late slope for no reason.
 */
const slopeBetween = (from: number, to: number): number => {
  const a: ShapeSample | undefined = run.shape[from];
  const b: ShapeSample | undefined = run.shape[to];
  if (!a || !b || b.minutes <= a.minutes) return 0;
  return (b.log10 - a.log10) / (b.minutes - a.minutes);
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
    // Skip the opening, where the saturating capture upgrades make the curve legitimately
    // steep, then compare the first half of what remains against the second.
    const first = 3;
    const last = run.shape.length - 1;
    const middle = Math.floor((first + last) / 2);
    expect(last - first, 'not enough shape samples to judge the curve').toBeGreaterThan(5);

    const early = slopeBetween(first, middle);
    const late = slopeBetween(middle, last);

    expect(early).toBeGreaterThan(0.05);
    expect(late / early).toBeGreaterThan(0.7);
    // The upper bound allows a gentle late ramp, which the energy economy adds on purpose:
    // each fusion tier is a step up in income, so the last stretch before the prestige prompt
    // should quicken. What it still catches is a collapse, where the tail arrives at once.
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
