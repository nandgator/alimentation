import {
  type CatalogueItem,
  type Claim,
  type Decision,
  dueAutoCloses,
  type EngineData,
  type Enrolment,
  type Holiday,
  type LogEntry,
  type MenuVersion,
  type MonthClose,
  type Person,
  type PolicyVersion,
  prepare,
  type RateCard,
  type Role,
  type Service,
  type Settlement,
} from "@alimentation/core";
import type { FieldCipher } from "../crypto/fields.ts";
import type { Tx } from "../db/driver.ts";

/**
 * Reads everything the engine needs, under the caller's row-level security, so
 * what comes back is exactly what that person may see. A consumer's load holds
 * their own rows and nobody else's; their statement is computed from those.
 * Notes are not read: the engine does not use them and decrypting thousands of
 * them for a statement would be wasted work.
 */

// biome-ignore lint/suspicious/noExplicitAny: rows come back from the driver as untyped JSON
type R = Record<string, any>;

const month = (d: string) => d.slice(0, 7);
const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const catalogueItemFromRow = (r: R): CatalogueItem => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  unit: r.unit,
  maxQty: r.max_qty,
  archivedOn: r.archived_on ?? null,
});

export const serviceFromRow = (r: R): Service => ({
  id: r.id,
  name: r.name,
  position: r.position,
  archivedOn: r.archived_on ?? null,
});

export const enrolmentFromRow = (r: R): Enrolment => ({
  personId: r.person_id,
  serviceId: r.service_id,
  activeFrom: r.active_from,
  activeTo: r.active_to ?? null,
});

/** A rate card and its price lines, in a stable order: the same rows give the same card wherever they sit. */
export function rateCardFromRows(r: R, prices: R[]): RateCard {
  return {
    id: r.id,
    effectiveFrom: r.effective_from,
    prices: prices
      .filter((l) => l.card_id === r.id)
      .map((l) => ({
        itemId: l.item_id as string,
        serviceId: (l.service_id as string | null) ?? null,
        amount: l.amount as number,
      }))
      .sort((a, b) => (a.itemId + (a.serviceId ?? "") < b.itemId + (b.serviceId ?? "") ? -1 : 1)),
    monthlyFee: r.monthly_fee,
    note: r.note ?? null,
  };
}

/** A menu with what each service offers and the meal it serves on each weekday. */
export function menuFromRows(r: R, offers: R[], days: R[]): MenuVersion {
  const offered: Record<string, string[]> = {};
  for (const o of offers.filter((x) => x.menu_id === r.id)) {
    const list = offered[o.service_id] ?? [];
    list.push(o.item_id);
    offered[o.service_id] = list;
  }
  for (const ids of Object.values(offered)) ids.sort();
  const served: Record<string, Record<number, string>> = {};
  for (const d of days.filter((x) => x.menu_id === r.id)) {
    const week = served[d.service_id] ?? {};
    week[d.weekday] = d.meal_id;
    served[d.service_id] = week;
  }
  return {
    id: r.id,
    effectiveFrom: r.effective_from,
    days: served,
    offered,
    note: r.note ?? null,
  };
}

export const loadCatalogue = async (tx: Tx): Promise<CatalogueItem[]> =>
  (await tx.query<R>("SELECT id, kind, name, unit, max_qty, archived_on FROM catalogue_item"))
    .map(catalogueItemFromRow)
    .sort(byId);

export const loadServices = async (tx: Tx): Promise<Service[]> =>
  (await tx.query<R>("SELECT id, name, position, archived_on FROM service"))
    .map(serviceFromRow)
    .sort((a, b) => a.position - b.position || byId(a, b));

export async function loadEnrolments(tx: Tx): Promise<Enrolment[]> {
  const rows = await tx.query<R>(
    "SELECT person_id, service_id, active_from, active_to FROM person_service",
  );
  return rows
    .map(enrolmentFromRow)
    .sort((a, b) =>
      `${a.personId}|${a.serviceId}|${a.activeFrom}` <
      `${b.personId}|${b.serviceId}|${b.activeFrom}`
        ? -1
        : 1,
    );
}

export async function loadMenus(tx: Tx): Promise<MenuVersion[]> {
  const [menus, offers, days] = await Promise.all([
    tx.query<R>("SELECT id, effective_from, note FROM menu ORDER BY effective_from"),
    tx.query<R>("SELECT menu_id, service_id, item_id FROM menu_offer"),
    tx.query<R>("SELECT menu_id, service_id, weekday, meal_id FROM menu_day"),
  ]);
  return menus.map((m) => menuFromRows(m, offers, days));
}

/** Rate cards with their prices. A kitchen without money has none, and its prices table is never read. */
export async function loadRateCards(tx: Tx): Promise<RateCard[]> {
  const [cards, prices] = await Promise.all([
    tx.query<R>(
      "SELECT id, effective_from, monthly_fee, note FROM rate_card ORDER BY effective_from",
    ),
    tx.query<R>("SELECT card_id, item_id, service_id, amount FROM rate_price"),
  ]);
  return cards.map((c) => rateCardFromRows(c, prices));
}

export async function loadEngineData(
  tx: Tx,
  cipher: FieldCipher,
  today: string,
): Promise<EngineData> {
  // The kitchen says it itself, so what is read is what the database will hold. A kitchen without money
  // has no prices, claims or settlements to read, and none is asked for.
  const [flag] = await tx.query<R>("SELECT money_enabled() AS on");
  const moneyEnabled = flag?.on !== false;
  const none = Promise.resolve<R[]>([]);
  const [
    people,
    policies,
    catalogue,
    services,
    enrolments,
    menus,
    cards,
    holidays,
    log,
    claims,
    decisions,
    settlements,
    closes,
  ] = await Promise.all([
    tx.query<R>("SELECT id, role, name_enc, active_from, active_to FROM person"),
    tx.query<R>("SELECT effective_from, doc FROM policy_version"),
    loadCatalogue(tx),
    loadServices(tx),
    loadEnrolments(tx),
    loadMenus(tx),
    moneyEnabled ? loadRateCards(tx) : Promise.resolve<RateCard[]>([]),
    tx.query<R>("SELECT id, name, on_date, location, confirmed FROM holiday"),
    tx.query<R>(
      "SELECT id, on_date, person_id, all_consumers, action, service_id, item_id, qty, logged_by, logged_at FROM log_entry",
    ),
    moneyEnabled
      ? tx.query<R>(
          "SELECT id, consumer_id, paid_at, for_month, amount, method, created_at FROM claim",
        )
      : none,
    moneyEnabled
      ? tx.query<R>(
          `SELECT d.claim_id, d.decision, d.decided_by, d.decided_at, (r.claim_id IS NOT NULL) AS voided
         FROM claim_decision d LEFT JOIN claim_reversal r ON r.claim_id = d.claim_id`,
        )
      : none,
    moneyEnabled
      ? tx.query<R>(
          "SELECT id, on_date, consumer_id, for_month, type, amount, recorded_by, created_at FROM settlement",
        )
      : none,
    tx.query<R>(
      "SELECT for_month, consumer_id, meals, billed, closed_on, closed_by FROM month_close",
    ),
  ]);

  const names = await Promise.all(
    people.map((p) => cipher.dec("person", "name_enc", p.id, p.name_enc)),
  );

  return {
    today,
    moneyEnabled,
    policies: policies.map((p): PolicyVersion => ({ effectiveFrom: p.effective_from, doc: p.doc })),
    catalogue,
    services,
    enrolments,
    menus,
    rateCards: cards,
    holidays: holidays.map(
      (h): Holiday => ({
        id: h.id,
        name: h.name,
        date: h.on_date,
        location: h.location ?? null,
        confirmed: h.confirmed,
      }),
    ),
    // The same order wherever the rows sit, so a copy lists people as the original did.
    people: people
      .map(
        (p, i): Person => ({
          id: p.id,
          name: names[i] ?? "",
          role: p.role as Role,
          activeFrom: p.active_from ?? null,
          activeTo: p.active_to ?? null,
        }),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1),
      ),
    log: log.map(
      (e): LogEntry => ({
        id: e.id,
        date: e.on_date,
        personId: e.person_id ?? null,
        allConsumers: e.all_consumers,
        action: e.action,
        serviceId: e.service_id ?? null,
        itemId: e.item_id ?? null,
        qty: e.qty ?? null,
        note: null,
        loggedBy: e.logged_by,
        loggedAt: e.logged_at,
      }),
    ),
    claims: claims.map(
      (c): Claim => ({
        id: c.id,
        consumerId: c.consumer_id,
        paidAt: c.paid_at,
        forMonth: month(c.for_month),
        amount: c.amount,
        method: c.method,
        refNote: null,
        createdAt: c.created_at,
      }),
    ),
    decisions: decisions.map(
      (d): Decision => ({
        claimId: d.claim_id,
        decision: d.decision,
        note: null,
        decidedBy: d.decided_by,
        decidedAt: d.decided_at,
        voided: d.voided,
      }),
    ),
    settlements: settlements.map(
      (s): Settlement => ({
        id: s.id,
        date: s.on_date,
        consumerId: s.consumer_id,
        forMonth: month(s.for_month),
        type: s.type,
        amount: s.amount ?? null,
        note: null,
        recordedBy: s.recorded_by,
        createdAt: s.created_at,
      }),
    ),
    closes: closes.map(
      (c): MonthClose => ({
        forMonth: month(c.for_month),
        consumerId: c.consumer_id,
        meals: c.meals,
        billed: c.billed,
        closedOn: c.closed_on,
        closedBy: c.closed_by ?? null,
      }),
    ),
  };
}

type DueClose = ReturnType<typeof dueAutoCloses>[number];

/** The data as it will stand once the automatic closes that are due are stored, without storing them. */
export function withDueCloses(data: EngineData): { data: EngineData; due: DueClose[] } {
  const due = dueAutoCloses(prepare(data));
  if (due.length === 0) return { data, due };
  const added: MonthClose[] = due.map((d) => ({
    forMonth: d.month,
    consumerId: d.consumerId,
    meals: d.meals,
    billed: d.billed,
    closedOn: data.today,
    closedBy: null,
  }));
  return { data: { ...data, closes: [...data.closes, ...added] }, due };
}

/**
 * Stores the automatic closes that have come due, before anything else happens,
 * and returns the data with them included. Run before every write and every
 * statement read, so a month freezes at the amount it had when it closed and no
 * later edit can get in first.
 */
export async function applyAutoCloses(tx: Tx, data: EngineData): Promise<EngineData> {
  const { data: closed, due } = withDueCloses(data);
  for (const d of due)
    await tx.query("SELECT system_close_month($1::date, $2::uuid, $3::int, $4::bigint)", [
      `${d.month}-01`,
      d.consumerId,
      d.meals,
      d.billed,
    ]);
  return closed;
}
