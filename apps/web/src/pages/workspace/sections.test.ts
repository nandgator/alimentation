import { describe, expect, it } from "vitest";
import {
  denial,
  homeOf,
  hrefOf,
  isHere,
  labelFor,
  navFor,
  ROLE_LABEL,
  SECTIONS,
  sectionsFor,
  TABS,
  tabsFor,
  titleFor,
  whereIs,
} from "./sections.ts";

const labels = (xs: { label: string }[]) => xs.map((s) => s.label);
const names = (role: "admin" | "supplier" | "consumer", money = true, priced = true) => {
  const nav = navFor(role, money, priced);
  return {
    side: nav.side.map((s) => labelFor(s, role)),
    bar: nav.bar.map((s) => labelFor(s, role)),
    more: nav.more.map((s) => labelFor(s, role)),
  };
};

describe("the screens of a kitchen", () => {
  it("lists each screen once, with a unique address, name and icon", () => {
    expect(new Set(SECTIONS.map((s) => s.key)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.path)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.label)).size).toBe(SECTIONS.length);
    expect(new Set(SECTIONS.map((s) => s.icon)).size).toBe(SECTIONS.length);
    expect(SECTIONS.every((s) => s.path === "" || s.path.startsWith("/"))).toBe(true);
    expect(new Set(TABS.map((t) => `${t.hub}${t.path}`)).size).toBe(TABS.length);
  });

  it("names the roles Admin, Cook and Consumer on screen", () => {
    expect(ROLE_LABEL).toEqual({ admin: "Admin", supplier: "Cook", consumer: "Consumer" });
  });

  it("gives the admin seven entries on a wide screen, and four in the bar and three behind More on a phone", () => {
    expect(names("admin")).toEqual({
      side: ["Home", "Today", "People", "Payments", "Bills", "Setup", "Books"],
      bar: ["Home", "Today", "Payments", "People"],
      more: ["Bills", "Setup", "Books"],
    });
  });

  it("gives the cook and the consumer their own four, and no More", () => {
    expect(names("supplier")).toEqual({
      side: ["Today", "Meals", "Payments", "History"],
      bar: ["Today", "Meals", "Payments", "History"],
      more: [],
    });
    expect(names("consumer")).toEqual({
      side: ["Home", "Meals", "Pay", "History"],
      bar: ["Home", "Meals", "Pay", "History"],
      more: [],
    });
  });

  it("calls the payments screen Pay for a consumer only, and Meals My meals at the top of the page", () => {
    const payments = SECTIONS.find((s) => s.key === "payments");
    const meals = SECTIONS.find((s) => s.key === "meals");
    expect(labelFor(payments!, "consumer")).toBe("Pay");
    expect(labelFor(payments!, "admin")).toBe("Payments");
    expect(labelFor(payments!, "supplier")).toBe("Payments");
    expect(titleFor(meals!, "consumer")).toBe("My meals");
    expect(titleFor(meals!, "supplier")).toBe("Meals");
  });

  it("starts a cook at Today and everyone else at the kitchen's own address", () => {
    expect(homeOf("/w/k", "supplier")).toBe("/w/k/today");
    expect(homeOf("/w/k", "admin")).toBe("/w/k");
    expect(homeOf("/w/k", "consumer")).toBe("/w/k");
  });

  it("does not offer History to the admin, who has the audit trail under Books", () => {
    for (const money of [true, false])
      expect(sectionsFor("admin", money).some((s) => s.key === "history")).toBe(false);
    expect(tabsFor("books").map((t) => t.label)).toContain("Audit");
  });

  it("holds back Payments and Bills in a kitchen with money until it has prices", () => {
    expect(labels(sectionsFor("admin", true, false))).not.toContain("Payments");
    expect(labels(sectionsFor("admin", true, false))).not.toContain("Bills");
    expect(labels(sectionsFor("admin", true, false))).toContain("Setup");
    expect(names("admin", true, false)).toEqual({
      side: ["Home", "Today", "People", "Setup", "Books"],
      bar: ["Home", "Today", "People"],
      more: ["Setup", "Books"],
    });
    expect(tabsFor("books", true, false).map((t) => t.label)).not.toContain("Settlements");
    expect(tabsFor("setup", true, false).map((t) => t.label)).toContain("Prices");
    expect(sectionsFor("admin", true, true)).toEqual(sectionsFor("admin"));
    // A kitchen without money is not asked about prices at all.
    expect(sectionsFor("admin", false, false)).toEqual(sectionsFor("admin", false));
  });

  it("leaves out every screen and tab about money for a kitchen that does not track it", () => {
    expect(SECTIONS.filter((s) => s.money).map((s) => s.label)).toEqual(["Payments", "Bills"]);
    expect(TABS.filter((t) => t.money).map((t) => t.label)).toEqual(["Prices", "Settlements"]);
    expect(names("admin", false)).toEqual({
      side: ["Home", "Today", "People", "Setup", "Books"],
      bar: ["Home", "Today", "People"],
      more: ["Setup", "Books"],
    });
    expect(names("supplier", false).side).toEqual(["Today", "Meals", "History"]);
    expect(names("consumer", false).side).toEqual(["Home", "Meals", "History"]);
    expect(tabsFor("setup", false).map((t) => t.label)).toEqual([
      "What you serve",
      "Menu",
      "Rules",
      "Holidays",
    ]);
    expect(tabsFor("books", false).map((t) => t.label)).toEqual([
      "Month end",
      "Older months",
      "Audit",
      "Your data",
    ]);
    expect(sectionsFor("admin", false).some((s) => s.money)).toBe(false);
  });

  it("has the tabs of the two hubs in the order of the plan", () => {
    expect(tabsFor("setup").map((t) => t.label)).toEqual([
      "What you serve",
      "Menu",
      "Prices",
      "Rules",
      "Holidays",
    ]);
    expect(tabsFor("books").map((t) => t.label)).toEqual([
      "Month end",
      "Settlements",
      "Older months",
      "Audit",
      "Your data",
    ]);
  });

  it("knows which screen it is on, and does not mistake a longer address for it", () => {
    const base = "/w/kitchen";
    const home = SECTIONS.find((s) => s.key === "home")!;
    const payments = SECTIONS.find((s) => s.key === "payments")!;
    expect(hrefOf(base, home)).toBe("/w/kitchen");
    expect(isHere(base, home, "/w/kitchen")).toBe(true);
    expect(isHere(base, home, "/w/kitchen/")).toBe(true);
    expect(isHere(base, home, "/w/kitchen/payments")).toBe(false);
    expect(isHere(base, payments, "/w/kitchen/payments")).toBe(true);
    expect(isHere(base, payments, "/w/kitchen/payments/9")).toBe(true);
    expect(isHere(base, payments, "/w/kitchen/payments-old")).toBe(false);
  });

  it("finds the screen, the tab and the record at an address", () => {
    const base = "/w/k";
    expect(whereIs(base, "/w/k")?.section.key).toBe("home");
    expect(whereIs(base, "/w/k/setup/rules")?.tab?.key).toBe("rules");
    expect(whereIs(base, "/w/k/books/month-end")?.tab?.label).toBe("Month end");
    expect(whereIs(base, "/w/k/setup")?.tab).toBeUndefined();
    expect(whereIs(base, "/w/k/people/abc")).toMatchObject({
      section: { key: "people" },
      rest: "abc",
    });
    expect(whereIs(base, "/w/k/nowhere")).toBeNull();
  });
});

describe("what is said at an address with no screen for the role", () => {
  it("names who has the screen and who to ask when it belongs to another role", () => {
    expect(denial("/w/maple", "/w/maple/people", "consumer", "Asha Rao")).toEqual({
      title: "This is for admins",
      reason: "People is open to admins. Ask Asha Rao if you need it.",
    });
    expect(denial("/w/maple", "/w/maple/setup/menu", "supplier").reason).toBe(
      "Setup is open to admins. Ask your admin if you need it.",
    );
    expect(denial("/w/maple", "/w/maple/history", "admin").title).toBe(
      "This is for cooks and consumers",
    );
    expect(denial("/w/maple", "/w/maple/today", "consumer").title).toBe(
      "This is for admins and cooks",
    );
  });

  it("says the page is not found when it is no screen of the kitchen", () => {
    expect(denial("/w/maple", "/w/maple/nowhere", "admin").title).toBe("Page not found");
    // A screen the role has, but the kitchen does not show, is not a matter of role.
    expect(denial("/w/maple", "/w/maple/payments", "admin").title).toBe("Page not found");
  });
});
