import type { LogEntryDto, MenuVersion } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { buildRoll, headcount, type RollKitchen } from "./roll.ts";

// 2026-11-25 is a Wednesday.
const DAY = "2026-11-25";
const person = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  role: "consumer" as const,
  status: "ACTIVE" as const,
  activeFrom: "2026-11-01",
  activeTo: null,
  contact: null,
  linked: false,
  externalKey: null,
  ...extra,
});
const enrol = (personId: string, serviceId: string, extra: object = {}) => ({
  personId,
  serviceId,
  activeFrom: "2026-11-01",
  activeTo: null,
  ...extra,
});
const kitchen: RollKitchen = {
  people: [
    person("a", "Asha"),
    person("b", "Bela"),
    person("c", "Chitra"),
    person("z", "Zed", { role: "admin" }),
  ],
  services: [
    { id: "lunch", name: "Lunch", position: 1, archivedOn: null },
    { id: "breakfast", name: "Breakfast", position: 0, archivedOn: null },
  ],
  enrolments: [
    enrol("a", "lunch"),
    enrol("b", "lunch"),
    enrol("c", "lunch", { activeFrom: "2026-12-01" }),
    enrol("a", "breakfast"),
  ],
  holidays: [],
  catalogue: [],
  policy: {
    workingDays: [1, 2, 3, 4, 5],
    holidays: { count: "confirmed" },
  } as RollKitchen["policy"],
};
const menu: MenuVersion = {
  id: "m",
  effectiveFrom: "2026-11-01",
  days: { lunch: { 3: "thali" }, breakfast: { 3: "poha" } },
  offered: {},
  note: null,
};
const entry = (e: Partial<LogEntryDto>): LogEntryDto => ({
  id: "e",
  date: DAY,
  personId: "a",
  allConsumers: false,
  action: "Leave",
  serviceId: null,
  itemId: null,
  qty: null,
  note: null,
  loggedBy: "z",
  loggedAt: "2026-11-24T10:00:00Z",
  by: "You",
  lateByDays: 0,
  ...e,
});

describe("the roll for a day", () => {
  it("lists the services the menu serves, in order, with the people who take each", () => {
    const r = buildRoll(kitchen, menu, [], DAY);
    expect(r.day).toEqual({ open: true });
    expect(r.services.map((s) => s.service.name)).toEqual(["Breakfast", "Lunch"]);
    expect(r.services[1]?.rows.map((x) => x.person.name)).toEqual(["Asha", "Bela"]);
    expect(r.services[1]?.mealId).toBe("thali");
    expect(r.services[1]?.eating).toBe(2);
  });

  it("puts a person on leave for the service, or for the whole day", () => {
    const one = buildRoll(kitchen, menu, [entry({ serviceId: "lunch" })], DAY);
    expect(one.services[1]?.onLeave).toBe(1);
    expect(one.services[0]?.onLeave).toBe(0);
    const whole = buildRoll(kitchen, menu, [entry({ serviceId: null })], DAY);
    expect(whole.services.map((s) => s.onLeave)).toEqual([1, 1]);
    expect(whole.services[1]?.rows[0]?.leave?.id).toBe("e");
  });

  it("counts a day the kitchen is off for nobody", () => {
    const off = entry({
      action: "Supplier Off",
      personId: null,
      allConsumers: true,
      serviceId: "lunch",
    });
    const r = buildRoll(kitchen, menu, [off], DAY);
    expect(r.services[1]).toMatchObject({ kitchenOff: true, eating: 0 });
    expect(r.services[0]).toMatchObject({ kitchenOff: false, eating: 1 });
  });

  it("serves the latest switch and adds extras up", () => {
    const r = buildRoll(
      kitchen,
      menu,
      [
        entry({
          id: "s1",
          action: "Switch",
          serviceId: "lunch",
          itemId: "khichdi",
          loggedAt: "2026-11-24T09:00:00Z",
        }),
        entry({
          id: "s2",
          action: "Switch",
          serviceId: "lunch",
          itemId: "rice",
          loggedAt: "2026-11-24T11:00:00Z",
        }),
        entry({ id: "x1", action: "Extra", serviceId: "lunch", itemId: "curd", qty: 1 }),
        entry({ id: "x2", action: "Extra", serviceId: "lunch", itemId: "curd", qty: 2 }),
      ],
      DAY,
    );
    const asha = r.services[1]?.rows[0];
    expect(asha).toMatchObject({ mealId: "rice", switched: true });
    expect(asha?.extras).toMatchObject([{ itemId: "curd", qty: 3 }]);
    expect(asha?.extras[0]?.entries).toHaveLength(2);
    expect(r.services[1]?.extras).toBe(3);
  });

  it("says why a day is closed", () => {
    expect(buildRoll(kitchen, menu, [], "2026-11-28").day).toEqual({ open: false, why: "weekend" });
    expect(buildRoll(kitchen, null, [], DAY).day).toEqual({ open: false, why: "no-menu" });
    const withHoliday = {
      ...kitchen,
      holidays: [{ id: "h", name: "Diwali", date: DAY, location: null, confirmed: true }],
    };
    expect(buildRoll(withHoliday, menu, [], DAY).day).toEqual({
      open: false,
      why: "holiday",
      name: "Diwali",
    });
    const unconfirmed = {
      ...kitchen,
      holidays: [{ id: "h", name: "Diwali", date: DAY, location: null, confirmed: false }],
    };
    expect(buildRoll(unconfirmed, menu, [], DAY).day).toEqual({ open: true });
  });

  it("leaves out people who are not active that day or not enrolled yet", () => {
    const r = buildRoll(
      {
        ...kitchen,
        people: [person("a", "Asha", { activeTo: "2026-11-20" }), person("b", "Bela")],
      },
      menu,
      [],
      DAY,
    );
    expect(r.services[1]?.rows.map((x) => x.person.name)).toEqual(["Bela"]);
  });
});

describe("the head count in words", () => {
  it("leaves out what is nil", () => {
    expect(headcount({ eating: 18, onLeave: 2, extras: 0, kitchenOff: false })).toBe(
      "18 eating · 2 on leave",
    );
    expect(headcount({ eating: 3, onLeave: 0, extras: 1, kitchenOff: false })).toBe(
      "3 eating · 1 extra",
    );
    expect(headcount({ eating: 0, onLeave: 0, extras: 0, kitchenOff: true })).toBe(
      "The kitchen is off",
    );
  });
});
