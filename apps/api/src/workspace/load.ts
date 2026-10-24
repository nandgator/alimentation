import {
  prepare,
  dueAutoCloses,
  type Claim,
  type Decision,
  type EngineData,
  type Holiday,
  type LogEntry,
  type MealType,
  type MonthClose,
  type Person,
  type PolicyVersion,
  type RateCard,
  type Role,
  type Settlement,
} from '@alimentation/core';
import type { FieldCipher } from '../crypto/fields.ts';
import type { Tx } from '../db/driver.ts';

/**
 * Reads everything the engine needs, under the caller's row-level security, so
 * what comes back is exactly what that person may see. A consumer's load holds
 * their own rows and nobody else's; their statement is computed from those.
 * Notes are not read: the engine does not use them and decrypting thousands of
 * them for a statement would be wasted work.
 */

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const month = (d: string) => d.slice(0, 7);
const WEEKDAY_COLUMNS = [
  'menu_sun',
  'menu_mon',
  'menu_tue',
  'menu_wed',
  'menu_thu',
  'menu_fri',
  'menu_sat',
] as const;

export function rateCardFromRow(r: R): RateCard {
  const menu: RateCard['menu'] = {};
  WEEKDAY_COLUMNS.forEach((c, i) => {
    if (r[c]) menu[i as 0] = r[c] as MealType;
  });
  return {
    id: r.id,
    effectiveFrom: r.effective_from,
    veg: r.veg,
    nonVeg: r.non_veg,
    extraChapati: r.extra_chapati,
    extraBhakri: r.extra_bhakri,
    extrasPerMonth: r.extras_per_month,
    menu,
    note: r.note ?? null,
  };
}

export async function loadEngineData(
  tx: Tx,
  cipher: FieldCipher,
  today: string,
): Promise<EngineData> {
  const [people, policies, cards, holidays, log, claims, decisions, settlements, closes] =
    await Promise.all([
      tx.query<R>('SELECT id, role, name_enc, active_from, active_to FROM person'),
      tx.query<R>('SELECT effective_from, doc FROM policy_version'),
      tx.query<R>('SELECT * FROM rate_card'),
      tx.query<R>('SELECT id, name, on_date, location, confirmed FROM holiday'),
      tx.query<R>(
        'SELECT id, on_date, person_id, all_consumers, change, qty, logged_by, logged_at FROM log_entry',
      ),
      tx.query<R>(
        'SELECT id, consumer_id, paid_at, for_month, amount, method, created_at FROM claim',
      ),
      tx.query<R>(
        `SELECT d.claim_id, d.decision, d.decided_by, d.decided_at, (r.claim_id IS NOT NULL) AS voided
         FROM claim_decision d LEFT JOIN claim_reversal r ON r.claim_id = d.claim_id`,
      ),
      tx.query<R>(
        'SELECT id, on_date, consumer_id, for_month, type, amount, recorded_by, created_at FROM settlement',
      ),
      tx.query<R>(
        'SELECT for_month, consumer_id, meals, billed, closed_on, closed_by FROM month_close',
      ),
    ]);

  const names = await Promise.all(
    people.map((p) => cipher.dec('person', 'name_enc', p.id, p.name_enc)),
  );

  return {
    today,
    policies: policies.map((p): PolicyVersion => ({ effectiveFrom: p.effective_from, doc: p.doc })),
    rateCards: cards.map(rateCardFromRow),
    holidays: holidays.map((h): Holiday => ({
      id: h.id,
      name: h.name,
      date: h.on_date,
      location: h.location ?? null,
      confirmed: h.confirmed,
    })),
    people: people.map((p, i): Person => ({
      id: p.id,
      name: names[i] ?? '',
      role: p.role as Role,
      activeFrom: p.active_from ?? null,
      activeTo: p.active_to ?? null,
    })),
    log: log.map((e): LogEntry => ({
      id: e.id,
      date: e.on_date,
      personId: e.person_id ?? null,
      allConsumers: e.all_consumers,
      change: e.change,
      qty: e.qty ?? null,
      note: null,
      loggedBy: e.logged_by,
      loggedAt: e.logged_at,
    })),
    claims: claims.map((c): Claim => ({
      id: c.id,
      consumerId: c.consumer_id,
      paidAt: c.paid_at,
      forMonth: month(c.for_month),
      amount: c.amount,
      method: c.method,
      refNote: null,
      createdAt: c.created_at,
    })),
    decisions: decisions.map((d): Decision => ({
      claimId: d.claim_id,
      decision: d.decision,
      note: null,
      decidedBy: d.decided_by,
      decidedAt: d.decided_at,
      voided: d.voided,
    })),
    settlements: settlements.map((s): Settlement => ({
      id: s.id,
      date: s.on_date,
      consumerId: s.consumer_id,
      forMonth: month(s.for_month),
      type: s.type,
      amount: s.amount ?? null,
      note: null,
      recordedBy: s.recorded_by,
      createdAt: s.created_at,
    })),
    closes: closes.map((c): MonthClose => ({
      forMonth: month(c.for_month),
      consumerId: c.consumer_id,
      meals: c.meals,
      billed: c.billed,
      closedOn: c.closed_on,
      closedBy: c.closed_by ?? null,
    })),
  };
}

/**
 * Stores the automatic closes that have come due, before anything else happens,
 * and returns the data with them included. Run before every write and every
 * statement read, so a month freezes at the amount it had when it closed and no
 * later edit can get in first.
 */
export async function applyAutoCloses(tx: Tx, data: EngineData): Promise<EngineData> {
  const due = dueAutoCloses(prepare(data));
  if (due.length === 0) return data;
  const added: MonthClose[] = [];
  for (const d of due) {
    await tx.query('SELECT system_close_month($1::date, $2::uuid, $3::int, $4::bigint)', [
      `${d.month}-01`,
      d.consumerId,
      d.meals,
      d.billed,
    ]);
    added.push({
      forMonth: d.month,
      consumerId: d.consumerId,
      meals: d.meals,
      billed: d.billed,
      closedOn: data.today,
      closedBy: null,
    });
  }
  return { ...data, closes: [...data.closes, ...added] };
}
