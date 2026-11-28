import type { PersonDto, Role } from "@alimentation/core";

/** The order a person's roles are shown in, and the order their rows are tried as the main one. */
const ROLE_ORDER: readonly Role[] = ["admin", "supplier", "consumer"];

/**
 * One human being in the kitchen. The server keeps a row for each role a person holds, so an owner who is also the cook
 * is two rows with the same name. The screen shows them once (DAT-09), with a badge for each role.
 */
export interface Member {
  /** The id of the main row, which the person's page is at. */
  id: string;
  main: PersonDto;
  /** Every row behind this person, the main one first. An edit to the name or the contact goes to all of them. */
  rows: PersonDto[];
  roles: Role[];
}

const rank = (r: Role) => ROLE_ORDER.indexOf(r);

/**
 * Joins the rows that are one person. Two rows are one person only when both are signed in, are not told apart by a
 * key, are in the same state and have the same name (the owner who also cooks); anyone else stays as they are, so two
 * people who share a name are never merged by mistake.
 */
export function groupPeople(people: readonly PersonDto[]): Member[] {
  const byName = new Map<string, PersonDto[]>();
  const alone: PersonDto[] = [];
  for (const p of people) {
    if (!p.linked || p.externalKey) {
      alone.push(p);
      continue;
    }
    const k = `${p.status}|${p.name.trim().toLowerCase()}`;
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const groups: PersonDto[][] = [...alone.map((p) => [p])];
  for (const same of byName.values()) {
    // Only rows with different roles are one person; a second row with the same role is someone else.
    const taken = new Set<Role>();
    const merged: PersonDto[] = [];
    for (const p of [...same].sort((a, b) => rank(a.role) - rank(b.role))) {
      if (taken.has(p.role)) groups.push([p]);
      else {
        taken.add(p.role);
        merged.push(p);
      }
    }
    if (merged.length > 0) groups.push(merged);
  }
  return groups
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => rank(a.role) - rank(b.role));
      const main = sorted[0] as PersonDto;
      return { id: main.id, main, rows: sorted, roles: sorted.map((r) => r.role) };
    })
    .sort((a, b) => a.main.name.localeCompare(b.main.name, undefined, { sensitivity: "base" }));
}

/** What the filter chips offer. `all` is everyone who is not disabled. */
export type Show = "all" | "consumer" | "supplier" | "admin" | "disabled";
export const SHOWS: readonly Show[] = ["all", "consumer", "supplier", "admin", "disabled"];
export const isShow = (v: string): v is Show => (SHOWS as readonly string[]).includes(v);

export const isDisabled = (m: Member) => m.main.status === "DISABLED";

/** Disabled people are hidden unless asked for (DAT-09). */
export function visibleMembers(members: readonly Member[], show: Show): Member[] {
  if (show === "disabled") return members.filter(isDisabled);
  const live = members.filter((m) => !isDisabled(m));
  if (show === "all") return live;
  return live.filter((m) => m.roles.includes(show));
}

/** How many each chip would show, for its count. */
export function showCounts(members: readonly Member[]): Record<Show, number> {
  return Object.fromEntries(SHOWS.map((s) => [s, visibleMembers(members, s).length])) as Record<
    Show,
    number
  >;
}

/** The second line under a name: the kitchen's own key, then the contact. */
export const detailLine = (p: PersonDto): string =>
  [p.externalKey, p.contact].filter((x): x is string => !!x).join(" · ");

/** A person can be invited while they are active and nobody has signed in as them. */
export const canInvite = (m: Member): boolean =>
  m.rows.some((r) => !r.linked && r.status === "ACTIVE");
