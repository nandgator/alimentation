import { randomUUID } from "node:crypto";
import { homeKitchenSeed } from "@alimentation/core/seed";
import type { FieldCipher } from "../../src/crypto/fields.ts";

/** Anything with `query`: a pool or a client of the owner role. */
export interface Querier {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface CatalogueIds {
  lunch: string;
  veg: string;
  nonVeg: string;
  chapati: string;
  bhakri: string;
  menu: string;
  cardApr: string;
}

/**
 * What the original kitchen serves, as rows: one service, two meals, two add-ons, the menu from 2026-04-01 and,
 * for a kitchen that tracks money, its prices and monthly fee. Written as the database owner, which is how
 * an import writes, so these tests do not depend on the routes that people use to say the same thing. The
 * numbers are the core seed's, so core and API tests agree on October.
 */
export async function seedCatalogue(q: Querier, opts: { money: boolean }): Promise<CatalogueIds> {
  const seed = homeKitchenSeed();
  const ids: CatalogueIds = {
    lunch: randomUUID(),
    veg: randomUUID(),
    nonVeg: randomUUID(),
    chapati: randomUUID(),
    bhakri: randomUUID(),
    menu: randomUUID(),
    cardApr: randomUUID(),
  };
  const swap: Record<string, string> = {
    [seed.ids.lunch]: ids.lunch,
    [seed.ids.veg]: ids.veg,
    [seed.ids.nonVeg]: ids.nonVeg,
    [seed.ids.chapati]: ids.chapati,
    [seed.ids.bhakri]: ids.bhakri,
  };
  for (const s of seed.services)
    await q.query(`INSERT INTO service (id, name, position) VALUES ($1, $2, $3)`, [
      swap[s.id],
      s.name,
      s.position,
    ]);
  for (const i of seed.catalogue)
    await q.query(
      `INSERT INTO catalogue_item (id, kind, name, unit, max_qty) VALUES ($1, $2, $3, $4, $5)`,
      [swap[i.id], i.kind, i.name, i.unit, i.maxQty],
    );
  await q.query(`INSERT INTO menu (id, effective_from) VALUES ($1, $2)`, [
    ids.menu,
    seed.menu.effectiveFrom,
  ]);
  for (const [service, list] of Object.entries(seed.menu.offered))
    for (const item of list)
      await q.query(`INSERT INTO menu_offer (menu_id, service_id, item_id) VALUES ($1, $2, $3)`, [
        ids.menu,
        swap[service],
        swap[item],
      ]);
  for (const [service, week] of Object.entries(seed.menu.days))
    for (const [weekday, meal] of Object.entries(week))
      await q.query(
        `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) VALUES ($1, $2, $3, $4)`,
        [ids.menu, swap[service], Number(weekday), swap[meal as string]],
      );
  if (opts.money) {
    await q.query(`INSERT INTO rate_card (id, effective_from, monthly_fee) VALUES ($1, $2, $3)`, [
      ids.cardApr,
      seed.cardApr.effectiveFrom,
      seed.cardApr.monthlyFee,
    ]);
    for (const l of seed.cardApr.prices)
      await q.query(`INSERT INTO rate_price (card_id, item_id, amount) VALUES ($1, $2, $3)`, [
        ids.cardApr,
        swap[l.itemId],
        l.amount,
      ]);
  }
  return ids;
}

/**
 * Puts every consumer who is not yet in a service into it, from their first billed day. The platform does this
 * for a person it creates; this makes a kitchen made by import-style inserts the same, and does nothing twice.
 */
export async function enrolEveryone(q: Querier, serviceId: string): Promise<void> {
  await q.query(
    `INSERT INTO person_service (person_id, service_id, active_from)
     SELECT p.id, $1, p.active_from FROM person p
      WHERE p.role = 'consumer' AND p.active_from IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM person_service x WHERE x.person_id = p.id AND x.service_id = $1)`,
    [serviceId],
  );
}

/** One log entry, written as the owner. A meal change or an extra names its service and item. */
export async function logRow(
  q: Querier,
  r: {
    date: string;
    person: string | null;
    action: "Leave" | "Switch" | "Extra" | "Supplier Off";
    by: string;
    service?: string | null;
    item?: string | null;
    qty?: number | null;
    at?: string;
    /** A note, sealed with the kitchen's own cipher under the new row's id. */
    note?: { text: string; cipher: FieldCipher };
  },
): Promise<void> {
  const id = randomUUID();
  const kind = r.item ? (r.action === "Switch" ? "meal" : "addon") : null;
  await q.query(
    `INSERT INTO log_entry (id, on_date, person_id, all_consumers, action, service_id, item_id, item_kind, qty, logged_by, logged_at, note_enc)
     VALUES ($11, $1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $12)`,
    [
      r.date,
      r.person,
      r.person === null,
      r.action,
      r.service ?? null,
      r.item ?? null,
      kind,
      r.qty ?? null,
      r.by,
      r.at ?? null,
      id,
      r.note ? await r.note.cipher.enc("log_entry", "note_enc", id, r.note.text) : null,
    ],
  );
}
