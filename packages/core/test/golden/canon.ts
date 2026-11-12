/// <reference types="node" />
import { createHash } from "node:crypto";
import type { GoldenRow } from "./scenarios.ts";

/** One ledger row as a single line, the form the digest is taken over. */
export function rowString(r: GoldenRow): string {
  return [
    r.date,
    r.status,
    r.meal ?? "-",
    r.chapati,
    r.bhakri,
    r.mealPrice,
    r.addOnAmount,
    r.leaveAmount,
    r.total,
    r.basis,
    r.holidayName ?? "",
  ].join("|");
}

export function digestOf(lines: readonly string[]): string {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function errorCode(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && typeof e.code === "string") return e.code;
  throw e;
}
