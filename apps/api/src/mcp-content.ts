import {
  addDays,
  addMonths,
  type CatalogueItem,
  isValidDate,
  isValidMonth,
  LOG_ACTIONS,
  type LogAction,
  monthOf,
  PAY_METHODS,
  type Role,
  type Service,
  weekdayOf,
} from "@alimentation/core";

/**
 * What the MCP server says besides its tools: starter prompts, a few things to read, the values to suggest for
 * an argument, and a title for each tool. All of it is pure (text in, text out), so it is tested without a
 * kitchen. The server (`app.ts`) decides what a key may see from the names of the tools the key has, and reads
 * a resource by making the same request a tool would; nothing here widens what a key can read.
 */

// --- titles ---------------------------------------------------------------------------------------------

/** The titles of the core tools, written by hand. The names themselves are made from the routes and do not change. */
const TOOL_TITLES: Record<string, string> = {
  get_bootstrap: "Read the kitchen",
  get_statements: "Monthly statements",
  get_ledger: "Day ledger for a month",
  get_menus: "Menus",
  get_catalogue: "What the kitchen serves",
  get_services: "Services",
  get_history: "What has been done, in words",
  get_log: "Entries in a date range",
  post_log_check: "Check an entry without writing it",
  post_log: "Write an entry",
  delete_log_id: "Withdraw an entry",
  get_claims: "Payment claims",
  post_claims: "Say a payment was made",
  delete_claims_id: "Withdraw a payment claim",
  get_settlements: "Settlements",
};

/** `get_rate_cards` becomes “Get rate cards”: the words of the name, for a tool with no title of its own. */
export const deriveTitle = (name: string): string => {
  const words = name.replace(/_+/g, " ").trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : name;
};

export const toolTitle = (name: string): string => TOOL_TITLES[name] ?? deriveTitle(name);

// --- the kitchen's own words ------------------------------------------------------------------------------

/** What an agent needs of a kitchen to speak in its words: its services and everything it serves. */
export interface KitchenWords {
  services: readonly Pick<Service, "id" | "name" | "archivedOn">[];
  catalogue: readonly Pick<
    CatalogueItem,
    "id" | "kind" | "name" | "unit" | "maxQty" | "archivedOn"
  >[];
  /** The kitchen's today, to tell what is retired. */
  today: string;
}

const isLive = (x: { archivedOn: string | null }, today: string): boolean =>
  x.archivedOn === null || x.archivedOn > today;

/** The names of what is on offer now: services, meals and add-ons. */
export function wordsOf(k: KitchenWords | undefined): {
  services: string[];
  meals: string[];
  addons: string[];
} {
  if (!k) return { services: [], meals: [], addons: [] };
  const live = <T extends { archivedOn: string | null }>(l: readonly T[]) =>
    l.filter((x) => isLive(x, k.today));
  return {
    services: live(k.services).map((x) => x.name),
    meals: live(k.catalogue.filter((i) => i.kind === "meal")).map((x) => x.name),
    addons: live(k.catalogue.filter((i) => i.kind === "addon")).map((x) => x.name),
  };
}

/** `A`, `A or B`, `A, B or C`. */
export const orList = (names: readonly string[], word = "or"): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;

/**
 * The four things an entry can do, each in the kitchen's words: a switch is to its meals and an extra is of its
 * add-ons. A kitchen that has no add-ons has no extra to offer, and one with a single meal has nothing to switch to.
 */
export function actionsHelp(k: KitchenWords | undefined): string {
  const w = wordsOf(k);
  const parts = [`“Leave”`];
  if (!k || w.meals.length > 1)
    parts.push(`“Switch” (to ${w.meals.length > 1 ? orList(w.meals) : "another meal"})`);
  if (!k || w.addons.length > 0)
    parts.push(
      `“Extra” (${w.addons.length > 0 ? orList(w.addons) : "an add-on"}, with a quantity)`,
    );
  parts.push(`“Supplier Off”`);
  return `One of ${parts.join(", ")}.`;
}

/** What a log tool or prompt says about naming a service and an item. */
export function scopeHelp(k: KitchenWords | undefined): string {
  const w = wordsOf(k);
  const service =
    w.services.length > 1
      ? `Services here: ${orList(w.services, "and")}. A Leave or Supplier Off with no service is for the whole day.`
      : "";
  return service;
}

// --- shared wording -------------------------------------------------------------------------------------

const RULES_OF_THE_ROAD = [
  "Read before you write: look at the kitchen and at what is already there before you change anything.",
  "Before any write, tell the person in plain words exactly what you are about to do (which day, which change, which amount) and ask them whether to go ahead. Do the write only after they say yes.",
  "If a tool answers with an error, give the person the kitchen’s own words and do not try another way round it.",
];

const MONEY_RULE =
  "Money in this kitchen is in paise (hundredths of a rupee, so 100 paise is 1 rupee). Tools take and give paise; show the person rupees.";

/** The money line sits with the other rules for a prompt that is about money, and is not said to one that is not. */
const preface = (task: string, steps: string[], money = false): string => {
  const rules = money
    ? [...RULES_OF_THE_ROAD.slice(0, 2), MONEY_RULE, ...RULES_OF_THE_ROAD.slice(2)]
    : RULES_OF_THE_ROAD;
  return `${task}\n\nHow to do it:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${rules.join("\n")}`;
};

// --- prompts --------------------------------------------------------------------------------------------

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

interface PromptDef {
  name: string;
  title: string;
  description: (k: KitchenWords | undefined) => string;
  arguments: (k: KitchenWords | undefined) => PromptArgument[];
  /** The tools it asks the assistant to call. It is listed only to a key that has every one of them. */
  needs: string[];
  /** About money: it is listed only for a kitchen that tracks it, whatever tools the key has. */
  money?: boolean;
  /** The text, from arguments already checked, in the kitchen's words when they are known. */
  text: (a: Record<string, string>, k: KitchenWords | undefined) => string;
}

const MONTH_HELP = "The month, as YYYY-MM (for example 2026-10).";

const monthOrCurrent = (a: Record<string, string>): string =>
  a.month ? `the month ${a.month}` : "the current month (the kitchen’s `currentMonth`)";

/** The things a bill is made of, as the kitchen calls them. */
const billParts = (k: KitchenWords | undefined): string => {
  const w = wordsOf(k);
  const meals = w.meals.length > 0 ? `meals (${w.meals.join(", ")})` : "meals";
  const addons = w.addons.length > 0 ? `add-ons (${w.addons.join(", ")})` : "add-ons";
  return `${meals}, ${addons}, anything charged for leave, the monthly fee`;
};

/** What a month is counted in, as the kitchen calls it. */
const countParts = (k: KitchenWords | undefined): string => {
  const w = wordsOf(k);
  const meals = w.meals.length > 0 ? `${w.meals.join(", ")} eaten` : "meals eaten";
  const addons = w.addons.length > 0 ? w.addons.join(", ") : "add-ons";
  return `${meals}, service slots on leave, ${addons}`;
};

/** A leave, a switch and an extra, in the kitchen's words. */
const changesPhrase = (k: KitchenWords | undefined): string => {
  const w = wordsOf(k);
  const list = ["a leave"];
  if (!k || w.meals.length > 1)
    list.push(
      w.meals.length > 1 ? `a switch between ${orList(w.meals)}` : "a switch to another meal",
    );
  if (!k || w.addons.length > 0)
    list.push(w.addons.length > 0 ? `an extra (${orList(w.addons)})` : "an extra");
  return orList(list);
};

const PROMPTS: PromptDef[] = [
  {
    name: "log-my-meals",
    title: "Log my meals",
    description: (k) => `Put ${changesPhrase(k)} on a day, after checking it and asking first.`,
    arguments: (k) => [
      { name: "date", description: "The day, as YYYY-MM-DD.", required: true },
      {
        name: "action",
        description: `${actionsHelp(k)} If it is left out, ask the person which.`,
        required: false,
      },
      {
        name: "service",
        description:
          "Which service it is for, by name or id. Leave out for the whole day (a leave) or when the kitchen has one service.",
        required: false,
      },
      {
        name: "item",
        description:
          "The meal to switch to, or the add-on to ask for, by name or id. Leave out for a leave.",
        required: false,
      },
    ],
    needs: ["get_bootstrap", "get_log", "post_log_check", "post_log"],
    text: (a, k) =>
      preface(
        `Help the person log a change to their meals for ${a.date}${a.action ? `: “${a.action}”${a.item ? ` ${a.item}` : ""}${a.service ? ` (${a.service})` : ""}` : ""}.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`), today’s date, the rules in force, what the kitchen serves (`catalogue`, `services`) and what is on the menu that day.",
          `Call get_log for ${a.date} (from and to both ${a.date}) to see what is already logged that day.`,
          a.action
            ? `The action is “${a.action}”.`
            : `Ask the person which they want. ${actionsHelp(k)} For an extra, also ask how many.`,
          `Name the service and the item as the kitchen spells them, or by id; post_log_check and post_log take \`service\` and \`item\`.${scopeHelp(k) ? ` ${scopeHelp(k)}` : ""} A name that is not the kitchen’s, or fits more than one, is answered with the names to choose from.`,
          "Call post_log_check with that entry (date, personId, action, service, item, qty) to see whether the kitchen would take it, and what it would warn about, without writing anything.",
          "Tell the person what you found and what you will log. Ask whether to go ahead.",
          "Only if they say yes, call post_log with the same entry, and tell them what the kitchen answered. If they want an entry they already logged withdrawn, delete_log_id does that, again after asking.",
        ],
      ),
  },
  {
    name: "whats-my-balance",
    title: "What is my balance?",
    description: () =>
      "Say what the person owes or is owed for a month, in rupees, and how it is made up.",
    arguments: () => [
      {
        name: "month",
        description: `${MONTH_HELP} The current month if left out.`,
        required: false,
      },
    ],
    needs: ["get_bootstrap", "get_statements"],
    money: true,
    text: (a, k) =>
      preface(
        `Tell the person what their balance is for ${monthOrCurrent(a)}.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`) and the current month.",
          `Call get_statements for ${a.month ?? "the current month"} (months), for that person.`,
          `Say what they owe or are owed, in rupees, and the parts it is made up of: ${billParts(k)}, anything paid, anything carried over. The statement's \`lines\` give each item with how many and what it came to; \`catalogue\` names the items.`,
          "You are only reading, so there is nothing to confirm; do not write anything.",
        ],
        true,
      ),
  },
  {
    name: "month-end-summary",
    title: "Month-end summary",
    description: () =>
      "Summarise a month: what was eaten, what it cost, what was paid and what is left.",
    arguments: () => [{ name: "month", description: MONTH_HELP, required: true }],
    needs: ["get_bootstrap", "get_statements", "get_ledger", "get_claims"],
    money: true,
    text: (a, k) =>
      preface(
        `Write a short summary of the month ${a.month} for the person.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`), and what the kitchen serves (`catalogue`, `services`) to name what you find.",
          `Call get_statements for ${a.month} for the totals.`,
          `Call get_ledger for ${a.month} and that person to see the days behind the totals: one row for each date and service, with leaves, switches and extras.`,
          "Call get_claims to see which payments have been claimed or confirmed for the month.",
          `Write the summary in plain words and in rupees: ${countParts(k)}, the charge, what was paid, what is left. Point out anything that looks odd, and say so rather than guess.`,
          "You are only reading, so there is nothing to confirm; do not write anything.",
        ],
        true,
      ),
  },
  {
    name: "am-i-square-for-the-month",
    title: "Am I square for the month?",
    description: () =>
      "Say yes or no on whether the person has paid what they owe for a month, with the figures.",
    arguments: () => [{ name: "month", description: MONTH_HELP, required: true }],
    needs: ["get_bootstrap", "get_statements", "get_claims", "get_settlements"],
    money: true,
    text: (a) =>
      preface(
        `Tell the person whether they are square for the month ${a.month}.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`).",
          `Call get_statements for ${a.month} for what is owed.`,
          "Call get_claims and get_settlements to see what has been paid, claimed but not yet confirmed, or queried.",
          "Answer plainly: square, or not, and by how much in rupees. Say separately what is claimed but waiting for someone to confirm, because that is not yet counted as paid.",
          "You are only reading, so there is nothing to confirm; do not write anything.",
        ],
        true,
      ),
  },
  {
    name: "mark-payment-made",
    title: "Say a payment was made",
    description: () =>
      "Tell the kitchen the person has paid, so that the person who takes payment can confirm it.",
    arguments: () => [
      {
        name: "amount",
        description: "The amount in paise, a whole number (100 paise is 1 rupee).",
        required: true,
      },
      {
        name: "method",
        description: `How it was paid: ${PAY_METHODS.map((m) => `“${m}”`).join(", ")}.`,
        required: true,
      },
      {
        name: "month",
        description: `${MONTH_HELP} The month the payment is for; the current month if left out.`,
        required: false,
      },
    ],
    needs: ["get_bootstrap", "get_statements", "get_claims", "post_claims"],
    money: true,
    text: (a) =>
      preface(
        `Help the person tell the kitchen that they paid ${a.amount} paise (${rupees(a.amount ?? "0")} rupees) by ${a.method} for ${monthOrCurrent(a)}.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`), today’s date (the day paid, unless they say another) and the current month.",
          `Call get_statements for the month to see what is owed, and get_claims to see whether this payment has been claimed already. If it looks like a repeat, say so and stop.`,
          "Tell the person exactly what you will say: the amount in rupees and in paise, the method, the month and the date paid. Ask whether to go ahead, and whether they want a reference note on it.",
          "Only if they say yes, call post_claims (consumerId is their `me.personId`, paidAt the date, forMonth the month, amount in paise, method, and refNote if given).",
          "Tell them that this is a claim: a person who takes payment still has to confirm it, and you cannot do that.",
        ],
        true,
      ),
  },
];

const rupees = (paise: string): string => {
  const n = Number(paise);
  return Number.isInteger(n) ? (n / 100).toFixed(2) : paise;
};

const offered = (p: PromptDef, have: Set<string>, moneyEnabled: boolean) =>
  (moneyEnabled || !p.money) && p.needs.every((n) => have.has(n));

/**
 * The prompts a key may be shown: those whose every tool it has, and, for a kitchen without money, none about money.
 * Given what the kitchen serves, their descriptions use its words.
 */
export function promptsFor(
  toolNames: readonly string[],
  moneyEnabled = true,
  kitchen?: KitchenWords,
) {
  const have = new Set(toolNames);
  return PROMPTS.filter((p) => offered(p, have, moneyEnabled)).map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description(kitchen),
    arguments: p.arguments(kitchen),
  }));
}

/** The names of the arguments a prompt takes, or undefined if there is no such prompt. */
export const promptArguments = (name: string): string[] | undefined =>
  PROMPTS.find((p) => p.name === name)
    ?.arguments(undefined)
    .map((a) => a.name);

/** The names of the tools a prompt asks for, or undefined if there is no such prompt. */
export const promptNeeds = (name: string): string[] | undefined =>
  PROMPTS.find((p) => p.name === name)?.needs;

/** Whether a prompt is about money. */
export const promptIsMoney = (name: string): boolean =>
  PROMPTS.find((p) => p.name === name)?.money === true;

export type PromptResult =
  | {
      ok: true;
      description: string;
      messages: { role: "user"; content: { type: "text"; text: string } }[];
    }
  | { ok: false; message: string };

const bad = (message: string): PromptResult => ({ ok: false, message });

/** A prompt with its arguments, or why it cannot be had. An argument not in the prompt is ignored. */
export function getPrompt(
  name: string,
  given: Record<string, unknown> | undefined,
  toolNames: readonly string[],
  moneyEnabled = true,
  kitchen?: KitchenWords,
): PromptResult {
  const def = PROMPTS.find((p) => p.name === name);
  const have = new Set(toolNames);
  if (!def || !offered(def, have, moneyEnabled))
    return bad(`There is no prompt “${name}” for this key.`);
  const a: Record<string, string> = {};
  for (const arg of def.arguments(kitchen)) {
    const v = given?.[arg.name];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    a[arg.name] = String(v).trim();
  }
  const missing = def.arguments(kitchen).filter((x) => x.required && a[x.name] === undefined);
  if (missing.length) return bad(`Missing: ${missing.map((x) => x.name).join(", ")}.`);
  if (a.date !== undefined && !isValidDate(a.date))
    return bad("date must be a real day, written YYYY-MM-DD.");
  if (a.month !== undefined && !isValidMonth(a.month))
    return bad("month must be a month, written YYYY-MM.");
  if (a.action !== undefined) {
    const hit = LOG_ACTIONS.find((x) => x.toLowerCase() === a.action?.toLowerCase());
    if (!hit) return bad(`action must be one of: ${LOG_ACTIONS.join(", ")}.`);
    a.action = hit;
  }
  if (a.method !== undefined && !(PAY_METHODS as readonly string[]).includes(a.method))
    return bad(`method must be one of: ${PAY_METHODS.join(", ")}.`);
  if (a.amount !== undefined && !/^[1-9][0-9]{0,11}$/.test(a.amount))
    return bad("amount must be a whole number of paise, more than 0 (100 paise is 1 rupee).");
  return {
    ok: true,
    description: def.description(kitchen),
    messages: [{ role: "user", content: { type: "text", text: def.text(a, kitchen) } }],
  };
}

// --- resources ------------------------------------------------------------------------------------------

export const RESOURCE_PREFIX = "alimentation://kitchen/";
export const LEDGER_TEMPLATE = `${RESOURCE_PREFIX}ledger/{month}`;

export type ResourceRef =
  | { kind: "guide" }
  | { kind: "menu" }
  | { kind: "catalogue" }
  | { kind: "prices" }
  | { kind: "holidays" }
  | { kind: "ledger"; month: string };

interface ResourceDef {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  kind: ResourceRef["kind"];
}

const RESOURCES: ResourceDef[] = [
  {
    uri: `${RESOURCE_PREFIX}guide`,
    name: "guide",
    title: "How this kitchen works",
    description: "Units, rules and how to use the tools. Read this first.",
    mimeType: "text/plain",
    kind: "guide",
  },
  {
    uri: `${RESOURCE_PREFIX}catalogue`,
    name: "catalogue",
    title: "What the kitchen serves",
    description:
      "The services and every meal and add-on the kitchen has, retired ones marked, with the prices in force today where the kitchen tracks money.",
    mimeType: "application/json",
    kind: "catalogue",
  },
  {
    uri: `${RESOURCE_PREFIX}menu`,
    name: "menu",
    title: "Menu",
    description:
      "The services, and every menu, oldest first: for each service the meal served on each weekday and the items it offers, from the date it starts.",
    mimeType: "application/json",
    kind: "menu",
  },
  {
    uri: `${RESOURCE_PREFIX}prices`,
    name: "prices",
    title: "Rate cards",
    description:
      "Every rate card, oldest first: a price in paise for each item (and, where one differs, for a service), and the monthly fee, from the date each starts.",
    mimeType: "application/json",
    kind: "prices",
  },
  {
    uri: `${RESOURCE_PREFIX}holidays`,
    name: "holidays",
    title: "Holidays",
    description: "The kitchen’s holidays, with whether each is confirmed.",
    mimeType: "application/json",
    kind: "holidays",
  },
];

/** The tools a resource is read through: it is shown to a key that has them all, and read by calling them. */
export const resourceNeeds = (ref: ResourceRef): string[] => {
  switch (ref.kind) {
    case "guide":
      return [];
    case "catalogue":
      return ["get_catalogue", "get_services"];
    case "menu":
      return ["get_menus", "get_services"];
    case "prices":
      return ["get_rate_cards"];
    case "holidays":
      return ["get_bootstrap"];
    case "ledger":
      return ["get_bootstrap", "get_ledger"];
  }
};

const allOf = (needs: string[], have: Set<string>) => needs.every((n) => have.has(n));

/** The resources a key may be shown; the one about prices only in a kitchen that has prices to show. */
export function resourcesFor(toolNames: readonly string[]) {
  const have = new Set(toolNames);
  return RESOURCES.filter((r) => allOf(resourceNeeds({ kind: r.kind } as ResourceRef), have)).map(
    ({ kind: _kind, ...r }) => r,
  );
}

export function resourceTemplatesFor(toolNames: readonly string[]) {
  const have = new Set(toolNames);
  return allOf(resourceNeeds({ kind: "ledger", month: "" }), have)
    ? [
        {
          uriTemplate: LEDGER_TEMPLATE,
          name: "ledger",
          title: "Your day ledger for a month",
          description:
            "A row for each date and service of the month for the person the key acts as. The month is YYYY-MM.",
          mimeType: "application/json",
        },
      ]
    : [];
}

/** What a resource address names, or null when it names nothing this server has (including another kitchen’s). */
export function parseResource(uri: string): ResourceRef | null {
  if (!uri.startsWith(RESOURCE_PREFIX)) return null;
  const rest = uri.slice(RESOURCE_PREFIX.length);
  if (
    rest === "guide" ||
    rest === "menu" ||
    rest === "catalogue" ||
    rest === "prices" ||
    rest === "holidays"
  )
    return { kind: rest };
  const m = /^ledger\/([^/?#]+)$/.exec(rest);
  if (m?.[1] && isValidMonth(m[1])) return { kind: "ledger", month: m[1] };
  return null;
}

/** True when the key has what the resource is read through. */
export const canRead = (ref: ResourceRef, toolNames: readonly string[]): boolean =>
  allOf(resourceNeeds(ref), new Set(toolNames));

/** What the guide says about money, for a kitchen that tracks it. */
const MONEY_GUIDE = `
Payments
- A payment is first claimed (by the member, or an agent for them) and then confirmed or queried by the person who takes payment. A claim is not yet money paid. You can make or withdraw a claim; you cannot confirm, reverse or settle one.
`;

/** Which items go with which unit, as the guide lists them. */
const itemLine = (i: KitchenWords["catalogue"][number]): string =>
  `${i.name} (${i.unit}${i.kind === "addon" ? `, up to ${i.maxQty} at a time` : ""})`;

/** What the kitchen serves, in the words it uses for it, or what to do when that is not known. */
function servesGuide(k: KitchenWords | undefined): string[] {
  if (!k)
    return [
      "- What the kitchen serves is in get_catalogue and get_services (and in get_bootstrap).",
    ];
  const live = (l: readonly { archivedOn: string | null }[]) =>
    l.filter((x) => isLive(x, k.today)) as typeof l;
  const services = live(k.services) as KitchenWords["services"];
  const items = live(k.catalogue) as KitchenWords["catalogue"];
  const meals = items.filter((i) => i.kind === "meal");
  const addons = items.filter((i) => i.kind === "addon");
  const lines: string[] = [];
  if (services.length === 0 && items.length === 0)
    return ["- The kitchen has not yet said what it serves. The admin adds that first."];
  lines.push(
    services.length > 1
      ? `- It serves in ${services.length} services: ${orList(
          services.map((s) => s.name),
          "and",
        )}. A member takes some or all of them.`
      : services.length === 1
        ? `- It has one service, ${services[0]?.name}.`
        : "- It has no service yet.",
  );
  if (meals.length > 0) lines.push(`- Meals: ${meals.map(itemLine).join(", ")}.`);
  if (addons.length > 0) lines.push(`- Add-ons: ${addons.map(itemLine).join(", ")}.`);
  lines.push(
    "- Names are the kitchen's own. Tools take a service or an item by its name as written here, in any case, or by its id; the full lists are in get_services and get_catalogue.",
  );
  return lines;
}

/** The entries a member can make, in the words of this kitchen's catalogue. */
function entriesGuide(k: KitchenWords | undefined, moneyEnabled: boolean): string[] {
  const w = wordsOf(k);
  const several = w.services.length > 1;
  const where = several ? " It is for the whole day, or for one service (`service`)." : "";
  const lines = [
    `- Leave: the person does not eat that day.${where}${moneyEnabled ? " Whether it is charged depends on the kitchen's rules." : ""}`,
  ];
  if (!k || w.meals.length > 1)
    lines.push(
      `- Switch: the person eats ${w.meals.length > 1 ? `another of ${orList(w.meals)}` : "another meal"} instead of the usual one${several ? ", in one service (`service` is needed)" : ""}. \`item\` is the meal, which that service must offer.`,
    );
  if (!k || w.addons.length > 0)
    lines.push(
      `- Extra: more of ${w.addons.length > 0 ? orList(w.addons) : "an add-on"}, with a quantity (\`qty\`)${moneyEnabled ? "" : " (counted, not priced)"}${several ? ", in one service (`service` is needed)" : ""}. \`item\` is the add-on, which that service must offer.`,
    );
  lines.push(
    "- Supplier Off: the kitchen is closed that day for everyone. Only the supplier or an admin can log it.",
  );
  return lines;
}

/** How the kitchen works, in the words an agent is given: with money in it or without, and in the kitchen's own words for what it serves. */
export const kitchenGuide = (
  moneyEnabled: boolean,
  k?: KitchenWords,
): string => `How this kitchen works

A kitchen cooks for its members on working days. ${
  moneyEnabled
    ? "Each member is billed for the meals they take, at the prices on the kitchen's rate card, and settles at the end of each month."
    : "This kitchen counts the meals each member takes. It keeps no prices, bills or payments: it does not track money."
} You are acting for one person, in one role, with the scopes your key has. You can do what that person could do with the scopes you were given, and nothing else; what the kitchen's rules or database refuse that person they refuse you.

Units
${moneyEnabled ? "- Money is in paise, hundredths of a rupee: 100 paise is 1 rupee. Tools take and give paise as whole numbers. Show people rupees.\n" : ""}- A date is YYYY-MM-DD, in the kitchen's own time zone. A month is YYYY-MM.

What it serves
${servesGuide(k).join("\n")}

Entries (the log)
${entriesGuide(k, moneyEnabled).join("\n")}
- A member can log only for themselves, and only for services they take on that date. An entry after the cut-off, on a day that is not a working day, for a service not served that day or in a month that is closed is refused or warned about, in words. Holidays the kitchen has confirmed are days it does not cook.
${moneyEnabled ? MONEY_GUIDE : ""}
How to use the tools
- Start with get_bootstrap: the kitchen, who you are (me.personId, role), today, the current month, the rules, what it serves, the menu${moneyEnabled ? ", the rate card" : ""} and the holidays.
- Read before you write. To log an entry, check it first with post_log_check, which writes nothing, then post_log. delete_log_id withdraws an entry.
- Before any write, tell the person what you will do and ask. Write only after they agree.
- Each tool call is an ordinary request to the kitchen, counted against its day and recorded in its history as done through an agent.
- If a tool is not listed, your key cannot do it. Closing months, changing${moneyEnabled ? " prices," : ""} what is served, the menu, rules, people or holidays, and making keys stay with a person.
`;

// --- naming a service or an item --------------------------------------------------------------------------

export type Resolved = { ok: true; id: string } | { ok: false; message: string };

const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Which service or item a name or an id means, among `pool`. The kitchen's names are unique ignoring case, so a
 * whole name is exact; failing that, the text may begin a name or be inside one, and only if that is one
 * candidate. Anything else is an error that lists the candidates, so the assistant can ask the person.
 */
export function resolveName(
  what: "service" | "item",
  given: string,
  pool: readonly { id: string; name: string; archivedOn: string | null }[],
  today: string,
): Resolved {
  const text = given.trim();
  const byId = UUID_RE.test(text)
    ? pool.find((x) => x.id.toLowerCase() === text.toLowerCase())
    : undefined;
  if (byId) return { ok: true, id: byId.id };
  const live = pool.filter((x) => isLive(x, today));
  const list = (l: readonly { name: string }[]) => l.map((x) => `“${x.name}”`).join(", ");
  const lower = text.toLowerCase();
  if (lower === "")
    return {
      ok: false,
      message: `Say which ${what}. The choices are ${list(live) || "none yet"}.`,
    };
  const exact = live.filter((x) => x.name.toLowerCase() === lower);
  if (exact.length === 1) return { ok: true, id: exact[0]?.id as string };
  const retired = pool.find((x) => !isLive(x, today) && x.name.toLowerCase() === lower);
  if (retired)
    return {
      ok: false,
      message: `“${retired.name}” is not offered any more (retired ${retired.archivedOn}). The choices are ${list(live) || "none"}.`,
    };
  for (const near of [
    live.filter((x) => x.name.toLowerCase().startsWith(lower)),
    live.filter((x) => x.name.toLowerCase().includes(lower)),
  ]) {
    if (near.length === 1) return { ok: true, id: near[0]?.id as string };
    if (near.length > 1)
      return {
        ok: false,
        message: `“${text}” could be more than one ${what}: ${list(near)}. Use the whole name or the id.`,
      };
  }
  return {
    ok: false,
    message: `There is no ${what} called “${text}”. The choices are ${list(live) || "none yet"}.`,
  };
}

/** The pieces of an entry as a person or agent says it, before names become ids. */
export interface LogWords {
  date: string;
  action: string;
  service?: string;
  item?: string;
  qty?: number;
  personId?: string | null;
  note?: string | null;
}

export interface Boot {
  today: string;
  me: { personId: string };
  services: KitchenWords["services"];
  catalogue: KitchenWords["catalogue"];
}

/**
 * The body the kitchen takes for an entry said in names. A service left out means the whole day for a leave or a
 * day off, and the kitchen's only service when it has just one; an item is looked for among the meals for a
 * switch and the add-ons for an extra. An error lists the candidates.
 */
export function logBody(
  w: LogWords,
  boot: Boot,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const action = LOG_ACTIONS.find((x) => x.toLowerCase() === String(w.action).trim().toLowerCase());
  if (!action)
    return { ok: false, message: `The action must be one of: ${LOG_ACTIONS.join(", ")}.` };
  const live = boot.services.filter((s) => isLive(s, boot.today));
  let serviceId: string | null = null;
  const wholeDay = action === "Leave" || action === "Supplier Off";
  if (w.service !== undefined && String(w.service).trim() !== "") {
    const r = resolveName("service", String(w.service), boot.services, boot.today);
    if (!r.ok) return r;
    serviceId = r.id;
  } else if (!wholeDay) {
    if (live.length === 1) serviceId = live[0]?.id as string;
    else
      return {
        ok: false,
        message: `Which service? A ${action.toLowerCase()} is for one service. The choices are ${live.map((s) => `“${s.name}”`).join(", ") || "none yet"}.`,
      };
  }
  let itemId: string | null = null;
  if (w.item !== undefined && String(w.item).trim() !== "") {
    const kind = action === "Switch" ? "meal" : action === "Extra" ? "addon" : null;
    const all = boot.catalogue;
    const pool = kind ? all.filter((i) => i.kind === kind) : all;
    let r = resolveName("item", String(w.item), pool, boot.today);
    // A name that is the other kind is the kitchen's to refuse, in its own words.
    if (!r.ok && kind) {
      const other = resolveName("item", String(w.item), all, boot.today);
      if (other.ok) r = other;
    }
    if (!r.ok) return r;
    itemId = r.id;
  }
  const off = action === "Supplier Off";
  return {
    ok: true,
    body: {
      date: w.date,
      personId: off ? null : (w.personId ?? boot.me.personId),
      allConsumers: off,
      action,
      serviceId,
      itemId,
      qty: w.qty ?? null,
      ...(w.note !== undefined ? { note: w.note } : {}),
    },
  };
}

// --- completions ----------------------------------------------------------------------------------------

export const MAX_COMPLETIONS = 100;

export interface CompletionContext {
  /** The kitchen's today. */
  today: string;
  role: Role;
  /** Weekdays the kitchen cooks, 0 is Sunday. */
  workingDays: readonly number[];
  /** Days the kitchen counts as holidays, already narrowed to those that count. */
  holidays: readonly string[];
  /** The names of the services the person may log in (all, for the admin and supplier; their own, for a member). */
  services?: readonly string[];
  /** The kitchen's items, live ones. */
  items?: readonly { name: string; kind: "meal" | "addon" }[];
  /** The action already chosen, which narrows the items. */
  action?: string;
}

export interface Completion {
  values: string[];
  total: number;
  hasMore: boolean;
}

/** The log actions a role may write: a member's own, a supplier's day off, an admin's all. */
export const actionsFor = (role: Role): LogAction[] =>
  role === "consumer"
    ? LOG_ACTIONS.filter((c) => c !== "Supplier Off")
    : role === "supplier"
      ? ["Supplier Off"]
      : [...LOG_ACTIONS];

const RECENT_MONTHS = 12;
const LOOKAHEAD_DAYS = 45;

/** The arguments there is something to suggest for. */
export const COMPLETABLE = ["month", "date", "action", "service", "item", "method"] as const;

const finish = (all: string[], typed: string, ci: boolean): Completion => {
  const t = ci ? typed.toLowerCase() : typed;
  const hits = all.filter((v) => (ci ? v.toLowerCase() : v).startsWith(t));
  return {
    values: hits.slice(0, MAX_COMPLETIONS),
    total: hits.length,
    hasMore: hits.length > MAX_COMPLETIONS,
  };
};

/** Values to suggest for one argument, narrowed by what has been typed so far. At most 100, with the count of all. */
export function complete(argument: string, typed: string, ctx: CompletionContext): Completion {
  switch (argument) {
    case "month": {
      const cur = monthOf(ctx.today);
      return finish(
        Array.from({ length: RECENT_MONTHS }, (_, i) => addMonths(cur, -i)),
        typed,
        false,
      );
    }
    case "date": {
      const off = new Set(ctx.holidays);
      const days: string[] = [];
      for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
        const d = addDays(ctx.today, i);
        if (ctx.workingDays.includes(weekdayOf(d)) && !off.has(d)) days.push(d);
      }
      return finish(days, typed, false);
    }
    case "action":
      return finish(actionsFor(ctx.role), typed, true);
    case "service":
      return finish([...(ctx.services ?? [])], typed, true);
    case "item": {
      // A supplier's only entry is a day off, which names no item; a switch is to a meal, an extra is of an add-on.
      const kind = ctx.action?.toLowerCase();
      const wanted =
        ctx.role === "supplier" || kind === "leave" || kind === "supplier off"
          ? []
          : (ctx.items ?? []).filter(
              (i) =>
                kind === undefined ||
                (kind === "switch"
                  ? i.kind === "meal"
                  : kind === "extra"
                    ? i.kind === "addon"
                    : true),
            );
      return finish(
        wanted.map((i) => i.name).sort((a, b) => a.localeCompare(b, "en")),
        typed,
        true,
      );
    }
    case "method":
      return finish([...PAY_METHODS], typed, true);
    default:
      return { values: [], total: 0, hasMore: false };
  }
}
