import { D, type Num } from './numbers';
import { autoBuyersOn, tick } from './economy';
import { stardustEffects } from './prestige';
import type { GameState } from './state';

/**
 * Offline progress.
 *
 * Auto-buyers changed what this loop is for. Before them the rate was constant across a gap
 * and any step size gave the same answer; now the rate changes *during* the gap, because
 * income buys upgrades which raise income. That feedback makes the step size an accuracy
 * question, and coarse steps systematically under-pay: a step earns at the rate it started
 * with and only then spends, so the longer the step the more compounding is lost.
 *
 * Measured, the shortfall is about 0.04 orders of magnitude per second of step size over an
 * hour. A thousand steps regardless of gap length — the obvious way to bound the work — put
 * a 12-hour absence on 43-second steps and quietly paid it fifty times less than being
 * present would have. So the step size is capped instead of the step count, and the work is
 * bounded by the offline cap below rather than by throwing away accuracy.
 */

/** Credit at most this much of an absence. */
export const MAX_OFFLINE_SECONDS = 12 * 3600;

/**
 * Step size, chosen by whether automation is running.
 *
 * With no auto-buyers the rate only moves when an achievement unlocks, which is a rare
 * discrete jump, so a coarse step is both exact enough and nearly free. With auto-buyers the
 * rate compounds continuously and the step size sets the error directly: measured over 12
 * hours, 2-second steps lose about 0.45 orders of magnitude and half-second steps about 0.1.
 *
 * Half a second costs roughly a quarter of a second of catch-up at the 12-hour cap, once, on
 * load. The residual is a small under-payment for being away rather than present — bounded,
 * deliberate, and the thing Phase 3's offline-efficiency upgrade is there to buy back.
 */
const STEP_SECONDS_IDLE = 60;
const STEP_SECONDS_AUTOMATED = 0.5;
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

  // Recorded before the catch-up, not after: achievements are awarded inside `tick`, so a
  // stat written afterwards would not be seen until the next one.
  s.stats.longestAway = Math.max(s.stats.longestAway, awaySeconds);

  // Deep Slumber buys back the coarse-step shortfall by simulating more seconds than passed.
  // It is capped at restoring parity and no further, on purpose: an absence that pays better
  // than being present turns the best strategy into closing the tab, which is not a thing to
  // sell a player as an upgrade.
  const simulated = creditedSeconds * stardustEffects(s).offlineRate;

  const stepSeconds = autoBuyersOn(s) > 0 ? STEP_SECONDS_AUTOMATED : STEP_SECONDS_IDLE;
  const steps = Math.max(1, Math.ceil(simulated / stepSeconds));
  const dt = simulated / steps;
  for (let i = 0; i < steps; i++) tick(s, dt);

  if (awaySeconds < MIN_REPORTABLE_SECONDS) return null;

  return {
    awaySeconds,
    creditedSeconds,
    capped: awaySeconds > MAX_OFFLINE_SECONDS,
    gained: s.totalMassEver.sub(before),
  };
}
