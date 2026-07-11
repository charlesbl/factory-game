import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ITEM_WORK,
  RATE_SCALE,
  TIME_TICKS_PER_SECOND,
  addExact,
  ceilingDivide,
  compareExact,
  parseExact,
  parseRate,
  stringifyExact,
  workForDuration,
} from './index';

describe('exact numbers', () => {
  it('parses the design examples exactly', () => {
    expect(parseRate('2.50')).toBe(2_500_000n);
    expect(parseRate('0.30')).toBe(300_000n);
    expect(parseRate('1.25')).toBe(1_250_000n);
  });
  it('calculates the next threshold with ceiling division', () =>
    expect(ceilingDivide(ITEM_WORK, parseRate('0.30'))).toBe(3_333_334n));
  it('has no drift when time is subdivided', () => {
    const rate = parseRate('1.25');
    const whole = workForDuration(rate, 10n * TIME_TICKS_PER_SECOND);
    const parts = Array.from({ length: 1_000 }, () =>
      workForDuration(rate, TIME_TICKS_PER_SECOND / 100n),
    ).reduce(addExact, 0n);
    expect(parts).toBe(whole);
  });
  it('round-trips bigint JSON', () =>
    expect(parseExact(stringifyExact({ rate: 3n * RATE_SCALE }))).toEqual({
      rate: 3n * RATE_SCALE,
    }));
  it('rejects negative and over-precise rates', () => {
    expect(() => parseRate('-1')).toThrow();
    expect(() => parseRate('0.0000001')).toThrow();
  });
  it('preserves addition and comparison properties', () =>
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        fc.bigInt({ min: 0n, max: 10n ** 18n }),
        (a, b) => {
          expect(addExact(a, b)).toBe(a + b);
          expect(compareExact(a, b)).toBe(a < b ? -1 : a > b ? 1 : 0);
        },
      ),
    ));
});
