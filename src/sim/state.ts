import { D, type Notation, type Num } from './numbers';
import { UPGRADE_IDS, type UpgradeId } from './upgrades';

export const SAVE_VERSION = 1;

export interface Settings {
  notation: Notation;
  /** Maximum live particles. A graphics setting only — it cannot change income. */
  particleBudget: number;
  reducedMotion: boolean;
}

export interface Stats {
  /** Wall-clock ms when this save was first created. */
  startedAt: number;
  pulses: number;
  purchases: number;
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
  /** Wall-clock ms at the last save. The one bridge to real time, used for offline catch-up. */
  lastSeen: number;
  settings: Settings;
  stats: Stats;
}

export const PULSE_COOLDOWN = 10;

export function initialState(now = Date.now()): GameState {
  const levels = {} as Record<UpgradeId, number>;
  for (const id of UPGRADE_IDS) levels[id] = 0;

  return {
    version: SAVE_VERSION,
    mass: D(0),
    totalMassEver: D(0),
    levels,
    playTime: 0,
    pulseReadyAt: 0,
    stageSeen: 0,
    lastSeen: now,
    settings: {
      notation: 'letters',
      particleBudget: 1200,
      reducedMotion: false,
    },
    stats: {
      startedAt: now,
      pulses: 0,
      purchases: 0,
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
    settings: { ...s.settings },
    stats: { ...s.stats },
  };
}
