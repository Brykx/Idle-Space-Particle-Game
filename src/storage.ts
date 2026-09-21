/**
 * localStorage, defensively.
 *
 * Every accessor can throw — private windows, blocked site data, a quota that fills. A save
 * system that throws on read is worse than one that returns null, so none of it escapes.
 */

const KEY = 'idle-space-particle-game';

export function readSave(): unknown | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeSave(blob: unknown): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing useful to do */
  }
}
