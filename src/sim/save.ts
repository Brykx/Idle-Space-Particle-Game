import { D, NOTATIONS, type Notation } from './numbers';
import { SAVE_VERSION, cloneState, initialState, type GameState } from './state';
import { REBASED_UPGRADE_IDS, UPGRADE_IDS } from './upgrades';
import { STARDUST_IDS, type StarRecord } from './sky';
import { stageIndexFor } from './stages';
import { ACHIEVEMENTS } from './achievements';
import { TRAITS, capOf, firstCloud, isCloud, type Cloud, type Trait } from './clouds';

/**
 * Serialisation, migration, and the export string.
 *
 * Two rules, learned from every idle game that ever shipped a bad patch:
 * every save carries its version, and every version bump ships a tested migration. The
 * base64 export string is here from day one because it is how players recover from your bugs.
 *
 * There is no anti-cheat. This is single-player; the checksum catches corruption, not people.
 */

export interface SaveBlob {
  version: number;
  [key: string]: unknown;
}

/** from-version -> function producing the next version's shape. */
const MIGRATIONS: Record<number, (raw: SaveBlob) => SaveBlob> = {
  /**
   * 1 -> 2: Particle Density became a rebased upgrade. It resets at every promotion and is
   * repriced to the stage, and the ladder pays a multiplier to make up for what it gives up.
   *
   * A version 1 save holds Density levels bought under flat pricing, which belong to no
   * stage at all. This applies the new rule from where the player is standing: the rebased
   * levels go, and `rebasedStage` records that it has been done so the next tick does not do
   * it again.
   *
   * Zeroing levels in a migration is not something to do lightly, and the alternative was
   * considered: keep them, and credit them to the current stage. That leaves the card priced
   * against a base the player is many orders short of, so it reads as a dead button until
   * the next promotion — a worse outcome that merely looks gentler. Taking the reset up front
   * hands back a card that works, and the promotion multiplier arriving in the same version
   * pays for most of what is lost.
   */
  1: (raw) => {
    const levels = { ...((raw.levels ?? {}) as Record<string, unknown>) };
    // Carried over *before* the reset, so the levels the player bought still count as
    // investment and their auto-buyers survive the migration.
    const levelsEver = { ...levels };
    for (const id of REBASED_UPGRADE_IDS) levels[id] = 0;
    return {
      ...raw,
      version: 2,
      levels,
      levelsEver,
      rebasedStage: stageIndexFor(asDecimal(raw.totalMassEver, '0')),
    };
  },

  /**
   * 2 -> 3: the supernova arrived, and with it Stardust, the permanent tree and a collapse
   * count. Every one of those fields is new and starts at zero, and `deserialize` already
   * defaults anything missing from `initialState`, so there is nothing to move.
   *
   * The entry is here anyway rather than letting `migrate` skip a version. A save format with
   * holes in its migration chain is one where the next additive change looks identical to a
   * forgotten one, and the difference only shows up in somebody's lost save.
   */
  2: (raw) => ({ ...raw, version: 3 }),

  /**
   * 3 -> 4: the game stopped asking for you.
   *
   * Three things change shape. Gravity Pulse no longer pays, so its cooldown and its count
   * have nothing to describe and are simply not carried over. A current flows from its first
   * level rather than its twenty-fifth, and flowing became the default rather than a reward —
   * so every toggle is switched on, including ones the player had off, because under the old
   * rules "off" mostly meant "not yet earned" and the two cannot be told apart from here.
   * The automation is value-aware now, which is what makes that safe: it will not pour mass
   * into a saturated card the way the old one did.
   *
   * And two cards left the tree. Deep Slumber and Muscle Memory each patched a problem this
   * version removes at the source, so what was spent on them is handed back at exactly the
   * prices they were bought at. Those prices are written out here on purpose: a migration
   * that reads today's tables is a migration that silently changes meaning the next time the
   * tables do.
   */
  3: (raw) => {
    const tree = { ...((raw.stardustLevels ?? {}) as Record<string, unknown>) };
    const retired: Array<[id: string, baseCost: number, growth: number]> = [
      ['slumber', 3, 2.6],
      ['memory', 4, 3.4],
    ];
    let refund = D(0);
    for (const [id, baseCost, growth] of retired) {
      const levels = Math.max(0, Math.floor(asFiniteNumber(tree[id], 0)));
      for (let level = 0; level < levels; level++) {
        refund = refund.add(D(baseCost).mul(D(growth).pow(level)).ceil());
      }
      delete tree[id];
    }

    const { pulseReadyAt: _cooldown, ...rest } = raw;
    return {
      ...rest,
      version: 4,
      // Emptied rather than rewritten: a current with no entry flows, which is the default.
      autoBuy: {},
      stardustLevels: tree,
      stardust: asDecimal(raw.stardust, '0').add(refund).toString(),
    };
  },

  /**
   * 4 -> 5: a run became one star, and the sky began to remember.
   *
   * The old Stardust is not the new Stardust. It was paid as a power of mass and ran into the
   * millions; the new one is paid in orders of magnitude and a whole career is a couple of
   * thousand. So it is re-denominated rather than carried: what was ever earned, on a log
   * scale, capped. The old tree's cards no longer exist, so their levels are part of what is
   * re-denominated rather than refunded separately — `stardustEver` already counts them.
   *
   * The run in progress carries on, condensing from the first cloud, which can make a Sun.
   * A save that sat at the top of the old ladder overnight is far past what that cloud holds,
   * so it is brought back to a finished Sun: that star is waiting to be let go. The old
   * collapses become no stars. The sky records what you made, with dates, and inventing
   * entries for it would make it a record of nothing.
   */
  4: (raw) => {
    const ever = asDecimal(raw.stardustEver, '0').max(asDecimal(raw.stardust, '0'));
    const pool = ever.gt(0) ? Math.min(400, Math.floor(40 * ever.add(1).log10())) : 0;

    // A hair inside the line, so a finished star reads as finished whatever the rounding.
    const finished = capOf(firstCloud()).mul(0.9995);
    let totalMassEver = asDecimal(raw.totalMassEver, '0');
    if (totalMassEver.gt(finished)) totalMassEver = finished;
    let mass = asDecimal(raw.mass, '0');
    if (mass.gt(totalMassEver)) mass = totalMassEver;

    const stage = stageIndexFor(totalMassEver);
    const settings = { ...((raw.settings ?? {}) as Record<string, unknown>) };
    // Letters were the default, so a save holding them almost certainly never chose them.
    if (settings.notation === undefined || settings.notation === 'letters') settings.notation = 'words';

    const { collapses: _collapses, ...rest } = raw;
    return {
      ...rest,
      version: 5,
      mass: mass.toString(),
      totalMassEver: totalMassEver.toString(),
      stardust: pool,
      stardustEver: pool,
      stardustLevels: {},
      cloud: firstCloud(),
      runStartedAt: 0,
      sky: [],
      // The ladder moved under this save. Where it now stands is not news, but a class it
      // has newly reached — the ladder is finer than it was — is worth announcing.
      stageSeen: Math.min(Math.floor(asFiniteNumber(raw.stageSeen, stage)), stage),
      rebasedStage: stage,
      settings,
    };
  },
};

export function serialize(s: GameState): SaveBlob {
  return {
    version: SAVE_VERSION,
    mass: s.mass.toString(),
    totalMassEver: s.totalMassEver.toString(),
    energy: s.energy.toString(),
    totalEnergyEver: s.totalEnergyEver.toString(),
    levels: { ...s.levels },
    levelsEver: { ...s.levelsEver },
    autoBuy: { ...s.autoBuy },
    achievements: [...s.achievements],
    cloud: s.cloud ? { ...s.cloud } : null,
    runStartedAt: s.runStartedAt,
    skySeed: s.skySeed,
    sky: s.sky.map((star) => ({ ...star })),
    stardust: s.stardust,
    stardustEver: s.stardustEver,
    stardustLevels: { ...s.stardustLevels },
    playTime: s.playTime,
    stageSeen: s.stageSeen,
    rebasedStage: s.rebasedStage,
    lastSeen: s.lastSeen,
    settings: { ...s.settings },
    stats: { ...s.stats },
  };
}

function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** A star from a save, or null if it is not one this build can draw and count. */
function asStarRecord(v: unknown): StarRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.stage !== 'string' || typeof r.cloud !== 'string') return null;
  const id = Math.floor(asFiniteNumber(r.id, 0));
  if (id < 1) return null;
  const unit = (x: unknown) => Math.min(1, Math.max(0, asFiniteNumber(x, 0.5)));
  return {
    id,
    name: r.name.slice(0, 24) || r.cloud,
    stage: r.stage,
    orders: Math.max(0, asFiniteNumber(r.orders, 0)),
    completed: r.completed === true,
    stardust: Math.max(0, Math.floor(asFiniteNumber(r.stardust, 0))),
    seconds: Math.max(0, asFiniteNumber(r.seconds, 0)),
    releasedAt: asFiniteNumber(r.releasedAt, 0),
    cloud: r.cloud,
    hue: ((asFiniteNumber(r.hue, 214) % 360) + 360) % 360,
    trait: (TRAITS as readonly string[]).includes(r.trait as string) ? (r.trait as Trait) : 'quiet',
    x: unit(r.x),
    y: unit(r.y),
  };
}

/** Only the fields a cloud has, so a save cannot smuggle anything else into the state. */
function asCloud(v: unknown): Cloud | null {
  if (!isCloud(v)) return null;
  return { seed: v.seed >>> 0, name: v.name, ceiling: v.ceiling, pace: v.pace, trait: v.trait, hue: v.hue };
}

function asDecimal(v: unknown, fallback: string) {
  try {
    const d = D(typeof v === 'string' || typeof v === 'number' ? v : fallback);
    return Number.isFinite(d.mantissa) ? d : D(fallback);
  } catch {
    return D(fallback);
  }
}

export function migrate(raw: SaveBlob): SaveBlob {
  let blob = raw;
  let guard = 0;
  while (blob.version < SAVE_VERSION) {
    const step = MIGRATIONS[blob.version];
    if (!step) throw new Error(`No migration from save version ${blob.version}`);
    blob = step(blob);
    if (++guard > 64) throw new Error('Migration loop did not terminate');
  }
  if (blob.version > SAVE_VERSION) {
    throw new Error(`Save is from a newer version (${blob.version}) than this build`);
  }
  return blob;
}

/**
 * Rebuild a state from a blob. Every field is defaulted from `initialState`, so a save
 * written before a field existed loads cleanly rather than producing `undefined` arithmetic.
 */
export function deserialize(raw: unknown, now = Date.now()): GameState {
  if (typeof raw !== 'object' || raw === null) throw new Error('Save is not an object');
  const blob = migrate(raw as SaveBlob);
  const base = initialState(now);

  const levelsRaw = (blob.levels ?? {}) as Record<string, unknown>;
  const everRaw = (blob.levelsEver ?? {}) as Record<string, unknown>;
  const autoBuyRaw = (blob.autoBuy ?? {}) as Record<string, unknown>;
  for (const id of UPGRADE_IDS) {
    const level = Math.max(0, Math.floor(asFiniteNumber(levelsRaw[id], 0)));
    base.levels[id] = level;
    // Never below the current level: a save that predates this field, or one that lost it,
    // should not read as less invested than it plainly is.
    base.levelsEver[id] = Math.max(level, Math.floor(asFiniteNumber(everRaw[id], 0)));
    // Flowing unless the save says it is held: an upgrade the save has never heard of
    // should behave the way a new one does.
    base.autoBuy[id] = autoBuyRaw[id] !== false;
  }

  // Only ids this build knows about: an achievement removed in a later version should not
  // linger in the save handing out a multiplier for something that no longer exists.
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = Array.isArray(blob.achievements)
    ? [...new Set(blob.achievements.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : [];

  const stardustRaw = (blob.stardustLevels ?? {}) as Record<string, unknown>;
  const stardustLevels = { ...base.stardustLevels };
  for (const id of STARDUST_IDS) {
    stardustLevels[id] = Math.max(0, Math.floor(asFiniteNumber(stardustRaw[id], 0)));
  }

  const settings = (blob.settings ?? {}) as Record<string, unknown>;
  const stats = (blob.stats ?? {}) as Record<string, unknown>;
  const totalMassEver = asDecimal(blob.totalMassEver, '0');

  const sky = Array.isArray(blob.sky)
    ? blob.sky.map(asStarRecord).filter((star): star is StarRecord => star !== null)
    : [];
  // Null is a state — between stars, choosing the next — and is kept as one. Anything else
  // that is not a cloud is a damaged save: a first star gets the first cloud back, and a
  // later one is offered a choice rather than handed a cloud it never picked.
  const cloud = blob.cloud === null ? null : (asCloud(blob.cloud) ?? (sky.length === 0 ? firstCloud() : null));
  const stardust = Math.max(0, Math.floor(asFiniteNumber(Number(blob.stardust), 0)));
  const playTime = Math.max(0, asFiniteNumber(blob.playTime, 0));

  return {
    ...base,
    mass: asDecimal(blob.mass, '0'),
    totalMassEver,
    energy: asDecimal(blob.energy, '0'),
    totalEnergyEver: asDecimal(blob.totalEnergyEver, '0'),
    playTime,
    // A save written before stages existed should not announce a backlog of them on load.
    stageSeen: Math.max(0, Math.floor(asFiniteNumber(blob.stageSeen, stageIndexFor(totalMassEver)))),
    // Defaulting to the current stage, not to zero: a save that somehow lost this field
    // should not wipe the player's rebased levels on the next tick for no reason.
    rebasedStage: Math.max(0, Math.floor(asFiniteNumber(blob.rebasedStage, stageIndexFor(totalMassEver)))),
    achievements,
    cloud,
    runStartedAt: Math.min(playTime, Math.max(0, asFiniteNumber(blob.runStartedAt, 0))),
    skySeed: Math.floor(asFiniteNumber(blob.skySeed, base.skySeed)) >>> 0,
    sky,
    stardust,
    stardustEver: Math.max(stardust, Math.floor(asFiniteNumber(Number(blob.stardustEver), 0))),
    stardustLevels,
    lastSeen: asFiniteNumber(blob.lastSeen, now),
    settings: {
      notation: NOTATIONS.includes(settings.notation as Notation)
        ? (settings.notation as Notation)
        : base.settings.notation,
      particleBudget: Math.min(20000, Math.max(0, asFiniteNumber(settings.particleBudget, base.settings.particleBudget))),
      reducedMotion: settings.reducedMotion === true,
      autoBuyReserve: Math.min(0.9, Math.max(0, asFiniteNumber(settings.autoBuyReserve, 0))),
    },
    stats: {
      startedAt: asFiniteNumber(stats.startedAt, base.stats.startedAt),
      purchases: Math.max(0, Math.floor(asFiniteNumber(stats.purchases, 0))),
      longestAway: Math.max(0, asFiniteNumber(stats.longestAway, 0)),
      exports: Math.max(0, Math.floor(asFiniteNumber(stats.exports, 0))),
    },
  };
}

/** FNV-1a. Detects a truncated or mangled export string; it is not a security measure. */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const EXPORT_PREFIX = 'ISPG1|';

/** A paste-able save string: prefix, checksum, base64 of the JSON. */
export function exportSave(s: GameState): string {
  s.stats.exports += 1;
  const json = JSON.stringify(serialize(s));
  const body = btoa(unescape(encodeURIComponent(json)));
  return `${EXPORT_PREFIX}${checksum(json)}|${body}`;
}

export function importSave(text: string, now = Date.now()): GameState {
  const trimmed = text.trim();
  if (!trimmed.startsWith(EXPORT_PREFIX)) throw new Error('That does not look like a save string');

  const parts = trimmed.slice(EXPORT_PREFIX.length).split('|');
  const sum = parts[0];
  const body = parts[1];
  if (!sum || !body) throw new Error('Save string is incomplete');

  let json: string;
  try {
    json = decodeURIComponent(escape(atob(body)));
  } catch {
    throw new Error('Save string is not valid base64');
  }
  if (checksum(json) !== sum) throw new Error('Save string is corrupted');

  return deserialize(JSON.parse(json), now);
}

/** Convenience for tests and for "reset but keep my settings". */
export function resetKeepingSettings(s: GameState, now = Date.now()): GameState {
  const fresh = initialState(now);
  fresh.settings = { ...s.settings };
  return cloneState(fresh);
}
