import {
  type ArchiveBlocker,
  addMonths,
  archiveBlockers,
  assembleBundle,
  BUNDLE_FORMAT,
  type Bundle,
  type BundleBody,
  expectedTotals,
  firstMonthWithData,
  isArchivedMonth,
  liveFloor,
  type Month,
  must,
  prepare,
  sliceBody,
} from "@alimentation/core";
import type { FieldCipher } from "../crypto/fields.ts";
import type { Tx } from "../db/driver.ts";
import { loadEngineData, menuFromRows, rateCardFromRows } from "../workspace/load.ts";
import { MAX_SPAN_ROWS, spanCounts, sumCounts } from "./span.ts";

// biome-ignore lint/suspicious/noExplicitAny: rows come back from the driver as untyped JSON
type R = Record<string, any>;

export interface BundleMember {
  personId: string;
  role: "admin" | "supplier" | "consumer";
  email: string;
}

const byKey = <T>(rows: T[], key: (r: T) => string): T[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** `\x…` text as Postgres prints bytea. */
const fromHexText = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(Buffer.from(s.slice(2), "hex"));

/**
 * Reads the whole workspace as the database owner, so row-level security does not
 * hide anything, and writes it in the bundle's plain form. Everything personal is
 * decrypted here; the bundle is what a person takes with them.
 */
export async function readBundleBody(
  tx: Tx,
  cipher: FieldCipher,
  ctx: {
    exportedAt: string;
    asOf: string;
    members: BundleMember[];
    /** Read only the months up to this one, as a bundle that stands on its own (see `sliceBody`). */
    slice?: { through: Month };
  },
): Promise<BundleBody> {
  const [ws] = await tx.query<R>("SELECT name, time_zone, currency, money_enabled FROM workspace");
  if (!ws) throw new Error("this database holds no workspace");
  const money = ws.money_enabled !== false;
  const none = Promise.resolve<R[]>([]);
  const [
    policies,
    catalogue,
    services,
    enrolments,
    menus,
    offers,
    days,
    cards,
    prices,
    holidays,
    people,
    log,
    claims,
    decisions,
    reversals,
    settlements,
    closes,
    audit,
    openings,
    cuts,
  ] = await Promise.all([
    tx.query<R>("SELECT effective_from, doc, created_by FROM policy_version"),
    tx.query<R>(
      "SELECT id, kind, name, unit, max_qty, archived_on, created_by FROM catalogue_item",
    ),
    tx.query<R>("SELECT id, name, position, archived_on, created_by FROM service"),
    tx.query<R>("SELECT id, person_id, service_id, active_from, active_to FROM person_service"),
    tx.query<R>("SELECT id, effective_from, note, created_by FROM menu"),
    tx.query<R>("SELECT menu_id, service_id, item_id FROM menu_offer"),
    tx.query<R>("SELECT menu_id, service_id, weekday, meal_id FROM menu_day"),
    money
      ? tx.query<R>("SELECT id, effective_from, monthly_fee, note, created_by FROM rate_card")
      : none,
    money ? tx.query<R>("SELECT card_id, item_id, service_id, amount FROM rate_price") : none,
    tx.query<R>("SELECT id, name, on_date, location, confirmed, created_by FROM holiday"),
    tx.query<R>(
      "SELECT id, role, name_enc, contact_enc, external_key, status, active_from, active_to, created_at FROM person",
    ),
    tx.query<R>(
      "SELECT id, on_date, person_id, all_consumers, action, service_id, item_id, qty, note_enc, logged_by, logged_at FROM log_entry",
    ),
    money
      ? tx.query<R>(
          "SELECT id, consumer_id, paid_at, for_month, amount, method, ref_note_enc, created_at FROM claim",
        )
      : none,
    money
      ? tx.query<R>(
          "SELECT claim_id, decision, note_enc, decided_by, decided_at FROM claim_decision",
        )
      : none,
    money
      ? tx.query<R>("SELECT claim_id, reason_enc, reversed_by, reversed_at FROM claim_reversal")
      : none,
    money
      ? tx.query<R>(
          "SELECT id, on_date, consumer_id, for_month, type, amount, note_enc, recorded_by, created_at FROM settlement",
        )
      : none,
    tx.query<R>(
      "SELECT for_month, consumer_id, meals, billed, closed_on, closed_by FROM month_close",
    ),
    tx.query<R>(
      "SELECT id, table_name, row_id, action, actor, at, via, before, after FROM audit_log",
    ),
    money
      ? tx.query<R>(
          "SELECT person_id, as_of_month, balance, billed_total, paid_total FROM opening_balance",
        )
      : none,
    tx.query<R>(
      "SELECT through_month, prior_digest, bundle_digest, slice_hash, counts, cut_by, cut_at FROM archive_cut",
    ),
  ]);

  const dec = (t: string, c: string, id: string, b: Uint8Array | null) => cipher.dec(t, c, id, b);
  const month = (d: string) => d.slice(0, 7);

  // The audit trail copies rows, personal columns included, as stored. Open them.
  const openAudit = async (table: string, rowId: string, j: R | null): Promise<R | null> => {
    if (j === null) return null;
    const out: R = {};
    for (const [k, v] of Object.entries(j)) {
      out[k] =
        k.endsWith("_enc") && typeof v === "string"
          ? { $plain: await dec(table, k, rowId, fromHexText(v)) }
          : v;
    }
    return out;
  };

  const peopleOut = await Promise.all(
    people.map(async (p) => ({
      id: p.id as string,
      role: p.role,
      name: must(await dec("person", "name_enc", p.id, p.name_enc)),
      contact: await dec("person", "contact_enc", p.id, p.contact_enc),
      externalKey: (p.external_key as string | null) ?? null,
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
    workspace: {
      name: ws.name,
      timeZone: ws.time_zone,
      currency: ws.currency.trim(),
      moneyEnabled: money,
    },
    policies: byKey(
      policies.map((p) => ({
        effectiveFrom: p.effective_from as string,
        doc: p.doc,
        createdBy: p.created_by ?? null,
      })),
      (p) => p.effectiveFrom,
    ),
    catalogue: byKey(
      catalogue.map((i) => ({
        id: i.id as string,
        kind: i.kind as "meal" | "addon",
        name: i.name as string,
        unit: i.unit as string,
        maxQty: i.max_qty as number,
        archivedOn: (i.archived_on as string | null) ?? null,
        createdBy: (i.created_by as string | null) ?? null,
      })),
      (i) => i.id,
    ),
    services: byKey(
      services.map((x) => ({
        id: x.id as string,
        name: x.name as string,
        position: x.position as number,
        archivedOn: (x.archived_on as string | null) ?? null,
        createdBy: (x.created_by as string | null) ?? null,
      })),
      (x) => x.id,
    ),
    enrolments: byKey(
      enrolments.map((e) => ({
        id: e.id as string,
        personId: e.person_id as string,
        serviceId: e.service_id as string,
        activeFrom: e.active_from as string,
        activeTo: (e.active_to as string | null) ?? null,
      })),
      (e) => e.id,
    ),
    menus: byKey(
      menus.map((m) => {
        const { id, effectiveFrom, days: served, offered, note } = menuFromRows(m, offers, days);
        return {
          id,
          effectiveFrom,
          days: Object.fromEntries(
            Object.entries(served).map(([sv, week]) => [sv, { ...week } as Record<string, string>]),
          ),
          offered: Object.fromEntries(Object.entries(offered).map(([sv, ids]) => [sv, [...ids]])),
          note,
          createdBy: (m.created_by as string | null) ?? null,
        };
      }),
      (m) => m.effectiveFrom,
    ),
    rateCards: byKey(
      cards.map((c) => {
        const { id, effectiveFrom, prices: lines, monthlyFee, note } = rateCardFromRows(c, prices);
        return {
          id,
          effectiveFrom,
          prices: lines.map((l) => ({ ...l })),
          monthlyFee,
          note,
          createdBy: (c.created_by as string | null) ?? null,
        };
      }),
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
          action: e.action,
          serviceId: e.service_id ?? null,
          itemId: e.item_id ?? null,
          qty: e.qty ?? null,
          note: await dec("log_entry", "note_enc", e.id, e.note_enc),
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
          refNote: await dec("claim", "ref_note_enc", c.id, c.ref_note_enc),
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
          note: await dec("claim_decision", "note_enc", d.claim_id, d.note_enc),
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
          reason: must(await dec("claim_reversal", "reason_enc", r.claim_id, r.reason_enc)),
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
          note: await dec("settlement", "note_enc", s.id, s.note_enc),
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
        billed: (c.billed as number | null) ?? null,
        closedOn: c.closed_on as string,
        closedBy: c.closed_by ?? null,
      })),
      (c) => c.forMonth + c.consumerId,
    ),
    audit: await Promise.all(
      byKey(audit, (a) => String(a.id).padStart(12, "0")).map(async (a) => ({
        id: Number(a.id),
        table: a.table_name as string,
        rowId: a.row_id as string,
        action: a.action as string,
        actor: a.actor ?? null,
        at: a.at as string,
        // Only a change an agent made has one, so a bundle of a kitchen with none is what it always was.
        ...(a.via ? { via: a.via as { agent: { id: string; name: string } } } : {}),
        before: await openAudit(a.table_name, a.row_id, a.before),
        after: await openAudit(a.table_name, a.row_id, a.after),
      })),
    ),
    archive: {
      kind: "live",
      fromMonth: data.archivedThrough === null ? null : addMonths(data.archivedThrough, 1),
      throughMonth: null,
      priorDigest: null,
      openingIn: byKey(
        openings.map((o) => ({
          personId: o.person_id as string,
          asOfMonth: month(o.as_of_month),
          balance: Number(o.balance),
          billedTotal: Number(o.billed_total),
          paidTotal: Number(o.paid_total),
        })),
        (o) => o.asOfMonth + o.personId,
      ),
      closing: [],
      cuts: byKey(
        cuts.map((c) => ({
          throughMonth: month(c.through_month),
          priorDigest: (c.prior_digest as string | null) ?? null,
          bundleDigest: c.bundle_digest as string,
          sliceHash: c.slice_hash as string,
          counts: c.counts as Record<string, number>,
          cutBy: (c.cut_by as string | null) ?? null,
          cutByRole: "admin" as const,
          cutAt: c.cut_at as string,
        })),
        (c) => c.throughMonth,
      ),
    },
    members: byKey(ctx.members, (m) => m.personId + m.role),
    expected: expectedTotals(data),
  };
  return ctx.slice ? sliceBody(body, data, ctx.slice.through) : body;
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

/**
 * The months up to `through` as a bundle that stands on its own, read from one consistent snapshot: the
 * file an admin holds before those months leave, and the file a fresh kitchen can be made from to see them.
 */
export async function exportArchiveSlice(
  owner: { tx: <T>(fn: (tx: Tx) => Promise<T>, opts?: { snapshot?: boolean }) => Promise<T> },
  cipher: FieldCipher,
  ctx: { exportedAt: Date; members: BundleMember[]; today: string; through: Month },
): Promise<Bundle> {
  const body = await owner.tx(
    (tx) =>
      readBundleBody(tx, cipher, {
        exportedAt: ctx.exportedAt.toISOString(),
        asOf: ctx.today,
        members: ctx.members,
        slice: { through: ctx.through },
      }),
    { snapshot: true },
  );
  return assembleBundle(body);
}

export type ArchiveOfferDraft =
  | {
      ok: true;
      bundle: Bundle;
      /** What the database holds of the rows that would go, as `archive_slice_hash` reads it. */
      sliceHash: string;
      counts: Record<string, number>;
      priorDigest: string | null;
    }
  | { ok: false; why: "nothing_to_archive" }
  | { ok: false; why: "blocked"; blockers: ArchiveBlocker[] }
  | { ok: false; why: "too_large"; rows: number };

/**
 * Everything a hand-over of the months up to `through` is made from, read in one picture of the database:
 * whether the months may go, how many rows would, the checksum of those rows, and the file the admin keeps.
 * Nothing is kept here; the caller says what to remember and sends the file on.
 */
export async function exportArchiveOffer(
  owner: { tx: <T>(fn: (tx: Tx) => Promise<T>, opts?: { snapshot?: boolean }) => Promise<T> },
  cipher: FieldCipher,
  ctx: {
    exportedAt: Date;
    members: BundleMember[];
    today: string;
    through: Month;
    keepMonths: number;
    /** The most rows one hand-over may remove. Left out, the limit of the service. */
    maxRows?: number;
  },
): Promise<ArchiveOfferDraft> {
  const asked = await owner.tx(
    async (tx): Promise<ArchiveOfferDraft> => {
      const data = await loadEngineData(tx, cipher, ctx.today);
      const start = liveFloor(data) ?? firstMonthWithData(data);
      const gone = isArchivedMonth(data, ctx.through);
      if (!gone && (start === null || ctx.through < start))
        return { ok: false, why: "nothing_to_archive" };
      const blockers = archiveBlockers(prepare(data), ctx.through, { keepMonths: ctx.keepMonths });
      if (blockers.length > 0) return { ok: false, why: "blocked", blockers };
      const counts = await spanCounts(tx, ctx.through);
      const rows = sumCounts(counts);
      if (rows > (ctx.maxRows ?? MAX_SPAN_ROWS)) return { ok: false, why: "too_large", rows };
      const [hash] = await tx.query<{ h: string }>("SELECT archive_slice_hash($1::date) AS h", [
        `${ctx.through}-01`,
      ]);
      const body = await readBundleBody(tx, cipher, {
        exportedAt: ctx.exportedAt.toISOString(),
        asOf: ctx.today,
        members: ctx.members,
        slice: { through: ctx.through },
      });
      return {
        ok: true,
        bundle: await assembleBundle(body),
        sliceHash: must(hash).h,
        counts,
        priorDigest: body.archive.priorDigest,
      };
    },
    { snapshot: true },
  );
  return asked;
}
