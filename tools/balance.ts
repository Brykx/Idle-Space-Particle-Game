import { format, formatDuration } from '../src/sim/numbers';
import { buy, canAfford, deriveRates, isOpen, isRunning, tick, unlockedUpgrades } from '../src/sim/economy';
import { initialState, type GameState } from '../src/sim/state';
import { ACCRETION_STAGES, classIndexOf, stageAt, stageIndexById } from '../src/sim/stages';
import {
  STARDUST_LIST,
  buyStardust,
  chooseCloud,
  offersFor,
  release,
  stardustCost,
  type StardustId,
} from '../src/sim/sky';
import { TRAITS, ceilingClassOf, ceilingStageOf, type Cloud, type Trait } from '../src/sim/clouds';
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
 * you start. A run reaches as far as its cloud allows and then finishes, so the list is cut
 * at the cloud's ceiling and ends with the cloud being spent.
 */
function milestonesFor(s: GameState): Array<{ id: string; name: string; reached: (s: GameState) => boolean }> {
  const top = s.cloud ? ceilingStageOf(s.cloud) : 0;
  return [
    ...ACCRETION_STAGES.slice(1, top + 1).map((stage) => ({
      id: stage.id,
      name: stage.name,
      reached: (state: GameState) => stage.threshold !== null && state.totalMassEver.gte(stage.threshold),
    })),
    { id: 'spent', name: 'Cloud spent', reached: (state: GameState) => !isRunning(state) },
  ];
}

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
  const MILESTONES = milestonesFor(s);
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
  while (next < MILESTONES.length && MILESTONES[next]?.reached(s)) next += 1;

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

    // A coarse step can cross more than one at once.
    for (let milestone = MILESTONES[next]; milestone?.reached(s); milestone = MILESTONES[next]) {
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

// --------------------------------------------------------------------------------- careers

/**
 * How a player chooses between clouds. The two ends of a range, so the tuning is checked
 * against both rather than against one imagined player.
 *
 * - `largest`: always the biggest cloud on offer. The summit-chaser, and the slowest sky.
 * - `smallest`: always the smallest. Fills the sky quickest and earns the least per star.
 */
export type CloudPolicy = 'largest' | 'smallest';

/**
 * When a player looks in. A star that finishes between visits waits for the next one, and
 * that wait is part of how long a career takes in days.
 *
 * Hours of the day, starting from midnight. The default is someone who looks in a few times
 * in a day and not at all overnight.
 */
export const DEFAULT_CHECK_INS = [8, 12.5, 18, 22] as const;

export interface CareerStar {
  index: number;
  cloud: Cloud;
  /** Seconds the run took, from choosing the cloud to the cloud being spent. */
  seconds: number;
  /** The class it was let go as. */
  name: string;
  stardust: number;
  discovery: number;
  /** Days since the career began, when it was let go. */
  day: number;
  /** The tree after this star's Stardust was spent. */
  tree: Record<StardustId, number>;
}

export interface Career {
  stars: CareerStar[];
  /** Day each class was first let go, M first. Infinity if never. */
  firstOfClass: number[];
  /** Day every card of the tree was full, or Infinity. */
  treeFull: number;
}

export interface CareerOptions {
  stars?: number;
  policy?: CloudPolicy;
  checkIns?: readonly number[];
  /** Simulation step for the runs, in seconds. Coarser is faster and pays slightly less. */
  step?: number;
}

/**
 * Spend what the tree will take, cheapest first.
 *
 * With four short cards that is what clearing it looks like, and it is close to what a
 * person would do: the cheap levels of Enrichment early, Reach when it comes in range.
 */
function spendStardust(s: GameState): void {
  for (;;) {
    const options = STARDUST_LIST.map((def) => ({ def, cost: stardustCost(def, s.stardustLevels[def.id]) }))
      .filter((o): o is { def: (typeof STARDUST_LIST)[number]; cost: number } => o.cost !== null && o.cost <= s.stardust)
      .sort((a, b) => a.cost - b.cost);
    const best = options[0];
    if (!best || !buyStardust(s, best.def.id)) break;
  }
}

function chooseByPolicy(s: GameState, policy: CloudPolicy): void {
  const offers = offersFor(s);
  let pick = 0;
  offers.forEach((cloud, index) => {
    const here = ceilingClassOf(cloud);
    const best = ceilingClassOf(offers[pick] as Cloud);
    const better =
      policy === 'largest'
        ? here > best || (here === best && cloud.pace > (offers[pick] as Cloud).pace)
        : here < best || (here === best && cloud.pace > (offers[pick] as Cloud).pace);
    if (better) pick = index;
  });
  chooseCloud(s, pick);
}

/** The next check-in after `seconds` into the career. */
function nextCheckIn(seconds: number, checkIns: readonly number[]): number {
  const day = Math.floor(seconds / 86400);
  for (let d = day; d < day + 3; d++) {
    for (const hour of checkIns) {
      const at = d * 86400 + hour * 3600;
      if (at >= seconds) return at;
    }
  }
  return seconds;
}

/**
 * Play a career: star after star, each one finished, let go, and its Stardust spent.
 *
 * Runs are simulated in play time — being away is credited the same as being present, which
 * the offline tests hold to within a couple of percent — and placed on a calendar afterwards:
 * a star that finishes at three in the morning is let go at eight.
 */
export function runCareer(options: CareerOptions = {}): Career {
  const { stars = 12, policy = 'largest', checkIns = DEFAULT_CHECK_INS, step = 1 } = options;
  const s = initialState(0);
  const result: CareerStar[] = [];
  const firstOfClass = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity];
  let treeFull = Infinity;

  // The career starts at the first check-in of the first day.
  let clock = (checkIns[0] ?? 8) * 3600;

  for (let index = 1; index <= stars; index++) {
    if (!s.cloud) chooseByPolicy(s, policy);
    const cloud = s.cloud as Cloud;
    const started = s.playTime;

    while (isRunning(s) && s.playTime - started < 30 * 86400) {
      tick(s, step);
      openWhatCanBeOpened(s);
    }
    const seconds = s.playTime - started;

    clock = nextCheckIn(clock + seconds, checkIns);
    const done = release(s, 0);
    if (!done) break;
    spendStardust(s);

    const day = clock / 86400;
    const classIndex = classIndexOf(stageIndexById(done.star.stage));
    if (classIndex >= 0 && firstOfClass[classIndex] === Infinity) firstOfClass[classIndex] = day;
    if (treeFull === Infinity && STARDUST_LIST.every((def) => s.stardustLevels[def.id] >= def.maxLevel)) {
      treeFull = day;
    }

    result.push({
      index,
      cloud,
      seconds,
      name: stageAt(stageIndexById(done.star.stage)).name,
      stardust: done.stardust,
      discovery: done.discovery,
      day,
      tree: { ...s.stardustLevels },
    });
  }

  return { stars: result, firstOfClass, treeFull };
}

/**
 * The four kinds of cloud, side by side: the same star, the same tree, the same pace, a
 * different character. They are meant to be near-equal — a preference, not a quiz — and this
 * is where that is checked rather than hoped.
 */
export function compareTraits(ceiling = 'yellowDwarf', tree: Partial<Record<StardustId, number>> = { enrichment: 4, ignition: 2 }): Array<{ trait: Trait; seconds: number }> {
  return TRAITS.map((trait) => {
    const s = initialState(0);
    // A second star: every current already open, the first one in the sky.
    for (const def of unlockedUpgrades(s)) s.levelsEver[def.id] = 1;
    for (const id of ['gravity', 'radius', 'density', 'particleMass', 'efficiency', 'disk', 'confinement', 'magnetic'] as const) {
      s.levelsEver[id] = 1;
    }
    Object.assign(s.stardustLevels, tree);
    s.cloud = { seed: 7, name: 'Test Cloud', ceiling, pace: 1, trait, hue: 200 };
    const started = s.playTime;
    while (isRunning(s) && s.playTime - started < 30 * 86400) tick(s, 1);
    return { trait, seconds: s.playTime - started };
  });
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

  console.log('\n  the same star from each kind of cloud (a Sun, pace 1, a little of the tree)\n');
  const traits = compareTraits();
  const fastest = Math.min(...traits.map((t) => t.seconds));
  console.log('  ' + traits.map((t) => `${t.trait} ${formatDuration(t.seconds)} (${((t.seconds / fastest - 1) * 100).toFixed(0)}%)`).join('   '));

  for (const policy of ['largest', 'smallest'] as const) {
    const career = runCareer({ stars: policy === 'largest' ? 70 : 20, policy, step: 2 });
    console.log(`\n  a career, choosing the ${policy} cloud each time — checking in at ${DEFAULT_CHECK_INS.join(', ')}h\n`);
    for (const star of career.stars) {
      const tree = STARDUST_LIST.map((def) => `${def.name.split(' ')[0]!.slice(0, 5)} ${star.tree[def.id]}`).join(' ');
      console.log(
        `  ${String(star.index).padStart(3)}  ${star.name.padEnd(16)} ${star.cloud.trait.padEnd(8)} pace ${star.cloud.pace.toFixed(2)}` +
          `  ${formatDuration(star.seconds).padStart(9)}  +${String(star.stardust).padStart(3)}` +
          `${star.discovery ? ` +${star.discovery}` : ''}`.padEnd(6) +
          `  day ${star.day.toFixed(1).padStart(5)}   ${tree}`,
      );
    }
    const classes = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];
    console.log(
      '\n  first of each class, day: ' +
        career.firstOfClass.map((d, i) => `${classes[i]} ${Number.isFinite(d) ? d.toFixed(1) : '-'}`).join('  ') +
        `   tree full: day ${Number.isFinite(career.treeFull) ? career.treeFull.toFixed(1) : '-'}`,
    );
  }

  const rates = deriveRates(s);
  console.log(`\n  opening rate ${format(rates.massPerSecond, 'letters')}/s   first current costs 10\n`);
}

// Run only when invoked directly, so the test can import `runPacing` quietly.
if (process.argv[1] && process.argv[1].endsWith('balance.ts')) main();
