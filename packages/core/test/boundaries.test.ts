import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EngineError,
  FREE_LIMITS,
  addMonths,
  buildStatements,
  canAdmit,
  capacityPlan,
  checkClaim,
  checkDecision,
  checkLogChange,
  checkLogEntry,
  checkRateCard,
  checkReversal,
  dayName,
  dueAutoCloses,
  formatDate,
  formatDisplayMonth,
  formatMoney,
  fromEpochDay,
  hasErrors,
  isKnownTimeZone,
  isLeapYear,
  isPaise,
  isValidDate,
  isValidMonth,
  ledgerDay,
  ledgerMonth,
  meter,
  monthRange,
  monthStart,
  parseDate,
  policyOn,
  rupees,
  STATUS_LABEL,
  toEpochDay,
  type Actor,
  type Issue,
  type NewLogEntry,
} from '../src/index.ts';
import {
  ADMIN,
  CARD_APR,
  CARD_NOV,
  JOVIAL,
  NAMRATA,
  SMRUTI,
  claim,
  close,
  decision,
  entry,
  policyWith,
  prep,
  settlement,
} from './fixtures.ts';

const codes = (issues: Issue[], severity?: Issue['severity']) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const consumer: Actor = { personId: 'jovial', role: 'consumer' };
const supplier: Actor = { personId: 'namrata', role: 'supplier' };
const admin: Actor = { personId: 'admin', role: 'admin' };
const NOW = { date: '2026-10-13', time: '12:00' };
const leave = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  date: '2026-10-14',
  personId: 'jovial',
  allConsumers: false,
  change: 'Leave',
  qty: null,
  ...over,
});
const off = (over: Partial<NewLogEntry> = {}): NewLogEntry => ({
  date: '2026-10-14',
  personId: null,
  allConsumers: true,
  change: 'Supplier Off',
  qty: null,
  ...over,
});

describe('dates and money, at the edges', () => {
  it('knows which centuries are leap years', () => {
    expect([1900, 2000, 2100, 2024, 2026, 2400].map(isLeapYear)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(isValidDate('1900-02-29')).toBe(false);
    expect(isValidDate('2000-02-29')).toBe(true);
  });

  it('has the right length for every month', () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((len, i) => {
      const mm = String(i + 1).padStart(2, '0');
      expect(isValidDate(`2026-${mm}-${len}`), `${mm}-${len}`).toBe(true);
      expect(isValidDate(`2026-${mm}-${len + 1}`), `${mm}-${len + 1}`).toBe(false);
    });
  });

  it('bounds months and days', () => {
    for (const bad of ['2026-00', '2026-13', '2026-1', '26-10', '2026-10-01'])
      expect(isValidMonth(bad), bad).toBe(false);
    for (const ok of ['2026-01', '2026-12']) expect(isValidMonth(ok), ok).toBe(true);
    for (const bad of ['2026-10-00', '2026-10-32', '2026-00-10', '2026-13-10'])
      expect(isValidDate(bad), bad).toBe(false);
    expect(isValidDate('2026-12-31')).toBe(true);
  });

  it('throws on input that is not a date or month', () => {
    expect(() => parseDate('tomorrow')).toThrowError(RangeError);
    expect(() => monthStart('2026-13')).toThrowError(RangeError);
  });

  it('pads years below 1000', () => {
    expect(formatDate(999, 1, 1)).toBe('0999-01-01');
    expect(addMonths('0999-12', 1)).toBe('1000-01');
    expect(addMonths('0999-11', 1)).toBe('0999-12');
    expect(formatDisplayMonth('2005-01')).toBe('Jan-05');
  });

  it('round-trips every day from year 0 to 9999 and agrees with the platform', () => {
    fc.assert(
      fc.property(fc.integer({ min: -719_528, max: 2_932_896 }), (z) => {
        const s = fromEpochDay(z);
        expect(toEpochDay(s)).toBe(z);
        expect(new Date(`${s}T00:00:00Z`).getTime() / 86_400_000).toBe(z);
      }),
      { numRuns: 3000 },
    );
  });

  it('recognises time zones and names weekdays', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect([0, 1, 6].map((w) => dayName(w as 0 | 1 | 6))).toEqual(['Sun', 'Mon', 'Sat']);
  });

  it('validates paise and money formatting', () => {
    expect(() => rupees(Number.NaN)).toThrowError(RangeError);
    expect(() => rupees(Infinity)).toThrowError(RangeError);
    expect([5, 0, -3].map(isPaise)).toEqual([true, true, true]);
    for (const bad of [1.5, '1', Number.NaN, 2 ** 53, null, undefined])
      expect(isPaise(bad), String(bad)).toBe(false);
    expect(formatMoney(15005)).toBe('₹150.05');
  });
});

describe('who counts as billed, and when', () => {
  it('never bills a consumer who has no start date', () => {
    const p = prep({ people: [{ ...JOVIAL, activeFrom: null }], log: [] });
    expect(
      ledgerMonth(p, { ...JOVIAL, activeFrom: null }, '2026-10').every(
        (d) => d.status === 'Inactive',
      ),
    ).toBe(true);
    expect(buildStatements(p, ['jovial'], ['2026-10'])[0]!.liveTotal).toBe(0);
  });

  it('bills from the start date and through the end date, both inclusive', () => {
    const person = { ...JOVIAL, activeFrom: '2026-10-07', activeTo: '2026-10-15' };
    const p = prep({ people: [person], log: [] });
    const day = (d: string) => ledgerMonth(p, person, '2026-10').find((x) => x.date === d)!.status;
    expect(day('2026-10-06')).toBe('Inactive');
    expect(day('2026-10-07')).toBe('Meal');
    expect(day('2026-10-15')).toBe('Meal');
    expect(day('2026-10-16')).toBe('Inactive');
  });

  it('labels each day Actual up to and including today, Projected after', () => {
    const p = prep({ today: '2026-10-14' });
    expect(ledgerDay(p, JOVIAL, '2026-10-14')!.basis).toBe('Actual');
    expect(ledgerDay(p, JOVIAL, '2026-10-15')!.basis).toBe('Projected');
    expect(ledgerDay(p, JOVIAL, '2026-10-13')!.basis).toBe('Actual');
  });

  it('treats a month as ended only after its last day', () => {
    const s = (today: string) => buildStatements(prep({ today }), ['jovial'], ['2026-10'])[0]!;
    expect(s('2026-10-31').basis).toBe('Projected');
    expect(s('2026-11-01').basis).toBe('Actual');
  });

  it('ignores a malformed Supplier Off that is not for everyone', () => {
    const bad = entry({
      date: '2026-10-07',
      personId: 'jovial',
      allConsumers: false,
      change: 'Supplier Off',
    });
    expect(ledgerDay(prep({ log: [bad] }), JOVIAL, '2026-10-07')!.status).toBe('Meal');
  });

  it('lists months from the earliest consumer, whatever the order, ignoring staff', () => {
    const late = { ...SMRUTI, activeFrom: '2026-12-01' };
    const staff = { ...ADMIN, activeFrom: '2025-01-01' };
    expect(monthRange(prep({ people: [late, staff, JOVIAL], today: '2027-01-10' }))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(monthRange(prep({ people: [JOVIAL, late], today: '2026-12-10' }))[0]).toBe('2026-10');
  });
});

describe('leave days and their charge', () => {
  const half = [policyWith({ leave: { chargeBps: 5000 } })];
  const day = (log: ReturnType<typeof entry>[], date: string) =>
    ledgerDay(prep({ policies: half, log }), JOVIAL, date)!;

  it('charges the meal that would have been served, after any switch', () => {
    // Wednesday 07-Oct is Non Veg (170); Tuesday 06-Oct is Veg (150).
    expect(
      day([entry({ date: '2026-10-07', personId: 'jovial', change: 'Leave' })], '2026-10-07')
        .leaveAmount,
    ).toBe(rupees(85));
    const toVeg = [
      entry({ date: '2026-10-07', personId: 'jovial', change: 'Leave' }),
      entry({ date: '2026-10-07', personId: 'jovial', change: 'Switch to Veg' }),
    ];
    expect(day(toVeg, '2026-10-07').leaveAmount).toBe(rupees(75));
    const toNonVeg = [
      entry({ date: '2026-10-06', personId: 'jovial', change: 'Leave' }),
      entry({ date: '2026-10-06', personId: 'jovial', change: 'Switch to Non Veg' }),
    ];
    expect(day(toNonVeg, '2026-10-06').leaveAmount).toBe(rupees(85));
  });

  it('needs no rate card when a leave costs nothing', () => {
    const p = prep({
      rateCards: [],
      log: [entry({ date: '2026-10-14', personId: 'jovial', change: 'Leave' })],
    });
    expect(ledgerDay(p, JOVIAL, '2026-10-14')!.status).toBe('Leave');
  });
});

describe('statements, at the edges', () => {
  const stmt = (over: Parameters<typeof prep>[0]) =>
    buildStatements(prep(over), ['jovial'], ['2026-10'])[0]!;

  it('counts extra chapati as well as bhakri', () => {
    const log = [
      entry({ date: '2026-10-05', personId: 'jovial', change: 'Extra Chapati', qty: 3 }),
      entry({ date: '2026-10-06', personId: 'jovial', change: 'Extra Chapati', qty: 2 }),
    ];
    const s = stmt({ log });
    expect(s.counts.extraChapati).toBe(5);
    expect(s.breadAmount).toBe(5 * rupees(15));
  });

  it('shows a closed month with no changes as an ordinary month, not as changed', () => {
    const s = stmt({
      closes: [close()],
      log: [entry({ date: '2026-10-01', personId: 'jovial', change: 'Extra Bhakri', qty: 2 })],
    });
    expect(s.changedAfterClose).toBe(0);
    expect(STATUS_LABEL[s.status]).toBe('Due');
  });

  it("keeps one consumer's money and other months out of this consumer's month", () => {
    const s = stmt({
      today: '2026-11-15',
      claims: [claim({ id: 'a', consumerId: 'smruti' }), claim({ id: 'b', forMonth: '2026-09' })],
      decisions: [decision({ claimId: 'a' }), decision({ claimId: 'b' })],
      settlements: [
        settlement({ id: 's1', consumerId: 'smruti' }),
        settlement({ id: 's2', forMonth: '2026-09' }),
        settlement({ id: 's3', consumerId: 'smruti', type: 'Query', amount: null }),
        settlement({ id: 's4', forMonth: '2026-09', type: 'Query', amount: null }),
      ],
    });
    expect(s.paid).toBe(0);
    expect(s.claimedPending).toBe(0);
    expect(s.openQueries).toBe(0);
  });

  it('counts admin queries, nets them against resolutions, and never goes below zero', () => {
    const q = (id: string) => settlement({ id, type: 'Query', amount: null });
    const r = (id: string) => settlement({ id, type: 'Query Resolved', amount: null });
    const open = stmt({ settlements: [q('q1')] });
    expect(open.openQueries).toBe(1);
    expect(STATUS_LABEL[open.status]).toBe('Query open');
    expect(stmt({ settlements: [q('q1'), r('r1')] }).openQueries).toBe(0);
    expect(stmt({ settlements: [q('q1'), q('q2'), r('r1')] }).openQueries).toBe(1);
    expect(stmt({ settlements: [r('r1'), r('r2')] }).openQueries).toBe(0);
  });

  it('accepts months in any order, returns nothing for none, and refuses an unknown person', () => {
    const p = prep({ rateCards: [CARD_APR, CARD_NOV], log: [] });
    const both = buildStatements(p, ['jovial'], ['2026-11', '2026-10']);
    expect(both.map((x) => x.month)).toEqual(['2026-10', '2026-11']);
    expect(both[1]!.earlierUnpaid).toBe(both[0]!.balance);
    expect(buildStatements(p, ['jovial'], [])).toEqual([]);
    expect(() => buildStatements(p, ['nobody'], ['2026-10'])).toThrowError(EngineError);
  });

  it('is the same whichever order the rate cards are supplied in', () => {
    const mid = { ...CARD_NOV, id: 'mid', effectiveFrom: '2026-11-16', veg: rupees(155) };
    const forward = buildStatements(
      prep({ rateCards: [CARD_APR, CARD_NOV, mid], log: [] }),
      ['jovial'],
      ['2026-10', '2026-11'],
    );
    for (const order of [
      [mid, CARD_NOV, CARD_APR],
      [CARD_NOV, mid, CARD_APR],
      [CARD_APR, mid, CARD_NOV],
    ]) {
      expect(
        buildStatements(prep({ rateCards: order, log: [] }), ['jovial'], ['2026-10', '2026-11']),
      ).toEqual(forward);
    }
  });

  it('is the same whichever order equally-timed entries arrive in', () => {
    const at = '2026-10-01T10:00:00Z';
    const base = [
      entry({
        id: 'a',
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Veg',
        loggedAt: at,
      }),
      entry({
        id: 'b',
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Non Veg',
        loggedAt: at,
      }),
      entry({
        id: 'c',
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Veg',
        loggedAt: at,
      }),
      entry({
        id: 'd',
        date: '2026-10-07',
        personId: 'jovial',
        change: 'Switch to Non Veg',
        loggedAt: at,
      }),
    ];
    const expected = ledgerDay(prep({ log: base }), JOVIAL, '2026-10-07');
    fc.assert(
      fc.property(fc.shuffledSubarray(base, { minLength: 4, maxLength: 4 }), (perm) => {
        expect(ledgerDay(prep({ log: perm }), JOVIAL, '2026-10-07')).toEqual(expected);
      }),
      { numRuns: 60 },
    );
    expect(expected!.meal).toBe('Non Veg'); // the highest id, "d", wins the tie
  });

  it('skips consumers with no start date when listing automatic closes', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 0, afterClose: 'flag' } }),
    ];
    expect(
      dueAutoCloses(
        prep({ policies, people: [{ ...JOVIAL, activeFrom: null }], today: '2027-01-15' }),
      ),
    ).toEqual([]);
  });
});

describe('validation, at the edges', () => {
  it('says whether any issue is an error', () => {
    const e: Issue = { code: 'SHAPE', severity: 'error', message: '' };
    const w: Issue = { code: 'HOLIDAY', severity: 'warning', message: '' };
    expect(hasErrors([])).toBe(false);
    expect(hasErrors([w])).toBe(false);
    expect(hasErrors([e])).toBe(true);
    expect(hasErrors([w, e, w])).toBe(true);
  });

  it('rejects "all consumers" on any change but Supplier Off, even when a person is named', () => {
    expect(
      codes(checkLogEntry(prep(), admin, leave({ allConsumers: true }), NOW), 'error'),
    ).toContain('SHAPE');
  });

  it('does not call a month closed just because a rule is automatic, when nobody is billed', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 0, afterClose: 'flag' } }),
    ];
    const p = prep({ policies, people: [ADMIN, NAMRATA], today: '2026-11-15' });
    expect(codes(checkLogEntry(p, supplier, off(), NOW), 'error')).toEqual([]);
  });

  it('calls two entries duplicates only when they are the same thing for the same person on the same day', () => {
    const existing = prep({
      log: [
        entry({ date: '2026-10-14', personId: 'jovial', change: 'Switch to Veg' }),
        entry({ date: '2026-10-14', personId: 'smruti', change: 'Leave' }),
        entry({ date: '2026-10-15', personId: 'jovial', change: 'Leave' }),
        entry({ date: '2026-10-16', allConsumers: true, change: 'Supplier Off' }),
      ],
    });
    const dup = (e: NewLogEntry) =>
      codes(checkLogEntry(existing, admin, e, NOW), 'error').includes('DUPLICATE');
    expect(dup(leave({ change: 'Switch to Veg' }))).toBe(true);
    expect(dup(leave({ change: 'Switch to Non Veg' }))).toBe(false);
    expect(dup(leave())).toBe(false); // Smruti's leave on the 14th, Jovial's on the 15th
    expect(dup(leave({ date: '2026-10-15' }))).toBe(true);
    expect(dup(off({ date: '2026-10-14' }))).toBe(false);
    expect(dup(off({ date: '2026-10-16' }))).toBe(true);
  });

  it('warns about a tentative holiday only where tentative holidays count', () => {
    const tentative = leave({ date: '2026-11-12' });
    const later = { date: '2026-11-01', time: '09:00' };
    expect(codes(checkLogEntry(prep(), admin, tentative, later))).toEqual([]);
    expect(
      codes(
        checkLogEntry(
          prep({ policies: [policyWith({ holidays: { count: 'all' } })] }),
          admin,
          tentative,
          later,
        ),
      ),
    ).toEqual(['HOLIDAY']);
  });

  it("does not apply the cut-off to a consumer's attempt at Supplier Off, which is refused for another reason", () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: '18:00' } })],
    });
    expect(
      codes(checkLogEntry(p, consumer, off(), { date: '2026-10-14', time: '09:00' }), 'error'),
    ).toEqual(['ROLE_CANNOT']);
  });

  it('applies the closed-month rule to taking back a Supplier Off', () => {
    const mine = entry({
      date: '2026-10-14',
      allConsumers: true,
      change: 'Supplier Off',
      loggedBy: 'namrata',
    });
    expect(
      codes(checkLogChange(prep({ closes: [close()] }), supplier, mine, NOW), 'error'),
    ).toEqual(['MONTH_CLOSED']);
    expect(checkLogChange(prep(), supplier, mine, NOW)).toEqual([]);
  });

  it('closes the cut-off exactly on the minute', () => {
    const p = prep({
      policies: [policyWith({ exceptionCutoff: { daysBefore: 1, time: '18:00' } })],
    });
    const mine = entry({
      date: '2026-10-14',
      personId: 'jovial',
      change: 'Leave',
      loggedBy: 'jovial',
    });
    expect(checkLogChange(p, consumer, mine, { date: '2026-10-13', time: '17:59' })).toEqual([]);
    expect(
      codes(checkLogChange(p, consumer, mine, { date: '2026-10-13', time: '18:00' }), 'error'),
    ).toEqual(['CUTOFF_PASSED']);
  });

  it('checks the person on a claim before anything else about them', () => {
    const p = prep({ today: '2026-10-28' });
    const base = {
      consumerId: 'ghost',
      paidAt: '2026-10-25',
      forMonth: '2026-10',
      amount: rupees(100),
      method: 'UPI',
    };
    expect(codes(checkClaim(p, admin, base))).toEqual(['UNKNOWN_PERSON']);
    expect(codes(checkClaim(p, admin, { ...base, consumerId: 'namrata' }))).toEqual([
      'NOT_A_CONSUMER',
    ]);
  });

  it('rejects a malformed month even where there is no start date to compare with', () => {
    const p = prep({ today: '2026-10-28', people: [{ ...JOVIAL, activeFrom: null }] });
    const base = {
      consumerId: 'jovial',
      paidAt: '2026-10-25',
      forMonth: 'soon',
      amount: rupees(100),
      method: 'UPI',
    };
    expect(codes(checkClaim(p, consumer, base))).toEqual(['MONTH_RANGE']);
  });

  it('accepts a payment dated today', () => {
    const p = prep({ today: '2026-10-28' });
    expect(
      checkClaim(p, consumer, {
        consumerId: 'jovial',
        paidAt: '2026-10-28',
        forMonth: '2026-10',
        amount: 100,
        method: 'Cash',
      }),
    ).toEqual([]);
  });

  it('finds the claim among several, and wants a reason (not just text) to reverse', () => {
    const p = prep({
      claims: [claim(), claim({ id: 'claim-2' })],
      decisions: [decision({ claimId: 'claim-2' })],
    });
    expect(checkDecision(p, supplier, 'claim-1', 'Confirmed', null)).toEqual([]);
    expect(codes(checkDecision(p, supplier, 'claim-2', 'Confirmed', null))).toEqual([
      'ALREADY_DECIDED',
    ]);
    expect(codes(checkReversal(p, admin, 'claim-2', null))).toEqual(['REASON_REQUIRED']);
  });

  it('spots a duplicate rate card date among several cards, and uses the latest closed month', () => {
    const menu = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' };
    const p = prep({ rateCards: [CARD_APR, CARD_NOV], today: '2026-10-20' });
    expect(codes(checkRateCard(p, '2026-11-01', menu))).toEqual(['DUPLICATE']);
    expect(codes(checkRateCard(p, '2026-04-01', menu)).includes('DUPLICATE')).toBe(true);

    const closes = [
      close({ forMonth: '2026-10' }),
      close({ forMonth: '2026-09', consumerId: 'smruti' }),
    ];
    expect(codes(checkRateCard(prep({ closes, today: '2026-10-20' }), '2026-10-25', menu))).toEqual(
      ['BACKDATED_RATE_CARD'],
    );
    expect(
      codes(
        checkRateCard(
          prep({ closes: [...closes].reverse(), today: '2026-10-20' }),
          '2026-10-25',
          menu,
        ),
      ),
    ).toEqual(['BACKDATED_RATE_CARD']);
  });
});

describe('the meter and the plan, at the edges', () => {
  const tight = { requestsPerDay: 100, people: 100, rows: 100, bytes: 100 };

  it('reports a ratio for a zero limit without dividing by zero', () => {
    const none = meter(
      { requestsLast24h: 0, people: 0, rows: 0, bytes: 0 },
      { ...FREE_LIMITS, people: 0 },
      null,
      '2026-10-24',
    );
    expect(none.ratios.people).toBe(0);
    const some = meter(
      { requestsLast24h: 0, people: 1, rows: 0, bytes: 0 },
      { ...FREE_LIMITS, people: 0 },
      null,
      '2026-10-24',
    );
    expect(some.ratios.people).toBe(Infinity);
  });

  it('names the first measure when several are equally close to the limit', () => {
    const m = meter(
      { requestsLast24h: 50, people: 50, rows: 50, bytes: 50 },
      tight,
      null,
      '2026-10-24',
    );
    expect(m.worst).toBe('requestsLast24h');
  });

  it('prefers "projects" as the binding limit when both are equal', () => {
    const plan = capacityPlan({
      hostProjects: 52,
      reservedProjects: 2,
      accountRequestsPerDay: 62_500,
      headroom: 0.2,
      perWorkspaceRequestsPerDay: 1000,
    });
    expect(plan).toMatchObject({ byProjects: 50, byRequests: 50, binding: 'projects' });
    expect(canAdmit(plan, 49)).toBe(true);
    expect(canAdmit(plan, 50)).toBe(false);
  });

  it('picks the latest applicable policy version whichever order they are listed in', () => {
    const old = policyWith({ payments: 'direct' }, '2026-01-01');
    const next = policyWith({ payments: 'claim_confirm' }, '2026-06-01');
    expect(policyOn([old, next], '2026-10-01').payments).toBe('claim_confirm');
    expect(policyOn([next, old], '2026-10-01').payments).toBe('claim_confirm');
    expect(policyOn([old, next], '2026-03-01').payments).toBe('direct');
  });
});
