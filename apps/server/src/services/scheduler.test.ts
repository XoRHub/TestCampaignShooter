import { describe, expect, it } from 'vitest';
import { isValidCronExpression, nextOccurrence } from './scheduler.js';

describe('isValidCronExpression', () => {
  it('accepts standard 5-field and 6-field (seconds) expressions', () => {
    expect(isValidCronExpression('0 6 * * 1-5')).toBe(true); // 06:00 en semaine
    expect(isValidCronExpression('*/15 * * * *')).toBe(true); // toutes les 15 min
    expect(isValidCronExpression('0 0 3 * * *')).toBe(true); // 03:00 (avec secondes)
    expect(isValidCronExpression('@hourly')).toBe(true);
  });

  it('rejects malformed expressions', () => {
    expect(isValidCronExpression('')).toBe(false);
    expect(isValidCronExpression('not a cron')).toBe(false);
    expect(isValidCronExpression('99 * * * *')).toBe(false);
    expect(isValidCronExpression('* * * * * * *')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('returns a future ISO date for valid expressions', () => {
    const next = nextOccurrence('*/5 * * * *');
    expect(next).toBeDefined();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns undefined for invalid expressions', () => {
    expect(nextOccurrence('nope')).toBeUndefined();
  });
});
