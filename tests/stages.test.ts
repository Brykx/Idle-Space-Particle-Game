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

describe('field identity', () => {
  const ladder = ACCRETION_STAGES;

  it('makes particles steadily bigger and steadily fewer', () => {
    for (let i = 1; i < ladder.length; i++) {
      const before = ladder[i - 1]!.look;
      const after = ladder[i]!.look;
      expect(after.particleSize, `${ladder[i]!.id} size`).toBeGreaterThan(before.particleSize);
      expect(after.particleCount, `${ladder[i]!.id} count`).toBeLessThan(before.particleCount);
    }
  });

  /**
   * The rule the whole thing rests on. The field blends additively, so what decides whether
   * the screen stays readable is the total lit *area* — count x size squared. Let it climb
   * freely and the late game is a white blowout; hold it exactly flat and the late game feels
   * no weightier than the early. A gentle rise is the target.
   */
  /**
   * Lit area is count x size squared. The bound exists because the early field blends
   * additively and a rising area there is a white blowout; the late field is lit rocks on
   * normal blending, where area is occlusion rather than addition and the argument is much
   * weaker. The monotone half is kept anyway, as a smoothness check: a stage that dips or
   * spikes against its neighbours is a typo, whatever the blending.
   */
  it('keeps the lit area in a narrow band, rising only gently', () => {
    const area = (s: (typeof ladder)[number]) => s.look.particleCount * s.look.particleSize ** 2;
    const first = area(ladder[0]!);
    const last = area(ladder[ladder.length - 1]!);

    expect(last / first).toBeGreaterThan(1.5);
    expect(last / first).toBeLessThan(4);

    // And monotone, so no stage is a dip or a spike against its neighbours.
    for (let i = 1; i < ladder.length; i++) {
      expect(area(ladder[i]!), `${ladder[i]!.id} area`).toBeGreaterThan(area(ladder[i - 1]!));
    }
  });

  it('lets early stages loiter and late ones fall hard', () => {
    for (let i = 1; i < ladder.length; i++) {
      const before = ladder[i - 1]!.look;
      const after = ladder[i]!.look;
      // Tangential speed as a fraction of orbital: nearer 1 holds an orbit, nearer 0 drops in.
      expect(after.orbit[1], `${ladder[i]!.id} orbit`).toBeLessThan(before.orbit[1]);
      expect(after.drag, `${ladder[i]!.id} drag`).toBeGreaterThan(before.drag);
      expect(after.lifetime, `${ladder[i]!.id} lifetime`).toBeLessThanOrEqual(before.lifetime);
    }
  });

  it('gives every stage a sane orbit range', () => {
    for (const stage of STAGES) {
      const [min, max] = stage.look.orbit;
      expect(min, stage.id).toBeGreaterThan(0);
      expect(max, stage.id).toBeGreaterThan(min);
      // At or above orbital speed a capture trajectory would never come down.
      expect(max, stage.id).toBeLessThan(1);
      expect(stage.look.drag, stage.id).toBeGreaterThan(0);
      expect(stage.look.lifetime, stage.id).toBeGreaterThan(0);
    }
  });
});

