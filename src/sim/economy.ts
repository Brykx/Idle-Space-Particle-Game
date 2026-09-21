import { D, type Num } from './numbers';
import { PULSE_COOLDOWN, type GameState } from './state';
import { ACHIEVEMENTS, multiplierFor } from './achievements';
import { stageIndexFor } from './stages';
import {
  UPGRADE_LIST,
  UPGRADES,
  costAt,
  costOfLevels,
  maxAffordable,
  type UpgradeDef,
  type UpgradeId,
} from './upgrades';

/**
 * The economy. Deterministic, framework-free, and the only thing that decides what mass is.
 *
 * The particle field on screen is a readout of the numbers produced here — it never feeds
 * back. That separation is what makes offline progress, exact big-number maths and a
 * particle budget three independent concerns instead of one tangle.
 */

const BASE_GRAVITY = 1;
const BASE_RADIUS = 10;
const BASE_SPAWN = 4;

/**
 * Sets the scale at which reach stops mattering much. Capture saturates towards 1 and never
 * arrives, so radius and gravity always do something and never break the game.
 */
const CAPTURE_K = 30;

/** Levels of an upgrade before it will buy itself. */
export const AUTO_BUY_LEVEL = 25;

/**
 * Safety net on auto-purchases per tick, not a budget.
 *
 * Costs are geometric, so the loop bounds itself: buying k levels of something costs about
 * base * growth^(n+k), which outruns any amount of mass after a couple of hundred levels.
 * This only exists so a pathological state cannot spin forever.
 *
 * It must not bind in normal play. A first attempt at 60 did, and it broke offline progress
 * in a way that was invisible without a test: a coarse catch-up tick earns a hundred seconds
 * of income at once and wants to spend it all, so capping the tick made an absence pay far
 * less than being present. See the coarse-versus-fine test in tests/automation.test.ts.
 */
const MAX_AUTO_PURCHASES_PER_TICK = 2000;

/** A pulse is worth this many seconds of production... */
const PULSE_SECONDS = 5;
/** ...or this many particles outright, whichever is kinder. Keeps the opening minute alive. */
const PULSE_MIN_PARTICLES = 3;

export interface Rates {
  gravity: number;
  radius: number;
  /** radius x sqrt(gravity) — the single number that decides capture. */
  reach: number;
  /** 0..1, asymptotic. */
  captureFraction: number;
  spawnRate: number;
  massPerParticle: Num;
  globalMultiplier: number;
  massPerSecond: Num;
  /** What a pulse would pay right now. */
  pulseYield: Num;
}

/** Pure: state in, every derived number out. Used by the UI, the renderer and the tests alike. */
export function deriveRates(s: GameState): Rates {
  const gravity = BASE_GRAVITY * Math.pow(1.34, s.levels.gravity);
  const radius = BASE_RADIUS + 4 * s.levels.radius;
  const spawnRate = BASE_SPAWN * Math.pow(1.165, s.levels.density);
  const massPerParticle = D(1.34).pow(s.levels.particleMass);
  const globalMultiplier = Math.pow(1.34, s.levels.efficiency) * multiplierFor(s.achievements.length);

  const reach = radius * Math.sqrt(gravity);
  // Guard the far end: once gravity overflows a float the fraction is 1 for all purposes.
  const captureFraction = Number.isFinite(reach) ? reach / (reach + CAPTURE_K) : 1;

  const massPerSecond = massPerParticle.mul(spawnRate * captureFraction * globalMultiplier);

  const pulseYield = Num_max(
    massPerSecond.mul(PULSE_SECONDS),
    massPerParticle.mul(PULSE_MIN_PARTICLES * globalMultiplier),
  );

  return {
    gravity,
    radius,
    reach,
    captureFraction,
    spawnRate,
    massPerParticle,
    globalMultiplier,
    massPerSecond,
    pulseYield,
  };
}

function Num_max(a: Num, b: Num): Num {
  return a.gte(b) ? a : b;
}

/** Credit mass and keep the running total honest. The single place mass is created. */
export function earn(s: GameState, amount: Num): void {
  if (amount.lte(0)) return;
  s.mass = s.mass.add(amount);
  s.totalMassEver = s.totalMassEver.add(amount);
}

/** An upgrade buys itself only once you have invested in it by hand. */
export function autoBuyUnlocked(s: GameState, id: UpgradeId): boolean {
  return s.levels[id] >= AUTO_BUY_LEVEL;
}

export function autoBuyersAvailable(s: GameState): number {
  return UPGRADE_LIST.filter((def) => autoBuyUnlocked(s, def.id)).length;
}

export function autoBuyersOn(s: GameState): number {
  return UPGRADE_LIST.filter((def) => s.autoBuy[def.id] && autoBuyUnlocked(s, def.id)).length;
}

/**
 * Spend on behalf of the player, cheapest first.
 *
 * Cheapest-first is the priority rule, and it self-balances: buying the cheapest raises its
 * cost, so spending spreads across everything enabled and keeps the next costs roughly level.
 * What it will not do is notice that an upgrade has stopped being worth buying — Gravity Well
 * saturates and would happily absorb your income forever. That is what the per-upgrade
 * toggles are for, and why each card shows what a level is currently worth.
 *
 * Returns how many levels were bought.
 */
export function runAutoBuyers(s: GameState): number {
  const spendFraction = 1 - s.settings.autoBuyReserve;
  let bought = 0;

  for (let n = 0; n < MAX_AUTO_PURCHASES_PER_TICK; n++) {
    let cheapestId: UpgradeId | null = null;
    let cheapest: Num | null = null;

    for (const def of UPGRADE_LIST) {
      if (!s.autoBuy[def.id]) continue;
      if (!autoBuyUnlocked(s, def.id)) continue;
      if (!isUnlocked(s, def)) continue;

      const cost = costAt(def, s.levels[def.id]);
      // Recomputed each pass: the budget shrinks as the loop spends.
      if (cost.gt(s.mass.mul(spendFraction))) continue;
      if (!cheapest || cost.lt(cheapest)) {
        cheapest = cost;
        cheapestId = def.id;
      }
    }

    if (!cheapestId) break;
    if (buy(s, cheapestId, 1) === 0) break;
    bought += 1;
  }

  return bought;
}

/** Unlock anything newly earned. Runs inside `tick`, so an absence can earn them too. */
export function awardAchievements(s: GameState, captureFraction: number): string[] {
  if (s.achievements.length === ACHIEVEMENTS.length) return [];

  const context = {
    state: s,
    captureFraction,
    stageIndex: stageIndexFor(s.totalMassEver),
    autoBuyersOn: autoBuyersOn(s),
    autoBuyersAvailable: autoBuyersAvailable(s),
  };

  const earned: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (s.achievements.includes(achievement.id)) continue;
    if (!achievement.test(context)) continue;
    s.achievements.push(achievement.id);
    earned.push(achievement.id);
  }
  return earned;
}

/**
 * Advance the simulation by exactly `dt` seconds, in place.
 *
 * In place, and not a clone, because offline catch-up calls this up to a thousand times in a
 * row and the game loop owns exactly one state object. `deriveRates` stays pure, which is
 * where purity actually buys something.
 */
export function tick(s: GameState, dt: number): void {
  if (!(dt > 0)) return;

  const rates = deriveRates(s);
  earn(s, rates.massPerSecond.mul(dt));
  s.playTime += dt;

  // Both of these live inside the tick so that offline catch-up gets them for free: an
  // absence buys upgrades and unlocks achievements exactly as being present would.
  //
  // Crediting the whole step at the rate it started with is plain Euler, so the error is
  // proportional to the step size. Splitting the earn either side of the purchases was
  // tried and measured no better, so the step size is the only real lever — see
  // `sim/offline.ts`, which picks one based on whether automation is running.
  runAutoBuyers(s);
  awardAchievements(s, rates.captureFraction);
}

export function pulseReady(s: GameState): boolean {
  return s.playTime >= s.pulseReadyAt;
}

/** Returns what the pulse paid, or null if it was still on cooldown. */
export function pulse(s: GameState): Num | null {
  if (!pulseReady(s)) return null;
  const yield_ = deriveRates(s).pulseYield;
  earn(s, yield_);
  s.pulseReadyAt = s.playTime + PULSE_COOLDOWN;
  s.stats.pulses += 1;
  return yield_;
}

export function isUnlocked(s: GameState, def: UpgradeDef): boolean {
  return s.totalMassEver.gte(def.unlockAt);
}

export function unlockedUpgrades(s: GameState): UpgradeDef[] {
  return UPGRADE_LIST.filter((def) => isUnlocked(s, def));
}

export function levelOf(s: GameState, id: UpgradeId): number {
  return s.levels[id];
}

export function nextCost(s: GameState, id: UpgradeId): Num {
  return costAt(UPGRADES[id], s.levels[id]);
}

/**
 * Buy `count` levels, or as many as affordable when `count` is 'max'.
 * Returns how many were actually bought.
 */
export function buy(s: GameState, id: UpgradeId, count: number | 'max' = 1): number {
  const def = UPGRADES[id];
  if (!isUnlocked(s, def)) return 0;

  const level = s.levels[id];
  const purchase =
    count === 'max'
      ? maxAffordable(def, level, s.mass)
      : { levels: count, cost: costOfLevels(def, level, count) };

  if (purchase.levels <= 0 || purchase.cost.gt(s.mass)) return 0;

  s.mass = s.mass.sub(purchase.cost);
  s.levels[id] = level + purchase.levels;
  s.stats.purchases += purchase.levels;
  return purchase.levels;
}
