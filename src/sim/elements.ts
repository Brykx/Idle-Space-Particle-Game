/**
 * The element chain: what the energy economy is for.
 *
 * A tier is not a cost you pay down. It is a standard the disk has to meet: fusing carbon
 * needs the core held at a temperature, and holding it there means converting a given
 * *fraction* of the infall into energy. That fraction is `diskThroughput`, and it is a pure
 * function of what you have built.
 *
 * Gating on the fraction rather than on energy per second is the second design this went
 * through. Absolute energy requirements looked right and were not: energy income is
 * proportional to mass income, which spans twenty orders of magnitude over a run, so any
 * fixed set of thresholds is crossed almost simultaneously somewhere in the middle. The
 * whole chain fired inside one second. A fraction does not inflate, so the tiers are paced
 * by the cost curve of the disk — which is a dial that behaves.
 *
 * The multipliers look timid and are not. With the mass upgrades' cost exponents summing to
 * about 1, income tracks capital, so a flat multiplier scales the growth *rate* rather than
 * the total: the first attempt gave the chain a x1500 top end and made the entire game
 * roughly seventy times faster, collapsing the last four stages into a single second. A x3
 * chain is worth about a doubling of pace, which is already a lot.
 *
 * Energy itself stays the stock: it buys the two upgrades that bring the tiers closer,
 * Confinement (lowers what each tier asks for) and Field Lines (raises throughput directly).
 * Mass builds the disk, energy sharpens it, and the two never fight.
 *
 * Iron is where it stops, and that is the real astrophysics rather than a balance decision:
 * fusing iron consumes energy instead of releasing it, so no throughput reaches it. It is
 * listed with no requirement at all, the way the ladder lists the stages only a collapse can
 * reach. The stall it causes is Phase 3's prestige prompt; until then it is simply the end of
 * the chain, and everything else keeps climbing.
 */

export interface Element {
  id: string;
  name: string;
  symbol: string;
  /** Multiplies mass per particle. Replaces the previous tier's figure, it does not stack. */
  multiplier: number;
  /**
   * Fraction of the infall the disk must convert to hold this tier. `null` means nothing
   * reaches it — iron, and only iron.
   */
  requires: number | null;
  blurb: string;
}

export const ELEMENTS: Element[] = [
  {
    id: 'hydrogen',
    name: 'Hydrogen',
    symbol: 'H',
    multiplier: 1,
    requires: 0,
    blurb: 'Cold infall. Whatever drifts in is what you get.',
  },
  {
    id: 'helium',
    name: 'Helium',
    symbol: 'He',
    multiplier: 1.35,
    requires: 6e-5,
    blurb: 'Four protons into one nucleus, and a little mass left over as light.',
  },
  {
    id: 'carbon',
    name: 'Carbon',
    symbol: 'C',
    multiplier: 1.8,
    requires: 1.5e-3,
    blurb: 'Three helium nuclei at once — it takes a hotter core to make that likely.',
  },
  {
    id: 'oxygen',
    name: 'Oxygen',
    symbol: 'O',
    multiplier: 2.4,
    requires: 0.03,
    blurb: 'Carbon takes on another helium. The ash of one burn is the fuel of the next.',
  },
  {
    id: 'silicon',
    name: 'Silicon',
    symbol: 'Si',
    multiplier: 3.0,
    requires: 0.6,
    blurb: 'Days, not millennia. Each shell you light burns faster than the last.',
  },
  {
    id: 'iron',
    name: 'Iron',
    symbol: 'Fe',
    multiplier: 3.0,
    requires: null,
    blurb: 'Fusing iron costs energy rather than releasing it. Nothing you build reaches it.',
  },
];

/** Tiers a throughput can actually reach. Iron is not one of them. */
export const REACHABLE_ELEMENTS = ELEMENTS.filter((e) => e.requires !== null);

export function elementAt(tier: number): Element {
  const element = ELEMENTS[Math.max(0, Math.min(ELEMENTS.length - 1, tier))];
  if (!element) throw new Error('The element chain is empty');
  return element;
}

/**
 * The highest tier this throughput holds.
 *
 * `requirementScale` is Magnetic Confinement: holding the burning region together lowers what
 * it takes to keep lit, which is the most direct thing accumulated energy can buy.
 */
export function elementTierFor(diskThroughput: number, requirementScale = 1): number {
  for (let i = REACHABLE_ELEMENTS.length - 1; i >= 0; i--) {
    const requires = REACHABLE_ELEMENTS[i]?.requires;
    if (requires !== null && requires !== undefined && diskThroughput >= requires * requirementScale) {
      return i;
    }
  }
  return 0;
}

/** What the next tier up asks for, or null at the end of what is reachable. */
export function nextRequirement(tier: number, requirementScale = 1): number | null {
  const next = REACHABLE_ELEMENTS[tier + 1];
  if (next?.requires === null || next?.requires === undefined) return null;
  return next.requires * requirementScale;
}
