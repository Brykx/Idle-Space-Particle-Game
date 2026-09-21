import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import {
  AUTO_BUY_LEVEL,
  autoBuyUnlocked,
  awardAchievements,
  deriveRates,
  runAutoBuyers,
  tick,
} from '../src/sim/economy';
import { ACHIEVEMENTS, multiplierFor } from '../src/sim/achievements';
import { applyOffline } from '../src/sim/offline';
import { deserialize, serialize } from '../src/sim/save';
import { UPGRADES, UPGRADE_IDS, costAt } from '../src/sim/upgrades';

const NOW = 1_700_000_000_000;

function armed(levels: Partial<Record<(typeof UPGRADE_IDS)[number], number>> = {}): GameState {
  const s = initialState(NOW);
  for (const id of UPGRADE_IDS) {
    s.levels[id] = levels[id] ?? AUTO_BUY_LEVEL;
    s.autoBuy[id] = true;
  }
  return s;
}

describe('auto-buyers', () => {
  it('stay locked until you have invested in that upgrade by hand', () => {
    const s = initialState(NOW);
    s.autoBuy.gravity = true;
    s.mass = D('1e12');
    s.totalMassEver = D('1e12');

    expect(autoBuyUnlocked(s, 'gravity')).toBe(false);
    expect(runAutoBuyers(s)).toBe(0);

    s.levels.gravity = AUTO_BUY_LEVEL;
    expect(autoBuyUnlocked(s, 'gravity')).toBe(true);
    expect(runAutoBuyers(s)).toBeGreaterThan(0);
  });

  it('does nothing for an upgrade that is switched off', () => {
    const s = armed();
    for (const id of UPGRADE_IDS) s.autoBuy[id] = false;
    s.mass = D('1e12');
    s.totalMassEver = D('1e12');

    expect(runAutoBuyers(s)).toBe(0);
    expect(s.levels.gravity).toBe(AUTO_BUY_LEVEL);
  });

  it('spends until nothing enabled is affordable, spreading across upgrades', () => {
    const s = armed();
    s.mass = D('1e9');
    s.totalMassEver = D('1e9');
    runAutoBuyers(s);

    // The invariant: it stops only when it cannot buy. An upgrade may be untouched simply
    // because it is far too expensive — Accretion Efficiency costs ~1e17 at this level — so
    // the test is about what is left affordable, not about every upgrade moving.
    for (const id of UPGRADE_IDS) {
      expect(costAt(UPGRADES[id], s.levels[id]).gt(s.mass), `${id} still affordable`).toBe(true);
    }

    // And buying the cheapest raises its cost, so spending spreads rather than piling in.
    const moved = UPGRADE_IDS.filter((id) => s.levels[id] > AUTO_BUY_LEVEL);
    expect(moved.length).toBeGreaterThan(2);
  });

  it('honours the reserve, leaving mass for a manual purchase', () => {
    const spent = (reserve: number) => {
      const s = armed();
      s.mass = D(1e6);
      s.totalMassEver = D('1e9');
      s.settings.autoBuyReserve = reserve;
      runAutoBuyers(s);
      return D(1e6).sub(s.mass).toNumber();
    };

    expect(spent(0)).toBeGreaterThan(spent(0.5));
    expect(spent(0.9)).toBeLessThan(spent(0.5));
  });

  it('never overdraws', () => {
    const s = armed();
    s.mass = D(5000);
    s.totalMassEver = D('1e9');
    runAutoBuyers(s);
    expect(s.mass.sign()).toBeGreaterThanOrEqual(0);
  });

  it('resolves a fortnight away without stalling', () => {
    const s = armed();
    s.mass = D('1e6');
    s.totalMassEver = D('1e9');

    const started = Date.now();
    applyOffline(s, NOW + 14 * 24 * 3600 * 1000);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(s.stats.purchases).toBeGreaterThan(0);
  });

  /**
   * The property most likely to break now that the rate changes during a gap: an hour away
   * must pay close to what an hour present pays. It cannot match exactly — offline
   * integrates in coarser steps than the 20 Hz loop — but the gap has to stay small, or
   * closing the tab quietly becomes a penalty.
   */
  it('pays an absence roughly what being present would have paid', () => {
    const present = armed();
    present.mass = D(1e4);
    present.totalMassEver = D('1e9');
    // Being away earns "Absent Landlord", and a 2% global multiplier applied for a whole run
    // is worth around half an order of magnitude — it scales the growth rate, not just the
    // total. Give both sides the same achievements so this measures integration error only.
    present.stats.longestAway = 3600;
    for (let i = 0; i < 3600; i++) tick(present, 1);

    const away = armed();
    away.mass = D(1e4);
    away.totalMassEver = D('1e9');
    applyOffline(away, NOW + 3600_000);

    // Measured against what was *gained*, not in absolute orders of magnitude. An hour of
    // compounding covers tens of orders, so a fixed absolute bound stops meaning anything as
    // the tuning changes: a shortfall of 0.1 orders is enormous early and forty seconds'
    // worth late. The relative figure is the one a player would feel.
    const start = 9; // log10 of the seeded totalMassEver
    const gainedPresent = present.totalMassEver.log10() - start;
    const gainedAway = away.totalMassEver.log10() - start;
    expect(Math.abs(gainedPresent - gainedAway) / gainedPresent).toBeLessThan(0.01);
  });

  /**
   * And the integration has to be converged at the step size offline actually uses: halving
   * it should barely move the answer. This is what catches the step size drifting coarse
   * again — the failure mode is silent, because offline still "works", just for less.
   */
  it('is converged at the step size offline uses', () => {
    const run = (dt: number) => {
      const s = armed();
      s.mass = D(1e4);
      s.totalMassEver = D('1e9');
      for (let i = 0; i < Math.round(3600 / dt); i++) tick(s, dt);
      return s.totalMassEver.log10() - 9;
    };
    // Halving the offline step must barely move the answer. If it does, the step has drifted
    // coarse and offline is quietly paying less — a failure that looks like working software.
    const coarse = run(0.5);
    const fine = run(0.25);
    expect(Math.abs(fine - coarse) / fine).toBeLessThan(0.01);
  });
});

describe('achievements', () => {
  it('unlocks once and never twice', () => {
    const s = initialState(NOW);
    s.stats.pulses = 1;

    expect(awardAchievements(s, 0.2)).toContain('firstPulse');
    expect(awardAchievements(s, 0.2)).not.toContain('firstPulse');
    expect(s.achievements.filter((id) => id === 'firstPulse')).toHaveLength(1);
  });

  it('multiplies everything, so earning them shows up in income', () => {
    const s = initialState(NOW);
    const before = deriveRates(s).massPerSecond;

    s.achievements = ACHIEVEMENTS.slice(0, 5).map((a) => a.id);
    const after = deriveRates(s).massPerSecond;

    expect(after.div(before).toNumber()).toBeCloseTo(multiplierFor(5), 6);
  });

  it('is earned during an absence, not only while watching', () => {
    const s = initialState(NOW);
    s.levels.gravity = 40;
    expect(s.achievements).not.toContain('deepWell');

    applyOffline(s, NOW + 600_000);
    expect(s.achievements).toContain('deepWell');
  });

  it('records the longest absence for the achievements that ask about it', () => {
    const s = initialState(NOW);
    applyOffline(s, NOW + 2 * 3600 * 1000);
    expect(s.stats.longestAway).toBeGreaterThanOrEqual(2 * 3600);
    expect(s.achievements).toContain('absentLandlord');
    expect(s.achievements).not.toContain('longWeekend');
  });

  it('gives every achievement a name and instructions, with unique ids', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.name.length).toBeGreaterThan(0);
      expect(achievement.how.length).toBeGreaterThan(0);
    }
  });
});

describe('saving automation', () => {
  it('round trips toggles and unlocked achievements', () => {
    const s = armed();
    s.autoBuy.radius = false;
    s.achievements = ['firstPulse', 'shopping-that-does-not-exist', 'deepWell'];
    s.settings.autoBuyReserve = 0.35;

    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))), NOW);

    expect(back.autoBuy.gravity).toBe(true);
    expect(back.autoBuy.radius).toBe(false);
    expect(back.settings.autoBuyReserve).toBeCloseTo(0.35, 6);
    // An id this build does not know about must not survive and hand out a multiplier.
    expect(back.achievements).toEqual(['firstPulse', 'deepWell']);
  });

  it('drops duplicate achievement ids rather than paying for them twice', () => {
    const s = initialState(NOW);
    const blob = { ...serialize(s), achievements: ['firstPulse', 'firstPulse', 'deepWell'] };
    expect(deserialize(blob, NOW).achievements).toEqual(['firstPulse', 'deepWell']);
  });
});
