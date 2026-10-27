import {
  addDays,
  isValidDate,
  isValidMonth,
  monthOf,
  weekdayOf,
  wallClock,
  type IsoDate,
  type LocalNow,
  type Month,
} from './dates.ts';
import { isActiveOn, type Prepared } from './engine.ts';
import { MSG } from './messages.ts';
import { isPaise } from './money.ts';
import { autoCloseDate, policyForMonth, rateCardStartAllowed } from './policy.ts';
import {
  LOG_CHANGES,
  PAY_METHODS,
  type LogChange,
  type LogEntry,
  type PayMethod,
  type Role,
} from './types.ts';

/**
 * Rules for what may be written, shared by the server (which enforces them) and
 * the browser (which uses them for the live hint on the log form). A rule that
 * only the browser knew would not be a rule.
 */

export type IssueCode =
  | 'NOT_A_DATE'
  | 'NOT_WORKING_DAY'
  | 'QTY_REQUIRED'
  | 'QTY_RANGE'
  | 'QTY_NOT_ALLOWED'
  | 'UNKNOWN_CHANGE'
  | 'SHAPE'
  | 'FOR_SELF_ONLY'
  | 'ROLE_CANNOT'
  | 'UNKNOWN_PERSON'
  | 'NOT_A_CONSUMER'
  | 'INACTIVE_ON_DATE'
  | 'MONTH_CLOSED'
  | 'CUTOFF_PASSED'
  | 'LATE_ENTRY'
  | 'DUPLICATE'
  | 'HOLIDAY'
  | 'CHANGES_AFTER_CLOSE'
  | 'AMOUNT'
  | 'METHOD'
  | 'MONTH_RANGE'
  | 'PAID_IN_FUTURE'
  | 'CLAIMS_DISABLED'
  | 'NO_SUCH_CLAIM'
  | 'ALREADY_DECIDED'
  | 'REASON_REQUIRED'
  | 'NOT_DECIDED'
  | 'ALREADY_VOID'
  | 'ONLY_AUTHOR'
  | 'BACKDATED_RATE_CARD'
  | 'NO_MENU_FOR_WORKING_DAY';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export interface Actor {
  personId: string;
  role: Role;
}

export interface NewLogEntry {
  date: IsoDate;
  personId: string | null;
  allConsumers: boolean;
  change: LogChange;
  qty: number | null;
}

const err = (code: IssueCode, message: string): Issue => ({ code, severity: 'error', message });
const warn = (code: IssueCode, message: string): Issue => ({ code, severity: 'warning', message });

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === 'error');

/** Whether a consumer's month is closed, by a stored close or by an automatic rule that has run out. */
export function isMonthClosed(p: Prepared, consumerId: string, month: Month): boolean {
  const policy = policyForMonth(p.data.policies, month);
  if (policy.monthClose.mode === 'off') return false;
  if (p.closeByKey.has(`${consumerId}|${month}`)) return true;
  const until = autoCloseDate(policy, month);
  // Stryker disable next-line ConditionalExpression: comparing a date with null is false
  return until !== null && p.data.today > until;
}

/** Whether any consumer's `month` is closed. A Supplier Off day touches all of them. */
function anyClosed(p: Prepared, month: Month): boolean {
  return p.data.people.some((x) => x.role === 'consumer' && isMonthClosed(p, x.id, month));
}

/** A Supplier Off day touches every consumer; anything else touches one. */
function entryMonthClosed(
  p: Prepared,
  change: string,
  personId: string | null,
  month: Month,
): boolean {
  if (change === 'Supplier Off') return anyClosed(p, month);
  return personId !== null && isMonthClosed(p, personId, month);
}

function closedIssue(p: Prepared, actor: Actor, month: Month, closed: boolean): Issue | null {
  if (!closed) return null;
  const policy = policyForMonth(p.data.policies, month);
  if (actor.role !== 'admin') return err('MONTH_CLOSED', MSG.monthClosed);
  const mc = policy.monthClose;
  if ('afterClose' in mc && mc.afterClose === 'block') {
    return err('MONTH_CLOSED', MSG.monthClosed2);
  }
  return warn('CHANGES_AFTER_CLOSE', MSG.changesAfterClose);
}

/** Everything wrong, or worth knowing, about a new log entry. */
export function checkLogEntry(p: Prepared, actor: Actor, e: NewLogEntry, now: LocalNow): Issue[] {
  const out: Issue[] = [];

  if (!(LOG_CHANGES as readonly string[]).includes(e.change)) {
    return [err('UNKNOWN_CHANGE', MSG.unknownChange)];
  }
  if (!isValidDate(e.date)) return [err('NOT_A_DATE', MSG.notADate)];

  // Shape: Supplier Off is for everyone and for no one in particular; everything else is for one person.
  if (e.change === 'Supplier Off') {
    if (!e.allConsumers || e.personId !== null) {
      out.push(err('SHAPE', MSG.shape));
    }
  } else if (e.allConsumers) {
    out.push(err('SHAPE', MSG.shape2));
  } else if (e.personId === null) {
    out.push(err('SHAPE', MSG.shape3));
  }

  const isExtra = e.change === 'Extra Chapati' || e.change === 'Extra Bhakri';
  if (isExtra) {
    if (e.qty === null) out.push(err('QTY_REQUIRED', MSG.qtyRequired));
    else if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > 20)
      out.push(err('QTY_RANGE', MSG.qtyRange));
  } else if (e.qty !== null) {
    out.push(err('QTY_NOT_ALLOWED', MSG.qtyNotAllowed));
  }

  // Who may log what.
  if (actor.role === 'consumer') {
    if (e.change === 'Supplier Off') out.push(err('ROLE_CANNOT', MSG.roleCannot));
    else if (e.personId !== actor.personId) out.push(err('FOR_SELF_ONLY', MSG.forSelfOnly));
  } else if (actor.role === 'supplier') {
    if (e.change !== 'Supplier Off') out.push(err('ROLE_CANNOT', MSG.roleCannot2));
  }

  const policy = policyForMonth(p.data.policies, monthOf(e.date));
  if (!policy.workingDays.includes(weekdayOf(e.date))) {
    out.push(err('NOT_WORKING_DAY', MSG.notWorkingDay));
  }

  let person = null;
  if (e.personId !== null) {
    person = p.data.people.find((x) => x.id === e.personId) ?? null;
    if (!person) out.push(err('UNKNOWN_PERSON', MSG.unknownPerson));
    else if (person.role !== 'consumer') out.push(err('NOT_A_CONSUMER', MSG.notAConsumer));
    else if (!isActiveOn(person, e.date)) out.push(err('INACTIVE_ON_DATE', MSG.inactiveOnDate));
  }

  // Duplicates.
  const clash = p.data.log.find(
    (x: LogEntry) =>
      x.date === e.date &&
      x.change === e.change &&
      (e.change === 'Leave' ||
        e.change === 'Supplier Off' ||
        e.change === 'Switch to Veg' ||
        e.change === 'Switch to Non Veg') &&
      x.personId === e.personId, // Supplier Off has no person, so two of them match
  );
  if (clash) out.push(err('DUPLICATE', MSG.duplicate));

  // Holiday: harmless, so only a note.
  const month = monthOf(e.date);
  // Stryker disable next-line ArrayDeclaration: an empty fallback is never read as data
  const holiday = (p.holidaysByDate.get(e.date) ?? []).some(
    (h) => policy.holidays.count === 'all' || h.confirmed,
  );
  if (holiday) out.push(warn('HOLIDAY', MSG.holiday));

  // Month closed.
  const closed = entryMonthClosed(p, e.change, e.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  // Cut-off applies to a consumer's own exceptions, never to the supplier or admin.
  if (actor.role === 'consumer' && policy.exceptionCutoff && e.change !== 'Supplier Off') {
    const deadline = wallClock(
      addDays(e.date, -policy.exceptionCutoff.daysBefore),
      policy.exceptionCutoff.time,
    );
    if (wallClock(now.date, now.time) >= deadline) {
      out.push(
        err(
          'CUTOFF_PASSED',
          MSG.cutoffPassedOn(
            e.date,
            policy.exceptionCutoff.time,
            policy.exceptionCutoff.daysBefore,
          ),
        ),
      );
    }
  }

  // After the fact is allowed, because people forget and people travel, but it is never quiet: the
  // entry carries the day it was really made (stamped by the database), and shows as late to
  // everyone who can see it. A kitchen that wants it refused sets a cut-off instead.
  if (e.date < now.date && !out.some((i) => i.code === 'CUTOFF_PASSED'))
    out.push(warn('LATE_ENTRY', MSG.lateEntry));
  return out;
}

/** Deleting or changing an entry already logged. */
export function checkLogChange(
  p: Prepared,
  actor: Actor,
  existing: LogEntry,
  now: LocalNow,
): Issue[] {
  const out: Issue[] = [];
  if (actor.role !== 'admin' && existing.loggedBy !== actor.personId) {
    return [err('ONLY_AUTHOR', MSG.onlyAuthor)];
  }
  const month = monthOf(existing.date);
  const closed = entryMonthClosed(p, existing.change, existing.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  const policy = policyForMonth(p.data.policies, month);
  if (actor.role === 'consumer' && policy.exceptionCutoff) {
    const deadline = wallClock(
      addDays(existing.date, -policy.exceptionCutoff.daysBefore),
      policy.exceptionCutoff.time,
    );
    if (wallClock(now.date, now.time) >= deadline) out.push(err('CUTOFF_PASSED', MSG.cutoffPassed));
  }
  return out;
}

export interface NewClaim {
  consumerId: string;
  paidAt: IsoDate;
  forMonth: Month;
  amount: number;
  method: string;
}

export function checkClaim(p: Prepared, actor: Actor, c: NewClaim): Issue[] {
  const out: Issue[] = [];
  const policy = policyForMonth(p.data.policies, monthOf(p.data.today));
  if (actor.role === 'supplier') return [err('ROLE_CANNOT', MSG.roleCannot3)];
  if (actor.role === 'consumer' && policy.payments === 'direct') {
    out.push(err('CLAIMS_DISABLED', MSG.claimsDisabled));
  }
  if (actor.role === 'consumer' && c.consumerId !== actor.personId)
    out.push(err('FOR_SELF_ONLY', MSG.forSelfOnly2));

  const person = p.data.people.find((x) => x.id === c.consumerId);
  if (!person) out.push(err('UNKNOWN_PERSON', MSG.unknownPerson));
  else if (person.role !== 'consumer') out.push(err('NOT_A_CONSUMER', MSG.notAConsumer2));

  if (!isPaise(c.amount) || c.amount <= 0) out.push(err('AMOUNT', MSG.amount));
  if (!(PAY_METHODS as readonly string[]).includes(c.method as PayMethod))
    out.push(err('METHOD', MSG.method));
  if (!isValidMonth(c.forMonth)) out.push(err('MONTH_RANGE', MSG.monthRange));
  else if (
    person?.activeFrom &&
    (c.forMonth < monthOf(person.activeFrom) || c.forMonth > monthOf(p.data.today))
  ) {
    out.push(err('MONTH_RANGE', MSG.monthRange2));
  }
  if (!isValidDate(c.paidAt)) out.push(err('NOT_A_DATE', MSG.notADate2));
  else if (c.paidAt > p.data.today) out.push(err('PAID_IN_FUTURE', MSG.paidInFuture));
  return out;
}

/** The supplier's one decision on a claim. The first decision is final. */
export function checkDecision(
  p: Prepared,
  actor: Actor,
  claimId: string,
  decision: string,
  note: string | null,
): Issue[] {
  if (actor.role !== 'supplier') return [err('ROLE_CANNOT', MSG.roleCannot4)];
  if (!p.data.claims.some((c) => c.id === claimId)) return [err('NO_SUCH_CLAIM', MSG.noSuchClaim)];
  if (p.decisionByClaim.has(claimId)) return [err('ALREADY_DECIDED', MSG.alreadyDecided)];
  if (decision !== 'Confirmed' && decision !== 'Disputed') return [err('SHAPE', MSG.shape4)];
  if (decision === 'Disputed' && (note === null || note.trim() === '')) {
    return [err('REASON_REQUIRED', MSG.reasonRequired)];
  }
  return [];
}

/** Only the admin can undo a decision, and says why. */
export function checkReversal(
  p: Prepared,
  actor: Actor,
  claimId: string,
  reason: string | null,
): Issue[] {
  if (actor.role !== 'admin') return [err('ROLE_CANNOT', MSG.roleCannot5)];
  const d = p.decisionByClaim.get(claimId);
  if (!d) return [err('NOT_DECIDED', MSG.notDecided)];
  if (d.voided) return [err('ALREADY_VOID', MSG.alreadyVoid)];
  if (reason === null || reason.trim() === '') return [err('REASON_REQUIRED', MSG.reasonRequired2)];
  return [];
}

/** A claim can be withdrawn by its author until someone decides it. */
export function checkClaimWithdrawal(p: Prepared, actor: Actor, claimId: string): Issue[] {
  const c = p.data.claims.find((x) => x.id === claimId);
  if (!c) return [err('NO_SUCH_CLAIM', MSG.noSuchClaim)];
  if (actor.role !== 'admin' && c.consumerId !== actor.personId)
    return [err('ONLY_AUTHOR', MSG.onlyAuthor2)];
  if (p.decisionByClaim.has(claimId)) return [err('ALREADY_DECIDED', MSG.alreadyDecided2)];
  return [];
}

/** Whether a new rate card may start on `effectiveFrom`, and that it serves every working day. */
export function checkRateCard(
  p: Prepared,
  effectiveFrom: IsoDate,
  menu: Partial<Record<number, string>>,
): Issue[] {
  const out: Issue[] = [];
  if (!isValidDate(effectiveFrom)) return [err('NOT_A_DATE', MSG.notADate3)];
  const policy = policyForMonth(p.data.policies, monthOf(effectiveFrom));
  for (const wd of policy.workingDays) {
    if (!menu[wd]) out.push(err('NO_MENU_FOR_WORKING_DAY', MSG.noMenuForWorkingDay));
  }
  if (p.cards.some((c) => c.effectiveFrom === effectiveFrom)) {
    out.push(err('DUPLICATE', MSG.duplicate2));
  }
  let lastClosed: Month | null = null;
  for (const c of p.data.closes)
    // Stryker disable next-line EqualityOperator: equal months give the same answer
    if (lastClosed === null || c.forMonth > lastClosed) lastClosed = c.forMonth;
  // The first card prices nothing that was priced before, so it may start whenever.
  if (
    p.cards.length > 0 &&
    !rateCardStartAllowed(policy, effectiveFrom, p.data.today, lastClosed)
  ) {
    out.push(err('BACKDATED_RATE_CARD', MSG.backdatedRateCard));
  }
  return out;
}
