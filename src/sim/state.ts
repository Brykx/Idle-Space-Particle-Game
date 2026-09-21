import { D, type Notation, type Num } from './numbers';
import { UPGRADE_IDS, type UpgradeId } from './upgrades';

export const SAVE_VERSION = 1;

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
  levels: Record<UpgradeId, number>;
  /** Seconds of simulated time. The sim's only clock — no wall clock in here. */
  playTime: number;
  /** `playTime` at which Gravity Pulse becomes available again. */
  pulseReadyAt: number;
  /** Highest stage the player has been told about, so each one announces itself once. */
  stageSeen: number;
  /** Which upgrades buy themselves. Unlocking is derived from level, so it is not stored. */
  autoBuy: Record<UpgradeId, boolean>;
  /** Ids of unlocked achievements. */
  achievements: string[];
  /** Wall-clock ms at the last save. The one bridge to real time, used for offline catch-up. */
  lastSeen: number;
  settings: Settings;
  stats: Stats;
}

export const PULSE_COOLDOWN = 10;

export function initialState(now = Date.now()): GameState {
  const levels = {} as Record<UpgradeId, number>;
  const autoBuy = {} as Record<UpgradeId, boolean>;
  for (const id of UPGRADE_IDS) {
    levels[id] = 0;
    autoBuy[id] = false;
  }

  return {
    version: SAVE_VERSION,
    mass: D(0),
    totalMassEver: D(0),
    levels,
    playTime: 0,
    pulseReadyAt: 0,
    stageSeen: 0,
    autoBuy,
    achievements: [],
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
    levels: { ...s.levels },
    autoBuy: { ...s.autoBuy },
    achievements: [...s.achievements],
    settings: { ...s.settings },
    stats: { ...s.stats },
  };
}
