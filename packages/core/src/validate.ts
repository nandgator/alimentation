import {
  addDays,
  daysBetween,
  type IsoDate,
  isValidDate,
  isValidMonth,
  type LocalNow,
  type Month,
  monthEnd,
  monthOf,
  wallClock,
  weekdayOf,
} from "./dates.ts";
import { enrolledOn, isActiveOn, menuOn, type Prepared } from "./engine.ts";
import { MAX_ITEMS, MAX_SERVICES } from "./limits.ts";
import { MSG } from "./messages.ts";
import { isPaise } from "./money.ts";
import { autoCloseDate, policyForMonth, rateCardStartAllowed } from "./policy.ts";
import {
  type CatalogueItem,
  type Enrolment,
  LOG_ACTIONS,
  type LogEntry,
  type MenuVersion,
  PAY_METHODS,
  type PayMethod,
  type PriceLine,
  type Role,
  type Service,
} from "./types.ts";

/**
 * Rules for what may be written, shared by the server (which enforces them) and
 * the browser (which uses them for the live hint on the log form). A rule that
 * only the browser knew would not be a rule.
 */

export type IssueCode =
  | "NOT_A_DATE"
  | "NOT_WORKING_DAY"
  | "QTY_REQUIRED"
  | "QTY_RANGE"
  | "QTY_NOT_ALLOWED"
  | "UNKNOWN_CHANGE"
  | "UNKNOWN_SERVICE"
  | "UNKNOWN_ITEM"
  | "ITEM_KIND"
  | "ITEM_ARCHIVED"
  | "ITEM_NOT_OFFERED"
  | "SERVICE_NOT_SERVED"
  | "NOT_ENROLLED"
  | "OVERLAPPING_SCOPE"
  | "MENU_ORPHANS_LOG"
  | "ITEM_IN_USE"
  | "UNPRICED_ITEM"
  | "NAME_TAKEN"
  | "TOO_MANY"
  | "SHAPE"
  | "FOR_SELF_ONLY"
  | "ROLE_CANNOT"
  | "UNKNOWN_PERSON"
  | "NOT_A_CONSUMER"
  | "INACTIVE_ON_DATE"
  | "MONTH_CLOSED"
  | "CUTOFF_PASSED"
  | "LATE_ENTRY"
  | "DUPLICATE"
  | "HOLIDAY"
  | "CHANGES_AFTER_CLOSE"
  | "AMOUNT"
  | "METHOD"
  | "MONTH_RANGE"
  | "PAID_IN_FUTURE"
  | "CLAIMS_DISABLED"
  | "NO_SUCH_CLAIM"
  | "ALREADY_DECIDED"
  | "REASON_REQUIRED"
  | "NOT_DECIDED"
  | "ALREADY_VOID"
  | "ONLY_AUTHOR"
  | "BACKDATED_RATE_CARD"
  | "BACKDATED_MENU";

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface Actor {
  personId: string;
  role: Role;
}

export interface NewLogEntry {
  date: IsoDate;
  personId: string | null;
  allConsumers: boolean;
  action: LogEntry["action"];
  /** Null: the whole day (Leave and Supplier Off). Required for Switch and Extra. */
  serviceId: string | null;
  itemId: string | null;
  qty: number | null;
}

/** Each distinct issue once: a menu with a flaw on five weekdays has one flaw to report. */
const distinct = (issues: Issue[]): Issue[] =>
  issues.filter(
    (x, i) => issues.findIndex((y) => y.code === x.code && y.message === x.message) === i,
  );

const err = (code: IssueCode, message: string): Issue => ({ code, severity: "error", message });
const warn = (code: IssueCode, message: string): Issue => ({ code, severity: "warning", message });

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((i) => i.severity === "error");

/** Whether a consumer's month is closed, by a stored close or by an automatic rule that has run out. */
export function isMonthClosed(p: Prepared, consumerId: string, month: Month): boolean {
  const policy = policyForMonth(p.data.policies, month);
  if (policy.monthClose.mode === "off") return false;
  if (p.closeByKey.has(`${consumerId}|${month}`)) return true;
  const until = autoCloseDate(policy, month);
  // Stryker disable next-line ConditionalExpression: comparing a date with null is false
  return until !== null && p.data.today > until;
}

/** Whether any consumer's `month` is closed. A Supplier Off day touches all of them. */
function anyClosed(p: Prepared, month: Month): boolean {
  return p.data.people.some((x) => x.role === "consumer" && isMonthClosed(p, x.id, month));
}

/** A Supplier Off day touches every consumer; anything else touches one. */
function entryMonthClosed(
  p: Prepared,
  action: string,
  personId: string | null,
  month: Month,
): boolean {
  if (action === "Supplier Off") return anyClosed(p, month);
  return personId !== null && isMonthClosed(p, personId, month);
}

function closedIssue(p: Prepared, actor: Actor, month: Month, closed: boolean): Issue | null {
  if (!closed) return null;
  const policy = policyForMonth(p.data.policies, month);
  if (actor.role !== "admin") return err("MONTH_CLOSED", MSG.monthClosed);
  const mc = policy.monthClose;
  if ("afterClose" in mc && mc.afterClose === "block") {
    return err("MONTH_CLOSED", MSG.monthClosed2);
  }
  return warn("CHANGES_AFTER_CLOSE", MSG.changesAfterClose);
}

/** An item is out of use from its archive date on, that day included. */
const archivedOn = (x: { archivedOn: IsoDate | null }, date: IsoDate): boolean =>
  x.archivedOn !== null && x.archivedOn <= date;

/** The most one entry may ask for when the item is unknown: what the database allows. */
const QTY_CEILING = 99;

/** Everything wrong, or worth knowing, about a new log entry. */
export function checkLogEntry(p: Prepared, actor: Actor, e: NewLogEntry, now: LocalNow): Issue[] {
  const out: Issue[] = [];

  if (!(LOG_ACTIONS as readonly string[]).includes(e.action)) {
    return [err("UNKNOWN_CHANGE", MSG.unknownChange)];
  }
  if (!isValidDate(e.date)) return [err("NOT_A_DATE", MSG.notADate)];

  // Shape: Supplier Off is for everyone and for no one in particular; everything else is for one person.
  if (e.action === "Supplier Off") {
    if (!e.allConsumers || e.personId !== null) {
      out.push(err("SHAPE", MSG.shape));
    }
  } else if (e.allConsumers) {
    out.push(err("SHAPE", MSG.shape2));
  } else if (e.personId === null) {
    out.push(err("SHAPE", MSG.shape3));
  }

  const policy = policyForMonth(p.data.policies, monthOf(e.date));
  const menu = menuOn(p, e.date);
  const service = e.serviceId === null ? null : p.data.services.find((s) => s.id === e.serviceId);
  const item = e.itemId === null ? null : p.data.catalogue.find((i) => i.id === e.itemId);

  // Which service, and whether it is served and offered that day.
  if (service === undefined) out.push(err("UNKNOWN_SERVICE", MSG.unknownService));
  if (service && !servesOn(menu, service, e.date))
    out.push(err("SERVICE_NOT_SERVED", MSG.serviceNotServed));
  if (e.action === "Switch" || e.action === "Extra") {
    if (e.serviceId === null) out.push(err("SHAPE", MSG.shapeService));
    if (e.itemId === null) out.push(err("SHAPE", MSG.shapeItem));
  } else if (e.itemId !== null) {
    out.push(err("SHAPE", MSG.shapeNoItem));
  }
  if (item === undefined) out.push(err("UNKNOWN_ITEM", MSG.unknownItem));
  if (item) {
    const wanted = e.action === "Switch" ? "meal" : e.action === "Extra" ? "addon" : null;
    if (wanted !== null && item.kind !== wanted)
      out.push(err("ITEM_KIND", wanted === "meal" ? MSG.itemKindSwitch : MSG.itemKindExtra));
    if (archivedOn(item, e.date)) out.push(err("ITEM_ARCHIVED", MSG.itemArchived));
    else if (
      service &&
      (e.action === "Switch" || e.action === "Extra") &&
      !(menu?.offered[service.id] ?? []).includes(item.id)
    )
      out.push(err("ITEM_NOT_OFFERED", MSG.itemNotOffered));
  }

  if (e.action === "Extra") {
    const max = item ? item.maxQty : QTY_CEILING;
    if (e.qty === null) out.push(err("QTY_REQUIRED", MSG.qtyRequired));
    else if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > max)
      out.push(err("QTY_RANGE", MSG.qtyRange(max)));
  } else if (e.qty !== null) {
    out.push(err("QTY_NOT_ALLOWED", MSG.qtyNotAllowed));
  }

  // Who may log what.
  if (actor.role === "consumer") {
    if (e.action === "Supplier Off") out.push(err("ROLE_CANNOT", MSG.roleCannot));
    else if (e.personId !== actor.personId) out.push(err("FOR_SELF_ONLY", MSG.forSelfOnly));
  } else if (actor.role === "supplier") {
    if (e.action !== "Supplier Off") out.push(err("ROLE_CANNOT", MSG.roleCannot2));
  }

  if (!policy.workingDays.includes(weekdayOf(e.date))) {
    out.push(err("NOT_WORKING_DAY", MSG.notWorkingDay));
  }

  let person = null;
  if (e.personId !== null) {
    person = p.data.people.find((x) => x.id === e.personId) ?? null;
    if (!person) out.push(err("UNKNOWN_PERSON", MSG.unknownPerson));
    else if (person.role !== "consumer") out.push(err("NOT_A_CONSUMER", MSG.notAConsumer));
    else if (!isActiveOn(person, e.date)) out.push(err("INACTIVE_ON_DATE", MSG.inactiveOnDate));
    else if (service && !enrolledOn(p, person.id, service.id, e.date))
      out.push(err("NOT_ENROLLED", MSG.notEnrolled));
  }

  // Duplicates, and a whole day against one of its services. Supplier Off has no person, so two of them match.
  for (const x of p.data.log) {
    if (x.date !== e.date || x.action !== e.action || x.personId !== e.personId) continue;
    const sameScope = x.serviceId === e.serviceId;
    if (e.action === "Leave" || e.action === "Supplier Off") {
      if (sameScope) out.push(err("DUPLICATE", MSG.duplicate));
      else if (x.serviceId === null || e.serviceId === null)
        out.push(err("OVERLAPPING_SCOPE", MSG.overlappingScope));
    } else if (sameScope && (e.action === "Switch" || x.itemId === e.itemId)) {
      out.push(err("DUPLICATE", MSG.duplicate));
    }
  }

  // Holiday: harmless, so only a note.
  const month = monthOf(e.date);
  // Stryker disable next-line ArrayDeclaration: an empty fallback is never read as data
  const holiday = (p.holidaysByDate.get(e.date) ?? []).some(
    (h) => policy.holidays.count === "all" || h.confirmed,
  );
  if (holiday) out.push(warn("HOLIDAY", MSG.holiday));

  // Month closed.
  const closed = entryMonthClosed(p, e.action, e.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  // Cut-off applies to a consumer's own exceptions, never to the supplier or admin.
  if (actor.role === "consumer" && policy.exceptionCutoff && e.action !== "Supplier Off") {
    const deadline = wallClock(
      addDays(e.date, -policy.exceptionCutoff.daysBefore),
      policy.exceptionCutoff.time,
    );
    if (wallClock(now.date, now.time) >= deadline) {
      out.push(
        err(
          "CUTOFF_PASSED",
          MSG.cutoffPassedOn(
            e.date,
            policy.exceptionCutoff.time,
            policy.exceptionCutoff.daysBefore,
          ),
        ),
      );
    }
  }

  // After the fact is allowed, because people forget and people travel, but it is never quiet: the
  // entry carries the day it was really made (stamped by the database), and shows as late to
  // everyone who can see it. A kitchen that wants it refused sets a cut-off instead.
  if (e.date < now.date && !out.some((i) => i.code === "CUTOFF_PASSED"))
    out.push(warn("LATE_ENTRY", MSG.lateEntry));
  return out;
}

/** Whether the menu in force serves `service` on the weekday of `date`, and the service is not retired by then. */
function servesOn(menu: MenuVersion | null, service: Service, date: IsoDate): boolean {
  return (
    menu !== null &&
    !archivedOn(service, date) &&
    menu.days[service.id]?.[weekdayOf(date)] !== undefined
  );
}

/** Deleting or changing an entry already logged. */
export function checkLogChange(
  p: Prepared,
  actor: Actor,
  existing: LogEntry,
  now: LocalNow,
): Issue[] {
  const out: Issue[] = [];
  if (actor.role !== "admin" && existing.loggedBy !== actor.personId) {
    return [err("ONLY_AUTHOR", MSG.onlyAuthor)];
  }
  const month = monthOf(existing.date);
  const closed = entryMonthClosed(p, existing.action, existing.personId, month);
  const ci = closedIssue(p, actor, month, closed);
  if (ci) out.push(ci);

  const policy = policyForMonth(p.data.policies, month);
  if (actor.role === "consumer" && policy.exceptionCutoff) {
    const deadline = wallClock(
      addDays(existing.date, -policy.exceptionCutoff.daysBefore),
      policy.exceptionCutoff.time,
    );
    if (wallClock(now.date, now.time) >= deadline) out.push(err("CUTOFF_PASSED", MSG.cutoffPassed));
  }
  return out;
}

export interface NewClaim {
  consumerId: string;
  paidAt: IsoDate;
  forMonth: Month;
  amount: number;
  method: string;
}

export function checkClaim(p: Prepared, actor: Actor, c: NewClaim): Issue[] {
  const out: Issue[] = [];
  const policy = policyForMonth(p.data.policies, monthOf(p.data.today));
  if (actor.role === "supplier") return [err("ROLE_CANNOT", MSG.roleCannot3)];
  if (actor.role === "consumer" && policy.payments === "direct") {
    out.push(err("CLAIMS_DISABLED", MSG.claimsDisabled));
  }
  if (actor.role === "consumer" && c.consumerId !== actor.personId)
    out.push(err("FOR_SELF_ONLY", MSG.forSelfOnly2));

  const person = p.data.people.find((x) => x.id === c.consumerId);
  if (!person) out.push(err("UNKNOWN_PERSON", MSG.unknownPerson));
  else if (person.role !== "consumer") out.push(err("NOT_A_CONSUMER", MSG.notAConsumer2));

  if (!isPaise(c.amount) || c.amount <= 0) out.push(err("AMOUNT", MSG.amount));
  if (!(PAY_METHODS as readonly string[]).includes(c.method as PayMethod))
    out.push(err("METHOD", MSG.method));
  if (!isValidMonth(c.forMonth)) out.push(err("MONTH_RANGE", MSG.monthRange));
  else if (
    person?.activeFrom &&
    (c.forMonth < monthOf(person.activeFrom) || c.forMonth > monthOf(p.data.today))
  ) {
    out.push(err("MONTH_RANGE", MSG.monthRange2));
  }
  if (!isValidDate(c.paidAt)) out.push(err("NOT_A_DATE", MSG.notADate2));
  else if (c.paidAt > p.data.today) out.push(err("PAID_IN_FUTURE", MSG.paidInFuture));
  return out;
}

/** The supplier's one decision on a claim. The first decision is final. */
export function checkDecision(
  p: Prepared,
  actor: Actor,
  claimId: string,
  decision: string,
  note: string | null,
): Issue[] {
  if (actor.role !== "supplier") return [err("ROLE_CANNOT", MSG.roleCannot4)];
  if (!p.data.claims.some((c) => c.id === claimId)) return [err("NO_SUCH_CLAIM", MSG.noSuchClaim)];
  if (p.decisionByClaim.has(claimId)) return [err("ALREADY_DECIDED", MSG.alreadyDecided)];
  if (decision !== "Confirmed" && decision !== "Disputed") return [err("SHAPE", MSG.shape4)];
  if (decision === "Disputed" && (note === null || note.trim() === "")) {
    return [err("REASON_REQUIRED", MSG.reasonRequired)];
  }
  return [];
}

/** Only the admin can undo a decision, and says why. */
export function checkReversal(
  p: Prepared,
  actor: Actor,
  claimId: string,
  reason: string | null,
): Issue[] {
  if (actor.role !== "admin") return [err("ROLE_CANNOT", MSG.roleCannot5)];
  const d = p.decisionByClaim.get(claimId);
  if (!d) return [err("NOT_DECIDED", MSG.notDecided)];
  if (d.voided) return [err("ALREADY_VOID", MSG.alreadyVoid)];
  if (reason === null || reason.trim() === "") return [err("REASON_REQUIRED", MSG.reasonRequired2)];
  return [];
}

/** A claim can be withdrawn by its author until someone decides it. */
export function checkClaimWithdrawal(p: Prepared, actor: Actor, claimId: string): Issue[] {
  const c = p.data.claims.find((x) => x.id === claimId);
  if (!c) return [err("NO_SUCH_CLAIM", MSG.noSuchClaim)];
  if (actor.role !== "admin" && c.consumerId !== actor.personId)
    return [err("ONLY_AUTHOR", MSG.onlyAuthor2)];
  if (p.decisionByClaim.has(claimId)) return [err("ALREADY_DECIDED", MSG.alreadyDecided2)];
  return [];
}

/** The month of the latest close, or null when nothing has been closed. */
function lastClosedMonth(p: Prepared): Month | null {
  let last: Month | null = null;
  // Stryker disable next-line EqualityOperator: equal months give the same answer
  for (const c of p.data.closes) if (last === null || c.forMonth > last) last = c.forMonth;
  return last;
}

/** What a new menu says: the same as a stored one, less the id and note. */
export type NewMenu = Pick<MenuVersion, "effectiveFrom" | "days" | "offered">;

/** The first date the span that starts at `from` no longer covers: the next later start, or null for open-ended. */
function nextStart(starts: readonly IsoDate[], from: IsoDate): IsoDate | null {
  let next: IsoDate | null = null;
  for (const s of starts) if (s > from && (next === null || s < next)) next = s;
  return next;
}

/**
 * Whether a new menu may start on its `effectiveFrom`, serves every working weekday through at least one
 * service, refers only to services and items that exist (a meal that the service offers), and leaves valid
 * every entry already logged in the period it will be in force.
 */
export function checkMenu(p: Prepared, m: NewMenu): Issue[] {
  const out: Issue[] = [];
  if (!isValidDate(m.effectiveFrom)) return [err("NOT_A_DATE", MSG.notADate4)];
  const policy = policyForMonth(p.data.policies, monthOf(m.effectiveFrom));
  const served = (wd: number) =>
    Object.values(m.days).some((d) => (d as Partial<Record<number, string>>)[wd] !== undefined);
  for (const wd of policy.workingDays) {
    if (!served(wd)) {
      out.push(err("SERVICE_NOT_SERVED", MSG.noServiceForWorkingDay));
      break;
    }
  }

  for (const [serviceId, cells] of Object.entries(m.days)) {
    const service = p.data.services.find((s) => s.id === serviceId);
    if (!service) {
      out.push(err("UNKNOWN_SERVICE", MSG.unknownService));
      continue;
    }
    if (archivedOn(service, m.effectiveFrom))
      out.push(err("SERVICE_NOT_SERVED", MSG.menuServiceArchived));
    for (const mealId of Object.values(cells)) {
      const meal = p.data.catalogue.find((i) => i.id === mealId);
      if (!meal) out.push(err("UNKNOWN_ITEM", MSG.unknownItem));
      else if (meal.kind !== "meal") out.push(err("ITEM_KIND", MSG.itemKindSwitch));
      else if (!(m.offered[serviceId] ?? []).includes(mealId))
        out.push(err("ITEM_NOT_OFFERED", MSG.menuMealNotOffered));
    }
  }
  for (const [serviceId, ids] of Object.entries(m.offered)) {
    if (!p.data.services.some((s) => s.id === serviceId))
      out.push(err("UNKNOWN_SERVICE", MSG.unknownService));
    for (const id of ids) {
      const it = p.data.catalogue.find((i) => i.id === id);
      if (!it) out.push(err("UNKNOWN_ITEM", MSG.unknownItem));
      else if (archivedOn(it, m.effectiveFrom)) out.push(err("ITEM_ARCHIVED", MSG.itemArchived));
    }
  }

  if (p.menus.some((x) => x.effectiveFrom === m.effectiveFrom)) {
    out.push(err("DUPLICATE", MSG.duplicateMenu));
  }
  // The first menu serves nothing that was served before, so it may start whenever; a later one may not
  // reach back into a month that has been closed, which would change what that month's counts say.
  const closed = lastClosedMonth(p);
  if (p.menus.length > 0 && closed !== null && monthOf(m.effectiveFrom) <= closed) {
    out.push(err("BACKDATED_MENU", MSG.backdatedMenu));
  }

  // The new menu governs from its start until the next menu's. An entry in that period must still be
  // something the menu serves and offers, or the log would hold a choice nobody can make.
  const end = nextStart(
    p.menus.map((x) => x.effectiveFrom),
    m.effectiveFrom,
  );
  const orphan = p.data.log.some((x) => {
    if (x.date < m.effectiveFrom || (end !== null && x.date >= end) || x.serviceId === null)
      return false;
    if (m.days[x.serviceId]?.[weekdayOf(x.date)] === undefined) return true;
    return x.itemId !== null && !(m.offered[x.serviceId] ?? []).includes(x.itemId);
  });
  if (orphan) out.push(err("MENU_ORPHANS_LOG", MSG.menuOrphansLog));
  return distinct(out);
}

/** What a new rate card says: the same as a stored one, less the id and note. */
export interface NewRateCard {
  effectiveFrom: IsoDate;
  prices: readonly PriceLine[];
  monthlyFee: number;
}

/**
 * Whether a new rate card may start on its `effectiveFrom`, refers only to services and items that exist,
 * prices nothing twice, and (in a kitchen that tracks money) prices every item that a menu in force during
 * the card's period offers. What is served is `checkMenu`.
 */
export function checkRateCard(p: Prepared, c: NewRateCard): Issue[] {
  const out: Issue[] = [];
  if (!isValidDate(c.effectiveFrom)) return [err("NOT_A_DATE", MSG.notADate3)];
  const policy = policyForMonth(p.data.policies, monthOf(c.effectiveFrom));
  if (p.cards.some((x) => x.effectiveFrom === c.effectiveFrom)) {
    out.push(err("DUPLICATE", MSG.duplicate2));
  }
  // The first card prices nothing that was priced before, so it may start whenever.
  if (
    p.cards.length > 0 &&
    !rateCardStartAllowed(policy, c.effectiveFrom, p.data.today, lastClosedMonth(p))
  ) {
    out.push(err("BACKDATED_RATE_CARD", MSG.backdatedRateCard));
  }

  if (!isPaise(c.monthlyFee) || c.monthlyFee < 0) out.push(err("AMOUNT", MSG.amountPrice));
  const seen = new Set<string>();
  for (const line of c.prices) {
    if (!p.data.catalogue.some((i) => i.id === line.itemId))
      out.push(err("UNKNOWN_ITEM", MSG.unknownItem));
    if (line.serviceId !== null && !p.data.services.some((s) => s.id === line.serviceId))
      out.push(err("UNKNOWN_SERVICE", MSG.unknownService));
    if (!isPaise(line.amount) || line.amount < 0) out.push(err("AMOUNT", MSG.amountPrice));
    const key = `${line.itemId}|${line.serviceId ?? ""}`;
    if (seen.has(key)) out.push(err("DUPLICATE", MSG.duplicateLine));
    seen.add(key);
  }

  if (p.data.moneyEnabled) {
    const cardEnd = nextStart(
      p.cards.map((x) => x.effectiveFrom),
      c.effectiveFrom,
    );
    const starts = p.menus.map((x) => x.effectiveFrom);
    const unpriced = new Set<string>();
    for (const m of p.menus) {
      const mEnd = nextStart(starts, m.effectiveFrom);
      if (
        (cardEnd !== null && m.effectiveFrom >= cardEnd) ||
        (mEnd !== null && mEnd <= c.effectiveFrom)
      )
        continue;
      for (const [serviceId, ids] of Object.entries(m.offered))
        for (const id of ids)
          if (
            !c.prices.some(
              (l) => l.itemId === id && (l.serviceId === null || l.serviceId === serviceId),
            )
          )
            unpriced.add(id);
    }
    const names = p.data.catalogue.filter((i) => unpriced.has(i.id)).map((i) => i.name);
    if (names.length > 0) out.push(err("UNPRICED_ITEM", MSG.unpricedItems(names)));
  }
  return distinct(out);
}

const nameClash = (names: readonly string[], name: string, exceptIndex: number): boolean =>
  names.some((n, i) => i !== exceptIndex && n.toLowerCase() === name.trim().toLowerCase());

/** A new catalogue item, or a change to one: a rename, and retiring it from a date (once). */
export type CatalogueChange =
  | { id: null; kind: string; name: string; unit: string; maxQty: number }
  | { id: string; name?: string; archiveOn?: IsoDate };

/** Whether an item may be added, renamed or retired. Only the admin may, and a retired item keeps its name. */
export function checkCatalogueItem(p: Prepared, actor: Actor, change: CatalogueChange): Issue[] {
  if (actor.role !== "admin") return [err("ROLE_CANNOT", MSG.roleCannot6)];
  const out: Issue[] = [];
  const items: readonly CatalogueItem[] = p.data.catalogue;
  const names = items.map((i) => i.name);
  const badName = (name: string) => name.trim().length < 1 || name.trim().length > 60;

  if (change.id === null) {
    if (change.kind !== "meal" && change.kind !== "addon") out.push(err("ITEM_KIND", MSG.itemKind));
    if (badName(change.name)) out.push(err("SHAPE", MSG.nameLength(60)));
    else if (nameClash(names, change.name, -1)) out.push(err("NAME_TAKEN", MSG.nameTaken));
    if (change.unit.trim().length < 1 || change.unit.trim().length > 20)
      out.push(err("SHAPE", MSG.unitLength));
    if (!Number.isInteger(change.maxQty) || change.maxQty < 1 || change.maxQty > QTY_CEILING)
      out.push(err("QTY_RANGE", MSG.qtyRange(QTY_CEILING)));
    if (items.length >= MAX_ITEMS) out.push(err("TOO_MANY", MSG.tooMany("items", MAX_ITEMS)));
    return out;
  }

  const idx = items.findIndex((i) => i.id === change.id);
  const item = items[idx];
  if (!item) return [err("UNKNOWN_ITEM", MSG.unknownItem)];
  if (change.name === undefined && change.archiveOn === undefined)
    return [err("SHAPE", MSG.nothingChanged)];
  if (change.name !== undefined) {
    if (badName(change.name)) out.push(err("SHAPE", MSG.nameLength(60)));
    else if (nameClash(names, change.name, idx)) out.push(err("NAME_TAKEN", MSG.nameTaken));
  }
  if (change.archiveOn !== undefined) {
    if (!isValidDate(change.archiveOn)) out.push(err("NOT_A_DATE", MSG.notADate));
    else if (item.archivedOn !== null) out.push(err("ITEM_ARCHIVED", MSG.alreadyArchived));
    else if (
      inUseFrom(p, change.archiveOn, (m) =>
        Object.values(m.offered).some((ids) => ids.includes(item.id)),
      )
    )
      out.push(err("ITEM_IN_USE", MSG.itemInUse));
  }
  return out;
}

/** Whether the menu in force on `from`, or any menu starting after it, satisfies `uses`. */
function inUseFrom(p: Prepared, from: IsoDate, uses: (m: MenuVersion) => boolean): boolean {
  const inForce = menuOn(p, from);
  return p.menus.some((m) => (m === inForce || m.effectiveFrom > from) && uses(m));
}

/** A new service, or a change to one: a rename, and retiring it from a date (once). */
export type ServiceChange =
  | { id: null; name: string }
  | { id: string; name?: string; archiveOn?: IsoDate };

/** Whether a service may be added, renamed or retired. Only the admin may. */
export function checkService(p: Prepared, actor: Actor, change: ServiceChange): Issue[] {
  if (actor.role !== "admin") return [err("ROLE_CANNOT", MSG.roleCannot6)];
  const out: Issue[] = [];
  const services: readonly Service[] = p.data.services;
  const names = services.map((s) => s.name);
  const badName = (name: string) => name.trim().length < 1 || name.trim().length > 40;

  if (change.id === null) {
    if (badName(change.name)) out.push(err("SHAPE", MSG.nameLength(40)));
    else if (nameClash(names, change.name, -1)) out.push(err("NAME_TAKEN", MSG.nameTaken));
    if (services.length >= MAX_SERVICES)
      out.push(err("TOO_MANY", MSG.tooMany("services", MAX_SERVICES)));
    return out;
  }

  const idx = services.findIndex((s) => s.id === change.id);
  const service = services[idx];
  if (!service) return [err("UNKNOWN_SERVICE", MSG.unknownService)];
  if (change.name === undefined && change.archiveOn === undefined)
    return [err("SHAPE", MSG.nothingChanged)];
  if (change.name !== undefined) {
    if (badName(change.name)) out.push(err("SHAPE", MSG.nameLength(40)));
    else if (nameClash(names, change.name, idx)) out.push(err("NAME_TAKEN", MSG.nameTaken));
  }
  if (change.archiveOn !== undefined) {
    if (!isValidDate(change.archiveOn)) out.push(err("NOT_A_DATE", MSG.notADate));
    else if (service.archivedOn !== null) out.push(err("SERVICE_NOT_SERVED", MSG.alreadyArchived));
    else if (inUseFrom(p, change.archiveOn, (m) => service.id in m.days || service.id in m.offered))
      out.push(err("ITEM_IN_USE", MSG.serviceInUse));
  }
  return out;
}

const overlaps = (a: Enrolment, b: Enrolment): boolean =>
  a.serviceId === b.serviceId &&
  a.activeFrom <= (b.activeTo ?? "9999-12-31") &&
  b.activeFrom <= (a.activeTo ?? "9999-12-31");

/**
 * Whether `rows` may replace the services a consumer takes. Rows are dated, both ends included; a person
 * takes a service once at a time. A row added, removed or changed that touches a closed month is judged
 * like a log entry in that month.
 */
export function checkEnrolment(
  p: Prepared,
  actor: Actor,
  personId: string,
  rows: readonly Omit<Enrolment, "personId">[],
): Issue[] {
  if (actor.role !== "admin") return [err("ROLE_CANNOT", MSG.roleCannot6)];
  const person = p.data.people.find((x) => x.id === personId);
  if (!person) return [err("UNKNOWN_PERSON", MSG.unknownPerson)];
  if (person.role !== "consumer") return [err("NOT_A_CONSUMER", MSG.notAConsumer)];

  const out: Issue[] = [];
  const next: Enrolment[] = rows.map((r) => ({ ...r, personId }));
  for (const r of next) {
    if (!p.data.services.some((s) => s.id === r.serviceId))
      out.push(err("UNKNOWN_SERVICE", MSG.unknownService));
    if (!isValidDate(r.activeFrom) || (r.activeTo !== null && !isValidDate(r.activeTo)))
      out.push(err("NOT_A_DATE", MSG.notADate));
    else if (r.activeTo !== null && r.activeTo < r.activeFrom) out.push(err("SHAPE", MSG.badSpan));
  }
  if (hasErrors(out)) return out;
  if (next.some((a, i) => next.some((b, j) => i < j && overlaps(a, b))))
    return [err("DUPLICATE", MSG.overlappingEnrolment)];

  // Months in which what the person takes differs between the old rows and the new, service by service.
  const before = p.data.enrolments.filter((e) => e.personId === personId);
  const same = (a: Enrolment, b: Enrolment) =>
    a.serviceId === b.serviceId && a.activeFrom === b.activeFrom && a.activeTo === b.activeTo;
  const changed = [
    ...before.filter((b) => !next.some((n) => same(n, b))),
    ...next.filter((n) => !before.some((b) => same(n, b))),
  ];
  const months = new Set<Month>();
  if (changed.length > 0) {
    const last = [lastClosedMonth(p), monthOf(p.data.today)].reduce<Month>(
      (a, b) => (b !== null && b > a ? b : a),
      monthOf(p.data.today),
    );
    const start = changed.map((r) => r.activeFrom).sort()[0] as IsoDate;
    const takes = (list: readonly Enrolment[], serviceId: string, day: IsoDate) =>
      list.some(
        (r) =>
          r.serviceId === serviceId &&
          r.activeFrom <= day &&
          (r.activeTo === null || day <= r.activeTo),
      );
    const serviceIds = new Set(changed.map((r) => r.serviceId));
    for (const day of daysBetween(start, monthEnd(last)))
      for (const sv of serviceIds)
        if (takes(before, sv, day) !== takes(next, sv, day)) months.add(monthOf(day));
  }
  for (const mo of [...months].sort()) {
    const ci = closedIssue(p, actor, mo, isMonthClosed(p, personId, mo));
    if (ci && !out.some((i) => i.code === ci.code)) out.push(ci);
  }
  return out;
}
