import type { GameState } from './state';
import { UPGRADE_IDS } from './upgrades';

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
];

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

export function multiplierFor(unlockedCount: number): number {
  return Math.pow(1 + ACHIEVEMENT_BONUS, unlockedCount);
}
