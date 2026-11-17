import { D, type Num } from './numbers';
import { costScaleAt } from './stages';

/**
 * Upgrades are data, not code.
 *
 * Adding one is an entry in this file: the UI, the cost maths, the save format and the
 * balance tool all pick it up for free. That is what keeps later acts cheap instead of a
 * rewrite each.
 *
 * Every upgrade feeds exactly one of the four terms in
 *   massPerSecond = spawnRate x captureFraction x massPerParticle x globalMultiplier
 * so a player who reads one tooltip understands the whole economy.
 */

export const UPGRADE_IDS = [
  'gravity',
  'radius',
  'density',
  'particleMass',
  'efficiency',
  'disk',
  'confinement',
  'magnetic',
] as const;

export type UpgradeId = (typeof UPGRADE_IDS)[number];

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Flavour, one line, shown under the name. */
  blurb: string;
  /** Which term this feeds. Shown as a tag, and it decides which income a level improves. */
  term: 'spawn' | 'capture' | 'value' | 'global' | 'energy' | 'requirement';
  /** What it is bought with. Energy upgrades are the sink for accumulated energy. */
  currency: 'mass' | 'energy';
  baseCost: Num;
  /** Cost multiplier per level. Cheap upgrades grow slowly and stay clicky. */
  growth: number;
  /** Revealed once total mass ever earned passes this. */
  unlockAt: Num;
  /**
   * Whether this upgrade resets to level 0 at each promotion and reprices to the new stage.
   *
   * A rebased upgrade is the same card mattering again, twelve times, instead of one card
   * you finish with. It is not free: an upgrade that resets stops compounding across the run,
   * so whatever it used to contribute has to be paid back somewhere — see PROMOTION_MULTIPLIER
   * in `economy.ts`. Shipping a rebase without that payback turns the late game into a wall.
   */
  rebased?: true;
  /** Human-readable description of what the next level buys. */
  perLevel: string;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  gravity: {
    id: 'gravity',
    name: 'Gravity Well',
    blurb: 'Deepen the potential. Distant particles begin to notice you.',
    term: 'capture',
    currency: 'mass',
    baseCost: D(10),
    growth: 1.425,
    unlockAt: D(0),
    perLevel: 'x1.34 gravity',
  },
  radius: {
    id: 'radius',
    name: 'Capture Radius',
    blurb: 'Widen the cross-section the core presents to the drift.',
    term: 'capture',
    currency: 'mass',
    baseCost: D(25),
    growth: 1.5,
    unlockAt: D(0),
    perLevel: '+4 reach',
  },
  density: {
    id: 'density',
    name: 'Particle Density',
    blurb: 'Draw from a thicker stretch of the cloud.',
    term: 'spawn',
    currency: 'mass',
    baseCost: D(30),
    growth: 1.685,
    unlockAt: D(20),
    // Density is the count of particles, and climbing the ladder is exactly the thing that
    // makes them fewer and bigger. Resetting this card at each promotion is the mechanic
    // agreeing with the picture: the flow coarsens, and you rebuild it from a coarser floor.
    rebased: true,
    perLevel: 'x1.165 particles/s',
  },
  particleMass: {
    id: 'particleMass',
    name: 'Particle Mass',
    blurb: 'Favour the heavy stuff. Each capture is worth more.',
    term: 'value',
    currency: 'mass',
    baseCost: D(100),
    growth: 1.826,
    unlockAt: D(250),
    perLevel: 'x1.34 per particle',
  },
  efficiency: {
    id: 'efficiency',
    name: 'Accretion Efficiency',
    blurb: 'Lose less to radiation on the way in.',
    term: 'global',
    currency: 'mass',
    baseCost: D(750),
    growth: 3.79,
    unlockAt: D(1200),
    perLevel: 'x1.34 to everything',
  },

  // --- the energy economy ------------------------------------------------------------
  //
  // The disk is built with mass; what it produces is bought back with energy. That split is
  // what stops the second currency being mass wearing a hat.
  disk: {
    id: 'disk',
    name: 'Accretion Disk',
    blurb: 'A ring of infalling matter, shearing against itself. Feed it back into itself.',
    term: 'energy',
    currency: 'energy',
    baseCost: D(5e3),
    growth: 4,
    unlockAt: D(5e6),
    perLevel: 'x1.15 throughput',
  },
  confinement: {
    id: 'confinement',
    name: 'Magnetic Confinement',
    blurb: 'Hold the burning region together, and it takes less to keep it lit.',
    term: 'requirement',
    currency: 'energy',
    baseCost: D(2e4),
    growth: 2.6,
    unlockAt: D(2e7),
    perLevel: 'x0.9 to fusion requirements',
  },
  magnetic: {
    id: 'magnetic',
    name: 'Field Lines',
    blurb: 'Channel the ionised infall along the field instead of letting it scatter.',
    term: 'energy',
    currency: 'energy',
    baseCost: D(5e4),
    growth: 2.8,
    unlockAt: D(1e8),
    perLevel: 'x1.12 throughput',
  },
};

/** The five that feed the mass formula, in the order the player meets them. */
export const MASS_UPGRADE_IDS = UPGRADE_IDS.filter((id) => UPGRADES[id].currency === 'mass' && UPGRADES[id].term !== 'energy');

export const UPGRADE_LIST: UpgradeDef[] = UPGRADE_IDS.map((id) => UPGRADES[id]);

/** The ids that reset and reprice at every promotion. */
export const REBASED_UPGRADE_IDS = UPGRADE_IDS.filter((id) => UPGRADES[id].rebased);

/**
 * What this upgrade costs at a stage, before levels.
 *
 * `stage` is required rather than defaulted throughout this file. A default of zero would be
 * silently wrong for every rebased upgrade, and wrong in the direction that is hardest to
 * notice: too cheap.
 */
function baseAt(def: UpgradeDef, stage: number): Num {
  return def.rebased ? def.baseCost.mul(costScaleAt(stage)) : def.baseCost;
}

/** Cost of the single next level, given how many you already own. */
export function costAt(def: UpgradeDef, level: number, stage: number): Num {
  return baseAt(def, stage).mul(D(def.growth).pow(level));
}

/**
 * Cost of `count` levels starting from `level` — the geometric sum, in closed form, so
 * "buy max" stays instant at level 400.
 */
export function costOfLevels(def: UpgradeDef, level: number, count: number, stage: number): Num {
  if (count <= 0) return D(0);
  const g = D(def.growth);
  return costAt(def, level, stage).mul(g.pow(count).sub(1)).div(g.sub(1));
}

export interface Purchase {
  levels: number;
  cost: Num;
}

/**
 * The largest number of levels `budget` can afford, and the exact total.
 *
 * Inverts the geometric sum, then walks back if the logarithm rounded us one level too
 * generous — the caller is spending real currency and must never overdraw.
 */
export function maxAffordable(def: UpgradeDef, level: number, budget: Num, stage: number): Purchase {
  const next = costAt(def, level, stage);
  if (budget.lt(next)) return { levels: 0, cost: D(0) };

  const g = def.growth;
  const ratio = budget.mul(g - 1).div(next).add(1);
  let k = Math.floor(ratio.log10() / Math.log10(g));
  if (!Number.isFinite(k) || k < 1) k = 1;

  // Trust the closed form, verify the boundary.
  let cost = costOfLevels(def, level, k, stage);
  while (k > 1 && cost.gt(budget)) {
    k -= 1;
    cost = costOfLevels(def, level, k, stage);
  }
  while (costOfLevels(def, level, k + 1, stage).lte(budget)) {
    k += 1;
    cost = costOfLevels(def, level, k, stage);
  }

  return { levels: k, cost };
}
