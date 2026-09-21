import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState } from '../src/sim/state';
import { buy, deriveRates, pulse, pulseReady, tick } from '../src/sim/economy';
import { UPGRADES, costAt, costOfLevels, maxAffordable } from '../src/sim/upgrades';
import { applyOffline, MAX_OFFLINE_SECONDS } from '../src/sim/offline';

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
  it('credits the same mass in 36 coarse steps as in 3600 fine ones', () => {
    const fine = initialState(NOW);
    for (let i = 0; i < 3600; i++) tick(fine, 1);

    const coarse = initialState(NOW);
    for (let i = 0; i < 36; i++) tick(coarse, 100);

    const ratio = fine.mass.div(coarse.mass).toNumber();
    expect(ratio).toBeCloseTo(1, 6);
  });

  it('caps a long absence and says so', () => {
    const s = initialState(NOW);
    const report = applyOffline(s, NOW + 14 * 24 * 3600 * 1000);
    expect(report).not.toBeNull();
    expect(report!.capped).toBe(true);
    expect(report!.creditedSeconds).toBe(MAX_OFFLINE_SECONDS);
  });

  it('resolves a fortnight in the same step budget as a minute', () => {
    const s = initialState(NOW);
    const started = Date.now();
    applyOffline(s, NOW + 14 * 24 * 3600 * 1000);
    expect(Date.now() - started).toBeLessThan(250);
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
    const oneByOne = [0, 1, 2, 3, 4].reduce((sum, level) => sum.add(costAt(def, level)), D(0));
    expect(costOfLevels(def, 0, 5).toNumber()).toBeCloseTo(oneByOne.toNumber(), 6);
  });

  it('never lets buy-max overdraw, and never leaves a level on the table', () => {
    const def = UPGRADES.radius;
    for (const budget of ['0', '24', '25', '1e3', '1e6', '1.234e12', '1e40']) {
      for (const level of [0, 7, 93]) {
        const money = D(budget);
        const { levels, cost } = maxAffordable(def, level, money);
        expect(cost.lte(money)).toBe(true);
        if (levels > 0) expect(costOfLevels(def, level, levels).lte(money)).toBe(true);
        expect(costOfLevels(def, level, levels + 1).gt(money)).toBe(true);
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

describe('gravity pulse', () => {
  it('pays out, then holds a cooldown', () => {
    const s = initialState(NOW);
    const paid = pulse(s);
    expect(paid).not.toBeNull();
    expect(paid!.gt(0)).toBe(true);
    expect(pulseReady(s)).toBe(false);
    expect(pulse(s)).toBeNull();

    tick(s, 10);
    expect(pulseReady(s)).toBe(true);
    expect(pulse(s)).not.toBeNull();
    expect(s.stats.pulses).toBe(2);
  });

  it('is worth something on the very first click, before any income', () => {
    const s = initialState(NOW);
    const rates = deriveRates(s);
    expect(rates.pulseYield.gte(rates.massPerSecond)).toBe(true);
    expect(rates.pulseYield.gt(0)).toBe(true);
  });
});
