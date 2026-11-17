import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, SAVE_VERSION } from '../src/sim/state';
import { canRelease, chooseCloud, offersFor, release } from '../src/sim/sky';
import { capOf, firstCloud } from '../src/sim/clouds';
import { stageAt, stageIndexFor } from '../src/sim/stages';
import { buy, isRunning, tick } from '../src/sim/economy';
import { deserialize, exportSave, importSave, migrate, serialize } from '../src/sim/save';

const NOW = 1_700_000_000_000;

function played(): ReturnType<typeof initialState> {
  const s = initialState(NOW);
  for (let i = 0; i < 2000; i++) {
    tick(s, 0.5);
    buy(s, 'gravity', 'max');
    buy(s, 'radius', 'max');
  }
  return s;
}

describe('round trip', () => {
  it('restores a played save exactly', () => {
    const before = played();
    const after = deserialize(JSON.parse(JSON.stringify(serialize(before))), NOW);

    expect(after.mass.toString()).toBe(before.mass.toString());
    expect(after.totalMassEver.toString()).toBe(before.totalMassEver.toString());
    expect(after.levels).toEqual(before.levels);
    expect(after.playTime).toBe(before.playTime);
    expect(after.settings).toEqual(before.settings);
    expect(after.stats).toEqual(before.stats);
  });

  it('survives mass far beyond what a float can hold', () => {
    const s = initialState(NOW);
    s.mass = D('1.2345e3000');
    s.totalMassEver = D('9.99e5000');
    const back = deserialize(serialize(s), NOW);
    expect(back.mass.toString()).toBe(s.mass.toString());
    expect(back.totalMassEver.toString()).toBe(s.totalMassEver.toString());
  });
});

describe('export string', () => {
  it('round trips through base64', () => {
    const before = played();
    const after = importSave(exportSave(before), NOW);
    expect(after.mass.toString()).toBe(before.mass.toString());
    expect(after.levels).toEqual(before.levels);
  });

  it('rejects a mangled string instead of silently loading garbage', () => {
    const good = exportSave(played());
    const mangled = good.slice(0, -6) + 'AAAAAA';
    expect(() => importSave(mangled, NOW)).toThrow();
    expect(() => importSave('hello', NOW)).toThrow(/does not look like a save/);
    expect(() => importSave('ISPG1|abc', NOW)).toThrow(/incomplete/);
  });
});

describe('resilience', () => {
  it('defaults every field a save might be missing', () => {
    const loaded = deserialize({ version: SAVE_VERSION }, NOW);
    const fresh = initialState(NOW);
    expect(loaded.mass.toNumber()).toBe(0);
    expect(loaded.levels).toEqual(fresh.levels);
    expect(loaded.settings).toEqual(fresh.settings);
    expect(loaded.playTime).toBe(0);
  });

  it('repairs nonsense values rather than propagating NaN', () => {
    const loaded = deserialize(
      {
        version: SAVE_VERSION,
        mass: 'not a number',
        playTime: Number.NaN,
        levels: { gravity: -4, radius: 2.7, nonsense: 10 },
        settings: { notation: 'runes', particleBudget: 1e9 },
      },
      NOW,
    );
    expect(loaded.mass.toNumber()).toBe(0);
    expect(loaded.playTime).toBe(0);
    expect(loaded.levels.gravity).toBe(0);
    expect(loaded.levels.radius).toBe(2);
    expect(loaded.settings.notation).toBe('words');
    expect(loaded.settings.particleBudget).toBeLessThanOrEqual(20000);
    expect('nonsense' in loaded.levels).toBe(false);
  });

  it('refuses a save from a newer build rather than corrupting it', () => {
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(/newer version/);
  });

  it('refuses a save from a version with no migration path', () => {
    expect(() => migrate({ version: -1 })).toThrow(/No migration/);
  });
});

/**
 * 3 -> 4 -> 5: the game stopped asking for you, and then a run became a star. Tested end to
 * end, because a player never loads a save into the middle of the chain. What is under test
 * is what they keep: nothing they earned is lost and nothing has to be earned twice.
 */
describe('a save from before the calm core', () => {
  const v3 = {
    version: 3,
    mass: '5e9',
    totalMassEver: '8e9',
    levels: { gravity: 40, radius: 30, density: 4, particleMass: 12 },
    levelsEver: { gravity: 40, radius: 30, density: 61, particleMass: 12 },
    autoBuy: { gravity: true, radius: false, density: false },
    pulseReadyAt: 1234.5,
    rebasedStage: 6,
    stageSeen: 6,
    stardust: '10',
    stardustEver: '250',
    collapses: 2,
    stardustLevels: { enrichment: 5, seed: 2, ignition: 1, slumber: 3, memory: 2 },
    settings: { notation: 'letters', particleBudget: 900 },
    stats: { startedAt: NOW, purchases: 900, pulses: 400, longestAway: 0, exports: 0 },
    lastSeen: NOW,
  };

  it('re-denominates every stardust ever earned into the new currency, on a log scale', () => {
    const s = deserialize(v3, NOW);
    // floor(40 x log10(1 + 250)): the old currency was a power of mass, the new one is orders.
    expect(s.stardust).toBe(95);
    expect(s.stardustEver).toBe(95);
    // The old cards are gone; what was spent on them is inside the re-denomination.
    expect(s.stardustLevels).toEqual({ reach: 0, enrichment: 0, ignition: 0, gaze: 0 });
  });

  it('sets every current flowing, including the ones that had only been locked', () => {
    const s = deserialize(v3, NOW);
    expect(s.autoBuy.gravity).toBe(true);
    expect(s.autoBuy.radius).toBe(true);
    expect(s.autoBuy.density).toBe(true);
    expect(s.autoBuy.efficiency, 'one the old save never mentioned').toBe(true);
  });

  it('carries the run on, condensing from the first cloud', () => {
    const s = deserialize(v3, NOW);
    expect(s.cloud).toEqual(firstCloud());
    expect(s.sky, 'old collapses are not invented into stars').toEqual([]);
    expect(s.settings.notation, 'letters was only ever the default').toBe('words');
    expect(s.settings.particleBudget).toBe(900);
  });

  it('keeps everything else exactly where it was', () => {
    const s = deserialize(v3, NOW);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.mass.toString()).toBe(D('5e9').toString());
    expect(s.totalMassEver.toString()).toBe(D('8e9').toString());
    expect(s.levels.gravity).toBe(40);
    expect(s.levels.density).toBe(4);
    expect(s.levelsEver.density).toBe(61);
    expect(s.rebasedStage).toBe(6);
    expect(s.stageSeen).toBe(6);
    expect(s.stats.purchases).toBe(900);
    expect('pulseReadyAt' in s).toBe(false);
    expect('collapses' in s).toBe(false);
    expect('pulses' in s.stats).toBe(false);
  });
});

describe('a save left at the top of the old ladder', () => {
  /** The overnight exploit, in a save: far past anything the first cloud holds. */
  const v4 = {
    version: 4,
    mass: '3e30',
    totalMassEver: '4e30',
    levels: { gravity: 90, particleMass: 140 },
    levelsEver: { gravity: 90, particleMass: 140 },
    rebasedStage: 11,
    stageSeen: 11,
    stardust: '2.5e7',
    stardustEver: '1e12',
    collapses: 6,
    stardustLevels: { enrichment: 30, seed: 12, ignition: 4 },
    settings: { notation: 'scientific' },
    lastSeen: NOW,
  };

  it('becomes a finished Sun, waiting to be let go', () => {
    const s = deserialize(v4, NOW);
    expect(stageAt(stageIndexFor(s.totalMassEver)).id).toBe('yellowDwarf');
    expect(isRunning(s), 'nothing left to fall in').toBe(false);
    expect(canRelease(s)).toBe(true);
    expect(s.mass.lte(s.totalMassEver)).toBe(true);
    expect(s.totalMassEver.lte(capOf(firstCloud()))).toBe(true);
  });

  it('caps what a fortune in the old currency is worth', () => {
    const s = deserialize(v4, NOW);
    // floor(40 x 12) is 480, and the re-denomination stops at 400.
    expect(s.stardust).toBe(400);
    expect(s.stardustLevels.enrichment).toBe(0);
  });

  it('keeps a notation the player chose on purpose', () => {
    expect(deserialize(v4, NOW).settings.notation).toBe('scientific');
  });
});

describe('the sky in a save', () => {
  it('round trips the cloud, the stars and the seed exactly', () => {
    const s = initialState(NOW);
    s.totalMassEver = capOf(firstCloud()).mul(0.9995);
    s.mass = s.totalMassEver;
    release(s, NOW + 5000);
    chooseCloud(s, 1);

    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))), NOW);
    expect(back.cloud).toEqual(s.cloud);
    expect(back.sky).toEqual(s.sky);
    expect(back.skySeed).toBe(s.skySeed);
    expect(back.stardust).toBe(s.stardust);
    expect(back.runStartedAt).toBe(s.runStartedAt);
  });

  it('keeps "between stars" as a state, not a missing cloud', () => {
    const s = initialState(NOW);
    s.totalMassEver = capOf(firstCloud()).mul(0.9995);
    release(s, NOW);
    expect(s.cloud).toBeNull();

    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))), NOW);
    expect(back.cloud).toBeNull();
    expect(offersFor(back)).toEqual(offersFor(s));
  });

  it('drops a damaged star rather than drawing nonsense, and repairs a damaged cloud', () => {
    const blob = {
      ...serialize(initialState(NOW)),
      cloud: { name: 'Half A Cloud' },
      sky: [
        { id: 1, name: 'Heron', stage: 'yellowDwarf', cloud: 'Heron Drift', x: 2, y: -1, hue: 'blue', trait: 'odd' },
        { id: 'two', name: 'Broken' },
        null,
      ],
    };
    const back = deserialize(blob, NOW);
    expect(back.sky).toHaveLength(1);
    expect(back.sky[0]!.x).toBe(1);
    expect(back.sky[0]!.y).toBe(0);
    expect(back.sky[0]!.trait).toBe('quiet');
    // A save with stars but no usable cloud is offered a choice rather than handed one.
    expect(back.cloud).toBeNull();
  });
});
