import { D, type Num } from './numbers';
import { tick } from './economy';
import type { GameState } from './state';

/**
 * Offline progress.
 *
 * The rate is currently constant between purchases, so this could be one multiply. It is a
 * loop anyway: once auto-buyers land in Phase 2 the rate changes *during* the gap, and a
 * loop that was always here stays correct for free.
 *
 * A fixed step count means a two-week absence costs the same as a two-minute one.
 */

/** Credit at most this much of an absence. */
export const MAX_OFFLINE_SECONDS = 12 * 3600;
/** However long the gap, resolve it in at most this many steps. */
const MAX_STEPS = 1000;
/** Ignore absences shorter than this; there is nothing to report. */
const MIN_REPORTABLE_SECONDS = 5;

export interface AwayReport {
  /** Seconds actually elapsed on the wall clock. */
  awaySeconds: number;
  /** Seconds credited, after the cap. */
  creditedSeconds: number;
  capped: boolean;
  gained: Num;
}

/**
 * Advance `s` to account for time passed since `s.lastSeen`, and stamp the new time.
 * Returns null when the gap was too short to be worth showing the player.
 */
export function applyOffline(s: GameState, now = Date.now()): AwayReport | null {
  // The wall clock can go backwards — system clock changes, NTP, a laptop waking up
  // confused. Clamp and move on; this is single-player.
  const awaySeconds = Math.max(0, (now - s.lastSeen) / 1000);
  s.lastSeen = now;

  if (awaySeconds <= 0) return null;

  const creditedSeconds = Math.min(awaySeconds, MAX_OFFLINE_SECONDS);
  const before = D(s.totalMassEver);

  const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(creditedSeconds)));
  const dt = creditedSeconds / steps;
  for (let i = 0; i < steps; i++) tick(s, dt);

  if (awaySeconds < MIN_REPORTABLE_SECONDS) return null;

  return {
    awaySeconds,
    creditedSeconds,
    capped: awaySeconds > MAX_OFFLINE_SECONDS,
    gained: s.totalMassEver.sub(before),
  };
}
