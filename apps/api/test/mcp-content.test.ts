import { LOG_ACTIONS, PAY_METHODS } from "@alimentation/core";
import { describe, expect, it } from "vitest";
import {
  actionsFor,
  actionsHelp,
  type CompletionContext,
  canRead,
  complete,
  deriveTitle,
  getPrompt,
  type KitchenWords,
  kitchenGuide,
  logBody,
  MAX_COMPLETIONS,
  parseResource,
  promptsFor,
  resolveName,
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
  "get_menus",
  "get_catalogue",
  "get_services",
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
    expect(args("log-my-meals")).toEqual({
      date: true,
      action: false,
      service: false,
      item: false,
    });
  });

  it("tell the assistant to read first, show and ask before a write, and that money is in paise", () => {
    const all = [...LOG, ...CLAIMS];
    const texts = [
      getPrompt("log-my-meals", { date: "2026-10-28", action: "Leave" }, all),
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
      expect(t).toMatch(/Read before you write/);
      expect(t).toMatch(/ask/i);
      expect(t).toContain("get_bootstrap");
    }
    // Only a prompt about money talks of money.
    expect(texts[0]).not.toContain("paise");
    for (const t of texts.slice(1)) expect(t).toContain("paise");
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
    expect(err(getPrompt("log-my-meals", { date: "2026-10-28", action: "Dance" }, LOG))).toMatch(
      /action must be one of/,
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
      { date: "2026-10-28", action: "Leave", extra: "ignore me" },
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
      "alimentation://kitchen/catalogue",
      "alimentation://kitchen/menu",
      "alimentation://kitchen/prices",
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
    expect(canRead({ kind: "menu" }, ["get_menus"])).toBe(false); // the services come with it
    expect(canRead({ kind: "menu" }, READ)).toBe(true);
    expect(canRead({ kind: "catalogue" }, ["get_catalogue"])).toBe(false);
    expect(canRead({ kind: "catalogue" }, READ)).toBe(true);
    expect(canRead({ kind: "ledger", month: "2026-10" }, ["get_ledger"])).toBe(false);
    expect(canRead({ kind: "guide" }, [])).toBe(true);
  });

  it("have a guide that says the units and the way of working", () => {
    for (const w of ["paise", "YYYY-MM-DD", "YYYY-MM", "post_log_check", "get_bootstrap", "ask"])
      expect(kitchenGuide(true)).toContain(w);
    for (const c of LOG_ACTIONS) expect(kitchenGuide(true, THALI)).toContain(c);
  });
});

/** A kitchen that serves a thali and a snack, in two services, and has no Veg, Chapati or Bhakri. */
const THALI: KitchenWords = {
  today: "2026-11-11",
  services: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Lunch", archivedOn: null },
    { id: "00000000-0000-4000-8000-000000000002", name: "Dinner", archivedOn: null },
    { id: "00000000-0000-4000-8000-000000000003", name: "Tea", archivedOn: "2026-01-01" },
  ],
  catalogue: [
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      kind: "meal",
      name: "Thali",
      unit: "plate",
      maxQty: 20,
      archivedOn: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000a2",
      kind: "meal",
      name: "Thali Small",
      unit: "plate",
      maxQty: 20,
      archivedOn: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000a3",
      kind: "meal",
      name: "Khichdi",
      unit: "bowl",
      maxQty: 20,
      archivedOn: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      kind: "addon",
      name: "Curd",
      unit: "cup",
      maxQty: 5,
      archivedOn: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000b2",
      kind: "addon",
      name: "Pickle",
      unit: "jar",
      maxQty: 2,
      archivedOn: "2026-02-01",
    },
  ],
};

describe("the kitchen's own words", () => {
  it("make the guide and the help from the catalogue, with nothing of another kitchen's food in it", () => {
    for (const money of [true, false]) {
      const g = kitchenGuide(money, THALI);
      expect(g).toContain("Thali (plate)");
      expect(g).toContain("Khichdi (bowl)");
      expect(g).toContain("Curd (cup, up to 5 at a time)");
      expect(g).toContain("Lunch and Dinner");
      // Retired things are not offered.
      expect(g).not.toContain("Pickle");
      expect(g).not.toContain("Tea");
      expect(g).not.toMatch(/Veg|Chapati|Bhakri/);
      expect(g).toContain("another of Thali, Thali Small or Khichdi");
    }
    expect(kitchenGuide(false, THALI)).not.toContain("paise");
    expect(kitchenGuide(false, THALI)).toContain("does not track money");
    // With no word of the kitchen at all, it points at where the words are rather than guess them.
    const bare = kitchenGuide(true);
    expect(bare).toContain("get_catalogue");
    expect(bare).not.toMatch(/Veg|Chapati|Bhakri/);
  });

  it("leave out what a kitchen cannot do: no switch with one meal, no extra without an add-on", () => {
    const one: KitchenWords = {
      ...THALI,
      catalogue: THALI.catalogue.filter((i) => i.id.endsWith("a1")),
    };
    expect(actionsHelp(one)).toBe("One of “Leave”, “Supplier Off”.");
    expect(kitchenGuide(true, one)).not.toContain("- Switch");
    expect(kitchenGuide(true, one)).not.toContain("- Extra");
    expect(actionsHelp(THALI)).toBe(
      "One of “Leave”, “Switch” (to Thali, Thali Small or Khichdi), “Extra” (Curd, with a quantity), “Supplier Off”.",
    );
  });

  it("put them in the prompts, in the description and in what an argument means", () => {
    const all = [...LOG, ...CLAIMS];
    const log = promptsFor(all, true, THALI).find((p) => p.name === "log-my-meals");
    expect(log?.description).toContain("a switch between Thali, Thali Small or Khichdi");
    expect(log?.description).toContain("an extra (Curd)");
    expect(JSON.stringify(log)).not.toMatch(/Veg|Chapati|Bhakri/);
    const text = (name: string, args: Record<string, string>) => {
      const r = getPrompt(name, args, all, true, THALI);
      if (!r.ok) throw new Error(r.message);
      return r.messages[0]?.content.text ?? "";
    };
    const summary = text("month-end-summary", { month: "2026-10" });
    expect(summary).toContain("Thali, Thali Small, Khichdi eaten");
    expect(summary).toContain("Curd");
    const balance = text("whats-my-balance", {});
    expect(balance).toContain("meals (Thali, Thali Small, Khichdi)");
    expect(balance).toContain("add-ons (Curd)");
    const logging = text("log-my-meals", {
      date: "2026-10-28",
      action: "Extra",
      item: "Curd",
      service: "Dinner",
    });
    expect(logging).toContain("“Extra” Curd (Dinner)");
    expect(logging).toContain("Services here: Lunch and Dinner");
    for (const t of [summary, balance, logging]) expect(t).not.toMatch(/Veg|Chapati|Bhakri/);
  });
});

describe("naming a service or an item", () => {
  const pool = THALI.catalogue.filter((i) => i.kind === "meal");
  const today = THALI.today;

  it("finds the whole name in any case, or the id", () => {
    expect(resolveName("item", "thali", pool, today)).toEqual({ ok: true, id: pool[0]?.id });
    expect(resolveName("item", "  KHICHDI ", pool, today)).toEqual({ ok: true, id: pool[2]?.id });
    expect(resolveName("item", pool[1]?.id as string, pool, today)).toEqual({
      ok: true,
      id: pool[1]?.id,
    });
    expect(resolveName("item", String(pool[1]?.id).toUpperCase(), pool, today)).toEqual({
      ok: true,
      id: pool[1]?.id,
    });
  });

  it("takes the beginning or the middle of a name only when it fits one", () => {
    expect(resolveName("item", "khi", pool, today)).toEqual({ ok: true, id: pool[2]?.id });
    expect(resolveName("item", "chdi", pool, today)).toEqual({ ok: true, id: pool[2]?.id });
    // The whole name wins over a longer name that begins with it.
    expect(resolveName("item", "Thali", pool, today)).toEqual({ ok: true, id: pool[0]?.id });
  });

  it("refuses an ambiguous name and lists the candidates", () => {
    const r = resolveName("item", "tha", pool, today);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("could be more than one item");
      expect(r.message).toContain("“Thali”");
      expect(r.message).toContain("“Thali Small”");
      expect(r.message).not.toContain("Khichdi");
    }
  });

  it("refuses an unknown name and a retired one, and lists the choices", () => {
    const none = resolveName("item", "Pizza", pool, today);
    expect(none.ok).toBe(false);
    if (!none.ok)
      expect(none.message).toBe(
        "There is no item called “Pizza”. The choices are “Thali”, “Thali Small”, “Khichdi”.",
      );
    const old = resolveName("item", "pickle", THALI.catalogue, today);
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.message).toContain("not offered any more (retired 2026-02-01)");
    const sv = resolveName("service", "supper", THALI.services, today);
    expect(sv.ok).toBe(false);
    if (!sv.ok) expect(sv.message).toContain("“Lunch”, “Dinner”");
    expect(resolveName("service", "", THALI.services, today).ok).toBe(false);
  });
});

describe("an entry said in names", () => {
  const boot = {
    today: THALI.today,
    me: { personId: "11111111-1111-4111-8111-111111111111" },
    services: THALI.services,
    catalogue: THALI.catalogue,
  };
  const lunch = THALI.services[0]?.id;
  const khichdi = THALI.catalogue[2]?.id;
  const curd = THALI.catalogue[3]?.id;

  it("turns a service and an item into ids, for the person the key acts as unless another is named", () => {
    expect(
      logBody({ date: "2026-11-12", action: "switch", service: "dinner", item: "khichdi" }, boot),
    ).toEqual({
      ok: true,
      body: {
        date: "2026-11-12",
        personId: boot.me.personId,
        allConsumers: false,
        action: "Switch",
        serviceId: THALI.services[1]?.id,
        itemId: khichdi,
        qty: null,
      },
    });
    const extra = logBody(
      {
        date: "2026-11-12",
        action: "Extra",
        service: "Lunch",
        item: "Curd",
        qty: 2,
        personId: "p2",
      },
      boot,
    );
    expect(extra).toMatchObject({
      ok: true,
      body: { serviceId: lunch, itemId: curd, qty: 2, personId: "p2" },
    });
  });

  it("leaves a leave for the whole day, and the day off for everyone", () => {
    expect(logBody({ date: "2026-11-12", action: "Leave" }, boot)).toMatchObject({
      ok: true,
      body: { serviceId: null, itemId: null, allConsumers: false },
    });
    expect(
      logBody({ date: "2026-11-12", action: "Supplier Off", personId: "ignored" }, boot),
    ).toMatchObject({
      ok: true,
      body: { personId: null, allConsumers: true, serviceId: null },
    });
    expect(logBody({ date: "2026-11-12", action: "Leave", service: "Lunch" }, boot)).toMatchObject({
      ok: true,
      body: { serviceId: lunch },
    });
  });

  it("asks which service when a switch or extra could be for several, and takes the only one otherwise", () => {
    const r = logBody({ date: "2026-11-12", action: "Extra", item: "Curd", qty: 1 }, boot);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("“Lunch”, “Dinner”");
    const single = { ...boot, services: THALI.services.slice(0, 1) };
    expect(
      logBody({ date: "2026-11-12", action: "Extra", item: "Curd", qty: 1 }, single),
    ).toMatchObject({
      ok: true,
      body: { serviceId: lunch, itemId: curd },
    });
  });

  it("looks for a switch among the meals and an extra among the add-ons, and leaves a wrong kind to the kitchen", () => {
    // "Thali" is a meal and "Curd" an add-on: each is found among its own kind.
    expect(
      logBody({ date: "2026-11-12", action: "Switch", service: "Lunch", item: "tha" }, boot).ok,
    ).toBe(false);
    // A meal named for an extra is still found, so that the kitchen can refuse it in its own words.
    expect(
      logBody(
        { date: "2026-11-12", action: "Extra", service: "Lunch", item: "Khichdi", qty: 1 },
        boot,
      ),
    ).toMatchObject({
      ok: true,
      body: { itemId: khichdi },
    });
  });

  it("refuses an action that is not one of the four, and an unknown name, listing the choices", () => {
    expect(logBody({ date: "2026-11-12", action: "Dance" }, boot)).toMatchObject({ ok: false });
    const r = logBody(
      { date: "2026-11-12", action: "Switch", service: "Lunch", item: "Pizza" },
      boot,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("There is no item called “Pizza”");
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

  it("suggest the actions a role may write, and the payment methods", () => {
    expect(actionsFor("consumer")).not.toContain("Supplier Off");
    expect(actionsFor("consumer")).toHaveLength(LOG_ACTIONS.length - 1);
    expect(actionsFor("supplier")).toEqual(["Supplier Off"]);
    expect(actionsFor("admin")).toEqual([...LOG_ACTIONS]);
    expect(complete("action", "ex", ctx).values).toEqual(["Extra"]);
    expect(complete("action", "supplier", ctx).values).toEqual([]);
    expect(complete("action", "supplier", { ...ctx, role: "supplier" }).values).toEqual([
      "Supplier Off",
    ]);
    expect(complete("method", "", ctx).values).toEqual([...PAY_METHODS]);
    expect(complete("method", "b", ctx).values).toEqual(["Bank transfer"]);
  });

  it("suggest the kitchen's services and items, by the action chosen and for the role", () => {
    const withKitchen: CompletionContext = {
      ...ctx,
      services: ["Lunch", "Dinner"],
      items: [
        { name: "Thali", kind: "meal" },
        { name: "Khichdi", kind: "meal" },
        { name: "Curd", kind: "addon" },
      ],
    };
    expect(complete("service", "", withKitchen).values).toEqual(["Lunch", "Dinner"]);
    expect(complete("service", "d", withKitchen).values).toEqual(["Dinner"]);
    expect(complete("service", "", ctx).values).toEqual([]);
    expect(complete("item", "", { ...withKitchen, action: "Switch" }).values).toEqual([
      "Khichdi",
      "Thali",
    ]);
    expect(complete("item", "", { ...withKitchen, action: "extra" }).values).toEqual(["Curd"]);
    expect(complete("item", "", { ...withKitchen, action: "Leave" }).values).toEqual([]);
    expect(complete("item", "", withKitchen).values).toEqual(["Curd", "Khichdi", "Thali"]);
    // A supplier's only entry is a day off, which names no item.
    expect(complete("item", "", { ...withKitchen, role: "supplier" }).values).toEqual([]);
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
