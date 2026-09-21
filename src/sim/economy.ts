import { D, type Num } from './numbers';
import { PULSE_COOLDOWN, type GameState } from './state';
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
  const globalMultiplier = Math.pow(1.34, s.levels.efficiency);

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
