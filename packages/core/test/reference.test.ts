import { describe, expect, it } from 'vitest';
import {
  buildStatements,
  daysBetween,
  ledgerMonth,
  monthEnd,
  monthStart,
  rupees,
  STATUS_LABEL,
  weekdayOf,
} from '../src/index.ts';
import {
  CARD_APR,
  CARD_NOV,
  JOVIAL,
  SMRUTI,
  claim,
  close,
  data,
  decision,
  entry,
  prep,
  settlement,
} from './fixtures.ts';

const stmt = (over: Parameters<typeof prep>[0], id: string, month: string) => {
  const p = prep(over);
  return buildStatements(p, [id], [month])[0]!;
};

describe('spec section 11: October 2026', () => {
  it('has 20 working days: 22 weekdays minus 02-Oct and 20-Oct', () => {
    const weekdays = daysBetween('2026-10-01', '2026-10-31').filter((d) => {
      const w = weekdayOf(d);
      return w >= 1 && w <= 5;
    });
    expect(weekdays).toHaveLength(22);
    const p = prep();
    const meals = ledgerMonth(p, JOVIAL, '2026-10').filter((d) => d.status === 'Meal');
    expect(meals).toHaveLength(20);
    expect(meals.filter((d) => d.meal === 'Non Veg')).toHaveLength(8);
    expect(meals.filter((d) => d.meal === 'Veg')).toHaveLength(12);
  });

  it('bills Jovial 3,260: 12x150 + 8x170 = 3,160, bread 2x30, extras 40', () => {
    const s = stmt({}, 'jovial', '2026-10');
    expect(s.mealsAmount).toBe(rupees(3160));
    expect(s.breadAmount).toBe(rupees(60));
    expect(s.extrasAmount).toBe(rupees(40));
    expect(s.liveTotal).toBe(rupees(3260));
    expect(s.billed).toBe(rupees(3260));
    expect(s.counts).toMatchObject({ meals: 20, veg: 12, nonVeg: 8, leave: 0, extraBhakri: 2 });
  });

  it('bills Smruti 3,030: Friday 16-Oct leave removes a Non Veg 170', () => {
    const s = stmt({}, 'smruti', '2026-10');
    expect(s.liveTotal).toBe(rupees(3030));
    expect(s.counts).toMatchObject({ meals: 19, veg: 12, nonVeg: 7, leave: 1 });
  });

  it('totals 6,290', () => {
    const [a, b] = buildStatements(prep(), ['jovial', 'smruti'], ['2026-10']);
    expect(a!.billed + b!.billed).toBe(rupees(6290));
  });

  it('reproduces the supplier handwritten check on a calendar month that really has those counts', () => {
    // 22 weekdays, 8 Non Veg, 14 Veg: 14x150 + 8x170 = 3,460, plus 40 extras = 3,500.
    // October 2026 cannot be this month (Wed and Fri are 9 of its 22 weekdays), so
    // find a month that is.
    let found: string | null = null;
    for (let y = 2026; y <= 2032 && !found; y++) {
      for (let m = 1; m <= 12 && !found; m++) {
        const mo = `${y}-${String(m).padStart(2, '0')}`;
        const days = daysBetween(monthStart(mo), monthEnd(mo)).filter(
          (d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5,
        );
        const nv = days.filter((d) => weekdayOf(d) === 3 || weekdayOf(d) === 5).length;
        if (days.length === 22 && nv === 8) found = mo;
      }
    }
    expect(found).not.toBeNull();
    const consumer = { ...JOVIAL, activeFrom: monthStart(found!) };
    const p = prep({
      people: [consumer],
      holidays: [],
      log: [],
      today: monthEnd(found!),
      rateCards: [{ ...CARD_APR, effectiveFrom: '2020-01-01' }],
    });
    const s = buildStatements(p, ['jovial'], [found!])[0]!;
    expect(s.counts).toMatchObject({ meals: 22, veg: 14, nonVeg: 8 });
    expect(s.liveTotal).toBe(rupees(3500));
  });
});

describe('rate card is never retroactive', () => {
  it('leaves October unchanged and reprices November from 01-Nov', () => {
    const before = stmt({}, 'jovial', '2026-10');
    const after = stmt({ rateCards: [CARD_APR, CARD_NOV] }, 'jovial', '2026-10');
    expect(after.liveTotal).toBe(before.liveTotal);
    // November: 18 working days (9, 10, 11 are confirmed holidays; 12 and 13 are tentative and still count),
    // 11 Veg x160 + 7 Non Veg x180 = 3,020, plus 40.
    const nov = stmt({ rateCards: [CARD_APR, CARD_NOV], log: [] }, 'jovial', '2026-11');
    expect(nov.counts).toMatchObject({ meals: 18, veg: 11, nonVeg: 7 });
    expect(nov.liveTotal).toBe(rupees(3060));
  });

  it('uses the latest card on or before each date when a card starts mid-month', () => {
    const mid = { ...CARD_NOV, id: 'mid', effectiveFrom: '2026-11-16' };
    const p = prep({ rateCards: [CARD_APR, mid], log: [], today: '2026-11-30' });
    const days = ledgerMonth(p, JOVIAL, '2026-11');
    expect(days.find((d) => d.date === '2026-11-13')!.mealPrice).toBe(rupees(170)); // Fri, old card
    expect(days.find((d) => d.date === '2026-11-18')!.mealPrice).toBe(rupees(180)); // Wed, new card
  });
});

describe('claim flow (spec section 4)', () => {
  const base = { today: '2026-10-28' };

  it('pending claim: Awaiting confirmation, claimed 100', () => {
    const s = stmt({ ...base, claims: [claim()] }, 'jovial', '2026-10');
    expect(s.claimedPending).toBe(rupees(100));
    expect(s.paid).toBe(0);
    expect(STATUS_LABEL[s.status]).toBe('Awaiting confirmation');
  });

  it('confirmed claim: paid 100, balance 3,160, Part paid', () => {
    const s = stmt({ ...base, claims: [claim()], decisions: [decision()] }, 'jovial', '2026-10');
    expect(s.paid).toBe(rupees(100));
    expect(s.balance).toBe(rupees(3160));
    expect(s.claimedPending).toBe(0);
    expect(STATUS_LABEL[s.status]).toBe('Part paid');
  });

  it('disputed claim opens a query; an admin Query Resolved entry closes it', () => {
    const disputed = {
      ...base,
      claims: [claim()],
      decisions: [decision({ decision: 'Disputed', note: 'not received' })],
    };
    const open = stmt(disputed, 'jovial', '2026-10');
    expect(open.openQueries).toBe(1);
    expect(STATUS_LABEL[open.status]).toBe('Query open');
    const resolved = stmt(
      { ...disputed, settlements: [settlement({ id: 'q', type: 'Query Resolved', amount: null })] },
      'jovial',
      '2026-10',
    );
    expect(resolved.openQueries).toBe(0);
    expect(STATUS_LABEL[resolved.status]).not.toBe('Query open');
  });

  it('a voided (reversed) decision counts for nothing and the claim is not pending again', () => {
    const s = stmt(
      { ...base, claims: [claim()], decisions: [decision({ voided: true })] },
      'jovial',
      '2026-10',
    );
    expect(s.paid).toBe(0);
    expect(s.claimedPending).toBe(0);
    expect(s.openQueries).toBe(0);
  });

  it('settles when paid reaches billed, using claims plus admin settlements', () => {
    const s = stmt(
      {
        today: '2026-11-15',
        claims: [claim({ amount: rupees(3000) })],
        decisions: [decision()],
        settlements: [settlement({ amount: rupees(260) })],
      },
      'jovial',
      '2026-10',
    );
    expect(s.paid).toBe(rupees(3260));
    expect(STATUS_LABEL[s.status]).toBe('Settled');
  });
});

describe('month close (spec section 3.7)', () => {
  it('freezes billed; a later edit shows Changed after close with the difference', () => {
    const closed = [close()];
    const unchanged = stmt({ closes: closed }, 'jovial', '2026-10');
    expect(unchanged.billed).toBe(rupees(3260));
    expect(unchanged.changedAfterClose).toBe(0);

    // Jovial's Wednesday 14-Oct is a Non Veg day; a late leave removes 170.
    const edited = stmt(
      {
        closes: closed,
        log: [...data().log, entry({ date: '2026-10-14', personId: 'jovial', change: 'Leave' })],
      },
      'jovial',
      '2026-10',
    );
    expect(edited.billed).toBe(rupees(3260));
    expect(edited.liveTotal).toBe(rupees(3090));
    expect(edited.changedAfterClose).toBe(-rupees(170));
    expect(STATUS_LABEL[edited.status]).toBe('⚠ Changed after close');
  });

  it('flags a change even when the month was closed at zero (deviation from the spec order, deliberate)', () => {
    const s = stmt({ closes: [close({ meals: 0, billed: 0 })] }, 'jovial', '2026-10');
    expect(s.billed).toBe(0);
    expect(s.changedAfterClose).toBe(rupees(3260));
    expect(STATUS_LABEL[s.status]).toBe('⚠ Changed after close');
  });
});

describe('statement status and basis', () => {
  it('is Projected until the month ends, then Due', () => {
    expect(STATUS_LABEL[stmt({ today: '2026-10-10' }, 'jovial', '2026-10').status]).toBe(
      'Projected',
    );
    expect(stmt({ today: '2026-10-10' }, 'jovial', '2026-10').basis).toBe('Projected');
    expect(STATUS_LABEL[stmt({ today: '2026-11-01' }, 'jovial', '2026-10').status]).toBe('Due');
    expect(stmt({ today: '2026-11-01' }, 'jovial', '2026-10').basis).toBe('Actual');
  });

  it('shows a dash when nothing is billed', () => {
    const s = stmt({}, 'jovial', '2026-09');
    expect(s.billed).toBe(0);
    expect(STATUS_LABEL[s.status]).toBe('—');
  });

  it('actual-to-date counts only days up to today, and the flat extras once there is one actual meal', () => {
    const s = stmt({ today: '2026-10-01' }, 'jovial', '2026-10');
    // 01-Oct is a Thursday (Veg 150) with 2 extra bhakri (60), plus the 40 fee.
    expect(s.actualToDate).toBe(rupees(250));
    const none = stmt({ today: '2026-09-30' }, 'jovial', '2026-10');
    expect(none.actualToDate).toBe(0);
  });

  it('carries earlier unpaid forward and sums the balances of earlier months', () => {
    const [oct, nov] = buildStatements(
      prep({ rateCards: [CARD_APR, CARD_NOV], log: [] }),
      ['jovial'],
      ['2026-10', '2026-11'],
    );
    expect(oct!.earlierUnpaid).toBe(0);
    expect(nov!.earlierUnpaid).toBe(oct!.balance);
    // Asking for November alone must give the same answer.
    const alone = buildStatements(
      prep({ rateCards: [CARD_APR, CARD_NOV], log: [] }),
      ['jovial'],
      ['2026-11'],
    )[0]!;
    expect(alone.earlierUnpaid).toBe(oct!.balance);
  });

  it('bills a consumer only between active_from and active_to', () => {
    const left = { ...JOVIAL, activeTo: '2026-10-15' };
    const p = prep({ people: [left, SMRUTI], log: [] });
    const days = ledgerMonth(p, left, '2026-10');
    expect(days.filter((d) => d.status === 'Meal').every((d) => d.date <= '2026-10-15')).toBe(true);
    expect(days.find((d) => d.date === '2026-10-16')!.status).toBe('Inactive');
  });
});

describe('Supplier Off applies to every consumer', () => {
  it('removes the meal for all and costs nothing', () => {
    const off = entry({ date: '2026-10-07', allConsumers: true, change: 'Supplier Off' });
    const p = prep({ log: [off] });
    for (const c of [JOVIAL, SMRUTI]) {
      expect(ledgerMonth(p, c, '2026-10').find((d) => d.date === '2026-10-07')).toMatchObject({
        status: 'Supplier Off',
        dayTotal: 0,
      });
    }
  });
});
