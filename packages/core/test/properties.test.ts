import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildStatements,
  daysBetween,
  ledgerMonth,
  monthEnd,
  monthStart,
  rupees,
  weekdayOf,
  type Claim,
  type Decision,
  type LogChange,
  type LogEntry,
  type Settlement,
} from '../src/index.ts';
import { CARD_APR, CARD_NOV, JOVIAL, close, policyWith, prep } from './fixtures.ts';

const OCT = daysBetween(monthStart('2026-10'), monthEnd('2026-10')).filter(
  (d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5,
);
const CHANGES: LogChange[] = [
  'Leave',
  'Switch to Veg',
  'Switch to Non Veg',
  'Extra Chapati',
  'Extra Bhakri',
];

const logArb = fc
  .array(
    fc.record({
      day: fc.constantFrom(...OCT),
      change: fc.constantFrom(...CHANGES),
      qty: fc.integer({ min: 1, max: 20 }),
      minute: fc.integer({ min: 0, max: 59 }),
    }),
    { maxLength: 25 },
  )
  .map((rows): LogEntry[] =>
    rows.map((r, i) => ({
      id: `p${i}`,
      date: r.day,
      personId: 'jovial',
      allConsumers: false,
      change: r.change,
      qty: r.change.startsWith('Extra') ? r.qty : null,
      note: null,
      loggedBy: 'jovial',
      loggedAt: `2026-09-30T10:${String(r.minute).padStart(2, '0')}:00Z`,
    })),
  );

const stmt = (over: Parameters<typeof prep>[0]) =>
  buildStatements(prep(over), ['jovial'], ['2026-10'])[0]!;
const RUNS = { numRuns: 300 };

describe('statement invariants over arbitrary logs', () => {
  it('the daily ledger adds up to the statement', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const p = prep({ log });
        const days = ledgerMonth(p, JOVIAL, '2026-10');
        const s = buildStatements(p, ['jovial'], ['2026-10'])[0]!;
        const daily = days.reduce((a, d) => a + d.dayTotal, 0);
        expect(daily + s.extrasAmount).toBe(s.liveTotal);
        expect(s.mealsAmount + s.breadAmount + s.leaveAmount).toBe(daily);
        expect(s.counts.meals).toBe(days.filter((d) => d.status === 'Meal').length);
        expect(s.counts.veg + s.counts.nonVeg).toBe(s.counts.meals);
      }),
      RUNS,
    );
  });

  it('the order the log arrives in never changes the answer', () => {
    fc.assert(
      fc.property(logArb, fc.nat(), (log, seed) => {
        const shuffled = [...log]
          .sort((a, b) => ((a.id.length + seed) % 7) - ((b.id.length + seed) % 7))
          .reverse();
        expect(stmt({ log: shuffled })).toEqual(stmt({ log }));
      }),
      RUNS,
    );
  });

  it('adding a leave never raises the bill', () => {
    fc.assert(
      fc.property(logArb, fc.constantFrom(...OCT), (log, day) => {
        const before = stmt({ log }).liveTotal;
        const leave: LogEntry = {
          id: 'extra-leave',
          date: day,
          personId: 'jovial',
          allConsumers: false,
          change: 'Leave',
          qty: null,
          note: null,
          loggedBy: 'jovial',
          loggedAt: '2026-10-01T00:00:00Z',
        };
        expect(stmt({ log: [...log, leave] }).liveTotal).toBeLessThanOrEqual(before);
      }),
      RUNS,
    );
  });

  it("a Supplier Off day never raises anyone's bill", () => {
    fc.assert(
      fc.property(logArb, fc.constantFrom(...OCT), (log, day) => {
        const before = stmt({ log }).liveTotal;
        const off: LogEntry = {
          id: 'off',
          date: day,
          personId: null,
          allConsumers: true,
          change: 'Supplier Off',
          qty: null,
          note: null,
          loggedBy: 'namrata',
          loggedAt: '2026-10-01T00:00:00Z',
        };
        expect(stmt({ log: [...log, off] }).liveTotal).toBeLessThanOrEqual(before);
      }),
      RUNS,
    );
  });

  it('what has happened never exceeds what the month will total, and converges once the month ends', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        let last = 0;
        for (const today of [
          '2026-09-30',
          '2026-10-01',
          '2026-10-10',
          '2026-10-20',
          '2026-10-31',
          '2026-11-05',
        ]) {
          const s = stmt({ log, today });
          expect(s.liveTotal).toBe(stmt({ log, today: '2026-10-01' }).liveTotal); // today never changes the total
          expect(s.actualToDate).toBeGreaterThanOrEqual(last);
          expect(s.actualToDate).toBeLessThanOrEqual(s.liveTotal);
          last = s.actualToDate;
        }
        expect(last).toBe(stmt({ log, today: '2026-11-05' }).liveTotal);
      }),
      RUNS,
    );
  });

  it('a rate card that starts in a later month never changes an earlier one', () => {
    fc.assert(
      fc.property(
        logArb,
        fc.integer({ min: 1, max: 100_000 }),
        fc.constantFrom('2026-11-01', '2026-11-15', '2027-03-01'),
        (log, price, from) => {
          const later = {
            ...CARD_NOV,
            id: 'later',
            effectiveFrom: from,
            veg: price,
            nonVeg: price + 1,
          };
          expect(stmt({ log, rateCards: [CARD_APR, later] })).toEqual(
            stmt({ log, rateCards: [CARD_APR] }),
          );
        },
      ),
      RUNS,
    );
  });

  it('a closed month keeps its bill whatever happens to the log afterwards', () => {
    fc.assert(
      fc.property(logArb, logArb, (before, after) => {
        const frozen = stmt({ log: before });
        const closes = [close({ billed: frozen.liveTotal, meals: frozen.counts.meals })];
        const later = stmt({
          log: [...before, ...after.map((e) => ({ ...e, id: `late-${e.id}` }))],
          closes,
        });
        expect(later.billed).toBe(frozen.liveTotal);
        expect(later.changedAfterClose).toBe(later.liveTotal - frozen.liveTotal);
      }),
      RUNS,
    );
  });
});

const decisionArb = fc.constantFrom<'none' | 'Confirmed' | 'Disputed' | 'voided'>(
  'none',
  'Confirmed',
  'Disputed',
  'voided',
);

describe('money invariants over arbitrary claims and settlements', () => {
  it('paid is exactly the confirmed claims plus the admin payments; balance is billed minus paid', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ amount: fc.integer({ min: 1, max: 500_000 }), verdict: decisionArb }),
          { maxLength: 8 },
        ),
        fc.array(fc.integer({ min: 1, max: 500_000 }), { maxLength: 4 }),
        (rows, payments) => {
          const claims: Claim[] = rows.map((r, i) => ({
            id: `c${i}`,
            consumerId: 'jovial',
            paidAt: '2026-10-25',
            forMonth: '2026-10',
            amount: r.amount,
            method: 'UPI',
            refNote: null,
            createdAt: '2026-10-25T08:00:00Z',
          }));
          const decisions: Decision[] = rows.flatMap((r, i) =>
            r.verdict === 'none'
              ? []
              : [
                  {
                    claimId: `c${i}`,
                    decision:
                      r.verdict === 'Disputed' ? ('Disputed' as const) : ('Confirmed' as const),
                    note: r.verdict === 'Disputed' ? 'why' : null,
                    decidedBy: 'namrata',
                    decidedAt: '2026-10-26T08:00:00Z',
                    voided: r.verdict === 'voided',
                  },
                ],
          );
          const settlements: Settlement[] = payments.map((a, i) => ({
            id: `s${i}`,
            date: '2026-11-01',
            consumerId: 'jovial',
            forMonth: '2026-10',
            type: 'Payment',
            amount: a,
            note: null,
            recordedBy: 'admin',
            createdAt: '2026-11-01T08:00:00Z',
          }));
          const s = stmt({ claims, decisions, settlements, today: '2026-11-15' });
          const confirmed = rows
            .filter((r) => r.verdict === 'Confirmed')
            .reduce((a, r) => a + r.amount, 0);
          const pending = rows
            .filter((r) => r.verdict === 'none')
            .reduce((a, r) => a + r.amount, 0);
          const disputed = rows.filter((r) => r.verdict === 'Disputed').length;
          expect(s.paid).toBe(confirmed + payments.reduce((a, b) => a + b, 0));
          expect(s.claimedPending).toBe(pending);
          expect(s.openQueries).toBe(disputed);
          expect(s.balance).toBe(s.billed - s.paid);
        },
      ),
      RUNS,
    );
  });

  it('earlier unpaid is the sum of every earlier balance, however many months are asked for', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 400_000 }), { minLength: 3, maxLength: 3 }),
        fc.constantFrom(['2026-12'], ['2026-11', '2026-12'], ['2026-10', '2026-12']),
        (pays, asked) => {
          const months = ['2026-10', '2026-11', '2026-12'];
          const settlements: Settlement[] = pays.map((a, i) => ({
            id: `s${i}`,
            date: '2026-12-31',
            consumerId: 'jovial',
            forMonth: months[i]!,
            type: 'Payment',
            amount: a,
            note: null,
            recordedBy: 'admin',
            createdAt: '2026-12-31T08:00:00Z',
          }));
          const p = prep({
            settlements,
            rateCards: [CARD_APR, CARD_NOV],
            today: '2027-01-05',
            log: [],
            policies: [policyWith({})],
          });
          const all = buildStatements(p, ['jovial'], months);
          const some = buildStatements(p, ['jovial'], asked);
          for (const s of some) {
            const idx = months.indexOf(s.month);
            expect(s.earlierUnpaid).toBe(all.slice(0, idx).reduce((a, x) => a + x.balance, 0));
          }
        },
      ),
      RUNS,
    );
  });
});

describe('sanity of the generator itself', () => {
  it("covers October's 22 weekdays", () => {
    expect(OCT).toHaveLength(22);
    expect(rupees(1)).toBe(100);
  });
});
