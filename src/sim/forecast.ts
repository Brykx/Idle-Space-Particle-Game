import { buy, canAfford, deriveRates, isOpen, isRunning, tick, unlockedUpgrades } from './economy';
import { cloneState, type GameState } from './state';
import { stageIndexFor } from './stages';
import type { Cloud } from './clouds';

/**
 * How long a star will take, said the way a person would say it.
 *
 * The caption says *within the hour* rather than *47:12*, on purpose: a countdown is a clock
 * to watch, and the game is trying not to have one. But a word still has to be true, and the
 * only honest way to know how long a run takes — through promotions, fusion tiers, the
 * automation's purchases and the cloud thinning at the end — is to run it. So this runs it,
 * on a copy, in coarse steps.
 */

/** Most steps a forecast will take before it calls the answer "a long time". */
const MAX_STEPS = 6000;

/**
 * Steps per tenfold of growth. Coarse steps under-pay, so a forecast runs a little long —
 * by a few percent at this setting, which no word below is sensitive to.
 */
const STEPS_PER_TENFOLD = 40;

/** The longest a forecast will look ahead. */
const HORIZON_SECONDS = 30 * 86400;

export interface Forecast {
  /** Seconds until the next promotion, or null if this cloud has none left to give. */
  nextStage: number | null;
  /** Seconds until the cloud is spent and the star finished. Infinity past the horizon. */
  finished: number;
}

/** Seconds until the star in `s` is finished, or Infinity past the horizon. */
export function forecastRemaining(s: GameState): number {
  return forecastRun(s).finished;
}

/** When the next promotion lands and when the star is finished, from one simulation. */
export function forecastRun(s: GameState): Forecast {
  if (!isRunning(s)) return { nextStage: null, finished: 0 };
  const copy = cloneState(s);
  const started = copy.playTime;
  const stageAtStart = stageIndexFor(copy.totalMassEver);
  let nextStage: number | null = null;

  for (let i = 0; i < MAX_STEPS && isRunning(copy); i++) {
    // A forecast assumes what the game assumes: a current is begun when it can be. The first
    // star is the only one where any are still closed.
    for (const def of unlockedUpgrades(copy)) {
      if (!isOpen(copy, def.id) && canAfford(copy, def.id)) buy(copy, def.id, 1);
    }
    const rates = deriveRates(copy);
    const tenfold =
      rates.massPerSecond.gt(0) && copy.totalMassEver.gt(0)
        ? (Math.LN10 * copy.totalMassEver.div(rates.massPerSecond).toNumber())
        : 0;
    const dt = Math.min(3600, Math.max(0.5, tenfold / STEPS_PER_TENFOLD));
    tick(copy, dt);
    if (nextStage === null && stageIndexFor(copy.totalMassEver) > stageAtStart) nextStage = copy.playTime - started;
    if (copy.playTime - started > HORIZON_SECONDS) return { nextStage, finished: Infinity };
  }

  return { nextStage, finished: isRunning(copy) ? Infinity : copy.playTime - started };
}

/** Seconds a whole star would take from this cloud, starting from where `s` stands now. */
export function forecastCloud(s: GameState, cloud: Cloud): number {
  const copy = cloneState(s);
  copy.cloud = { ...cloud };
  copy.runStartedAt = copy.playTime;
  return forecastRemaining(copy);
}

/**
 * A duration as a phrase that finishes "it will be done…". Coarse on purpose, and in the
 * order of a day: these are the answers to "when should I look in again?", not to "how long
 * exactly?".
 */
export function roughly(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'in a long while';
  if (seconds < 90) return 'in moments';
  if (seconds < 15 * 60) return 'in a few minutes';
  if (seconds < 60 * 60) return 'within the hour';
  if (seconds < 4 * 3600) return 'in a few hours';
  if (seconds < 14 * 3600) return 'overnight';
  if (seconds < 2 * 86400) return 'in a day or so';
  return 'over days';
}
