import type { Role } from "@alimentation/core";

/**
 * Every screen of a kitchen, written down once: its address, its name, where it sits in the menu and
 * who may open it. The menu, the routes and the "not for your role" answer are all read from this
 * list, so a screen cannot be in one and forgotten in another. (The server still decides what each
 * role may do; this only decides what is shown.)
 */
export type SectionKey =
  | "dashboard"
  | "daily"
  | "log"
  | "payments"
  | "history"
  | "people"
  | "catalogue"
  | "menu"
  | "prices"
  | "rates"
  | "holidays"
  | "settlements"
  | "close"
  | "audit"
  | "data";

export type GroupKey = "day" | "kitchen" | "books";

export interface Section {
  key: SectionKey;
  /** After the kitchen's own address. Empty for the first screen. */
  path: string;
  label: string;
  group: GroupKey;
  roles: readonly Role[];
  /** About money: a kitchen that does not track it has no such screen. */
  money?: true;
  /** What it is called in a kitchen that does not track money, where that differs. */
  labelWithoutMoney?: string;
}

export const GROUP_LABEL: Record<GroupKey, string> = {
  day: "Day to day",
  kitchen: "The kitchen",
  books: "The books",
};

const EVERYONE: readonly Role[] = ["admin", "supplier", "consumer"];
const ADMIN: readonly Role[] = ["admin"];

export const SECTIONS: readonly Section[] = [
  { key: "dashboard", path: "", label: "Dashboard", group: "day", roles: EVERYONE },
  { key: "daily", path: "/daily", label: "Daily", group: "day", roles: EVERYONE },
  { key: "log", path: "/log", label: "My log", group: "day", roles: EVERYONE },
  {
    key: "payments",
    path: "/payments",
    label: "Payments",
    group: "day",
    roles: EVERYONE,
    money: true,
  },
  {
    key: "history",
    path: "/history",
    label: "History",
    group: "day",
    roles: ["supplier", "consumer"],
  },
  { key: "people", path: "/people", label: "People", group: "kitchen", roles: ADMIN },
  {
    key: "catalogue",
    path: "/catalogue",
    label: "Catalogue",
    group: "kitchen",
    roles: ADMIN,
  },
  { key: "menu", path: "/menu", label: "Menu", group: "kitchen", roles: ADMIN },
  { key: "prices", path: "/prices", label: "Prices", group: "kitchen", roles: ADMIN, money: true },
  {
    key: "rates",
    path: "/rates",
    label: "Rates & rules",
    labelWithoutMoney: "Rules",
    group: "kitchen",
    roles: ADMIN,
  },
  { key: "holidays", path: "/holidays", label: "Holidays", group: "kitchen", roles: ADMIN },
  {
    key: "settlements",
    path: "/settlements",
    label: "Settlements",
    group: "books",
    roles: ADMIN,
    money: true,
  },
  { key: "close", path: "/close", label: "Month close", group: "books", roles: ADMIN },
  { key: "audit", path: "/audit", label: "Audit", group: "books", roles: ADMIN },
  { key: "data", path: "/data", label: "Your data", group: "books", roles: ADMIN },
];

/**
 * The screens a role has in a kitchen: those of the role, and, for a kitchen that does not track money, none
 * that are about money. A screen that is left out is not in the menu and has no address.
 */
/** The same screens as a kitchen without money names them. Made once, so a screen is the same object each time. */
const PLAIN: readonly Section[] = SECTIONS.map((s) =>
  s.labelWithoutMoney ? { ...s, label: s.labelWithoutMoney } : s,
);

export const sectionsFor = (role: Role, moneyEnabled = true): Section[] =>
  (moneyEnabled ? SECTIONS : PLAIN).filter(
    (s) => s.roles.includes(role) && (moneyEnabled || !s.money),
  );

/** The menu for a role, in groups; a group with nothing in it for that role is left out. */
export function groupsFor(
  role: Role,
  moneyEnabled = true,
): { key: GroupKey; label: string; sections: Section[] }[] {
  const mine = sectionsFor(role, moneyEnabled);
  return (Object.keys(GROUP_LABEL) as GroupKey[])
    .map((key) => ({
      key,
      label: GROUP_LABEL[key],
      sections: mine.filter((s) => s.group === key),
    }))
    .filter((g) => g.sections.length > 0);
}

export const hrefOf = (base: string, section: Section) => `${base}${section.path}`;

/** Whether `location` is this screen (or something under it). */
export function isHere(base: string, section: Section, location: string): boolean {
  const href = hrefOf(base, section);
  if (section.path === "") return location === href || location === `${href}/`;
  return location === href || location.startsWith(`${href}/`);
}
