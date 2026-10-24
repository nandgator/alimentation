import { describe, expect, it } from 'vitest';
import {
  checkLogEntry,
  closeSnapshot,
  ledgerDay,
  monthRange,
  rupees,
  type Issue,
} from '../src/index.ts';
import { JOVIAL, SMRUTI, entry, policyWith, prep } from './fixtures.ts';

describe('a leave day is priced after the switches made before it', () => {
  it('uses Veg when a Switch to Veg comes before the leave on a Non Veg day', () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const log = [
      entry({
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Veg',
        loggedAt: '2026-10-01T10:01:00Z',
      }),
      entry({
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Leave',
        loggedAt: '2026-10-01T10:02:00Z',
      }),
    ];
    expect(ledgerDay(prep({ policies: half, log }), JOVIAL, '2026-10-07')!.leaveAmount).toBe(
      rupees(75),
    );
  });

  it('ignores extras on a leave day, and ignores an extra that comes before a switch', () => {
    const half = [policyWith({ leave: { chargeBps: 5000 } })];
    const log = [
      entry({
        date: '2026-10-06',
        personId: 'jovial',
        change: 'Extra Chapati',
        qty: 3,
        loggedAt: '2026-10-01T10:01:00Z',
      }),
      entry({
        date: '2026-10-06',
        personId: 'jovial',
        change: 'Leave',
        loggedAt: '2026-10-01T10:02:00Z',
      }),
    ];
    // Tuesday is Veg at 150: half is 75, and the Non Veg price must not leak in from the extras entry.
    expect(ledgerDay(prep({ policies: half, log }), JOVIAL, '2026-10-06')!.leaveAmount).toBe(
      rupees(75),
    );
  });
});

describe('the month picker with consumers who have no start date', () => {
  it('is just the current month when no consumer has one', () => {
    const p = prep({
      people: [
        { ...JOVIAL, activeFrom: null },
        { ...SMRUTI, activeFrom: null },
      ],
      today: '2026-12-10',
    });
    expect(monthRange(p)).toEqual(['2026-12']);
  });

  it('ignores a consumer with no start date next to one who has', () => {
    const p = prep({ people: [{ ...JOVIAL, activeFrom: null }, SMRUTI], today: '2026-11-10' });
    expect(monthRange(p)).toEqual(['2026-10', '2026-11']);
  });
});

describe('closing, at the edges', () => {
  it('says which person is unknown', () => {
    expect(() => closeSnapshot(prep(), 'nobody', '2026-10')).toThrowError(/unknown person nobody/);
  });
});

describe('an entry with no person that is not Supplier Off is only a shape error', () => {
  it('does not also report a closed month', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 0, afterClose: 'block' } }),
    ];
    const p = prep({ policies, today: '2026-12-15' });
    const issues: Issue[] = checkLogEntry(
      p,
      { personId: 'admin', role: 'admin' },
      { date: '2026-10-14', personId: null, allConsumers: false, change: 'Leave', qty: null },
      { date: '2026-12-15', time: '09:00' },
    );
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['SHAPE']);
  });
});
