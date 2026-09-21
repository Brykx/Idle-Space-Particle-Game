import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, SAVE_VERSION } from '../src/sim/state';
import { buy, tick } from '../src/sim/economy';
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
        pulseReadyAt: -99,
        levels: { gravity: -4, radius: 2.7, nonsense: 10 },
        settings: { notation: 'runes', particleBudget: 1e9 },
      },
      NOW,
    );
    expect(loaded.mass.toNumber()).toBe(0);
    expect(loaded.playTime).toBe(0);
    expect(loaded.pulseReadyAt).toBe(0);
    expect(loaded.levels.gravity).toBe(0);
    expect(loaded.levels.radius).toBe(2);
    expect(loaded.settings.notation).toBe('letters');
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
