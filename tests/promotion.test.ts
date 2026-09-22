import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import { deriveRates, tick, buy, PROMOTION_SHARE, promotionMultiplier } from '../src/sim/economy';
import { ACCRETION_STAGES, costScaleAt, stageAt, stageIndexFor } from '../src/sim/stages';
import { REBASED_UPGRADE_IDS, UPGRADES, costAt } from '../src/sim/upgrades';
import { deserialize, serialize } from '../src/sim/save';

const NOW = 1_700_000_000_000;

/** A state standing exactly on a stage's threshold. */
function atStage(index: number): GameState {
  const s = initialState(NOW);
  const threshold = ACCRETION_STAGES[index]?.threshold;
  s.totalMassEver = threshold ?? D(0);
  s.mass = s.totalMassEver;
  s.rebasedStage = index;
  return s;
}

describe('the promotion multiplier', () => {
  it('pays nothing at the bottom and grows all the way up', () => {
    expect(promotionMultiplier(0)).toBe(1);
    expect(promotionMultiplier(1)).toBe(1);
    for (let i = 2; i < ACCRETION_STAGES.length; i++) {
      expect(promotionMultiplier(i), stageAt(i).name).toBeGreaterThan(promotionMultiplier(i - 1));
    }
  });

  /**
   * The point of deriving it from the gap rather than fixing it.
   *
   * A flat multiplier contributes a different share of the growth exponent at every stage,
   * because the ladder's gaps run from 1.18 orders to 2.3. Each promotion has to be worth
   * `10 ^ (share x gap)` for the share to be the same everywhere — and that is what makes the
   * pacing tunable with one dial instead of a knife edge.
   */
  it('contributes the same share of the exponent at every stage', () => {
    for (let i = 2; i < ACCRETION_STAGES.length; i++) {
      const here = ACCRETION_STAGES[i]!.threshold!.log10();
      const before = ACCRETION_STAGES[i - 1]!.threshold!.log10();
      const gain = Math.log10(promotionMultiplier(i) / promotionMultiplier(i - 1));
      expect(gain / (here - before), stageAt(i).name).toBeCloseTo(PROMOTION_SHARE, 6);
    }
  });

  it('multiplies income and nothing else', () => {
    const bottom = atStage(0);
    const top = atStage(6);
    // Same levels either side, so the only difference is the ladder.
    const ratio = deriveRates(top).massPerSecond.div(deriveRates(bottom).massPerSecond).toNumber();
    expect(ratio).toBeCloseTo(promotionMultiplier(6), 6);
  });
});

describe('rebased upgrades', () => {
  it('reset at a promotion, once, and stay reset until the next one', () => {
    const s = atStage(1);
    s.levels.density = 12;
    s.levelsEver.density = 12;

    tick(s, 1);
    expect(s.levels.density, 'no promotion, no reset').toBe(12);

    s.totalMassEver = ACCRETION_STAGES[2]!.threshold!;
    tick(s, 1);
    expect(s.levels.density, 'promoted').toBe(0);
    expect(s.rebasedStage).toBe(2);

    s.levels.density = 5;
    tick(s, 1);
    expect(s.levels.density, 'the same promotion does not fire twice').toBe(5);
  });

  it('catches up through several stages in one coarse offline step', () => {
    const s = atStage(1);
    s.levels.density = 9;
    s.levelsEver.density = 9;
    // One enormous step, of the kind offline catch-up takes.
    s.totalMassEver = ACCRETION_STAGES[7]!.threshold!;
    tick(s, 60);
    expect(s.rebasedStage).toBe(7);
    expect(s.levels.density).toBe(0);
  });

  it('keeps the investment, so a promotion never takes an auto-buyer away', () => {
    const s = atStage(1);
    s.mass = D('1e6');
    const bought = buy(s, 'density', 'max');
    expect(bought, 'the fixture has to actually buy something').toBeGreaterThan(5);
    expect(s.levels.density).toBe(bought);

    s.totalMassEver = ACCRETION_STAGES[3]!.threshold!;
    tick(s, 1);
    expect(s.levels.density, 'the levels go').toBe(0);
    expect(s.levelsEver.density, 'the investment does not').toBe(bought);
  });

  it('reprices to the stage, so a reset is a real reset', () => {
    // The whole point: without repricing, two hundred levels from a base of 30 is free at the
    // top of the ladder and the reset means nothing.
    const cheap = costAt(UPGRADES.density, 0, 1);
    const dear = costAt(UPGRADES.density, 0, 8);
    expect(dear.div(cheap).toNumber()).toBeCloseTo(costScaleAt(8).toNumber(), 3);
    expect(dear.gt(cheap)).toBe(true);
  });

  it('leaves upgrades that are not rebased alone', () => {
    for (const id of ['gravity', 'radius', 'particleMass', 'efficiency'] as const) {
      expect(REBASED_UPGRADE_IDS).not.toContain(id);
      expect(costAt(UPGRADES[id], 3, 0).eq(costAt(UPGRADES[id], 3, 9)), id).toBe(true);
    }
  });

  it('survives a save and reload without re-firing', () => {
    const s = atStage(4);
    s.levels.density = 7;
    s.levelsEver.density = 40;

    const back = deserialize(serialize(s), NOW);
    expect(back.rebasedStage).toBe(4);
    expect(back.levels.density).toBe(7);
    expect(back.levelsEver.density).toBe(40);

    tick(back, 1);
    expect(back.levels.density, 'a reload must not look like a promotion').toBe(7);
  });
});

describe('the version 1 save', () => {
  const v1 = {
    version: 1,
    mass: '1e10',
    totalMassEver: '1e10',
    energy: '0',
    totalEnergyEver: '0',
    levels: { gravity: 40, radius: 30, density: 55, particleMass: 20, efficiency: 5 },
    autoBuy: { density: true },
    achievements: [],
    playTime: 5000,
    pulseReadyAt: 0,
    stageSeen: 6,
    lastSeen: NOW,
    settings: {},
    stats: {},
  };

  it('loads, and applies the new rule where the player is standing', () => {
    const s = deserialize(v1, NOW);
    expect(s.version).toBe(3);
    expect(s.levels.density, 'rebased levels go').toBe(0);
    expect(s.rebasedStage, 'and the reset is recorded, so the next tick does not repeat it')
      .toBe(stageIndexFor(D('1e10')));
  });

  it('keeps every level as investment, so no auto-buyer is lost in the upgrade', () => {
    const s = deserialize(v1, NOW);
    expect(s.levelsEver.density).toBe(55);
    expect(s.levelsEver.gravity).toBe(40);
    expect(s.autoBuy.density).toBe(true);
  });

  it('does not touch the upgrades that are not rebased', () => {
    const s = deserialize(v1, NOW);
    expect(s.levels.gravity).toBe(40);
    expect(s.levels.particleMass).toBe(20);
  });
});
