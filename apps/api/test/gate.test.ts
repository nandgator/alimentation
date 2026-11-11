import { FREE_LIMITS } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import type { ControlRepo } from "../src/control/repo.ts";
import { Gate } from "../src/limits/gate.ts";

const gateAt = (clock: { now: Date }) =>
  new Gate({
    control: {
      requestsToday: async () => ({ total: 0, byWorkspace: new Map<string, number>() }),
      addUsage: async () => undefined,
    } as unknown as ControlRepo,
    now: () => clock.now,
    hardCapFactor: 3,
    accountDailyCap: 100_000,
    headroom: 0.1,
    burst: 5,
    refillPerSecond: 1,
  });

const ws = { id: "w1", limits: FREE_LIMITS };

describe("[P1] one workspace cannot use up the share of others", () => {
  it("turns away a flood and lets traffic through again as the bucket refills", async () => {
    const clock = { now: new Date("2026-10-24T06:00:00Z") };
    const gate = gateAt(clock);
    const verdicts = [];
    for (let i = 0; i < 7; i++) verdicts.push((await gate.admit(ws)).allowed);
    expect(verdicts).toEqual([true, true, true, true, true, false, false]);
    clock.now = new Date(clock.now.getTime() + 3000);
    expect((await gate.admit(ws)).allowed).toBe(true);
  });

  it("is not thrown off when the clock steps backwards", async () => {
    const clock = { now: new Date("2026-10-24T08:00:00Z") };
    const gate = gateAt(clock);
    expect((await gate.admit(ws)).allowed).toBe(true);
    clock.now = new Date("2026-10-24T06:00:00Z"); // two hours earlier
    for (let i = 0; i < 4; i++) expect((await gate.admit(ws)).allowed).toBe(true);
  });
});

describe("a request that belongs to no kitchen passes the same bucket", () => {
  it("is slowed by its own key, and refills with time, without touching a kitchen's bucket", async () => {
    const clock = { now: new Date("2026-10-24T06:00:00Z") };
    const gate = gateAt(clock);
    const taken = [];
    for (let i = 0; i < 7; i++) taken.push(gate.throttle("waitlist:a") === null);
    expect(taken).toEqual([true, true, true, true, true, false, false]);
    // Someone else's key, and a kitchen, are not slowed by it.
    expect(gate.throttle("waitlist:b")).toBeNull();
    expect((await gate.admit(ws)).allowed).toBe(true);
    clock.now = new Date(clock.now.getTime() + 3000);
    expect(gate.throttle("waitlist:a")).toBeNull();
  });
});
