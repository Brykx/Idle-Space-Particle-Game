import { describe, expect, it } from 'vitest';
import { D } from '../src/sim/numbers';
import { ACCRETION_STAGES, STAGES, stageAt, stageIndexFor, stageProgress } from '../src/sim/stages';

describe('the ladder', () => {
  it('starts at dust with a threshold of zero, so there is always a stage', () => {
    expect(STAGES[0]?.id).toBe('dust');
    expect(STAGES[0]?.threshold?.toNumber()).toBe(0);
    expect(stageIndexFor(D(0))).toBe(0);
  });

  it('keeps accretion thresholds strictly increasing', () => {
    for (let i = 1; i < ACCRETION_STAGES.length; i++) {
      const previous = ACCRETION_STAGES[i - 1]!.threshold!;
      const current = ACCRETION_STAGES[i]!.threshold!;
      expect(current.gt(previous), `${ACCRETION_STAGES[i]!.id} vs ${ACCRETION_STAGES[i - 1]!.id}`).toBe(true);
    }
  });

  it('excludes the collapse stages from accretion, because mass cannot get you there', () => {
    const collapse = STAGES.filter((s) => s.threshold === null).map((s) => s.id);
    expect(collapse).toEqual(['neutronStar', 'blackHole']);
    expect(ACCRETION_STAGES.some((s) => collapse.includes(s.id))).toBe(false);

    // However rich you get, accretion alone never makes you a neutron star.
    expect(stageIndexFor(D('1e300'))).toBeLessThan(ACCRETION_STAGES.length);
    expect(stageAt(stageIndexFor(D('1e300'))).threshold).not.toBeNull();
  });

  it('advances exactly on the threshold, not a hair before', () => {
    for (let i = 1; i < ACCRETION_STAGES.length; i++) {
      const threshold = ACCRETION_STAGES[i]!.threshold!;
      expect(stageIndexFor(threshold)).toBe(i);
      expect(stageIndexFor(threshold.mul(0.999))).toBe(i - 1);
    }
  });

  it('gives every stage a name, a blurb and something to compare it to', () => {
    for (const stage of STAGES) {
      expect(stage.name.length).toBeGreaterThan(0);
      expect(stage.blurb.length).toBeGreaterThan(0);
      expect(stage.analogue.length).toBeGreaterThan(0);
      expect(stage.look.scale).toBeGreaterThan(0);
      expect(stage.look.scale).toBeLessThanOrEqual(1);
    }
  });
});

describe('progress within a stage', () => {
  it('stays inside 0..1 everywhere, including below one mass', () => {
    for (const mass of ['0', '0.5', '1', '99', '100', '1e3', '5e10', '1e12', '1e19', '1e300']) {
      const { fraction } = stageProgress(D(mass));
      expect(fraction, mass).toBeGreaterThanOrEqual(0);
      expect(fraction, mass).toBeLessThanOrEqual(1);
    }
  });

  it('reads zero at a threshold and rises towards the next', () => {
    // Read the thresholds from the ladder rather than hardcoding them, so retuning the
    // curve does not break a test about the maths.
    const boulder = ACCRETION_STAGES.find((s) => s.id === 'boulder')!.threshold!;
    const planetesimal = ACCRETION_STAGES.find((s) => s.id === 'planetesimal')!.threshold!;

    const atBoulder = stageProgress(boulder);
    expect(atBoulder.stage.id).toBe('boulder');
    expect(atBoulder.next?.id).toBe('planetesimal');
    expect(atBoulder.fraction).toBeCloseTo(0, 6);

    // Halfway in orders of magnitude is the geometric mean of the two thresholds.
    const halfway = stageProgress(boulder.mul(planetesimal.div(boulder).pow(0.5)));
    expect(halfway.fraction).toBeCloseTo(0.5, 3);
  });

  it('reports no next stage at the top of the accretion ladder', () => {
    const top = stageProgress(D('1e300'));
    expect(top.next).toBeNull();
    expect(top.fraction).toBe(1);
    expect(top.stage.id).toBe('supergiant');
  });
});
