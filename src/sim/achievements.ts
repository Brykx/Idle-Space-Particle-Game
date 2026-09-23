import { D } from './numbers';
import type { GameState } from './state';
import { UPGRADE_IDS } from './upgrades';
import { STARDUST_LIST } from './prestige';

/**
 * Achievements: the cheapest retention mechanic there is, and the only one that rewards
 * playing in a particular way rather than simply playing more.
 *
 * Each is worth a small global multiplier, so the set compounds gently rather than any one
 * of them mattering. They are checked inside `tick`, which means an absence can unlock them
 * too — the balance tool earns them exactly as a player would, so their effect on pacing is
 * measured rather than assumed.
 *
 * Deliberately not a mirror of the stage ladder: the ladder already rewards getting heavier.
 * These are about what you did to get there.
 */

/** Each unlocked achievement multiplies everything by this much. */
export const ACHIEVEMENT_BONUS = 0.02;

export interface AchievementContext {
  state: GameState;
  captureFraction: number;
  stageIndex: number;
  autoBuyersOn: number;
  autoBuyersAvailable: number;
  /** Where the element chain has got to. 0 is plain hydrogen. */
  elementTier: number;
}

export interface Achievement {
  id: string;
  name: string;
  /** Shown before it is unlocked; it should read as an instruction. */
  how: string;
  test: (c: AchievementContext) => boolean;
}

const levelAtLeast = (id: (typeof UPGRADE_IDS)[number], level: number) => (c: AchievementContext) =>
  c.state.levels[id] >= level;

/**
 * Levels *ever*, for the upgrades that reset at a promotion.
 *
 * Particle Density goes back to zero eleven times a run, so an achievement reading its
 * current level would be asking for something the ladder takes away again.
 */
const investedAtLeast = (id: (typeof UPGRADE_IDS)[number], level: number) => (c: AchievementContext) =>
  c.state.levelsEver[id] >= level;

const stageAtLeast = (index: number) => (c: AchievementContext) => c.stageIndex >= index;
const massAtLeast = (amount: string) => (c: AchievementContext) => c.state.totalMassEver.gte(D(amount));

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'firstPulse',
    name: 'Nudge',
    how: 'Fire a Gravity Pulse',
    test: (c) => c.state.stats.pulses >= 1,
  },
  {
    id: 'pulse50',
    name: 'Percussive Maintenance',
    how: 'Fire 50 Gravity Pulses',
    test: (c) => c.state.stats.pulses >= 50,
  },
  {
    id: 'pulse500',
    name: 'Compulsive',
    how: 'Fire 500 Gravity Pulses',
    test: (c) => c.state.stats.pulses >= 500,
  },
  {
    id: 'firstBuy',
    name: 'Shopping',
    how: 'Buy an upgrade',
    test: (c) => c.state.stats.purchases >= 1,
  },
  {
    id: 'buy100',
    name: 'Investor',
    how: 'Buy 100 upgrade levels',
    test: (c) => c.state.stats.purchases >= 100,
  },
  {
    id: 'buy1000',
    name: 'Portfolio',
    how: 'Buy 1,000 upgrade levels',
    test: (c) => c.state.stats.purchases >= 1000,
  },
  {
    id: 'allFive',
    name: 'Five Ways Up',
    how: 'Own a level of every upgrade',
    test: (c) => UPGRADE_IDS.every((id) => c.state.levels[id] >= 1),
  },
  {
    id: 'deepWell',
    name: 'Deep Well',
    how: 'Gravity Well to level 25',
    test: levelAtLeast('gravity', 25),
  },
  {
    id: 'wideNet',
    name: 'Wide Net',
    how: 'Capture Radius to level 25',
    test: levelAtLeast('radius', 25),
  },
  {
    id: 'thickCloud',
    name: 'Thick Cloud',
    how: 'Particle Density to level 25',
    test: levelAtLeast('density', 25),
  },
  {
    id: 'heavyStuff',
    name: 'Heavy Stuff',
    how: 'Particle Mass to level 25',
    test: levelAtLeast('particleMass', 25),
  },
  {
    id: 'tightShip',
    name: 'Tight Ship',
    how: 'Accretion Efficiency to level 10',
    test: levelAtLeast('efficiency', 10),
  },
  {
    id: 'halfOfIt',
    name: 'Half of Everything',
    how: 'Capture more than half of what drifts past',
    test: (c) => c.captureFraction >= 0.5,
  },
  {
    id: 'hardlyAnyEscapes',
    name: 'Hardly Anything Escapes',
    how: 'Capture more than 90%',
    test: (c) => c.captureFraction >= 0.9,
  },
  {
    id: 'roundedOff',
    name: 'Rounded Off',
    how: 'Reach the Protoplanet stage',
    test: (c) => c.stageIndex >= 5,
  },
  {
    id: 'home',
    name: 'Home',
    how: 'Reach the Planet stage',
    test: (c) => c.stageIndex >= 6,
  },
  {
    id: 'firstLight',
    name: 'First Light',
    how: 'Reach the Red Dwarf stage and start burning hydrogen',
    test: (c) => c.stageIndex >= 9,
  },
  {
    id: 'delegation',
    name: 'Delegation',
    how: 'Switch on an auto-buyer',
    test: (c) => c.autoBuyersOn >= 1,
  },
  {
    id: 'handsOff',
    name: 'Hands Off',
    how: 'Switch on every auto-buyer you have unlocked (all five)',
    test: (c) => c.autoBuyersAvailable >= UPGRADE_IDS.length && c.autoBuyersOn >= UPGRADE_IDS.length,
  },
  {
    id: 'absentLandlord',
    name: 'Absent Landlord',
    how: 'Come back after an hour away',
    test: (c) => c.state.stats.longestAway >= 3600,
  },
  {
    id: 'longWeekend',
    name: 'Long Weekend',
    how: 'Stay away long enough to cap offline accretion',
    test: (c) => c.state.stats.longestAway >= 12 * 3600,
  },
  {
    id: 'stillHere',
    name: 'Still Here',
    how: 'Play for an hour',
    test: (c) => c.state.playTime >= 3600,
  },
  {
    id: 'insurance',
    name: 'Insurance',
    how: 'Export a save',
    test: (c) => c.state.stats.exports >= 1,
  },

  // --- the ladder ---------------------------------------------------------------------
  //
  // The ladder is already its own reward, so these are landmarks rather than a second
  // progress bar: the four that change what the game is, plus the two ends of it.
  {
    id: 'firstPromotion',
    name: 'Something From Nothing',
    how: 'Be promoted for the first time',
    test: stageAtLeast(1),
  },
  {
    id: 'boulder',
    name: 'Holding Together',
    how: 'Reach the Boulder stage',
    test: stageAtLeast(2),
  },
  {
    id: 'ownGravity',
    name: 'Your Own Gravity',
    how: 'Reach the Planetesimal stage, where you hold yourself together',
    test: stageAtLeast(3),
  },
  {
    id: 'asteroid',
    name: 'Named Rock',
    how: 'Reach the Asteroid stage',
    test: stageAtLeast(4),
  },
  {
    id: 'gasGiant',
    name: 'Too Big To Be Rock',
    how: 'Reach the Gas Giant stage',
    test: stageAtLeast(7),
  },
  {
    id: 'brownDwarf',
    name: 'Nearly',
    how: 'Reach the Brown Dwarf stage — heavy enough to burn deuterium, not hydrogen',
    test: stageAtLeast(8),
  },
  {
    id: 'sunlike',
    name: 'Sunlike',
    how: 'Reach the Star stage',
    test: stageAtLeast(10),
  },
  {
    id: 'supergiant',
    name: 'Living Fast',
    how: 'Reach the Supergiant stage, the last one accretion can reach',
    test: stageAtLeast(11),
  },

  // --- sheer mass ---------------------------------------------------------------------
  { id: 'mass1e6', name: 'Six Figures', how: 'Accumulate 1e6 mass', test: massAtLeast('1e6') },
  { id: 'mass1e12', name: 'Twelve', how: 'Accumulate 1e12 mass', test: massAtLeast('1e12') },
  { id: 'mass1e18', name: 'Eighteen', how: 'Accumulate 1e18 mass', test: massAtLeast('1e18') },
  { id: 'mass1e24', name: 'Past Counting', how: 'Accumulate 1e24 mass', test: massAtLeast('1e24') },

  // --- the chain ----------------------------------------------------------------------
  {
    id: 'helium',
    name: 'Ash',
    how: 'Fuse hydrogen into helium',
    test: (c) => c.elementTier >= 1,
  },
  {
    id: 'carbon',
    name: 'Organic Chemistry, Eventually',
    how: 'Reach carbon',
    test: (c) => c.elementTier >= 2,
  },
  {
    id: 'oxygen',
    name: 'Breathable, In Principle',
    how: 'Reach oxygen',
    test: (c) => c.elementTier >= 3,
  },
  {
    id: 'silicon',
    name: 'The Last Rung',
    how: 'Reach silicon, the end of what any throughput can hold',
    test: (c) => c.elementTier >= 4,
  },

  // --- the disk -----------------------------------------------------------------------
  {
    id: 'firstEnergy',
    name: 'Something Shining',
    how: 'Shed your first energy from the disk',
    test: (c) => c.state.totalEnergyEver.gt(0),
  },
  {
    id: 'disk10',
    name: 'Spun Up',
    how: 'Accretion Disk to level 10',
    test: levelAtLeast('disk', 10),
  },
  {
    id: 'confinement10',
    name: 'Held Together',
    how: 'Magnetic Confinement to level 10',
    test: levelAtLeast('confinement', 10),
  },
  {
    id: 'magnetic10',
    name: 'Along The Field',
    how: 'Field Lines to level 10',
    test: levelAtLeast('magnetic', 10),
  },

  // --- depth --------------------------------------------------------------------------
  {
    id: 'gravity100',
    name: 'Deep',
    how: 'Gravity Well to level 100',
    test: levelAtLeast('gravity', 100),
  },
  {
    id: 'radius100',
    name: 'Wide',
    how: 'Capture Radius to level 100',
    test: levelAtLeast('radius', 100),
  },
  {
    id: 'density50',
    name: 'Thicker Still',
    how: 'Particle Density to level 50 within a single stage',
    test: levelAtLeast('density', 50),
  },
  {
    id: 'density300',
    name: 'Again And Again',
    how: 'Buy 300 levels of Particle Density in total, across as many stages as it takes',
    test: investedAtLeast('density', 300),
  },
  {
    id: 'particleMass100',
    name: 'Heavy Going',
    how: 'Particle Mass to level 100',
    test: levelAtLeast('particleMass', 100),
  },
  {
    id: 'efficiency25',
    name: 'Nothing Wasted',
    how: 'Accretion Efficiency to level 25',
    test: levelAtLeast('efficiency', 25),
  },

  // --- how you play -------------------------------------------------------------------
  {
    id: 'someHelp',
    name: 'Some Help',
    how: 'Have three auto-buyers running at once',
    test: (c) => c.autoBuyersOn >= 3,
  },
  {
    id: 'reserved',
    name: 'Saving Up',
    how: 'Hold back half your mass from the auto-buyers',
    test: (c) => c.state.settings.autoBuyReserve >= 0.5,
  },
  {
    id: 'pulse5000',
    name: 'It Is A Button, Technically',
    how: 'Fire 5,000 Gravity Pulses',
    test: (c) => c.state.stats.pulses >= 5000,
  },
  {
    id: 'sixHours',
    name: 'An Afternoon',
    how: 'Play for six hours',
    test: (c) => c.state.playTime >= 6 * 3600,
  },
  {
    id: 'aDay',
    name: 'A Day',
    how: 'Play for twenty-four hours',
    test: (c) => c.state.playTime >= 24 * 3600,
  },

  // --- the supernova ------------------------------------------------------------------
  {
    id: 'firstCollapse',
    name: 'We Are Made Of This',
    how: 'Collapse a star for the first time',
    test: (c) => c.state.collapses >= 1,
  },
  {
    id: 'collapse3',
    name: 'Second Generation',
    how: 'Collapse three times',
    test: (c) => c.state.collapses >= 3,
  },
  {
    id: 'collapse10',
    name: 'Population I',
    how: 'Collapse ten times',
    test: (c) => c.state.collapses >= 10,
  },
  {
    id: 'stardust100',
    name: 'A Pinch',
    how: 'Earn 100 stardust in total',
    test: (c) => c.state.stardustEver.gte(100),
  },
  {
    id: 'stardust1e5',
    name: 'A Handful Of Nebula',
    how: 'Earn 100,000 stardust in total',
    test: (c) => c.state.stardustEver.gte(1e5),
  },
  {
    id: 'oneMaxed',
    name: 'Finished With That One',
    how: 'Take a stardust upgrade as far as it goes',
    test: (c) => STARDUST_LIST.some((def) => c.state.stardustLevels[def.id] >= def.maxLevel),
  },
  {
    id: 'allMaxed',
    name: 'Everything It Had',
    how: 'Take every capped stardust upgrade as far as it goes',
    test: (c) =>
      STARDUST_LIST.filter((def) => def.maxLevel <= 10).every(
        (def) => c.state.stardustLevels[def.id] >= def.maxLevel,
      ),
  },
];

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

export function multiplierFor(unlockedCount: number): number {
  return Math.pow(1 + ACHIEVEMENT_BONUS, unlockedCount);
}
