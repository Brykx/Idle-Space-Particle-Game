import Decimal from 'break_infinity.js';

/**
 * Big numbers, and how they get shown.
 *
 * `break_infinity.js` stores a mantissa and an exponent in two floats, which is exactly the
 * trade this game wants: unlimited range, 17 significant digits, no allocation storms. Only
 * `sim/` uses it. The renderer works in plain floats, because nothing on screen needs more
 * than six digits.
 */

export type Num = Decimal;

export const D = (v: Decimal | number | string): Decimal => new Decimal(v);

export const ZERO = D(0);
export const ONE = D(1);

export type Notation = 'words' | 'scientific' | 'engineering' | 'letters';

export const NOTATIONS: readonly Notation[] = ['words', 'letters', 'scientific', 'engineering'];

/**
 * Short-scale names, a thousand apart. Mass on the main sequence stops in the undecillions;
 * the rest are here so a number never falls off the end of the list mid-run.
 */
const WORDS = [
  '', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
  'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion', 'undecillion',
  'duodecillion', 'tredecillion', 'quattuordecillion', 'quindecillion', 'sexdecillion',
  'septendecillion', 'octodecillion', 'novemdecillion', 'vigintillion',
] as const;

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  const digits = String(Math.abs(n))
    .split('')
    .map((d) => SUPERSCRIPT[Number(d)] ?? d)
    .join('');
  return n < 0 ? `⁻${digits}` : digits;
}

/** Three significant figures, without the zeros that only pretend to precision. */
function threeFigures(v: number): string {
  const text = v.toPrecision(3);
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * Numbers as words: `4.15 billion`, not `4.151 B`.
 *
 * Part of the interface receding. A suffix is a code you learn; a word is read without
 * noticing. Below a million the digits are grouped and shown whole, because "41,500" is
 * already easy to read and "41.5 thousand" is not how anyone says it.
 */
function formatWords(value: Num): string {
  const n = value.toNumber();
  if (value.lt(999_999.5)) {
    if (value.lt(999.5)) return threeFigures(n);
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  let tier = Math.floor(value.exponent / 3);
  let shown = value.mantissa * Math.pow(10, value.exponent - tier * 3);
  // 999.6 million rounds to "1000 million", which is a billion.
  if (Number(shown.toPrecision(3)) >= 1000) {
    tier += 1;
    shown /= 1000;
  }

  const word = WORDS[tier];
  if (word !== undefined) return `${threeFigures(shown)} ${word}`;

  // Past the names, powers of ten — carrying a mantissa that rounds up to ten.
  let mantissa = Number(value.mantissa.toFixed(2));
  let exponent = value.exponent;
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${mantissa.toFixed(2)} × 10${superscript(exponent)}`;
}

/**
 * Standard idle-game suffixes. Beyond this list we fall back to scientific, which is where
 * anyone still reading the number would rather be anyway.
 */
const SUFFIXES = [
  '', 'K', 'M', 'B', 'T',
  'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc',
  'Vg', 'UVg', 'DVg', 'TVg', 'QaVg', 'QiVg', 'SxVg', 'SpVg', 'OcVg', 'NoVg',
  'Tg',
] as const;

/** Digits after the point for a mantissa in [1, 1000) — keeps the column width steady. */
function mantissaDigits(m: number): number {
  if (m >= 100) return 1;
  if (m >= 10) return 2;
  return 3;
}

export function format(value: Num, notation: Notation = 'scientific'): string {
  if (!Number.isFinite(value.mantissa)) return value.mantissa > 0 ? 'Infinity' : 'NaN';
  if (value.sign() === 0) return '0';
  if (value.sign() < 0) return `-${format(value.neg(), notation)}`;

  const exp = value.exponent;

  if (notation === 'words') return formatWords(value);

  // Below 1000 there is nothing to abbreviate; show it plainly.
  if (exp < 3) {
    const n = value.toNumber();
    if (exp < 0) return n.toFixed(Math.min(4, 2 - exp));
    return n.toFixed(Math.max(0, 2 - exp));
  }

  if (notation === 'scientific') {
    return `${value.mantissa.toFixed(3)}e${exp}`;
  }

  const tier = Math.floor(exp / 3);
  // Re-scale the mantissa into [1, 1000) for this tier.
  const shown = value.mantissa * Math.pow(10, exp - tier * 3);
  const digits = mantissaDigits(shown);

  if (notation === 'letters') {
    const suffix = SUFFIXES[tier];
    if (suffix !== undefined) return `${shown.toFixed(digits)}${suffix ? ' ' + suffix : ''}`;
    return `${value.mantissa.toFixed(3)}e${exp}`;
  }

  // engineering: exponent always a multiple of three
  return `${shown.toFixed(digits)}e${tier * 3}`;
}

/** Seconds as `1:04:30`, or `41s` under a minute. Used for pacing readouts and away time. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** How long until `target` is affordable at `rate` per second. `Infinity` if never. */
export function timeUntil(current: Num, target: Num, rate: Num): number {
  if (current.gte(target)) return 0;
  if (rate.lte(0)) return Infinity;
  return target.sub(current).div(rate).toNumber();
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}
