import { DEFAULT_POLICY } from "@alimentation/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/workspace/errors.ts";
import { type Fixture, makeFixture } from "./support/fixture.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";
import { at, seedSpec } from "./support/spec.ts";

const thrown = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected an ApiError, but the call succeeded");
};

describe("holidays by the range and by the list", () => {
  let fx: Fixture;
  const dates = async (from = "2027-01-01", to = "2027-12-31") =>
    (
      await fx.ws.owner.query(
        "SELECT on_date::text AS d, name, location, confirmed FROM holiday WHERE on_date BETWEEN $1 AND $2 ORDER BY on_date, name, location NULLS FIRST",
        [from, to],
      )
    ).rows;
  const audits = async () =>
    Number((await fx.ws.owner.query("SELECT count(*) AS n FROM audit_log")).rows[0]!.n);
  const clear = () => fx.ws.owner.query("DELETE FROM holiday WHERE on_date >= '2027-01-01'");

  beforeAll(async () => {
    fx = await makeFixture();
    fx.clock.now = at("2026-12-20T06:00:00Z");
  });
  afterAll(async () => fx.close());

  it("expands a range into one holiday for each date, weekends included", async () => {
    // 2027-03-05 is a Friday.
    const made = await fx.svc.addHoliday(fx.admin, {
      name: "Spring break",
      from: "2027-03-05",
      to: "2027-03-08",
      confirmed: false,
    });
    expect(made.ids).toHaveLength(4);
    expect(made.id).toBe(made.ids[0]);
    expect(await dates("2027-03-01", "2027-03-31")).toEqual(
      ["05", "06", "07", "08"].map((d) => ({
        d: `2027-03-${d}`,
        name: "Spring break",
        location: null,
        confirmed: false,
      })),
    );
    await clear();
  });

  it("still adds one date as before", async () => {
    const made = await fx.svc.addHoliday(fx.admin, {
      name: "Founders",
      date: "2027-02-02",
      confirmed: true,
    });
    expect(made.ids).toEqual([made.id]);
    await clear();
  });

  it("refuses a range of more than 366 days, an end before the start, and a date mixed with a range", async () => {
    const add = (extra: object) =>
      thrown(fx.svc.addHoliday(fx.admin, { name: "X", confirmed: true, ...extra }));
    expect((await add({ from: "2027-01-01", to: "2028-01-02" })).message).toMatch(/at most 366/);
    expect((await add({ from: "2027-01-05", to: "2027-01-01" })).code).toBe("invalid");
    expect((await add({ date: "2027-01-05", to: "2027-01-06" })).code).toBe("invalid");
    expect((await add({})).code).toBe("invalid");
    expect(await dates()).toEqual([]);
    // Exactly 366 days is allowed.
    const ok = await fx.svc.addHoliday(fx.admin, {
      name: "Sabbatical",
      from: "2028-01-01",
      to: "2028-12-31",
      confirmed: true,
    });
    expect(ok.ids).toHaveLength(366);
    await fx.ws.owner.query("DELETE FROM holiday WHERE on_date >= '2028-01-01'");
  });

  it("merge adds what is not there and skips the same day, name and place, whatever the case", async () => {
    await fx.svc.addHoliday(fx.admin, {
      name: "Founders",
      date: "2027-02-02",
      location: "North",
      confirmed: true,
    });
    const r = await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: false,
      items: [
        { name: " founders ", date: "2027-02-02", location: "north" },
        { name: "Founders", date: "2027-02-02" }, // another place: new
        { name: "Fair", from: "2027-02-03", to: "2027-02-04", confirmed: false },
        { name: "Fair", date: "2027-02-03", confirmed: false }, // repeated in the list
      ],
    });
    expect(r.committed).toBe(true);
    expect(r.rows.map((x) => [x.row, x.action, x.date])).toEqual([
      [1, "skip", "2027-02-02"],
      [2, "create", "2027-02-02"],
      [3, "create", "2027-02-03"],
      [3, "create", "2027-02-04"],
      [4, "skip", "2027-02-03"],
    ]);
    expect(r.summary).toEqual({ create: 3, replace: 0, skip: 2, error: 0, removed: 0 });
    expect((await dates()).map((x) => `${x.d} ${x.name} ${x.location ?? "-"}`)).toEqual([
      "2027-02-02 Founders -",
      "2027-02-02 Founders North",
      "2027-02-03 Fair -",
      "2027-02-04 Fair -",
    ]);
    // Doing it again changes nothing.
    const again = await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: false,
      items: [{ name: "Fair", from: "2027-02-03", to: "2027-02-04", confirmed: false }],
    });
    expect(again.summary).toMatchObject({ create: 0, skip: 2 });
    await clear();
  });

  it("overwrite replaces what is on the dates named and leaves every other date alone", async () => {
    for (const [name, date] of [
      ["Old one", "2027-04-01"],
      ["Old two", "2027-04-01"],
      ["Untouched", "2027-04-02"],
      ["Elsewhere", "2027-04-09"],
    ] as const)
      await fx.svc.addHoliday(fx.admin, { name, date, confirmed: true });
    const r = await fx.svc.importHolidays(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      items: [
        { name: "New", date: "2027-04-01", confirmed: false },
        { name: "Fresh", date: "2027-04-05" },
      ],
    });
    expect(r.rows.map((x) => [x.action, x.date])).toEqual([
      ["replace", "2027-04-01"],
      ["create", "2027-04-05"],
    ]);
    expect(r.rows[0]!.message).toContain("Old one");
    expect(r.summary).toEqual({ create: 1, replace: 1, skip: 0, error: 0, removed: 2 });
    expect((await dates("2027-04-01", "2027-04-30")).map((x) => `${x.d} ${x.name}`)).toEqual([
      "2027-04-01 New",
      "2027-04-02 Untouched",
      "2027-04-05 Fresh",
      "2027-04-09 Elsewhere",
    ]);
    await clear();
  });

  it("an overwrite that restates what a date has writes nothing, so the same file can be run twice", async () => {
    const items = [
      { name: "Same", date: "2027-04-12", confirmed: true },
      { name: "Other", from: "2027-04-13", to: "2027-04-14", confirmed: false },
    ];
    const first = await fx.svc.importHolidays(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      items,
    });
    expect(first.summary).toMatchObject({ create: 3, replace: 0 });
    const before = await audits();
    const again = await fx.svc.importHolidays(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      items,
    });
    expect(again.summary).toMatchObject({ create: 0, replace: 0, skip: 3, removed: 0 });
    expect(await audits()).toEqual(before);
    await clear();
  });

  it("a dry run says what would happen to each row and writes nothing, not even to the audit trail", async () => {
    await fx.svc.addHoliday(fx.admin, { name: "Kept", date: "2027-05-03", confirmed: true });
    const before = { rows: await dates(), audits: await audits() };
    for (const mode of ["merge", "overwrite"] as const) {
      const r = await fx.svc.importHolidays(fx.admin, {
        mode,
        dryRun: true,
        items: [
          { name: "New", from: "2027-05-03", to: "2027-05-04" },
          { name: "", date: "2027-05-05" },
        ],
      });
      expect(r.dryRun).toBe(true);
      expect(r.committed).toBe(false);
      expect(r.rows.map((x) => x.action)).toEqual([
        mode === "merge" ? "create" : "replace",
        "create",
        "error",
      ]);
      expect(r.summary.error).toBe(1);
    }
    expect({ rows: await dates(), audits: await audits() }).toEqual(before);
    await clear();
  });

  it("one audit row for each holiday written, by the database", async () => {
    const n = await audits();
    await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: false,
      items: [{ name: "Trail", from: "2027-06-01", to: "2027-06-03" }],
    });
    expect((await audits()) - n).toBe(3);
    const last = await fx.ws.owner.query(
      "SELECT table_name, action, actor FROM audit_log ORDER BY id DESC LIMIT 1",
    );
    expect(last.rows[0]).toMatchObject({ table_name: "holiday", action: "INSERT" });
    expect(last.rows[0]!.actor).toBe(fx.admin.personId);
    await clear();
  });

  it("reads csv text, reporting a bad row by its line and not stopping the others", async () => {
    const csv = [
      "name,date,to,location,confirmed",
      "Harvest,2027-07-01,2027-07-02,,no",
      "Broken,not-a-date,,,",
      "Fair,2027-07-10,,East,yes",
    ].join("\n");
    const dry = await fx.svc.importHolidays(fx.admin, { mode: "merge", dryRun: true, csv });
    expect(dry.rows.map((x) => [x.row, x.action])).toEqual([
      [2, "create"],
      [2, "create"],
      [3, "error"],
      [4, "create"],
    ]);
    expect(dry.rows.find((x) => x.action === "error")!.message).toMatch(/not a date/);
    // The bad row stops the commit by default ...
    const stopped = await fx.svc.importHolidays(fx.admin, { mode: "merge", dryRun: false, csv });
    expect(stopped.committed).toBe(false);
    expect(await dates()).toEqual([]);
    // ... and `partial` lets the rest through.
    const partial = await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: false,
      partial: true,
      csv,
    });
    expect(partial.committed).toBe(true);
    expect((await dates()).map((x) => [x.d, x.name, x.location, x.confirmed])).toEqual([
      ["2027-07-01", "Harvest", null, false],
      ["2027-07-02", "Harvest", null, false],
      ["2027-07-10", "Fair", "East", true],
    ]);
    await clear();
  });

  it("refuses more than 1000 days, counting each day of a range", async () => {
    const e = await thrown(
      fx.svc.importHolidays(fx.admin, {
        mode: "merge",
        dryRun: true,
        items: [
          { name: "A", from: "2027-01-01", to: "2027-12-31" },
          { name: "B", from: "2027-01-01", to: "2027-12-31" },
          { name: "C", from: "2027-01-01", to: "2027-12-31" },
        ],
      }),
    );
    expect(e.code).toBe("invalid");
    expect(e.message).toMatch(/1000/);
    const ok = await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: true,
      items: Array.from({ length: 1000 }, (_, i) => ({ name: `H${i}`, date: "2027-01-01" })),
    });
    expect(ok.rows).toHaveLength(1000);
  });

  it("is the admin's alone", async () => {
    const consumer = await fx.addConsumer("Guest");
    for (const who of [fx.supplier, consumer])
      expect(
        (
          await thrown(
            fx.svc.importHolidays(who, {
              mode: "merge",
              dryRun: true,
              items: [{ name: "x", date: "2027-01-01" }],
            }),
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await thrown(
          fx.svc.addHoliday(fx.supplier, {
            name: "x",
            from: "2027-01-01",
            to: "2027-01-02",
            confirmed: true,
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("holidays and the freeze", () => {
  it("[P3] are refused, dry run or not, while the workspace is moving", async () => {
    const fx = await makeFixture({ state: "MIGRATING" });
    try {
      for (const dryRun of [true, false])
        expect(
          await thrown(
            fx.svc.importHolidays(fx.admin, {
              mode: "merge",
              dryRun,
              items: [{ name: "x", date: "2027-01-01" }],
            }),
          ),
        ).toMatchObject({ status: 409, code: "read_only" });
    } finally {
      await fx.close();
    }
  });
});

describe("holidays in a closed month", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await makeFixture();
    await seedSpec(fx);
    await fx.svc.closeMonth(fx.admin, "2026-10");
    // Where the kitchen's rules say that nobody changes a closed month, the admin included.
    await fx.ws.owner.query(
      "INSERT INTO policy_version (effective_from, doc) VALUES ('2026-10-01', $1)",
      [JSON.stringify({ ...DEFAULT_POLICY, monthClose: { mode: "manual", afterClose: "block" } })],
    );
  });
  afterAll(async () => fx.close());
  const count = async () =>
    Number((await fx.ws.owner.query("SELECT count(*) AS n FROM holiday")).rows[0]!.n);

  const items = [
    { name: "Open month", date: "2026-11-20" },
    { name: "Closed month", date: "2026-10-28" },
    { name: "Straddles", from: "2026-10-31", to: "2026-11-01" },
  ];

  it("reports the rows it refuses, row by row, in a dry run", async () => {
    const n = await count();
    const r = await fx.svc.importHolidays(fx.admin, { mode: "merge", dryRun: true, items });
    expect(r.rows.map((x) => [x.row, x.date, x.action])).toEqual(
      [
        [2, "2026-10-28", "error"],
        [3, "2026-10-31", "error"],
        [3, "2026-11-01", "create"],
        [1, "2026-11-20", "create"],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
    expect(r.rows.find((x) => x.action === "error")!.message).toMatch(/closed/);
    expect(await count()).toBe(n);
  });

  it("writes nothing when any row is refused, unless asked for the rest", async () => {
    const n = await count();
    const stopped = await fx.svc.importHolidays(fx.admin, { mode: "merge", dryRun: false, items });
    expect(stopped.committed).toBe(false);
    expect(stopped.summary.error).toBe(2);
    expect(await count()).toBe(n);
    const partial = await fx.svc.importHolidays(fx.admin, {
      mode: "merge",
      dryRun: false,
      partial: true,
      items,
    });
    expect(partial.committed).toBe(true);
    expect(await count()).toBe(n + 2);
  });

  it("does not let an overwrite take away a holiday in a closed month", async () => {
    await fx.ws.owner.query("INSERT INTO holiday (name, on_date) VALUES ('Frozen', '2026-10-27')");
    const r = await fx.svc.importHolidays(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      partial: true,
      items: [{ name: "Replacement", date: "2026-10-27" }],
    });
    expect(r.rows[0]).toMatchObject({ action: "error" });
    expect(r.summary.removed).toBe(0);
    const left = await fx.ws.owner.query("SELECT name FROM holiday WHERE on_date = '2026-10-27'");
    expect(left.rows.map((x) => x.name)).toEqual(["Frozen"]);
  });

  it("refuses a range in a closed month whole", async () => {
    const closed = await thrown(
      fx.svc.addHoliday(fx.admin, {
        name: "Late",
        from: "2026-10-29",
        to: "2026-11-02",
        confirmed: true,
      }),
    );
    expect(closed).toMatchObject({ status: 422, code: "rule" });
    const wrote = await fx.ws.owner.query("SELECT 1 FROM holiday WHERE name = 'Late'");
    expect(wrote.rows).toEqual([]);
  });
});

describe("holidays over HTTP", () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform();
  });
  afterAll(async () => p.destroy());

  it("is for the admin only, and each kitchen sees only its own", async () => {
    const owner = await p.signIn("hol-owner@example.org", "Owner");
    const other = await p.signIn("hol-other@example.org", "Other");
    const guest = await p.signIn("hol-guest@example.org", "Guest");
    await owner.post("/api/workspaces", { slug: "hol-a", name: "Kitchen A" });
    await other.post("/api/workspaces", { slug: "hol-b", name: "Kitchen B" });
    const person = (
      await owner.post("/api/w/hol-a/people", {
        name: "Guest",
        role: "consumer",
        activeFrom: "2026-10-01",
      })
    ).json.id;
    const token = (
      (await owner.post(`/api/w/hol-a/people/${person}/invite`, { email: "hol-guest@example.org" }))
        .json.link as string
    ).split("#")[1];
    expect((await guest.post("/api/invites/accept", { token })).status).toBe(200);

    const bulk = {
      mode: "overwrite",
      dryRun: false,
      items: [{ name: "Fair", from: "2026-11-02", to: "2026-11-03" }],
    };
    // A member who is not the admin, and someone who is not in the kitchen at all.
    expect((await guest.post("/api/w/hol-a/holidays/bulk", bulk)).status).toBe(403);
    expect((await guest.post("/api/w/hol-b/holidays/bulk", bulk)).status).toBe(403);
    expect((await other.post("/api/w/hol-a/holidays/bulk", bulk)).status).toBe(403);
    expect((await p.anonymous().post("/api/w/hol-a/holidays/bulk", bulk)).status).toBe(401);
    expect(
      (
        await guest.post("/api/w/hol-a/holidays", {
          name: "x",
          date: "2026-11-02",
          confirmed: true,
        })
      ).status,
    ).toBe(403);

    const done = await owner.post("/api/w/hol-a/holidays/bulk", bulk);
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ committed: true, summary: { create: 2 } });
    const range = await owner.post("/api/w/hol-a/holidays", {
      name: "Trip",
      from: "2026-11-10",
      to: "2026-11-12",
      confirmed: true,
    });
    expect(range.status).toBe(201);
    expect(range.json.ids).toHaveLength(3);

    const boot = async (c: typeof owner, slug: string) =>
      (await c.get(`/api/w/${slug}/bootstrap`)).json.holidays as { name: string }[];
    expect((await boot(owner, "hol-a")).map((h) => h.name).sort()).toEqual([
      "Fair",
      "Fair",
      "Trip",
      "Trip",
      "Trip",
    ]);
    expect(await boot(other, "hol-b")).toEqual([]);
    // An overwrite in one kitchen never reaches the other, even on the same dates.
    await other.post("/api/w/hol-b/holidays/bulk", {
      mode: "overwrite",
      dryRun: false,
      items: [{ name: "Theirs", date: "2026-11-02" }],
    });
    expect((await boot(owner, "hol-a")).filter((h) => h.name === "Fair")).toHaveLength(2);
    expect((await boot(other, "hol-b")).map((h) => h.name)).toEqual(["Theirs"]);
  });

  it("answers a malformed body with 422, and accepts csv in place of items", async () => {
    const owner = await p.signIn("hol-owner2@example.org", "Owner");
    await owner.post("/api/workspaces", { slug: "hol-c", name: "Kitchen C" });
    const url = "/api/w/hol-c/holidays/bulk";
    expect((await owner.post(url, { mode: "merge", items: [], csv: "" })).status).toBe(422);
    expect((await owner.post(url, { mode: "merge" })).status).toBe(422);
    expect((await owner.post(url, { mode: "swap", items: [] })).status).toBe(422);
    const r = await owner.post(url, {
      mode: "merge",
      dryRun: true,
      csv: "name,date\nFair,2026-11-02",
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ dryRun: true, committed: false, summary: { create: 1 } });
    expect((await owner.get("/api/w/hol-c/bootstrap")).json.holidays).toEqual([]);
  });
});
