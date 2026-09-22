import { D, format, formatDuration, type Num } from '../src/sim/numbers';
import { buy, canAfford, deriveRates, nextCost, pulse, pulseReady, tick, unlockedUpgrades } from '../src/sim/economy';
import { initialState, type GameState } from '../src/sim/state';
import { UPGRADES, type UpgradeId } from '../src/sim/upgrades';
import { ACCRETION_STAGES } from '../src/sim/stages';
import {
  STARDUST_LIST,
  buyStardust,
  collapse,
  stardustCost,
  stardustFor,
} from '../src/sim/prestige';
import { REACHABLE_ELEMENTS } from '../src/sim/elements';

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
  /**
   * Median income increase from one purchase, as a fraction. Under ~1% feels like nothing.
   *
   * Only a floor is asserted. There used to be an upper bound of 15% on the reasoning that
   * enormous purchases mean too few of them, but purchase count is measured separately and
   * says that directly. Since the payback ceiling went in, every decision the bot makes is
   * one worth making, and the median sits at one Particle Density level — 16.5%. Failing the
   * run for that would be penalising the thing the tuning was trying to achieve.
   */
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
  /** The state the run finished in, so a collapse can be measured from it. */
  state: GameState;
  milestones: PacingResult[];
  /** The first hour, where a new player decides whether to stay. */
  firstHour: Feel;
  shape: ShapeSample[];
  elements: Array<{ name: string; seconds: number }>;
}

export interface PacingOptions {
  /** Simulated seconds to give up after. */
  limitSeconds?: number;
  /** Simulation step. Smaller is more accurate and slower. */
  step?: number;
  /** Whether the imaginary player clicks Gravity Pulse whenever it is up. */
  clicks?: boolean;
  policy?: Policy;
  /** Start from this state instead of a fresh one. Used to measure a run after a collapse. */
  from?: GameState;
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
 * Upgrades a player buys on sight rather than by payback.
 *
 * The energy-economy upgrades have step-shaped value: a disk level is worth nothing at all
 * until it tips the core over a fusion threshold, at which point it is worth a great deal.
 * Payback cannot see that, so the bot would never buy one — but a player, looking at a bar
 * telling them how far off the next element is, obviously would. Modelling them as bought
 * when affordable is the honest proxy.
 */
const BUY_ON_SIGHT = new Set(['energy', 'requirement']);

/**
 * Payback beyond which the bot stops buying something. An hour of current income.
 *
 * Capture saturates towards 1 without ever reaching it, so Gravity Well and Capture Radius
 * keep a positive gain forever — vanishingly small, but never zero, and therefore never
 * `Infinity` payback. Without a ceiling the bot sinks over half its decisions into them at a
 * measured 0.0% income gain each, because once everything else is expensive they are still
 * technically the best finite score.
 *
 * No player does that. The per-upgrade toggles exist precisely so a human can stop buying a
 * card reading "+0.0% income", and a bot with no such rule is not modelling a player, it is
 * modelling someone who cannot read their own screen.
 *
 * This was added after a measurement came back worse than expected, which is the moment to
 * be most suspicious of changing the instrument. The defence is that the rule is stated in
 * the player's terms rather than tuned to a target: an upgrade that will not repay itself
 * within an hour of playing is one you buy something else instead of. The consequences were
 * then re-measured rather than assumed — see the numbers in `docs/game-design.md`.
 */
const MAX_PAYBACK_SECONDS = 3600;

/**
 * Spend down to nothing worth buying, under the given policy.
 *
 * Buys *max* of the chosen upgrade, because that is the button real players press. Returns
 * the number of decisions made, which is what the "a purchase every 15-60s" design target is
 * really about — not the level count.
 */
function spend(s: GameState, policy: Policy): number {
  let decisions = 0;

  // The progression upgrades first, whatever they cost, in either currency. They are not
  // counted as decisions: their value is step-shaped and lands on a later tier crossing, so
  // including them drags the "gain per purchase" median to zero and hides the real cadence.
  for (const def of unlockedUpgrades(s)) {
    if (!BUY_ON_SIGHT.has(def.term)) continue;
    while (canAfford(s, def.id) && buy(s, def.id, 1) > 0) { /* bought on sight */ }
  }

  for (;;) {
    const affordable = unlockedUpgrades(s)
      .map((def) => ({ id: def.id, cost: nextCost(s, def.id) }))
      .filter((o) => !BUY_ON_SIGHT.has(UPGRADES[o.id].term) && o.cost.lte(s.mass));

    if (affordable.length === 0) return decisions;

    const scored = affordable.map((o) => ({
      id: o.id,
      score: policy === 'cheapest' ? o.cost.toNumber() : paybackSeconds(s, o.id),
    }));
    scored.sort((a, b) => a.score - b.score);

    const best = scored[0];
    if (!best || !Number.isFinite(best.score)) return decisions;
    if (policy === 'payback' && best.score > MAX_PAYBACK_SECONDS) return decisions;
    if (buy(s, best.id, 'max') === 0) return decisions;
    decisions += 1;
  }
}

export function runPacing(options: PacingOptions = {}): PacingRun {
  const { limitSeconds = 24 * 3600, step = 0.1, clicks = true, policy = 'payback', from } = options;

  const s = from ?? initialState(0);
  const results: PacingResult[] = [];
  let next = 0;

  const decisionTimes: number[] = [];
  const elementTimes: Array<{ name: string; seconds: number }> = [];
  let elementSeen = 0;
  const shape: ShapeSample[] = [];
  let shapeAt = -1;
  const gains: number[] = [];
  /** (playTime, log2 of income) samples, for the doubling-time estimate. */
  const incomeLog: Array<[number, number]> = [];
  let sampleAt = -1;

  // A state handed in has already passed some milestones, and time is measured from where it
  // starts rather than from zero — otherwise run two reports run one's clock.
  const startedAt = s.playTime;
  while (next < MILESTONES.length && MILESTONES[next] && s.totalMassEver.gte(MILESTONES[next]!.threshold ?? D(Infinity))) {
    next += 1;
  }

  while (s.playTime - startedAt < limitSeconds && next < MILESTONES.length) {
    tick(s, step);
    if (clicks && pulseReady(s)) pulse(s);
    const incomeBefore = deriveRates(s).massPerSecond;
    const decisions = spend(s, policy);
    if (decisions > 0) {
      for (let i = 0; i < decisions; i++) decisionTimes.push(s.playTime - startedAt);
      const after = deriveRates(s).massPerSecond;
      gains.push(after.div(incomeBefore).toNumber() - 1);
    }

    const tier = deriveRates(s).elementTier;
    if (tier > elementSeen) {
      for (let i = elementSeen + 1; i <= tier; i++) {
        elementTimes.push({ name: REACHABLE_ELEMENTS[i]?.name ?? '?', seconds: s.playTime });
      }
      elementSeen = tier;
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
      if (mps.gt(0)) incomeLog.push([s.playTime - startedAt, mps.log10() / Math.log10(2)]);
      sampleAt = s.playTime + 10;
    }

    const milestone = MILESTONES[next];
    if (milestone?.threshold && s.totalMassEver.gte(milestone.threshold)) {
      results.push({
        id: milestone.id,
        label: milestone.name,
        seconds: s.playTime - startedAt,
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

  return {
    state: s,
    milestones: results,
    firstHour: feel(decisionTimes, gains, incomeLog, 3600),
    shape,
    elements: elementTimes,
  };
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

/**
 * Play run one to the top, collapse, spend the Stardust, and play run two.
 *
 * The only claim Phase 3 makes that can be checked by measuring rather than by feel is that
 * the second run is meaningfully faster than the first. Everything else about a prestige
 * layer — whether the tree is interesting, whether the decision of when to collapse is a
 * real one — needs a person. This does not answer those. It answers whether the numbers move.
 *
 * Stardust is spent cheapest-first, which is what clearing a five-card tree looks like.
 */
export interface CollapseRun {
  firstRun: PacingRun;
  secondRun: PacingRun;
  /** Seconds played past the top of the ladder before collapsing. */
  pushSeconds: number;
  stardust: Num;
  spent: Array<{ name: string; level: number }>;
}

/**
 * `pushSeconds` is the whole decision the prestige layer is built around, so it is a
 * parameter rather than a constant.
 *
 * Collapsing the instant the ladder tops out is the worst available moment and nobody plays
 * that way, but it is what a bot does unless told otherwise — and reporting it as though it
 * were the answer would make the tree look far weaker than it is. The yield goes as mass to
 * the 0.6, and mass is exponential in time, so twenty more minutes is not twenty percent more
 * Stardust. Measuring two or three push times is the only way to see that.
 */
export function runCollapse(pushSeconds = 0): CollapseRun {
  const first = runPacing();
  const s = first.state;

  // Keep playing past the top before pulling the trigger.
  for (let t = 0; t < pushSeconds; t += 0.1) {
    tick(s, 0.1);
    if (pulseReady(s)) pulse(s);
    spend(s, 'payback');
  }

  const stardust = stardustFor(s);
  collapse(s);

  for (;;) {
    const options = STARDUST_LIST.map((def) => ({ def, cost: stardustCost(def, s.stardustLevels[def.id]) }))
      .filter((o) => o.def.maxLevel > s.stardustLevels[o.def.id] && o.cost.lte(s.stardust))
      .sort((a, b) => (a.cost.lt(b.cost) ? -1 : 1));
    const best = options[0];
    if (!best || !buyStardust(s, best.def.id)) break;
  }

  return {
    firstRun: first,
    secondRun: runPacing({ from: s }),
    pushSeconds,
    stardust,
    spent: STARDUST_LIST.filter((def) => s.stardustLevels[def.id] > 0).map((def) => ({
      name: def.name,
      level: s.stardustLevels[def.id],
    })),
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

  if (run.elements.length > 0) {
    console.log('\n  fusion reached\n');
    for (const e of run.elements) console.log(`  ${e.name.padEnd(14)} ${formatDuration(e.seconds).padStart(9)}`);
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
      `\n              +${(gainPerPurchase * 100).toFixed(1)}% per purchase   (target: over 1%)` +
      `   longest wait ${formatDuration(worstGap)}`,
  );

  console.log('\n  after a supernova — run 2, against how long run 1 took\n');
  for (const push of [0, 10 * 60, 25 * 60]) {
    const c = runCollapse(push);
    const label = push === 0 ? 'collapse on arrival' : `${push / 60} min past the top`;
    console.log(`  ${label}: ${format(c.stardust, 'letters')} stardust`);
    console.log(`    spent on ${c.spent.map((x) => `${x.name} ${x.level}`).join(', ') || 'nothing'}`);
    const line = c.firstRun.milestones
      .map((a) => {
        const b = c.secondRun.milestones.find((x) => x.id === a.id);
        if (!b || !Number.isFinite(b.seconds)) return null;
        return `${a.label.split(' ')[0]} x${(a.seconds / Math.max(b.seconds, 1)).toFixed(1)}`;
      })
      .filter(Boolean)
      .join('  ');
    console.log(`    ${line}\n`);
  }

  const rates = deriveRates(s);
  console.log(
    `\n  opening rate ${format(rates.massPerSecond, 'letters')}/s` +
      `   first upgrade costs 10   first pulse pays ${format(rates.pulseYield, 'letters')}\n`,
  );
}

// Run only when invoked directly, so the test can import `runPacing` quietly.
if (process.argv[1] && process.argv[1].endsWith('balance.ts')) main();
