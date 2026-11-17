import {
  addMonths,
  type Bundle,
  type BundleBody,
  dropBefore,
  expectedTotals,
  type Month,
  monthEnd,
  openingsAt,
  prepare,
} from "@alimentation/core";
import type { FieldCipher } from "../../src/crypto/fields.ts";
import type { Db } from "../../src/db/driver.ts";
import { exportArchiveSlice } from "../../src/lifecycle/bundleio.ts";
import { loadEngineData } from "../../src/workspace/load.ts";

/** Tables whose rows leave with a cut, in the order that keeps every reference valid. */
const SPAN = ["claim_reversal", "claim_decision", "claim", "settlement", "month_close"] as const;

/**
 * Stands in for the database function that removes handed-over months (a later step of the build): as the
 * database owner, with the row triggers switched off, it takes the slice a person would have held, removes
 * the months it covers and writes the opening balances and the cut. It lets the bundle and the move be tried
 * on a kitchen that really has had a cut.
 */
export async function applyCutAsOwner(
  owner: Db,
  cipher: FieldCipher,
  through: Month,
  today: string,
): Promise<{ slice: Bundle }> {
  const slice = await exportArchiveSlice(owner, cipher, {
    exportedAt: new Date(`${today}T06:00:00Z`),
    members: [],
    today,
    through,
  });
  await owner.tx(async (tx) => {
    const data = await loadEngineData(tx, cipher, today);
    const openings = openingsAt(prepare(data), through);
    const [prior] = await tx.query<{ through_month: string; bundle_digest: string }>(
      "SELECT through_month, bundle_digest FROM archive_cut ORDER BY through_month DESC LIMIT 1",
    );
    const tables = [...SPAN, "log_entry", "opening_balance", "archive_cut"];
    for (const t of tables) await tx.query(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
    const first = `${through}-01`;
    await tx.query(
      "DELETE FROM claim_reversal WHERE claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
      [first],
    );
    await tx.query(
      "DELETE FROM claim_decision WHERE claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
      [first],
    );
    await tx.query("DELETE FROM claim WHERE for_month <= $1::date", [first]);
    await tx.query("DELETE FROM settlement WHERE for_month <= $1::date", [first]);
    await tx.query("DELETE FROM month_close WHERE for_month <= $1::date", [first]);
    await tx.query("DELETE FROM log_entry WHERE on_date <= $1::date", [monthEnd(through)]);
    for (const o of openings)
      await tx.query(
        "INSERT INTO opening_balance (person_id, as_of_month, balance, billed_total, paid_total) VALUES ($1, $2::date, $3, $4, $5)",
        [o.personId, `${o.asOfMonth}-01`, o.balance, o.billedTotal, o.paidTotal],
      );
    await tx.query(
      `INSERT INTO archive_cut (through_month, prior_through, prior_digest, bundle_digest, slice_hash, counts)
       VALUES ($1::date, $2::date, $3, $4, $5, '{}'::jsonb)`,
      [
        first,
        prior?.through_month ?? null,
        prior?.bundle_digest ?? null,
        slice.manifest.digest,
        "e".repeat(64),
      ],
    );
    for (const t of tables) await tx.query(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
  });
  return { slice };
}

/**
 * A live bundle of a kitchen that has had its months up to `through` cut, made from the bundle of the same
 * kitchen before the cut, without a database. Its figures are what the engine says of the kitchen after.
 */
export function bundleAfterCut(
  body: BundleBody,
  data: Parameters<typeof dropBefore>[0],
  through: Month,
  bundleDigest: string,
): BundleBody {
  const after = dropBefore(data, through);
  const end = monthEnd(through);
  const claims = body.claims.filter((c) => c.forMonth > through);
  const kept = new Set(claims.map((c) => c.id));
  return {
    ...body,
    log: body.log.filter((e) => e.date > end),
    claims,
    decisions: body.decisions.filter((d) => kept.has(d.claimId)),
    reversals: body.reversals.filter((r) => kept.has(r.claimId)),
    settlements: body.settlements.filter((s) => s.forMonth > through),
    closes: body.closes.filter((c) => c.forMonth > through),
    archive: {
      kind: "live",
      fromMonth: addMonths(through, 1),
      throughMonth: null,
      priorDigest: null,
      openingIn: after.openings.map((o) => ({ ...o })),
      closing: [],
      cuts: [
        {
          throughMonth: through,
          priorDigest: null,
          bundleDigest,
          sliceHash: "e".repeat(64),
          counts: {},
          cutBy: null,
          cutByRole: "admin",
          cutAt: "2026-11-15T06:00:00.000Z",
        },
      ],
    },
    expected: expectedTotals(after),
  };
}
