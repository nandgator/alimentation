import type { Month } from "@alimentation/core";
import type { Tx } from "../db/driver.ts";

/**
 * The rows a cut through a month removes, table by table, in the order they are removed. The conditions are
 * the ones the database function uses (`archive_cut_apply`), so a count taken here is the count it will check.
 * `$1` is the first day of the last month to go.
 */
export const SPAN_TABLES: readonly { table: string; where: string }[] = [
  { table: "audit_log", where: "archive_row_month('audit_log', to_jsonb(audit_log)) <= $1::date" },
  {
    table: "claim_reversal",
    where: "claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
  },
  {
    table: "claim_decision",
    where: "claim_id IN (SELECT id FROM claim WHERE for_month <= $1::date)",
  },
  { table: "claim", where: "for_month <= $1::date" },
  { table: "settlement", where: "for_month <= $1::date" },
  { table: "month_close", where: "for_month <= $1::date" },
  { table: "log_entry", where: "on_date < ($1::date + interval '1 month')::date" },
];

/** The tables that leave, as the tables to compact afterwards: the span's and no others. */
export const SPAN_TABLE_NAMES: readonly string[] = SPAN_TABLES.map((t) => t.table);

/** How many rows of each table a cut through `through` would remove, from one consistent picture. */
export async function spanCounts(tx: Tx, through: Month): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const { table, where } of SPAN_TABLES) {
    const [r] = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`,
      [`${through}-01`],
    );
    out[table] = Number(r?.n ?? 0);
  }
  return out;
}

/** About how many bytes those rows take in the database. An estimate for the screen, never a check. */
export async function spanBytes(tx: Tx, through: Month): Promise<number> {
  let total = 0;
  for (const { table, where } of SPAN_TABLES) {
    const [r] = await tx.query<{ n: number }>(
      `SELECT coalesce(sum(pg_column_size(${table}.*)), 0)::bigint AS n FROM ${table} WHERE ${where}`,
      [`${through}-01`],
    );
    total += Number(r?.n ?? 0);
  }
  return total;
}

export const sumCounts = (c: Record<string, number>): number =>
  Object.values(c).reduce((a, b) => a + b, 0);

/** The most rows one cut may remove. It is one transaction, so a bigger span is handed over in steps. */
export const MAX_SPAN_ROWS = 200_000;
