import {
  BUNDLE_FORMAT,
  assembleBundle,
  expectedTotals,
  type Bundle,
  type BundleBody,
} from '@alimentation/core';
import type { FieldCipher } from '../crypto/fields.ts';
import type { Tx } from '../db/driver.ts';
import { loadEngineData } from '../workspace/load.ts';

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface BundleMember {
  personId: string;
  role: 'admin' | 'supplier' | 'consumer';
  email: string;
}

const WEEKDAYS = [
  'menu_sun',
  'menu_mon',
  'menu_tue',
  'menu_wed',
  'menu_thu',
  'menu_fri',
  'menu_sat',
] as const;
const byKey = <T>(rows: T[], key: (r: T) => string): T[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** `\x…` text as Postgres prints bytea. */
const fromHexText = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(Buffer.from(s.slice(2), 'hex'));

/**
 * Reads the whole workspace as the database owner, so row-level security does not
 * hide anything, and writes it in the bundle's plain form. Everything personal is
 * decrypted here; the bundle is what a person takes with them.
 */
export async function readBundleBody(
  tx: Tx,
  cipher: FieldCipher,
  ctx: { exportedAt: string; asOf: string; members: BundleMember[] },
): Promise<BundleBody> {
  const [ws] = await tx.query<R>('SELECT name, time_zone, currency FROM workspace');
  if (!ws) throw new Error('this database holds no workspace');
  const [
    policies,
    cards,
    holidays,
    people,
    log,
    claims,
    decisions,
    reversals,
    settlements,
    closes,
    audit,
  ] = await Promise.all([
    tx.query<R>('SELECT effective_from, doc, created_by FROM policy_version'),
    tx.query<R>('SELECT * FROM rate_card'),
    tx.query<R>('SELECT id, name, on_date, location, confirmed, created_by FROM holiday'),
    tx.query<R>(
      'SELECT id, role, name_enc, contact_enc, status, active_from, active_to, created_at FROM person',
    ),
    tx.query<R>(
      'SELECT id, on_date, person_id, all_consumers, change, qty, note_enc, logged_by, logged_at FROM log_entry',
    ),
    tx.query<R>(
      'SELECT id, consumer_id, paid_at, for_month, amount, method, ref_note_enc, created_at FROM claim',
    ),
    tx.query<R>('SELECT claim_id, decision, note_enc, decided_by, decided_at FROM claim_decision'),
    tx.query<R>('SELECT claim_id, reason_enc, reversed_by, reversed_at FROM claim_reversal'),
    tx.query<R>(
      'SELECT id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by, created_at FROM settlement',
    ),
    tx.query<R>(
      'SELECT for_month, consumer_id, meals, billed, closed_on, closed_by FROM month_close',
    ),
    tx.query<R>('SELECT id, table_name, row_id, action, actor, at, before, after FROM audit_log'),
  ]);

  const dec = (t: string, c: string, id: string, b: Uint8Array | null) => cipher.dec(t, c, id, b);
  const month = (d: string) => d.slice(0, 7);

  // The audit trail copies rows, personal columns included, as stored. Open them.
  const openAudit = async (table: string, rowId: string, j: R | null): Promise<R | null> => {
    if (j === null) return null;
    const out: R = {};
    for (const [k, v] of Object.entries(j)) {
      out[k] =
        k.endsWith('_enc') && typeof v === 'string'
          ? { $plain: await dec(table, k, rowId, fromHexText(v)) }
          : v;
    }
    return out;
  };

  const peopleOut = await Promise.all(
    people.map(async (p) => ({
      id: p.id as string,
      role: p.role,
      name: (await dec('person', 'name_enc', p.id, p.name_enc))!,
      contact: await dec('person', 'contact_enc', p.id, p.contact_enc),
      status: p.status,
      activeFrom: p.active_from ?? null,
      activeTo: p.active_to ?? null,
      createdAt: p.created_at as string,
    })),
  );

  const data = await loadEngineData(tx, cipher, ctx.asOf);

  const body: BundleBody = {
    format: BUNDLE_FORMAT,
    exportedAt: ctx.exportedAt,
    asOf: ctx.asOf,
    workspace: { name: ws.name, timeZone: ws.time_zone, currency: ws.currency.trim() },
    policies: byKey(
      policies.map((p) => ({
        effectiveFrom: p.effective_from as string,
        doc: p.doc,
        createdBy: p.created_by ?? null,
      })),
      (p) => p.effectiveFrom,
    ),
    rateCards: byKey(
      cards.map((c) => ({
        id: c.id as string,
        effectiveFrom: c.effective_from as string,
        veg: c.veg,
        nonVeg: c.non_veg,
        extraChapati: c.extra_chapati,
        extraBhakri: c.extra_bhakri,
        extrasPerMonth: c.extras_per_month,
        menu: Object.fromEntries(
          WEEKDAYS.flatMap((col, i) => (c[col] ? [[String(i), c[col] as 'Veg' | 'Non Veg']] : [])),
        ),
        note: c.note ?? null,
        createdBy: c.created_by ?? null,
      })),
      (c) => c.effectiveFrom,
    ),
    holidays: byKey(
      holidays.map((h) => ({
        id: h.id as string,
        name: h.name,
        date: h.on_date as string,
        location: h.location ?? null,
        confirmed: h.confirmed,
        createdBy: h.created_by ?? null,
      })),
      (h) => h.date + h.id,
    ),
    people: byKey(peopleOut, (p) => p.id),
    log: byKey(
      await Promise.all(
        log.map(async (e) => ({
          id: e.id as string,
          date: e.on_date as string,
          personId: e.person_id ?? null,
          allConsumers: e.all_consumers,
          change: e.change,
          qty: e.qty ?? null,
          note: await dec('log_entry', 'note_enc', e.id, e.note_enc),
          loggedBy: e.logged_by,
          loggedAt: e.logged_at as string,
        })),
      ),
      (e) => e.date + e.loggedAt + e.id,
    ),
    claims: byKey(
      await Promise.all(
        claims.map(async (c) => ({
          id: c.id as string,
          consumerId: c.consumer_id,
          paidAt: c.paid_at as string,
          forMonth: month(c.for_month),
          amount: c.amount,
          method: c.method,
          refNote: await dec('claim', 'ref_note_enc', c.id, c.ref_note_enc),
          createdAt: c.created_at as string,
        })),
      ),
      (c) => c.createdAt + c.id,
    ),
    decisions: byKey(
      await Promise.all(
        decisions.map(async (d) => ({
          claimId: d.claim_id as string,
          decision: d.decision,
          note: await dec('claim_decision', 'note_enc', d.claim_id, d.note_enc),
          decidedBy: d.decided_by,
          decidedAt: d.decided_at as string,
        })),
      ),
      (d) => d.claimId,
    ),
    reversals: byKey(
      await Promise.all(
        reversals.map(async (r) => ({
          claimId: r.claim_id as string,
          reason: (await dec('claim_reversal', 'reason_enc', r.claim_id, r.reason_enc))!,
          reversedBy: r.reversed_by,
          reversedAt: r.reversed_at as string,
        })),
      ),
      (r) => r.claimId,
    ),
    settlements: byKey(
      await Promise.all(
        settlements.map(async (s) => ({
          id: s.id as string,
          date: s.on_date as string,
          consumerId: s.consumer_id,
          forMonth: month(s.for_month),
          type: s.type,
          amount: s.amount ?? null,
          note: await dec('settlement', 'note_enc', s.id, s.note_enc),
          recordedBy: s.recorded_by,
          createdAt: s.created_at as string,
        })),
      ),
      (s) => s.date + s.createdAt + s.id,
    ),
    closes: byKey(
      closes.map((c) => ({
        forMonth: month(c.for_month),
        consumerId: c.consumer_id,
        meals: c.meals,
        billed: c.billed,
        closedOn: c.closed_on as string,
        closedBy: c.closed_by ?? null,
      })),
      (c) => c.forMonth + c.consumerId,
    ),
    audit: await Promise.all(
      byKey(audit, (a) => String(a.id).padStart(12, '0')).map(async (a) => ({
        id: Number(a.id),
        table: a.table_name as string,
        rowId: a.row_id as string,
        action: a.action as string,
        actor: a.actor ?? null,
        at: a.at as string,
        before: await openAudit(a.table_name, a.row_id, a.before),
        after: await openAudit(a.table_name, a.row_id, a.after),
      })),
    ),
    members: byKey(ctx.members, (m) => m.personId + m.role),
    expected: expectedTotals(data),
  };
  return body;
}

/** A consistent snapshot of the workspace, sealed with its counts and digest. */
export async function exportWorkspace(
  owner: { tx: <T>(fn: (tx: Tx) => Promise<T>, opts?: { snapshot?: boolean }) => Promise<T> },
  cipher: FieldCipher,
  ctx: { exportedAt: Date; members: BundleMember[]; today: string },
): Promise<Bundle> {
  const body = await owner.tx(
    (tx) =>
      readBundleBody(tx, cipher, {
        exportedAt: ctx.exportedAt.toISOString(),
        asOf: ctx.today,
        members: ctx.members,
      }),
    { snapshot: true },
  );
  return assembleBundle(body);
}
