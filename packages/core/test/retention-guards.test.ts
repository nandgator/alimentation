import { describe, expect, it } from "vitest";
import { checkEnrolment, checkMenu, checkRateCard, type Issue } from "../src/index.ts";
import { CARD_APR, ENROLMENTS, JOVIAL, MENU_APR, policyWith, prep } from "./fixtures.ts";

const codes = (i: Issue[]) => i.filter((x) => x.severity === "error").map((x) => x.code);

// After a cut the closes of the handed-over months are gone, so "that month is closed" no longer says
// anything about them. The archive itself has to refuse configuration dated into those months, because a
// card, a menu or an enrolment dated there and later than the last one before the cut would reach into
// live months and change what they come to.
describe("configuration cannot be dated into handed-over months", () => {
  const cut = { today: "2027-12-20", archivedThrough: "2026-10" } as const;
  const open = policyWith({ rateCards: { backdating: "unrestricted" } });

  it("refuses a rate card dated in a handed-over month, even where back-dating is unrestricted", () => {
    const p = prep({ ...cut, policies: [open], closes: [] });
    const card = { effectiveFrom: "2026-09-01", prices: CARD_APR.prices, monthlyFee: 1 };
    expect(codes(checkRateCard(p, card))).toContain("BACKDATED_RATE_CARD");
    expect(codes(checkRateCard(p, { ...card, effectiveFrom: "2026-10-31" }))).toContain(
      "BACKDATED_RATE_CARD",
    );
  });
  it("still lets an unrestricted kitchen back-date into live months", () => {
    const p = prep({ ...cut, policies: [open], closes: [] });
    const card = { effectiveFrom: "2026-11-01", prices: CARD_APR.prices, monthlyFee: 1 };
    expect(codes(checkRateCard(p, card))).not.toContain("BACKDATED_RATE_CARD");
  });
  it("refuses a menu dated in a handed-over month when nothing live is closed", () => {
    const p = prep({ ...cut, closes: [] });
    const m = { effectiveFrom: "2026-09-01", days: MENU_APR.days, offered: MENU_APR.offered };
    expect(codes(checkMenu(p, m))).toContain("BACKDATED_MENU");
  });
  it("refuses an enrolment that changes who took what in a handed-over month", () => {
    const p = prep({ ...cut, closes: [] });
    const own = ENROLMENTS.filter((e) => e.personId === JOVIAL.id);
    const rows = own.map(({ personId: _, ...r }) => ({ ...r, activeFrom: "2026-05-01" }));
    expect(
      codes(checkEnrolment(p, { personId: "admin", role: "admin" }, JOVIAL.id, rows)),
    ).toContain("MONTH_CLOSED");
  });
});
