import { addDays, addMonths, meter as computeMeter, type Month, must } from "@alimentation/core";
import type {
  ArchiveOfferRow,
  RetentionMeta,
  RetentionState,
  WorkspaceRow,
} from "../control/repo.ts";
import type { PlatformDeps } from "../platform/workspaces.ts";
import { measureUsage } from "../workspace/service.ts";
import { compact, PURGE_PATIENCE_MS, retentionStatus, settleOver } from "./archive.ts";

/**
 * The daily look at one kitchen's older months. It writes metadata only, into `workspace.retention` in the
 * control database, and it never purges and never confirms: the only thing it removes from a kitchen is
 * nothing, and the only thing it changes in one is the bytes the tables take (compacting).
 *
 *   - settles offers against the kitchen's own record of its cuts, which is the truth: a cut that is there
 *     finishes its offer; a cut that is missing where the control database says one was made means the kitchen
 *     was restored to before it ("restored, re-archive possible"); an offer for months already gone, or a purge
 *     that never reached the database, is put away or back;
 *   - tries again to compact the tables a purge emptied;
 *   - once per `overSince`, lengthens the grace by up to 7 days while an offer is on the table;
 *   - leaves a state: none, due (a cut is eligible), offered (an offer is live) or overdue (a cut is eligible
 *     and the kitchen is over a limit).
 */

/** The most days the grace is lengthened by, once for each time a kitchen goes over. */
export const GRACE_EXTRA_DAYS = 7;

const day = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * What the operator may see of a kitchen's older months: where it stands, where the live months begin, and
 * counts. This is a list of keys on purpose, so a field added to the metadata is not shown by accident.
 */
export const OPERATOR_RETENTION_KEYS = [
  "state",
  "retainedFrom",
  "liveBytes",
  "liveRows",
  "cuts",
  "restored",
] as const;

export function operatorRetention(
  r: RetentionMeta,
): Pick<RetentionMeta, (typeof OPERATOR_RETENTION_KEYS)[number]> {
  return {
    state: r.state,
    retainedFrom: r.retainedFrom,
    liveBytes: r.liveBytes,
    liveRows: r.liveRows,
    cuts: r.cuts,
    restored: r.restored,
  };
}

export interface ScanResult {
  state: RetentionState;
  reconciled: number;
  compacted: boolean;
  graceExtended: boolean;
}

/** Looks at one active kitchen and records what it found. Safe to run as often as wanted. */
export async function retentionScan(
  p: PlatformDeps,
  row: WorkspaceRow,
): Promise<ScanResult | null> {
  if (row.state !== "ACTIVE") return null;
  const h = await p.directory.bySlug(row.slug);
  if (!h?.cipher || h.row.state !== "ACTIVE") return null;
  const today = day(p.now());
  const db = p.openDb(h.dsns.owner, { ephemeral: true });
  try {
    // --- what the kitchen's own database records, which is the truth ---
    const cuts = await db.tx(
      async (tx) =>
        tx.query<{ through_month: string; bundle_digest: string }>(
          "SELECT through_month, bundle_digest FROM archive_cut ORDER BY through_month",
        ),
      { snapshot: true },
    );
    const cutAt = new Map(
      cuts.map((c) => [String(c.through_month).slice(0, 7), String(c.bundle_digest).trim()]),
    );
    const newest = [...cutAt.keys()].sort().at(-1) ?? null;

    // --- offers against cuts ---
    let reconciled = 0;
    let vacuumDue = row.retention.vacuumPending;
    for (const offer of await p.control.openOffers(row.id)) {
      const settled = await settleOffer(p, row, offer, cutAt, newest);
      if (settled === "done") vacuumDue = true;
      if (settled !== "kept") reconciled++;
    }

    // --- control says months went that the kitchen no longer records: restored to before a cut ---
    const receipts = await p.control.archiveReceipts(row.id);
    const missing = receipts.filter((r) => !cutAt.has(r.throughMonth));
    const restored = missing.length > 0;
    if (restored && !row.retention.restored)
      await p.control.event("archive.restored", row.id, { through: missing.at(-1)?.throughMonth });

    // --- compacting that did not happen, tried again ---
    let compacted = false;
    if (vacuumDue) {
      compacted = await compact(db);
      vacuumDue = !compacted;
      if (compacted) await settleOver(p, row.id, db);
    }

    // --- the state ---
    const fresh = (await p.control.workspaceById(row.id)) ?? row;
    const status = await retentionStatus(p, h);
    const requests = (await p.control.requestsToday(today)).byWorkspace.get(row.id) ?? 0;
    const usage = await db.tx(async (tx) => measureUsage(tx, requests), { snapshot: true });
    const m = computeMeter(usage, fresh.limits, fresh.overSince, today, null);
    const live = (await p.control.openOffers(row.id))[0];
    const eligible = status.eligibleThrough !== null;
    const state: RetentionState = live
      ? "offered"
      : eligible
        ? m.state === "OVER"
          ? "overdue"
          : "due"
        : "none";

    // --- the grace: once for each time the kitchen goes over, up to 7 days, no further than the offer ---
    const patch: Partial<RetentionMeta> = {};
    let graceExtended = false;
    if (
      fresh.overSince !== null &&
      fresh.retention.graceFor !== fresh.overSince &&
      live &&
      (live.state === "OFFERED" || live.state === "CONFIRMED")
    ) {
      const plain = addDays(fresh.overSince, 14);
      const offerEnds = day(new Date(live.expiresAt));
      if (offerEnds > plain) {
        const until =
          offerEnds < addDays(plain, GRACE_EXTRA_DAYS)
            ? offerEnds
            : addDays(plain, GRACE_EXTRA_DAYS);
        patch.graceUntil = until;
        patch.graceFor = fresh.overSince;
        graceExtended = true;
      }
    }

    await p.control.setRetention(row.id, {
      ...patch,
      state,
      retainedFrom: await retainedFrom(db, status.archivedThrough),
      liveBytes: usage.bytes,
      liveRows: usage.rows,
      cuts: cuts.length,
      scannedOn: today,
      restored,
      vacuumPending: vacuumDue,
    });
    if (graceExtended || reconciled > 0 || compacted) p.directory.invalidate(row.slug);
    return { state, reconciled, compacted, graceExtended };
  } finally {
    await db.close().catch(() => undefined);
  }
}

/** Puts one offer right against the kitchen's cuts. `kept` leaves it as it is. */
async function settleOffer(
  p: PlatformDeps,
  row: WorkspaceRow,
  offer: ArchiveOfferRow,
  cutAt: Map<string, string>,
  newest: Month | null,
): Promise<"done" | "expired" | "back" | "kept"> {
  const digest = cutAt.get(offer.throughMonth);
  if (digest !== undefined) {
    if (digest === offer.bundleDigest) {
      // The months went and only the record of it is left to write.
      await p.control.insertArchiveReceipt({
        workspaceId: row.id,
        throughMonth: offer.throughMonth,
        bundleDigest: offer.bundleDigest,
        counts: offer.counts,
      });
      await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED", "PURGING"], "DONE");
      await p.control.event("archive.done", row.id, {
        through: offer.throughMonth,
        reconciled: true,
      });
      return "done";
    }
    // Another hand-over took these months: this offer can never be used.
    await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED", "PURGING"], "EXPIRED");
    return "expired";
  }
  if (newest !== null && newest >= offer.throughMonth) {
    await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED", "PURGING"], "EXPIRED");
    return "expired";
  }
  // A purge the kitchen is not running (it is active) and that the database never saw.
  if (
    offer.state === "PURGING" &&
    p.now().getTime() - new Date(offer.stateSince).getTime() >= PURGE_PATIENCE_MS
  ) {
    const lapsed = new Date(offer.expiresAt) <= p.now();
    await p.control.moveOffer(offer.id, ["PURGING"], lapsed ? "EXPIRED" : "CONFIRMED");
    await p.control.event("archive.rolled_back", row.id, { through: offer.throughMonth });
    return "back";
  }
  return "kept";
}

/** The first month still held live: the one after the last cut, or the oldest month with anything in it. */
async function retainedFrom(
  db: ReturnType<PlatformDeps["openDb"]>,
  through: Month | null,
): Promise<Month | null> {
  if (through !== null) return addMonths(through, 1);
  const [r] = await db.tx(
    async (tx) =>
      tx.query<{ m: string | null }>(
        `SELECT to_char(min(m), 'YYYY-MM') AS m FROM (
           SELECT min(on_date) AS m FROM log_entry
           UNION ALL SELECT min(for_month) FROM claim
           UNION ALL SELECT min(for_month) FROM settlement) x`,
      ),
    { snapshot: true },
  );
  return (must(r).m as Month | null) ?? null;
}
