import type { BootstrapDto, LogEntryDto } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { daySlots, eatingToday } from "./today.ts";

// 2026-11-25 is a Wednesday; 2026-11-28 a Saturday.
const WED = "2026-11-25";
const SAT = "2026-11-28";

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  role: "consumer" as const,
  status: "ACTIVE" as const,
  activeFrom: "2026-01-01",
  activeTo: null,
  contact: null,
  linked: false,
  externalKey: null,
  ...over,
});

const facts = (over: Partial<BootstrapDto> = {}) =>
  ({
    services: [{ id: "lunch", name: "Lunch", position: 0, archivedOn: null }],
    catalogue: [
      { id: "veg", kind: "meal", name: "Veg", unit: "plate", maxQty: 1, archivedOn: null },
    ],
    menu: {
      id: "m",
      effectiveFrom: "2026-01-01",
      days: { lunch: { 1: "veg", 2: "veg", 3: "veg", 4: "veg", 5: "veg" } },
      offered: {},
      note: null,
    },
    holidays: [],
    policy: { workingDays: [1, 2, 3, 4, 5], holidays: { count: "confirmed" } },
    people: [
      person("a"),
      person("b"),
      person("c", { status: "DISABLED" }),
      person("d", { activeFrom: "2026-12-01" }),
    ],
    enrolments: ["a", "b", "c", "d"].map((personId) => ({
      personId,
      serviceId: "lunch",
      activeFrom: "2026-01-01",
      activeTo: null,
    })),
    ...over,
  }) as unknown as BootstrapDto;

const entry = (over: Partial<LogEntryDto>): LogEntryDto =>
  ({
    id: "e1",
    date: WED,
    personId: "a",
    allConsumers: false,
    action: "Leave",
    serviceId: null,
    itemId: null,
    qty: null,
    note: null,
    ...over,
  }) as LogEntryDto;

describe("a day's meals", () => {
  it("counts the people who are active, enrolled and not on leave", () => {
    const [s] = daySlots(facts(), WED, []);
    expect(s).toMatchObject({ state: "served", mealName: "Veg", eating: 2, onLeave: 0 });
    const [t] = daySlots(facts(), WED, [entry({})]);
    expect(t).toMatchObject({ eating: 1, onLeave: 1 });
    expect(eatingToday([t!])).toBe(1);
  });

  it("serves nothing on a day off the menu", () => {
    expect(daySlots(facts(), SAT, [])[0]).toMatchObject({
      state: "none",
      mealName: null,
      eating: 0,
    });
  });

  it("serves nothing on a confirmed holiday, and says which", () => {
    const b = facts({
      holidays: [{ id: "h", name: "Diwali", date: WED, location: null, confirmed: true }],
    });
    expect(daySlots(b, WED, [])[0]).toMatchObject({
      state: "holiday",
      holiday: "Diwali",
      eating: 0,
    });
    const unconfirmed = facts({
      holidays: [{ id: "h", name: "Diwali", date: WED, location: null, confirmed: false }],
    });
    expect(daySlots(unconfirmed, WED, [])[0]?.state).toBe("served");
  });

  it("serves nothing on a day the cook is off", () => {
    const off = entry({ action: "Supplier Off", personId: null, allConsumers: true });
    expect(daySlots(facts(), WED, [off])[0]?.state).toBe("off");
  });

  it("is a person's own day: on leave with the entry to take back, or eating", () => {
    expect(daySlots(facts(), WED, [], "a")[0]).toMatchObject({ state: "served", eating: 1 });
    expect(daySlots(facts(), WED, [entry({})], "a")[0]).toMatchObject({
      state: "leave",
      leaveEntryId: "e1",
    });
    // Leave for everyone is not theirs to take back.
    const all = entry({ id: "e2", personId: null, allConsumers: true });
    expect(daySlots(facts(), WED, [all], "a")[0]).toMatchObject({
      state: "leave",
      leaveEntryId: null,
    });
  });

  it("keeps a leave for one service to that service", () => {
    const b = facts({
      services: [
        { id: "lunch", name: "Lunch", position: 0, archivedOn: null },
        { id: "dinner", name: "Dinner", position: 1, archivedOn: null },
      ],
      menu: {
        id: "m",
        effectiveFrom: "2026-01-01",
        days: { lunch: { 3: "veg" }, dinner: { 3: "veg" } },
        offered: {},
        note: null,
      },
    });
    const slots = daySlots(b, WED, [entry({ serviceId: "dinner" })], "a");
    expect(slots.map((s) => s.state)).toEqual(["served", "leave"]);
  });
});
