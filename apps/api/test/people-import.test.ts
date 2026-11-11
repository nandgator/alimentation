import { type PersonDto, peopleToCsv } from "@alimentation/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../src/workspace/errors.ts";
import { type Fixture, makeFixture } from "./support/fixture.ts";
import { makePlatform, type TestPlatform } from "./support/platform.ts";

const thrown = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected an ApiError, but the call succeeded");
};

describe("people brought in by a file, matched on the kitchen's own code", () => {
  let fx: Fixture;
  /** The people as the admin sees them, with the code, by name. */
  const people = async () =>
    (await fx.svc.bootstrap(fx.admin, ["admin"])).people
      .map((p) => ({
        name: p.name,
        role: p.role,
        key: p.externalKey,
        contact: p.contact,
        from: p.activeFrom,
        to: p.activeTo,
        status: p.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const count = async () =>
    Number((await fx.ws.owner.query("SELECT count(*) AS n FROM person")).rows[0]!.n);
  const importAudits = async () =>
    (
      await fx.ws.owner.query(
        "SELECT * FROM audit_log WHERE table_name = 'person_import' ORDER BY id",
      )
    ).rows;
  const allAudits = async () =>
    Number((await fx.ws.owner.query("SELECT count(*) AS n FROM audit_log")).rows[0]!.n);
  const row = (o: Record<string, unknown>) => ({ role: "consumer", ...o }) as never;
  const reset = async () => {
    await fx.ws.owner.query("DELETE FROM person WHERE external_key IS NOT NULL");
  };

  beforeAll(async () => {
    fx = await makeFixture();
  });
  afterAll(async () => fx.close());

  it("adds a row nobody has the key of, and says so first when asked for a dry run", async () => {
    const rows = [
      row({
        externalKey: "A-1",
        name: "Asha Example",
        contact: "asha@home",
        activeFrom: "2026-10-01",
      }),
      row({ externalKey: "A-2", name: "Bo Example" }),
    ];
    const before = { people: await count(), audits: await allAudits() };
    const dry = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, rows });
    expect(dry.committed).toBe(false);
    expect(dry.summary).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    expect(dry.rows.map((r) => [r.row, r.action, r.externalKey, r.id])).toEqual([
      [1, "create", "A-1", null],
      [2, "create", "A-2", null],
    ]);
    expect(dry.rows[0]!.diff.map((d) => d.field)).toEqual([
      "role",
      "name",
      "contact",
      "activeFrom",
    ]);
    expect(dry.fileHash).toMatch(/^[0-9a-f]{64}$/);
    // Nothing was written, and nothing recorded.
    expect({ people: await count(), audits: await allAudits() }).toEqual(before);

    const done = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: false, rows });
    expect(done.committed).toBe(true);
    expect(done.fileHash).toBe(dry.fileHash);
    expect(done.rows.every((r) => r.id)).toBe(true);
    expect((await people()).filter((p) => p.key)).toEqual([
      {
        name: "Asha Example",
        role: "consumer",
        key: "A-1",
        contact: "asha@home",
        from: "2026-10-01",
        to: null,
        status: "ACTIVE",
      },
      {
        name: "Bo Example",
        role: "consumer",
        key: "A-2",
        contact: null,
        from: null,
        to: null,
        status: "ACTIVE",
      },
    ]);
  });

  it("records the import once, with the mode, the counts and a hash, and never the file", async () => {
    const audits = await importAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "IMPORT", actor: fx.admin.personId, before: null });
    expect(audits[0]!.after).toMatchObject({
      mode: "merge",
      rows: 2,
      create: 2,
      update: 0,
      unchanged: 0,
    });
    expect(audits[0]!.after.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(audits[0]!.row_id).toBe(audits[0]!.after.fileHash);
    const text = JSON.stringify(audits);
    for (const secret of ["Asha", "Bo Example", "asha@home", "A-1"])
      expect(text).not.toContain(secret);
    // The people it added are in the trail as any added person is, key included.
    const added = (
      await fx.ws.owner.query(
        "SELECT after FROM audit_log WHERE table_name = 'person' AND action = 'INSERT' AND after ->> 'external_key' = 'A-1'",
      )
    ).rows;
    expect(added).toHaveLength(1);
  });

  it("leaves everything as it is when the same file is run again", async () => {
    const rows = [
      row({
        externalKey: "A-1",
        name: "Asha Example",
        contact: "asha@home",
        activeFrom: "2026-10-01",
      }),
      row({ externalKey: "A-2", name: "Bo Example" }),
    ];
    const before = { people: await count(), audits: await allAudits(), shown: await people() };
    for (const mode of ["merge", "overwrite"] as const) {
      const again = await fx.svc.importPeople(fx.admin, { mode, dryRun: false, rows });
      expect(again.committed).toBe(true);
      expect(again.summary).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    }
    expect({ people: await count(), audits: await allAudits(), shown: await people() }).toEqual(
      before,
    );
  });

  it("merge sets what a row gives and leaves a blank cell alone; overwrite clears it", async () => {
    const blank = [
      row({
        externalKey: "A-1",
        name: "Asha Example",
        contact: "",
        activeFrom: "",
        activeTo: "2026-12-31",
      }),
    ];
    const merged = await fx.svc.importPeople(fx.admin, {
      mode: "merge",
      dryRun: false,
      rows: blank,
    });
    expect(merged.summary.update).toBe(1);
    expect(merged.rows[0]!.diff).toEqual([{ field: "activeTo", from: null, to: "2026-12-31" }]);
    const asha = (await people()).find((p) => p.key === "A-1");
    expect(asha).toMatchObject({ contact: "asha@home", from: "2026-10-01", to: "2026-12-31" });

    // Overwrite sets what the row gives, a blank cell clearing it; the dates are not in this row, so they stay.
    const over = await fx.svc.importPeople(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      rows: [row({ externalKey: "A-1", name: "Asha Example", contact: "" })],
    });
    expect(over.rows[0]!.diff).toEqual([{ field: "contact", from: "asha@home", to: null }]);
    expect((await people()).find((p) => p.key === "A-1")).toMatchObject({
      contact: null,
      from: "2026-10-01",
      to: "2026-12-31",
    });
    // Clearing the start while the end stays would leave a last date with no first one: refused.
    const half = await fx.svc.importPeople(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      rows: blank,
    });
    expect(half.committed).toBe(false);
    expect(half.rows[0]).toMatchObject({
      action: "error",
      message: expect.stringMatching(/first date/),
    });
    const both = await fx.svc.importPeople(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      rows: [row({ externalKey: "A-1", name: "Asha Example", activeFrom: "", activeTo: "" })],
    });
    expect(both.rows[0]!.diff.map((d) => d.field)).toEqual(["activeFrom", "activeTo"]);
    expect((await people()).find((p) => p.key === "A-1")).toMatchObject({ from: null, to: null });
    const changed = (
      await fx.ws.owner.query(
        "SELECT after FROM audit_log WHERE table_name = 'person' AND action = 'UPDATE' AND row_id = (SELECT id::text FROM person WHERE external_key = 'A-1') ORDER BY id",
      )
    ).rows;
    expect(changed).toHaveLength(3);
    const imports = await importAudits();
    expect(imports.map((a) => [a.after.mode, a.after.update])).toEqual([
      ["merge", 0],
      ["merge", 1],
      ["overwrite", 1],
      ["overwrite", 1],
    ]);
  });

  it("never disables or removes anyone the file does not name, and always adds a row without a key", async () => {
    const before = await people();
    const r = await fx.svc.importPeople(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      rows: [row({ name: "No Key Example" }), row({ name: "No Key Example" })],
    });
    expect(r.summary.create).toBe(2);
    expect(r.rows[0]!.message).toMatch(/no key/);
    const after = await people();
    expect(after).toHaveLength(before.length + 2);
    for (const p of before) expect(after).toContainEqual(p);
    expect(after.every((p) => p.status === "ACTIVE")).toBe(true);
    await fx.ws.owner.query(
      "DELETE FROM person WHERE id IN (SELECT id FROM person ORDER BY created_at DESC, id DESC LIMIT 2)",
    );
  });

  it("refuses a role change, a repeated key and a bad row as error rows, and writes none of the file", async () => {
    const before = { shown: await people(), audits: await allAudits() };
    const r = await fx.svc.importPeople(fx.admin, {
      mode: "merge",
      dryRun: false,
      rows: [
        row({ externalKey: "N-1", name: "Would Be New" }),
        row({ externalKey: "A-2", name: "Bo Example", role: "supplier" }),
        row({ externalKey: "D-1", name: "One" }),
        row({ externalKey: "D-1", name: "Two" }),
        row({ externalKey: "X y", name: "Bad key" }),
        row({ name: "Admin with dates", role: "admin", activeFrom: "2026-10-01" }),
      ],
    });
    expect(r.committed).toBe(false);
    expect(r.rows.map((x) => x.action)).toEqual([
      "create",
      "error",
      "error",
      "error",
      "error",
      "error",
    ]);
    expect(r.rows[1]!.message).toMatch(/role cannot be changed/);
    expect(r.rows[2]!.message).toMatch(/more than one row \(3, 4\)/);
    expect({ shown: await people(), audits: await allAudits() }).toEqual(before);
  });

  it("applies every row or none: a failure part-way through takes back the rows before it", async () => {
    await fx.ws.owner.query(`
      CREATE FUNCTION test_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
      CREATE TRIGGER test_boom BEFORE INSERT ON person FOR EACH ROW WHEN (NEW.external_key = 'BOOM') EXECUTE FUNCTION test_boom()`);
    try {
      const before = { shown: await people(), audits: await allAudits() };
      await expect(
        fx.svc.importPeople(fx.admin, {
          mode: "overwrite",
          dryRun: false,
          rows: [
            row({ externalKey: "ROLLED-1", name: "Added First" }),
            row({ externalKey: "A-2", name: "Bo Renamed", contact: "bo@home" }),
            row({ externalKey: "BOOM", name: "Fails" }),
          ],
        }),
      ).rejects.toThrow(/boom/);
      expect({ shown: await people(), audits: await allAudits() }).toEqual(before);
    } finally {
      await fx.ws.owner.query("DROP TRIGGER test_boom ON person; DROP FUNCTION test_boom()");
    }
  });

  it("counts the new people against the cap first, and says how much room there is", async () => {
    const have = await count();
    await fx.ws.owner.query("UPDATE workspace SET people_cap = $1", [have + 2]);
    try {
      const rows = [
        row({ externalKey: "C-1", name: "Cap One" }),
        row({ externalKey: "C-2", name: "Cap Two" }),
        row({ externalKey: "C-3", name: "Cap Three" }),
        row({ externalKey: "A-2", name: "Bo Example", contact: "changed@home" }),
      ];
      const before = { shown: await people(), audits: await allAudits() };
      for (const dryRun of [true, false]) {
        const e = await thrown(fx.svc.importPeople(fx.admin, { mode: "merge", dryRun, rows }));
        expect(e.status).toBe(409);
        expect(e.code).toBe("quota_exceeded");
        expect(e.message).toContain("add 3 people");
        expect(e.message).toContain("room for 2 more");
        expect(e.message).not.toContain("ALIMENTATION");
      }
      expect({ shown: await people(), audits: await allAudits() }).toEqual(before);
      // Two new people fit, and changing people costs no room.
      const fits = await fx.svc.importPeople(fx.admin, {
        mode: "merge",
        dryRun: false,
        rows: [...rows.slice(0, 2), rows[3]!],
      });
      expect(fits.committed).toBe(true);
      expect(await count()).toBe(have + 2);
    } finally {
      await fx.ws.owner.query("UPDATE workspace SET people_cap = NULL");
      await fx.ws.owner.query("DELETE FROM person WHERE external_key IN ('C-1', 'C-2')");
    }
  });

  it("takes at most 1000 rows, and nothing empty", async () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => row({ externalKey: `M-${i}`, name: `Many ${i}` }));
    expect(
      (
        await thrown(
          fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, rows: many(1001) }),
        )
      ).message,
    ).toMatch(/At most 1000/);
    expect(
      (await thrown(fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, rows: [] })))
        .message,
    ).toMatch(/nothing to import/);
    const ok = await fx.svc.importPeople(fx.admin, {
      mode: "merge",
      dryRun: true,
      rows: many(1000),
    });
    expect(ok.summary.create).toBe(1000);
  });

  it("reads a csv, with the line of each row, and refuses a file that is not the columns", async () => {
    const csv = [
      "externalKey,name,role,contact",
      "F-1,File One,member,one@home",
      "F-2,File Two,supplier,",
      "F-3,,consumer,",
    ].join("\n");
    const dry = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, csv });
    expect(dry.rows.map((r) => [r.row, r.action])).toEqual([
      [2, "create"],
      [3, "create"],
      [4, "error"],
    ]);
    const bad = await fx.svc.importPeople(fx.admin, {
      mode: "merge",
      dryRun: false,
      csv: "name,shoe\nA,9\n",
    });
    expect(bad.committed).toBe(false);
    expect(bad.rows[0]).toMatchObject({ row: 1, action: "error" });
    const empty = await fx.svc.importPeople(fx.admin, { mode: "merge", dryRun: true, csv: "" });
    expect(empty.rows[0]).toMatchObject({
      action: "error",
      message: "There is nothing to import.",
    });
  });

  it("sets a person's key once, by hand, and refuses to change or clear it, or to give it to two people", async () => {
    const a = await fx.svc.createPerson(fx.admin, {
      name: "By Hand",
      role: "consumer",
      externalKey: " H-1 ",
    });
    const b = await fx.svc.createPerson(fx.admin, { name: "Later Keyed", role: "consumer" });
    expect((await people()).find((p) => p.name === "By Hand")?.key).toBe("H-1");
    expect(
      (
        await thrown(
          fx.svc.createPerson(fx.admin, { name: "Twin", role: "consumer", externalKey: "H-1" }),
        )
      ).code,
    ).toBe("conflict");
    expect(
      (
        await thrown(
          fx.svc.createPerson(fx.admin, { name: "Bad", role: "consumer", externalKey: "a@b.org" }),
        )
      ).code,
    ).toBe("invalid");

    await fx.svc.updatePerson(fx.admin, a.id, { externalKey: "H-1", name: "By Hand Renamed" });
    for (const key of ["H-2", null, ""]) {
      const e = await thrown(fx.svc.updatePerson(fx.admin, a.id, { externalKey: key }));
      expect([e.status, e.code], String(key)).toEqual([409, "immutable"]);
    }
    expect((await thrown(fx.svc.updatePerson(fx.admin, b.id, { externalKey: "H-1" }))).code).toBe(
      "conflict",
    );
    await fx.svc.updatePerson(fx.admin, b.id, { externalKey: "H-3" });
    expect((await people()).find((p) => p.name === "Later Keyed")?.key).toBe("H-3");
    // An update that does not mention it does not touch it.
    await fx.svc.updatePerson(fx.admin, b.id, { contact: "later@home" });
    expect((await people()).find((p) => p.name === "Later Keyed")?.key).toBe("H-3");
    // Nor can a file change it: the key is what the file is matched on.
    const viaFile = await fx.svc.importPeople(fx.admin, {
      mode: "overwrite",
      dryRun: false,
      rows: [row({ externalKey: "H-3", name: "Later Keyed", contact: "" })],
    });
    expect(viaFile.summary.update).toBe(1);
    expect((await people()).find((p) => p.name === "Later Keyed")).toMatchObject({
      key: "H-3",
      contact: null,
    });
    await reset();
  });

  it("is the admin's alone, and the key is shown to nobody else", async () => {
    for (const who of [fx.supplier]) {
      const e = await thrown(
        fx.svc.importPeople(who, {
          mode: "merge",
          dryRun: true,
          rows: [row({ name: "Not allowed" })],
        }),
      );
      expect(e.status).toBe(403);
    }
    const seen = (await fx.svc.bootstrap(fx.supplier, ["supplier"])).people;
    expect(seen.every((p) => p.externalKey === null)).toBe(true);
  });

  it("is refused while the kitchen is being moved", async () => {
    fx.info.state = "MIGRATING";
    try {
      const e = await thrown(
        fx.svc.importPeople(fx.admin, {
          mode: "merge",
          dryRun: false,
          rows: [row({ name: "Frozen" })],
        }),
      );
      expect([e.status, e.code]).toEqual([409, "read_only"]);
    } finally {
      fx.info.state = "ACTIVE";
    }
  });
});

describe("[P7] one kitchen's people are not another's", () => {
  it("matches a key only inside its own kitchen: the same key in two kitchens is two people", async () => {
    const [a, b] = [await makeFixture(), await makeFixture()];
    try {
      const rows = [{ externalKey: "SAME-1", name: "Kitchen Member", role: "consumer" }] as never;
      await a.svc.importPeople(a.admin, { mode: "merge", dryRun: false, rows });
      const inB = await b.svc.importPeople(b.admin, { mode: "overwrite", dryRun: true, rows });
      expect(inB.rows[0]!.action).toBe("create");
      await b.svc.importPeople(b.admin, { mode: "merge", dryRun: false, rows });
      // Changing it in A leaves B as it was.
      await a.svc.importPeople(a.admin, {
        mode: "overwrite",
        dryRun: false,
        rows: [{ externalKey: "SAME-1", name: "Renamed In A", role: "consumer" }] as never,
      });
      const names = async (f: Fixture) =>
        (await f.svc.bootstrap(f.admin, ["admin"])).people
          .filter((p) => p.externalKey)
          .map((p) => p.name);
      expect(await names(a)).toEqual(["Renamed In A"]);
      expect(await names(b)).toEqual(["Kitchen Member"]);
      expect(
        Number(
          (
            await b.ws.owner.query(
              "SELECT count(*) AS n FROM audit_log WHERE table_name = 'person_import'",
            )
          ).rows[0]!.n,
        ),
      ).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("importing people over HTTP", () => {
  let p: TestPlatform;
  const W = "/api/w/import-kitchen";
  let owner: Awaited<ReturnType<TestPlatform["signIn"]>>;
  let member: Awaited<ReturnType<TestPlatform["signIn"]>>;
  const csv = { "content-type": "text/csv" };

  beforeAll(async () => {
    p = await makePlatform();
    owner = await p.signIn("import-owner@example.org", "Owner");
    expect(
      (
        await owner.post("/api/workspaces", {
          slug: "import-kitchen",
          name: "Import kitchen",
          alsoSupplier: true,
        })
      ).status,
    ).toBe(201);
    const made = await owner.post(`${W}/people`, {
      name: "Member",
      role: "consumer",
      activeFrom: "2026-10-01",
    });
    const invite = await owner.post(`${W}/people/${made.json.id}/invite`, {
      email: "import-member@example.org",
    });
    member = await p.signIn("import-member@example.org", "Member");
    await member.post("/api/invites/accept", { token: invite.json.link.split("#")[1] });
  });
  afterAll(async () => p.destroy());

  const peopleOf = async () =>
    (await owner.get(`${W}/bootstrap`)).json.people as {
      name: string;
      externalKey: string | null;
      contact: string | null;
    }[];

  it("takes JSON rows, and a text/csv body with the mode in the query", async () => {
    const json = await owner.post(`${W}/people/import`, {
      mode: "merge",
      dryRun: false,
      rows: [{ externalKey: "J-1", name: "Json Example", role: "consumer", contact: "=SUM(1)" }],
    });
    expect(json.status, JSON.stringify(json.json)).toBe(200);
    expect(json.json).toMatchObject({ committed: true, summary: { create: 1 } });

    const dry = await owner.req(
      "POST",
      `${W}/people/import?mode=merge&dryRun=true`,
      "externalKey,name,role\nT-1,Text Example,member\nJ-1,Json Example,consumer\n",
      csv,
    );
    expect(dry.status, JSON.stringify(dry.json)).toBe(200);
    expect(dry.json).toMatchObject({
      dryRun: true,
      committed: false,
      summary: { create: 1, update: 0, unchanged: 1 },
    });
    expect((await peopleOf()).map((x) => x.externalKey)).not.toContain("T-1");

    const real = await owner.req(
      "POST",
      `${W}/people/import?mode=merge`,
      "externalKey,name,role\nT-1,Text Example,member\n",
      csv,
    );
    expect(real.json).toMatchObject({ committed: true, summary: { create: 1 } });
    expect((await peopleOf()).map((x) => x.externalKey)).toContain("T-1");

    const noMode = await owner.req("POST", `${W}/people/import`, "name,role\nX,member\n", csv);
    expect(noMode.status).toBe(422);
    expect(noMode.json.error.message).toMatch(/mode=merge/);
    const badMode = await owner.req(
      "POST",
      `${W}/people/import?mode=replace`,
      "name,role\nX,member\n",
      csv,
    );
    expect(badMode.status).toBe(422);
  });

  it("reads back the file the app exports, and changes nobody", async () => {
    const shown = (await owner.get(`${W}/bootstrap`)).json.people as PersonDto[];
    const file = peopleToCsv(shown);
    expect(file).toContain("'=SUM(1)");
    const before = await peopleOf();
    const r = await owner.req("POST", `${W}/people/import?mode=overwrite`, file, csv);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    // The people without a key are added again, which the preview says; the rest are unchanged.
    expect(r.json.summary.update).toBe(0);
    expect(r.json.summary.unchanged).toBe(2);
    expect(
      r.json.rows
        .filter((x: { action: string }) => x.action === "create")
        .every((x: { externalKey: string | null }) => x.externalKey === null),
    ).toBe(true);
    expect((await peopleOf()).filter((x) => x.contact === "=SUM(1)")).toHaveLength(1);
    expect((await peopleOf()).length).toBeGreaterThanOrEqual(before.length);
  });

  it("is refused to a member and to the supplier, and writes nothing", async () => {
    const body = {
      mode: "merge",
      dryRun: false,
      rows: [{ externalKey: "NO-1", name: "Refused", role: "consumer" }],
    };
    const before = (await peopleOf()).length;
    expect((await member.post(`${W}/people/import`, body)).status).toBe(403);
    expect(
      (await member.req("POST", `${W}/people/import?mode=merge`, "name,role\nX,member\n", csv))
        .status,
    ).toBe(403);
    expect(
      (await owner.post(`${W}/people/import`, body, { "x-acting-as": "supplier" })).status,
    ).toBe(403);
    expect((await p.anonymous().post(`${W}/people/import`, body)).status).toBe(401);
    expect((await peopleOf()).length).toBe(before);
  });

  it("is refused for another kitchen's admin, and does not touch that kitchen", async () => {
    const stranger = await p.signIn("import-stranger@example.org", "Stranger");
    await stranger.post("/api/workspaces", { slug: "import-other", name: "Other" });
    const body = {
      mode: "merge",
      dryRun: false,
      rows: [{ externalKey: "X-1", name: "Cross", role: "consumer" }],
    };
    expect((await stranger.post(`${W}/people/import`, body)).status).toBe(403);
    expect((await owner.post("/api/w/import-other/people/import", body)).status).toBe(403);
    expect((await peopleOf()).map((x) => x.externalKey)).not.toContain("X-1");
  });

  it("refuses a body that is too large, too long, or not what it says", async () => {
    const big = `name,role,contact\n${"Big,member,".padEnd(1_000_100, "x")}\n`;
    const tooBig = await owner.req("POST", `${W}/people/import?mode=merge`, big, csv);
    expect(tooBig.status).toBe(413);
    const rows = Array.from({ length: 1001 }, (_, i) => ({ name: `Row ${i}`, role: "consumer" }));
    expect(
      (await owner.post(`${W}/people/import`, { mode: "merge", dryRun: true, rows })).status,
    ).toBe(422);
    const long = `name,role\n${Array.from({ length: 1001 }, (_, i) => `Row ${i},member`).join("\n")}\n`;
    const many = await owner.req("POST", `${W}/people/import?mode=merge&dryRun=true`, long, csv);
    expect(many.status).toBe(422);
    expect(many.json.error.message).toMatch(/At most 1000/);
    // A typo in a column name is refused and not silently dropped.
    const typo = await owner.post(`${W}/people/import`, {
      mode: "merge",
      dryRun: true,
      rows: [{ name: "A", role: "consumer", extrnalKey: "K" }],
    });
    expect(typo.status).toBe(422);
    // A mode that is neither.
    expect(
      (
        await owner.post(`${W}/people/import`, {
          mode: "replace",
          rows: [{ name: "A", role: "consumer" }],
        })
      ).status,
    ).toBe(422);
  });

  it("keeps a key from changing over the API too", async () => {
    const id = (
      await owner.post(`${W}/people`, {
        name: "Keyed Example",
        role: "consumer",
        externalKey: "API-1",
      })
    ).json.id;
    const change = await owner.req("PATCH", `${W}/people/${id}`, { externalKey: "API-2" });
    expect([change.status, change.json.error.code]).toEqual([409, "immutable"]);
    expect(
      (await owner.req("PATCH", `${W}/people/${id}`, { externalKey: "API-1", contact: "k@home" }))
        .status,
    ).toBe(204);
    const twin = await owner.post(`${W}/people`, {
      name: "Twin Example",
      role: "consumer",
      externalKey: "API-1",
    });
    expect([twin.status, twin.json.error.code]).toEqual([409, "conflict"]);
  });
});

describe("[P1] an import goes through the gate like any other request", () => {
  let p: TestPlatform;
  beforeAll(async () => {
    p = await makePlatform({
      FREE_LIMITS_JSON: JSON.stringify({ requestsPerDay: 6 }),
      HARD_CAP_FACTOR: "1",
    });
  });
  afterAll(async () => p.destroy());

  it("is turned away once the kitchen's day is used up, and writes nothing", async () => {
    const a = await p.signIn("gate-import@example.org");
    await a.post("/api/workspaces", { slug: "gate-import", name: "Gate" });
    for (let i = 0; i < 9; i++) await a.get("/api/w/gate-import/bootstrap");
    await p.runtime.deps.gate.flush();
    const r = await a.post("/api/w/gate-import/people/import", {
      mode: "merge",
      dryRun: false,
      rows: [{ externalKey: "G-1", name: "Gated", role: "consumer" }],
    });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("budget_reached");
  });
});
