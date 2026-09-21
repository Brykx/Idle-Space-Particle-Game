import { D } from './numbers';
import { SAVE_VERSION, cloneState, initialState, type GameState } from './state';
import { UPGRADE_IDS } from './upgrades';

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
  // 1 -> 2 will live here.
};

export function serialize(s: GameState): SaveBlob {
  return {
    version: SAVE_VERSION,
    mass: s.mass.toString(),
    totalMassEver: s.totalMassEver.toString(),
    levels: { ...s.levels },
    playTime: s.playTime,
    pulseReadyAt: s.pulseReadyAt,
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
  for (const id of UPGRADE_IDS) {
    base.levels[id] = Math.max(0, Math.floor(asFiniteNumber(levelsRaw[id], 0)));
  }

  const settings = (blob.settings ?? {}) as Record<string, unknown>;
  const stats = (blob.stats ?? {}) as Record<string, unknown>;

  return {
    ...base,
    mass: asDecimal(blob.mass, '0'),
    totalMassEver: asDecimal(blob.totalMassEver, '0'),
    playTime: Math.max(0, asFiniteNumber(blob.playTime, 0)),
    pulseReadyAt: Math.max(0, asFiniteNumber(blob.pulseReadyAt, 0)),
    lastSeen: asFiniteNumber(blob.lastSeen, now),
    settings: {
      notation:
        settings.notation === 'scientific' || settings.notation === 'engineering' || settings.notation === 'letters'
          ? settings.notation
          : base.settings.notation,
      particleBudget: Math.min(20000, Math.max(0, asFiniteNumber(settings.particleBudget, base.settings.particleBudget))),
      reducedMotion: settings.reducedMotion === true,
    },
    stats: {
      startedAt: asFiniteNumber(stats.startedAt, base.stats.startedAt),
      pulses: Math.max(0, Math.floor(asFiniteNumber(stats.pulses, 0))),
      purchases: Math.max(0, Math.floor(asFiniteNumber(stats.purchases, 0))),
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
