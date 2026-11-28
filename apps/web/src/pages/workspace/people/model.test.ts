import type { PersonDto, Role } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { canInvite, detailLine, groupPeople, isShow, showCounts, visibleMembers } from "./model.ts";

const person = (
  id: string,
  name: string,
  role: Role,
  over: Partial<PersonDto> = {},
): PersonDto => ({
  id,
  name,
  role,
  status: "ACTIVE",
  activeFrom: null,
  activeTo: null,
  contact: null,
  linked: false,
  externalKey: null,
  ...over,
});

describe("one row for each person", () => {
  it("joins an owner who is also the cook, and gives them both badges", () => {
    const m = groupPeople([
      person("s", "Owner", "supplier", { linked: true }),
      person("a", "Owner", "admin", { linked: true }),
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]?.id).toBe("a");
    expect(m[0]?.roles).toEqual(["admin", "supplier"]);
    expect(m[0]?.rows.map((r) => r.id)).toEqual(["a", "s"]);
  });

  it("keeps two people with one name apart unless both are signed in with different roles", () => {
    expect(
      groupPeople([person("1", "Asha Rao", "consumer"), person("2", "Asha Rao", "consumer")]),
    ).toHaveLength(2);
    expect(
      groupPeople([
        person("1", "Asha Rao", "consumer", { linked: true }),
        person("2", "Asha Rao", "consumer", { linked: true }),
      ]),
    ).toHaveLength(2);
    expect(
      groupPeople([
        person("1", "Asha Rao", "consumer", { linked: true }),
        person("2", "Asha Rao", "supplier", { linked: false }),
      ]),
    ).toHaveLength(2);
  });

  it("never joins people who have a key, or who are in different states", () => {
    expect(
      groupPeople([
        person("1", "Kabir", "admin", { linked: true, externalKey: "K-1" }),
        person("2", "Kabir", "supplier", { linked: true }),
      ]),
    ).toHaveLength(2);
    expect(
      groupPeople([
        person("1", "Kabir", "admin", { linked: true }),
        person("2", "Kabir", "supplier", { linked: true, status: "DISABLED" }),
      ]),
    ).toHaveLength(2);
  });

  it("lists people by name, without regard to case", () => {
    const names = groupPeople([
      person("1", "zara", "consumer"),
      person("2", "Asha", "consumer"),
      person("3", "Meera", "consumer"),
    ]).map((m) => m.main.name);
    expect(names).toEqual(["Asha", "Meera", "zara"]);
  });
});

describe("what the filter chips show", () => {
  const members = groupPeople([
    person("1", "Asha", "consumer"),
    person("2", "Kabir", "consumer", { status: "DISABLED" }),
    person("3", "Lakshmi", "supplier"),
    person("4", "Owner", "admin", { linked: true }),
    person("5", "Owner", "supplier", { linked: true }),
  ]);

  it("hides the disabled unless they are asked for", () => {
    expect(visibleMembers(members, "all").map((m) => m.main.name)).toEqual([
      "Asha",
      "Lakshmi",
      "Owner",
    ]);
    expect(visibleMembers(members, "disabled").map((m) => m.main.name)).toEqual(["Kabir"]);
  });

  it("filters by a role anyone holds, so the owner is both an admin and a cook", () => {
    expect(visibleMembers(members, "supplier").map((m) => m.main.name)).toEqual([
      "Lakshmi",
      "Owner",
    ]);
    expect(visibleMembers(members, "admin").map((m) => m.main.name)).toEqual(["Owner"]);
    expect(visibleMembers(members, "consumer").map((m) => m.main.name)).toEqual(["Asha"]);
  });

  it("counts each chip", () => {
    expect(showCounts(members)).toEqual({
      all: 3,
      consumer: 1,
      supplier: 2,
      admin: 1,
      disabled: 1,
    });
  });

  it("knows a filter from a stray address parameter", () => {
    expect(isShow("disabled")).toBe(true);
    expect(isShow("members")).toBe(false);
  });
});

describe("a row's details", () => {
  it("puts the key before the contact", () => {
    expect(
      detailLine(person("1", "A", "consumer", { externalKey: "A-1", contact: "x@example.org" })),
    ).toBe("A-1 · x@example.org");
    expect(detailLine(person("1", "A", "consumer"))).toBe("");
  });

  it("invites only an active person nobody has signed in as", () => {
    const [a] = groupPeople([person("1", "A", "consumer")]);
    const [b] = groupPeople([person("2", "B", "consumer", { linked: true })]);
    const [c] = groupPeople([person("3", "C", "consumer", { status: "DISABLED" })]);
    expect([a, b, c].map((m) => (m ? canInvite(m) : null))).toEqual([true, false, false]);
  });
});
