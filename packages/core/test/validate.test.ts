import { describe, expect, it } from 'vitest';
import {
  checkClaim,
  checkClaimWithdrawal,
  checkDecision,
  checkLogChange,
  checkLogEntry,
  checkRateCard,
  checkReversal,
  hasErrors,
  isMonthClosed,
  rupees,
  type Actor,
  type Issue,
  type NewLogEntry,
} from '../src/index.ts';
import { claim, close, decision, entry, policyWith, prep } from './fixtures.ts';

const NOW = { date: '2026-10-13', time: '12:00' };
const consumer: Actor = { personId: 'jovial', role: 'consumer' };
const supplier: Actor = { personId: 'namrata', role: 'supplier' };
const admin: Actor = { personId: 'admin', role: 'admin' };

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
const codes = (issues: Issue[], severity?: Issue['severity']) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

describe('who may log what', () => {
  const p = prep();
  it('lets a consumer log for themselves', () => {
    expect(checkLogEntry(p, consumer, leave(), NOW)).toEqual([]);
  });
  it('stops a consumer logging for someone else or marking the kitchen off', () => {
    expect(codes(checkLogEntry(p, consumer, leave({ personId: 'smruti' }), NOW))).toContain(
      'FOR_SELF_ONLY',
    );
    expect(codes(checkLogEntry(p, consumer, off(), NOW))).toContain('ROLE_CANNOT');
  });
  it('lets the supplier mark the kitchen off and nothing else', () => {
    expect(checkLogEntry(p, supplier, off(), NOW)).toEqual([]);
    expect(codes(checkLogEntry(p, supplier, leave(), NOW))).toContain('ROLE_CANNOT');
  });
  it('lets the admin log anything valid for anyone', () => {
    expect(checkLogEntry(p, admin, leave({ personId: 'smruti' }), NOW)).toEqual([]);
    expect(checkLogEntry(p, admin, off(), NOW)).toEqual([]);
  });
});

describe('shape of an entry', () => {
  const p = prep();
  const e = (patch: Partial<NewLogEntry>, a: Actor = admin) =>
    codes(checkLogEntry(p, a, leave(patch), NOW), 'error');

  it('needs a real date on a working day', () => {
    expect(e({ date: '' })).toEqual(['NOT_A_DATE']);
    expect(e({ date: '2026-02-30' })).toEqual(['NOT_A_DATE']);
    expect(e({ date: '2026-10-17' })).toContain('NOT_WORKING_DAY'); // Saturday
    expect(e({ date: '2026-10-18' })).toContain('NOT_WORKING_DAY'); // Sunday
  });
  it('keeps "all consumers" for Supplier Off and requires a person otherwise', () => {
    expect(e({ allConsumers: true, personId: null })).toContain('SHAPE');
    expect(codes(checkLogEntry(p, admin, off({ allConsumers: false }), NOW), 'error')).toContain(
      'SHAPE',
    );
    expect(codes(checkLogEntry(p, admin, off({ personId: 'jovial' }), NOW), 'error')).toContain(
      'SHAPE',
    );
    expect(e({ personId: null })).toContain('SHAPE');
  });
  it('requires a quantity of 1 to 20 for extras and forbids it elsewhere', () => {
    const extra = (qty: number | null) => e({ change: 'Extra Chapati', qty });
    expect(extra(null)).toContain('QTY_REQUIRED');
    for (const bad of [0, 21, 1.5, -1]) expect(extra(bad)).toContain('QTY_RANGE');
    for (const ok of [1, 20]) expect(extra(ok)).toEqual([]);
    expect(e({ qty: 2 })).toContain('QTY_NOT_ALLOWED');
  });
  it('rejects a change it does not know', () => {
    expect(e({ change: 'Teleport' as never })).toEqual(['UNKNOWN_CHANGE']);
  });
  it('checks the person exists, is a consumer and is billed that day', () => {
    expect(e({ personId: 'ghost' })).toContain('UNKNOWN_PERSON');
    expect(e({ personId: 'namrata' })).toContain('NOT_A_CONSUMER');
    expect(e({ date: '2026-09-30' })).toContain('INACTIVE_ON_DATE');
  });
  it('refuses a duplicate leave or Supplier Off, but allows repeated extras', () => {
    const seeded = prep({
      log: [
        entry({ date: '2026-10-14', personId: 'jovial', change: 'Leave' }),
        entry({ date: '2026-10-15', allConsumers: true, change: 'Supplier Off' }),
      ],
    });
    expect(codes(checkLogEntry(seeded, admin, leave(), NOW), 'error')).toContain('DUPLICATE');
    expect(
      codes(checkLogEntry(seeded, admin, off({ date: '2026-10-15' }), NOW), 'error'),
    ).toContain('DUPLICATE');
    expect(
      codes(checkLogEntry(seeded, admin, leave({ personId: 'smruti' }), NOW), 'error'),
    ).toEqual([]);
    const extras = prep({
      log: [entry({ date: '2026-10-14', personId: 'jovial', change: 'Extra Bhakri', qty: 1 })],
    });
    expect(
      codes(checkLogEntry(extras, admin, leave({ change: 'Extra Bhakri', qty: 2 }), NOW), 'error'),
    ).toEqual([]);
  });
  it('warns, but does not refuse, on a holiday', () => {
    const issues = checkLogEntry(p, admin, leave({ date: '2026-10-20' }), NOW);
    expect(codes(issues)).toEqual(['HOLIDAY']);
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('closed months', () => {
  const closed = prep({ closes: [close()] });
  it('locks the author out of a closed month but warns the admin by default', () => {
    expect(codes(checkLogEntry(closed, consumer, leave(), NOW), 'error')).toContain('MONTH_CLOSED');
    const issues = checkLogEntry(closed, admin, leave(), NOW);
    expect(codes(issues)).toEqual(['CHANGES_AFTER_CLOSE']);
    expect(hasErrors(issues)).toBe(false);
  });
  it('refuses the admin too when the workspace blocks changes after close', () => {
    const blocked = prep({
      closes: [close()],
      policies: [policyWith({ monthClose: { mode: 'manual', afterClose: 'block' } })],
    });
    expect(codes(checkLogEntry(blocked, admin, leave(), NOW), 'error')).toContain('MONTH_CLOSED');
  });
  it("does not treat another consumer's closed month as this one's", () => {
    expect(codes(checkLogEntry(closed, admin, leave({ personId: 'smruti' }), NOW))).toEqual([]);
  });
  it('treats Supplier Off as touching every consumer, so one close is enough to lock it', () => {
    expect(codes(checkLogEntry(closed, supplier, off(), NOW), 'error')).toContain('MONTH_CLOSED');
  });
  it('counts a month as closed once its automatic grace has run out, even before the row exists', () => {
    const policies = [
      policyWith({ monthClose: { mode: 'auto', afterDays: 5, afterClose: 'flag' } }),
    ];
    expect(isMonthClosed(prep({ policies, today: '2026-11-05' }), 'jovial', '2026-10')).toBe(false);
    expect(isMonthClosed(prep({ policies, today: '2026-11-06' }), 'jovial', '2026-10')).toBe(true);
    expect(isMonthClosed(prep({ today: '2030-01-01' }), 'jovial', '2026-10')).toBe(false); // manual, never closes by itself
    expect(
      isMonthClosed(
        prep({ policies: [policyWith({ monthClose: { mode: 'off' } })], closes: [close()] }),
        'jovial',
        '2026-10',
      ),
    ).toBe(false);
  });
});

describe('the cut-off for consumers', () => {
  const policies = [policyWith({ exceptionCutoff: { daysBefore: 1, time: '18:00' } })];
  const p = prep({ policies });
  const at = (date: string, time: string) => ({ date, time });
  it('allows an exception up to the cut-off and refuses it from then on', () => {
    expect(checkLogEntry(p, consumer, leave(), at('2026-10-13', '17:59'))).toEqual([]);
    expect(codes(checkLogEntry(p, consumer, leave(), at('2026-10-13', '18:00')), 'error')).toEqual([
      'CUTOFF_PASSED',
    ]);
    expect(codes(checkLogEntry(p, consumer, leave(), at('2026-10-14', '09:00')), 'error')).toEqual([
      'CUTOFF_PASSED',
    ]);
  });
  it('does not bind the admin or the supplier', () => {
    expect(checkLogEntry(p, admin, leave(), at('2026-10-14', '09:00'))).toEqual([]);
    expect(checkLogEntry(p, supplier, off(), at('2026-10-14', '09:00'))).toEqual([]);
  });
  it('applies the same cut-off to taking an entry back', () => {
    const existing = entry({
      date: '2026-10-14',
      personId: 'jovial',
      change: 'Leave',
      loggedBy: 'jovial',
    });
    expect(checkLogChange(p, consumer, existing, at('2026-10-13', '17:00'))).toEqual([]);
    expect(
      codes(checkLogChange(p, consumer, existing, at('2026-10-13', '19:00')), 'error'),
    ).toEqual(['CUTOFF_PASSED']);
  });
});

describe('changing or removing an entry', () => {
  const p = prep();
  const mine = entry({
    date: '2026-10-14',
    personId: 'jovial',
    change: 'Leave',
    loggedBy: 'jovial',
  });
  it('lets the author, and the admin, and nobody else', () => {
    expect(checkLogChange(p, consumer, mine, NOW)).toEqual([]);
    expect(checkLogChange(p, admin, mine, NOW)).toEqual([]);
    expect(codes(checkLogChange(p, { personId: 'smruti', role: 'consumer' }, mine, NOW))).toEqual([
      'ONLY_AUTHOR',
    ]);
  });
  it('applies the closed-month rule to changes as well', () => {
    expect(
      codes(checkLogChange(prep({ closes: [close()] }), consumer, mine, NOW), 'error'),
    ).toEqual(['MONTH_CLOSED']);
  });
});

describe('claims', () => {
  const p = prep({ today: '2026-10-28' });
  const base = {
    consumerId: 'jovial',
    paidAt: '2026-10-25',
    forMonth: '2026-10',
    amount: rupees(100),
    method: 'UPI',
  };
  it('accepts a sound claim', () => {
    expect(checkClaim(p, consumer, base)).toEqual([]);
  });
  it('checks amount, method, month and date', () => {
    expect(codes(checkClaim(p, consumer, { ...base, amount: 0 }))).toContain('AMOUNT');
    expect(codes(checkClaim(p, consumer, { ...base, amount: -5 }))).toContain('AMOUNT');
    expect(codes(checkClaim(p, consumer, { ...base, amount: 10.5 }))).toContain('AMOUNT');
    expect(codes(checkClaim(p, consumer, { ...base, method: 'Barter' }))).toContain('METHOD');
    expect(codes(checkClaim(p, consumer, { ...base, forMonth: '2026-09' }))).toContain(
      'MONTH_RANGE',
    ); // before they were billed
    expect(codes(checkClaim(p, consumer, { ...base, forMonth: '2026-11' }))).toContain(
      'MONTH_RANGE',
    ); // after the current month
    expect(codes(checkClaim(p, consumer, { ...base, forMonth: 'soon' }))).toContain('MONTH_RANGE');
    expect(codes(checkClaim(p, consumer, { ...base, paidAt: '2026-10-29' }))).toContain(
      'PAID_IN_FUTURE',
    );
    expect(codes(checkClaim(p, consumer, { ...base, paidAt: 'yesterday' }))).toContain(
      'NOT_A_DATE',
    );
  });
  it('keeps claims to their owner, and away from the supplier', () => {
    expect(codes(checkClaim(p, consumer, { ...base, consumerId: 'smruti' }))).toContain(
      'FOR_SELF_ONLY',
    );
    expect(codes(checkClaim(p, supplier, base))).toEqual(['ROLE_CANNOT']);
    expect(checkClaim(p, admin, base)).toEqual([]);
  });
  it('is switched off where the workspace records payments directly', () => {
    const direct = prep({ today: '2026-10-28', policies: [policyWith({ payments: 'direct' })] });
    expect(codes(checkClaim(direct, consumer, base))).toEqual(['CLAIMS_DISABLED']);
    expect(checkClaim(direct, admin, base)).toEqual([]);
  });
  it('lets the author withdraw until a decision exists', () => {
    const open = prep({ claims: [claim()] });
    expect(checkClaimWithdrawal(open, consumer, 'claim-1')).toEqual([]);
    expect(
      codes(checkClaimWithdrawal(open, { personId: 'smruti', role: 'consumer' }, 'claim-1')),
    ).toEqual(['ONLY_AUTHOR']);
    expect(codes(checkClaimWithdrawal(open, consumer, 'nope'))).toEqual(['NO_SUCH_CLAIM']);
    const decided = prep({ claims: [claim()], decisions: [decision()] });
    expect(codes(checkClaimWithdrawal(decided, consumer, 'claim-1'))).toEqual(['ALREADY_DECIDED']);
    expect(codes(checkClaimWithdrawal(decided, admin, 'claim-1'))).toEqual(['ALREADY_DECIDED']);
  });
});

describe('the supplier decides once', () => {
  const pending = prep({ claims: [claim()] });
  it('accepts a first decision', () => {
    expect(checkDecision(pending, supplier, 'claim-1', 'Confirmed', null)).toEqual([]);
    expect(checkDecision(pending, supplier, 'claim-1', 'Disputed', 'not received')).toEqual([]);
  });
  it('requires a reason to dispute', () => {
    expect(codes(checkDecision(pending, supplier, 'claim-1', 'Disputed', null))).toEqual([
      'REASON_REQUIRED',
    ]);
    expect(codes(checkDecision(pending, supplier, 'claim-1', 'Disputed', '   '))).toEqual([
      'REASON_REQUIRED',
    ]);
  });
  it('rejects a second decision, even from the same person and even after a reversal', () => {
    const decided = prep({ claims: [claim()], decisions: [decision()] });
    expect(
      codes(checkDecision(decided, supplier, 'claim-1', 'Disputed', 'changed my mind')),
    ).toEqual(['ALREADY_DECIDED']);
    const reversed = prep({ claims: [claim()], decisions: [decision({ voided: true })] });
    expect(codes(checkDecision(reversed, supplier, 'claim-1', 'Confirmed', null))).toEqual([
      'ALREADY_DECIDED',
    ]);
  });
  it("is the supplier's alone, and needs a real claim and a real verdict", () => {
    expect(codes(checkDecision(pending, admin, 'claim-1', 'Confirmed', null))).toEqual([
      'ROLE_CANNOT',
    ]);
    expect(codes(checkDecision(pending, consumer, 'claim-1', 'Confirmed', null))).toEqual([
      'ROLE_CANNOT',
    ]);
    expect(codes(checkDecision(pending, supplier, 'nope', 'Confirmed', null))).toEqual([
      'NO_SUCH_CLAIM',
    ]);
    expect(codes(checkDecision(pending, supplier, 'claim-1', 'Maybe', null))).toEqual(['SHAPE']);
  });
  it('can be reversed only by the admin, once, with a reason', () => {
    const decided = prep({ claims: [claim()], decisions: [decision()] });
    expect(checkReversal(decided, admin, 'claim-1', 'paid twice')).toEqual([]);
    expect(codes(checkReversal(decided, supplier, 'claim-1', 'x'))).toEqual(['ROLE_CANNOT']);
    expect(codes(checkReversal(decided, admin, 'claim-1', ' '))).toEqual(['REASON_REQUIRED']);
    expect(codes(checkReversal(pending, admin, 'claim-1', 'x'))).toEqual(['NOT_DECIDED']);
    const reversed = prep({ claims: [claim()], decisions: [decision({ voided: true })] });
    expect(codes(checkReversal(reversed, admin, 'claim-1', 'x'))).toEqual(['ALREADY_VOID']);
  });
});

describe('rate cards', () => {
  const menu = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' };
  const p = prep({ today: '2026-10-20' });
  it('accepts a card for a future month with a full menu', () => {
    expect(checkRateCard(p, '2026-11-01', menu)).toEqual([]);
  });
  it('needs a meal on every working day', () => {
    expect(codes(checkRateCard(p, '2026-11-01', { 1: 'Veg' }))).toContain(
      'NO_MENU_FOR_WORKING_DAY',
    );
  });
  it('refuses a second card on the same date', () => {
    expect(codes(checkRateCard(p, '2026-04-01', menu))).toContain('DUPLICATE');
  });
  it('lets a card start earlier in the current month, but never in a past month, by default', () => {
    expect(checkRateCard(p, '2026-10-15', menu)).toEqual([]); // the spec: past MONTHS must not change
    expect(codes(checkRateCard(p, '2026-09-30', menu))).toEqual(['BACKDATED_RATE_CARD']);
    expect(checkRateCard(p, '2026-10-21', menu)).toEqual([]);
  });
  it('can forbid any back-dating at all', () => {
    const strict = prep({
      today: '2026-10-20',
      policies: [policyWith({ rateCards: { backdating: 'none' } })],
    });
    expect(codes(checkRateCard(strict, '2026-10-19', menu))).toEqual(['BACKDATED_RATE_CARD']);
    expect(checkRateCard(strict, '2026-10-20', menu)).toEqual([]);
  });
  it('refuses to reprice a closed month even when the month is the current one', () => {
    expect(
      codes(checkRateCard(prep({ today: '2026-10-20', closes: [close()] }), '2026-10-25', menu)),
    ).toEqual(['BACKDATED_RATE_CARD']);
  });
  it('lets an unrestricted workspace back-date', () => {
    const open = prep({
      today: '2026-10-20',
      policies: [policyWith({ rateCards: { backdating: 'unrestricted' } })],
    });
    expect(checkRateCard(open, '2026-06-01', menu)).toEqual([]);
  });
  it('rejects a date that is not a date', () => {
    expect(codes(checkRateCard(p, 'next month', menu))).toEqual(['NOT_A_DATE']);
  });
});
