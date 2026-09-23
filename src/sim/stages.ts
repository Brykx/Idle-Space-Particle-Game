import { D, type Num } from './numbers';

/**
 * The stage ladder: what the thing in the middle of the screen currently is.
 *
 * Driven by `totalMassEver`, not by current mass, so spending never demotes your core.
 * You built those upgrades out of what you caught; the core keeps what it was.
 *
 * The physics is mostly honest. Dust through planet is core accretion, and planet through
 * star works as long as what you are accreting is hydrogen — a rocky planet does not become
 * a star by putting on more rock, but a gas giant can ladder up through brown dwarf to red
 * dwarf, and those thresholds are real.
 *
 * The ladder breaks exactly once, between star and neutron star, and it breaks in a useful
 * direction: a star does not become a neutron star by gaining mass, it runs out of fuel and
 * blows roughly ninety percent of itself away. Mass goes *down* by more than an order of
 * magnitude. That is a prestige reset, which is why the last two stages here carry no
 * threshold — they arrive with the supernova in Phase 3, not by accretion.
 */

/**
 * What the core is made of, which decides how it is drawn.
 *
 * Solid kinds carry a silhouette and a dark side; luminous ones glow. A single soft gradient
 * for all fourteen was why the early ladder looked washed — additively blended light cannot
 * be dark anywhere, so a boulder could never look like a boulder.
 */
export type BodyKind = 'mote' | 'rock' | 'world' | 'gas' | 'ember' | 'star' | 'remnant' | 'hole';

/** What a single infalling particle is: a speck of dust, a grain, or a lit body. */
export type GrainKind = 'mote' | 'grit' | 'rock';

export interface StageLook {
  /** Which family of body this stage is, and therefore how it is rendered. */
  body: BodyKind;
  /** Packed RGB for the core itself. */
  core: number;
  /** Packed RGB for the particles falling in. */
  particle: number;
  /** 0..1, mapped to a drawn radius by the renderer. */
  scale: number;

  /**
   * Sprite size multiplier, and a multiplier on how many are emitted.
   *
   * These two are one rule, not two settings: as the core climbs, particles get **bigger and
   * fewer**. Dust is a haze of specks that barely fall; Supergiant is sparse traffic of
   * individually visible bodies falling into something enormous.
   *
   * The first pass at this took the idea much further — 14x the size and a seventieth of the
   * count — and it was wrong in a way that only showed once the particles became lit rocks
   * rather than white dots. A solar system does not read as a star surrounded by moons. It
   * reads as a *large* central body and *small* traffic, and the moment the sprites had
   * silhouettes, boulders the size of the star stopped looking like scale and started looking
   * like a mistake. Size now grows about fivefold across the ladder, not fourteen.
   *
   * Count falls close to the inverse square of size, so the total lit *area* stays roughly
   * flat. That constraint is load-bearing at the early stages, where the field blends
   * additively: let the area climb freely and the mid game is a white blowout.
   *
   * At the dust end the count is larger than the pool can hold, which is the intended result —
   * dust saturates the particle budget, and the budget slider is what decides how thick it
   * actually looks.
   */
  particleSize: number;
  particleCount: number;

  /**
   * Tangential speed of a capture trajectory, as a fraction of the local circular-orbit speed,
   * sampled between the two. Near 1 it holds an orbit and loiters; near 0 it drops straight in.
   */
  orbit: [number, number];

  /** Per-second damping on capture trajectories. Low values loiter, high values fall hard. */
  drag: number;

  /** Seconds before an unabsorbed particle gives up. Long enough early to allow real orbits. */
  lifetime: number;

  /**
   * How far out the field reaches, as a fraction of the screen's own reach.
   *
   * The last piece of field identity, and it says the same thing the other four do from a
   * different direction. Dust is a cloud you are sitting inside: it fills the frame and comes
   * from everywhere. A supergiant's traffic is close-in and fast — a handful of bodies on
   * tight orbits, with the far field empty because anything out there was swept up long ago.
   *
   * Narrowing it also buys back what bigger particles cost. Late-stage bodies are drawn many
   * times the size of a dust mote, so spreading the same few of them over the whole screen is
   * what makes the top of the ladder look emptier than the bottom despite weighing more.
   */
  width: number;

  /**
   * What the infalling matter is made of, and therefore how a single particle is drawn.
   *
   * The same argument as `BodyKind`, one level down. A cloud of dust and a stream of
   * meteoroids are not the same thing scaled, and drawing both as a soft white dot made the
   * late ladder read as fog blowing past a star rather than as a system sweeping up what is
   * left of its own disc.
   */
  grain: GrainKind;

  /**
   * How far the field is tilted out of face-on, 0 to 1.
   *
   * A cloud has no plane; a system does. Dust stays face-on and isotropic — it is a cloud you
   * are sitting inside, and that is the one stage of the field nobody wanted changed. From
   * the first solid body onwards the field flattens towards a disc seen from above its plane,
   * which is both what accretion actually does and the single strongest signal that what you
   * are looking at is a solar system rather than a snowstorm.
   */
  tilt: number;
}

export interface Stage {
  id: string;
  name: string;
  /**
   * Total mass ever needed to reach it. `null` means it is not reached by accretion at all —
   * it arrives through a collapse.
   */
  threshold: Num | null;
  /** Shown once, when you arrive. */
  blurb: string;
  /** What this would weigh in the real world. */
  analogue: string;
  look: StageLook;
}

export const STAGES: Stage[] = [
  {
    id: 'dust',
    name: 'Dust',
    threshold: D(0),
    blurb: 'Grains too light to pull on anything. They stick to each other; they do not fall.',
    analogue: 'a grain of interstellar dust',
    look: { body: 'mote', core: 0x8892a6, particle: 0x9fc6ff, scale: 0.02,
      particleSize: 0.3,
      particleCount: 9.0,
      orbit: [0.6, 0.9],
      drag: 0.06,
      lifetime: 26,
      width: 1.0,
      grain: 'mote',
      tilt: 0,
    },
  },
  {
    id: 'pebble',
    name: 'Pebble',
    threshold: D(100),
    blurb: 'Enough grains to be a thing. Gravity is still a rumour.',
    analogue: 'a handful of gravel',
    look: { body: 'rock', core: 0x9a8f80, particle: 0xb8c8e8, scale: 0.05,
      particleSize: 0.36,
      particleCount: 7.0,
      orbit: [0.55, 0.85],
      drag: 0.09,
      lifetime: 23,
      width: 0.97,
      grain: 'mote',
      tilt: 0.08,
    },
  },
  {
    id: 'boulder',
    name: 'Boulder',
    threshold: D(2e3),
    blurb: 'Loose rock, held together by contact rather than by you.',
    analogue: 'a boulder',
    look: { body: 'rock', core: 0xa08b74, particle: 0xc2cfe6, scale: 0.09,
      particleSize: 0.45,
      particleCount: 5.2,
      orbit: [0.5, 0.8],
      drag: 0.12,
      lifetime: 20,
      width: 0.93,
      grain: 'grit',
      tilt: 0.2,
    },
  },
  {
    id: 'planetesimal',
    name: 'Planetesimal',
    threshold: D(4e4),
    blurb: 'A kilometre across. For the first time, what holds you together is your own gravity.',
    analogue: 'a 1 km planetesimal',
    look: { body: 'rock', core: 0xb09070, particle: 0xcdd8ea, scale: 0.14,
      particleSize: 0.55,
      particleCount: 4.0,
      orbit: [0.45, 0.74],
      drag: 0.15,
      lifetime: 18,
      width: 0.88,
      grain: 'grit',
      tilt: 0.3,
    },
  },
  {
    id: 'asteroid',
    name: 'Asteroid',
    threshold: D(6e5),
    blurb: 'Heavy enough to sweep your own lane of the cloud clean.',
    analogue: 'Ceres',
    look: { body: 'rock', core: 0xbda183, particle: 0xd6dcec, scale: 0.2,
      particleSize: 0.66,
      particleCount: 3.1,
      orbit: [0.4, 0.68],
      drag: 0.19,
      lifetime: 16,
      width: 0.83,
      grain: 'grit',
      tilt: 0.38,
    },
  },
  {
    id: 'protoplanet',
    name: 'Protoplanet',
    threshold: D(1.5e7),
    blurb: 'Heavy enough to pull yourself round. Gravity has started winning arguments.',
    analogue: 'the Moon',
    look: { body: 'world', core: 0xc9b193, particle: 0xdde0ee, scale: 0.28,
      particleSize: 0.78,
      particleCount: 2.4,
      orbit: [0.35, 0.62],
      drag: 0.23,
      lifetime: 15,
      width: 0.78,
      grain: 'rock',
      tilt: 0.46,
    },
  },
  {
    id: 'planet',
    name: 'Planet',
    threshold: D(6e8),
    blurb: 'Rock and metal, settled into layers. The heavy things have sunk to the middle.',
    analogue: 'Earth',
    look: { body: 'world', core: 0x6fa8dc, particle: 0xbfe0ff, scale: 0.38,
      particleSize: 0.92,
      particleCount: 1.9,
      orbit: [0.3, 0.55],
      drag: 0.28,
      lifetime: 13,
      width: 0.72,
      grain: 'rock',
      tilt: 0.53,
    },
  },
  {
    id: 'gasGiant',
    name: 'Gas Giant',
    threshold: D(4e10),
    blurb: 'The hydrogen stops escaping. You begin to keep what you catch.',
    analogue: 'Jupiter',
    look: { body: 'gas', core: 0xd9a066, particle: 0xffd9a0, scale: 0.52,
      particleSize: 1.05,
      particleCount: 1.5,
      orbit: [0.26, 0.48],
      drag: 0.33,
      lifetime: 12,
      width: 0.66,
      grain: 'rock',
      tilt: 0.58,
    },
  },
  {
    id: 'brownDwarf',
    name: 'Brown Dwarf',
    threshold: D(4e12),
    blurb: 'Thirteen Jupiters. The core is hot enough to burn deuterium — not a star yet, but no longer cold.',
    analogue: '13 Jupiter masses',
    look: { body: 'ember', core: 0xb05a3c, particle: 0xffb98a, scale: 0.64,
      particleSize: 1.18,
      particleCount: 1.2,
      orbit: [0.22, 0.42],
      drag: 0.38,
      lifetime: 11,
      width: 0.6,
      grain: 'rock',
      tilt: 0.62,
    },
  },
  {
    id: 'redDwarf',
    name: 'Red Dwarf',
    threshold: D(6e14),
    blurb: 'Eighty Jupiters. Hydrogen fusion holds against your own weight. You are a star.',
    analogue: '0.08 solar masses',
    look: { body: 'star', core: 0xff7a45, particle: 0xffc08a, scale: 0.74,
      particleSize: 1.3,
      particleCount: 1.0,
      orbit: [0.18, 0.37],
      drag: 0.44,
      lifetime: 10,
      width: 0.55,
      grain: 'rock',
      tilt: 0.66,
    },
  },
  {
    id: 'star',
    name: 'Star',
    threshold: D(1.2e17),
    blurb: 'Hydrogen to helium, steadily, for a long time. The cloud around you is lit from inside now.',
    analogue: 'the Sun',
    look: { body: 'star', core: 0xfff3c4, particle: 0xffe6b0, scale: 0.86,
      particleSize: 1.4,
      particleCount: 0.87,
      orbit: [0.15, 0.32],
      drag: 0.5,
      lifetime: 9,
      width: 0.5,
      grain: 'rock',
      tilt: 0.69,
    },
  },
  {
    id: 'supergiant',
    name: 'Supergiant',
    threshold: D(1.5e19),
    blurb: 'Carbon, oxygen, silicon. Each shell you light burns faster than the last, and iron is waiting.',
    analogue: '20 solar masses',
    look: { body: 'star', core: 0xffb347, particle: 0xffd0a0, scale: 1,
      particleSize: 1.5,
      particleCount: 0.77,
      orbit: [0.12, 0.28],
      drag: 0.58,
      lifetime: 8,
      width: 0.46,
      grain: 'rock',
      tilt: 0.72,
    },
  },

  // --- reached by collapse, not by accretion (Phase 3) -------------------------------
  {
    id: 'neutronStar',
    name: 'Neutron Star',
    threshold: null,
    blurb: 'What the supernova left. A fraction of the mass, in a city-sized ball, spinning fast.',
    analogue: '1.4 solar masses',
    look: { body: 'remnant', core: 0xdfefff, particle: 0xcfe2ff, scale: 0.12,
      particleSize: 1.1,
      particleCount: 1.5,
      orbit: [0.1, 0.24],
      drag: 0.7,
      lifetime: 9,
      width: 0.62,
      grain: 'rock',
      tilt: 0.74,
    },
  },
  {
    id: 'blackHole',
    name: 'Black Hole',
    threshold: null,
    blurb: 'Past the Tolman-Oppenheimer-Volkoff limit, nothing holds. Not even light leaves.',
    analogue: 'beyond 2.3 solar masses',
    look: { body: 'hole', core: 0x1a1626, particle: 0xd8b8ff, scale: 0.45,
      particleSize: 1.35,
      particleCount: 1.0,
      orbit: [0.08, 0.2],
      drag: 0.8,
      lifetime: 10,
      width: 0.8,
      grain: 'rock',
      tilt: 0.8,
    },
  },
];

/** Stages you can reach by accreting. The tail of the ladder arrives with the supernova. */
export const ACCRETION_STAGES: Stage[] = STAGES.filter((s) => s.threshold !== null);

export function stageAt(index: number): Stage {
  const stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
  // The ladder is a non-empty literal, so this is only for the type checker.
  if (!stage) throw new Error('The stage ladder is empty');
  return stage;
}

/** The highest accretion stage reached at this lifetime mass. */
export function stageIndexFor(totalMassEver: Num): number {
  for (let i = ACCRETION_STAGES.length - 1; i >= 0; i--) {
    const threshold = ACCRETION_STAGES[i]?.threshold;
    if (threshold && totalMassEver.gte(threshold)) return i;
  }
  return 0;
}

/**
 * How much more a rebased upgrade costs at this stage than at the bottom of the ladder.
 *
 * Taken from the ladder's own thresholds rather than from a constant. An upgrade that resets
 * every promotion has to be repriced every promotion too, or the reset is theatre: at
 * Supergiant, two hundred levels from a base of 30 mass is free. Tying the price to the
 * threshold means moving a threshold moves the pricing with it, instead of silently changing
 * how many levels a stage is worth buying.
 *
 * Tracking wealth exactly (this ratio, not some power of it) is the point: a rebased upgrade
 * should be worth about the same number of levels at every stage, so its contribution stops
 * compounding across the run. What it gives up is paid back by the promotion multiplier.
 */
export function costScaleAt(index: number): Num {
  const anchor = ACCRETION_STAGES[1]?.threshold;
  const here = ACCRETION_STAGES[Math.max(0, Math.min(ACCRETION_STAGES.length - 1, index))]?.threshold;
  if (!anchor || !here || here.lte(anchor)) return D(1);
  return here.div(anchor);
}

export interface StageProgress {
  index: number;
  stage: Stage;
  /** The next accretion stage, or null at the top of the ladder. */
  next: Stage | null;
  /** 0..1 across the gap to `next`, measured in orders of magnitude. */
  fraction: number;
}

export function stageProgress(totalMassEver: Num): StageProgress {
  const index = stageIndexFor(totalMassEver);
  const stage = stageAt(index);
  const next = ACCRETION_STAGES[index + 1] ?? null;

  if (!next || !next.threshold) return { index, stage, next: null, fraction: 1 };

  // Measured in orders of magnitude, because that is how the mass actually moves.
  const here = totalMassEver.lte(1) ? 0 : totalMassEver.log10();
  const from = stage.threshold && stage.threshold.gt(1) ? stage.threshold.log10() : 0;
  const to = next.threshold.log10();

  const span = to - from;
  const fraction = span <= 0 ? 1 : (here - from) / span;
  return { index, stage, next, fraction: Math.max(0, Math.min(1, fraction)) };
}
