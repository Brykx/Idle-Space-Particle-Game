import { D, type Num } from './numbers';
import { currentsFlowing, tick } from './economy';
import { stageIndexFor } from './stages';
import type { GameState } from './state';

/**
 * Offline progress.
 *
 * Automation changed what this loop is for. Without it the rate is constant across a gap and
 * any step size gives the same answer; with it the rate changes *during* the gap, because
 * income buys upgrades which raise income. That feedback makes the step size an accuracy
 * question, and coarse steps systematically under-pay: a step earns at the rate it started
 * with and only then spends, so the longer the step the more compounding is lost.
 *
 * Measured, the shortfall is about 0.04 orders of magnitude per second of step size over an
 * hour. That sounds worse than it is. Mass is exponential in time, so even a fiftyfold
 * shortfall is about seven minutes of play — an absence that comes back a few minutes behind
 * where presence would have been, not one that was robbed.
 */

/**
 * How far back an absence is credited. A month.
 *
 * It was twelve hours, with an achievement for reaching it, and a cap you can hit is an edge
 * on being away: come back in time or lose the rest. There is no design reason for that edge
 * — the cap existed to bound the work on load — so the work is bounded a different way and
 * the horizon is set past anything a player would experience as a limit.
 */
export const OFFLINE_HORIZON_SECONDS = 30 * 24 * 3600;

/**
 * The finest step, and the most steps, a catch-up will take.
 *
 * Half a second is fine enough that a day away lands within a few minutes of where presence
 * would have. Beyond a little over a day the step stretches instead of the count growing, so
 * the longest absence costs the same couple of seconds on load as a long weekend. The price
 * is a larger shortfall on very long gaps, which by the argument above is a matter of being
 * some minutes behind after a month away.
 */
const FINEST_STEP_SECONDS = 0.5;
const MAX_STEPS = 200_000;

/** With nothing flowing the rate only moves at an unlock, so a coarse step is exact enough. */
const STEP_SECONDS_HELD = 60;

/** Ignore absences shorter than this; there is nothing to report. */
const MIN_REPORTABLE_SECONDS = 5;

export interface AwayReport {
  /** Seconds actually elapsed on the wall clock. */
  awaySeconds: number;
  /** Seconds credited. Differs from `awaySeconds` only past the month-long horizon. */
  creditedSeconds: number;
  gained: Num;
  /** Ladder stage when you left, and when you came back. */
  stageBefore: number;
  stageAfter: number;
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

  const creditedSeconds = Math.min(awaySeconds, OFFLINE_HORIZON_SECONDS);
  const before = D(s.totalMassEver);
  const stageBefore = stageIndexFor(s.totalMassEver);

  // Recorded before the catch-up, not after: achievements are awarded inside `tick`, so a
  // stat written afterwards would not be seen until the next one.
  s.stats.longestAway = Math.max(s.stats.longestAway, awaySeconds);

  const finest = currentsFlowing(s) > 0 ? FINEST_STEP_SECONDS : STEP_SECONDS_HELD;
  const steps = Math.max(1, Math.min(MAX_STEPS, Math.ceil(creditedSeconds / finest)));
  const dt = creditedSeconds / steps;
  for (let i = 0; i < steps; i++) tick(s, dt);

  if (awaySeconds < MIN_REPORTABLE_SECONDS) return null;

  return {
    awaySeconds,
    creditedSeconds,
    gained: s.totalMassEver.sub(before),
    stageBefore,
    stageAfter: stageIndexFor(s.totalMassEver),
  };
}
