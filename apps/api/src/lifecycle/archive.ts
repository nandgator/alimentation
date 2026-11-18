import {
  type ArchiveBlocker,
  archiveBlockers,
  type Bundle,
  meter as computeMeter,
  DEFAULT_KEEP_MONTHS,
  eligibleCuts,
  isArchivedMonth,
  latestCut,
  localNow,
  MAX_KEEP_MONTHS,
  MIN_KEEP_MONTHS,
  type Month,
  must,
  openingsAt,
  parityFigures,
  parseBundle,
  prepare,
} from "@alimentation/core";
import type { ArchiveOfferRow } from "../control/repo.ts";
import type { Db, Tx } from "../db/driver.ts";
import type { WorkspaceHandle } from "../directory.ts";
import { readDsns } from "../directory.ts";
import type { PlatformDeps } from "../platform/workspaces.ts";
import type { Actor } from "../workspace/context.ts";
import { ApiError, notFound } from "../workspace/errors.ts";
import { loadEngineData } from "../workspace/load.ts";
import { measureUsage } from "../workspace/service.ts";
import { exportArchiveOffer } from "./bundleio.ts";
import { MAX_SPAN_ROWS, SPAN_TABLE_NAMES, spanBytes, spanCounts, sumCounts } from "./span.ts";

/**
 * Handing older months over: a rolling window of live history, and a verified hand-over of the months that
 * leave it. Every step is the admin's, in a session; no agent key, no operator and no timer takes one.
 *
 *   prepare   builds the months as a file in one consistent picture, remembers only its checksum and the
 *             checksum of the rows, and sends the file on. No copy is kept.
 *   confirm   takes the saved file back. It must be the very file that was offered, and the rows must be as
 *             they were, so the admin demonstrably holds the bytes.
 *   apply     removes the months in one transaction as the platform, and commits only if every later
 *             statement still comes out to the paisa as it did.
 *
 * The workspace database checks again that the months may go; this file decides nothing the database does not
 * also hold it to. See DESIGN.md 5.18.
 */

/** How long a download may be held before it is used. */
export const OFFER_HOURS = 24;
/** How long a purge may seem to run before housekeeping looks at what it left. */
export const PURGE_PATIENCE_MS = 10 * 60_000;

const HOUR = 3_600_000;

/** The tables compacted after a purge so that the bytes the kitchen is held to fall. */
const VACUUM_TABLES = [...SPAN_TABLE_NAMES];

const today = (p: PlatformDeps, h: WorkspaceHandle): string =>
  localNow(p.now(), h.info.timeZone).date;

const owner = (p: PlatformDeps, h: WorkspaceHandle): Db =>
  p.openDb(h.dsns.owner, { ephemeral: true });

const slug = (month: Month): string => `${month}-01`;

// --- what the screen needs ----------------------------------------------------------------------

export interface BlockerDto {
  month: Month;
  code: ArchiveBlocker["code"];
  /** How many people it is about; 0 for a month as a whole. */
  people: number;
  /** Who, for at most ten of them. */
  personIds: string[];
}

export interface OfferDto {
  id: string;
  throughMonth: Month;
  state: ArchiveOfferRow["state"];
  expiresAt: string;
  /** The first eight characters of the file's checksum, for telling files apart. */
  checksum: string;
}

export interface RetentionDto {
  window: { keepMonths: number; min: number; max: number; default: number };
  today: string;
  /** The last month already handed over, or null. */
  archivedThrough: Month | null;
  cuts: { throughMonth: Month; checksum: string; cutAt: string }[];
  /** The newest month the window lets go, whether or not anything stands in the way. */
  newestCut: Month;
  /** The newest month that may be handed over now, or null when none may. */
  eligibleThrough: Month | null;
  /** What stands in the way of `newestCut`, month by month. */
  blockers: BlockerDto[];
  /** What a hand-over through `eligibleThrough` would remove. */
  span: { rows: number; estimatedBytes: number; tooLarge: boolean; maxRows: number } | null;
  /** People who owe something that a hand-over through `eligibleThrough` would carry forward as a balance. */
  peopleWithArrears: number;
  offer: OfferDto | null;
}

const offerDto = (o: ArchiveOfferRow): OfferDto => ({
  id: o.id,
  throughMonth: o.throughMonth,
  state: o.state,
  expiresAt: o.expiresAt,
  checksum: o.bundleDigest.slice(0, 8),
});

/** The live offer of a kitchen, with one that ran out of time put away first. */
async function currentOffer(
  p: PlatformDeps,
  h: WorkspaceHandle,
): Promise<ArchiveOfferRow | undefined> {
  const offer = await p.control.liveOffer(h.row.id);
  if (offer && offer.state !== "PURGING" && new Date(offer.expiresAt) <= p.now()) {
    await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED"], "EXPIRED");
    return undefined;
  }
  return offer;
}

function groupBlockers(list: ArchiveBlocker[]): BlockerDto[] {
  const out = new Map<string, BlockerDto>();
  for (const b of list) {
    const key = `${b.month}|${b.code}`;
    const x = out.get(key) ?? { month: b.month, code: b.code, people: 0, personIds: [] };
    if (b.personId !== null) {
      x.people++;
      if (x.personIds.length < 10) x.personIds.push(b.personId);
    }
    out.set(key, x);
  }
  return [...out.values()];
}

export async function retentionStatus(p: PlatformDeps, h: WorkspaceHandle): Promise<RetentionDto> {
  const keep = h.row.keepMonths;
  const now = today(p, h);
  const db = owner(p, h);
  try {
    const seen = await db.tx(
      async (tx) => {
        const data = await loadEngineData(tx, must(h.cipher), now);
        const pr = prepare(data);
        const newest = latestCut(now, { keepMonths: keep });
        const eligible = eligibleCuts(pr, { keepMonths: keep });
        const eligibleThrough = eligible.at(-1) ?? null;
        const blockers = isArchivedMonth(data, newest)
          ? []
          : archiveBlockers(pr, newest, { keepMonths: keep });
        let span: RetentionDto["span"] = null;
        let arrears = 0;
        if (eligibleThrough !== null) {
          const counts = await spanCounts(tx, eligibleThrough);
          const rows = sumCounts(counts);
          span = {
            rows,
            estimatedBytes: await spanBytes(tx, eligibleThrough),
            tooLarge: rows > MAX_SPAN_ROWS,
            maxRows: MAX_SPAN_ROWS,
          };
          arrears = openingsAt(pr, eligibleThrough).filter((o) => o.balance > 0).length;
        }
        const cuts = await tx.query<{
          through_month: string;
          bundle_digest: string;
          cut_at: string;
        }>("SELECT through_month, bundle_digest, cut_at FROM archive_cut ORDER BY through_month");
        return { data, newest, eligibleThrough, blockers, span, arrears, cuts };
      },
      { snapshot: true },
    );
    const offer = await currentOffer(p, h);
    return {
      window: {
        keepMonths: keep,
        min: MIN_KEEP_MONTHS,
        max: MAX_KEEP_MONTHS,
        default: DEFAULT_KEEP_MONTHS,
      },
      today: now,
      archivedThrough: seen.data.archivedThrough,
      cuts: seen.cuts.map((c) => ({
        throughMonth: String(c.through_month).slice(0, 7),
        checksum: String(c.bundle_digest).slice(0, 8),
        cutAt: c.cut_at,
      })),
      newestCut: seen.newest,
      eligibleThrough: seen.eligibleThrough,
      blockers: groupBlockers(seen.blockers),
      span: seen.span,
      peopleWithArrears: seen.arrears,
      offer: offer ? offerDto(offer) : null,
    };
  } finally {
    await db.close();
  }
}

// --- the window -----------------------------------------------------------------------------------

export async function setWindow(p: PlatformDeps, h: WorkspaceHandle, months: number) {
  await p.control.setKeepMonths(h.row.id, months);
  p.directory.invalidate(h.row.slug);
  return { keepMonths: months };
}

// --- prepare ----------------------------------------------------------------------------------------

export interface Prepared {
  bundle: Bundle;
  offer: OfferDto;
}

export async function prepareArchive(
  p: PlatformDeps,
  h: WorkspaceHandle,
  by: { accountId: string; actor: Actor },
  through: Month,
): Promise<Prepared> {
  const row = h.row;
  if (row.state !== "ACTIVE")
    throw new ApiError(409, "busy", "This kitchen is being moved or has another change under way.");
  const live = await currentOffer(p, h);
  if (live)
    throw new ApiError(
      409,
      "offer_pending",
      "A hand-over is already waiting for this kitchen. Use it, or cancel it, before starting another.",
      undefined,
      { offer: offerDto(live) },
    );
  const now = today(p, h);
  // A month that has only come due to close has not been closed yet; a read stores it, as any read does.
  await h.service.settleDueCloses(by.actor);
  const db = owner(p, h);
  try {
    const members = await p.control.membersOf(row.id);
    const draft = await exportArchiveOffer(db, must(h.cipher), {
      exportedAt: p.now(),
      members,
      today: now,
      through,
      keepMonths: row.keepMonths,
    });
    if (!draft.ok) throw refusalOf(draft);
    const made = await p.control.createOffer({
      workspaceId: row.id,
      throughMonth: through,
      keepMonths: row.keepMonths,
      bundleDigest: draft.bundle.manifest.digest,
      sliceHash: draft.sliceHash,
      priorDigest: draft.priorDigest,
      counts: draft.counts,
      offeredBy: by.accountId,
      expiresAt: new Date(p.now().getTime() + OFFER_HOURS * HOUR),
    });
    if (made === "exists")
      throw new ApiError(
        409,
        "offer_pending",
        "A hand-over is already waiting for this kitchen. Use it, or cancel it, before starting another.",
      );
    return { bundle: draft.bundle, offer: offerDto(made) };
  } finally {
    await db.close();
  }
}

function refusalOf(draft: Exclude<Awaited<ReturnType<typeof exportArchiveOffer>>, { ok: true }>) {
  switch (draft.why) {
    case "nothing_to_archive":
      return new ApiError(
        422,
        "not_archivable",
        "There is nothing to hand over up to that month.",
        undefined,
        { blockers: [] },
      );
    case "blocked":
      return new ApiError(
        422,
        "not_archivable",
        "Some of those months cannot go yet. Each is listed with what stands in the way.",
        undefined,
        { blockers: groupBlockers(draft.blockers) },
      );
    case "too_large":
      return new ApiError(
        422,
        "span_too_large",
        `Those months hold ${draft.rows} records, more than one hand-over takes (${MAX_SPAN_ROWS}). Choose an earlier month and hand over in steps.`,
        undefined,
        { rows: draft.rows, maxRows: MAX_SPAN_ROWS },
      );
  }
}

// --- confirm ---------------------------------------------------------------------------------------

export interface Confirmed {
  offer: OfferDto;
  counts: Record<string, number>;
}

export async function confirmArchive(
  p: PlatformDeps,
  h: WorkspaceHandle,
  by: { accountId: string },
  file: Uint8Array,
): Promise<Confirmed> {
  const row = h.row;
  const offer = await currentOffer(p, h);
  if (!offer || offer.state === "PURGING")
    throw new ApiError(
      409,
      "offer_state",
      "Nothing is waiting to be confirmed. Download the months first.",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(file));
  } catch {
    throw new ApiError(422, "wrong_file", "That is not the file that was downloaded.");
  }
  const parsed = await parseBundle(raw);
  if (!parsed.ok)
    throw new ApiError(
      422,
      "wrong_file",
      "That file is damaged or has been altered, so it cannot be the one that was downloaded.",
      undefined,
      { problems: parsed.problems.slice(0, 5) },
    );
  const b = parsed.bundle;
  if (
    b.manifest.digest !== offer.bundleDigest ||
    b.archive.kind !== "slice" ||
    b.archive.throughMonth !== offer.throughMonth
  )
    throw new ApiError(422, "wrong_file", "That is not the file that was downloaded.");
  // The rows must still be the ones the file was made from.
  const db = owner(p, h);
  try {
    const hash = await db.tx(
      async (tx) =>
        must(
          (
            await tx.query<{ h: string }>("SELECT archive_slice_hash($1::date) AS h", [
              slug(offer.throughMonth),
            ])
          )[0],
        ).h,
      { snapshot: true },
    );
    if (hash !== offer.sliceHash) {
      await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED"], "EXPIRED");
      throw changed();
    }
  } finally {
    await db.close();
  }
  if (
    !(await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED"], "CONFIRMED", {
      confirmedBy: by.accountId,
    }))
  )
    throw new ApiError(409, "offer_state", "That offer is no longer waiting.");
  await p.control.event("archive.confirmed", row.id, { through: offer.throughMonth });
  return { offer: offerDto({ ...offer, state: "CONFIRMED" }), counts: offer.counts };
}

const changed = () =>
  new ApiError(
    409,
    "slice_changed",
    "Records in those months were changed after the file was made, so it no longer matches. Nothing was removed; download the months again.",
  );

// --- cancel ----------------------------------------------------------------------------------------

export async function cancelArchive(p: PlatformDeps, h: WorkspaceHandle, offerId: string) {
  const offer = await p.control.offerById(offerId);
  if (!offer || offer.workspaceId !== h.row.id) throw notFound("Offer");
  if (!(await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED"], "EXPIRED")))
    throw new ApiError(409, "offer_state", "That offer is no longer waiting.");
  return { cancelled: true };
}

// --- apply -----------------------------------------------------------------------------------------

export interface Applied {
  throughMonth: Month;
  checksum: string;
  counts: Record<string, number>;
  /** Whether the tables were compacted so the kitchen's size fell. Best effort, and tried again later. */
  compacted: boolean;
}

/** Said when the months after a cut did not come out the same: the cut is undone and nothing is lost. */
class ParityFailed extends Error {}

const LOCKED = [
  "log_entry",
  "claim",
  "claim_decision",
  "claim_reversal",
  "settlement",
  "month_close",
  "audit_log",
  "person",
  "archive_cut",
  "opening_balance",
];

/** What the database function says when it refuses, as what a caller is told. */
function refusalOfDb(e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  const m = /ALIMENTATION_ARCHIVE_REFUSED: ([a-z_]+)/.exec(String(err?.message ?? ""));
  if (m) {
    const why = m[1];
    if (why === "hash_mismatch" || why === "count_mismatch") return changed();
    if (why === "read_only")
      return new ApiError(
        409,
        "read_only",
        "This kitchen is read-only, so nothing can be removed.",
      );
    return new ApiError(
      422,
      "not_archivable",
      "The database does not allow those months to go.",
      undefined,
      { blockers: [], reason: why },
    );
  }
  if (err?.code === "55P03" || err?.code === "57014")
    return new ApiError(503, "busy", "The kitchen is busy. Nothing was removed; try again.");
  return e;
}

export async function applyArchive(
  p: PlatformDeps,
  h: WorkspaceHandle,
  by: { accountId: string; personId: string },
  input: { offerId: string; typedMonth: string },
): Promise<Applied> {
  const row = h.row;
  const offer = await p.control.offerById(input.offerId);
  if (!offer || offer.workspaceId !== row.id) throw notFound("Offer");
  if (input.typedMonth.trim() !== offer.throughMonth)
    throw new ApiError(
      422,
      "wrong_month",
      "Type the last month being handed over, as it is shown, to confirm.",
    );
  if (offer.state !== "CONFIRMED" && offer.state !== "OFFERED")
    throw new ApiError(409, "offer_state", "That offer is not waiting to be used.");
  if (new Date(offer.expiresAt) <= p.now()) {
    await p.control.moveOffer(offer.id, ["OFFERED", "CONFIRMED"], "EXPIRED");
    throw new ApiError(
      410,
      "offer_expired",
      "That offer ran out of time. Download the months again.",
    );
  }
  if (offer.state !== "CONFIRMED")
    throw new ApiError(
      409,
      "offer_state",
      "Upload the saved file first, so that it is known you hold it.",
    );
  // Of two callers, one wins each of these two steps.
  if (!(await p.control.moveOffer(offer.id, ["CONFIRMED"], "PURGING")))
    throw new ApiError(409, "offer_state", "That offer is not waiting to be used.");
  if (!(await p.control.beginArchive(row.id))) {
    await p.control.moveOffer(offer.id, ["PURGING"], "CONFIRMED");
    throw new ApiError(409, "busy", "This kitchen is being moved or has another change under way.");
  }
  p.directory.invalidate(row.slug);

  const db = owner(p, h);
  let committed = false;
  try {
    const counts = await db.tx(async (tx) => purge(p, h, tx, offer, by));
    committed = true;

    // Past this point the months are gone for good and only the record of it is left to write. If any of it
    // fails the kitchen stays as it is and housekeeping finishes it from the cut itself.
    await p.control.insertArchiveReceipt({
      workspaceId: row.id,
      throughMonth: offer.throughMonth,
      bundleDigest: offer.bundleDigest,
      counts,
    });
    await p.control.moveOffer(offer.id, ["PURGING"], "DONE");
    await p.control.endArchive(row.id);
    p.directory.invalidate(row.slug);
    await p.control
      .event("archive.done", row.id, { through: offer.throughMonth, rows: sumCounts(counts) })
      .catch(() => undefined);
    const compacted = await compact(db);
    await afterPurge(p, row.id, db, compacted);
    return {
      throughMonth: offer.throughMonth,
      checksum: offer.bundleDigest.slice(0, 8),
      counts,
      compacted,
    };
  } catch (e) {
    if (!committed) {
      const mapped = e instanceof ParityFailed ? e : refusalOfDb(e);
      // A file made from rows that have since changed can never be used; anything else may be tried again.
      const stale = mapped instanceof ApiError && mapped.code === "slice_changed";
      await p.control
        .moveOffer(offer.id, ["PURGING"], stale ? "EXPIRED" : "CONFIRMED")
        .catch(() => undefined);
      await p.control.endArchive(row.id).catch(() => undefined);
      p.directory.invalidate(row.slug);
      if (mapped instanceof ParityFailed) {
        // No name and no figure: only that it happened, where, and for which month.
        await p.control
          .event("archive.parity_failed", row.id, { through: offer.throughMonth })
          .catch(() => undefined);
        throw new ApiError(
          500,
          "archive_parity_failed",
          "Removing those months would have changed a later statement, so nothing was removed. The operator has been told.",
        );
      }
      throw mapped;
    }
    throw e;
  } finally {
    await db.close().catch(() => undefined);
  }
}

/** The transaction that removes the months, as the platform. Throws to undo everything. */
async function purge(
  p: PlatformDeps,
  h: WorkspaceHandle,
  tx: Tx,
  offer: ArchiveOfferRow,
  by: { personId: string },
): Promise<Record<string, number>> {
  const cipher = must(h.cipher);
  const through = offer.throughMonth;
  await tx.query("SET LOCAL lock_timeout = '5s'");
  await tx.query("SET LOCAL statement_timeout = '60s'");
  // Writers wait here, so what is read next is what the function will see.
  await tx.query(`LOCK TABLE ${LOCKED.join(", ")} IN SHARE ROW EXCLUSIVE MODE`);

  const now = today(p, h);
  const before = await loadEngineData(tx, cipher, now);
  const pr = prepare(before);
  const blockers = archiveBlockers(pr, through, { keepMonths: offer.keepMonths });
  if (blockers.length > 0)
    throw new ApiError(
      422,
      "not_archivable",
      "Some of those months can no longer go. Each is listed with what stands in the way.",
      undefined,
      { blockers: groupBlockers(blockers) },
    );
  const counts = await spanCounts(tx, through);
  const [hash] = await tx.query<{ h: string }>("SELECT archive_slice_hash($1::date) AS h", [
    slug(through),
  ]);
  if (must(hash).h !== offer.sliceHash || sumCounts(counts) !== sumCounts(offer.counts))
    throw changed();
  if (sumCounts(counts) > MAX_SPAN_ROWS)
    throw new ApiError(
      422,
      "span_too_large",
      "Those months hold too many records for one hand-over.",
    );

  const openings = openingsAt(pr, through).map((o) => ({
    person_id: o.personId,
    balance: o.balance,
    billed_total: o.billedTotal,
    paid_total: o.paidTotal,
  }));
  const figuresBefore = parityFigures(before, through);

  const [done] = await tx.query<{ r: Record<string, number> }>(
    "SELECT archive_cut_apply($1::date, $2::int, $3, $4, $5, $6::jsonb, $7::uuid, $8::jsonb) AS r",
    [
      slug(through),
      offer.keepMonths,
      offer.bundleDigest,
      offer.sliceHash,
      offer.priorDigest,
      JSON.stringify(offer.counts),
      by.personId,
      JSON.stringify(openings),
    ],
  );

  const after = await loadEngineData(tx, cipher, now);
  if (after.archivedThrough !== through || parityFigures(after, through) !== figuresBefore)
    throw new ParityFailed();
  return must(done).r;
}

/** Compacts the tables a purge emptied, outside the purge, so the bytes the kitchen is held to fall. */
export async function compact(db: Db): Promise<boolean> {
  try {
    await db.withClient(async (client) => {
      await client.query("SET lock_timeout = '5s'");
      for (const t of VACUUM_TABLES) await client.query(`VACUUM FULL ${t}`);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * What a purge leaves for later: whether the tables still need compacting (housekeeping tries again), and the
 * limit, which a purge that brings the kitchen under it takes off. Best effort: the daily look does both again.
 */
export async function afterPurge(
  p: PlatformDeps,
  workspaceId: string,
  db: Db,
  compacted: boolean,
): Promise<void> {
  try {
    await p.control.setRetention(workspaceId, { vacuumPending: !compacted });
    if (compacted) await settleOver(p, workspaceId, db);
  } catch {
    // The daily look settles it.
  }
}

/**
 * Takes `over_since` off a kitchen that is now under 100 percent of every measure, so the grace does not stay
 * counting against one that has made room. A kitchen still over keeps its date.
 */
export async function settleOver(p: PlatformDeps, workspaceId: string, db: Db): Promise<boolean> {
  const row = await p.control.workspaceById(workspaceId);
  if (!row || row.overSince === null) return false;
  const requests = (await p.control.requestsToday(p.now().toISOString().slice(0, 10))).byWorkspace;
  const usage = await db.tx(async (tx) => measureUsage(tx, requests.get(row.id) ?? 0), {
    snapshot: true,
  });
  const m = computeMeter(usage, row.limits, row.overSince, localNow(p.now(), row.timeZone).date);
  if (m.state === "OVER") return false;
  await p.control.setOverSince(row.id, null);
  p.directory.invalidate(row.slug);
  return true;
}

// --- after a crash -----------------------------------------------------------------------------------

export type Reconciled = "done" | "back" | "nothing";

/**
 * Settles a purge that stopped part-way, from what the workspace database says, which is the truth:
 *
 *   the cut is there   the months are gone. The receipt is written if it is missing, the offer is done and
 *                      the kitchen is open again.
 *   the cut is not     nothing was removed. The offer is waiting to be used again (or has run out) and the
 *                      kitchen is open again.
 *
 * Safe to run at any time and as often as wanted; it does nothing to a kitchen that is not archiving.
 */
export async function reconcileArchive(
  p: PlatformDeps,
  workspaceId: string,
  opts: { patienceMs?: number } = {},
): Promise<Reconciled> {
  const row = await p.control.workspaceById(workspaceId);
  if (row?.state !== "ARCHIVING") return "nothing";
  const patience = opts.patienceMs ?? PURGE_PATIENCE_MS;
  if (p.now().getTime() - new Date(row.stateSince).getTime() < patience) return "nothing";
  const offers = (await p.control.offersPurging()).filter((o) => o.workspaceId === row.id);
  const dsns = await readDsns(p.keyring, row.id, row.dsnEnc);
  const db = p.openDb(dsns.owner, { ephemeral: true });
  try {
    let result: Reconciled = "back";
    for (const offer of offers) {
      const cut = await db.tx(async (tx) =>
        tx.query<{ bundle_digest: string; counts: Record<string, number> }>(
          "SELECT bundle_digest, counts FROM archive_cut WHERE through_month = $1::date",
          [slug(offer.throughMonth)],
        ),
      );
      const found = cut[0];
      if (found && String(found.bundle_digest).trim() === offer.bundleDigest) {
        await p.control.insertArchiveReceipt({
          workspaceId: row.id,
          throughMonth: offer.throughMonth,
          bundleDigest: offer.bundleDigest,
          counts: found.counts,
        });
        await p.control.moveOffer(offer.id, ["PURGING"], "DONE");
        await p.control.event("archive.done", row.id, {
          through: offer.throughMonth,
          reconciled: true,
        });
        result = "done";
      } else {
        // A cut of those months by another file can never be used again; so can one that ran out of time.
        const expired = found !== undefined || new Date(offer.expiresAt) <= p.now();
        await p.control.moveOffer(offer.id, ["PURGING"], expired ? "EXPIRED" : "CONFIRMED");
        await p.control.event("archive.rolled_back", row.id, { through: offer.throughMonth });
      }
    }
    await p.control.endArchive(row.id);
    // The months went, and nothing has compacted the tables since: the daily look does it.
    if (result === "done") await p.control.setRetention(row.id, { vacuumPending: true });
    p.directory.invalidate(row.slug);
    return result;
  } finally {
    await db.close().catch(() => undefined);
  }
}
