import { type LogChoice, logChoices } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import { allowedActions, resolveForm, unionChoices } from "./logForm.ts";

const choice = {
  leaveWhole: { action: "Leave", serviceId: null },
  leaveLunch: { action: "Leave", serviceId: "lunch" },
  leaveDinner: { action: "Leave", serviceId: "dinner" },
  offWhole: { action: "Supplier Off", serviceId: null },
  switchLunch: { action: "Switch", serviceId: "lunch", itemId: "khichdi" },
  switchDinner: { action: "Switch", serviceId: "dinner", itemId: "khichdi" },
  extraLunch: { action: "Extra", serviceId: "lunch", itemId: "curd", maxQty: 4 },
  extraDinner: { action: "Extra", serviceId: "dinner", itemId: "curd", maxQty: 4 },
  extraDinnerTea: { action: "Extra", serviceId: "dinner", itemId: "tea", maxQty: 9 },
} satisfies Record<string, LogChoice>;

const one: LogChoice[] = [
  choice.leaveWhole,
  choice.offWhole,
  choice.switchLunch,
  choice.extraLunch,
];
const three: LogChoice[] = [
  choice.leaveWhole,
  choice.leaveLunch,
  choice.leaveDinner,
  choice.offWhole,
  choice.switchLunch,
  choice.switchDinner,
  choice.extraLunch,
  choice.extraDinner,
  choice.extraDinnerTea,
];
const all = allowedActions("admin");

describe("the log form, built from the legal choices", () => {
  it("offers a kitchen with one service no service control at all", () => {
    for (const action of ["Leave", "Switch", "Extra"] as const) {
      const v = resolveForm(one, all, { action });
      expect(v.showScope).toBe(false);
      expect(v.showService).toBe(false);
    }
    expect(resolveForm(one, all, { action: "Extra" })).toMatchObject({
      serviceId: "lunch",
      itemId: "curd",
      maxQty: 4,
    });
  });

  it("starts Leave on the whole day and offers each service when there are several", () => {
    const v = resolveForm(three, all, {});
    expect(v.action).toBe("Leave");
    expect(v.serviceId).toBeNull();
    expect(v.showScope).toBe(true);
    expect(v.scopes).toEqual([null, "lunch", "dinner"]);
    expect(resolveForm(three, all, { action: "Leave", serviceId: "dinner" }).serviceId).toBe(
      "dinner",
    );
  });

  it("asks for a service on a switch or an extra when there are two or more, and only offers what that service offers", () => {
    const v = resolveForm(three, all, { action: "Extra", serviceId: "dinner" });
    expect(v.showService).toBe(true);
    expect(v.items).toEqual(["curd", "tea"]);
    expect(v.maxQty).toBe(4);
    expect(
      resolveForm(three, all, { action: "Extra", serviceId: "dinner", itemId: "tea" }).maxQty,
    ).toBe(9);
    // A pick that is no longer legal gives way to the first that is.
    expect(
      resolveForm(three, all, { action: "Extra", serviceId: "lunch", itemId: "tea" }).itemId,
    ).toBe("curd");
    expect(resolveForm(three, all, { action: "Extra", serviceId: "nowhere" }).serviceId).toBe(
      "lunch",
    );
  });

  it("leaves Supplier Off to the supplier and the admin, and takes it away from a member", () => {
    expect(allowedActions("consumer")).toEqual(["Leave", "Switch", "Extra"]);
    expect(allowedActions("supplier")).toEqual(["Supplier Off"]);
    expect(allowedActions("admin")).toEqual(["Leave", "Switch", "Extra", "Supplier Off"]);
    expect(resolveForm(three, allowedActions("consumer"), {}).actions).not.toContain(
      "Supplier Off",
    );
    expect(resolveForm(three, allowedActions("supplier"), {}).actions).toEqual(["Supplier Off"]);
  });

  it("offers nothing when nothing is legal", () => {
    const v = resolveForm([], all, {});
    expect(v.action).toBeNull();
    expect(v.actions).toEqual([]);
  });

  it("joins several people's choices without repeating one", () => {
    expect(
      unionChoices([
        [choice.leaveWhole, choice.offWhole],
        [choice.offWhole, choice.leaveLunch],
      ]),
    ).toEqual([choice.leaveWhole, choice.offWhole, choice.leaveLunch]);
  });

  it("works from the engine's own choices for a real menu", () => {
    const catalogue = [
      { id: "thali", kind: "meal", name: "Thali", unit: "plate", maxQty: 20, archivedOn: null },
      { id: "khichdi", kind: "meal", name: "Khichdi", unit: "plate", maxQty: 20, archivedOn: null },
      { id: "curd", kind: "addon", name: "Curd", unit: "cup", maxQty: 6, archivedOn: null },
    ] as const;
    const services = [{ id: "meals", name: "Meals", position: 0, archivedOn: null }];
    const menu = {
      id: "m",
      effectiveFrom: "2026-04-01",
      days: { meals: { 1: "thali" } },
      offered: { meals: ["thali", "khichdi", "curd"] },
      note: null,
    };
    const person = { id: "p", activeFrom: "2026-04-01", activeTo: null };
    const enrol = [{ personId: "p", serviceId: "meals", activeFrom: "2026-04-01", activeTo: null }];
    // 2026-10-05 is a Monday.
    const v = resolveForm(logChoices(menu, catalogue, services, person, "2026-10-05", enrol), all, {
      action: "Switch",
    });
    expect(v.showService).toBe(false);
    expect(v.items).toEqual(["khichdi"]);
    // Tuesday has no cell: nothing to log.
    expect(
      resolveForm(logChoices(menu, catalogue, services, person, "2026-10-06", enrol), all, {})
        .action,
    ).toBeNull();
  });
});
