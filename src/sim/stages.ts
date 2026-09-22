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

export interface StageLook {
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
   * fewer**. Dust is a haze of specks that barely fall; Planet is sparse traffic of
   * individually visible meteors; Supergiant swallows moons a couple at a time.
   *
   * Count falls close to the inverse square of size, so the total lit *area* rises only about
   * twofold across the whole ladder. That constraint is load-bearing, because the field blends
   * additively: let the area climb freely and the late game is a white blowout, hold it exactly
   * flat and the late game feels no weightier than the early.
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
    look: { core: 0x8892a6, particle: 0x9fc6ff, scale: 0.02,
      particleSize: 0.3,
      particleCount: 8.0,
      orbit: [0.6, 0.9],
      drag: 0.06,
      lifetime: 26,
    },
  },
  {
    id: 'pebble',
    name: 'Pebble',
    threshold: D(100),
    blurb: 'Enough grains to be a thing. Gravity is still a rumour.',
    analogue: 'a handful of gravel',
    look: { core: 0x9a8f80, particle: 0xb8c8e8, scale: 0.05,
      particleSize: 0.4,
      particleCount: 5.5,
      orbit: [0.55, 0.85],
      drag: 0.09,
      lifetime: 23,
    },
  },
  {
    id: 'boulder',
    name: 'Boulder',
    threshold: D(2e3),
    blurb: 'Loose rock, held together by contact rather than by you.',
    analogue: 'a boulder',
    look: { core: 0xa08b74, particle: 0xc2cfe6, scale: 0.09,
      particleSize: 0.55,
      particleCount: 3.4,
      orbit: [0.5, 0.8],
      drag: 0.12,
      lifetime: 20,
    },
  },
  {
    id: 'planetesimal',
    name: 'Planetesimal',
    threshold: D(4e4),
    blurb: 'A kilometre across. For the first time, what holds you together is your own gravity.',
    analogue: 'a 1 km planetesimal',
    look: { core: 0xb09070, particle: 0xcdd8ea, scale: 0.14,
      particleSize: 0.7,
      particleCount: 2.3,
      orbit: [0.45, 0.74],
      drag: 0.15,
      lifetime: 18,
    },
  },
  {
    id: 'asteroid',
    name: 'Asteroid',
    threshold: D(6e5),
    blurb: 'Heavy enough to sweep your own lane of the cloud clean.',
    analogue: 'Ceres',
    look: { core: 0xbda183, particle: 0xd6dcec, scale: 0.2,
      particleSize: 0.9,
      particleCount: 1.5,
      orbit: [0.4, 0.68],
      drag: 0.19,
      lifetime: 16,
    },
  },
  {
    id: 'protoplanet',
    name: 'Protoplanet',
    threshold: D(1.5e7),
    blurb: 'Heavy enough to pull yourself round. Gravity has started winning arguments.',
    analogue: 'the Moon',
    look: { core: 0xc9b193, particle: 0xdde0ee, scale: 0.28,
      particleSize: 1.15,
      particleCount: 0.98,
      orbit: [0.35, 0.62],
      drag: 0.23,
      lifetime: 15,
    },
  },
  {
    id: 'planet',
    name: 'Planet',
    threshold: D(6e8),
    blurb: 'Rock and metal, settled into layers. The heavy things have sunk to the middle.',
    analogue: 'Earth',
    look: { core: 0x6fa8dc, particle: 0xbfe0ff, scale: 0.38,
      particleSize: 1.6,
      particleCount: 0.54,
      orbit: [0.3, 0.55],
      drag: 0.28,
      lifetime: 13,
    },
  },
  {
    id: 'gasGiant',
    name: 'Gas Giant',
    threshold: D(4e10),
    blurb: 'The hydrogen stops escaping. You begin to keep what you catch.',
    analogue: 'Jupiter',
    look: { core: 0xd9a066, particle: 0xffd9a0, scale: 0.52,
      particleSize: 2.0,
      particleCount: 0.37,
      orbit: [0.26, 0.48],
      drag: 0.33,
      lifetime: 12,
    },
  },
  {
    id: 'brownDwarf',
    name: 'Brown Dwarf',
    threshold: D(4e12),
    blurb: 'Thirteen Jupiters. The core is hot enough to burn deuterium — not a star yet, but no longer cold.',
    analogue: '13 Jupiter masses',
    look: { core: 0xb05a3c, particle: 0xffb98a, scale: 0.64,
      particleSize: 2.5,
      particleCount: 0.25,
      orbit: [0.22, 0.42],
      drag: 0.38,
      lifetime: 11,
    },
  },
  {
    id: 'redDwarf',
    name: 'Red Dwarf',
    threshold: D(6e14),
    blurb: 'Eighty Jupiters. Hydrogen fusion holds against your own weight. You are a star.',
    analogue: '0.08 solar masses',
    look: { core: 0xff7a45, particle: 0xffc08a, scale: 0.74,
      particleSize: 3.0,
      particleCount: 0.185,
      orbit: [0.18, 0.37],
      drag: 0.44,
      lifetime: 10,
    },
  },
  {
    id: 'star',
    name: 'Star',
    threshold: D(1.2e17),
    blurb: 'Hydrogen to helium, steadily, for a long time. The cloud around you is lit from inside now.',
    analogue: 'the Sun',
    look: { core: 0xfff3c4, particle: 0xffe6b0, scale: 0.86,
      particleSize: 3.6,
      particleCount: 0.137,
      orbit: [0.15, 0.32],
      drag: 0.5,
      lifetime: 9,
    },
  },
  {
    id: 'supergiant',
    name: 'Supergiant',
    threshold: D(1.5e19),
    blurb: 'Carbon, oxygen, silicon. Each shell you light burns faster than the last, and iron is waiting.',
    analogue: '20 solar masses',
    look: { core: 0xffb347, particle: 0xffd0a0, scale: 1,
      particleSize: 4.2,
      particleCount: 0.107,
      orbit: [0.12, 0.28],
      drag: 0.58,
      lifetime: 8,
    },
  },

  // --- reached by collapse, not by accretion (Phase 3) -------------------------------
  {
    id: 'neutronStar',
    name: 'Neutron Star',
    threshold: null,
    blurb: 'What the supernova left. A fraction of the mass, in a city-sized ball, spinning fast.',
    analogue: '1.4 solar masses',
    look: { core: 0xdfefff, particle: 0xcfe2ff, scale: 0.12,
      particleSize: 1.2,
      particleCount: 1.1,
      orbit: [0.1, 0.24],
      drag: 0.7,
      lifetime: 9,
    },
  },
  {
    id: 'blackHole',
    name: 'Black Hole',
    threshold: null,
    blurb: 'Past the Tolman-Oppenheimer-Volkoff limit, nothing holds. Not even light leaves.',
    analogue: 'beyond 2.3 solar masses',
    look: { core: 0x1a1626, particle: 0xd8b8ff, scale: 0.45,
      particleSize: 2.0,
      particleCount: 0.6,
      orbit: [0.08, 0.2],
      drag: 0.8,
      lifetime: 10,
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
