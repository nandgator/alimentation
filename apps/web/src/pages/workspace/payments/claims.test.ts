import type { ClaimDto, ClaimStatus } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  badgeOf,
  dueOf,
  inTab,
  rememberedMethod,
  rememberMethod,
  totalOf,
  waited,
} from "./claims.ts";

const claim = (status: ClaimStatus, amount = 1000): ClaimDto => ({
  id: `${status}${amount}`,
  consumerId: "p1",
  paidAt: "2026-11-20",
  forMonth: "2026-11",
  amount,
  method: "UPI",
  refNote: null,
  createdAt: "2026-11-20T06:00:00Z",
  status,
  decisionNote: null,
  decidedAt: null,
  reversalReason: null,
});

describe("tabs", () => {
  it("puts each claim on exactly one status tab, and on All", () => {
    const all: ClaimStatus[] = ["Pending", "Confirmed", "Disputed", "Reversed"];
    for (const s of all) {
      const tabs = (["to-confirm", "confirmed", "disputed"] as const).filter((t) =>
        inTab(t, claim(s)),
      );
      expect(tabs.length).toBe(s === "Reversed" ? 0 : 1);
      expect(inTab("all", claim(s))).toBe(true);
    }
  });
});

describe("totalOf", () => {
  it("leaves out a reversed claim", () => {
    expect(totalOf([claim("Confirmed", 500), claim("Reversed", 900), claim("Pending", 250)])).toBe(
      750,
    );
    expect(totalOf([])).toBe(0);
  });
});

describe("badgeOf", () => {
  it("names a reversed claim in words", () => {
    expect(badgeOf(claim("Reversed"))).toEqual({ status: "disabled", label: "Reversed" });
    expect(badgeOf(claim("Pending")).status).toBe("pending");
  });
});

describe("waited", () => {
  it("counts the kitchen's own days", () => {
    expect(waited("2026-11-25T08:00:00Z", "2026-11-25", "Asia/Kolkata")).toBe(
      "waiting since today",
    );
    expect(waited("2026-11-24T08:00:00Z", "2026-11-25", "Asia/Kolkata")).toBe(
      "waiting since yesterday",
    );
    expect(waited("2026-11-20T08:00:00Z", "2026-11-25", "Asia/Kolkata")).toBe("waiting 5 days");
  });
});

describe("dueOf", () => {
  const st = (personId: string, balance: number, earlierUnpaid: number, claimedPending = 0) =>
    ({ personId, billed: 1, balance, earlierUnpaid, claimedPending }) as never;
  it("adds this month's balance to what was unpaid before", () => {
    expect(dueOf([st("p1", 1000, 500, 300), st("p2", 9, 9)], "p1")).toEqual({
      due: 1500,
      claimed: 300,
    });
  });
  it("is negative when the kitchen holds credit", () => {
    expect(dueOf([st("p1", -800, 200)], "p1")?.due).toBe(-600);
  });
  it("is null with no statement, or only a meals-only one", () => {
    expect(dueOf([], "p1")).toBeNull();
    expect(dueOf([{ personId: "p1", counts: {} } as never], "p1")).toBeNull();
  });
});

describe("the remembered method", () => {
  it("falls back to UPI where storage is missing", () => {
    expect(rememberedMethod("kitchen")).toBe("UPI");
    expect(() => rememberMethod("kitchen", "Cash")).not.toThrow();
  });
});
