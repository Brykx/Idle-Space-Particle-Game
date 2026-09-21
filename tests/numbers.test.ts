import { describe, expect, it } from 'vitest';
import { D, format, formatDuration, timeUntil } from '../src/sim/numbers';

describe('format', () => {
  it('shows small numbers plainly', () => {
    expect(format(D(0), 'letters')).toBe('0');
    expect(format(D(7.5), 'letters')).toBe('7.50');
    expect(format(D(942), 'letters')).toBe('942');
  });

  it('uses suffixes, then falls back to scientific past the list', () => {
    expect(format(D(1234), 'letters')).toBe('1.234 K');
    expect(format(D(1.5e6), 'letters')).toBe('1.500 M');
    expect(format(D('4.2e12'), 'letters')).toBe('4.200 T');
    expect(format(D('1e300'), 'letters')).toMatch(/e300$/);
  });

  it('keeps engineering exponents on multiples of three', () => {
    expect(format(D('1.23e7'), 'engineering')).toBe('12.30e6');
    expect(format(D('9.9e22'), 'engineering')).toBe('99.00e21');
  });

  it('handles negatives and the far end without producing NaN text', () => {
    expect(format(D(-1500), 'letters')).toBe('-1.500 K');
    expect(format(D('1e9000'), 'scientific')).toMatch(/e9000$/);
  });
});

describe('formatDuration', () => {
  it('reads like a clock once past a minute', () => {
    expect(formatDuration(41)).toBe('41s');
    expect(formatDuration(372)).toBe('6:12');
    expect(formatDuration(3870)).toBe('1:04:30');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('timeUntil', () => {
  it('is zero when already affordable and infinite at a standstill', () => {
    expect(timeUntil(D(100), D(50), D(1))).toBe(0);
    expect(timeUntil(D(0), D(50), D(0))).toBe(Infinity);
    expect(timeUntil(D(0), D(50), D(2))).toBe(25);
  });
});
