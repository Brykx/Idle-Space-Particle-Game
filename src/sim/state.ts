import { D, type Notation, type Num } from './numbers';
import { UPGRADE_IDS, type UpgradeId } from './upgrades';
import { STARDUST_IDS, type StardustId } from './prestige';

export const SAVE_VERSION = 3;

export interface Settings {
  notation: Notation;
  /** Maximum live particles. A graphics setting only — it cannot change income. */
  particleBudget: number;
  reducedMotion: boolean;
  /**
   * Fraction of your mass auto-buyers will not touch, so you can save towards something by
   * hand while automation handles the cheap end. 0 means they spend freely.
   */
  autoBuyReserve: number;
}

export interface Stats {
  /** Wall-clock ms when this save was first created. */
  startedAt: number;
  pulses: number;
  purchases: number;
  /** Longest single absence, in seconds. Achievements read it; nothing else does. */
  longestAway: number;
  exports: number;
}

export interface GameState {
  version: number;
  mass: Num;
  /** Never decreases. Drives unlocks, and later the prestige formula. */
  totalMassEver: Num;
  /** Capital for the energy-side upgrades. Spending it never costs you an element tier. */
  energy: Num;
  totalEnergyEver: Num;
  levels: Record<UpgradeId, number>;
  /**
   * Levels ever bought, per upgrade. Never decreases, not even at a promotion.
   *
   * `levels` is what the economy reads; this is what *investment* reads. They were the same
   * number until Density started resetting, at which point deriving the auto-buy unlock from
   * the current level began confiscating an auto-buyer the player had already earned, once
   * per promotion. Splitting them keeps one rule for every upgrade instead of an exception
   * for the rebased ones.
   */
  levelsEver: Record<UpgradeId, number>;
  /** Seconds of simulated time. The sim's only clock — no wall clock in here. */
  playTime: number;
  /** `playTime` at which Gravity Pulse becomes available again. */
  pulseReadyAt: number;
  /** Highest stage the player has been told about, so each one announces itself once. */
  stageSeen: number;
  /**
   * The ladder stage the rebased upgrade levels belong to.
   *
   * Distinct from `stageSeen`, which is a UI acknowledgement. This one is a simulation fact:
   * it records that the reset has already happened for that stage, so a promotion cannot be
   * applied twice and cannot be missed across a reload.
   */
  rebasedStage: number;
  /** Which upgrades buy themselves. Unlocking is derived from level, so it is not stored. */
  autoBuy: Record<UpgradeId, boolean>;
  /** Ids of unlocked achievements. Survive a collapse; they record what you did. */
  achievements: string[];

  // --- what survives a supernova -------------------------------------------------------
  /** Unspent Stardust. A Decimal: it goes as mass^0.6, and mass has no ceiling. */
  stardust: Num;
  /** Ever earned. Drives achievements and the "how far have you come" readouts. */
  stardustEver: Num;
  /** How many supernovae you have set off. */
  collapses: number;
  stardustLevels: Record<StardustId, number>;
  /** Wall-clock ms at the last save. The one bridge to real time, used for offline catch-up. */
  lastSeen: number;
  settings: Settings;
  stats: Stats;
}

export const PULSE_COOLDOWN = 10;

export function initialState(now = Date.now()): GameState {
  const levels = {} as Record<UpgradeId, number>;
  const levelsEver = {} as Record<UpgradeId, number>;
  const autoBuy = {} as Record<UpgradeId, boolean>;
  const stardustLevels = {} as Record<StardustId, number>;
  for (const id of STARDUST_IDS) stardustLevels[id] = 0;
  for (const id of UPGRADE_IDS) {
    levels[id] = 0;
    levelsEver[id] = 0;
    autoBuy[id] = false;
  }

  return {
    version: SAVE_VERSION,
    mass: D(0),
    totalMassEver: D(0),
    energy: D(0),
    totalEnergyEver: D(0),
    levels,
    levelsEver,
    playTime: 0,
    pulseReadyAt: 0,
    stageSeen: 0,
    rebasedStage: 0,
    autoBuy,
    achievements: [],
    stardust: D(0),
    stardustEver: D(0),
    collapses: 0,
    stardustLevels,
    lastSeen: now,
    settings: {
      notation: 'letters',
      particleBudget: 1200,
      reducedMotion: false,
      autoBuyReserve: 0,
    },
    stats: {
      startedAt: now,
      pulses: 0,
      purchases: 0,
      longestAway: 0,
      exports: 0,
    },
  };
}

/** Deep-ish clone. `Num` values are treated as immutable, because every operation returns a new one. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    mass: D(s.mass),
    totalMassEver: D(s.totalMassEver),
    energy: D(s.energy),
    totalEnergyEver: D(s.totalEnergyEver),
    levels: { ...s.levels },
    autoBuy: { ...s.autoBuy },
    achievements: [...s.achievements],
    settings: { ...s.settings },
    stats: { ...s.stats },
  };
}
