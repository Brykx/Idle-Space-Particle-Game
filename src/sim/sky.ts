import { D, type Num } from './numbers';
import {
  ACCRETION_STAGES,
  IGNITION_STAGE,
  SPECTRAL_CLASSES,
  classIndexOf,
  stageAt,
  stageIndexFor,
  type Fate,
} from './stages';
import {
  BASE_OFFERS,
  BASE_REACH,
  drawOffers,
  isSpent,
  mix,
  rng,
  type Cloud,
  type Trait,
} from './clouds';
import { UPGRADE_IDS } from './upgrades';
import type { GameState } from './state';

/**
 * The sky: what a run leaves behind.
 *
 * A run used to end in a supernova that paid a currency and kept nothing else. The currency
 * grew as a power of mass, and mass keeps growing after the ladder ends, so a single night
 * left at the top paid millions and every run after it took minutes. Worse, nothing you did
 * persisted that you could look at. The tenth run was the first, in a blur.
 *
 * Now a run is one star. When you let it go it takes a place in your night sky, permanently,
 * in its own colour, with its name and the day you made it — and the background of every run
 * after is made of the ones before. That is the long game: not a larger number but a sky
 * that fills.
 */

// ----------------------------------------------------------------------------------- stars

/** A star you made. Everything here is a record; none of it is recomputed. */
export interface StarRecord {
  /** 1 for the first star you ever let go, and so on. */
  id: number;
  name: string;
  /** Stage id of the class it was let go as. */
  stage: string;
  /** Orders of magnitude it grew after ignition. What it paid was computed from this. */
  orders: number;
  /** Whether its cloud was spent, or you stopped it short. */
  completed: boolean;
  /** Stardust it paid, discovery included. */
  stardust: number;
  /** Seconds of play from choosing its cloud to letting it go. */
  seconds: number;
  /** Wall-clock ms when it was let go: the day you made it. */
  releasedAt: number;
  /** The cloud it condensed from. */
  cloud: string;
  hue: number;
  trait: Trait;
  /** Where it sits in the sky, 0..1 across and down. */
  x: number;
  y: number;
}

/** Every star in the sky adds this to all mass, up to `SKY_BONUS_STARS` of them. */
export const SKY_BONUS = 0.02;
export const SKY_BONUS_STARS = 50;

/**
 * The one thing about the sky that is not bought: it makes everything a little easier.
 *
 * Additive rather than compounding, and capped, because this is what a long career is made
 * of and it must not become the thing that makes a run take seconds.
 */
export function skyMultiplier(s: GameState): number {
  return 1 + SKY_BONUS * Math.min(s.sky.length, SKY_BONUS_STARS);
}

// -------------------------------------------------------------------------------- the yield

/** The mass at which the core becomes a star, and the zero of the yield. */
export function ignitionMass(): Num {
  return ACCRETION_STAGES[IGNITION_STAGE]?.threshold ?? D(1);
}

/** Orders of magnitude grown as a star. Zero before ignition. */
export function ordersAsStar(totalMassEver: Num): number {
  const ignition = ignitionMass();
  if (totalMassEver.lt(ignition)) return 0;
  return Math.max(0, totalMassEver.div(ignition).log10());
}

/**
 * What letting a star go pays.
 *
 * ```
 * u        = log10( mass / mass at ignition )
 * stardust = 1 + floor( 3 x u ^ 1.4 )
 * ```
 *
 * Log-based on purpose. The old yield was a power of mass, and mass is exponential in time,
 * so it rewarded waiting without limit. This is a gentle power of *orders of magnitude*, and
 * the cloud bounds how many orders there can be — so the best time to let a star go is simply
 * when it is finished, and there is no clock to play against.
 */
export const YIELD_SCALE = 3;
export const YIELD_EXPONENT = 1.4;

export function yieldFor(totalMassEver: Num): number {
  return 1 + Math.floor(YIELD_SCALE * Math.pow(ordersAsStar(totalMassEver), YIELD_EXPONENT));
}

/**
 * Paid once, for the first star of each class, M through O.
 *
 * This is what makes stopping a star short a decision rather than a mistake. A cloud that
 * could make a Sun pays less as a red dwarf — unless you have never made a red dwarf, in
 * which case it pays for the discovery and fills a place in the catalogue.
 */
export const DISCOVERY = [5, 20, 45, 80, 125, 180, 245] as const;

/** The discovery bonus a star of this stage would pay, given the sky as it stands. */
export function discoveryFor(s: GameState, stage: number): number {
  const classIndex = classIndexOf(stage);
  if (classIndex < 0) return 0;
  const id = stageAt(stage).id;
  return s.sky.some((star) => star.stage === id) ? 0 : (DISCOVERY[classIndex] ?? 0);
}

/** Any star can be let go, from the moment it ignites. */
export function canRelease(s: GameState): boolean {
  return s.cloud !== null && stageIndexFor(s.totalMassEver) >= IGNITION_STAGE;
}

/** Everything letting go right now would pay. Zero when there is nothing to let go. */
export function releaseValue(s: GameState): { stardust: number; discovery: number } {
  if (!canRelease(s)) return { stardust: 0, discovery: 0 };
  return {
    stardust: yieldFor(s.totalMassEver),
    discovery: discoveryFor(s, stageIndexFor(s.totalMassEver)),
  };
}

export interface Release {
  star: StarRecord;
  /** From the formula. */
  stardust: number;
  /** For the first of its class; zero otherwise. */
  discovery: number;
  /** What it leaves: decided by its mass, as it is in the sky. */
  fate: Fate;
}

/**
 * Let the star go. Returns what happened, or null if there is no star to let go.
 *
 * What survives is chosen rather than incidental:
 *
 * - **The sky** survives; that is what it is for.
 * - **Achievements** survive, because they record what you have done and you did it.
 * - **Levels ever bought** survive, so every current you have opened is still open. The
 *   second star needs no opening at all, which is the point: a later run is about the
 *   choices, not about clicking through the first twenty minutes again.
 * - **Which currents are held** survives, because it is a preference, not progress.
 * - Everything else goes: mass, energy, every level, the stage — and the cloud. Until the
 *   next one is chosen the field is empty, and that pause is deliberate.
 */
export function release(s: GameState, now: number): Release | null {
  const cloud = s.cloud;
  if (!cloud || !canRelease(s)) return null;

  const stage = stageIndexFor(s.totalMassEver);
  const def = stageAt(stage);
  const stardust = yieldFor(s.totalMassEver);
  const discovery = discoveryFor(s, stage);

  const star: StarRecord = {
    id: s.sky.length + 1,
    name: uniqueName(s.sky, cloud.name.split(' ')[0] || cloud.name),
    stage: def.id,
    orders: Math.round(ordersAsStar(s.totalMassEver) * 100) / 100,
    completed: isSpent(cloud, s.totalMassEver),
    stardust: stardust + discovery,
    seconds: Math.max(0, s.playTime - s.runStartedAt),
    releasedAt: now,
    cloud: cloud.name,
    hue: cloud.hue,
    trait: cloud.trait,
    ...placeInSky(s),
  };

  s.sky.push(star);
  s.stardust += stardust + discovery;
  s.stardustEver += stardust + discovery;

  s.mass = D(0);
  s.totalMassEver = D(0);
  s.energy = D(0);
  s.totalEnergyEver = D(0);
  for (const id of UPGRADE_IDS) s.levels[id] = 0;
  s.rebasedStage = 0;
  // The ladder announces itself again. The climb through the same bodies is most of what a
  // run looks like, and silencing it would throw away what the visual work was for.
  s.stageSeen = 0;
  s.cloud = null;

  return { star, stardust, discovery, fate: def.fate ?? 'nebula' };
}

/** Clouds are named after things; the star takes the first word. A second Heron is Heron II. */
function uniqueName(sky: readonly StarRecord[], base: string): string {
  const taken = new Set(sky.map((star) => star.name));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 4000; n++) {
    const candidate = `${base} ${roman(n)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${sky.length + 1}`;
}

function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let left = n;
  for (const [value, numeral] of table) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
}

/** Nearer than this and two of your stars read as one. */
const SKY_SPACING = 0.09;

/**
 * Somewhere in the sky that is not already taken, decided by the save's seed so a reload
 * cannot move it. Kept off the edges, which are where the interface sits.
 */
function placeInSky(s: GameState): { x: number; y: number } {
  const roll = rng(mix(s.skySeed, 0x5c1 + s.sky.length));
  let best = { x: 0.5, y: 0.5 };
  let bestDistance = -1;

  for (let attempt = 0; attempt < 32; attempt++) {
    const x = 0.08 + 0.84 * roll();
    const y = 0.08 + 0.84 * roll();
    let nearest = Infinity;
    for (const star of s.sky) nearest = Math.min(nearest, Math.hypot(star.x - x, star.y - y));
    if (nearest >= SKY_SPACING) return { x: round4(x), y: round4(y) };
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = { x, y };
    }
  }
  // A crowded sky takes the emptiest place it found rather than refusing a star.
  return { x: round4(best.x), y: round4(best.y) };
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Names are yours to change. Trimmed, kept short, and never blank. */
export function renameStar(s: GameState, id: number, name: string): boolean {
  const star = s.sky.find((entry) => entry.id === id);
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!star || clean.length === 0) return false;
  star.name = clean;
  return true;
}

// ------------------------------------------------------------------------------- the clouds

/** The clouds on offer while choosing, or none while a star is condensing. */
export function offersFor(s: GameState): Cloud[] {
  if (s.cloud) return [];
  const tree = treeEffects(s);
  return drawOffers(s.skySeed, s.sky.length, tree.offers, tree.maxClass);
}

/** Begin the next star from one of the clouds on offer. */
export function chooseCloud(s: GameState, index: number): boolean {
  if (s.cloud) return false;
  const cloud = offersFor(s)[index];
  if (!cloud) return false;
  s.cloud = cloud;
  s.runStartedAt = s.playTime;
  return true;
}

// --------------------------------------------------------------------------------- the tree

/** Ids of the permanent upgrades Stardust buys. */
export const STARDUST_IDS = ['reach', 'enrichment', 'ignition', 'gaze'] as const;

export type StardustId = (typeof STARDUST_IDS)[number];

export interface StardustDef {
  id: StardustId;
  name: string;
  blurb: string;
  /** What each level costs, in order. The tree is bounded: every card ends. */
  costs: readonly number[];
  maxLevel: number;
  perLevel: string;
}

/**
 * Four cards, all of which end.
 *
 * Bounded matters more than anything else in this file. If permanent progress were
 * unbounded, every run would eventually collapse into seconds and the summit would stop
 * being a summit. With a finite tree the total speed-up is finite — a little over twenty-fold
 * with the sky full — and a blue supergiant stays a long way up.
 *
 * Only one card multiplies income. The rest change what a run *is*: how large a star you can
 * attempt, where on the element chain it starts, how much choice you have.
 */
export const STARDUST_UPGRADES: Record<StardustId, StardustDef> = {
  reach: {
    id: 'reach',
    name: 'Reach',
    blurb: 'Look further out. Larger clouds are rarer, and further away.',
    costs: [150, 400, 1000, 2500],
    maxLevel: 4,
    perLevel: 'clouds one class larger can be found',
  },
  enrichment: {
    id: 'enrichment',
    name: 'Enrichment',
    blurb: 'The clouds you condense from are salted with what your stars made. They fall in faster.',
    costs: [6, 12, 20, 35, 60, 100, 160, 250],
    maxLevel: 8,
    perLevel: 'x1.15 to all mass',
  },
  ignition: {
    id: 'ignition',
    name: 'Prior Ignition',
    blurb: 'You do not start at hydrogen. The cloud already holds what earlier stars fused.',
    costs: [20, 80, 250, 700],
    // One per element above hydrogen that is actually reachable.
    maxLevel: 4,
    perLevel: 'begin one element further up the chain',
  },
  gaze: {
    id: 'gaze',
    name: 'Wider Gaze',
    blurb: 'More of the sky to choose from. It changes nothing but the choice.',
    costs: [40, 200],
    maxLevel: 2,
    perLevel: 'one more cloud to choose between',
  },
};

/** What one level of Enrichment multiplies all mass by. */
export const ENRICHMENT_STEP = 1.15;

export const STARDUST_LIST: StardustDef[] = STARDUST_IDS.map((id) => STARDUST_UPGRADES[id]);

/** Cost of the next level, or null once the card has ended. */
export function stardustCost(def: StardustDef, level: number): number | null {
  return def.costs[level] ?? null;
}

/** Everything the tree currently does, in one place. */
export interface TreeEffects {
  /** Multiplies all mass income. */
  massMultiplier: number;
  /** Element tier a run starts at. */
  startingTier: number;
  /** The largest class a cloud on offer can be, 0 for M through 6 for O. */
  maxClass: number;
  /** How many clouds are offered. */
  offers: number;
}

export function treeEffects(s: GameState): TreeEffects {
  const level = s.stardustLevels;
  return {
    massMultiplier: Math.pow(ENRICHMENT_STEP, Math.min(level.enrichment, STARDUST_UPGRADES.enrichment.maxLevel)),
    startingTier: Math.min(STARDUST_UPGRADES.ignition.maxLevel, level.ignition),
    maxClass: Math.min(SPECTRAL_CLASSES.length - 1, BASE_REACH + level.reach),
    offers: BASE_OFFERS + Math.min(STARDUST_UPGRADES.gaze.maxLevel, level.gaze),
  };
}

export function buyStardust(s: GameState, id: StardustId): boolean {
  const def = STARDUST_UPGRADES[id];
  const level = s.stardustLevels[id];
  const cost = stardustCost(def, level);
  if (cost === null || s.stardust < cost) return false;
  s.stardust -= cost;
  s.stardustLevels[id] = level + 1;
  return true;
}
