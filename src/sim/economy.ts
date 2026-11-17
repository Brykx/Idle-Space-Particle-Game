import { D, type Num } from './numbers';
import type { GameState } from './state';
import { ACHIEVEMENTS, multiplierFor } from './achievements';
import { costScaleAt, stageIndexFor } from './stages';
import { elementAt, elementTierFor, nextRequirement } from './elements';
import { skyMultiplier, treeEffects } from './sky';
import { TRAIT_DEFS, capOf, isSpent, remainingOf } from './clouds';
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
 * What one level of each mass upgrade does.
 *
 * Named, because two things read them: the formula in `deriveRates`, and the automation's
 * estimate of what a level is worth. They used to be bare literals inside the formula, which
 * was fine while only the formula used them — and would have become two copies of the same
 * five numbers the moment anything else needed to know what a level buys.
 */
const GRAVITY_STEP = 1.34;
const RADIUS_STEP = 4;
const DENSITY_STEP = 1.165;
const PARTICLE_MASS_STEP = 1.34;
const EFFICIENCY_STEP = 1.34;

/**
 * Sets the scale at which reach stops mattering much. Capture saturates towards 1 and never
 * arrives, so radius and gravity always do something and never break the game.
 */
const CAPTURE_K = 30;

/** The fraction of what drifts past that a given reach catches. */
function captureAt(reach: number): number {
  // Guard the far end: once gravity overflows a float the fraction is 1 for all purposes.
  return Number.isFinite(reach) ? reach / (reach + CAPTURE_K) : 1;
}

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

/**
 * How long the automation is willing to wait for a purchase to pay for itself.
 *
 * This is what lets automation be the default rather than something to supervise. Capture
 * saturates towards 1 without ever arriving, so Gravity Well and Capture Radius keep a
 * positive gain forever — vanishingly small, never zero. An automation with no notion of
 * worth poured over half of everything into those two cards at a measured 0.0% each, and the
 * documented fix was for the player to notice and switch them off. Past its horizon a card
 * has *settled*, and the automation leaves it alone until that changes.
 *
 * Measured in the run's own time, not the clock's. It was a flat hour, which suited the first
 * star and nothing else: a vast, thin cloud grows thirty times more slowly, so in it nearly
 * every sound purchase took longer than an hour to repay, the automation under-invested, and a
 * blue supergiant took five times as long as a blue giant where its pace said three. So the
 * horizon is a number of *tenfolds* — how many times the star would grow tenfold, at the rate
 * it is growing now, while the purchase repays. A tenfold takes about five minutes in the
 * first run, so twelve of them is the hour it used to be there, and the same judgement
 * everywhere else.
 */
export const AUTO_PAYBACK_TENFOLDS = 12;

/** The horizon's floor, for the opening seconds of a run, before there is a rate to measure. */
export const AUTO_PAYBACK_FLOOR = 300;

/** Seconds a purchase may take to repay itself and still be bought for you, right now. */
export function paybackHorizon(s: GameState, rates: Rates): number {
  if (rates.massPerSecond.lte(0) || s.totalMassEver.lte(0)) return AUTO_PAYBACK_FLOOR;
  const tenfold = Math.LN10 * s.totalMassEver.div(rates.massPerSecond).toNumber();
  return Number.isFinite(tenfold) ? Math.max(AUTO_PAYBACK_FLOOR, AUTO_PAYBACK_TENFOLDS * tenfold) : AUTO_PAYBACK_FLOOR;
}

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
  /** What the tree's Enrichment is currently multiplying income by. */
  stardustMultiplier: number;
  /** What the stars already in your sky are multiplying income by. */
  skyMultiplier: number;
  /** The cloud's pace and character, as one flat multiplier. 0 with no cloud. */
  cloudMultiplier: number;
  /**
   * Fraction of the cloud still unspent, 0..1. Income is multiplied by it, which is what
   * makes a run end: growth is exponential for almost all of it and then eases off until the
   * star has everything the cloud held.
   */
  remaining: number;
  /** The cloud is spent and the star is finished. Nothing more will fall in. */
  complete: boolean;
  spawnRate: number;
  massPerParticle: Num;
  globalMultiplier: number;
  massPerSecond: Num;

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
  // What the cloud is like. Between stars there is no cloud, and nothing falls in at all.
  const trait = s.cloud ? TRAIT_DEFS[s.cloud.trait] : null;

  const gravity = BASE_GRAVITY * Math.pow(GRAVITY_STEP, s.levels.gravity);
  const radius = BASE_RADIUS + RADIUS_STEP * s.levels.radius;
  const spawnRate = BASE_SPAWN * Math.pow(DENSITY_STEP, s.levels.density) * (trait?.spawn ?? 1);
  const massPerParticle = D(PARTICLE_MASS_STEP).pow(s.levels.particleMass).mul(trait?.value ?? 1);

  // Climbing the ladder pays. Everything else here is something you bought.
  const stage = stageIndexFor(s.totalMassEver);
  const ladderMultiplier = promotionMultiplier(stage);

  // Everything permanent enters here and nowhere else. A long game that reaches into three or
  // four terms of the formula is a long game nobody can balance.
  const tree = treeEffects(s);
  const sky = skyMultiplier(s);
  const cloudMultiplier = s.cloud && trait ? s.cloud.pace * trait.global : 0;

  const globalMultiplier =
    Math.pow(EFFICIENCY_STEP, s.levels.efficiency) *
    multiplierFor(s.achievements.length) *
    ladderMultiplier *
    tree.massMultiplier *
    sky *
    cloudMultiplier;

  const reach = radius * Math.sqrt(gravity) * (trait?.reach ?? 1);
  const captureFraction = captureAt(reach);

  // A finished star is finished: once the cloud is spent nothing more falls in, rather than a
  // trickle that never quite stops.
  const remaining = remainingOf(s.cloud, s.totalMassEver);
  const complete = isSpent(s.cloud, s.totalMassEver);
  const infall = complete ? 0 : remaining;

  // The energy economy, computed from the *raw* infall rather than the finished one.
  //
  // That ordering is not cosmetic: energy decides the element tier, the tier multiplies mass
  // per particle, and mass income would otherwise decide energy — a cycle. Taxing the raw
  // infall breaks it, and it is the more honest reading anyway. The disk extracts energy from
  // material falling in; what the core then fuses it into is a separate question.
  const rawMassPerSecond = massPerParticle.mul(spawnRate * captureFraction * globalMultiplier * infall);

  // A disk forms once the core is heavy enough to have one; the upgrades sharpen the one you
  // have. Everything on this side is bought with energy, and energy is taxed from the *raw*
  // infall, so an element tier can never fund the disk level that reaches the next tier.
  // That loop is what made the first two attempts cascade through the whole chain at once.
  const hasDisk = s.totalMassEver.gte(UPGRADES.disk.unlockAt);
  const diskThroughput =
    BASE_THROUGHPUT * Math.pow(1.15, s.levels.disk) * Math.pow(1.12, s.levels.magnetic) * (trait?.throughput ?? 1);
  const energyPerSecond = hasDisk ? rawMassPerSecond.mul(diskThroughput) : D(0);

  const requirementScale = Math.pow(0.9, s.levels.confinement);
  // Prior Ignition is a floor, not a bonus: the nebula is already salted with what you fused
  // last time, so the chain starts partway up rather than every tier being worth more.
  const elementTier = Math.max(
    tree.startingTier,
    hasDisk ? elementTierFor(diskThroughput, requirementScale) : 0,
  );
  const elementMultiplier = elementAt(elementTier).multiplier;

  const massPerSecond = rawMassPerSecond.mul(elementMultiplier);

  return {
    gravity,
    radius,
    reach,
    captureFraction,
    stage,
    promotionMultiplier: ladderMultiplier,
    stardustMultiplier: tree.massMultiplier,
    skyMultiplier: sky,
    cloudMultiplier,
    remaining,
    complete,
    spawnRate,
    massPerParticle: massPerParticle.mul(elementMultiplier),
    globalMultiplier,
    massPerSecond,
    diskThroughput,
    energyPerSecond,
    requirementScale,
    elementTier,
    elementMultiplier,
    nextElementRequirement: nextRequirement(elementTier, requirementScale),
  };
}

/**
 * Credit mass and keep the running total honest. The single place mass is created.
 *
 * Never more than the cloud has left. Income already falls as the cloud is spent, but a long
 * offline step credits its whole length at the rate it started with, and without this a coarse
 * enough step could put more mass into a star than its cloud ever held.
 */
export function earn(s: GameState, amount: Num): void {
  if (!s.cloud || amount.lte(0)) return;
  const room = capOf(s.cloud).sub(s.totalMassEver);
  if (room.lte(0)) return;
  const credited = amount.gt(room) ? room : amount;
  s.mass = s.mass.add(credited);
  s.totalMassEver = s.totalMassEver.add(credited);
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
 * A current is *open* once you have begun it by hand, and it stays open.
 *
 * Beginning one is the only purchase the game asks you to make yourself: one deliberate act
 * per upgrade, after which it grows without you. The gate used to be twenty-five levels,
 * which was a hundred and twenty-five clicks of proving that you wanted not to click.
 *
 * Read from levels *ever* bought, so neither a promotion resetting Density nor a new run
 * resetting everything closes a current you have already opened. The second star needs no
 * opening at all.
 */
export function isOpen(s: GameState, id: UpgradeId): boolean {
  return s.levelsEver[id] >= 1;
}

/** Open, and not held back by the player. */
export function isFlowing(s: GameState, id: UpgradeId): boolean {
  return s.autoBuy[id] && isOpen(s, id);
}

export function currentsOpen(s: GameState): number {
  return UPGRADE_LIST.filter((def) => isOpen(s, def.id)).length;
}

export function currentsFlowing(s: GameState): number {
  return UPGRADE_LIST.filter((def) => isFlowing(s, def.id)).length;
}

/**
 * What one more level of a mass upgrade adds to income, as a fraction: 0.34 is +34%.
 *
 * Closed-form, from the same named steps the formula uses, because the automation asks this
 * for every card on every tick and a full `deriveRates` probe per card per tick is most of a
 * second over a long absence. A test holds it against the probe, so the two cannot drift.
 *
 * The energy-side upgrades return 0: their value is step-shaped — nothing at all until a
 * level tips the core over a fusion threshold — and no marginal figure describes that.
 */
export function levelGain(id: UpgradeId, rates: Rates): number {
  // Written in terms of `rates.reach`, which already carries the cloud's own reach, so the
  // estimate cannot forget a factor the formula remembered.
  switch (id) {
    case 'gravity':
      return captureAt(rates.reach * Math.sqrt(GRAVITY_STEP)) / rates.captureFraction - 1;
    case 'radius':
      return captureAt((rates.reach * (rates.radius + RADIUS_STEP)) / rates.radius) / rates.captureFraction - 1;
    case 'density':
      return DENSITY_STEP - 1;
    case 'particleMass':
      return PARTICLE_MASS_STEP - 1;
    case 'efficiency':
      return EFFICIENCY_STEP - 1;
    default:
      return 0;
  }
}

/** Seconds for the next level of a mass upgrade to earn back what it costs. */
export function paybackSeconds(s: GameState, id: UpgradeId, rates: Rates): number {
  const gain = levelGain(id, rates);
  if (!(gain > 0) || rates.massPerSecond.lte(0)) return Infinity;
  const seconds = nextCost(s, id).div(rates.massPerSecond.mul(gain)).toNumber();
  return Number.isFinite(seconds) ? seconds : Infinity;
}

/**
 * Spend on behalf of the player: whatever repays itself soonest, and nothing that will not.
 *
 * It used to be cheapest-first, which self-balances but cannot tell when a card has stopped
 * being worth buying. Payback order with a horizon can, so a saturated card settles instead
 * of absorbing the run — and that is what allows this to be on by default.
 *
 * Energy-side currents are bought whenever they can be afforded. Their value arrives in
 * steps that a payback figure cannot see, energy has nothing else to be spent on, and a
 * player looking at a bar showing how far off the next element is would buy them on sight.
 *
 * Returns how many levels were bought.
 */
export function runAutoBuyers(s: GameState): number {
  const spendFraction = 1 - s.settings.autoBuyReserve;
  let bought = 0;
  // Derived lazily and only refreshed after a purchase: most ticks buy nothing.
  let rates: Rates | null = null;
  let horizon = 0;

  for (let n = 0; n < MAX_AUTO_PURCHASES_PER_TICK; n++) {
    let bestId: UpgradeId | null = null;
    let bestScore = Infinity;

    for (const def of UPGRADE_LIST) {
      if (!isFlowing(s, def.id) || !isUnlocked(s, def)) continue;
      // Recomputed each pass: the budget shrinks as the loop spends.
      if (nextCost(s, def.id).gt(walletFor(s, def).mul(spendFraction))) continue;

      let score: number;
      if (def.currency === 'energy') {
        // Always worth it, and ahead of anything bought with mass: different wallet, no
        // competition, and the sooner a fusion tier lands the better.
        score = -1;
      } else {
        if (!rates) {
          rates = deriveRates(s);
          horizon = paybackHorizon(s, rates);
        }
        score = paybackSeconds(s, def.id, rates);
        if (score > horizon) continue;
      }

      if (score < bestScore) {
        bestScore = score;
        bestId = def.id;
      }
    }

    if (!bestId) break;
    if (buy(s, bestId, 1) === 0) break;
    bought += 1;
    rates = null;
  }

  return bought;
}

/** Unlock anything newly earned. Runs inside `tick`, so an absence can earn them too. */
/**
 * Takes the whole `Rates` rather than a handful of scalars off it.
 *
 * Every context an achievement can read is derived from the same tick's rates, so passing
 * them whole means adding a condition never means changing this signature and every call
 * site with it — which is what adding `elementTier` would otherwise have cost.
 */
export function awardAchievements(s: GameState, rates: Rates): string[] {
  if (s.achievements.length === ACHIEVEMENTS.length) return [];

  const context = {
    state: s,
    captureFraction: rates.captureFraction,
    stageIndex: rates.stage,
    elementTier: rates.elementTier,
    flowing: currentsFlowing(s),
    open: currentsOpen(s),
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
  s.playTime += dt;

  // Between stars, and after one has finished, time passes and nothing else happens. That
  // stillness is deliberate. Achievements are still checked: an absence can earn the ones
  // about being away.
  if (!s.cloud || rates.complete) {
    awardAchievements(s, rates);
    return;
  }

  earn(s, rates.massPerSecond.mul(dt));
  earnEnergy(s, rates.energyPerSecond.mul(dt));

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
  awardAchievements(s, rates);
}

/** A star is condensing: there is a cloud, and it is not yet spent. */
export function isRunning(s: GameState): boolean {
  return s.cloud !== null && !isSpent(s.cloud, s.totalMassEver);
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
