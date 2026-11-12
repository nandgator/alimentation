import { describe, expect, it } from "vitest";
import {
  GROUP_LABEL,
  groupsFor,
  hrefOf,
  isHere,
  notHereWords,
  SECTIONS,
  sectionsFor,
} from "./sections.ts";

describe("the screens of a kitchen", () => {
  it("lists each screen once, with a unique address and name", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.path)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.label)).size).toBe(SECTIONS.length);
    expect(SECTIONS.every((s) => s.path === "" || s.path.startsWith("/"))).toBe(true);
    expect(SECTIONS.every((s) => s.group in GROUP_LABEL)).toBe(true);
  });

  it("gives a member and a supplier the everyday screens and their history, and nothing that manages the kitchen", () => {
    for (const role of ["consumer", "supplier"] as const)
      expect(sectionsFor(role).map((s) => s.label)).toEqual([
        "Dashboard",
        "Daily",
        "My log",
        "Payments",
        "History",
      ]);
  });

  it("gives the admin the audit trail where the others have their history", () => {
    const admin = sectionsFor("admin").map((s) => s.label);
    expect(admin).toContain("Audit");
    expect(admin).not.toContain("History");
  });

  it("gives the admin every screen, in three groups", () => {
    expect(sectionsFor("admin")).toHaveLength(SECTIONS.length - 1);
    expect(groupsFor("admin").map((g) => [g.label, g.sections.map((s) => s.label)])).toEqual([
      ["Day to day", ["Dashboard", "Daily", "My log", "Payments"]],
      ["The kitchen", ["People", "Catalogue", "Menu", "Prices", "Rates & rules", "Holidays"]],
      ["The books", ["Settlements", "Month close", "Audit", "Your data"]],
    ]);
  });

  it("holds back Payments and Settlements in a kitchen with money until it has prices", () => {
    expect(sectionsFor("admin", true, false).map((s) => s.label)).not.toContain("Payments");
    expect(sectionsFor("admin", true, false).map((s) => s.label)).not.toContain("Settlements");
    expect(sectionsFor("admin", true, false).map((s) => s.label)).toContain("Prices");
    expect(sectionsFor("consumer", true, false).map((s) => s.label)).toEqual([
      "Dashboard",
      "Daily",
      "My log",
      "History",
    ]);
    expect(sectionsFor("admin", true, true)).toEqual(sectionsFor("admin"));
    // A kitchen without money is not asked about prices at all.
    expect(sectionsFor("admin", false, false)).toEqual(sectionsFor("admin", false));
  });

  it("does not offer History to the admin, who has the audit trail", () => {
    for (const money of [true, false])
      expect(sectionsFor("admin", money).some((s) => s.key === "history")).toBe(false);
  });

  it("leaves out every screen about money for a kitchen that does not track it, and says Rules for Rates & rules", () => {
    const moneyScreens = SECTIONS.filter((s) => s.money).map((s) => s.label);
    expect(moneyScreens).toEqual(["Payments", "Prices", "Settlements"]);
    expect(groupsFor("admin", false).map((g) => [g.label, g.sections.map((s) => s.label)])).toEqual(
      [
        ["Day to day", ["Dashboard", "Daily", "My log"]],
        ["The kitchen", ["People", "Catalogue", "Menu", "Rules", "Holidays"]],
        ["The books", ["Month close", "Audit", "Your data"]],
      ],
    );
    for (const role of ["consumer", "supplier"] as const)
      expect(sectionsFor(role, false).map((s) => s.label)).toEqual([
        "Dashboard",
        "Daily",
        "My log",
        "History",
      ]);
    // And nothing else of a screen changes: the address is the same.
    expect(sectionsFor("admin", false).find((s) => s.key === "rates")?.path).toBe("/rates");
    expect(sectionsFor("admin", false).some((s) => s.money)).toBe(false);
  });

  it("leaves out a group that holds nothing for the role", () => {
    expect(groupsFor("consumer").map((g) => g.key)).toEqual(["day"]);
  });

  it("knows which screen it is on, and does not mistake a longer address for it", () => {
    const base = "/w/kitchen";
    const [dashboard, , , payments] = SECTIONS;
    expect(hrefOf(base, dashboard!)).toBe("/w/kitchen");
    expect(isHere(base, dashboard!, "/w/kitchen")).toBe(true);
    expect(isHere(base, dashboard!, "/w/kitchen/")).toBe(true);
    expect(isHere(base, dashboard!, "/w/kitchen/payments")).toBe(false);
    expect(isHere(base, payments!, "/w/kitchen/payments")).toBe(true);
    expect(isHere(base, payments!, "/w/kitchen/payments/9")).toBe(true);
    expect(isHere(base, payments!, "/w/kitchen/payments-old")).toBe(false);
  });
});

describe("what is said at an address with no screen for the role", () => {
  it("names the screen when it exists for another role, and otherwise says there is nothing", () => {
    expect(notHereWords("/w/maple", "/w/maple/history", "admin")).toBe(
      "History is not part of the admin view of this kitchen.",
    );
    expect(notHereWords("/w/maple", "/w/maple/people", "consumer")).toBe(
      "People is not part of the member view of this kitchen.",
    );
    expect(notHereWords("/w/maple", "/w/maple/nowhere", "admin")).toBe(
      "There is nothing at this address for your role.",
    );
    // A screen the role has, but the kitchen does not show, is not a matter of role.
    expect(notHereWords("/w/maple", "/w/maple/payments", "admin")).toBe(
      "There is nothing at this address for your role.",
    );
  });
});
