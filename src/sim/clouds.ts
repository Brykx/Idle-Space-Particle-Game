import type { Num } from './numbers';
import { IGNITION_STAGE, SUMMIT_STAGE, ceilingMass, classIndexOf, stageAt, stageOfClass } from './stages';

/**
 * Clouds: what a run is made from.
 *
 * A run used to be a lap — the same ladder, from the same start, with a bigger multiplier.
 * Now a run is one star, and a star condenses out of one particular cloud. The cloud is
 * finite, so the star has a size it can reach and no further; it has a pace, so a small one
 * is an evening and a vast one is a week; and it has a character, so two runs are not the
 * same run.
 *
 * Choosing the cloud is the decision the game is now built around. It is made once per star,
 * with nothing hurrying it, between runs — the one moment the field is empty.
 */

/**
 * What a cloud is like.
 *
 * Near-equal on purpose. A trait changes what the infall looks like and which term of the
 * formula is doing the work, and none of them is the right answer: a choice with a correct
 * option is a quiz, and this is meant to be a preference.
 */
export const TRAITS = ['quiet', 'icy', 'ferrous', 'turning'] as const;
export type Trait = (typeof TRAITS)[number];

export interface TraitDef {
  id: Trait;
  name: string;
  /** One line, shown where the cloud is chosen. */
  blurb: string;
  /** Multiplies particles per second. */
  spawn: number;
  /** Multiplies mass per particle. */
  value: number;
  /** Multiplies reach, which decides capture until capture saturates. */
  reach: number;
  /** Multiplies the fraction of infall the disk turns into energy. */
  throughput: number;
  /** Multiplies everything. */
  global: number;
}

export const TRAIT_DEFS: Record<Trait, TraitDef> = {
  quiet: {
    id: 'quiet',
    name: 'Quiet',
    blurb: 'Nothing unusual about it. It falls in evenly, and a little more of it arrives.',
    spawn: 1,
    value: 1,
    reach: 1,
    throughput: 1,
    global: 1.05,
  },
  icy: {
    id: 'icy',
    name: 'Icy',
    blurb: 'Volatile and fine-grained. A great many small pieces, each worth less.',
    spawn: 1.3,
    value: 0.8,
    reach: 1,
    throughput: 1,
    global: 1,
  },
  ferrous: {
    id: 'ferrous',
    name: 'Ferrous',
    blurb: 'Salted with iron from something that died here before. Fewer pieces, and heavy ones.',
    spawn: 0.75,
    value: 1.4,
    reach: 1,
    throughput: 1,
    global: 1,
  },
  turning: {
    id: 'turning',
    name: 'Turning',
    blurb: 'It has spin. Harder to gather at first, and it settles into a disc that burns hot.',
    spawn: 1,
    value: 1,
    reach: 0.65,
    throughput: 1.6,
    global: 1,
  },
};

export interface Cloud {
  /** Identifies the draw, and seeds the nebula drawn behind the run. */
  seed: number;
  name: string;
  /** Stage id of the largest class of star this cloud can make. */
  ceiling: string;
  /**
   * A flat multiplier on everything that falls in. Small clouds are dense and quick; vast
   * ones are thin and slow.
   */
  pace: number;
  trait: Trait;
  /** Hue of the nebula, in degrees. */
  hue: number;
}

/**
 * How quick a cloud of each ceiling is, M through O, before its own variation.
 *
 * This is the lever that keeps the summit a long way up. Permanent progress is bounded, so
 * without it the largest star would take about twice as long as the smallest — the classes
 * differ by orders of magnitude, but mass climbs by orders of magnitude at a steady pace.
 * Thinning the vast clouds is what makes a blue supergiant something you leave overnight
 * rather than something you get by waiting a little longer than last time.
 */
export const BASE_PACE = [1.6, 1.25, 1, 0.5, 0.22, 0.12, 0.065] as const;

/** How far a particular cloud's pace can sit either side of its class. */
const PACE_SPREAD = 0.12;

/** The largest class a cloud can be found for, before any Reach: a Sun. */
export const BASE_REACH = 2;

/** How many clouds are offered, before any Wider Gaze. */
export const BASE_OFFERS = 3;

/**
 * The first cloud. Fixed, so every player's first star is the same story: it can make a Sun,
 * it is in no hurry, and there is nothing to choose before anything has been explained.
 */
export function firstCloud(): Cloud {
  return { seed: 1, name: 'Morning Veil', ceiling: 'yellowDwarf', pace: 1, trait: 'quiet', hue: 214 };
}

// --------------------------------------------------------------------------------------------
// Randomness. Seeded, so the sky a save is offered is decided by the save and cannot be
// changed by reloading: there is nothing to reroll.

/** Combine two integers into one well-mixed 32-bit one. */
export function mix(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32: small, fast, and good enough to pick names with. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A cloud's name is two words, and the first becomes the star's. So these are chosen to be
 * worth having in a sky: things that are small, particular, and not grand.
 */
const NAMES = [
  'Heron', 'Lantern', 'Ember', 'Halcyon', 'Willow', 'Tallow', 'Linnet', 'Saffron',
  'Juniper', 'Thistle', 'Calder', 'Wren', 'Sable', 'Osprey', 'Cinder', 'Meadow',
  'Larkspur', 'Brindle', 'Quill', 'Harbour', 'Solace', 'Tamar', 'Morrow', 'Vesper',
  'Aster', 'Fennel', 'Rowan', 'Sorrel', 'Yarrow', 'Piper', 'Mallow', 'Garnet',
  'Opal', 'Tansy', 'Kestrel', 'Bramble', 'Lumen', 'Marlow', 'Petrel', 'Islet',
  'Tarn', 'Fallow', 'Pippin', 'Sedge', 'Alder', 'Curlew', 'Madder', 'Oriel',
] as const;

const FORMATIONS = [
  'Veil', 'Drift', 'Shoal', 'Reach', 'Cradle', 'Loom', 'Banner', 'Wake',
  'Ridge', 'Garden', 'Tide', 'Mantle', 'Furrow', 'Lagoon', 'Thicket', 'Stair',
] as const;

/**
 * Hues a nebula actually comes in: hydrogen's rose, oxygen's teal, the blue of starlight
 * scattered off dust, the amber of dust in front of it.
 */
const HUES = [214, 188, 338, 14, 262, 36, 158, 300] as const;

function pick<T>(list: readonly T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))] as T;
}

/**
 * The clouds on offer.
 *
 * `drawn` is how many stars the save has made, so each star is followed by a new set and
 * nothing else changes it. One is always as large as you can currently reach: the summit you
 * are working towards is never withheld by a roll. The rest are smaller, and distinct until
 * there are more places than classes to fill them.
 *
 * Each place is drawn from its own stream, so being offered a fourth and fifth cloud does not
 * disturb the first three.
 */
export function drawOffers(seed: number, drawn: number, count: number, maxClass: number): Cloud[] {
  const base = mix(seed, drawn);
  const top = Math.max(0, Math.min(SUMMIT_STAGE - IGNITION_STAGE, Math.floor(maxClass)));

  // The classes below the largest, in an order this draw decides.
  const lower: number[] = [];
  for (let c = 0; c < top; c++) lower.push(c);
  const shuffle = rng(mix(base, 0x51ed));
  for (let i = lower.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    const held = lower[i] as number;
    lower[i] = lower[j] as number;
    lower[j] = held;
  }

  const offers: Array<{ cloud: Cloud; classIndex: number }> = [];
  const taken = new Set<string>();

  for (let slot = 0; slot < count; slot++) {
    const classIndex = slot === 0 || lower.length === 0 ? top : (lower[(slot - 1) % lower.length] as number);
    const roll = rng(mix(base, slot + 1));

    const pace = (BASE_PACE[classIndex] as number) * (1 - PACE_SPREAD + 2 * PACE_SPREAD * roll());
    const trait = pick(TRAITS, roll());
    const hue = (pick(HUES, roll()) + Math.round((roll() - 0.5) * 20) + 360) % 360;

    // Two clouds in one sky should not share a name, because the star will take it.
    let name = '';
    for (let attempt = 0; attempt < 8 && (name === '' || taken.has(name.split(' ')[0] as string)); attempt++) {
      name = `${pick(NAMES, roll())} ${pick(FORMATIONS, roll())}`;
    }
    taken.add(name.split(' ')[0] as string);

    offers.push({
      classIndex,
      cloud: {
        seed: mix(base, 0x1000 + slot),
        name,
        ceiling: stageAt(stageOfClass(classIndex)).id,
        pace: Math.round(pace * 100) / 100,
        trait,
        hue,
      },
    });
  }

  // Smallest first: the natural order to read them in, and the same every time.
  return offers
    .map((offer, slot) => ({ ...offer, slot }))
    .sort((a, b) => a.classIndex - b.classIndex || a.slot - b.slot)
    .map((offer) => offer.cloud);
}

/** Ladder index of the largest class a cloud can make. */
export function ceilingStageOf(cloud: Cloud): number {
  for (let stage = IGNITION_STAGE; stage <= SUMMIT_STAGE; stage++) {
    if (stageAt(stage).id === cloud.ceiling) return stage;
  }
  // A cloud whose ceiling this build does not know makes the smallest star there is, rather
  // than throwing in the middle of a tick.
  return IGNITION_STAGE;
}

/** 0 for a cloud that can make a red dwarf, 6 for one that can make a blue supergiant. */
export function ceilingClassOf(cloud: Cloud): number {
  return classIndexOf(ceilingStageOf(cloud));
}

/** Everything the cloud holds: the mass at which its largest class ends. */
export function capOf(cloud: Cloud): Num {
  return ceilingMass(ceilingStageOf(cloud));
}

/** Whether a value read from a save is a cloud this build can run. */
export function isCloud(value: unknown): value is Cloud {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.ceiling === 'string' &&
    typeof c.seed === 'number' &&
    Number.isFinite(c.seed) &&
    typeof c.pace === 'number' &&
    Number.isFinite(c.pace) &&
    c.pace > 0 &&
    typeof c.hue === 'number' &&
    Number.isFinite(c.hue) &&
    typeof c.trait === 'string' &&
    (TRAITS as readonly string[]).includes(c.trait)
  );
}

/**
 * How much of the cloud has to have fallen in before the star counts as finished.
 *
 * Income is multiplied by what is left, so a star approaches its cloud's mass without ever
 * arriving. It needs a line to cross, and the last tenth of a percent is the right place for
 * it: far enough in that the field has visibly emptied, close enough that the tail — which
 * shrinks by the same factor every few minutes — is not something anyone waits through.
 */
export const COMPLETE_AT = 0.999;

/** Fraction of the cloud still unspent: 1 as a run begins, 0 with no cloud at all. */
export function remainingOf(cloud: Cloud | null, totalMassEver: Num): number {
  if (!cloud) return 0;
  const fraction = 1 - totalMassEver.div(capOf(cloud)).toNumber();
  return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
}

/** Whether this cloud has given its star everything it held. */
export function isSpent(cloud: Cloud | null, totalMassEver: Num): boolean {
  return cloud !== null && remainingOf(cloud, totalMassEver) <= 1 - COMPLETE_AT;
}
