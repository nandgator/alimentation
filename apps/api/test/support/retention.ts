import { randomUUID } from "node:crypto";
import { addMonths, localNow, type Month, rupees } from "@alimentation/core";
import pg from "pg";
import { type CatalogueIds, enrolEveryone, logRow, seedCatalogue } from "./catalogue.ts";
import type { Client, TestPlatform } from "./platform.ts";

/**
 * A kitchen whose first months are far enough in the past to be handed over, made the way a person would
 * where that can be done (people, invitations, closing) and as rows where it cannot (old entries, payments).
 *
 * The workspace database counts its months from its own clock, so the kitchen is laid out from the real
 * date: the first two months are 27 and 26 months back, which are past the 24-month window.
 */
export interface OldKitchen {
  slug: string;
  w: string;
  money: boolean;
  owner: Client;
  jovial: Client;
  smruti: Client;
  ids: { jovial: string; smruti: string; admin: string; supplier: string };
  catalogue: CatalogueIds;
  /** The two old months, the first live month, and the current one. */
  months: { m0: Month; m1: Month; m2: Month; now: Month };
  /** Months after the cut and the figures a person sees of them. */
  figures(): Promise<unknown>;
  /** Straight SQL as the database owner. */
  sql<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** The first Monday on or after the first of the month. */
export const mondayOf = (month: Month): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export async function oldKitchen(
  p: TestPlatform,
  slug: string,
  o: { money?: boolean; ownerEmail?: string; closeOld?: boolean } = {},
): Promise<OldKitchen> {
  const money = o.money ?? true;
  const today = localNow(p.clock.now, "Asia/Kolkata").date;
  const now = today.slice(0, 7) as Month;
  const months = { m0: addMonths(now, -27), m1: addMonths(now, -26), m2: addMonths(now, -25), now };
  const owner = await p.signIn(o.ownerEmail ?? `owner-${slug}@example.org`, "Owner");
  const made = await owner.post("/api/workspaces", {
    slug,
    name: `Kitchen ${slug}`,
    alsoSupplier: true,
    moneyEnabled: money,
  });
  if (made.status !== 201) throw new Error(`workspace not made: ${JSON.stringify(made.json)}`);
  const w = `/api/w/${slug}`;
  const handle = (await p.runtime.deps.directory.bySlug(slug))!;
  const pool = new pg.Pool({ connectionString: handle.dsns.owner, max: 2 });
  const sql = async <T>(text: string, values: unknown[] = []) =>
    (await pool.query(text, values)).rows as T[];

  const catalogue = await seedCatalogue(pool, { money });
  // What the first months are served and priced by: the menu and the card, from the first month on.
  const menu = randomUUID();
  const from = `${months.m0}-01`;
  await sql(`INSERT INTO menu (id, effective_from) VALUES ($1, $2)`, [menu, from]);
  await sql(
    `INSERT INTO menu_offer (menu_id, service_id, item_id) SELECT $1, service_id, item_id FROM menu_offer WHERE menu_id = $2`,
    [menu, catalogue.menu],
  );
  await sql(
    `INSERT INTO menu_day (menu_id, service_id, weekday, meal_id) SELECT $1, service_id, weekday, meal_id FROM menu_day WHERE menu_id = $2`,
    [menu, catalogue.menu],
  );
  if (money) {
    const card = randomUUID();
    await sql(
      `INSERT INTO rate_card (id, effective_from, monthly_fee) SELECT $1, $2, monthly_fee FROM rate_card WHERE id = $3`,
      [card, from, catalogue.cardApr],
    );
    await sql(
      `INSERT INTO rate_price (card_id, item_id, service_id, amount) SELECT $1, item_id, service_id, amount FROM rate_price WHERE card_id = $2`,
      [card, catalogue.cardApr],
    );
  }

  const clients: Record<string, Client> = {};
  const ids: Record<string, string> = {};
  for (const [name, key] of [
    ["Willow", "jovial"],
    ["Maple", "smruti"],
  ] as const) {
    const person = await owner.post(`${w}/people`, {
      name,
      role: "consumer",
      contact: `${key}@home`,
      activeFrom: from,
    });
    if (person.status !== 201) throw new Error(`person not made: ${JSON.stringify(person.json)}`);
    ids[key] = person.json.id;
    const email = `${key}-${slug}@example.org`;
    const inv = await owner.post(`${w}/people/${person.json.id}/invite`, { email });
    clients[key] = await p.signIn(email, name);
    await clients[key]!.post("/api/invites/accept", { token: inv.json.link.split("#")[1] });
  }
  await enrolEveryone(pool, catalogue.lunch);
  const [admin] = await sql<{ id: string }>(`SELECT id FROM person WHERE role = 'admin'`);
  const [supplier] = await sql<{ id: string }>(`SELECT id FROM person WHERE role = 'supplier'`);
  const adminId = admin!.id;
  const supplierId = supplier!.id;

  await logRow(pool, {
    date: mondayOf(months.m0),
    person: ids.jovial!,
    action: "Leave",
    by: ids.jovial!,
  });
  await logRow(pool, {
    date: mondayOf(months.m1),
    person: ids.smruti!,
    action: "Extra",
    service: catalogue.lunch,
    item: catalogue.chapati,
    qty: 3,
    by: ids.smruti!,
  });
  await logRow(pool, {
    date: mondayOf(months.m2),
    person: ids.jovial!,
    action: "Leave",
    by: ids.jovial!,
  });

  if (money) {
    const claims = [
      [randomUUID(), ids.jovial!, months.m0],
      [randomUUID(), ids.smruti!, months.m1],
      [randomUUID(), ids.jovial!, months.m2],
    ] as const;
    for (const [id, who, month] of claims)
      await sql(
        `INSERT INTO claim (id, consumer_id, paid_at, for_month, amount, method) VALUES ($1, $2, $3, $4, $5, 'UPI')`,
        [id, who, `${month}-20T10:00:00Z`, `${month}-01`, rupees(100)],
      );
    for (const [id] of claims.slice(0, 3))
      await sql(
        `INSERT INTO claim_decision (claim_id, decision, decided_by) VALUES ($1, 'Confirmed', $2)`,
        [id, supplierId],
      );
    await sql(
      `INSERT INTO settlement (on_date, consumer_id, for_month, type, amount, recorded_by) VALUES ($1, $2, $3, 'Payment', $4, $5)`,
      [mondayOf(months.m1), ids.jovial!, `${months.m0}-01`, rupees(50), adminId],
    );
  }
  if (o.closeOld !== false)
    for (const m of [months.m0, months.m1]) {
      const closed = await owner.post(`${w}/closes`, { month: m });
      if (closed.status !== 201) throw new Error(`not closed: ${JSON.stringify(closed.json)}`);
    }

  return {
    slug,
    w,
    money,
    owner,
    jovial: clients.jovial!,
    smruti: clients.smruti!,
    ids: { jovial: ids.jovial!, smruti: ids.smruti!, admin: adminId, supplier: supplierId },
    catalogue,
    months,
    async figures() {
      const live = [months.m2, addMonths(months.m2, 1), now].join(",");
      const get = async (path: string) => (await owner.get(`${w}${path}`)).json;
      return {
        statements: await get(`/statements?months=${live}`),
        // The claims of the months that stay: those of the months handed over leave with them.
        claims: money
          ? ((await get("/claims")) as { forMonth: string }[]).filter(
              (c) => c.forMonth >= months.m2,
            )
          : null,
      };
    },
    sql,
    close: async () => void (await pool.end()),
  };
}
