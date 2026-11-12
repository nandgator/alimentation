import type { CatalogueItem, MenuVersion, Service, Weekday } from "@alimentation/core";

/**
 * The menu editor's state: for each service, the meal on each weekday ("" is "not served"), and the items it
 * offers beyond those meals (the other meals one may switch to, and the add-ons).
 */
export interface Grid {
  cells: Record<string, Partial<Record<Weekday, string>>>;
  offered: Record<string, string[]>;
}

/** The editor's start: what the last menu said, for the services and items that are still offered. */
export function gridFrom(
  last: MenuVersion | null,
  services: readonly Service[],
  items: readonly CatalogueItem[],
): Grid {
  const live = new Set(items.map((i) => i.id));
  const cells: Grid["cells"] = {};
  const offered: Grid["offered"] = {};
  for (const sv of services) {
    cells[sv.id] = Object.fromEntries(
      Object.entries(last?.days[sv.id] ?? {}).filter(([, meal]) => live.has(meal)),
    ) as Partial<Record<Weekday, string>>;
    offered[sv.id] = (last?.offered[sv.id] ?? []).filter((id) => live.has(id));
  }
  return { cells, offered };
}

/** Sets one cell. An empty meal clears it, which is "not served". */
export function setCell(grid: Grid, serviceId: string, weekday: Weekday, mealId: string): Grid {
  const week = { ...grid.cells[serviceId] };
  if (mealId) week[weekday] = mealId;
  else delete week[weekday];
  return { ...grid, cells: { ...grid.cells, [serviceId]: week } };
}

/** Turns an item on or off in what a service offers. */
export function toggleOffered(grid: Grid, serviceId: string, itemId: string, on: boolean): Grid {
  const now = grid.offered[serviceId] ?? [];
  const next = on ? [...new Set([...now, itemId])] : now.filter((id) => id !== itemId);
  return { ...grid, offered: { ...grid.offered, [serviceId]: next } };
}

/** The meals a service serves on some day are always among what it offers: a switch away from them needs them there. */
export function offeredWith(grid: Grid, serviceId: string): string[] {
  const served = Object.values(grid.cells[serviceId] ?? {});
  return [...new Set([...served, ...(grid.offered[serviceId] ?? [])])];
}

/** The working days on which no service is served. A menu with any of these is refused. */
export function unservedDays(
  grid: Grid,
  serviceIds: readonly string[],
  working: readonly Weekday[],
): Weekday[] {
  return working.filter((d) => !serviceIds.some((sv) => grid.cells[sv]?.[d]));
}

/** The body of `POST /menus`: only the services shown and the days the kitchen cooks. */
export function menuBody(
  grid: Grid,
  serviceIds: readonly string[],
  working: readonly Weekday[],
  effectiveFrom: string,
  note: string,
) {
  const days: Record<string, Record<string, string>> = {};
  const offered: Record<string, string[]> = {};
  for (const sv of serviceIds) {
    const week = Object.fromEntries(
      working.flatMap((d) => {
        const meal = grid.cells[sv]?.[d];
        return meal ? [[String(d), meal] as const] : [];
      }),
    );
    if (Object.keys(week).length > 0) days[sv] = week;
    const ids = [...new Set([...Object.values(week), ...(grid.offered[sv] ?? [])])];
    if (ids.length > 0) offered[sv] = ids;
  }
  return { effectiveFrom, days, offered, note: note.trim() || null };
}
