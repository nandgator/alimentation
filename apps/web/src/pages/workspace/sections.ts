import type { Role } from "@alimentation/core";
import {
  BookOpen,
  CalendarCheck,
  History,
  House,
  IndianRupee,
  type LucideIcon,
  ReceiptText,
  SlidersHorizontal,
  Users,
  UtensilsCrossed,
} from "lucide-react";

/**
 * Every screen of a kitchen, written down once: its address, its name, its icon, where it sits in the menu
 * of each role and who may open it. The menus, the routes and the "not for you" answer are all read from
 * here, so a screen cannot be in one and forgotten in another. (The server still decides what each role may
 * do; this only decides what is shown.)
 */
export type SectionKey =
  | "home"
  | "today"
  | "meals"
  | "payments"
  | "history"
  | "people"
  | "bills"
  | "setup"
  | "books";

/** The two screens that are a hub of tabs. */
export type HubKey = "setup" | "books";

export interface Section {
  key: SectionKey;
  /** After the kitchen's own address. Empty for the first screen. */
  path: string;
  label: string;
  icon: LucideIcon;
  /** Who may open it. */
  roles: readonly Role[];
  /** About money: a kitchen that does not track it has no such screen. */
  money?: true;
  /** Only worth opening once the kitchen has prices: before that there is nothing to pay or bill. */
  needsPrices?: true;
}

export interface Tab {
  key: string;
  hub: HubKey;
  /** After the hub's own address. */
  path: string;
  label: string;
  money?: true;
  needsPrices?: true;
}

/** What each role is called on screen. The API and the database keep `admin`, `supplier` and `consumer`. */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  supplier: "Cook",
  consumer: "Consumer",
};
const ROLE_PLURAL: Record<Role, string> = {
  admin: "admins",
  supplier: "cooks",
  consumer: "consumers",
};

const EVERYONE: readonly Role[] = ["admin", "supplier", "consumer"];
const ADMIN: readonly Role[] = ["admin"];

export const SECTIONS: readonly Section[] = [
  { key: "home", path: "", label: "Home", icon: House, roles: EVERYONE },
  {
    key: "today",
    path: "/today",
    label: "Today",
    icon: CalendarCheck,
    roles: ["admin", "supplier"],
  },
  { key: "meals", path: "/meals", label: "Meals", icon: UtensilsCrossed, roles: EVERYONE },
  {
    key: "payments",
    path: "/payments",
    label: "Payments",
    icon: IndianRupee,
    roles: EVERYONE,
    money: true,
    needsPrices: true,
  },
  {
    key: "history",
    path: "/history",
    label: "History",
    icon: History,
    roles: ["supplier", "consumer"],
  },
  { key: "people", path: "/people", label: "People", icon: Users, roles: ADMIN },
  {
    key: "bills",
    path: "/bills",
    label: "Bills",
    icon: ReceiptText,
    roles: ADMIN,
    money: true,
    needsPrices: true,
  },
  { key: "setup", path: "/setup", label: "Setup", icon: SlidersHorizontal, roles: ADMIN },
  { key: "books", path: "/books", label: "Books", icon: BookOpen, roles: ADMIN },
];

export const TABS: readonly Tab[] = [
  { key: "items", hub: "setup", path: "/items", label: "What you serve" },
  { key: "menu", hub: "setup", path: "/menu", label: "Menu" },
  { key: "prices", hub: "setup", path: "/prices", label: "Prices", money: true },
  { key: "rules", hub: "setup", path: "/rules", label: "Rules" },
  { key: "holidays", hub: "setup", path: "/holidays", label: "Holidays" },
  { key: "month-end", hub: "books", path: "/month-end", label: "Month end" },
  {
    key: "settlements",
    hub: "books",
    path: "/settlements",
    label: "Settlements",
    money: true,
    needsPrices: true,
  },
  { key: "older", hub: "books", path: "/older", label: "Older months" },
  { key: "audit", hub: "books", path: "/audit", label: "Audit" },
  { key: "data", hub: "books", path: "/data", label: "Your data" },
];

/** What a role has in the side menu, in order, and which of those sit in the bar on a phone. The rest go behind More. */
const NAV: Record<Role, { side: SectionKey[]; bar: SectionKey[] }> = {
  admin: {
    side: ["home", "today", "people", "payments", "bills", "setup", "books"],
    bar: ["home", "today", "payments", "people"],
  },
  supplier: {
    side: ["today", "meals", "payments", "history"],
    bar: ["today", "meals", "payments", "history"],
  },
  consumer: {
    side: ["home", "meals", "payments", "history"],
    bar: ["home", "meals", "payments", "history"],
  },
};

const shown = (
  s: { money?: true; needsPrices?: true },
  moneyEnabled: boolean,
  priced: boolean,
): boolean => (moneyEnabled || !s.money) && (priced || !moneyEnabled || !s.needsPrices);

/**
 * The screens a role may open in a kitchen: those of the role, and, for a kitchen that does not track money,
 * none that are about money, and, for one that tracks money but has no prices yet, none that need prices. A
 * screen that is left out is not in the menu and has no address.
 */
export const sectionsFor = (role: Role, moneyEnabled = true, priced = true): Section[] =>
  SECTIONS.filter((s) => s.roles.includes(role) && shown(s, moneyEnabled, priced));

/** The tabs of a hub that this kitchen has. */
export const tabsFor = (hub: HubKey, moneyEnabled = true, priced = true): Tab[] =>
  TABS.filter((t) => t.hub === hub && shown(t, moneyEnabled, priced));

/** The menus of a role: the side menu on a wide screen, and on a phone the bar and what sits behind More. */
export function navFor(
  role: Role,
  moneyEnabled = true,
  priced = true,
): { side: Section[]; bar: Section[]; more: Section[] } {
  const mine = sectionsFor(role, moneyEnabled, priced);
  const pick = (keys: SectionKey[]) =>
    keys.flatMap((k) => {
      const s = mine.find((m) => m.key === k);
      return s ? [s] : [];
    });
  const side = pick(NAV[role].side);
  const bar = pick(NAV[role].bar);
  return { side, bar, more: side.filter((s) => !bar.includes(s)) };
}

/** What a role calls a screen in the menu: consumers pay, the others take payments. */
export const labelFor = (section: Section, role: Role): string =>
  section.key === "payments" && role === "consumer" ? "Pay" : section.label;

/** What a role calls a screen at the top of its page. */
export const titleFor = (section: Section, role: Role): string =>
  section.key === "meals" && role === "consumer" ? "My meals" : labelFor(section, role);

/** The address a role starts at: a cook starts at Today. */
export const homeOf = (base: string, role: Role): string =>
  role === "supplier" ? `${base}/today` : base;

export const hrefOf = (base: string, section: Section) => `${base}${section.path}`;

/** Whether `location` is this screen (or something under it). */
export function isHere(base: string, section: Section, location: string): boolean {
  const href = hrefOf(base, section);
  if (section.path === "") return location === href || location === `${href}/`;
  return location === href || location.startsWith(`${href}/`);
}

/** The screen at an address, the tab of its hub and the part after, when there is one. */
export function whereIs(
  base: string,
  location: string,
): { section: Section; tab?: Tab; rest?: string } | null {
  const section = SECTIONS.find((s) => s.path !== "" && isHere(base, s, location));
  if (!section) {
    return location === base || location === `${base}/`
      ? { section: SECTIONS[0] as Section }
      : null;
  }
  const after = location.slice(hrefOf(base, section).length).replace(/^\/|\/$/g, "");
  if (section.key === "setup" || section.key === "books") {
    const tab = TABS.find((t) => t.hub === section.key && after.split("/")[0] === t.path.slice(1));
    return { section, tab };
  }
  return { section, rest: after || undefined };
}

/** Who a screen is open to, in words: "admins", "cooks and consumers". */
const WHO = (roles: readonly Role[]) =>
  roles.map((r) => ROLE_PLURAL[r]).join(roles.length > 2 ? ", " : " and ");

export interface Denial {
  title: string;
  reason: string;
}

/**
 * What to say at an address that has no screen for this role: "This is for admins" and who to ask when it
 * is a screen of another role, and "Page not found" when it is no screen of this kitchen at all (including
 * a screen about money in a kitchen that does not track it).
 */
export function denial(base: string, location: string, role: Role, adminName?: string): Denial {
  const other = SECTIONS.find((s) => s.path !== "" && isHere(base, s, location));
  if (other && !other.roles.includes(role)) {
    const who = WHO(other.roles);
    return {
      title: `This is for ${who}`,
      reason:
        role === "admin"
          ? `${other.label} is open to ${who}. Switch to that view to see it.`
          : `${other.label} is open to ${who}. Ask ${adminName ?? "your admin"} if you need it.`,
    };
  }
  return {
    title: "Page not found",
    reason: "That address does not lead anywhere in this kitchen.",
  };
}
