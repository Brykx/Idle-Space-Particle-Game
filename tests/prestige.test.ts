import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import { autoBuyUnlocked, deriveRates, tick } from '../src/sim/economy';
import { deserialize, serialize } from '../src/sim/save';
import { applyOffline } from '../src/sim/offline';
import {
  STARDUST_EXPONENT,
  STARDUST_LIST,
  STARDUST_SCALE,
  buyStardust,
  canCollapse,
  collapse,
  collapseThreshold,
  stardustCost,
  stardustEffects,
  stardustFor,
} from '../src/sim/prestige';
import { UPGRADE_IDS } from '../src/sim/upgrades';

const NOW = 1_700_000_000_000;

/** A state that has finished the accretion ladder, with a run's worth of things bought. */
function finished(multiplier = 1): GameState {
  const s = initialState(NOW);
  s.totalMassEver = collapseThreshold().mul(multiplier);
  s.mass = s.totalMassEver;
  s.energy = D('1e9');
  s.totalEnergyEver = D('1e9');
  for (const id of UPGRADE_IDS) {
    s.levels[id] = 40;
    s.levelsEver[id] = 40;
    s.autoBuy[id] = true;
  }
  s.rebasedStage = 11;
  s.stageSeen = 11;
  s.achievements = ['first-mass'];
  return s;
}

describe('what a collapse is worth', () => {
  it('is nothing until the ladder is finished', () => {
    const s = initialState(NOW);
    expect(canCollapse(s)).toBe(false);
    expect(stardustFor(s).toNumber()).toBe(0);
    expect(collapse(s)).toBeNull();

    s.totalMassEver = collapseThreshold().div(1.001);
    expect(canCollapse(s)).toBe(false);
  });

  it('pays the stated formula', () => {
    for (const over of [1, 10, 1000, 1e6]) {
      const s = finished(over);
      expect(stardustFor(s).toNumber(), `x${over} past the threshold`)
        .toBeCloseTo(Math.floor(STARDUST_SCALE * Math.pow(over, STARDUST_EXPONENT)), 6);
    }
  });

  /**
   * The exponent is the whole reason the timing is a decision rather than a reflex: waiting
   * earns more in total and less per order of magnitude. If it ever reaches 1, collapsing
   * early and collapsing late become the same choice and the layer has no decision in it.
   */
  it('pays less per order of magnitude the longer you wait', () => {
    const early = stardustFor(finished(1e3)).toNumber();
    const late = stardustFor(finished(1e6)).toNumber();
    expect(late).toBeGreaterThan(early);
    expect(late / early, 'a thousandfold more mass is not a thousandfold more stardust')
      .toBeLessThan(1000);
  });

  it('survives a mass far past what a float can hold', () => {
    const s = finished(1);
    s.totalMassEver = D('1e300');
    // Far past what a double can count, which is the reason Stardust is a Decimal at all.
    expect(stardustFor(s).gt('1e150')).toBe(true);
    expect(Number.isFinite(stardustFor(s).mantissa)).toBe(true);
  });
});

describe('the collapse itself', () => {
  it('takes the run and leaves what you have learned', () => {
    const s = finished(100);
    const gained = collapse(s);

    expect(gained!.eq(stardustFor(finished(100)))).toBe(true);
    expect(s.stardust.eq(gained!)).toBe(true);
    expect(s.collapses).toBe(1);

    // Gone.
    expect(s.totalMassEver.toNumber()).toBe(0);
    expect(s.energy.toNumber()).toBe(0);
    expect(s.stageSeen, 'the ladder announces itself again').toBe(0);
    expect(s.rebasedStage).toBe(0);
    for (const id of UPGRADE_IDS) expect(s.levels[id], id).toBe(0);

    // Kept.
    expect(s.achievements, 'you did those').toEqual(['first-mass']);
    for (const id of UPGRADE_IDS) {
      expect(s.levelsEver[id], `${id} investment`).toBe(40);
      expect(autoBuyUnlocked(s, id), `${id} automation`).toBe(true);
      expect(s.autoBuy[id], `${id} toggle is a preference`).toBe(true);
    }
  });

  it('starts the next run on the seed the tree bought', () => {
    const s = finished(1e5);
    collapse(s);
    while (buyStardust(s, 'seed')) { /* everything into the seed */ }
    expect(s.stardustLevels.seed).toBeGreaterThan(0);

    const before = s.stardustLevels.seed;
    const next = finished(1e5);
    next.stardust = s.stardust;
    next.stardustLevels = { ...s.stardustLevels };
    collapse(next);

    expect(next.mass.gt(0), 'a seed is mass you start with').toBe(true);
    expect(next.mass.eq(next.totalMassEver), 'and it counts as mass you have earned').toBe(true);
    expect(before).toBe(next.stardustLevels.seed);
  });
});

describe('the stardust tree', () => {
  it('costs more each level and stops at its cap', () => {
    for (const def of STARDUST_LIST) {
      expect(stardustCost(def, 1).gt(stardustCost(def, 0)), def.name).toBe(true);

      const s = initialState(NOW);
      s.stardust = D('1e400');
      let bought = 0;
      while (buyStardust(s, def.id)) bought += 1;
      expect(bought, `${def.name} cap`).toBe(def.maxLevel);
      expect(s.stardustLevels[def.id]).toBe(def.maxLevel);
    }
  });

  it('will not sell what you cannot afford', () => {
    const s = initialState(NOW);
    s.stardust = D(0);
    expect(buyStardust(s, 'enrichment')).toBe(false);
    expect(s.stardustLevels.enrichment).toBe(0);
  });

  it('multiplies income, and only through the one term', () => {
    const plain = initialState(NOW);
    plain.totalMassEver = D('1e6');
    plain.mass = D('1e6');

    const enriched = { ...plain, stardustLevels: { ...plain.stardustLevels, enrichment: 4 } };
    const ratio = deriveRates(enriched).massPerSecond.div(deriveRates(plain).massPerSecond).toNumber();
    expect(ratio).toBeCloseTo(Math.pow(1.15, 4), 6);
    expect(deriveRates(enriched).spawnRate).toBe(deriveRates(plain).spawnRate);
    expect(deriveRates(enriched).captureFraction).toBe(deriveRates(plain).captureFraction);
  });

  it('starts the chain partway up, as a floor rather than a bonus', () => {
    const s = initialState(NOW);
    s.totalMassEver = D('1e3');
    expect(deriveRates(s).elementTier).toBe(0);

    s.stardustLevels.ignition = 2;
    expect(deriveRates(s).elementTier).toBe(2);

    // A floor: once the disk has earned a higher tier on its own, Ignition adds nothing.
    const advanced = { ...s, totalMassEver: D('1e13'), energy: D('1e12'), levels: { ...s.levels, disk: 60 } };
    const earned = deriveRates({ ...advanced, stardustLevels: { ...s.stardustLevels, ignition: 0 } }).elementTier;
    expect(earned).toBeGreaterThan(2);
    expect(deriveRates(advanced).elementTier).toBe(earned);
  });

  it('lowers the bar to automate, without removing it', () => {
    const s = initialState(NOW);
    expect(stardustEffects(s).autoBuyLevel).toBe(25);
    s.stardustLevels.memory = 99;
    expect(stardustEffects(s).autoBuyLevel).toBeGreaterThan(0);
    expect(stardustEffects(s).autoBuyLevel).toBeLessThan(25);
  });

  /**
   * The cap on Deep Slumber is a design statement, not a balance knob. An absence that pays
   * better than presence makes the strongest play "close the tab", and no upgrade should sell
   * a player that.
   */
  it('never lets an absence beat being present', () => {
    const s = initialState(NOW);
    s.stardustLevels.slumber = 99;
    expect(stardustEffects(s).offlineRate).toBeLessThanOrEqual(1.35);
  });

  it('credits an absence at the slumber rate', () => {
    const run = (slumber: number) => {
      const s = initialState(NOW);
      s.totalMassEver = D('1e4');
      s.mass = D('1e4');
      s.stardustLevels.slumber = slumber;
      s.lastSeen = NOW;
      applyOffline(s, NOW + 3600_000);
      return s.totalMassEver.toNumber();
    };
    expect(run(5)).toBeGreaterThan(run(0));
  });
});

describe('a save carrying a collapse', () => {
  it('round-trips the tree, the balance and the count', () => {
    const s = finished(1e4);
    collapse(s);
    buyStardust(s, 'enrichment');
    buyStardust(s, 'seed');

    const back = deserialize(serialize(s), NOW);
    expect(back.stardust.eq(s.stardust)).toBe(true);
    expect(back.stardustEver.eq(s.stardustEver)).toBe(true);
    expect(back.collapses).toBe(1);
    expect(back.stardustLevels).toEqual(s.stardustLevels);
  });

  it('loads a version 2 save as a player who has never collapsed', () => {
    const v2 = {
      version: 2,
      mass: '1e6',
      totalMassEver: '1e6',
      levels: { gravity: 10 },
      levelsEver: { gravity: 10 },
      rebasedStage: 4,
      lastSeen: NOW,
    };
    const s = deserialize(v2, NOW);
    expect(s.version).toBe(3);
    expect(s.stardust.toNumber()).toBe(0);
    expect(s.collapses).toBe(0);
    expect(s.stardustLevels.enrichment).toBe(0);
    // And nothing version 2 carried was disturbed on the way through.
    expect(s.levels.gravity).toBe(10);
    expect(s.rebasedStage).toBe(4);
  });
});

describe('the run after', () => {
  it('is faster than the run before, for the same mass', () => {
    const before = initialState(NOW);
    before.totalMassEver = D('1e6');
    before.mass = D('1e6');

    const after = initialState(NOW);
    after.totalMassEver = D('1e6');
    after.mass = D('1e6');
    after.stardustLevels.enrichment = 6;
    after.stardustLevels.ignition = 2;

    const gain = deriveRates(after).massPerSecond.div(deriveRates(before).massPerSecond).toNumber();
    expect(gain).toBeGreaterThan(2);
  });

  it('does not re-fire a promotion it has already had', () => {
    const s = finished(1);
    collapse(s);
    s.totalMassEver = D('1e6');
    tick(s, 1);
    const stage = s.rebasedStage;
    tick(s, 1);
    expect(s.rebasedStage).toBe(stage);
  });
});
