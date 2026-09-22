import { D, type Num } from './numbers';
import { PULSE_COOLDOWN, type GameState } from './state';
import { ACHIEVEMENTS, multiplierFor } from './achievements';
import { costScaleAt, stageIndexFor } from './stages';
import { elementAt, elementTierFor, nextRequirement } from './elements';
import {
  REBASED_UPGRADE_IDS,
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

/**
 * The share of the growth exponent that climbing the ladder pays, rather than buying.
 *
 * Reaching a stage multiplies income. *How much* is not a constant, and this is the whole
 * lesson of the first attempt: a flat x3 per promotion looks like one number but is not one,
 * because the ladder's gaps run from 1.18 orders of magnitude early to 2.3 late. The same x3
 * is therefore worth 0.40 of the exponent at the bottom and 0.21 at the top — too strong
 * where the game is fragile and too weak where it needs carrying. Measured, x1.8 took eight
 * and a half hours to Supergiant and x2.2 took ninety minutes. Nothing in between was stable,
 * because nothing in between was the same number twice.
 *
 * So the multiplier is derived from the gap instead of fixed. Each promotion is worth
 * `10 ^ (share x gap)`, which contributes exactly `share` to the exponent sum wherever it
 * lands. Late promotions come out larger than early ones, which is both what the maths wants
 * and what a promotion should feel like.
 *
 * Cumulatively that product telescopes into the ladder's own cost scale raised to this power
 * — the same scale that reprices the rebased upgrades. One idea, used twice: what the ladder
 * takes away from Density on the cost side, it hands back on the income side.
 *
 * The value is what a rebased Density gives up. Density's cost exponent is
 * ln(1.165)/ln(1.685) = 0.293, and an upgrade that resets every promotion contributes that
 * inside a stage and nothing at all across the run.
 */
export const PROMOTION_SHARE = 0.24;

/** What the ladder alone multiplies income by, at a stage. */
export function promotionMultiplier(stage: number): number {
  return costScaleAt(stage).pow(PROMOTION_SHARE).toNumber();
}

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

/** Fraction of the raw infall a bare disk sheds as energy. */
const BASE_THROUGHPUT = 2e-5;

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
  /** Index into the accretion ladder. Prices the rebased upgrades and pays the promotion. */
  stage: number;
  /** What the ladder alone is currently multiplying income by. */
  promotionMultiplier: number;
  spawnRate: number;
  massPerParticle: Num;
  globalMultiplier: number;
  massPerSecond: Num;
  /** What a pulse would pay right now. */
  pulseYield: Num;

  // --- the energy economy -------------------------------------------------------------
  /** Fraction of the raw infall the disk sheds as energy. */
  diskThroughput: number;
  energyPerSecond: Num;
  /** Multiplies what every fusion tier asks for. Below 1 once Confinement is bought. */
  requirementScale: number;
  elementTier: number;
  /** Multiplies mass per particle. The element chain's whole effect on income. */
  elementMultiplier: number;
  /** Throughput the next tier asks for, or null at the end of what is reachable. */
  nextElementRequirement: number | null;
}

/** Pure: state in, every derived number out. Used by the UI, the renderer and the tests alike. */
export function deriveRates(s: GameState): Rates {
  const gravity = BASE_GRAVITY * Math.pow(1.34, s.levels.gravity);
  const radius = BASE_RADIUS + 4 * s.levels.radius;
  const spawnRate = BASE_SPAWN * Math.pow(1.165, s.levels.density);
  const massPerParticle = D(1.34).pow(s.levels.particleMass);

  // Climbing the ladder pays. Everything else here is something you bought.
  const stage = stageIndexFor(s.totalMassEver);
  const ladderMultiplier = promotionMultiplier(stage);

  const globalMultiplier =
    Math.pow(1.34, s.levels.efficiency) * multiplierFor(s.achievements.length) * ladderMultiplier;

  const reach = radius * Math.sqrt(gravity);
  // Guard the far end: once gravity overflows a float the fraction is 1 for all purposes.
  const captureFraction = Number.isFinite(reach) ? reach / (reach + CAPTURE_K) : 1;

  // The energy economy, computed from the *raw* infall rather than the finished one.
  //
  // That ordering is not cosmetic: energy decides the element tier, the tier multiplies mass
  // per particle, and mass income would otherwise decide energy — a cycle. Taxing the raw
  // infall breaks it, and it is the more honest reading anyway. The disk extracts energy from
  // material falling in; what the core then fuses it into is a separate question.
  const rawMassPerSecond = massPerParticle.mul(spawnRate * captureFraction * globalMultiplier);

  // A disk forms once the core is heavy enough to have one; the upgrades sharpen the one you
  // have. Everything on this side is bought with energy, and energy is taxed from the *raw*
  // infall, so an element tier can never fund the disk level that reaches the next tier.
  // That loop is what made the first two attempts cascade through the whole chain at once.
  const hasDisk = s.totalMassEver.gte(UPGRADES.disk.unlockAt);
  const diskThroughput = BASE_THROUGHPUT * Math.pow(1.15, s.levels.disk) * Math.pow(1.12, s.levels.magnetic);
  const energyPerSecond = hasDisk ? rawMassPerSecond.mul(diskThroughput) : D(0);

  const requirementScale = Math.pow(0.9, s.levels.confinement);
  const elementTier = hasDisk ? elementTierFor(diskThroughput, requirementScale) : 0;
  const elementMultiplier = elementAt(elementTier).multiplier;

  const massPerSecond = rawMassPerSecond.mul(elementMultiplier);

  const pulseYield = Num_max(
    massPerSecond.mul(PULSE_SECONDS),
    massPerParticle.mul(PULSE_MIN_PARTICLES * globalMultiplier * elementMultiplier),
  );

  return {
    gravity,
    radius,
    reach,
    captureFraction,
    stage,
    promotionMultiplier: ladderMultiplier,
    spawnRate,
    massPerParticle: massPerParticle.mul(elementMultiplier),
    globalMultiplier,
    massPerSecond,
    pulseYield,
    diskThroughput,
    energyPerSecond,
    requirementScale,
    elementTier,
    elementMultiplier,
    nextElementRequirement: nextRequirement(elementTier, requirementScale),
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

export function earnEnergy(s: GameState, amount: Num): void {
  if (amount.lte(0)) return;
  s.energy = s.energy.add(amount);
  s.totalEnergyEver = s.totalEnergyEver.add(amount);
}

/** What an upgrade is paid with. */
export function walletFor(s: GameState, def: UpgradeDef): Num {
  return def.currency === 'energy' ? s.energy : s.mass;
}

function spend(s: GameState, def: UpgradeDef, amount: Num): void {
  if (def.currency === 'energy') s.energy = s.energy.sub(amount);
  else s.mass = s.mass.sub(amount);
}

/**
 * An upgrade buys itself only once you have invested in it by hand.
 *
 * Measured against levels *ever* bought, not the current level, so a rebased upgrade does not
 * hand back its auto-buyer at every promotion.
 */
export function autoBuyUnlocked(s: GameState, id: UpgradeId): boolean {
  return s.levelsEver[id] >= AUTO_BUY_LEVEL;
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
  const stage = stageIndexFor(s.totalMassEver);
  let bought = 0;

  // Per currency: "cheapest" only means something between prices in the same units.
  for (const currency of ['mass', 'energy'] as const) {
    for (let n = 0; n < MAX_AUTO_PURCHASES_PER_TICK; n++) {
      let cheapestId: UpgradeId | null = null;
      let cheapest: Num | null = null;

      for (const def of UPGRADE_LIST) {
        if (def.currency !== currency) continue;
        if (!s.autoBuy[def.id]) continue;
        if (!autoBuyUnlocked(s, def.id)) continue;
        if (!isUnlocked(s, def)) continue;

        const cost = costAt(def, s.levels[def.id], stage);
        // Recomputed each pass: the budget shrinks as the loop spends.
        if (cost.gt(walletFor(s, def).mul(spendFraction))) continue;
        if (!cheapest || cost.lt(cheapest)) {
          cheapest = cost;
          cheapestId = def.id;
        }
      }

      if (!cheapestId) break;
      if (buy(s, cheapestId, 1) === 0) break;
      bought += 1;
    }
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
/**
 * Reset the rebased upgrades if a promotion has happened since the last check.
 *
 * Here rather than in `deriveRates` because it is a mutation and `deriveRates` is pure. It
 * runs inside `tick`, so an absence is promoted exactly as presence would be, and it is
 * written as a catch-up loop rather than a single step because one coarse offline tick can
 * cross several stages at once.
 *
 * `rebasedStage` is not a cache of `stageIndexFor` — it is a record of what was done to the
 * levels, which is why it is stored rather than derived.
 */
function applyPromotions(s: GameState): boolean {
  const stage = stageIndexFor(s.totalMassEver);
  if (stage <= s.rebasedStage) return false;
  s.rebasedStage = stage;
  for (const id of REBASED_UPGRADE_IDS) s.levels[id] = 0;
  return true;
}

export function tick(s: GameState, dt: number): void {
  if (!(dt > 0)) return;

  const rates = deriveRates(s);
  earn(s, rates.massPerSecond.mul(dt));
  earnEnergy(s, rates.energyPerSecond.mul(dt));
  s.playTime += dt;

  // Before the auto-buyers spend: a promotion reprices what they are about to buy, and
  // buying at the old price and then zeroing the level would burn the purchase.
  applyPromotions(s);

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
  return costAt(UPGRADES[id], s.levels[id], stageIndexFor(s.totalMassEver));
}

export function canAfford(s: GameState, id: UpgradeId): boolean {
  return walletFor(s, UPGRADES[id]).gte(nextCost(s, id));
}

/**
 * Buy `count` levels, or as many as affordable when `count` is 'max'.
 * Returns how many were actually bought.
 */
export function buy(s: GameState, id: UpgradeId, count: number | 'max' = 1): number {
  const def = UPGRADES[id];
  if (!isUnlocked(s, def)) return 0;

  const level = s.levels[id];
  const wallet = walletFor(s, def);
  const stage = stageIndexFor(s.totalMassEver);
  const purchase =
    count === 'max'
      ? maxAffordable(def, level, wallet, stage)
      : { levels: count, cost: costOfLevels(def, level, count, stage) };

  if (purchase.levels <= 0 || purchase.cost.gt(wallet)) return 0;

  spend(s, def, purchase.cost);
  s.levels[id] = level + purchase.levels;
  s.levelsEver[id] += purchase.levels;
  s.stats.purchases += purchase.levels;
  return purchase.levels;
}
