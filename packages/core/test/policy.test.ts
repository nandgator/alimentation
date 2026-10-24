import { describe, expect, it } from 'vitest';
import {
  autoCloseDate,
  buildStatements,
  closeSnapshot,
  DEFAULT_POLICY,
  dueAutoCloses,
  EngineError,
  ledgerMonth,
  monthRange,
  PolicySchema,
  policyForMonth,
  policyOn,
  rateCardStartAllowed,
  rupees,
  STATUS_LABEL,
  type Policy,
} from '../src/index.ts';
import { CARD_APR, CARD_NOV, JOVIAL, SMRUTI, close, entry, policyWith, prep } from './fixtures.ts';

const jovialOct = (over: Parameters<typeof prep>[0]) =>
  buildStatements(prep(over), ['jovial'], ['2026-10'])[0]!;

describe('policy document', () => {
  it('accepts the default and refuses rules this build does not know', () => {
    expect(PolicySchema.safeParse(DEFAULT_POLICY).success).toBe(true);
    expect(PolicySchema.safeParse({ ...DEFAULT_POLICY, surprise: 1 }).success).toBe(false);
    expect(PolicySchema.safeParse({ ...DEFAULT_POLICY, version: 2 }).success).toBe(false);
  });

  it('validates each field', () => {
    const bad: Partial<Record<keyof Policy, unknown>>[] = [
      { workingDays: [] },
      { workingDays: [1, 1] },
      { workingDays: [7] },
      { exceptionCutoff: { daysBefore: 1, time: '24:00' } },
      { exceptionCutoff: { daysBefore: 8, time: '18:00' } },
      { leave: { chargeBps: 10001 } },
      { extras: { minMeals: 0 } },
      { monthClose: { mode: 'auto', afterDays: -1, afterClose: 'flag' } },
      { monthClose: { mode: 'manual' } },
      { payments: 'cheque' },
    ];
    for (const patch of bad)
      expect(
        PolicySchema.safeParse({ ...DEFAULT_POLICY, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
    expect(
      PolicySchema.safeParse({
        ...DEFAULT_POLICY,
        extras: null,
        exceptionCutoff: { daysBefore: 0, time: '09:30' },
      }).success,
    ).toBe(true);
  });

  it('picks the latest version on or before the date, else the default', () => {
    const v1 = policyWith({ payments: 'direct' }, '2026-06-01');
    const v2 = policyWith({ payments: 'claim_confirm', extras: null }, '2026-11-01');
    expect(policyOn([], '2026-10-01')).toBe(DEFAULT_POLICY);
    expect(policyOn([v1, v2], '2026-05-31')).toBe(DEFAULT_POLICY);
    expect(policyOn([v1, v2], '2026-06-01').payments).toBe('direct');
    expect(policyOn([v2, v1], '2026-10-31').payments).toBe('direct'); // order of the list does not matter
    expect(policyOn([v1, v2], '2026-11-01').extras).toBeNull();
    expect(policyForMonth([v1, v2], '2026-11').extras).toBeNull();
  });

  it('computes when an automatic close falls due', () => {
    const auto = policyWith({ monthClose: { mode: 'auto', afterDays: 5, afterClose: 'flag' } }).doc;
    expect(autoCloseDate(auto, '2026-10')).toBe('2026-11-05');
    expect(autoCloseDate(DEFAULT_POLICY, '2026-10')).toBeNull();
  });

  it('limits back-dated rate cards by the workspace rule', () => {
    const p = (b: Policy['rateCards']['backdating']): Policy => ({
      ...DEFAULT_POLICY,
      rateCards: { backdating: b },
    });
    const today = '2026-10-20';
    expect(rateCardStartAllowed(p('unrestricted'), '2020-01-01', today, '2026-09')).toBe(true);
    expect(rateCardStartAllowed(p('current_month'), '2026-10-01', today, null)).toBe(true);
    expect(rateCardStartAllowed(p('current_month'), '2026-09-30', today, null)).toBe(false);
    expect(rateCardStartAllowed(p('current_month'), '2026-10-01', today, '2026-10')).toBe(false); // October already closed
    expect(rateCardStartAllowed(p('current_month'), '2026-11-01', today, '2026-10')).toBe(true);
    expect(rateCardStartAllowed(p('none'), '2026-10-19', today, null)).toBe(false);
    expect(rateCardStartAllowed(p('none'), '2026-10-20', today, null)).toBe(true);
  });
});

describe('rules change what is billed', () => {
  it('charges a share of the meal on a leave day when the workspace says so', () => {
    const s = buildStatements(
      prep({ policies: [policyWith({ leave: { chargeBps: 5000 } })] }),
      ['smruti'],
      ['2026-10'],
    )[0]!;
    // Friday 16-Oct is Non Veg at 170: half is 85.
    expect(s.leaveAmount).toBe(rupees(85));
    expect(s.liveTotal).toBe(rupees(3030) + rupees(85));
    expect(s.counts.leave).toBe(1);
  });

  it('can drop the flat monthly fee, or require more meals before it applies', () => {
    expect(jovialOct({ policies: [policyWith({ extras: null })] }).liveTotal).toBe(rupees(3220));
    expect(jovialOct({ policies: [policyWith({ extras: { minMeals: 20 } })] }).extrasAmount).toBe(
      rupees(40),
    );
    expect(jovialOct({ policies: [policyWith({ extras: { minMeals: 21 } })] }).extrasAmount).toBe(
      0,
    );
  });

  it('takes the flat fee from the card in force on the first of the month', () => {
    const dearer = {
      ...CARD_NOV,
      id: 'mid',
      effectiveFrom: '2026-10-15',
      extrasPerMonth: rupees(99),
    };
    expect(jovialOct({ rateCards: [CARD_APR, dearer] }).extrasAmount).toBe(rupees(40));
  });

  it('falls back to the first meal day when the first card starts mid-month', () => {
    const late = { ...CARD_APR, effectiveFrom: '2026-10-15', extrasPerMonth: rupees(55) };
    const p = prep({
      rateCards: [late],
      people: [{ ...JOVIAL, activeFrom: '2026-10-15' }],
      log: [],
    });
    expect(buildStatements(p, ['jovial'], ['2026-10'])[0]!.extrasAmount).toBe(rupees(55));
  });

  it('counts tentative holidays too when the workspace says all holidays count', () => {
    const base = { rateCards: [CARD_APR, CARD_NOV], log: [] };
    const confirmed = buildStatements(prep(base), ['jovial'], ['2026-11'])[0]!;
    const all = buildStatements(
      prep({ ...base, policies: [policyWith({ holidays: { count: 'all' } })] }),
      ['jovial'],
      ['2026-11'],
    )[0]!;
    expect(confirmed.counts.meals).toBe(18);
    expect(all.counts.meals).toBe(16);
  });

  it('serves Saturdays when they are working days and the card has a menu for them', () => {
    const policies = [policyWith({ workingDays: [1, 2, 3, 4, 5, 6] })];
    const card = { ...CARD_APR, menu: { ...CARD_APR.menu, 6: 'Veg' as const } };
    const p = prep({ policies, rateCards: [card], log: [] });
    const sat = ledgerMonth(p, JOVIAL, '2026-10').find((d) => d.date === '2026-10-03')!;
    expect(sat).toMatchObject({ status: 'Meal', meal: 'Veg' });
    expect(ledgerMonth(p, JOVIAL, '2026-10').some((d) => d.date === '2026-10-04')).toBe(false); // Sunday
  });

  it('refuses to guess: no card, or a working day with no meal', () => {
    expect(() => jovialOct({ rateCards: [] })).toThrowError(EngineError);
    try {
      jovialOct({ rateCards: [] });
    } catch (e) {
      expect((e as EngineError).code).toBe('NO_RATE_CARD');
      expect((e as EngineError).date).toBe('2026-10-01');
    }
    const noFriday = {
      ...CARD_APR,
      menu: { 1: 'Veg' as const, 2: 'Veg' as const, 3: 'Non Veg' as const, 4: 'Veg' as const },
    };
    expect(() => jovialOct({ rateCards: [noFriday] })).toThrowError(/serves nothing/);
  });

  it('does not need a card on days that are not priced', () => {
    // Everything in October is a holiday: nothing to price, so no card is needed.
    const holidays = Array.from({ length: 31 }, (_, i) => ({
      id: `h${i}`,
      name: 'Closed',
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      location: null,
      confirmed: true,
    }));
    const s = jovialOct({ rateCards: [], holidays, log: [] });
    expect(s.liveTotal).toBe(0);
  });

  it('applies the rules of the month, not of today', () => {
    const policies = [policyWith({ extras: null }, '2026-11-01')];
    const [oct, nov] = buildStatements(
      prep({ policies, rateCards: [CARD_APR, CARD_NOV], log: [] }),
      ['jovial'],
      ['2026-10', '2026-11'],
    );
    expect(oct!.extrasAmount).toBe(rupees(40));
    expect(nov!.extrasAmount).toBe(0);
  });
});

describe('same-day entries combine predictably', () => {
  it('leave beats everything; the latest switch wins; extras add up', () => {
    const d = '2026-10-07'; // Wednesday, Non Veg
    const at = (n: number) => `2026-10-01T10:0${n}:00Z`;
    const run = (log: ReturnType<typeof entry>[]) =>
      ledgerMonth(prep({ log }), JOVIAL, '2026-10').find((x) => x.date === d)!;

    expect(
      run([
        entry({ date: d, personId: 'jovial', change: 'Switch to Veg', loggedAt: at(1) }),
        entry({ date: d, personId: 'jovial', change: 'Switch to Non Veg', loggedAt: at(2) }),
      ]),
    ).toMatchObject({ meal: 'Non Veg', mealPrice: rupees(170) });

    expect(
      run([
        entry({ date: d, personId: 'jovial', change: 'Switch to Non Veg', loggedAt: at(1) }),
        entry({ date: d, personId: 'jovial', change: 'Switch to Veg', loggedAt: at(2) }),
      ]),
    ).toMatchObject({ meal: 'Veg', mealPrice: rupees(150) });

    expect(
      run([
        entry({ date: d, personId: 'jovial', change: 'Extra Chapati', qty: 2 }),
        entry({ date: d, personId: 'jovial', change: 'Extra Chapati', qty: 3 }),
        entry({ date: d, personId: 'jovial', change: 'Extra Bhakri', qty: 1 }),
      ]),
    ).toMatchObject({ extraChapati: 5, extraBhakri: 1, breadAmount: 5 * rupees(15) + rupees(30) });

    expect(
      run([
        entry({ date: d, personId: 'jovial', change: 'Extra Bhakri', qty: 4 }),
        entry({ date: d, personId: 'jovial', change: 'Leave' }),
      ]),
    ).toMatchObject({ status: 'Leave', dayTotal: 0, extraBhakri: 0 });
  });

  it('breaks a tie between equal timestamps by id, so the result never depends on input order', () => {
    const d = '2026-10-07';
    const a = entry({
      id: 'a',
      date: d,
      personId: 'jovial',
      change: 'Switch to Veg',
      loggedAt: '2026-10-01T10:00:00Z',
    });
    const b = entry({
      id: 'b',
      date: d,
      personId: 'jovial',
      change: 'Switch to Non Veg',
      loggedAt: '2026-10-01T10:00:00Z',
    });
    const one = ledgerMonth(prep({ log: [a, b] }), JOVIAL, '2026-10').find((x) => x.date === d)!;
    const two = ledgerMonth(prep({ log: [b, a] }), JOVIAL, '2026-10').find((x) => x.date === d)!;
    expect(one).toEqual(two);
    expect(one.meal).toBe('Non Veg');
  });

  it('a Supplier Off beats a consumer leave and a holiday beats a Supplier Off', () => {
    const off = entry({ date: '2026-10-07', allConsumers: true, change: 'Supplier Off' });
    const leave = entry({ date: '2026-10-07', personId: 'jovial', change: 'Leave' });
    expect(
      ledgerMonth(prep({ log: [off, leave] }), JOVIAL, '2026-10').find(
        (x) => x.date === '2026-10-07',
      )!.status,
    ).toBe('Supplier Off');
    const offOnHoliday = entry({ date: '2026-10-02', allConsumers: true, change: 'Supplier Off' });
    expect(
      ledgerMonth(prep({ log: [offOnHoliday] }), JOVIAL, '2026-10').find(
        (x) => x.date === '2026-10-02',
      )!.status,
    ).toBe('Holiday');
  });
});

describe('closing months under the workspace rules', () => {
  it('ignores stored closes when closing is switched off', () => {
    const s = jovialOct({
      policies: [policyWith({ monthClose: { mode: 'off' } })],
      closes: [close({ billed: rupees(1) })],
    });
    expect(s.closed).toBe(false);
    expect(s.billed).toBe(s.liveTotal);
  });

  it('lists the automatic closes that are due, once the grace days have passed', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 5, afterClose: 'flag' } }),
    ];
    expect(dueAutoCloses(prep({ policies, today: '2026-11-05' }))).toEqual([]);
    const due = dueAutoCloses(prep({ policies, today: '2026-11-06' }));
    expect(due.map((d) => `${d.consumerId}:${d.month}:${d.billed}`).sort()).toEqual([
      `jovial:2026-10:${rupees(3260)}`,
      `smruti:2026-10:${rupees(3030)}`,
    ]);
    const existing = [close(), close({ consumerId: 'smruti', billed: rupees(3030) })];
    expect(dueAutoCloses(prep({ policies, today: '2026-11-06', closes: existing }))).toEqual([]);
  });

  it('never closes months before a consumer started or after they left, and never under manual rules', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 0, afterClose: 'flag' } }),
    ];
    const left = { ...SMRUTI, activeTo: '2026-10-31' };
    const due = dueAutoCloses(prep({ policies, people: [JOVIAL, left], today: '2027-01-15' }));
    const keys = due.map((d) => `${d.consumerId}:${d.month}`);
    expect(keys).toContain('smruti:2026-10');
    expect(keys).not.toContain('smruti:2026-11');
    expect(keys).not.toContain('jovial:2026-09');
    expect(dueAutoCloses(prep({ today: '2027-01-15' }))).toEqual([]);
  });

  it('freezes exactly what the statement shows', () => {
    expect(closeSnapshot(prep(), 'jovial', '2026-10')).toEqual({ meals: 20, billed: rupees(3260) });
    expect(() => closeSnapshot(prep(), 'nobody', '2026-10')).toThrowError(EngineError);
  });

  it('flags the difference when a month is reopened, edited and the old close remains', () => {
    const s = jovialOct({
      closes: [close()],
      log: [entry({ date: '2026-10-01', personId: 'jovial', change: 'Leave' })],
    });
    expect(STATUS_LABEL[s.status]).toBe('⚠ Changed after close');
    expect(s.changedAfterClose).toBe(s.liveTotal - rupees(3260));
  });
});

describe('month range for the picker', () => {
  it('runs from the earliest consumer start to the current month, and rolls forward', () => {
    expect(monthRange(prep({ today: '2026-10-24' }))).toEqual(['2026-10']);
    expect(monthRange(prep({ today: '2027-01-02' }))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('is just the current month when nobody is billed yet', () => {
    expect(monthRange(prep({ people: [], today: '2026-10-24' }))).toEqual(['2026-10']);
  });
});
