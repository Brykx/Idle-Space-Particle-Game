import { D, type Num } from './numbers';
import { ACCRETION_STAGES } from './stages';
import { UPGRADE_IDS, type UpgradeId } from './upgrades';
import type { GameState } from './state';

/**
 * The supernova, and what survives it.
 *
 * This is the one place the ladder runs backwards, and it does so because the physics does:
 * a star does not become a neutron star by gaining mass, it runs out of fuel and throws
 * roughly ninety percent of itself away. A 20-solar-mass supergiant leaves a 1.4-solar-mass
 * remnant. Losing almost everything is not a game-ism bolted on for pacing — it is the event.
 *
 * What you keep is Stardust, and that is not a game-ism either: supernovae are where most of
 * the heavy elements in the universe came from, and the next generation of stars condenses
 * out of that enriched debris. You restart in the nebula your own collapse made.
 */

/** Ids of the permanent upgrades Stardust buys. */
export const STARDUST_IDS = ['enrichment', 'seed', 'ignition'] as const;

export type StardustId = (typeof STARDUST_IDS)[number];

export interface StardustDef {
  id: StardustId;
  name: string;
  blurb: string;
  baseCost: number;
  growth: number;
  /** Levels beyond which it does nothing, where the effect is naturally bounded. */
  maxLevel: number;
  perLevel: string;
}

/**
 * Three upgrades, deliberately orthogonal.
 *
 * Only one of them multiplies income. The others change the *shape* of a run — how much you
 * start with, how far up the chain you begin — because a prestige tree of six different
 * global multipliers is six ways to write the same upgrade, and the second run should feel
 * different rather than merely shorter.
 *
 * There were five. Deep Slumber bought back an offline shortfall and Muscle Memory lowered
 * the bar to automate; both patched problems that stopped existing when absence lost its cap
 * and a current began to flow from its first level.
 *
 * Costs are in whole Stardust and grow geometrically, so the tree has the same shape as the
 * mass economy and the same reasoning applies to it.
 */
export const STARDUST_UPGRADES: Record<StardustId, StardustDef> = {
  enrichment: {
    id: 'enrichment',
    name: 'Enriched Nebula',
    blurb: 'The cloud you condense from is your own debris. It is not the hydrogen you started with.',
    baseCost: 1,
    growth: 1.75,
    maxLevel: 400,
    perLevel: 'x1.15 to all mass',
  },
  seed: {
    id: 'seed',
    name: 'Seed Mass',
    blurb: 'A clump survives the shock and is already there when the dust settles.',
    baseCost: 2,
    growth: 2.2,
    maxLevel: 400,
    perLevel: 'x8 starting mass',
  },
  ignition: {
    id: 'ignition',
    name: 'Prior Ignition',
    blurb: 'The nebula is already salted with what you fused. You do not start at hydrogen.',
    baseCost: 6,
    growth: 12,
    // One per element above hydrogen that is actually reachable.
    maxLevel: 4,
    perLevel: '+1 starting element tier',
  },
};

export const STARDUST_LIST: StardustDef[] = STARDUST_IDS.map((id) => STARDUST_UPGRADES[id]);

/**
 * Cost of the next level of a Stardust upgrade.
 *
 * A `Decimal`, like every other currency here, and for the same reason. Stardust goes as mass
 * to the 0.6, mass spans hundreds of orders of magnitude over several runs, and a plain
 * number stops being able to count past 2^53 somewhere in run three or four. The whole
 * project carries an exact big-number type to avoid exactly this; a prestige currency that
 * quietly opts out of it is a bug with a long fuse.
 */
export function stardustCost(def: StardustDef, level: number): Num {
  return D(def.baseCost).mul(D(def.growth).pow(level)).ceil();
}

/** The mass at which a collapse becomes possible: the top of the accretion ladder. */
export function collapseThreshold(): Num {
  const top = ACCRETION_STAGES[ACCRETION_STAGES.length - 1]?.threshold;
  return top ?? D(1);
}

/**
 * What collapsing right now would pay.
 *
 * ```
 * stardust = floor( 12 x (totalMassEver / threshold) ^ 0.6 )
 * ```
 *
 * Read from lifetime mass rather than current mass on purpose. Reading current mass would
 * mean spending your way out of a better collapse, so the optimal play would be to stop
 * buying upgrades and sit on a pile — an anti-strategy where the correct move is to stop
 * playing the game.
 *
 * The exponent is what makes the timing a decision. Below 1, collapsing later earns more in
 * total but less per order of magnitude, so there is a real trade between a long run and
 * several short ones instead of one correct answer.
 */
export const STARDUST_SCALE = 12;
export const STARDUST_EXPONENT = 0.6;

export function stardustFor(s: GameState): Num {
  const ratio = s.totalMassEver.div(collapseThreshold());
  // Strictly below the threshold only. Arriving exactly on it is a finished ladder and pays
  // the formula's floor, which is the whole scale constant.
  if (ratio.lt(1)) return D(0);
  return D(STARDUST_SCALE).mul(ratio.pow(STARDUST_EXPONENT)).floor();
}

/** You can only collapse a star that has finished being a star. */
export function canCollapse(s: GameState): boolean {
  return s.totalMassEver.gte(collapseThreshold());
}

/** Everything the Stardust tree currently does, in one place. */
export interface StardustEffects {
  /** Multiplies all mass income. */
  massMultiplier: number;
  /** Mass the next run starts with. */
  seedMass: Num;
  /** Element tier the next run starts at. */
  startingTier: number;
}

export function stardustEffects(s: GameState): StardustEffects {
  const level = s.stardustLevels;
  return {
    massMultiplier: Math.pow(1.15, level.enrichment),
    seedMass: level.seed > 0 ? D(8).pow(level.seed) : D(0),
    startingTier: Math.min(STARDUST_UPGRADES.ignition.maxLevel, level.ignition),
  };
}

export function buyStardust(s: GameState, id: StardustId): boolean {
  const def = STARDUST_UPGRADES[id];
  const level = s.stardustLevels[id];
  if (level >= def.maxLevel) return false;
  const cost = stardustCost(def, level);
  if (s.stardust.lt(cost)) return false;
  s.stardust = s.stardust.sub(cost);
  s.stardustLevels[id] = level + 1;
  return true;
}

/**
 * Collapse the star. Returns the Stardust gained, or null if it was not possible.
 *
 * What survives is chosen rather than incidental:
 *
 * - **Achievements** survive, because they record what you have done and you did it.
 * - **Levels ever bought** survive, so every current you have opened is still open. The second
 *   star needs no opening at all, which is the point: a later run is about the choices, not
 *   about clicking through the first twenty minutes again.
 * - **Auto-buy toggles** survive, because they are a preference, not progress.
 * - Everything else goes: mass, lifetime mass, energy, every upgrade level, the stage.
 *
 * `stageSeen` resets too, so the ladder announces itself again. The second climb through the
 * same twelve bodies is most of what a run looks like, and silencing it would be throwing
 * away the thing the visual work was for.
 */
export function collapse(s: GameState): Num | null {
  if (!canCollapse(s)) return null;

  const gained = stardustFor(s);
  s.stardust = s.stardust.add(gained);
  s.stardustEver = s.stardustEver.add(gained);
  s.collapses += 1;

  const seed = stardustEffects(s).seedMass;
  s.mass = seed;
  s.totalMassEver = seed;
  s.energy = D(0);
  s.totalEnergyEver = D(0);
  for (const id of UPGRADE_IDS) s.levels[id as UpgradeId] = 0;
  s.rebasedStage = 0;
  s.stageSeen = 0;

  return gained;
}
