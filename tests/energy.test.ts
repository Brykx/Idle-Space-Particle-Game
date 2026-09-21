import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { initialState, type GameState } from '../src/sim/state';
import { buy, deriveRates, tick, walletFor } from '../src/sim/economy';
import { ELEMENTS, REACHABLE_ELEMENTS, elementTierFor, nextRequirement } from '../src/sim/elements';
import { UPGRADES } from '../src/sim/upgrades';
import { applyOffline } from '../src/sim/offline';

const NOW = 1_700_000_000_000;

function withDisk(totalMass = '1e9'): GameState {
  const s = initialState(NOW);
  s.totalMassEver = D(totalMass);
  s.mass = D(totalMass);
  return s;
}

describe('the disk', () => {
  it('sheds nothing until the core is heavy enough to have one', () => {
    const s = initialState(NOW);
    s.totalMassEver = UPGRADES.disk.unlockAt.div(2);
    expect(deriveRates(s).energyPerSecond.sign()).toBe(0);

    s.totalMassEver = UPGRADES.disk.unlockAt;
    expect(deriveRates(s).energyPerSecond.gt(0)).toBe(true);
  });

  it('taxes the raw infall, so a fusion tier can never fund the disk that reaches the next', () => {
    const plain = withDisk();
    const fused = withDisk();
    fused.levels.magnetic = 40; // enough throughput to be fusing something

    const a = deriveRates(plain);
    const b = deriveRates(fused);
    expect(b.elementTier).toBeGreaterThan(a.elementTier);

    // Mass income rose with the tier; energy income per unit of throughput did not.
    expect(b.massPerSecond.div(a.massPerSecond).toNumber()).toBeCloseTo(b.elementMultiplier, 3);
    expect(b.energyPerSecond.div(a.energyPerSecond).toNumber()).toBeCloseTo(
      b.diskThroughput / a.diskThroughput,
      3,
    );
  });
});

describe('the element chain', () => {
  it('gates on throughput, which does not inflate with income', () => {
    expect(elementTierFor(0)).toBe(0);
    for (let i = 0; i < REACHABLE_ELEMENTS.length; i++) {
      const requires = REACHABLE_ELEMENTS[i]!.requires!;
      expect(elementTierFor(requires)).toBe(i);
      if (i > 0) expect(elementTierFor(requires * 0.999)).toBe(i - 1);
    }
  });

  it('lets confinement lower what a tier asks for', () => {
    const justUnder = REACHABLE_ELEMENTS[1]!.requires! * 0.9;
    expect(elementTierFor(justUnder, 1)).toBe(0);
    expect(elementTierFor(justUnder, 0.8)).toBe(1);
  });

  it('never reaches iron, whatever the throughput', () => {
    expect(elementTierFor(1e9)).toBe(REACHABLE_ELEMENTS.length - 1);
    expect(ELEMENTS[ELEMENTS.length - 1]?.id).toBe('iron');
    expect(REACHABLE_ELEMENTS.some((e) => e.id === 'iron')).toBe(false);
    expect(nextRequirement(REACHABLE_ELEMENTS.length - 1)).toBeNull();
  });

  it('feeds mass per particle rather than adding a term of its own', () => {
    const bare = withDisk();
    const fusing = withDisk();
    fusing.levels.magnetic = 40;

    const a = deriveRates(bare);
    const b = deriveRates(fusing);
    expect(b.massPerParticle.div(a.massPerParticle).toNumber()).toBeCloseTo(b.elementMultiplier, 6);
    expect(b.spawnRate).toBe(a.spawnRate);
    expect(b.captureFraction).toBe(a.captureFraction);
    expect(b.globalMultiplier).toBe(a.globalMultiplier);
  });

  it('keeps multipliers modest, because a flat multiplier scales the growth rate', () => {
    // A x1500 chain made the whole game about seventy times faster and collapsed the ladder.
    const top = REACHABLE_ELEMENTS[REACHABLE_ELEMENTS.length - 1]!;
    expect(top.multiplier).toBeLessThan(10);
  });
});

describe('two currencies', () => {
  it('pays for energy upgrades out of energy and mass upgrades out of mass', () => {
    const s = withDisk();
    s.energy = D(1e9);
    const massBefore = s.mass;

    expect(buy(s, 'disk', 1)).toBe(1);
    expect(s.mass.eq(massBefore)).toBe(true);
    expect(s.energy.lt(1e9)).toBe(true);

    const energyBefore = s.energy;
    expect(buy(s, 'gravity', 1)).toBe(1);
    expect(s.energy.eq(energyBefore)).toBe(true);
    expect(s.mass.lt(massBefore)).toBe(true);
  });

  it('will not buy an energy upgrade out of a full mass wallet', () => {
    const s = withDisk('1e30');
    s.energy = D(0);
    expect(walletFor(s, UPGRADES.disk).sign()).toBe(0);
    expect(buy(s, 'disk', 1)).toBe(0);
    expect(buy(s, 'disk', 'max')).toBe(0);
  });

  it('accumulates energy while you are away', () => {
    const s = withDisk();
    expect(s.energy.sign()).toBe(0);
    applyOffline(s, NOW + 600_000);
    expect(s.energy.gt(0)).toBe(true);
    expect(s.totalEnergyEver.gte(s.energy)).toBe(true);
  });

  it('earns energy on every tick, not only offline', () => {
    const s = withDisk();
    tick(s, 1);
    expect(s.energy.gt(0)).toBe(true);
  });
});
