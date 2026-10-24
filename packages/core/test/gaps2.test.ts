import { describe, expect, it } from 'vitest';
import {
  EngineError,
  buildStatements,
  checkLogChange,
  checkLogEntry,
  compareText,
  fromEpochDay,
  ledgerDay,
  monthStart,
  parseDate,
  rupees,
  toEpochDay,
  type Issue,
  type NewLogEntry,
} from '../src/index.ts';
import { CARD_APR, JOVIAL, entry, policyWith, prep } from './fixtures.ts';

describe('the last day of a 400-year cycle, which random sampling will almost never reach', () => {
  it.each(['0000-02-29', '0400-02-29', '1600-02-29', '2000-02-29', '2400-02-29', '9600-02-29'])(
    'round-trips %s',
    (day) => {
      expect(fromEpochDay(toEpochDay(day))).toBe(day);
      expect(fromEpochDay(toEpochDay(day) + 1)).toBe(day.replace('02-29', '03-01'));
    },
  );
  it('handles the century years that are not leap years', () => {
    for (const [a, b] of [
      ['1900-02-28', '1900-03-01'],
      ['2100-02-28', '2100-03-01'],
      ['2200-02-28', '2200-03-01'],
    ] as const) {
      expect(fromEpochDay(toEpochDay(a) + 1)).toBe(b);
    }
  });
});

describe('the three-way comparison', () => {
  it('orders, and says zero for equal', () => {
    expect(compareText('a', 'b')).toBeLessThan(0);
    expect(compareText('b', 'a')).toBeGreaterThan(0);
    expect(compareText('a', 'a')).toBe(0);
    expect(compareText('2026-10-01', '2026-10-02')).toBeLessThan(0);
  });
});

describe('what the errors say', () => {
  it('names the offending input', () => {
    expect(() => parseDate('tomorrow')).toThrowError(/not a calendar date: tomorrow/);
    expect(() => monthStart('2026-13')).toThrowError(/not a month: 2026-13/);
    expect(() => buildStatements(prep(), ['nobody'], ['2026-10'])).toThrowError(
      /unknown person nobody/,
    );
    try {
      buildStatements(prep(), ['nobody'], ['2026-10']);
    } catch (e) {
      expect((e as EngineError).code).toBe('BAD_INPUT');
    }
    try {
      buildStatements(prep({ rateCards: [] }), ['jovial'], ['2026-10']);
    } catch (e) {
      expect((e as EngineError).message).toMatch(/no rate card is in force on 2026-10-01/);
    }
    const noFriday = {
      ...CARD_APR,
      menu: { 1: 'Veg' as const, 2: 'Veg' as const, 3: 'Non Veg' as const, 4: 'Veg' as const },
    };
    try {
      buildStatements(prep({ rateCards: [noFriday] }), ['jovial'], ['2026-10']);
    } catch (e) {
      expect((e as EngineError).code).toBe('NO_MENU');
    }
  });
});

describe('statements asked for months that start before the person did, in any order', () => {
  it('returns a month earlier than the first billed month even when it is not listed first', () => {
    const p = prep({ log: [] });
    const got = buildStatements(p, ['jovial'], ['2026-10', '2026-09']);
    expect(got.map((s) => s.month)).toEqual(['2026-09', '2026-10']);
    expect(got[0]!.liveTotal).toBe(0);
  });
});

describe('leave days that were switched', () => {
  it('charges a switch to Non Veg at the Non Veg price, and a switch to Veg at the Veg price', () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const at = (n: number) => `2026-10-01T10:0${n}:00Z`;
    const toNv = [
      entry({ date: '2026-10-06', personId: 'jovial', change: 'Leave' }), // Tuesday, Veg by default
      entry({
        date: '2026-10-06',
        personId: 'jovial',
        change: 'Switch to Non Veg',
        loggedAt: at(1),
      }),
    ];
    expect(ledgerDay(prep({ policies: half, log: toNv }), JOVIAL, '2026-10-06')!.leaveAmount).toBe(
      rupees(85),
    );
    const toVeg = [
      entry({ date: '2026-10-07', personId: 'jovial', change: 'Leave' }), // Wednesday, Non Veg by default
      entry({
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Non Veg',
        loggedAt: at(1),
      }),
      entry({ date: '2026-10-07', personId: 'jovial', change: 'Switch to Veg', loggedAt: at(2) }),
    ];
    expect(ledgerDay(prep({ policies: half, log: toVeg }), JOVIAL, '2026-10-07')!.leaveAmount).toBe(
      rupees(75),
    );
  });
});

describe('validation, last details', () => {
  const NOW = { date: '2026-10-13', time: '12:00' };
  const codes = (issues: Issue[], severity?: Issue['severity']) =>
    issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
  const leave = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
    date: '2026-10-14',
    personId: 'jovial',
    allConsumers: false,
    change: 'Leave',
    qty: null,
    ...over,
  });

  it('marks a holiday note as a warning, not an error', () => {
    const issues = checkLogEntry(
      prep(),
      { personId: 'admin', role: 'admin' },
      leave({ date: '2026-10-20' }),
      NOW,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message.length).toBeGreaterThan(0);
  });

  it('spots a duplicate Switch to Non Veg as well as Switch to Veg', () => {
    const p = prep({
      log: [entry({ date: '2026-10-14', personId: 'jovial', change: 'Switch to Non Veg' })],
    });
    const e = checkLogEntry(
      p,
      { personId: 'admin', role: 'admin' },
      leave({ change: 'Switch to Non Veg' }),
      NOW,
    );
    expect(codes(e, 'error')).toContain('DUPLICATE');
  });

  it("judges closure by the entry's own person when taking an entry back, not by anyone's", () => {
    const closes = [
      {
        forMonth: '2026-10',
        consumerId: 'jovial',
        meals: 0,
        billed: 0,
        closedOn: '2026-11-01',
        closedBy: 'admin',
      },
    ];
    const smrutis = entry({
      date: '2026-10-14',
      personId: 'smruti',
      change: 'Leave',
      loggedBy: 'smruti',
    });
    expect(
      checkLogChange(prep({ closes }), { personId: 'smruti', role: 'consumer' }, smrutis, NOW),
    ).toEqual([]);
    const joviaIs = entry({
      date: '2026-10-14',
      personId: 'jovial',
      change: 'Leave',
      loggedBy: 'jovial',
    });
    expect(
      codes(
        checkLogChange(prep({ closes }), { personId: 'jovial', role: 'consumer' }, joviaIs, NOW),
        'error',
      ),
    ).toEqual(['MONTH_CLOSED']);
  });

  it('applies the cut-off to a consumer taking an entry back, never to the admin', () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: '18:00' } })],
    });
    const mine = entry({
      date: '2026-10-14',
      personId: 'jovial',
      change: 'Leave',
      loggedBy: 'jovial',
    });
    const late = { date: '2026-10-14', time: '09:00' };
    expect(
      codes(checkLogChange(p, { personId: 'jovial', role: 'consumer' }, mine, late), 'error'),
    ).toEqual(['CUTOFF_PASSED']);
    expect(checkLogChange(p, { personId: 'admin', role: 'admin' }, mine, late)).toEqual([]);
  });
});
