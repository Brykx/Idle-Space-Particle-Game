import { format, formatDuration } from '../src/sim/numbers';
import { buy, deriveRates, nextCost, pulse, pulseReady, tick, unlockedUpgrades } from '../src/sim/economy';
import { initialState, type GameState } from '../src/sim/state';
import type { UpgradeId } from '../src/sim/upgrades';
import { ACCRETION_STAGES } from '../src/sim/stages';

/**
 * Headless pacing sim.
 *
 * Plays the game with a greedy buy-the-cheapest-thing policy — a decent proxy for how a new
 * player actually spends — and reports time to each milestone. `tests/balance.test.ts`
 * asserts these inside generous bounds, so a tuning change that quietly doubles the first
 * hour fails CI instead of shipping.
 */

/**
 * The stage ladder is the milestone list — one source of truth, so a threshold moved in
 * `sim/stages.ts` shows up here without anything else changing. Dust is skipped: it is where
 * you start.
 */
const MILESTONES = ACCRETION_STAGES.slice(1);

export interface PacingResult {
  id: string;
  label: string;
  seconds: number;
  levels: Record<string, number>;
}

/**
 * How the first hour feels, in two numbers.
 *
 * Counting purchases turned out to measure the bot's policy rather than the design: an agent
 * that buys the instant it can afford anything always buys one level at a time. What actually
 * decides whether an idle game feels alive is how fast income moves and how much a single
 * purchase is worth, so those are what get measured and asserted.
 */
export interface Feel {
  purchases: number;
  /** Median seconds for income to double. Under ~2 min the number visibly climbs. */
  doublingTime: number;
  /** Median income increase from one purchase, as a fraction. Under ~1% feels like nothing. */
  gainPerPurchase: number;
  /** Longest stretch with nothing affordable. */
  worstGap: number;
}

/** log10(total mass) sampled on a fixed cadence — the shape of the curve, in one line. */
export interface ShapeSample {
  minutes: number;
  log10: number;
}

export interface PacingRun {
  milestones: PacingResult[];
  /** The first hour, where a new player decides whether to stay. */
  firstHour: Feel;
  shape: ShapeSample[];
}

export interface PacingOptions {
  /** Simulated seconds to give up after. */
  limitSeconds?: number;
  /** Simulation step. Smaller is more accurate and slower. */
  step?: number;
  /** Whether the imaginary player clicks Gravity Pulse whenever it is up. */
  clicks?: boolean;
  policy?: Policy;
}

export type Policy = 'cheapest' | 'payback';

/**
 * Seconds for an upgrade to pay for itself at the income it unlocks.
 *
 * A far better model of how people actually play than buy-the-cheapest, which pours
 * everything into the opening upgrades and never reaches the ones that carry the late game.
 */
function paybackSeconds(s: GameState, id: UpgradeId): number {
  const before = deriveRates(s).massPerSecond;
  const probe: GameState = { ...s, levels: { ...s.levels, [id]: s.levels[id] + 1 } };
  const gain = deriveRates(probe).massPerSecond.sub(before);
  if (gain.lte(0)) return Infinity;
  return nextCost(s, id).div(gain).toNumber();
}

/**
 * Spend down to nothing worth buying, under the given policy.
 *
 * Buys *max* of the chosen upgrade, because that is the button real players press. Returns
 * the number of decisions made, which is what the "a purchase every 15-60s" design target is
 * really about — not the level count.
 */
function spend(s: GameState, policy: Policy): number {
  let decisions = 0;
  for (;;) {
    const affordable = unlockedUpgrades(s)
      .map((def) => ({ id: def.id, cost: nextCost(s, def.id) }))
      .filter((o) => o.cost.lte(s.mass));

    if (affordable.length === 0) return decisions;

    const scored = affordable.map((o) => ({
      id: o.id,
      score: policy === 'cheapest' ? o.cost.toNumber() : paybackSeconds(s, o.id),
    }));
    scored.sort((a, b) => a.score - b.score);

    const best = scored[0];
    if (!best || !Number.isFinite(best.score)) return decisions;
    if (buy(s, best.id, 'max') === 0) return decisions;
    decisions += 1;
  }
}

export function runPacing(options: PacingOptions = {}): PacingRun {
  const { limitSeconds = 24 * 3600, step = 0.1, clicks = true, policy = 'payback' } = options;

  const s = initialState(0);
  const results: PacingResult[] = [];
  let next = 0;

  const decisionTimes: number[] = [];
  const shape: ShapeSample[] = [];
  let shapeAt = 0;
  const gains: number[] = [];
  /** (playTime, log2 of income) samples, for the doubling-time estimate. */
  const incomeLog: Array<[number, number]> = [];
  let sampleAt = 0;

  while (s.playTime < limitSeconds && next < MILESTONES.length) {
    tick(s, step);
    if (clicks && pulseReady(s)) pulse(s);
    const incomeBefore = deriveRates(s).massPerSecond;
    const decisions = spend(s, policy);
    if (decisions > 0) {
      for (let i = 0; i < decisions; i++) decisionTimes.push(s.playTime);
      const after = deriveRates(s).massPerSecond;
      gains.push(after.div(incomeBefore).toNumber() - 1);
    }

    if (s.playTime >= shapeAt) {
      shape.push({
        minutes: s.playTime / 60,
        log10: s.totalMassEver.lte(1) ? 0 : s.totalMassEver.log10(),
      });
      shapeAt = s.playTime + 300;
    }

    if (s.playTime >= sampleAt) {
      const mps = deriveRates(s).massPerSecond;
      if (mps.gt(0)) incomeLog.push([s.playTime, mps.log10() / Math.log10(2)]);
      sampleAt = s.playTime + 10;
    }

    const milestone = MILESTONES[next];
    if (milestone?.threshold && s.totalMassEver.gte(milestone.threshold)) {
      results.push({
        id: milestone.id,
        label: milestone.name,
        seconds: s.playTime,
        levels: { ...s.levels },
      });
      next += 1;
    }
  }

  // Anything not reached inside the limit is reported as such rather than silently omitted.
  for (; next < MILESTONES.length; next++) {
    const milestone = MILESTONES[next];
    if (milestone) {
      results.push({ id: milestone.id, label: milestone.name, seconds: Infinity, levels: { ...s.levels } });
    }
  }

  return { milestones: results, firstHour: feel(decisionTimes, gains, incomeLog, 3600), shape };
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
}

function feel(
  times: number[],
  gains: number[],
  incomeLog: Array<[number, number]>,
  windowSeconds: number,
): Feel {
  const within = times.filter((t) => t <= windowSeconds);

  const gaps: number[] = [];
  let previous = 0;
  for (const t of within) {
    gaps.push(t - previous);
    previous = t;
  }

  // Seconds per doubling across the whole window.
  //
  // Not a median of per-interval rates: income only moves when something is bought, so most
  // intervals gain nothing and the ones that gain a sliver report an enormous seconds-per-
  // doubling. The median of that measures the sampling cadence, not the game.
  const samples = incomeLog.filter(([t]) => t <= windowSeconds);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const doublingTime =
    first && last && last[1] > first[1] ? (last[0] - first[0]) / (last[1] - first[1]) : Infinity;

  return {
    purchases: within.length,
    doublingTime,
    gainPerPurchase: median(gains.slice(0, within.length)),
    worstGap: gaps.length ? Math.max(...gaps) : Infinity,
  };
}

function main(): void {
  const run = runPacing();
  const s = initialState(0);

  console.log('\n  time to stage (payback-optimal play, pulse on cooldown)\n');
  for (const r of run.milestones) {
    const threshold = ACCRETION_STAGES.find((s) => s.id === r.id)?.threshold;
    const at = threshold ? format(threshold, 'scientific').padStart(10) : '';
    console.log(`  ${r.label.padEnd(14)} ${at}  ${formatDuration(r.seconds).padStart(9)}`);
  }

  console.log('\n  curve shape — log10(mass) every 5 minutes\n');
  console.log(
    '  ' +
      run.shape
        .map((s) => `${s.minutes.toFixed(0)}m:${s.log10.toFixed(1)}`)
        .join('  '),
  );

  const { purchases, doublingTime, gainPerPurchase, worstGap } = run.firstHour;
  console.log(
    `\n  first hour: ${purchases} purchases` +
      `   income doubles every ${doublingTime.toFixed(0)}s   (target 45-150s)` +
      `\n              +${(gainPerPurchase * 100).toFixed(1)}% per purchase   (target 1-15%)` +
      `   longest wait ${formatDuration(worstGap)}`,
  );

  const rates = deriveRates(s);
  console.log(
    `\n  opening rate ${format(rates.massPerSecond, 'letters')}/s` +
      `   first upgrade costs 10   first pulse pays ${format(rates.pulseYield, 'letters')}\n`,
  );
}

// Run only when invoked directly, so the test can import `runPacing` quietly.
if (process.argv[1] && process.argv[1].endsWith('balance.ts')) main();
