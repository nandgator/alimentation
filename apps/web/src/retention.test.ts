import { describe, expect, it } from "vitest";
import { ApiFailure } from "./api.ts";
import {
  archivedWords,
  blockerWords,
  bytesWords,
  monthAfter,
  monthWords,
  stepOf,
  typedMatches,
} from "./retention.ts";

const names = (id: string) => ({ w: "Willow", m: "Maple" })[id];

describe("older months, in words", () => {
  it("writes a month with its year and no machine date", () => {
    expect(monthWords("2025-10")).toBe("Oct 2025");
    expect(monthAfter("2025-12" as never)).toBe("2026-01");
    expect(monthAfter("2025-03" as never)).toBe("2025-04");
  });

  it("says what stands in the way of a month, and for whom, with no code", () => {
    const text = [
      blockerWords(
        { month: "2025-02", code: "not_closed", people: 2, personIds: ["w", "m"] },
        names,
      ),
      blockerWords({ month: "2025-02", code: "pending_claim", people: 1, personIds: ["w"] }, names),
      blockerWords({ month: "2025-02", code: "open_query", people: 1, personIds: ["m"] }, names),
      blockerWords(
        { month: "2025-02", code: "changed_after_close", people: 1, personIds: ["m"] },
        names,
      ),
      blockerWords({ month: "2025-02", code: "too_recent", people: 0, personIds: [] }, names),
    ];
    expect(text[0]).toBe(
      "Feb 2025: bills are not closed yet (Willow, Maple). Close the month first.",
    );
    expect(text[1]).toBe("Feb 2025: a payment claim is still waiting for a decision (Willow).");
    expect(text[4]).toBe("Feb 2025: too recent. The newest months always stay.");
    for (const t of text) expect(t).not.toMatch(/[a-z]+_[a-z]+|\d{4}-\d{2}/);
  });

  it("counts people it does not name", () => {
    expect(
      blockerWords(
        { month: "2025-02", code: "not_closed", people: 12, personIds: ["w", "m"] },
        names,
      ),
    ).toContain("Willow, Maple and 10 more");
  });

  it("sizes in plain units", () => {
    expect(bytesWords(100)).toBe("1 KB");
    expect(bytesWords(2 * 1048576)).toBe("2.0 MB");
  });

  it("matches the month as shown, ignoring case and spacing", () => {
    expect(typedMatches(" Oct  2025 ", "2025-10")).toBe(true);
    expect(typedMatches("oct 2025", "2025-10")).toBe(true);
    expect(typedMatches("2025-10", "2025-10")).toBe(false);
    expect(typedMatches("Nov 2025", "2025-10")).toBe(false);
    expect(typedMatches("", "2025-10")).toBe(false);
  });

  it("knows which step a hand-over is at", () => {
    const o = (state: string) => ({
      id: "x",
      throughMonth: "2025-10",
      state,
      expiresAt: "",
      checksum: "",
    });
    expect(stepOf(null)).toBe("choose");
    expect(stepOf(o("OFFERED") as never)).toBe("upload");
    expect(stepOf(o("CONFIRMED") as never)).toBe("apply");
    expect(stepOf(o("PURGING") as never)).toBe("running");
    expect(stepOf(o("DONE") as never)).toBe("choose");
  });

  it("words the refusal for an archived month, and leaves any other alone", () => {
    const gone = new ApiFailure(410, "archived_month", "raw", [], { archivedThrough: "2025-10" });
    const words = archivedWords(gone);
    expect(words).toContain("Records through Oct 2025 were handed over");
    expect(words).toContain("first month kept is Nov 2025");
    expect(words).not.toMatch(/archived_month|\d{4}-\d{2}/);
    expect(archivedWords(new ApiFailure(410, "archived_month", "raw"))).toContain(
      "Pick a later month",
    );
    expect(archivedWords(new ApiFailure(422, "invalid", "x"))).toBeNull();
    expect(archivedWords(null)).toBeNull();
  });
});
