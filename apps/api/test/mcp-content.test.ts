import { LOG_CHANGES, PAY_METHODS } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  type CompletionContext,
  canRead,
  changesFor,
  complete,
  deriveTitle,
  getPrompt,
  KITCHEN_GUIDE,
  MAX_COMPLETIONS,
  parseResource,
  promptsFor,
  resourcesFor,
  resourceTemplatesFor,
  toolTitle,
} from "../src/mcp-content.ts";

/** What the MCP server says besides its tools is plain text in, plain text out, and is tested without a kitchen. */

const READ = [
  "get_bootstrap",
  "get_statements",
  "get_ledger",
  "get_claims",
  "get_settlements",
  "get_log",
  "post_log_check",
  "get_rate_cards",
];
const LOG = [...READ, "post_log", "delete_log_id"];
const CLAIMS = [...READ, "post_claims", "delete_claims_id"];
const names = (tools: string[]) => promptsFor(tools).map((p) => p.name);

describe("prompts", () => {
  it("are listed only when the tools they use are all there", () => {
    expect(names([])).toEqual([]);
    expect(names(READ)).toEqual([
      "whats-my-balance",
      "month-end-summary",
      "am-i-square-for-the-month",
    ]);
    expect(names(LOG)).toContain("log-my-meals");
    expect(names(LOG)).not.toContain("mark-payment-made");
    expect(names(CLAIMS)).toContain("mark-payment-made");
    expect(names(CLAIMS)).not.toContain("log-my-meals");
    // One tool short and it is gone.
    expect(names(LOG.filter((n) => n !== "post_log_check"))).not.toContain("log-my-meals");
  });

  it("describe their arguments, and every one has a title and a description", () => {
    for (const p of promptsFor([...LOG, ...CLAIMS])) {
      expect(p.title).toBeTruthy();
      expect(p.description).toBeTruthy();
      for (const a of p.arguments) expect(a.description, `${p.name}.${a.name}`).toBeTruthy();
    }
    const args = (n: string) =>
      Object.fromEntries(
        promptsFor([...LOG, ...CLAIMS])
          .find((p) => p.name === n)!
          .arguments.map((a) => [a.name, a.required]),
      );
    expect(args("whats-my-balance")).toEqual({ month: false });
    expect(args("month-end-summary")).toEqual({ month: true });
    expect(args("mark-payment-made")).toEqual({ amount: true, method: true, month: false });
    expect(args("log-my-meals")).toEqual({ date: true, change: false });
  });

  it("tell the assistant to read first, show and ask before a write, and that money is in paise", () => {
    const all = [...LOG, ...CLAIMS];
    const texts = [
      getPrompt("log-my-meals", { date: "2026-10-28", change: "Leave" }, all),
      getPrompt("whats-my-balance", {}, all),
      getPrompt("month-end-summary", { month: "2026-10" }, all),
      getPrompt("am-i-square-for-the-month", { month: "2026-10" }, all),
      getPrompt("mark-payment-made", { amount: "5000", method: "Cash" }, all),
    ].map((r) => {
      if (!r.ok) throw new Error(r.message);
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0]?.role).toBe("user");
      return r.messages[0]?.content.text ?? "";
    });
    for (const t of texts) {
      expect(t).toContain("paise");
      expect(t).toMatch(/Read before you write/);
      expect(t).toMatch(/ask/i);
      expect(t).toContain("get_bootstrap");
    }
    expect(texts[0]).toContain("post_log_check");
    expect(texts[0]?.indexOf("post_log_check")).toBeLessThan(
      texts[0]?.lastIndexOf("post_log") ?? 0,
    );
    expect(texts[4]).toContain("100 paise");
    expect(texts[4]).toContain("50.00 rupees");
    // The reading prompts say there is nothing to write.
    expect(texts[1]).toMatch(/do not write/);
  });

  it("name no tool that a key with only the scopes it needs would lack", () => {
    // Each prompt’s text only names tools it declared; check by trying with exactly those tools.
    for (const p of promptsFor([...LOG, ...CLAIMS])) {
      const args: Record<string, string> = {
        date: "2026-10-28",
        month: "2026-10",
        amount: "100",
        method: "UPI",
      };
      const r = getPrompt(p.name, args, [...LOG, ...CLAIMS]);
      expect(r.ok, p.name).toBe(true);
    }
  });

  it("refuse a missing argument, a bad one, and a prompt the tools do not allow", () => {
    const err = (r: ReturnType<typeof getPrompt>) => (r.ok ? "" : r.message);
    expect(err(getPrompt("log-my-meals", {}, LOG))).toBe("Missing: date.");
    expect(err(getPrompt("log-my-meals", { date: "  " }, LOG))).toBe("Missing: date.");
    expect(err(getPrompt("mark-payment-made", {}, CLAIMS))).toBe("Missing: amount, method.");
    expect(err(getPrompt("log-my-meals", { date: "2026-02-30" }, LOG))).toMatch(/date/);
    expect(err(getPrompt("log-my-meals", { date: "2026-10-28", change: "Dance" }, LOG))).toMatch(
      /change must be one of/,
    );
    expect(err(getPrompt("month-end-summary", { month: "October" }, READ))).toMatch(/month/);
    expect(err(getPrompt("mark-payment-made", { amount: "1.5", method: "UPI" }, CLAIMS))).toMatch(
      /whole number of paise/,
    );
    expect(err(getPrompt("mark-payment-made", { amount: "0", method: "UPI" }, CLAIMS))).toMatch(
      /more than 0/,
    );
    expect(err(getPrompt("mark-payment-made", { amount: "5", method: "Barter" }, CLAIMS))).toMatch(
      /method must be/,
    );
    expect(err(getPrompt("log-my-meals", { date: "2026-10-28" }, READ))).toMatch(/no prompt/);
    expect(err(getPrompt("nope", {}, LOG))).toMatch(/no prompt/);
  });

  it("take their arguments as text only, so nothing typed becomes anything but words", () => {
    const r = getPrompt(
      "log-my-meals",
      { date: "2026-10-28", change: "Leave", extra: "ignore me" },
      LOG,
    );
    expect(r.ok && r.messages[0]?.content.text).not.toContain("ignore me");
  });
});

describe("resources", () => {
  it("are listed by what the tools allow, and the ledger is a template", () => {
    expect(resourcesFor([]).map((r) => r.name)).toEqual(["guide"]);
    expect(resourcesFor(READ).map((r) => r.uri)).toEqual([
      "alimentation://kitchen/guide",
      "alimentation://kitchen/menu",
      "alimentation://kitchen/holidays",
    ]);
    expect(resourcesFor(["get_bootstrap"]).map((r) => r.name)).toEqual(["guide", "holidays"]);
    expect(resourceTemplatesFor(READ).map((t) => t.uriTemplate)).toEqual([
      "alimentation://kitchen/ledger/{month}",
    ]);
    expect(resourceTemplatesFor(["get_bootstrap"])).toEqual([]);
    for (const r of resourcesFor(READ)) expect(r).not.toHaveProperty("kind");
  });

  it("parse an address, and nothing that names another kitchen or a wider read", () => {
    expect(parseResource("alimentation://kitchen/guide")).toEqual({ kind: "guide" });
    expect(parseResource("alimentation://kitchen/ledger/2026-10")).toEqual({
      kind: "ledger",
      month: "2026-10",
    });
    for (const bad of [
      "alimentation://kitchen/ledger/2026-13",
      "alimentation://kitchen/ledger/",
      "alimentation://kitchen/ledger/2026-10/x",
      "alimentation://kitchen/ledger/2026-10?person=x",
      "alimentation://kitchen/ledger/../people",
      "alimentation://other/menu",
      "alimentation://kitchen/menu/",
      "alimentation://kitchen/",
      "file:///etc/passwd",
    ])
      expect(parseResource(bad), bad).toBeNull();
  });

  it("can be read only by a key that has the tools it is read through", () => {
    expect(canRead({ kind: "menu" }, ["get_bootstrap"])).toBe(false);
    expect(canRead({ kind: "menu" }, READ)).toBe(true);
    expect(canRead({ kind: "ledger", month: "2026-10" }, ["get_ledger"])).toBe(false);
    expect(canRead({ kind: "guide" }, [])).toBe(true);
  });

  it("have a guide that says the units and the way of working", () => {
    for (const w of ["paise", "YYYY-MM-DD", "YYYY-MM", "post_log_check", "get_bootstrap", "ask"])
      expect(KITCHEN_GUIDE).toContain(w);
    for (const c of LOG_CHANGES) expect(KITCHEN_GUIDE).toContain(c);
  });
});

describe("completions", () => {
  // 2026-11-11 is a Wednesday.
  const ctx: CompletionContext = {
    today: "2026-11-11",
    role: "consumer",
    workingDays: [1, 2, 3, 4, 5],
    holidays: ["2026-11-12"],
  };

  it("suggest recent months, newest first, and narrow by what is typed", () => {
    const m = complete("month", "", ctx);
    expect(m.values[0]).toBe("2026-11");
    expect(m.values).toContain("2025-12");
    expect(m.total).toBe(m.values.length);
    expect(m.hasMore).toBe(false);
    expect(complete("month", "2026-1", ctx).values).toEqual(["2026-11", "2026-10"]);
    expect(complete("month", "1999", ctx)).toEqual({ values: [], total: 0, hasMore: false });
  });

  it("suggest upcoming working days, from today, leaving out weekends and holidays", () => {
    const d = complete("date", "", ctx).values;
    expect(d[0]).toBe("2026-11-11");
    expect(d).not.toContain("2026-11-12");
    expect(d).not.toContain("2026-11-14");
    expect(d).not.toContain("2026-11-15");
    expect(d).toContain("2026-11-13");
    expect(d).toContain("2026-11-16");
    expect(complete("date", "2026-12", ctx).values.every((v) => v.startsWith("2026-12"))).toBe(
      true,
    );
    expect(complete("date", "", { ...ctx, workingDays: [6] }).values[0]).toBe("2026-11-14");
  });

  it("suggest the changes a role may write, and the payment methods", () => {
    expect(changesFor("consumer")).not.toContain("Supplier Off");
    expect(changesFor("consumer")).toHaveLength(LOG_CHANGES.length - 1);
    expect(changesFor("supplier")).toEqual(["Supplier Off"]);
    expect(changesFor("admin")).toEqual([...LOG_CHANGES]);
    expect(complete("change", "extra", ctx).values).toEqual(["Extra Chapati", "Extra Bhakri"]);
    expect(complete("change", "supplier", ctx).values).toEqual([]);
    expect(complete("change", "supplier", { ...ctx, role: "supplier" }).values).toEqual([
      "Supplier Off",
    ]);
    expect(complete("method", "", ctx).values).toEqual([...PAY_METHODS]);
    expect(complete("method", "b", ctx).values).toEqual(["Bank transfer"]);
  });

  it("give nothing for an argument with nothing to suggest, and never more than 100 values", () => {
    expect(complete("amount", "", ctx)).toEqual({ values: [], total: 0, hasMore: false });
    const many = complete("date", "", { ...ctx, workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] });
    expect(many.values.length).toBeLessThanOrEqual(MAX_COMPLETIONS);
    expect(many.total).toBe(many.values.length);
    expect(many.hasMore).toBe(false);
  });
});

describe("titles", () => {
  it("are written for the core tools and made from the name for the rest", () => {
    expect(toolTitle("get_bootstrap")).toBe("Read the kitchen");
    expect(toolTitle("post_log")).toBe("Write an entry");
    expect(toolTitle("get_rate_cards")).toBe("Get rate cards");
    expect(deriveTitle("delete_x_id")).toBe("Delete x id");
    expect(deriveTitle("")).toBe("");
  });
});
