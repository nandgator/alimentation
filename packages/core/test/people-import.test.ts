import { describe, expect, it } from "vitest";
import {
  BundleSchema,
  checkExternalKey,
  checkPersonFields,
  csvCell,
  type ExistingPerson,
  type PersonImportItem,
  parseHolidayCsv,
  parsePeopleCsv,
  peopleCsvTemplate,
  peopleToCsv,
  planPeopleImport,
  toCsv,
  unguardCell,
} from "../src/index.ts";

const there = (...people: Partial<ExistingPerson>[]): Map<string, ExistingPerson> =>
  new Map(
    people.map((p) => [
      p.externalKey as string,
      {
        id: `id-${p.externalKey}`,
        role: "consumer",
        name: "Existing Member",
        contact: null,
        activeFrom: null,
        activeTo: null,
        ...p,
      } as ExistingPerson,
    ]),
  );
const entries = (...items: PersonImportItem[]) => items.map((item, i) => ({ row: i + 1, item }));

describe("the csv reader and writer that holidays and people share", () => {
  it("reads quotes, doubled quotes, line breaks inside a cell and the line each record began on", () => {
    const out = parsePeopleCsv(
      'name,role,contact\n"Member, One",consumer,"a ""b""\nc"\nTwo,supplier,\n',
    );
    expect(out.problems).toEqual([]);
    expect(out.items.map((i) => [i.row, i.item.name, i.item.contact])).toEqual([
      [2, "Member, One", 'a "b"\nc'],
      [4, "Two", ""],
    ]);
  });

  it("is the reader holidays use, too", () => {
    const out = parseHolidayCsv("name;from\nFair;2026-10-02\n");
    expect(out.items.map((i) => i.item.name)).toEqual(["Fair"]);
  });

  it("quotes only where a cell needs it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(toCsv([["a", "b,c"]])).toBe('a,"b,c"\r\n');
  });

  it("makes a cell that a spreadsheet would run as a formula safe, and gives it back as it was", () => {
    for (const bad of ["=1+1", "+91 98200 00000", "-5", "@SUM(A1)", "\tx", "'=already", "''+2"]) {
      const written = csvCell(bad);
      expect(written.replace(/^"/, ""), bad).toMatch(/^'/);
      const read = parsePeopleCsv(`name,role,contact\nX,consumer,${written}\n`);
      expect(read.items[0]?.item.contact, bad).toBe(bad);
    }
    expect(csvCell("it's fine")).toBe("it's fine");
    expect(unguardCell("'abc")).toBe("'abc");
    expect(unguardCell("'=abc")).toBe("=abc");
  });
});

describe("a key", () => {
  it("is a short code of letters, digits and a few marks", () => {
    for (const ok of ["A-101", "staff.7", "r/12#b", "9", "a".repeat(64)])
      expect(checkExternalKey(ok), ok).toBeNull();
    for (const bad of ["", " a", "a b", "a@b.org", "-x", "a".repeat(65), "नाम", "x;y"])
      expect(checkExternalKey(bad), bad).not.toBeNull();
  });
});

describe("the details of a person", () => {
  it("are checked once, for a person added by hand and for a row of a file", () => {
    const ok = { name: "A", role: "consumer" as const };
    expect(checkPersonFields(ok)).toBeNull();
    expect(checkPersonFields({ ...ok, name: "  " })).toMatch(/name/);
    expect(checkPersonFields({ ...ok, name: "x".repeat(121) })).toMatch(/120/);
    expect(checkPersonFields({ ...ok, contact: "x".repeat(201) })).toMatch(/200/);
    expect(checkPersonFields({ ...ok, role: "admin", activeFrom: "2026-10-01" })).toMatch(
      /Only consumers/,
    );
    expect(checkPersonFields({ ...ok, activeFrom: "2026-02-30" })).toMatch(/not a date/);
    expect(checkPersonFields({ ...ok, activeTo: "2026-10-01" })).toMatch(/first date/);
    expect(checkPersonFields({ ...ok, activeFrom: "2026-10-02", activeTo: "2026-10-01" })).toMatch(
      /before/,
    );
    expect(
      checkPersonFields({ ...ok, activeFrom: "2026-10-01", activeTo: "2026-10-01" }),
    ).toBeNull();
  });
});

describe("reading a file of people", () => {
  it("takes the columns in any order, with their usual names, and a column that is missing is not given", () => {
    const out = parsePeopleCsv("Role,Key,Name,Eating From\nmember,K1,Asha,2026-10-01\n");
    expect(out.problems).toEqual([]);
    expect(out.items[0]?.item).toEqual({
      role: "member",
      externalKey: "K1",
      name: "Asha",
      activeFrom: "2026-10-01",
    });
    expect(out.items[0]?.item).not.toHaveProperty("contact");
  });

  it("reads a column that is there with an empty cell as given blank", () => {
    const out = parsePeopleCsv("name,role,contact\nAsha,consumer,\n");
    expect(out.items[0]?.item.contact).toBe("");
  });

  it("refuses a file whose first line is not the columns", () => {
    expect(parsePeopleCsv("").problems[0]?.message).toMatch(/nothing/);
    expect(parsePeopleCsv("name\nAsha\n").problems[0]?.message).toMatch(/"role"/);
    expect(parsePeopleCsv("name,role,shoe\nA,consumer,9\n").problems[0]?.message).toMatch(
      /"shoe" is not a column/,
    );
    expect(parsePeopleCsv("name,role,name\n").problems.map((p) => p.message)).toEqual([
      'The column "name" is given twice.',
    ]);
  });

  it("reports a row with more cells than the first line, with its line, and goes on", () => {
    const out = parsePeopleCsv("name,role\nA,consumer\nB,consumer,extra\nC,supplier\n");
    expect(out.problems).toEqual([
      { row: 3, message: "This row has more cells than the first line has columns." },
    ]);
    expect(out.items.map((i) => i.row)).toEqual([2, 4]);
  });

  it("skips a byte-order mark and reads semicolons and tabs", () => {
    expect(parsePeopleCsv("﻿name;role\nAsha;consumer\n").items.map((i) => i.item.name)).toEqual([
      "Asha",
    ]);
    expect(parsePeopleCsv("name\trole\nAsha\tconsumer\n").items[0]?.item.role).toBe("consumer");
  });
});

describe("what would happen to each row", () => {
  it("adds a row nobody has the key of, and always adds a row without one", () => {
    const plan = planPeopleImport(
      entries(
        { externalKey: "A1", name: "Asha", role: "consumer", activeFrom: "2026-10-01" },
        { name: "Bo", role: "supplier" },
        { name: "Bo", role: "supplier" },
      ),
      "merge",
      there(),
    );
    expect(plan.rows.map((r) => [r.action, r.externalKey])).toEqual([
      ["create", "A1"],
      ["create", null],
      ["create", null],
    ]);
    expect(plan.rows[0]?.diff).toEqual([
      { field: "role", from: null, to: "consumer" },
      { field: "name", from: null, to: "Asha" },
      { field: "activeFrom", from: null, to: "2026-10-01" },
    ]);
    expect(plan.creates).toHaveLength(3);
    expect(plan.updates).toEqual([]);
  });

  it("merge sets what is given and leaves a blank cell alone", () => {
    const plan = planPeopleImport(
      entries({
        externalKey: "A1",
        name: "Asha R",
        role: "consumer",
        contact: "",
        activeFrom: "",
        activeTo: "2026-12-31",
      }),
      "merge",
      there({ externalKey: "A1", name: "Asha", contact: "call", activeFrom: "2026-10-01" }),
    );
    expect(plan.rows[0]?.action).toBe("update");
    expect(plan.rows[0]?.diff.map((d) => d.field)).toEqual(["name", "activeTo"]);
    expect(plan.updates).toEqual([
      { id: "id-A1", sets: { name: "Asha R", activeTo: "2026-12-31" } },
    ]);
  });

  it("overwrite clears what a given blank cell says, and leaves a column the file lacks", () => {
    const existing = there({
      externalKey: "A1",
      name: "Asha",
      contact: "call",
      activeFrom: "2026-10-01",
      activeTo: "2026-12-31",
    });
    const plan = planPeopleImport(
      entries({ externalKey: "A1", name: "Asha", role: "consumer", contact: "", activeTo: "" }),
      "overwrite",
      existing,
    );
    expect(plan.updates).toEqual([{ id: "id-A1", sets: { contact: null, activeTo: null } }]);
    // The dates were not in the file, so activeFrom stays.
    expect(plan.rows[0]?.diff).toEqual([
      { field: "contact", from: "call", to: null },
      { field: "activeTo", from: "2026-12-31", to: null },
    ]);
  });

  it("calls a row unchanged when nothing differs, which is what running a file twice leaves", () => {
    const item = { externalKey: "A1", name: "Asha", role: "consumer", contact: "call" };
    const plan = planPeopleImport(
      entries(item),
      "overwrite",
      there({ externalKey: "A1", name: "Asha", contact: "call" }),
    );
    expect(plan.rows[0]).toMatchObject({ action: "unchanged", diff: [] });
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([]);
  });

  it("refuses a role change, and says whose key it is", () => {
    const plan = planPeopleImport(
      entries({ externalKey: "A1", name: "Asha", role: "supplier" }),
      "merge",
      there({ externalKey: "A1" }),
    );
    expect(plan.rows[0]?.action).toBe("error");
    expect(plan.rows[0]?.message).toMatch(/belongs to a member.*role cannot be changed/);
    expect(plan.updates).toEqual([]);
  });

  it("refuses a key given twice, on each row that has it", () => {
    const plan = planPeopleImport(
      entries(
        { externalKey: "A1", name: "One", role: "consumer" },
        { externalKey: "B2", name: "Two", role: "consumer" },
        { externalKey: "A1", name: "Three", role: "consumer" },
      ),
      "merge",
      there(),
    );
    expect(plan.rows.map((r) => r.action)).toEqual(["error", "create", "error"]);
    expect(plan.rows[0]?.message).toMatch(/more than one row \(1, 3\)/);
  });

  it("refuses a bad key, role, name, date and a date on someone who is not billed, row by row", () => {
    const plan = planPeopleImport(
      entries(
        { externalKey: "a b", name: "A", role: "consumer" },
        { name: "A", role: "cook" },
        { name: "A" },
        { name: " ", role: "consumer" },
        { name: "A", role: "consumer", activeFrom: "soon" },
        { name: "A", role: "admin", activeFrom: "2026-10-01" },
        { name: "A", role: "Member" },
      ),
      "merge",
      there(),
    );
    expect(plan.rows.map((r) => r.action)).toEqual([
      "error",
      "error",
      "error",
      "error",
      "error",
      "error",
      "create",
    ]);
    expect(plan.rows[1]?.message).toMatch(/"cook" is not a role/);
    expect(plan.rows[2]?.message).toMatch(/Give a role/);
  });

  it("checks the result of a change, not only the row: an end date before the start already there", () => {
    const plan = planPeopleImport(
      entries({ externalKey: "A1", name: "Asha", role: "consumer", activeTo: "2026-09-01" }),
      "merge",
      there({ externalKey: "A1", activeFrom: "2026-10-01" }),
    );
    expect(plan.rows[0]?.action).toBe("error");
    expect(plan.rows[0]?.message).toMatch(/before/);
  });

  it("does not disable or remove anyone: a person absent from the file is not in the plan", () => {
    const plan = planPeopleImport(
      entries({ externalKey: "A1", name: "Asha", role: "consumer" }),
      "overwrite",
      there({ externalKey: "A1", name: "Asha" }, { externalKey: "B2" }),
    );
    expect(plan.updates.every((u) => u.id === "id-A1")).toBe(true);
    expect(plan.rows).toHaveLength(1);
  });
});

describe("a file of people that can be put back", () => {
  const people = [
    {
      externalKey: "A-1",
      name: 'Asha "AR", Rao',
      role: "consumer" as const,
      contact: "+91 98200 00000",
      activeFrom: "2026-10-01",
      activeTo: null,
    },
    {
      externalKey: null,
      name: "=HYPERLINK(1)",
      role: "supplier" as const,
      contact: "line one\nline two",
      activeFrom: null,
      activeTo: null,
    },
    {
      externalKey: "@x",
      name: "Plain",
      role: "admin" as const,
      contact: null,
      activeFrom: null,
      activeTo: null,
    },
  ];

  it("writes a safe file and reads it back as it was", () => {
    const text = peopleToCsv(people);
    expect(text.split("\r\n")[0]).toBe("externalKey,name,role,contact,activeFrom,activeTo");
    // No cell of the file starts like a formula.
    expect(text).toContain("'+91 98200 00000");
    expect(text).toContain("'=HYPERLINK(1)");
    const back = parsePeopleCsv(text);
    expect(back.problems).toEqual([]);
    expect(
      back.items.map((i) => ({
        externalKey: i.item.externalKey || null,
        name: i.item.name,
        role: i.item.role,
        contact: i.item.contact || null,
        activeFrom: i.item.activeFrom || null,
        activeTo: i.item.activeTo || null,
      })),
    ).toEqual(people);
  });

  it("reads back to rows that change nobody", () => {
    const existing = new Map(
      people
        .filter((p) => p.externalKey)
        .map((p) => [p.externalKey as string, { id: p.name, ...p } as unknown as ExistingPerson]),
    );
    const plan = planPeopleImport(parsePeopleCsv(peopleToCsv(people)).items, "overwrite", existing);
    expect(plan.rows.map((r) => r.action)).toEqual(["unchanged", "create", "error"]);
    // The third is refused only because the key "@x" is not a valid one; the first is unchanged.
    expect(plan.rows[2]?.message).toMatch(/letters, digits/);
  });

  it("has a template that reads without problems", () => {
    const out = parsePeopleCsv(peopleCsvTemplate());
    expect(out.problems).toEqual([]);
    expect(out.items).toHaveLength(2);
    const plan = planPeopleImport(out.items, "merge", there());
    expect(plan.rows.every((r) => r.action === "create")).toBe(true);
  });
});

describe("a person in a copy of the kitchen", () => {
  const person = {
    id: "0191a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b",
    role: "consumer",
    name: "Example Member",
    contact: null,
    status: "ACTIVE",
    activeFrom: null,
    activeTo: null,
    createdAt: "2026-10-01T00:00:00Z",
  };
  const people = BundleSchema.shape.people.element;

  it("may carry a key, and a copy made before there were keys has none and is still read", () => {
    expect(people.safeParse(person).success).toBe(true);
    expect(people.safeParse({ ...person, externalKey: "A-1" }).success).toBe(true);
    expect(people.safeParse({ ...person, externalKey: null }).success).toBe(true);
    expect(people.safeParse({ ...person, externalKey: 5 }).success).toBe(false);
  });
});

describe("the services a row names", () => {
  const SERVICES = ["Lunch", "Dinner"];
  const plan = (
    items: PersonImportItem[],
    existing = there(),
    mode: "merge" | "overwrite" = "merge",
  ) => planPeopleImport(entries(...items), mode, existing, SERVICES);
  const base = { role: "member", activeFrom: "2026-10-01" };

  it("reads a column called services, or service, with the names between bars, semicolons or commas", () => {
    const out = parsePeopleCsv(
      'name,role,activeFrom,services\nAsha,member,2026-10-01,Lunch|Dinner\nBo,member,2026-10-01,"Lunch, Dinner"\nCy,member,2026-10-01,\n',
    );
    expect(out.problems).toEqual([]);
    expect(out.items.map((i) => i.item.services)).toEqual(["Lunch|Dinner", "Lunch, Dinner", ""]);
    expect(parsePeopleCsv("name,role,service\nAsha,member,Lunch\n").items[0]?.item.services).toBe(
      "Lunch",
    );
    expect(parsePeopleCsv("name,role\nAsha,member\n").items[0]?.item).not.toHaveProperty(
      "services",
    );
  });

  it("names the services of a new member as the kitchen spells them, in any case, each once", () => {
    const out = plan([
      { name: "Asha", ...base, services: " dinner | LUNCH | dinner " },
      { name: "Bo", ...base, services: ["lunch"] },
      { name: "Cy", ...base },
      { name: "Di", ...base, services: "" },
    ]);
    expect(out.rows.map((r) => r.action)).toEqual(["create", "create", "create", "create"]);
    expect(out.creates.map((c) => c.services)).toEqual([
      ["Dinner", "Lunch"],
      ["Lunch"],
      null,
      null,
    ]);
    expect(out.rows[0]?.diff).toContainEqual({
      field: "services",
      from: null,
      to: "Dinner, Lunch",
    });
    expect(out.rows[2]?.diff.map((d) => d.field)).not.toContain("services");
  });

  it("refuses a name the kitchen does not have, services on a supplier, and services with no first date", () => {
    const out = plan([
      { name: "Asha", ...base, services: "Lunch|Supper" },
      { name: "Bo", role: "supplier", services: "Lunch" },
      { name: "Cy", role: "member", services: "Lunch" },
    ]);
    expect(out.rows.map((r) => r.action)).toEqual(["error", "error", "error"]);
    expect(out.rows[0]?.message).toBe(
      'No service called "Supper". This kitchen has: Lunch, Dinner.',
    );
    expect(out.rows[1]?.message).toBe("Only members take services.");
    expect(out.rows[2]?.message).toMatch(/Give the first date/);
    expect(out.creates).toEqual([]);
    expect(
      planPeopleImport(entries({ name: "Di", ...base, services: "Lunch" }), "merge", there())
        .rows[0]?.message,
    ).toBe('No service called "Lunch". This kitchen has no services yet.');
  });

  it("changes what a member takes only when the row names something different", () => {
    const here = there({
      externalKey: "A1",
      name: "Asha",
      activeFrom: "2026-10-01",
      services: ["Lunch", "Dinner"],
    });
    const row = (services: PersonImportItem["services"]) =>
      plan([{ externalKey: "A1", name: "Asha", ...base, services }], here);
    const same = row("dinner|lunch");
    expect(same.rows[0]?.action).toBe("unchanged");
    expect(same.updates).toEqual([]);
    const fewer = row("Dinner");
    expect(fewer.rows[0]).toMatchObject({ action: "update" });
    expect(fewer.rows[0]?.diff).toEqual([
      { field: "services", from: "Lunch, Dinner", to: "Dinner" },
    ]);
    expect(fewer.updates).toEqual([{ id: "id-A1", sets: {}, services: ["Dinner"] }]);
    // A blank cell, or no column, leaves them as they are, in both modes.
    for (const mode of ["merge", "overwrite"] as const)
      for (const services of ["", undefined])
        expect(
          plan([{ externalKey: "A1", name: "Asha", ...base, services }], here, mode).rows[0]
            ?.action,
        ).toBe("unchanged");
  });

  it("refuses services for a member who has no first date, even when the row names one", () => {
    const here = there({ externalKey: "A1", name: "Asha", activeFrom: null });
    const out = planPeopleImport(
      entries({ externalKey: "A1", name: "Asha", role: "member", services: "Lunch" }),
      "merge",
      here,
      SERVICES,
    );
    expect(out.rows[0]?.action).toBe("error");
    expect(out.rows[0]?.message).toMatch(/Give the first date/);
  });
});
