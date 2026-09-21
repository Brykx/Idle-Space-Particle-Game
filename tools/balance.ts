import { D, format, formatDuration, type Num } from '../src/sim/numbers';
import { buy, deriveRates, nextCost, pulse, pulseReady, tick, unlockedUpgrades } from '../src/sim/economy';
import { initialState, type GameState } from '../src/sim/state';
import type { UpgradeId } from '../src/sim/upgrades';

/**
 * Headless pacing sim.
 *
 * Plays the game with a greedy buy-the-cheapest-thing policy — a decent proxy for how a new
 * player actually spends — and reports time to each milestone. `tests/balance.test.ts`
 * asserts these inside generous bounds, so a tuning change that quietly doubles the first
 * hour fails CI instead of shipping.
 */

export const MILESTONES: Array<{ label: string; at: Num }> = [
  { label: '1e3  mass', at: D('1e3') },
  { label: '1e6  mass', at: D('1e6') },
  { label: '1e9  mass', at: D('1e9') },
  { label: '1e12 mass  (ignition)', at: D('1e12') },
];

export interface PacingResult {
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

export interface PacingRun {
  milestones: PacingResult[];
  /** The first hour, where a new player decides whether to stay. */
  firstHour: Feel;
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

    if (s.playTime >= sampleAt) {
      const mps = deriveRates(s).massPerSecond;
      if (mps.gt(0)) incomeLog.push([s.playTime, mps.log10() / Math.log10(2)]);
      sampleAt = s.playTime + 10;
    }

    const milestone = MILESTONES[next];
    if (milestone && s.totalMassEver.gte(milestone.at)) {
      results.push({ label: milestone.label, seconds: s.playTime, levels: { ...s.levels } });
      next += 1;
    }
  }

  // Anything not reached inside the limit is reported as such rather than silently omitted.
  for (; next < MILESTONES.length; next++) {
    const milestone = MILESTONES[next];
    if (milestone) results.push({ label: milestone.label, seconds: Infinity, levels: { ...s.levels } });
  }

  return { milestones: results, firstHour: feel(decisionTimes, gains, incomeLog, 3600) };
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

  // Seconds per doubling, between consecutive samples where income actually moved.
  const doublings: number[] = [];
  const samples = incomeLog.filter(([t]) => t <= windowSeconds);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const grew = b[1] - a[1];
    if (grew > 1e-9) doublings.push((b[0] - a[0]) / grew);
  }

  return {
    purchases: within.length,
    doublingTime: median(doublings),
    gainPerPurchase: median(gains.slice(0, within.length)),
    worstGap: gaps.length ? Math.max(...gaps) : Infinity,
  };
}

function main(): void {
  const run = runPacing();
  const s = initialState(0);

  console.log('\n  time to milestone (payback-optimal play, pulse on cooldown)\n');
  for (const r of run.milestones) {
    const levels = Object.entries(r.levels)
      .map(([id, n]) => `${id} ${n}`)
      .join('  ');
    console.log(`  ${r.label.padEnd(22)} ${formatDuration(r.seconds).padStart(9)}    ${levels}`);
  }

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
