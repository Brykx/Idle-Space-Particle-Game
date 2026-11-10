import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import {
  AUTO_PAYBACK_HORIZON,
  awardAchievements,
  buy,
  deriveRates,
  isFlowing,
  isOpen,
  levelGain,
  nextCost,
  paybackSeconds,
  runAutoBuyers,
  tick,
} from '../src/sim/economy';
import { ACHIEVEMENTS, multiplierFor } from '../src/sim/achievements';
import { stageIndexFor } from '../src/sim/stages';
import { applyOffline } from '../src/sim/offline';
import { deserialize, serialize } from '../src/sim/save';
import { MASS_UPGRADE_IDS, UPGRADES, UPGRADE_IDS, costOfLevels, type UpgradeId } from '../src/sim/upgrades';

const NOW = 1_700_000_000_000;

/**
 * A state with every current opened and flowing, at a place on the ladder the game reaches.
 *
 * Rebased upgrades are left at level 0, because that is the only thing they can be just
 * after a promotion, and every caller here sets a lifetime mass well up the ladder. Arming
 * Density at level 25 at the Planet stage produced a state the game cannot reach, and priced
 * its next level so far out of range that it looked like the automation was broken.
 *
 * `levelsEver` still carries the investment, which is what "open" reads.
 */
function flowing(levels: Partial<Record<UpgradeId, number>> = {}): GameState {
  const s = initialState(NOW);
  for (const id of UPGRADE_IDS) {
    const level = levels[id] ?? 25;
    s.levels[id] = UPGRADES[id].rebased ? 0 : level;
    s.levelsEver[id] = Math.max(1, level);
    s.autoBuy[id] = true;
  }
  return s;
}

/** Twenty minutes of a real run: every current opened as soon as it can be, then left alone. */
function played(seconds = 1200): GameState {
  const s = initialState(NOW);
  for (let t = 0; t < seconds; t += 0.5) {
    for (const id of UPGRADE_IDS) if (!isOpen(s, id)) buy(s, id, 1);
    tick(s, 0.5);
  }
  return s;
}

describe('a current', () => {
  it('does not flow until you have begun it by hand, and then it does', () => {
    const s = initialState(NOW);
    s.mass = D('1e12');
    s.totalMassEver = D('1e12');

    // Flowing is the default, so the only thing in the way is that it has never been opened.
    expect(s.autoBuy.gravity).toBe(true);
    expect(isOpen(s, 'gravity')).toBe(false);
    expect(runAutoBuyers(s)).toBe(0);

    expect(buy(s, 'gravity', 1)).toBe(1);
    expect(isOpen(s, 'gravity')).toBe(true);
    expect(isFlowing(s, 'gravity')).toBe(true);
    expect(runAutoBuyers(s)).toBeGreaterThan(0);
  });

  it('stays open through a promotion that takes its levels away', () => {
    const s = initialState(NOW);
    s.mass = D(1e4);
    s.totalMassEver = D(50);
    buy(s, 'density', 1);
    expect(s.levels.density).toBe(1);

    s.totalMassEver = D(150);
    tick(s, 0.05);
    expect(s.rebasedStage, 'promoted').toBe(1);
    expect(isOpen(s, 'density'), 'still open').toBe(true);
  });

  it('does nothing while it is held', () => {
    const s = flowing();
    for (const id of UPGRADE_IDS) s.autoBuy[id] = false;
    s.mass = D('1e12');
    s.totalMassEver = D('1e12');

    expect(runAutoBuyers(s)).toBe(0);
    expect(s.levels.gravity).toBe(25);
  });
});

describe('what the automation buys', () => {
  it('stops only when nothing worth buying is affordable', () => {
    const s = flowing();
    s.mass = D('1e9');
    s.totalMassEver = D('1e9');
    s.rebasedStage = stageIndexFor(s.totalMassEver);
    runAutoBuyers(s);

    // The invariant has two halves now. A card is left alone either because it cannot be
    // paid for or because it would not repay itself inside the horizon — and nothing else.
    const rates = deriveRates(s);
    for (const id of MASS_UPGRADE_IDS) {
      const affordable = nextCost(s, id).lte(s.mass);
      const worthIt = paybackSeconds(s, id, rates) <= AUTO_PAYBACK_HORIZON;
      expect(affordable && worthIt, `${id} was affordable and worth buying`).toBe(false);
    }
  });

  /**
   * The difference between this automation and the one it replaced, on one state.
   *
   * Gravity Well at level 10 is the cheaper card and the worse purchase: 345 mass for under
   * six percent, against 750 for a third more of everything. Cheapest-first took the cheap one.
   */
  it('takes the purchase that repays soonest, not the cheapest', () => {
    const s = initialState(NOW);
    s.totalMassEver = D(1500);
    s.rebasedStage = stageIndexFor(s.totalMassEver);
    s.levels.gravity = 10;
    s.levelsEver.gravity = 10;
    s.levelsEver.efficiency = 1;
    s.mass = D(800);

    const rates = deriveRates(s);
    expect(nextCost(s, 'gravity').lt(nextCost(s, 'efficiency')), 'gravity is the cheaper card').toBe(true);
    expect(paybackSeconds(s, 'efficiency', rates)).toBeLessThan(paybackSeconds(s, 'gravity', rates));

    runAutoBuyers(s);
    expect(s.levels.efficiency).toBe(1);
    expect(s.levels.gravity).toBe(10);
  });

  /**
   * The card that used to eat the run. Capture saturates towards 1 and never arrives, so a
   * level of Gravity Well is always worth *something* — at level 60, about a millionth.
   */
  it('leaves a card alone once it would not repay itself within the hour', () => {
    const s = initialState(NOW);
    s.totalMassEver = D(1500);
    s.rebasedStage = stageIndexFor(s.totalMassEver);
    s.levels.gravity = 60;
    s.levelsEver.gravity = 60;
    s.mass = nextCost(s, 'gravity').mul(10);

    expect(paybackSeconds(s, 'gravity', deriveRates(s))).toBeGreaterThan(AUTO_PAYBACK_HORIZON);
    expect(runAutoBuyers(s), 'affordable ten times over, and not bought').toBe(0);

    // Settled is a statement about now, not a lock: when income has grown enough that the
    // same level repays itself in time, it is bought again.
    s.levels.particleMass = 200;
    expect(paybackSeconds(s, 'gravity', deriveRates(s))).toBeLessThan(AUTO_PAYBACK_HORIZON);
    expect(runAutoBuyers(s)).toBeGreaterThan(0);
    expect(s.levels.gravity).toBeGreaterThan(60);
  });

  /**
   * The measured failure this replaces: left to itself, the old automation put more than half
   * of everything it spent into the two capture cards while they read +0.00%.
   */
  it('does not pour a run into the cards that have saturated', () => {
    const s = played(2400);

    const spent = (id: UpgradeId) =>
      UPGRADES[id].rebased ? 0 : costOfLevels(UPGRADES[id], 0, s.levels[id], 0).toNumber();
    const capture = spent('gravity') + spent('radius');
    const growth = spent('particleMass') + spent('efficiency');

    expect(deriveRates(s).captureFraction, 'capture is all but saturated by now').toBeGreaterThan(0.95);
    expect(capture / (capture + growth)).toBeLessThan(0.1);
  });

  it('touches every mass current over a run', () => {
    const s = played();
    // More than the one level that opened it: the rest were bought for you.
    for (const id of MASS_UPGRADE_IDS) {
      expect(s.levelsEver[id], `${id} levels bought`).toBeGreaterThan(1);
    }
  });

  it('buys the energy side whenever it can be paid for', () => {
    const s = flowing({ disk: 0, confinement: 0, magnetic: 0 });
    s.totalMassEver = D('1e9');
    s.rebasedStage = stageIndexFor(s.totalMassEver);
    s.energy = D('1e6');
    runAutoBuyers(s);

    expect(s.levels.disk + s.levels.confinement + s.levels.magnetic).toBeGreaterThan(0);
    for (const id of ['disk', 'confinement', 'magnetic'] as const) {
      expect(nextCost(s, id).gt(s.energy), `${id} still affordable`).toBe(true);
    }
  });

  it('honours the reserve, leaving mass for a manual purchase', () => {
    const spent = (reserve: number) => {
      const s = flowing();
      s.mass = D(1e6);
      s.totalMassEver = D('1e9');
      s.rebasedStage = stageIndexFor(s.totalMassEver);
      s.settings.autoBuyReserve = reserve;
      runAutoBuyers(s);
      return D(1e6).sub(s.mass).toNumber();
    };

    expect(spent(0)).toBeGreaterThan(spent(0.5));
    expect(spent(0.9)).toBeLessThan(spent(0.5));
  });

  it('never overdraws', () => {
    const s = flowing();
    s.mass = D(5000);
    s.totalMassEver = D('1e9');
    runAutoBuyers(s);
    expect(s.mass.sign()).toBeGreaterThanOrEqual(0);
  });
});

describe('what a level is worth', () => {
  /**
   * The automation's estimate is a closed form so it can be asked thousands of times a
   * second. This holds it against the slow, obviously-correct answer: change the level, derive
   * everything again, and look at what income did.
   */
  it('agrees with deriving the rates again, for every mass current', () => {
    for (const base of [initialState(NOW), flowing(), flowing({ gravity: 3, radius: 40 }), played(600)]) {
      const rates = deriveRates(base);
      for (const id of MASS_UPGRADE_IDS) {
        const probe: GameState = { ...base, levels: { ...base.levels, [id]: base.levels[id] + 1 } };
        const measured = deriveRates(probe).massPerSecond.div(rates.massPerSecond).toNumber() - 1;
        expect(levelGain(id, rates), id).toBeCloseTo(measured, 9);
      }
    }
  });

  it('is zero for the energy side, whose value arrives in steps', () => {
    const rates = deriveRates(flowing());
    for (const id of ['disk', 'confinement', 'magnetic'] as const) {
      expect(levelGain(id, rates)).toBe(0);
      expect(paybackSeconds(flowing(), id, rates)).toBe(Infinity);
    }
  });
});

describe('an absence', () => {
  it('resolves a fortnight away without stalling', () => {
    const s = flowing();
    s.mass = D('1e6');
    s.totalMassEver = D('1e9');
    s.rebasedStage = stageIndexFor(s.totalMassEver);

    const started = Date.now();
    applyOffline(s, NOW + 14 * 24 * 3600 * 1000);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(s.stats.purchases).toBeGreaterThan(0);
  });

  /**
   * The property most likely to break now that the rate changes during a gap: an hour away
   * must pay close to what an hour present pays. It cannot match exactly — offline
   * integrates in coarser steps than the 20 Hz loop — but the gap has to stay small, or
   * closing the tab quietly becomes a penalty.
   */
  it('pays roughly what being present would have paid', () => {
    const present = flowing();
    present.mass = D(1e4);
    present.totalMassEver = D('1e9');
    present.rebasedStage = stageIndexFor(present.totalMassEver);
    // Being away earns "Absent Landlord", and a 2% global multiplier applied for a whole run
    // is worth around half an order of magnitude — it scales the growth rate, not just the
    // total. Give both sides the same achievements so this measures integration error only.
    present.stats.longestAway = 3600;
    for (let i = 0; i < 72_000; i++) tick(present, 0.05);

    const away = flowing();
    away.mass = D(1e4);
    away.totalMassEver = D('1e9');
    away.rebasedStage = stageIndexFor(away.totalMassEver);
    applyOffline(away, NOW + 3600_000);

    // Measured against what was *gained*, not in absolute orders of magnitude. An hour of
    // compounding covers tens of orders, so a fixed absolute bound stops meaning anything as
    // the tuning changes: a shortfall of 0.1 orders is enormous early and forty seconds'
    // worth late. The relative figure is the one a player would feel.
    const start = 9; // log10 of the seeded totalMassEver
    const gainedPresent = present.totalMassEver.log10() - start;
    const gainedAway = away.totalMassEver.log10() - start;
    expect(gainedAway).toBeLessThanOrEqual(gainedPresent);
    expect((gainedPresent - gainedAway) / gainedPresent).toBeLessThan(0.02);
  });

  /**
   * And the integration has to be converged at the step size offline actually uses: halving
   * it should barely move the answer. This is what catches the step size drifting coarse
   * again — the failure mode is silent, because offline still "works", just for less.
   */
  it('is converged at the step size offline uses', () => {
    const run = (dt: number) => {
      const s = flowing();
      s.mass = D(1e4);
      s.totalMassEver = D('1e9');
      s.rebasedStage = stageIndexFor(s.totalMassEver);
      for (let i = 0; i < Math.round(3600 / dt); i++) tick(s, dt);
      return s.totalMassEver.log10() - 9;
    };
    const coarse = run(0.5);
    const fine = run(0.25);
    expect(Math.abs(fine - coarse) / fine).toBeLessThan(0.01);
  });
});

describe('achievements', () => {
  it('unlocks once and never twice', () => {
    const s = initialState(NOW);
    s.stats.purchases = 1;

    expect(awardAchievements(s, deriveRates(s))).toContain('firstBuy');
    expect(awardAchievements(s, deriveRates(s))).not.toContain('firstBuy');
    expect(s.achievements.filter((id) => id === 'firstBuy')).toHaveLength(1);
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

  it('no longer rewards doing something on a timer', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    for (const gone of ['firstPulse', 'pulse50', 'pulse500', 'pulse5000']) {
      expect(ids).not.toContain(gone);
    }
  });
});

describe('saving automation', () => {
  it('round trips what is held and what has been earned', () => {
    const s = flowing();
    s.autoBuy.radius = false;
    s.achievements = ['firstBuy', 'shopping-that-does-not-exist', 'deepWell'];
    s.settings.autoBuyReserve = 0.35;

    const back = deserialize(JSON.parse(JSON.stringify(serialize(s))), NOW);

    expect(back.autoBuy.gravity).toBe(true);
    expect(back.autoBuy.radius).toBe(false);
    expect(back.settings.autoBuyReserve).toBeCloseTo(0.35, 6);
    // An id this build does not know about must not survive and hand out a multiplier.
    expect(back.achievements).toEqual(['firstBuy', 'deepWell']);
  });

  it('drops duplicate achievement ids rather than paying for them twice', () => {
    const s = initialState(NOW);
    const blob = { ...serialize(s), achievements: ['firstBuy', 'firstBuy', 'deepWell'] };
    expect(deserialize(blob, NOW).achievements).toEqual(['firstBuy', 'deepWell']);
  });
});
