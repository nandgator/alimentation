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
import { isPaise } from './money.ts';
import { autoCloseDate, policyForMonth, rateCardStartAllowed } from './policy.ts';
import { LOG_CHANGES, PAY_METHODS, type LogChange, type LogEntry, type PayMethod, type Role } from './types.ts';

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

export const hasErrors = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === 'error');

/** Whether a consumer's month is closed, by a stored close or by an automatic rule that has run out. */
export function isMonthClosed(p: Prepared, consumerId: string, month: Month): boolean {
  const policy = policyForMonth(p.data.policies, month);
  if (policy.monthClose.mode === 'off') return false;
  if (p.closeByKey.has(`${consumerId}|${month}`)) return true;
  const until = autoCloseDate(policy, month);
  return until !== null && p.data.today > until;
}

/** Whether any consumer's `month` is closed. A Supplier Off day touches all of them. */
function anyClosed(p: Prepared, month: Month): boolean {
  return p.data.people.some((x) => x.role === 'consumer' && isMonthClosed(p, x.id, month));
}

function closedIssue(p: Prepared, actor: Actor, month: Month, closed: boolean): Issue | null {
  if (!closed) return null;
  const policy = policyForMonth(p.data.policies, month);
  if (actor.role !== 'admin') return err('MONTH_CLOSED', 'That month is closed. Ask the admin to change it.');
  const mode = policy.monthClose.mode;
  if (mode !== 'off' && policy.monthClose.afterClose === 'block') {
    return err('MONTH_CLOSED', 'That month is closed and this workspace does not allow changes after close. Reopen it first.');
  }
  return warn('CHANGES_AFTER_CLOSE', 'That month is closed. The bill stays as closed and the change will be flagged.');
}

/** Everything wrong, or worth knowing, about a new log entry. */
export function checkLogEntry(p: Prepared, actor: Actor, e: NewLogEntry, now: LocalNow): Issue[] {
  const out: Issue[] = [];

  if (!(LOG_CHANGES as readonly string[]).includes(e.change)) {
    return [err('UNKNOWN_CHANGE', 'Choose one of the listed changes.')];
  }
  if (!isValidDate(e.date)) return [err('NOT_A_DATE', 'A date is required.')];

  // Shape: Supplier Off is for everyone and for no one in particular; everything else is for one person.
  if (e.change === 'Supplier Off') {
    if (!e.allConsumers || e.personId !== null) {
      out.push(err('SHAPE', 'Supplier Off applies to all consumers.'));
    }
  } else if (e.allConsumers) {
    out.push(err('SHAPE', '"All consumers" can only be used with Supplier Off.'));
  } else if (e.personId === null) {
    out.push(err('SHAPE', 'Choose who this is for.'));
  }

  const isExtra = e.change === 'Extra Chapati' || e.change === 'Extra Bhakri';
  if (isExtra) {
    if (e.qty === null) out.push(err('QTY_REQUIRED', 'Enter how many.'));
    else if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > 20) out.push(err('QTY_RANGE', 'How many must be between 1 and 20.'));
  } else if (e.qty !== null) {
    out.push(err('QTY_NOT_ALLOWED', 'A quantity only applies to extra chapati or bhakri.'));
  }

  // Who may log what.
  if (actor.role === 'consumer') {
    if (e.change === 'Supplier Off') out.push(err('ROLE_CANNOT', 'Only the supplier can mark the kitchen off.'));
    else if (e.personId !== actor.personId) out.push(err('FOR_SELF_ONLY', 'You can only log for yourself.'));
  } else if (actor.role === 'supplier') {
    if (e.change !== 'Supplier Off') out.push(err('ROLE_CANNOT', 'The supplier can only mark the kitchen off.'));
  }

  const policy = policyForMonth(p.data.policies, monthOf(e.date));
  if (!policy.workingDays.includes(weekdayOf(e.date))) {
    out.push(err('NOT_WORKING_DAY', 'That is not a working day.'));
  }

  let person = null;
  if (e.personId !== null) {
    person = p.data.people.find((x) => x.id === e.personId) ?? null;
    if (!person) out.push(err('UNKNOWN_PERSON', 'No such person.'));
    else if (person.role !== 'consumer') out.push(err('NOT_A_CONSUMER', 'Only consumers are billed.'));
    else if (!isActiveOn(person, e.date)) out.push(err('INACTIVE_ON_DATE', 'That person is not billed on that date.'));
  }

  // Duplicates.
  const clash = p.data.log.find(
    (x: LogEntry) =>
      x.date === e.date &&
      x.change === e.change &&
      (e.change === 'Leave' || e.change === 'Supplier Off' || e.change === 'Switch to Veg' || e.change === 'Switch to Non Veg') &&
      (e.change === 'Supplier Off' ? x.allConsumers : x.personId === e.personId),
  );
  if (clash) out.push(err('DUPLICATE', 'That is already logged for this day.'));

  // Holiday: harmless, so only a note.
  const month = monthOf(e.date);
  const holiday = (p.holidaysByDate.get(e.date) ?? []).some((h) => policy.holidays.count === 'all' || h.confirmed);
  if (holiday) out.push(warn('HOLIDAY', 'That day is a holiday, so no meal is billed anyway.'));

  // Month closed.
  const closed = e.change === 'Supplier Off' ? anyClosed(p, month) : e.personId !== null && isMonthClosed(p, e.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  // Cut-off applies to a consumer's own exceptions, never to the supplier or admin.
  if (actor.role === 'consumer' && policy.exceptionCutoff && e.change !== 'Supplier Off') {
    const deadline = wallClock(addDays(e.date, -policy.exceptionCutoff.daysBefore), policy.exceptionCutoff.time);
    if (wallClock(now.date, now.time) >= deadline) {
      out.push(
        err(
          'CUTOFF_PASSED',
          `Exceptions for ${e.date} had to be logged by ${policy.exceptionCutoff.time} ${
            policy.exceptionCutoff.daysBefore === 0 ? 'that day' : `${policy.exceptionCutoff.daysBefore} day(s) before`
          }.`,
        ),
      );
    }
  }
  return out;
}

/** Deleting or changing an entry already logged. */
export function checkLogChange(p: Prepared, actor: Actor, existing: LogEntry, now: LocalNow): Issue[] {
  const out: Issue[] = [];
  if (actor.role !== 'admin' && existing.loggedBy !== actor.personId) {
    return [err('ONLY_AUTHOR', 'Only the person who logged this can change it.')];
  }
  const month = monthOf(existing.date);
  const closed =
    existing.change === 'Supplier Off' ? anyClosed(p, month) : existing.personId !== null && isMonthClosed(p, existing.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  const policy = policyForMonth(p.data.policies, month);
  if (actor.role === 'consumer' && policy.exceptionCutoff && existing.change !== 'Supplier Off') {
    const deadline = wallClock(addDays(existing.date, -policy.exceptionCutoff.daysBefore), policy.exceptionCutoff.time);
    if (wallClock(now.date, now.time) >= deadline) out.push(err('CUTOFF_PASSED', 'The cut-off for that day has passed.'));
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
  if (actor.role === 'supplier') return [err('ROLE_CANNOT', 'The supplier decides on claims; they do not file them.')];
  if (actor.role === 'consumer' && policy.payments === 'direct') {
    out.push(err('CLAIMS_DISABLED', 'This workspace records payments directly. Ask the supplier.'));
  }
  if (actor.role === 'consumer' && c.consumerId !== actor.personId) out.push(err('FOR_SELF_ONLY', 'You can only claim for yourself.'));

  const person = p.data.people.find((x) => x.id === c.consumerId);
  if (!person) out.push(err('UNKNOWN_PERSON', 'No such person.'));
  else if (person.role !== 'consumer') out.push(err('NOT_A_CONSUMER', 'Only consumers pay.'));

  if (!isPaise(c.amount) || c.amount <= 0) out.push(err('AMOUNT', 'The amount must be more than zero.'));
  if (!(PAY_METHODS as readonly string[]).includes(c.method as PayMethod)) out.push(err('METHOD', 'Choose how you paid.'));
  if (!isValidMonth(c.forMonth)) out.push(err('MONTH_RANGE', 'Choose the month this pays for.'));
  else if (person?.activeFrom && (c.forMonth < monthOf(person.activeFrom) || c.forMonth > monthOf(p.data.today))) {
    out.push(err('MONTH_RANGE', 'That month is outside the months billed to this person.'));
  }
  if (!isValidDate(c.paidAt)) out.push(err('NOT_A_DATE', 'Enter the date you paid.'));
  else if (c.paidAt > p.data.today) out.push(err('PAID_IN_FUTURE', 'The payment date cannot be in the future.'));
  return out;
}

/** The supplier's one decision on a claim. The first decision is final. */
export function checkDecision(p: Prepared, actor: Actor, claimId: string, decision: string, note: string | null): Issue[] {
  if (actor.role !== 'supplier') return [err('ROLE_CANNOT', 'Only the supplier decides on claims.')];
  if (!p.data.claims.some((c) => c.id === claimId)) return [err('NO_SUCH_CLAIM', 'No such claim.')];
  if (p.decisionByClaim.has(claimId)) return [err('ALREADY_DECIDED', 'This claim has already been decided and cannot change.')];
  if (decision !== 'Confirmed' && decision !== 'Disputed') return [err('SHAPE', 'Decide Confirmed or Disputed.')];
  if (decision === 'Disputed' && (note === null || note.trim() === '')) {
    return [err('REASON_REQUIRED', 'Say why you are disputing it.')];
  }
  return [];
}

/** Only the admin can undo a decision, and says why. */
export function checkReversal(p: Prepared, actor: Actor, claimId: string, reason: string | null): Issue[] {
  if (actor.role !== 'admin') return [err('ROLE_CANNOT', 'Only the admin can reverse a decision.')];
  const d = p.decisionByClaim.get(claimId);
  if (!d) return [err('NOT_DECIDED', 'There is no decision to reverse.')];
  if (d.voided) return [err('ALREADY_VOID', 'That decision was already reversed.')];
  if (reason === null || reason.trim() === '') return [err('REASON_REQUIRED', 'Say why you are reversing it.')];
  return [];
}

/** A claim can be withdrawn by its author until someone decides it. */
export function checkClaimWithdrawal(p: Prepared, actor: Actor, claimId: string): Issue[] {
  const c = p.data.claims.find((x) => x.id === claimId);
  if (!c) return [err('NO_SUCH_CLAIM', 'No such claim.')];
  if (actor.role !== 'admin' && c.consumerId !== actor.personId) return [err('ONLY_AUTHOR', 'Only the person who filed this can withdraw it.')];
  if (p.decisionByClaim.has(claimId)) return [err('ALREADY_DECIDED', 'This claim has been decided and cannot change.')];
  return [];
}

/** Whether a new rate card may start on `effectiveFrom`, and that it serves every working day. */
export function checkRateCard(
  p: Prepared,
  effectiveFrom: IsoDate,
  menu: Partial<Record<number, string>>,
): Issue[] {
  const out: Issue[] = [];
  if (!isValidDate(effectiveFrom)) return [err('NOT_A_DATE', 'Enter the date the new rates start.')];
  const policy = policyForMonth(p.data.policies, monthOf(effectiveFrom));
  for (const wd of policy.workingDays) {
    if (!menu[wd]) out.push(err('NO_MENU_FOR_WORKING_DAY', 'Every working day needs a meal on the menu.'));
  }
  if (p.cards.some((c) => c.effectiveFrom === effectiveFrom)) {
    out.push(err('DUPLICATE', 'A rate card already starts on that date.'));
  }
  let lastClosed: Month | null = null;
  for (const c of p.data.closes) if (lastClosed === null || c.forMonth > lastClosed) lastClosed = c.forMonth;
  if (!rateCardStartAllowed(policy, effectiveFrom, p.data.today, lastClosed)) {
    out.push(err('BACKDATED_RATE_CARD', 'New rates cannot start in a month that has already begun or closed.'));
  }
  return out;
}
