import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState } from '../src/sim/state';
import { buy, deriveRates, tick } from '../src/sim/economy';
import { UPGRADES, costAt, costOfLevels, maxAffordable } from '../src/sim/upgrades';
import { applyOffline, OFFLINE_HORIZON_SECONDS } from '../src/sim/offline';

const NOW = 1_700_000_000_000;

describe('capture', () => {
  it('saturates towards 1 across the range a player will actually reach', () => {
    const s = initialState(NOW);
    expect(deriveRates(s).captureFraction).toBeLessThan(1);

    s.levels.radius = 400;
    s.levels.gravity = 60;
    const f = deriveRates(s).captureFraction;
    expect(f).toBeLessThan(1);
    expect(f).toBeGreaterThan(0.99);
  });

  it('clamps to 1 rather than exceeding it once floats give up', () => {
    const s = initialState(NOW);
    s.levels.radius = 100_000;
    s.levels.gravity = 500;
    expect(deriveRates(s).captureFraction).toBeLessThanOrEqual(1);
  });

  it('rises monotonically with both reach upgrades', () => {
    const s = initialState(NOW);
    let previous = deriveRates(s).captureFraction;
    for (let i = 1; i <= 50; i++) {
      s.levels.radius = i;
      const next = deriveRates(s).captureFraction;
      expect(next).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it('survives a gravity level large enough to overflow a float', () => {
    const s = initialState(NOW);
    s.levels.gravity = 100_000;
    const rates = deriveRates(s);
    expect(rates.captureFraction).toBe(1);
    expect(Number.isNaN(rates.captureFraction)).toBe(false);
  });
});

describe('tick', () => {
  it('is deterministic over ten thousand ticks', () => {
    const run = () => {
      const s = initialState(NOW);
      for (let i = 0; i < 10_000; i++) {
        tick(s, 0.05);
        if (i % 500 === 0) buy(s, 'gravity', 'max');
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(a.mass.toString()).toBe(b.mass.toString());
    expect(a.totalMassEver.toString()).toBe(b.totalMassEver.toString());
    expect(a.levels).toEqual(b.levels);
  });

  it('ignores non-positive and non-finite deltas', () => {
    const s = initialState(NOW);
    tick(s, 0);
    tick(s, -5);
    tick(s, Number.NaN);
    expect(s.mass.toNumber()).toBe(0);
    expect(s.playTime).toBe(0);
  });
});

describe('offline', () => {
  /**
   * Coarse steps must stay close to fine ones, and must never pay *more*.
   *
   * This used to assert equality to six decimal places, on the reasoning that without
   * auto-buyers the rate only changes when an achievement unlocks and that is rare. It is not
   * rare any more: there are sixty of them, so an hour of catch-up crosses several, and a
   * coarse step credits the whole hundred seconds at the rate it started with. The measured
   * gap is under one percent.
   *
   * The direction is the part worth asserting. Under-paying an absence is a known, bounded
   * cost of integrating in steps. Over-paying would mean being away beat being present, which
   * is a different kind of bug entirely.
   */
  it('credits a coarse catch-up close to a fine one, and never more', () => {
    const fine = initialState(NOW);
    for (let i = 0; i < 3600; i++) tick(fine, 1);

    const coarse = initialState(NOW);
    for (let i = 0; i < 36; i++) tick(coarse, 100);

    const ratio = coarse.mass.div(fine.mass).toNumber();
    expect(ratio).toBeLessThanOrEqual(1);
    expect(ratio).toBeGreaterThan(0.97);
  });

  /**
   * An absence has no edge any more. A fortnight is credited as a fortnight, and the report
   * has nothing in it about what was forfeited because nothing was.
   */
  it('credits a fortnight as a fortnight', () => {
    const s = initialState(NOW);
    const fortnight = 14 * 24 * 3600;
    const report = applyOffline(s, NOW + fortnight * 1000);
    expect(report).not.toBeNull();
    expect(report!.creditedSeconds).toBe(fortnight);
    expect(report!.awaySeconds).toBe(fortnight);
    expect('capped' in report!).toBe(false);
    expect(s.playTime).toBeCloseTo(fortnight, 3);
  });

  it('stops counting only past a horizon nobody will experience as a limit', () => {
    expect(OFFLINE_HORIZON_SECONDS).toBeGreaterThanOrEqual(30 * 24 * 3600);

    const s = initialState(NOW);
    const report = applyOffline(s, NOW + OFFLINE_HORIZON_SECONDS * 3 * 1000);
    expect(report!.creditedSeconds).toBe(OFFLINE_HORIZON_SECONDS);
  });

  it('resolves a fortnight with nothing flowing in the time a short absence takes', () => {
    const s = initialState(NOW);
    const started = Date.now();
    applyOffline(s, NOW + 14 * 24 * 3600 * 1000);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('clamps a backwards clock to zero rather than removing mass', () => {
    const s = initialState(NOW);
    s.mass = D(1000);
    const report = applyOffline(s, NOW - 60_000);
    expect(report).toBeNull();
    expect(s.mass.toNumber()).toBe(1000);
    expect(s.lastSeen).toBe(NOW - 60_000);
  });
});

describe('purchasing', () => {
  it('charges exactly the geometric sum', () => {
    const def = UPGRADES.gravity;
    const oneByOne = [0, 1, 2, 3, 4].reduce((sum, level) => sum.add(costAt(def, level, 0)), D(0));
    expect(costOfLevels(def, 0, 5, 0).toNumber()).toBeCloseTo(oneByOne.toNumber(), 6);
  });

  it('never lets buy-max overdraw, and never leaves a level on the table', () => {
    const def = UPGRADES.radius;
    for (const budget of ['0', '24', '25', '1e3', '1e6', '1.234e12', '1e40']) {
      for (const level of [0, 7, 93]) {
        const money = D(budget);
        const { levels, cost } = maxAffordable(def, level, money, 0);
        expect(cost.lte(money)).toBe(true);
        if (levels > 0) expect(costOfLevels(def, level, levels, 0).lte(money)).toBe(true);
        expect(costOfLevels(def, level, levels + 1, 0).gt(money)).toBe(true);
      }
    }
  });

  it('refuses a purchase that cannot be paid for', () => {
    const s = initialState(NOW);
    s.mass = D(9);
    expect(buy(s, 'gravity', 1)).toBe(0);
    expect(s.mass.toNumber()).toBe(9);
    expect(s.levels.gravity).toBe(0);
  });

  it('refuses upgrades that are still locked', () => {
    const s = initialState(NOW);
    s.mass = D('1e9');
    expect(buy(s, 'efficiency', 1)).toBe(0);
    expect(s.levels.efficiency).toBe(0);
  });

  it('raises income', () => {
    const s = initialState(NOW);
    const before = deriveRates(s).massPerSecond;
    s.mass = D(1e6);
    buy(s, 'gravity', 10);
    expect(deriveRates(s).massPerSecond.gt(before)).toBe(true);
  });
});
