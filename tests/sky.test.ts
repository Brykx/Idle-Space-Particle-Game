import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import { deriveRates, earn, isRunning, tick } from '../src/sim/economy';
import { applyOffline } from '../src/sim/offline';
import {
  DISCOVERY,
  SKY_BONUS,
  SKY_BONUS_STARS,
  STARDUST_LIST,
  YIELD_EXPONENT,
  YIELD_SCALE,
  buyStardust,
  canRelease,
  chooseCloud,
  ignitionMass,
  offersFor,
  release,
  releaseValue,
  renameStar,
  skyMultiplier,
  stardustCost,
  treeEffects,
  yieldFor,
} from '../src/sim/sky';
import {
  BASE_OFFERS,
  COMPLETE_AT,
  capOf,
  ceilingClassOf,
  drawOffers,
  firstCloud,
  remainingOf,
  type Cloud,
} from '../src/sim/clouds';
import { IGNITION_STAGE, SPECTRAL_CLASSES, stageAt, stageIndexFor } from '../src/sim/stages';
import { UPGRADE_IDS } from '../src/sim/upgrades';

const NOW = 1_700_000_000_000;

/** A star partway through its cloud, with a run's worth of things bought. */
function burning(fractionOfCloud = 0.5, cloud: Cloud = firstCloud()): GameState {
  const s = initialState(NOW);
  s.cloud = cloud;
  s.totalMassEver = capOf(cloud).mul(fractionOfCloud);
  s.mass = s.totalMassEver.div(10);
  s.energy = D('1e9');
  s.totalEnergyEver = D('1e9');
  for (const id of UPGRADE_IDS) {
    s.levels[id] = 40;
    s.levelsEver[id] = 40;
  }
  s.autoBuy.radius = false;
  s.rebasedStage = stageIndexFor(s.totalMassEver);
  s.stageSeen = s.rebasedStage;
  s.achievements = ['firstBuy'];
  s.playTime = 5000;
  s.runStartedAt = 1000;
  return s;
}

/** A finished star: its cloud spent, nothing more falling in. */
const finished = (cloud: Cloud = firstCloud()) => burning(0.9995, cloud);

describe('a cloud', () => {
  it('is fixed for the first star, and can make a Sun', () => {
    const s = initialState(NOW);
    expect(s.cloud).toEqual(firstCloud());
    expect(stageAt(stageIndexFor(capOf(firstCloud()).mul(0.99))).id).toBe('yellowDwarf');
  });

  /**
   * The cloud runs out. Income is multiplied by what is left, so the same star halfway through
   * its cloud earns half what it would from a full one.
   */
  it('gives less as it is spent', () => {
    const full = burning(1e-9);
    const half = burning(0.5);
    // Same everything except how much of the cloud is left. Stage-dependent terms are pinned
    // by comparing at the same lifetime mass with two different clouds instead.
    const wide: Cloud = { ...firstCloud(), ceiling: 'blueSupergiant' };
    const sameMass = burning(0.5);
    sameMass.cloud = wide;
    const ratio = deriveRates(half).massPerSecond.div(deriveRates(sameMass).massPerSecond).toNumber();
    expect(ratio).toBeCloseTo(remainingOf(half.cloud, half.totalMassEver) / remainingOf(wide, half.totalMassEver), 6);
    expect(deriveRates(full).remaining).toBeCloseTo(1, 6);
    expect(deriveRates(half).remaining).toBeCloseTo(0.5, 6);
  });

  it('finishes: once spent nothing more falls in, however long you wait', () => {
    const s = finished();
    expect(deriveRates(s).complete).toBe(true);
    expect(deriveRates(s).massPerSecond.toNumber()).toBe(0);
    expect(isRunning(s)).toBe(false);

    const before = s.totalMassEver.toString();
    tick(s, 3600);
    applyOffline(s, s.lastSeen + 30 * 86400 * 1000);
    expect(s.totalMassEver.toString(), 'waiting longer earns nothing').toBe(before);
  });

  it('never gives a star more than the cloud held, even in one enormous step', () => {
    const s = burning(0.999);
    s.cloud = firstCloud();
    // Below the line that counts as finished, so it is still running.
    s.totalMassEver = capOf(firstCloud()).mul(0.99);
    earn(s, capOf(firstCloud()).mul(1000));
    expect(s.totalMassEver.lte(capOf(firstCloud()))).toBe(true);
  });

  it('reaches the end on its own, with every current flowing', () => {
    const s = initialState(NOW);
    for (const id of UPGRADE_IDS) s.levelsEver[id] = 1;
    s.cloud = { ...firstCloud(), ceiling: 'redDwarf', pace: 1.6 };
    for (let t = 0; t < 6 * 3600 && isRunning(s); t += 1) tick(s, 1);
    expect(isRunning(s)).toBe(false);
    expect(stageAt(stageIndexFor(s.totalMassEver)).id).toBe('redDwarf');
    expect(remainingOf(s.cloud, s.totalMassEver)).toBeLessThanOrEqual(1 - COMPLETE_AT);
  });

  it('stops an absence early once the star has finished, and says so', () => {
    const s = burning(0.9);
    const report = applyOffline(s, s.lastSeen + 7 * 86400 * 1000);
    expect(report?.completed).toBe(true);
    expect(isRunning(s)).toBe(false);
    // The rest of the week is still time: it shows up in the play clock.
    expect(s.playTime).toBeGreaterThan(5000 + 7 * 86400 - 1);
  });

  it('is nothing at all between stars', () => {
    const s = finished();
    release(s, NOW);
    expect(s.cloud).toBeNull();
    const rates = deriveRates(s);
    expect(rates.massPerSecond.toNumber()).toBe(0);
    expect(rates.energyPerSecond.toNumber()).toBe(0);

    tick(s, 600);
    expect(s.mass.toNumber()).toBe(0);
    expect(s.totalMassEver.toNumber()).toBe(0);
  });
});

describe('the clouds on offer', () => {
  const between = (gaze = 0, reach = 0, made = 1) => {
    const s = initialState(NOW);
    s.cloud = null;
    s.stardustLevels.gaze = gaze;
    s.stardustLevels.reach = reach;
    for (let i = 0; i < made; i++) {
      s.sky.push({
        id: i + 1, name: `Star ${i}`, stage: 'yellowDwarf', orders: 7, completed: true, stardust: 46,
        seconds: 3600, releasedAt: NOW, cloud: 'x', hue: 200, trait: 'quiet', x: 0.1 * i, y: 0.5,
      });
    }
    return s;
  };

  it('are decided by the save, so there is nothing to reroll', () => {
    expect(offersFor(between())).toEqual(offersFor(between()));
    expect(offersFor(between(0, 0, 1))).not.toEqual(offersFor(between(0, 0, 2)));
  });

  it('always include one as large as you can reach, and none larger', () => {
    for (let made = 1; made < 40; made++) {
      for (const reach of [0, 2, 4]) {
        const offers = offersFor(between(0, reach, made));
        const classes = offers.map(ceilingClassOf);
        expect(Math.max(...classes), `${made} stars, reach ${reach}`).toBe(Math.min(6, 2 + reach));
      }
    }
  });

  it('are distinct, and named apart, so the star you make can take the name', () => {
    for (let made = 1; made < 40; made++) {
      const offers = offersFor(between(2, 4, made));
      expect(offers).toHaveLength(BASE_OFFERS + 2);
      const firstWords = offers.map((cloud) => cloud.name.split(' ')[0]);
      expect(new Set(firstWords).size).toBe(offers.length);
      const classes = offers.map(ceilingClassOf);
      expect(new Set(classes).size, 'five places, seven classes: no repeats').toBe(offers.length);
    }
  });

  it('are not disturbed by being offered more of them', () => {
    // Wider Gaze adds places; it is not a way to redraw the ones already there.
    const three = drawOffers(42, 5, 3, 2);
    const five = drawOffers(42, 5, 5, 2);
    for (const cloud of three) expect(five).toContainEqual(cloud);
  });

  it('can be chosen only between stars, and start the clock for the run', () => {
    const s = between();
    s.playTime = 777;
    expect(chooseCloud(s, 99)).toBe(false);
    expect(chooseCloud(s, 1)).toBe(true);
    expect(s.cloud).toEqual(offersFor(between())[1]);
    expect(s.runStartedAt).toBe(777);
    expect(chooseCloud(s, 0), 'one cloud at a time').toBe(false);
    expect(offersFor(s)).toEqual([]);
  });
});

describe('letting a star go', () => {
  it('is not possible before the star ignites', () => {
    const s = burning(1e-12);
    expect(stageIndexFor(s.totalMassEver)).toBeLessThan(IGNITION_STAGE);
    expect(canRelease(s)).toBe(false);
    expect(releaseValue(s)).toEqual({ stardust: 0, discovery: 0 });
    expect(release(s, NOW)).toBeNull();
  });

  it('is possible from the moment it ignites', () => {
    const s = initialState(NOW);
    s.totalMassEver = ignitionMass();
    expect(canRelease(s)).toBe(true);
    expect(yieldFor(s.totalMassEver)).toBe(1);
  });

  it('pays the stated formula, in orders of magnitude grown as a star', () => {
    for (const orders of [0, 1, 2.5, 7, 13.5, 22.5]) {
      const mass = ignitionMass().mul(D(10).pow(orders));
      expect(yieldFor(mass), `${orders} orders`).toBe(1 + Math.floor(YIELD_SCALE * Math.pow(orders, YIELD_EXPONENT)));
    }
  });

  /**
   * The fix for the overnight exploit, stated as a property. The cloud bounds the yield, so a
   * finished star left alone for a month pays exactly what it paid the moment it finished.
   */
  it('pays the same for a finished star however long it was left', () => {
    const now = finished();
    const later = finished();
    applyOffline(later, later.lastSeen + 30 * 86400 * 1000);
    expect(releaseValue(later)).toEqual(releaseValue(now));
  });

  it('pays for discovery once per class', () => {
    const s = finished();
    const first = release(s, NOW)!;
    expect(first.discovery).toBe(DISCOVERY[2]);
    expect(first.star.stardust).toBe(first.stardust + first.discovery);

    chooseCloud(s, offersFor(s).findIndex((cloud) => cloud.ceiling === 'yellowDwarf'));
    s.totalMassEver = capOf(s.cloud!).mul(0.9995);
    const second = release(s, NOW)!;
    expect(second.star.stage).toBe('yellowDwarf');
    expect(second.discovery).toBe(0);
  });

  it('records the star, keeps what was earned, and empties the field', () => {
    const s = finished();
    const value = releaseValue(s);
    const done = release(s, NOW + 1234)!;

    expect(done.star).toMatchObject({
      id: 1,
      name: 'Morning',
      stage: 'yellowDwarf',
      completed: true,
      seconds: 4000,
      releasedAt: NOW + 1234,
      cloud: 'Morning Veil',
      trait: 'quiet',
    });
    expect(done.fate).toBe('nebula');
    expect(s.sky).toEqual([done.star]);
    expect(s.stardust).toBe(value.stardust + value.discovery);
    expect(s.stardustEver).toBe(s.stardust);

    // Gone.
    expect(s.cloud).toBeNull();
    expect(s.totalMassEver.toNumber()).toBe(0);
    expect(s.mass.toNumber()).toBe(0);
    expect(s.energy.toNumber()).toBe(0);
    expect(s.stageSeen, 'the ladder announces itself again').toBe(0);
    expect(s.rebasedStage).toBe(0);
    for (const id of UPGRADE_IDS) expect(s.levels[id], id).toBe(0);

    // Kept.
    expect(s.achievements).toEqual(['firstBuy']);
    expect(s.autoBuy.radius, 'a held current stays held').toBe(false);
    for (const id of UPGRADE_IDS) expect(s.levelsEver[id], `${id} is still open`).toBe(40);
  });

  it('can stop a star short, as a smaller class, and says so', () => {
    // A millionth of what the cloud could have made: a red dwarf, from a cloud that could make a Sun.
    const s = burning(1e-6);
    expect(stageAt(stageIndexFor(s.totalMassEver)).id).toBe('redDwarf');
    const done = release(s, NOW)!;
    expect(done.star.stage).toBe('redDwarf');
    expect(done.star.completed).toBe(false);
    expect(done.fate).toBe('ember');
    expect(done.discovery).toBe(DISCOVERY[0]);
  });

  it('ends the largest stars in a supernova', () => {
    const s = finished({ ...firstCloud(), ceiling: 'blueSupergiant' });
    expect(release(s, NOW)!.fate).toBe('supernova');
  });

  it('gives a second star of the same name a numeral, and lets you rename either', () => {
    const s = initialState(NOW);
    for (let i = 0; i < 3; i++) {
      s.cloud = { ...firstCloud(), name: 'Heron Drift' };
      s.totalMassEver = capOf(s.cloud).mul(0.9995);
      release(s, NOW);
    }
    expect(s.sky.map((star) => star.name)).toEqual(['Heron', 'Heron II', 'Heron III']);

    expect(renameStar(s, 2, '  Old   Faithful ')).toBe(true);
    expect(s.sky[1]!.name).toBe('Old Faithful');
    expect(renameStar(s, 2, '   '), 'never blank').toBe(false);
    expect(renameStar(s, 99, 'Nobody')).toBe(false);
  });

  it('places each star somewhere of its own', () => {
    const s = initialState(NOW);
    for (let i = 0; i < 40; i++) {
      s.cloud = firstCloud();
      s.totalMassEver = capOf(s.cloud).mul(0.9995);
      release(s, NOW);
    }
    for (const star of s.sky) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(1);
    }
    let crowded = 0;
    for (let i = 0; i < s.sky.length; i++) {
      for (let j = 0; j < i; j++) {
        if (Math.hypot(s.sky[i]!.x - s.sky[j]!.x, s.sky[i]!.y - s.sky[j]!.y) < 0.05) crowded += 1;
      }
    }
    expect(crowded, 'forty stars should all have room').toBe(0);
  });
});

describe('the sky', () => {
  it('adds a little to all mass for every star in it, up to a limit', () => {
    const s = initialState(NOW);
    expect(skyMultiplier(s)).toBe(1);
    for (let i = 0; i < SKY_BONUS_STARS + 10; i++) {
      s.sky.push({ ...finishedRecord(), id: i + 1 });
    }
    expect(skyMultiplier(s)).toBeCloseTo(1 + SKY_BONUS * SKY_BONUS_STARS, 9);

    const plain = burning(0.5);
    const lit = burning(0.5);
    lit.sky = s.sky.slice(0, 10);
    const ratio = deriveRates(lit).massPerSecond.div(deriveRates(plain).massPerSecond).toNumber();
    expect(ratio).toBeCloseTo(1 + 10 * SKY_BONUS, 6);
  });
});

describe('the tree', () => {
  it('is bounded: every card ends, and costs more each level until it does', () => {
    for (const def of STARDUST_LIST) {
      expect(def.costs).toHaveLength(def.maxLevel);
      for (let level = 1; level < def.maxLevel; level++) {
        expect(stardustCost(def, level)!, `${def.name} ${level}`).toBeGreaterThan(stardustCost(def, level - 1)!);
      }
      expect(stardustCost(def, def.maxLevel)).toBeNull();

      const s = initialState(NOW);
      s.stardust = 1e9;
      let bought = 0;
      while (buyStardust(s, def.id)) bought += 1;
      expect(bought, `${def.name} cap`).toBe(def.maxLevel);
    }
  });

  it('will not sell what you cannot afford', () => {
    const s = initialState(NOW);
    s.stardust = 5;
    expect(buyStardust(s, 'enrichment')).toBe(false);
    expect(s.stardust).toBe(5);
    expect(s.stardustLevels.enrichment).toBe(0);
  });

  it('multiplies income through Enrichment, and only through the one term', () => {
    const plain = burning(0.5);
    const enriched = burning(0.5);
    enriched.stardustLevels.enrichment = 4;
    const ratio = deriveRates(enriched).massPerSecond.div(deriveRates(plain).massPerSecond).toNumber();
    expect(ratio).toBeCloseTo(treeEffects(enriched).massMultiplier, 6);
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

  it('reaches larger clouds and offers more of them', () => {
    const s = initialState(NOW);
    expect(treeEffects(s).maxClass).toBe(2);
    expect(treeEffects(s).offers).toBe(BASE_OFFERS);
    s.stardustLevels.reach = 4;
    s.stardustLevels.gaze = 2;
    expect(SPECTRAL_CLASSES[treeEffects(s).maxClass]).toBe('O');
    expect(treeEffects(s).offers).toBe(BASE_OFFERS + 2);
  });
});

function finishedRecord() {
  return {
    id: 1, name: 'Heron', stage: 'yellowDwarf', orders: 7, completed: true, stardust: 46,
    seconds: 3600, releasedAt: NOW, cloud: 'Heron Drift', hue: 200, trait: 'quiet' as const, x: 0.5, y: 0.5,
  };
}
