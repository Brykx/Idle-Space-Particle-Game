import { describe, expect, it } from 'vitest';
import { runPacing } from '../tools/balance';

/**
 * Pacing regression. The bounds are deliberately generous: this is not asserting that the
 * tuning is *good*, only that a change has not quietly doubled the first hour or collapsed
 * the curve into a finite-time blowup. Both are easy to do by accident and hard to notice
 * by playing for five minutes.
 */

const MINUTE = 60;

describe('pacing', () => {
  const run = runPacing({ limitSeconds: 4 * 3600 });
  const [first, second, third, ignition] = run.milestones;

  it('reaches every milestone inside four hours', () => {
    for (const m of run.milestones) {
      expect(m.seconds, m.label).toBeLessThan(Infinity);
    }
  });

  it('opens quickly enough to keep a new player', () => {
    expect(first!.seconds).toBeGreaterThan(1 * MINUTE);
    expect(first!.seconds).toBeLessThan(10 * MINUTE);
  });

  it('reaches ignition in a single sitting', () => {
    expect(ignition!.seconds).toBeGreaterThan(20 * MINUTE);
    expect(ignition!.seconds).toBeLessThan(90 * MINUTE);
  });

  it('does not collapse the last three orders of magnitude into nothing', () => {
    // A combined cost exponent above ~1 blows up in finite time and makes the endgame
    // instant. Guard the shape, not the exact numbers.
    const lastLeg = ignition!.seconds - third!.seconds;
    expect(lastLeg).toBeGreaterThan(1 * MINUTE);
  });

  it('keeps milestones in order', () => {
    expect(second!.seconds).toBeGreaterThan(first!.seconds);
    expect(third!.seconds).toBeGreaterThan(second!.seconds);
    expect(ignition!.seconds).toBeGreaterThan(third!.seconds);
  });

  it('keeps income visibly moving through the first hour', () => {
    expect(run.firstHour.doublingTime).toBeGreaterThan(30);
    expect(run.firstHour.doublingTime).toBeLessThan(180);
  });

  it('never leaves the player with nothing to buy for long', () => {
    expect(run.firstHour.worstGap).toBeLessThan(3 * MINUTE);
  });

  it('makes a purchase worth making', () => {
    expect(run.firstHour.gainPerPurchase).toBeGreaterThan(0.005);
  });
});
