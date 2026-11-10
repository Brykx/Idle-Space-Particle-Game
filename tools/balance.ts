import { D, format, formatDuration, type Num } from '../src/sim/numbers';
import { buy, canAfford, deriveRates, isOpen, tick, unlockedUpgrades } from '../src/sim/economy';
import { initialState, type GameState } from '../src/sim/state';
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
 * Plays the game the way the game now expects to be played and reports time to each
 * milestone. `tests/balance.test.ts` asserts these inside generous bounds, so a tuning change
 * that quietly doubles the first hour fails CI instead of shipping.
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
 * How the first hour feels.
 *
 * This used to carry two more numbers — the median income gain per purchase and the longest
 * wait with nothing affordable — and both measured a player making purchases. Nobody makes
 * them now: a current is opened once and flows. What is left to feel is how fast the number
 * moves and how often there is something new to begin, so those are what get reported.
 */
export interface Feel {
  /** Levels bought in the window, by the automation and by hand together. Informational. */
  purchases: number;
  /** Seconds for income to double, across the window. Under ~2 min the number visibly climbs. */
  doublingTime: number;
}

/** When each current could first be begun — the cadence of "something new" in a run. */
export interface Opening {
  name: string;
  seconds: number;
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
  openings: Opening[];
}

export interface PacingOptions {
  /** Simulated seconds to give up after. */
  limitSeconds?: number;
  /** Simulation step. Smaller is more accurate and slower. */
  step?: number;
  /** Start from this state instead of a fresh one. Used to measure a run after a collapse. */
  from?: GameState;
}

/**
 * The imaginary player.
 *
 * It does the one thing the game asks a person to do with mass — begin each current once it
 * can be afforded — and otherwise watches. Everything after that first level is the game's
 * own automation, running inside `tick`.
 *
 * This file used to hold a much larger bot: a payback policy, a list of upgrades to buy on
 * sight, and a ceiling added after it was caught sinking half its decisions into two dead
 * cards. All three were approximations of a sensible player, written here because the game
 * itself did not have one. It does now, and the consequence is the useful part: **the thing
 * being measured and the thing doing the measuring are the same code**, so the tool can no
 * longer disagree with the game about what playing it looks like.
 *
 * Returns the names of whatever it opened.
 */
function openWhatCanBeOpened(s: GameState): string[] {
  const opened: string[] = [];
  for (const def of unlockedUpgrades(s)) {
    if (isOpen(s, def.id) || !canAfford(s, def.id)) continue;
    if (buy(s, def.id, 1) > 0) opened.push(def.name);
  }
  return opened;
}

export function runPacing(options: PacingOptions = {}): PacingRun {
  const { limitSeconds = 24 * 3600, step = 0.1, from } = options;

  const s = from ?? initialState(0);
  const results: PacingResult[] = [];
  let next = 0;

  const elementTimes: Array<{ name: string; seconds: number }> = [];
  let elementSeen = 0;
  const openings: Opening[] = [];
  const shape: ShapeSample[] = [];
  let shapeAt = -1;
  /** (seconds, log2 of income) samples, for the doubling-time estimate. */
  const incomeLog: Array<[number, number]> = [];
  let sampleAt = -1;

  // A state handed in has already passed some milestones, and time is measured from where it
  // starts rather than from zero — otherwise run two reports run one's clock.
  const startedAt = s.playTime;
  const purchasesAtStart = s.stats.purchases;
  let purchasesInFirstHour: number | null = null;
  while (next < MILESTONES.length && MILESTONES[next] && s.totalMassEver.gte(MILESTONES[next]!.threshold ?? D(Infinity))) {
    next += 1;
  }

  while (s.playTime - startedAt < limitSeconds && next < MILESTONES.length) {
    tick(s, step);
    const elapsed = s.playTime - startedAt;
    for (const name of openWhatCanBeOpened(s)) openings.push({ name, seconds: elapsed });

    if (purchasesInFirstHour === null && elapsed >= 3600) {
      purchasesInFirstHour = s.stats.purchases - purchasesAtStart;
    }

    const rates = deriveRates(s);
    if (rates.elementTier > elementSeen) {
      for (let i = elementSeen + 1; i <= rates.elementTier; i++) {
        elementTimes.push({ name: REACHABLE_ELEMENTS[i]?.name ?? '?', seconds: elapsed });
      }
      elementSeen = rates.elementTier;
    }

    if (elapsed >= shapeAt) {
      shape.push({
        minutes: elapsed / 60,
        log10: s.totalMassEver.lte(1) ? 0 : s.totalMassEver.log10(),
      });
      shapeAt = elapsed + 300;
    }

    if (elapsed >= sampleAt) {
      if (rates.massPerSecond.gt(0)) incomeLog.push([elapsed, rates.massPerSecond.log10() / Math.log10(2)]);
      sampleAt = elapsed + 10;
    }

    const milestone = MILESTONES[next];
    if (milestone?.threshold && s.totalMassEver.gte(milestone.threshold)) {
      results.push({
        id: milestone.id,
        label: milestone.name,
        seconds: elapsed,
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
    firstHour: {
      purchases: purchasesInFirstHour ?? s.stats.purchases - purchasesAtStart,
      doublingTime: doublingTime(incomeLog, 3600),
    },
    shape,
    elements: elementTimes,
    openings,
  };
}

/**
 * Seconds per doubling across the whole window.
 *
 * Not a median of per-interval rates: income only moves when something is bought, so most
 * intervals gain nothing and the ones that gain a sliver report an enormous seconds-per-
 * doubling. The median of that measures the sampling cadence, not the game.
 */
function doublingTime(incomeLog: Array<[number, number]>, windowSeconds: number): number {
  const samples = incomeLog.filter(([t]) => t <= windowSeconds);
  const first = samples[0];
  const last = samples[samples.length - 1];
  return first && last && last[1] > first[1] ? (last[0] - first[0]) / (last[1] - first[1]) : Infinity;
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
    openWhatCanBeOpened(s);
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

  console.log('\n  time to stage (every current opened when it can be, then left to flow)\n');
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

  console.log('\n  something new to begin\n');
  console.log('  ' + run.openings.map((o) => `${o.name} ${formatDuration(o.seconds)}`).join('  ·  '));

  console.log(
    `\n  first hour: ${run.firstHour.purchases} levels bought` +
      `   income doubles every ${run.firstHour.doublingTime.toFixed(0)}s   (target 45-150s)`,
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
  console.log(`\n  opening rate ${format(rates.massPerSecond, 'letters')}/s   first current costs 10\n`);
}

// Run only when invoked directly, so the test can import `runPacing` quietly.
if (process.argv[1] && process.argv[1].endsWith('balance.ts')) main();
