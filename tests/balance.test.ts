import { describe, expect, it } from 'vitest';
import { compareTraits, runCareer, runPacing, type PacingResult, type ShapeSample } from '../tools/balance';
import { initialState } from '../src/sim/state';
import { isRunning, tick } from '../src/sim/economy';
import { BASE_PACE, firstCloud } from '../src/sim/clouds';
import { STARDUST_LIST, SKY_BONUS_STARS, type StarRecord } from '../src/sim/sky';
import { UPGRADE_IDS } from '../src/sim/upgrades';
import { ACHIEVEMENTS } from '../src/sim/achievements';

/**
 * Pacing regression. The bounds are deliberately generous: this is not asserting that the
 * tuning is *good*, only that a change has not quietly doubled the first hour, opened a wall
 * in the middle, or collapsed the long game into an afternoon. All three are easy to do by
 * accident and invisible in a five-minute play test.
 */

const MINUTE = 60;
const HOUR = 3600;

const run = runPacing({ limitSeconds: 4 * HOUR });
const stage = (id: string): PacingResult => {
  const found = run.milestones.find((m) => m.id === id);
  if (!found) throw new Error(`No pacing result for stage "${id}"`);
  return found;
};

/** The ladder itself, without the cloud thinning out at the end. */
const ladder = run.milestones.filter((m) => m.id !== 'spent');

/**
 * Orders of magnitude gained per minute between two shape samples.
 *
 * Indexed by sample rather than by clock time on purpose. The run stops once the cloud is
 * spent, so a fixed window like "minute 50 to 80" silently becomes "minute 50 to whenever it
 * ended, divided by 30" as the tuning gets faster — which flatters or punishes the late slope
 * for no reason.
 */
const slopeBetween = (shape: ShapeSample[], from: number, to: number): number => {
  const a = shape[from];
  const b = shape[to];
  if (!a || !b || b.minutes <= a.minutes) return 0;
  return (b.log10 - a.log10) / (b.minutes - a.minutes);
};

describe('the first star', () => {
  it('reaches every stage its cloud allows, and then finishes', () => {
    for (const milestone of run.milestones) {
      expect(milestone.seconds, milestone.label).toBeLessThan(Infinity);
    }
    expect(ladder[ladder.length - 1]!.id).toBe('yellowDwarf');
  });

  it('gives the first promotion quickly enough to explain the game', () => {
    expect(stage('pebble').seconds).toBeGreaterThan(15);
    expect(stage('pebble').seconds).toBeLessThan(4 * MINUTE);
  });

  it('is a couple of sittings, not an afternoon and not a coffee break', () => {
    expect(stage('spent').seconds).toBeGreaterThan(80 * MINUTE);
    expect(stage('spent').seconds).toBeLessThan(3 * HOUR);
  });

  it('keeps stages in order, with gaps that grow rather than spike', () => {
    let previous = 0;
    let previousGap = 0;
    ladder.forEach((milestone, index) => {
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
   * The ending is an easing-off, not a wall: the star takes its last orders of magnitude more
   * slowly as the cloud thins, and is done well inside an hour of becoming a Sun.
   */
  it('eases to a finish once it is a Sun, rather than stopping dead or dragging on', () => {
    const tail = stage('spent').seconds - stage('yellowDwarf').seconds;
    expect(tail).toBeGreaterThan(10 * MINUTE);
    expect(tail).toBeLessThan(50 * MINUTE);
  });

  /**
   * The one that matters most. With the upgrade cost exponents summing to about 1, mass
   * should climb at a near-constant number of orders of magnitude per minute. A sum below 1
   * flattens the late game into a wall; above 1 it blows up and the last stages arrive
   * seconds apart. Comparing the slope early against the slope late catches both.
   *
   * Measured up to the last promotion, before the cloud starts to thin — that slowing is
   * the design, and it would read here as a stall.
   */
  it('climbs at a steady rate rather than stalling or blowing up', () => {
    const before = run.shape.filter((sample) => sample.minutes * 60 <= stage('yellowDwarf').seconds);
    const first = 3;
    const last = before.length - 1;
    const middle = Math.floor((first + last) / 2);
    expect(last - first, 'not enough shape samples to judge the curve').toBeGreaterThan(5);

    const early = slopeBetween(before, first, middle);
    const late = slopeBetween(before, middle, last);

    expect(early).toBeGreaterThan(0.05);
    expect(late / early).toBeGreaterThan(0.7);
    // The upper bound allows a gentle late ramp, which the energy economy adds on purpose:
    // each fusion tier is a step up in income, so the last stretch should quicken. What it
    // still catches is a collapse, where the tail arrives at once.
    expect(late / early).toBeLessThan(1.8);
  });

  it('keeps income visibly moving through the first hour', () => {
    expect(run.firstHour.doublingTime).toBeGreaterThan(45);
    expect(run.firstHour.doublingTime).toBeLessThan(150);
  });

  /**
   * Opening a current is the only purchase the game asks for, so *when there is one to open*
   * is the new shape of the first hour. The first has to come almost at once — it is the
   * tutorial — and they should keep arriving rather than all landing in the first minute.
   */
  it('has a first current to begin within seconds, and more as the run goes on', () => {
    const [first, ...rest] = run.openings;
    expect(first, 'something to open').toBeDefined();
    expect(first!.seconds).toBeLessThan(30);

    expect(run.openings.length, 'every current is reached in a first run').toBe(8);
    const last = rest[rest.length - 1]!;
    expect(last.seconds, 'the last arrives well into the run').toBeGreaterThan(20 * MINUTE);
    expect(last.seconds).toBeLessThan(90 * MINUTE);
  });

  it('does the buying itself, without burying the run in purchases', () => {
    expect(run.firstHour.purchases).toBeGreaterThan(50);
    expect(run.firstHour.purchases).toBeLessThan(600);
  });
});

describe('the clouds', () => {
  /** A preference, not a quiz: no kind of cloud is the right answer. */
  it('makes the four kinds of cloud near-equal', () => {
    const times = compareTraits().map((t) => t.seconds);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.1);
  });
});

describe('a career', () => {
  const career = runCareer({ stars: 6, policy: 'largest', step: 2 });

  it('makes the second star quicker than the first, but not trivially so', () => {
    const [first, second] = career.stars;
    expect(second!.seconds).toBeLessThan(first!.seconds / 1.5);
    expect(second!.seconds).toBeGreaterThan(first!.seconds / 6);
  });

  it('finishes every star it starts, and pays for it', () => {
    expect(career.stars).toHaveLength(6);
    for (const star of career.stars) {
      expect(star.seconds, `star ${star.index}`).toBeLessThan(12 * HOUR);
      expect(star.stardust).toBeGreaterThan(0);
    }
    expect(career.stars[0]!.discovery, 'the first Sun is a discovery').toBeGreaterThan(0);
  });

  it('spends what it earns on the tree as it goes', () => {
    const last = career.stars[career.stars.length - 1]!;
    expect(STARDUST_LIST.some((def) => last.tree[def.id] > 0)).toBe(true);
  });

  /**
   * The summit stays a long way up. With everything permanent bought and the sky full, a
   * blue supergiant is still a night's work — the thing a whole career is building towards
   * does not become something you get by waiting a little longer than last time.
   */
  it('keeps the largest star a long way up, even at the end of everything', () => {
    const atEnd = (ceiling: string, pace: number) => {
      const s = initialState(0);
      for (const id of UPGRADE_IDS) s.levelsEver[id] = 1;
      for (const def of STARDUST_LIST) s.stardustLevels[def.id] = def.maxLevel;
      s.achievements = ACHIEVEMENTS.map((a) => a.id);
      for (let i = 0; i < SKY_BONUS_STARS; i++) s.sky.push({ id: i + 1 } as StarRecord);
      s.cloud = { ...firstCloud(), ceiling, pace };
      const started = s.playTime;
      while (isRunning(s) && s.playTime - started < 3 * 86400) tick(s, 4);
      return s.playTime - started;
    };

    expect(atEnd('blueSupergiant', BASE_PACE[6]), 'a blue supergiant').toBeGreaterThan(4 * HOUR);

    // The smallest star, at its quickest, with every achievement as well: the whole ladder
    // from dust in about two minutes. Quick, and meant to be — by then a red dwarf pays nothing
    // the tree still wants and the sky's bonus is full, so speed here rewards no one for
    // hovering. The floor is that it is still a ladder you watch, not a flash.
    expect(atEnd('redDwarf', BASE_PACE[0] * 1.12), 'a red dwarf').toBeGreaterThan(90);
  });
});
