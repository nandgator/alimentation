import { formatDisplayDate, formatDisplayMonth, lateByDays, monthOf } from './dates.ts';
import { formatMoney } from './money.ts';
import type { Role } from './types.ts';

/**
 * What the audit trail says, in words, for the person reading it. The database writes the trail and
 * decides which rows each person may read; this only turns a row into a sentence from the reader's
 * side ("You claimed ...", "The admin removed your ..."), and never needs a name the reader cannot see.
 */

export interface AuditRow {
  id: number;
  table: string;
  rowId: string;
  action: string;
  actor: string | null;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface HistoryContext {
  /** The person reading. */
  viewerId: string;
  timeZone: string;
  /** A name the reader is allowed to know, if any. A member knows no one's but their own. */
  nameOf(personId: string): string | undefined;
  roleOf(personId: string): Role | undefined;
  /** The claim a decision or reversal was about, while it still exists. */
  claimOf(claimId: string): { consumerId: string; amount: number; forMonth: string } | undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Who did it, as this reader may know them. */
export function whoLabel(actor: string | null, c: HistoryContext): string {
  if (actor === null) return 'The kitchen’s rules';
  if (actor === c.viewerId) return 'You';
  const role = c.roleOf(actor);
  if (role === 'admin') return 'The admin';
  if (role === 'supplier') return 'The supplier';
  return c.nameOf(actor) ?? 'Someone';
}

const whose = (id: string, c: HistoryContext): string =>
  id === c.viewerId ? 'your' : `${c.nameOf(id) ?? 'a member'}’s`;
const forWhom = (id: string, c: HistoryContext): string =>
  id === c.viewerId ? 'you' : (c.nameOf(id) ?? 'a member');
const monthName = (date: string) => formatDisplayMonth(monthOf(date));

/** One audit row as a sentence, or null for a row that is not about anything a person would look for. */
export function describeAudit(row: AuditRow, c: HistoryContext): string | null {
  const now = row.after ?? {};
  const was = row.before ?? {};
  const rec = row.action === 'DELETE' ? was : now;
  const by = whoLabel(row.actor, c);

  switch (row.table) {
    case 'log_entry': {
      const date = formatDisplayDate(str(rec.on_date));
      if (rec.all_consumers === true) {
        return row.action === 'DELETE'
          ? `${by} removed the kitchen-off day on ${date}.`
          : `${by} marked the kitchen off on ${date}.`;
      }
      const target = str(rec.person_id);
      const what = `${str(rec.change)}${rec.qty ? ` ×${num(rec.qty)}` : ''}`;
      if (row.action === 'DELETE')
        return `${by} removed ${whose(target, c)} ${what} entry for ${date}.`;
      if (row.action === 'UPDATE')
        return `${by} changed ${whose(target, c)} ${what} entry for ${date}.`;
      const late = lateByDays(str(rec.on_date), str(rec.logged_at), c.timeZone);
      const forThem = row.actor === target ? '' : ` for ${forWhom(target, c)}`;
      return (
        `${by} logged ${what} on ${date}${forThem}.` +
        (late > 0 ? ` It was added ${plural(late, 'day')} after the day itself.` : '')
      );
    }
    case 'claim': {
      const consumer = str(rec.consumer_id);
      const money = formatMoney(num(rec.amount));
      const month = monthName(str(rec.for_month));
      if (row.action === 'DELETE')
        return `${by} withdrew ${whose(consumer, c)} claim of ${money} for ${month}.`;
      return row.actor === consumer
        ? `${by} claimed ${money} for ${month} (${str(rec.method)}).`
        : `${by} filed a claim of ${money} for ${forWhom(consumer, c)}, for ${month} (${str(rec.method)}).`;
    }
    case 'claim_decision':
    case 'claim_reversal': {
      const claim = c.claimOf(row.rowId);
      const about = claim
        ? `${whose(claim.consumerId, c)} claim of ${formatMoney(claim.amount)} for ${monthName(claim.forMonth)}`
        : 'a claim';
      if (row.table === 'claim_reversal')
        return `${by} reversed the decision on ${about}. It no longer counts.`;
      return `${by} ${str(now.decision) === 'Confirmed' ? 'confirmed' : 'disputed'} ${about}.`;
    }
    case 'settlement': {
      const bill = `${whose(str(now.consumer_id), c)} ${monthName(str(now.for_month))} bill`;
      const type = str(now.type);
      if (type === 'Payment')
        return `${by} recorded a payment of ${formatMoney(num(now.amount))} on ${bill}.`;
      if (type === 'Query Resolved') return `${by} resolved the query on ${bill}.`;
      return `${by} raised a query on ${bill}.`;
    }
    case 'month_close': {
      const bill = `${whose(str(rec.consumer_id), c)} ${monthName(str(rec.for_month))} bill`;
      return row.action === 'DELETE'
        ? `${by} reopened ${bill}.`
        : `${by} closed ${bill} at ${formatMoney(num(rec.billed))}.`;
    }
    case 'person': {
      const subject = row.rowId;
      if (row.action === 'INSERT')
        return `${by} added ${forWhom(subject, c)} to the kitchen${
          rec.active_from ? `, billed from ${formatDisplayDate(str(rec.active_from))}` : ''
        }.`;
      if (row.action !== 'UPDATE') return null;
      const parts: string[] = [];
      if (was.status !== now.status)
        parts.push(
          `${by} ${now.status === 'DISABLED' ? 'disabled' : 'enabled'} ${whose(subject, c)} place in the kitchen.`,
        );
      if (was.active_from !== now.active_from || was.active_to !== now.active_to)
        parts.push(
          `${by} changed ${whose(subject, c)} billing dates: from ${
            now.active_from ? formatDisplayDate(str(now.active_from)) : 'the start'
          } until ${now.active_to ? formatDisplayDate(str(now.active_to)) : 'further notice'}.`,
        );
      if (was.name_enc !== now.name_enc || was.contact_enc !== now.contact_enc)
        parts.push(`${by} changed ${whose(subject, c)} details.`);
      return parts.length ? parts.join(' ') : null;
    }
    case 'rate_card': {
      if (row.action !== 'INSERT') return null;
      return (
        `${by} added prices from ${formatDisplayDate(str(now.effective_from))}: ` +
        `Veg ${formatMoney(num(now.veg))}, Non Veg ${formatMoney(num(now.non_veg))}, ` +
        `extra chapati ${formatMoney(num(now.extra_chapati))}, extra bhakri ${formatMoney(num(now.extra_bhakri))}, ` +
        `${formatMoney(num(now.extras_per_month))} a month for extras.`
      );
    }
    case 'policy_version':
      return row.action === 'INSERT'
        ? `${by} changed the kitchen’s rules, from ${formatDisplayDate(str(now.effective_from))}.`
        : null;
    case 'holiday': {
      const name = `“${str(rec.name)}” on ${formatDisplayDate(str(rec.on_date))}`;
      if (row.action === 'DELETE') return `${by} removed the holiday ${name}.`;
      if (row.action === 'UPDATE') return `${by} changed the holiday ${name}.`;
      return `${by} added the holiday ${name}${now.confirmed === false ? ' (not yet confirmed)' : ''}.`;
    }
    default:
      return null;
  }
}
