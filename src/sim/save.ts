import { D } from './numbers';
import { SAVE_VERSION, cloneState, initialState, type GameState } from './state';
import { REBASED_UPGRADE_IDS, UPGRADE_IDS } from './upgrades';
import { stageIndexFor } from './stages';
import { ACHIEVEMENTS } from './achievements';

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
    playTime: s.playTime,
    pulseReadyAt: s.pulseReadyAt,
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
    base.autoBuy[id] = autoBuyRaw[id] === true;
  }

  // Only ids this build knows about: an achievement removed in a later version should not
  // linger in the save handing out a multiplier for something that no longer exists.
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = Array.isArray(blob.achievements)
    ? [...new Set(blob.achievements.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : [];

  const settings = (blob.settings ?? {}) as Record<string, unknown>;
  const stats = (blob.stats ?? {}) as Record<string, unknown>;
  const totalMassEver = asDecimal(blob.totalMassEver, '0');

  return {
    ...base,
    mass: asDecimal(blob.mass, '0'),
    totalMassEver,
    energy: asDecimal(blob.energy, '0'),
    totalEnergyEver: asDecimal(blob.totalEnergyEver, '0'),
    playTime: Math.max(0, asFiniteNumber(blob.playTime, 0)),
    pulseReadyAt: Math.max(0, asFiniteNumber(blob.pulseReadyAt, 0)),
    // A save written before stages existed should not announce a backlog of them on load.
    stageSeen: Math.max(0, Math.floor(asFiniteNumber(blob.stageSeen, stageIndexFor(totalMassEver)))),
    // Defaulting to the current stage, not to zero: a save that somehow lost this field
    // should not wipe the player's rebased levels on the next tick for no reason.
    rebasedStage: Math.max(0, Math.floor(asFiniteNumber(blob.rebasedStage, stageIndexFor(totalMassEver)))),
    achievements,
    lastSeen: asFiniteNumber(blob.lastSeen, now),
    settings: {
      notation:
        settings.notation === 'scientific' || settings.notation === 'engineering' || settings.notation === 'letters'
          ? settings.notation
          : base.settings.notation,
      particleBudget: Math.min(20000, Math.max(0, asFiniteNumber(settings.particleBudget, base.settings.particleBudget))),
      reducedMotion: settings.reducedMotion === true,
      autoBuyReserve: Math.min(0.9, Math.max(0, asFiniteNumber(settings.autoBuyReserve, 0))),
    },
    stats: {
      startedAt: asFiniteNumber(stats.startedAt, base.stats.startedAt),
      pulses: Math.max(0, Math.floor(asFiniteNumber(stats.pulses, 0))),
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
