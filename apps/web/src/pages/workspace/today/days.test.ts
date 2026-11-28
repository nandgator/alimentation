import { describe, expect, it } from "vitest";
import { dayChips, fullDay, longDay, relativeDay, shortDay } from "./days.ts";

describe("days in words", () => {
  it("writes a day in full without hyphens", () => {
    expect(fullDay("2026-11-25")).toBe("25 Nov 2026");
    expect(longDay("2026-11-25")).toBe("Wednesday, 25 Nov 2026");
    expect(shortDay("2026-11-25")).toBe("Wed 25 Nov");
  });

  it("names the days next to today", () => {
    expect(relativeDay("2026-11-25", "2026-11-25")).toBe("Today");
    expect(relativeDay("2026-11-26", "2026-11-25")).toBe("Tomorrow");
    expect(relativeDay("2026-11-24", "2026-11-25")).toBe("Yesterday");
    expect(relativeDay("2026-11-28", "2026-11-25")).toBe("Sat 28 Nov");
  });

  it("lists today, tomorrow and the days after, across a month end", () => {
    const chips = dayChips("2026-11-28", 5);
    expect(chips.map((c) => c.label)).toEqual(["Today", "Tomorrow", "Mon 30", "Tue 1", "Wed 2"]);
    expect(chips[3]?.iso).toBe("2026-12-01");
  });
});
