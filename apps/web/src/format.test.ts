import { describe, expect, it } from 'vitest';
import { ago, date, money, month, plural, rupeesText, toPaise } from './format.ts';

describe('amounts typed by a person', () => {
  it('become exact paise', () => {
    expect(toPaise('3200')).toBe(320000);
    expect(toPaise('₹3,200')).toBe(320000);
    expect(toPaise(' 12.5 ')).toBe(1250);
    expect(toPaise('0.07')).toBe(7);
    expect(toPaise('19.99')).toBe(1999); // not 1998.9999999999998
    expect(toPaise('1.005')).toBeNull(); // no half paise
  });

  it('refuse what is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1e3', '12.', '.5', '1,5', '₹', '12 34'])
      expect(toPaise(bad), bad).toBeNull();
  });

  it('read back the way they were typed', () => {
    expect(rupeesText(320000)).toBe('3200');
    expect(rupeesText(1250)).toBe('12.50');
    expect(toPaise(rupeesText(1999))).toBe(1999);
  });
});

describe('what is shown', () => {
  it('follows the spec: ₹ with grouping, a dash for zero, dd-MMM-yyyy, MMM-yy', () => {
    expect(money(0)).toBe('-');
    expect(money(334500)).toBe('₹3,345');
    expect(date('2026-10-24')).toBe('24-Oct-2026');
    expect(month('2026-10')).toBe('Oct-26');
  });

  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    expect(ago('2026-10-24T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-10-24T11:30:00Z', now)).toBe('30 minutes ago');
    expect(ago('2026-10-24T07:00:00Z', now)).toBe('5 hours ago');
    expect(ago('2026-10-20T12:00:00Z', now)).toBe('4 days ago');
  });

  it('pluralises', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(3, 'day')).toBe('3 days');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });
});
