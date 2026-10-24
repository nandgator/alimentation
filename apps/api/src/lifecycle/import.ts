import {
  canonicalJson,
  compareTotals,
  digestOf,
  parseBundle,
  unsupportedRules,
  type Bundle,
  type TotalMismatch,
} from '@alimentation/core';
import type { FieldCipher } from '../crypto/fields.ts';
import type { Db, Tx } from '../db/driver.ts';
import { readBundleBody } from './bundleio.ts';

export interface ImportReport {
  ok: boolean;
  dryRun: boolean;
  digest: string | null;
  counts: Record<string, number>;
  problems: string[];
  mismatches: TotalMismatch[];
}

class Rollback extends Error {}

const AUDITED = [
  'workspace',
  'person',
  'policy_version',
  'rate_card',
  'holiday',
  'log_entry',
  'claim',
  'claim_decision',
  'claim_reversal',
  'settlement',
  'month_close',
] as const;
const WEEKDAYS = [
  'menu_sun',
  'menu_mon',
  'menu_tue',
  'menu_wed',
  'menu_thu',
  'menu_fri',
  'menu_sat',
] as const;

/** Multi-row INSERT in chunks. Names are constants in this file; values are always parameters. */
async function insertMany(
  tx: Tx,
  table: string,
  columns: string[],
  rows: unknown[][],
  overriding = false,
): Promise<void> {
  if (rows.length === 0) return;
  const names = columns.map((c) => c.split('::')[0]);
  const casts = columns.map((c) => (c.includes('::') ? `::${c.split('::')[1]}` : ''));
  const per = Math.max(1, Math.min(200, Math.floor(30000 / columns.length)));
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const values: unknown[] = [];
    const tuples = chunk.map(
      (row) =>
        `(${row
          .map((v, c) => {
            values.push(v);
            return `$${values.length}${casts[c]}`;
          })
          .join(', ')})`,
    );
    await tx.query(
      `INSERT INTO ${table} (${names.join(', ')}) ${overriding ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES ${tuples.join(', ')}`,
      values,
    );
  }
}

const sectionKeys = [
  'workspace',
  'policies',
  'rateCards',
  'holidays',
  'people',
  'log',
  'claims',
  'decisions',
  'reversals',
  'settlements',
  'closes',
  'audit',
  'expected',
] as const;

/**
 * Loads a bundle into an empty, migrated workspace database, as its owner, in one
 * transaction. Nothing is kept unless the copy proves itself:
 *
 *   - the bundle's own checksum and counts hold, and every rule in it is understood
 *   - the target was empty
 *   - the copy, read back and sealed again, has the very same digest as the original
 *   - every consumer's statement for every month comes out to the paisa as it did
 *
 * A dry run does everything and then rolls back.
 */
export async function importBundle(
  owner: Db,
  cipher: FieldCipher,
  raw: unknown,
  opts: { dryRun: boolean },
): Promise<ImportReport> {
  const report: ImportReport = {
    ok: false,
    dryRun: opts.dryRun,
    digest: null,
    counts: {},
    problems: [],
    mismatches: [],
  };

  const parsed = await parseBundle(raw);
  if (!parsed.ok) {
    report.problems = parsed.problems;
    return report;
  }
  const bundle: Bundle = parsed.bundle;
  report.digest = bundle.manifest.digest;
  report.counts = bundle.manifest.counts;
  const unsupported = unsupportedRules(bundle);
  if (unsupported.length) {
    report.problems = unsupported;
    return report;
  }

  try {
    await owner.tx(async (tx) => {
      const found = await tx.query<{ n: number }>(
        'SELECT (SELECT count(*) FROM workspace) + (SELECT count(*) FROM person) + (SELECT count(*) FROM log_entry) AS n',
      );
      if (Number(found[0]!.n) !== 0) {
        report.problems.push(
          'The target database already holds a workspace. Import needs an empty one.',
        );
        throw new Rollback();
      }

      // The audit trail is imported as it was, not made again; and rows that were valid when
      // written are taken as they stand, whatever the rules say about writing them today.
      for (const t of AUDITED) await tx.query(`ALTER TABLE ${t} DISABLE TRIGGER ${t}_audit`);
      await tx.query('ALTER TABLE log_entry DISABLE TRIGGER log_entry_stamp');

      const enc = (t: string, c: string, id: string, v: string | null) => cipher.enc(t, c, id, v);
      const w = bundle.workspace;
      await tx.query('INSERT INTO workspace (name, time_zone, currency) VALUES ($1, $2, $3)', [
        w.name,
        w.timeZone,
        w.currency,
      ]);
      await insertMany(
        tx,
        'policy_version',
        ['effective_from', 'doc::jsonb', 'created_by'],
        bundle.policies.map((p) => [p.effectiveFrom, JSON.stringify(p.doc), p.createdBy]),
      );
      await insertMany(
        tx,
        'person',
        [
          'id',
          'role',
          'name_enc',
          'contact_enc',
          'status',
          'active_from',
          'active_to',
          'created_at',
        ],
        await Promise.all(
          bundle.people.map(async (p) => [
            p.id,
            p.role,
            await enc('person', 'name_enc', p.id, p.name),
            await enc('person', 'contact_enc', p.id, p.contact),
            p.status,
            p.activeFrom,
            p.activeTo,
            p.createdAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'rate_card',
        [
          'id',
          'effective_from',
          'veg',
          'non_veg',
          'extra_chapati',
          'extra_bhakri',
          'extras_per_month',
          ...WEEKDAYS,
          'note',
          'created_by',
        ],
        bundle.rateCards.map((r) => [
          r.id,
          r.effectiveFrom,
          r.veg,
          r.nonVeg,
          r.extraChapati,
          r.extraBhakri,
          r.extrasPerMonth,
          ...WEEKDAYS.map((_, i) => r.menu[String(i)] ?? null),
          r.note,
          r.createdBy,
        ]),
      );
      await insertMany(
        tx,
        'holiday',
        ['id', 'name', 'on_date', 'location', 'confirmed', 'created_by'],
        bundle.holidays.map((h) => [h.id, h.name, h.date, h.location, h.confirmed, h.createdBy]),
      );
      await insertMany(
        tx,
        'log_entry',
        [
          'id',
          'on_date',
          'person_id',
          'all_consumers',
          'change',
          'qty',
          'note_enc',
          'logged_by',
          'logged_at',
        ],
        await Promise.all(
          bundle.log.map(async (e) => [
            e.id,
            e.date,
            e.personId,
            e.allConsumers,
            e.change,
            e.qty,
            await enc('log_entry', 'note_enc', e.id, e.note),
            e.loggedBy,
            e.loggedAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'claim',
        [
          'id',
          'consumer_id',
          'paid_at',
          'for_month',
          'amount',
          'method',
          'ref_note_enc',
          'created_at',
        ],
        await Promise.all(
          bundle.claims.map(async (c) => [
            c.id,
            c.consumerId,
            c.paidAt,
            `${c.forMonth}-01`,
            c.amount,
            c.method,
            await enc('claim', 'ref_note_enc', c.id, c.refNote),
            c.createdAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'claim_decision',
        ['claim_id', 'decision', 'note_enc', 'decided_by', 'decided_at'],
        await Promise.all(
          bundle.decisions.map(async (d) => [
            d.claimId,
            d.decision,
            await enc('claim_decision', 'note_enc', d.claimId, d.note),
            d.decidedBy,
            d.decidedAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'claim_reversal',
        ['claim_id', 'reason_enc', 'reversed_by', 'reversed_at'],
        await Promise.all(
          bundle.reversals.map(async (r) => [
            r.claimId,
            await enc('claim_reversal', 'reason_enc', r.claimId, r.reason),
            r.reversedBy,
            r.reversedAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'settlement',
        [
          'id',
          'on_date',
          'consumer_id',
          'for_month',
          'type',
          'amount',
          'note_enc',
          'recorded_by',
          'created_at',
        ],
        await Promise.all(
          bundle.settlements.map(async (s) => [
            s.id,
            s.date,
            s.consumerId,
            `${s.forMonth}-01`,
            s.type,
            s.amount,
            await enc('settlement', 'note_enc', s.id, s.note),
            s.recordedBy,
            s.createdAt,
          ]),
        ),
      );
      await insertMany(
        tx,
        'month_close',
        ['for_month', 'consumer_id', 'meals', 'billed', 'closed_on', 'closed_by'],
        bundle.closes.map((c) => [
          `${c.forMonth}-01`,
          c.consumerId,
          c.meals,
          c.billed,
          c.closedOn,
          c.closedBy,
        ]),
      );

      const seal = async (table: string, rowId: string, j: Record<string, unknown> | null) => {
        if (j === null) return null;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(j)) {
          const plain =
            v && typeof v === 'object' && '$plain' in v
              ? (v as { $plain: string | null }).$plain
              : undefined;
          out[k] =
            plain === undefined
              ? v
              : plain === null
                ? null
                : `\\x${(await enc(table, k, rowId, plain))!.toString('hex')}`;
        }
        return JSON.stringify(out);
      };
      await insertMany(
        tx,
        'audit_log',
        ['id', 'table_name', 'row_id', 'action', 'actor', 'at', 'before::jsonb', 'after::jsonb'],
        await Promise.all(
          bundle.audit.map(async (a) => [
            a.id,
            a.table,
            a.rowId,
            a.action,
            a.actor,
            a.at,
            await seal(a.table, a.rowId, a.before),
            await seal(a.table, a.rowId, a.after),
          ]),
        ),
        true,
      );
      await tx.query(
        `SELECT setval(pg_get_serial_sequence('audit_log', 'id'), greatest(1, coalesce((SELECT max(id) FROM audit_log), 1)), (SELECT count(*) > 0 FROM audit_log))`,
      );

      await tx.query('ALTER TABLE log_entry ENABLE TRIGGER log_entry_stamp');
      for (const t of AUDITED) await tx.query(`ALTER TABLE ${t} ENABLE TRIGGER ${t}_audit`);

      // Prove it. Read the copy back into a bundle and compare it to the original, whole.
      const again = await readBundleBody(tx, cipher, {
        exportedAt: bundle.exportedAt,
        asOf: bundle.asOf,
        members: bundle.members,
      });
      report.mismatches = compareTotals(bundle.expected, again.expected);
      if (report.mismatches.length)
        report.problems.push(
          `${report.mismatches.length} statement figure(s) differ from the original.`,
        );
      const sameParts = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
      const { manifest, ...original } = bundle;
      void manifest;
      for (const k of sectionKeys) {
        if (
          !sameParts(
            (original as Record<string, unknown>)[k],
            (again as Record<string, unknown>)[k],
          )
        )
          report.problems.push(`${k} was not copied exactly.`);
      }
      if ((await digestOf(again)) !== bundle.manifest.digest && report.problems.length === 0)
        report.problems.push('The copy does not have the same checksum as the original.');
      if (report.problems.length) throw new Rollback();
      report.ok = true;
      if (opts.dryRun) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  if (opts.dryRun && report.problems.length === 0) report.ok = true;
  return report;
}
