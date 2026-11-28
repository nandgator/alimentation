import { useMemo } from "react";
import { useLocation } from "wouter";
import { useWorkspace, type Workspace } from "../pages/workspace/context.tsx";
import {
  hrefOf,
  isHere,
  labelFor,
  navFor,
  type Section,
  shown,
  titleFor,
  whereIs,
} from "../pages/workspace/sections.ts";

export interface Badge {
  /** Shown beside the entry. */
  text: string;
  /** Said after the count to a screen reader, unless the count says it all. */
  sr: string;
}

/** The count beside an entry: claims to confirm for the admin, what a consumer owes as "1 due". */
export function badgeFor(section: Section, ws: Workspace): Badge | null {
  if (section.key !== "payments") return null;
  if (ws.role === "admin") {
    const n = ws.boot.pendingClaims ?? 0;
    return n > 0 ? { text: String(n), sr: "to confirm" } : null;
  }
  if (ws.role === "consumer") {
    const due = ws.boot.statements.filter(
      (s) => s.personId === ws.boot.me.personId && "balance" in s && s.balance > 0,
    ).length;
    return due > 0 ? { text: `${due} due`, sr: "" } : null;
  }
  return null;
}

/** What the menus show for this kitchen and role, and where in it the person is. */
export function useShellNav() {
  const ws = useWorkspace();
  const [location] = useLocation();
  const priced = Boolean(ws.boot.rateCard);
  const nav = useMemo(() => navFor(ws.role, ws.money, priced), [ws.role, ws.money, priced]);
  const at = whereIs(ws.base, location);
  const activeKey = (s: Section) =>
    isHere(ws.base, s, location) ||
    (ws.role === "supplier" && s.key === "today" && at?.section.key === "home");
  /** The record named at the end of the address, such as a person's name. */
  const record = at?.rest
    ? (ws.boot.people.find((p) => p.id === at.rest?.split("/")[0])?.name ?? null)
    : null;
  // A screen this kitchen does not have (about money, in a kitchen without it) is a missing page, titled as one.
  const exists =
    !at || (shown(at.section, ws.money, priced) && (!at.tab || shown(at.tab, ws.money, priced)));
  const pageTitle =
    at && exists ? (record ? record : (at.tab?.label ?? titleFor(at.section, ws.role))) : null;
  return {
    ws,
    location,
    nav,
    at,
    record,
    pageTitle,
    priced,
    isActive: activeKey,
    href: (s: Section) => hrefOf(ws.base, s),
    label: (s: Section) => labelFor(s, ws.role),
    badge: (s: Section) => badgeFor(s, ws),
    /** A page below a screen, such as one person: it has a way back and no entry of its own. */
    detail: Boolean(at?.rest),
  };
}
