/**
 * What the audit trail says, in words a kitchen would use (DAT-06): "Added", "Changed", "Removed"; the tables by what
 * they hold; a day as a heading; a change as the fields that differ. The server sends table names, SQL verbs and
 * snake_case column names, and none of them reach the screen.
 */

export interface AuditEntry {
  id: number;
  table: string;
  rowId: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  actor: string | null;
  at: string;
  /** Set when an AI agent made the change on a person's behalf. */
  via?: unknown;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export type ActionKey = "added" | "changed" | "removed";

export const ACTIONS: { key: ActionKey; label: string }[] = [
  { key: "added", label: "Added" },
  { key: "changed", label: "Changed" },
  { key: "removed", label: "Removed" },
];

const ACTION_OF: Record<AuditEntry["action"], ActionKey> = {
  INSERT: "added",
  UPDATE: "changed",
  DELETE: "removed",
};

export const actionKey = (e: Pick<AuditEntry, "action">): ActionKey => ACTION_OF[e.action];
export const actionWords = (e: Pick<AuditEntry, "action">): string =>
  ACTIONS.find((a) => a.key === actionKey(e))?.label ?? "Changed";

const ENTITY: Record<string, string> = {
  account: "Account",
  agent_key: "AI agent key",
  archive_cut: "Handed-over months",
  archive_offer: "Hand-over offer",
  archive_receipt: "Hand-over receipt",
  catalogue_item: "Item served",
  claim: "Payment claim",
  claim_decision: "Claim decision",
  claim_reversal: "Claim reversal",
  holiday: "Holiday",
  invite: "Invitation",
  log_entry: "Meal entry",
  membership: "Membership",
  menu: "Menu",
  menu_day: "Menu day",
  menu_offer: "Menu offer",
  month_close: "Month close",
  opening_balance: "Opening balance",
  person: "Person",
  person_service: "Meals a person eats",
  policy_version: "Rules",
  rate_card: "Prices",
  rate_price: "Price",
  service: "Meal",
  settlement: "Settlement",
};

/** `rate_card` as "Prices"; a table nobody named is its own name, spaced and capitalised. */
export function entityWords(table: string): string {
  const known = ENTITY[table];
  if (known) return known;
  const spaced = table.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** `on_date` as "On date", `consumer_id` as "Consumer". */
export function fieldWords(name: string): string {
  const spaced = name.replace(/_enc$/, "").replace(/_id$/, "").replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A stored value as text: nothing is "empty", a flag "Yes" or "No", the rest as it is. */
export function valueWords(v: unknown): string {
  if (v === null || v === undefined || v === "") return "Empty";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/** The fields an entry is about: for a change, the ones that differ; for an add or a removal, the ones it holds. */
export function changesOf(e: Pick<AuditEntry, "action" | "before" | "after">): FieldChange[] {
  const before = e.before ?? {};
  const after = e.after ?? {};
  if (e.action === "UPDATE") {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
      .map((k) => ({
        field: fieldWords(k),
        before: valueWords(before[k]),
        after: valueWords(after[k]),
      }));
  }
  if (e.action === "INSERT")
    return Object.entries(after).map(([k, v]) => ({
      field: fieldWords(k),
      before: null,
      after: valueWords(v),
    }));
  return Object.entries(before).map(([k, v]) => ({
    field: fieldWords(k),
    before: valueWords(v),
    after: null,
  }));
}

/** The kitchen's calendar day of a moment, `2026-11-25`. */
export function dayOf(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));
}

/** A day as a heading: "Today", "Yesterday", or "Mon, 23 Nov 2026". */
export function dayWords(day: string, today: string): string {
  if (day === today) return "Today";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** "3:04 pm" in the kitchen's own time. */
export const timeWords = (at: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(at),
  );

/** What the toolbar has asked for. Every part is empty when it is not used. */
export interface AuditFilter {
  q: string;
  /** A person's id, or `system` for changes nobody made. */
  person: string;
  action: ActionKey | "";
  /** A table name. */
  entity: string;
  /** `YYYY-MM-DD`, in the kitchen's days. */
  from: string;
  to: string;
}

export const SYSTEM = "system";

/** The entries that pass the filter, newest first as they came. `nameOf` words a person; `timeZone` is the kitchen's. */
export function filterEntries(
  entries: AuditEntry[],
  f: AuditFilter,
  nameOf: (id: string) => string,
  timeZone: string,
): AuditEntry[] {
  const q = f.q.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.person === SYSTEM) {
      if (e.actor !== null) return false;
    } else if (f.person && e.actor !== f.person) return false;
    if (f.action && actionKey(e) !== f.action) return false;
    if (f.entity && e.table !== f.entity) return false;
    if (f.from || f.to) {
      const day = dayOf(e.at, timeZone);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (!q) return true;
    const hay = [
      entityWords(e.table),
      actionWords(e),
      e.actor ? nameOf(e.actor) : "System",
      e.rowId,
      ...changesOf(e).flatMap((c) => [c.field, c.before ?? "", c.after ?? ""]),
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** The entries in runs of one day, in the order they came (newest first). */
export function groupByDay(
  entries: AuditEntry[],
  timeZone: string,
): { day: string; entries: AuditEntry[] }[] {
  const out: { day: string; entries: AuditEntry[] }[] = [];
  for (const e of entries) {
    const day = dayOf(e.at, timeZone);
    const last = out.at(-1);
    if (last && last.day === day) last.entries.push(e);
    else out.push({ day, entries: [e] });
  }
  return out;
}
