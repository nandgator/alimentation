import type { Enrolment } from "@alimentation/core";

/** One service in the People form: whether the member takes it, and from and until when (empty: still). */
export interface Slot {
  on: boolean;
  from: string;
  to: string;
}

export interface EnrolmentRow {
  serviceId: string;
  activeFrom: string;
  activeTo: string | null;
}

const rowOf = (e: Enrolment): EnrolmentRow => ({
  serviceId: e.serviceId,
  activeFrom: e.activeFrom,
  activeTo: e.activeTo,
});

/** The row the form edits for a service: the one that began last. Earlier rows are history and stay as they are. */
function latest(rows: readonly Enrolment[], serviceId: string): Enrolment | undefined {
  return rows
    .filter((r) => r.serviceId === serviceId)
    .sort((a, b) => (a.activeFrom < b.activeFrom ? 1 : -1))[0];
}

/** How the form starts for a service. A service the member does not take yet starts from `fallbackFrom`. */
export function slotOf(rows: readonly Enrolment[], serviceId: string, fallbackFrom: string): Slot {
  const row = latest(rows, serviceId);
  return row
    ? { on: true, from: row.activeFrom, to: row.activeTo ?? "" }
    : { on: false, from: fallbackFrom, to: "" };
}

/**
 * The whole list to send to `PUT /people/:id/services`, which replaces the list: every row the form does not
 * touch as it was, and for each service in the form its latest row as the form says (dropped when unticked,
 * added when ticked and there was none).
 */
export function rowsAfter(
  rows: readonly Enrolment[],
  slots: Readonly<Record<string, Slot>>,
): EnrolmentRow[] {
  const out: EnrolmentRow[] = [];
  for (const r of rows) {
    const slot = slots[r.serviceId];
    if (slot && latest(rows, r.serviceId) === r) continue;
    out.push(rowOf(r));
  }
  for (const [serviceId, slot] of Object.entries(slots))
    if (slot.on)
      out.push({ serviceId, activeFrom: slot.from, activeTo: slot.to === "" ? null : slot.to });
  return out;
}

const key = (r: EnrolmentRow) => `${r.serviceId}|${r.activeFrom}|${r.activeTo ?? ""}`;

/** Whether two lists say the same, whatever their order. */
export const sameRows = (a: readonly EnrolmentRow[], b: readonly EnrolmentRow[]): boolean =>
  a.length === b.length && [...a].map(key).sort().join("\n") === [...b].map(key).sort().join("\n");

/** The services a member takes on `date`, for the People table. */
export function takenOn(rows: readonly Enrolment[], date: string): string[] {
  return [
    ...new Set(
      rows
        .filter((r) => r.activeFrom <= date && (r.activeTo === null || date <= r.activeTo))
        .map((r) => r.serviceId),
    ),
  ];
}
