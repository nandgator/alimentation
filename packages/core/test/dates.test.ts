import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  diffDays,
  formatDisplayDate,
  formatDisplayMonth,
  formatMoney,
  fromEpochDay,
  isValidDate,
  localNow,
  monthEnd,
  monthsBetween,
  rupees,
  toEpochDay,
  weekdayOf,
  fractionOf,
} from '../src/index.ts';

describe('calendar arithmetic', () => {
  it('knows the weekday of anchor dates', () => {
    expect(weekdayOf('1970-01-01')).toBe(4); // Thursday
    expect(weekdayOf('2026-10-01')).toBe(4);
    expect(weekdayOf('2026-10-16')).toBe(5); // the spec's Friday leave
    expect(weekdayOf('2000-02-29')).toBe(2);
  });

  it('rejects impossible dates', () => {
    for (const bad of [
      '2026-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '26-04-01',
      '2026-4-1',
      '',
    ]) {
      expect(isValidDate(bad)).toBe(false);
    }
    expect(isValidDate('2028-02-29')).toBe(true);
  });

  it('round-trips epoch days and agrees with Date for every day in 1900-2200', () => {
    fc.assert(
      fc.property(fc.integer({ min: -25567, max: 84006 }), (z) => {
        const s = fromEpochDay(z);
        expect(toEpochDay(s)).toBe(z);
        expect(new Date(`${s}T00:00:00Z`).getTime() / 86_400_000).toBe(z);
        expect(weekdayOf(s)).toBe(new Date(`${s}T00:00:00Z`).getUTCDay());
      }),
      { numRuns: 2000 },
    );
  });

  it('adds days and months across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2026-11-01', '2026-10-01')).toBe(31);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-10', '2027-01')).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(monthsBetween('2026-10', '2026-09')).toEqual([]);
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});

describe('the workspace clock, not the host clock', () => {
  // 2026-10-24T20:00:00Z is 01:30 on the 25th in Kolkata, 10:00 on the 25th in Kiritimati (+14),
  // and 09:00 on the 24th in Pago Pago (-11). The same instant is three different "todays".
  const instant = new Date('2026-10-24T20:00:00Z');
  it.each([
    ['Asia/Kolkata', '2026-10-25', '01:30'],
    ['Pacific/Kiritimati', '2026-10-25', '10:00'],
    ['Pacific/Pago_Pago', '2026-10-24', '09:00'],
    ['UTC', '2026-10-24', '20:00'],
  ])('reads %s as %s %s', (zone, date, time) => {
    expect(localNow(instant, zone)).toEqual({ date, time });
  });

  it('never prints 24:00 at midnight', () => {
    expect(localNow(new Date('2026-10-24T18:30:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-10-25',
      time: '00:00',
    });
  });
});

describe('display formats from the spec', () => {
  it('formats dates, months and money', () => {
    expect(formatDisplayDate('2026-10-02')).toBe('02-Oct-2026');
    expect(formatDisplayMonth('2026-10')).toBe('Oct-26');
    expect(formatMoney(rupees(3260))).toBe('₹3,260');
    expect(formatMoney(0)).toBe('-');
    expect(formatMoney(rupees(1234567))).toBe('₹1,234,567');
    expect(formatMoney(-rupees(170))).toBe('-₹170');
    expect(formatMoney(15050)).toBe('₹150.50');
  });

  it('rounds a fraction of a price half up, once', () => {
    expect(fractionOf(rupees(150), 5000)).toBe(rupees(75));
    expect(fractionOf(1, 5000)).toBe(1); // 0.5 paise rounds up
    expect(fractionOf(rupees(170), 3333)).toBe(Math.round((17000 * 3333) / 10000));
  });
});
