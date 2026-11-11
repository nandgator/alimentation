import {
  addDays,
  addMonths,
  isValidDate,
  isValidMonth,
  LOG_CHANGES,
  monthOf,
  PAY_METHODS,
  type Role,
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

// --- shared wording -------------------------------------------------------------------------------------

const RULES_OF_THE_ROAD = [
  "Read before you write: look at the kitchen and at what is already there before you change anything.",
  "Before any write, tell the person in plain words exactly what you are about to do (which day, which change, which amount) and ask them whether to go ahead. Do the write only after they say yes.",
  "Money in this kitchen is in paise (hundredths of a rupee, so 100 paise is 1 rupee). Tools take and give paise; show the person rupees.",
  "If a tool answers with an error, give the person the kitchen’s own words and do not try another way round it.",
].join("\n");

const preface = (task: string, steps: string[]): string =>
  `${task}\n\nHow to do it:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n${RULES_OF_THE_ROAD}`;

// --- prompts --------------------------------------------------------------------------------------------

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** The tools it asks the assistant to call. It is listed only to a key that has every one of them. */
  needs: string[];
  /** The text, from arguments already checked. */
  text: (a: Record<string, string>) => string;
}

const CHANGES_HELP = `One of ${LOG_CHANGES.map((c) => `“${c}”`).join(", ")}.`;
const MONTH_HELP = "The month, as YYYY-MM (for example 2026-10).";

const monthOrCurrent = (a: Record<string, string>): string =>
  a.month ? `the month ${a.month}` : "the current month (the kitchen’s `currentMonth`)";

const PROMPTS: PromptDef[] = [
  {
    name: "log-my-meals",
    title: "Log my meals",
    description:
      "Put a leave, a switch between Veg and Non Veg, or an extra on a day, after checking it and asking first.",
    arguments: [
      { name: "date", description: "The day, as YYYY-MM-DD.", required: true },
      {
        name: "change",
        description: `${CHANGES_HELP} If it is left out, ask the person which.`,
        required: false,
      },
    ],
    needs: ["get_bootstrap", "get_log", "post_log_check", "post_log"],
    text: (a) =>
      preface(
        `Help the person log a change to their meals for ${a.date}${a.change ? `: “${a.change}”` : ""}.`,
        [
          "Call get_bootstrap to learn who they are (`me.personId`), today’s date and the rules in force.",
          `Call get_log for ${a.date} (from and to both ${a.date}) to see what is already logged that day.`,
          a.change
            ? `The change is “${a.change}”.`
            : `Ask the person which change they want: ${CHANGES_HELP.toLowerCase()} For an extra, also ask how many.`,
          "Call post_log_check with that entry (date, personId, change, qty) to see whether the kitchen would take it, and what it would warn about, without writing anything.",
          "Tell the person what you found and what you will log. Ask whether to go ahead.",
          "Only if they say yes, call post_log with the same entry, and tell them what the kitchen answered. If they want an entry they already logged withdrawn, delete_log_id does that, again after asking.",
        ],
      ),
  },
  {
    name: "whats-my-balance",
    title: "What is my balance?",
    description:
      "Say what the person owes or is owed for a month, in rupees, and how it is made up.",
    arguments: [
      {
        name: "month",
        description: `${MONTH_HELP} The current month if left out.`,
        required: false,
      },
    ],
    needs: ["get_bootstrap", "get_statements"],
    text: (a) =>
      preface(`Tell the person what their balance is for ${monthOrCurrent(a)}.`, [
        "Call get_bootstrap to learn who they are (`me.personId`) and the current month.",
        `Call get_statements for ${a.month ?? "the current month"} (months), for that person.`,
        "Say what they owe or are owed, in rupees, and the parts it is made up of: meals, extras, anything paid, anything carried over.",
        "You are only reading, so there is nothing to confirm; do not write anything.",
      ]),
  },
  {
    name: "month-end-summary",
    title: "Month-end summary",
    description: "Summarise a month: what was eaten, what it cost, what was paid and what is left.",
    arguments: [{ name: "month", description: MONTH_HELP, required: true }],
    needs: ["get_bootstrap", "get_statements", "get_ledger", "get_claims"],
    text: (a) =>
      preface(`Write a short summary of the month ${a.month} for the person.`, [
        "Call get_bootstrap to learn who they are (`me.personId`).",
        `Call get_statements for ${a.month} for the totals.`,
        `Call get_ledger for ${a.month} and that person to see the days behind the totals: leaves, switches and extras.`,
        "Call get_claims to see which payments have been claimed or confirmed for the month.",
        "Write the summary in plain words and in rupees: days eaten, days on leave, extras, the charge, what was paid, what is left. Point out anything that looks odd, and say so rather than guess.",
        "You are only reading, so there is nothing to confirm; do not write anything.",
      ]),
  },
  {
    name: "am-i-square-for-the-month",
    title: "Am I square for the month?",
    description:
      "Say yes or no on whether the person has paid what they owe for a month, with the figures.",
    arguments: [{ name: "month", description: MONTH_HELP, required: true }],
    needs: ["get_bootstrap", "get_statements", "get_claims", "get_settlements"],
    text: (a) =>
      preface(`Tell the person whether they are square for the month ${a.month}.`, [
        "Call get_bootstrap to learn who they are (`me.personId`).",
        `Call get_statements for ${a.month} for what is owed.`,
        "Call get_claims and get_settlements to see what has been paid, claimed but not yet confirmed, or queried.",
        "Answer plainly: square, or not, and by how much in rupees. Say separately what is claimed but waiting for someone to confirm, because that is not yet counted as paid.",
        "You are only reading, so there is nothing to confirm; do not write anything.",
      ]),
  },
  {
    name: "mark-payment-made",
    title: "Say a payment was made",
    description:
      "Tell the kitchen the person has paid, so that the person who takes payment can confirm it.",
    arguments: [
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
      ),
  },
];

const rupees = (paise: string): string => {
  const n = Number(paise);
  return Number.isInteger(n) ? (n / 100).toFixed(2) : paise;
};

/** The prompts a key may be shown: those whose every tool it has. */
export function promptsFor(toolNames: readonly string[]) {
  const have = new Set(toolNames);
  return PROMPTS.filter((p) => p.needs.every((n) => have.has(n))).map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.arguments,
  }));
}

/** The names of the arguments a prompt takes, or undefined if there is no such prompt. */
export const promptArguments = (name: string): string[] | undefined =>
  PROMPTS.find((p) => p.name === name)?.arguments.map((a) => a.name);

/** The names of the tools a prompt asks for, or undefined if there is no such prompt. */
export const promptNeeds = (name: string): string[] | undefined =>
  PROMPTS.find((p) => p.name === name)?.needs;

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
): PromptResult {
  const def = PROMPTS.find((p) => p.name === name);
  const have = new Set(toolNames);
  if (!def?.needs.every((n) => have.has(n)))
    return bad(`There is no prompt “${name}” for this key.`);
  const a: Record<string, string> = {};
  for (const arg of def.arguments) {
    const v = given?.[arg.name];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    a[arg.name] = String(v).trim();
  }
  const missing = def.arguments.filter((x) => x.required && a[x.name] === undefined);
  if (missing.length) return bad(`Missing: ${missing.map((x) => x.name).join(", ")}.`);
  if (a.date !== undefined && !isValidDate(a.date))
    return bad("date must be a real day, written YYYY-MM-DD.");
  if (a.month !== undefined && !isValidMonth(a.month))
    return bad("month must be a month, written YYYY-MM.");
  if (a.change !== undefined && !(LOG_CHANGES as readonly string[]).includes(a.change))
    return bad(`change must be one of: ${LOG_CHANGES.join(", ")}.`);
  if (a.method !== undefined && !(PAY_METHODS as readonly string[]).includes(a.method))
    return bad(`method must be one of: ${PAY_METHODS.join(", ")}.`);
  if (a.amount !== undefined && !/^[1-9][0-9]{0,11}$/.test(a.amount))
    return bad("amount must be a whole number of paise, more than 0 (100 paise is 1 rupee).");
  return {
    ok: true,
    description: def.description,
    messages: [{ role: "user", content: { type: "text", text: def.text(a) } }],
  };
}

// --- resources ------------------------------------------------------------------------------------------

export const RESOURCE_PREFIX = "alimentation://kitchen/";
export const LEDGER_TEMPLATE = `${RESOURCE_PREFIX}ledger/{month}`;

export type ResourceRef =
  | { kind: "guide" }
  | { kind: "menu" }
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
    uri: `${RESOURCE_PREFIX}menu`,
    name: "menu",
    title: "Rate cards and menu",
    description:
      "Every rate card, oldest first: prices in paise and the menu for each working day.",
    mimeType: "application/json",
    kind: "menu",
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
    case "menu":
      return ["get_rate_cards"];
    case "holidays":
      return ["get_bootstrap"];
    case "ledger":
      return ["get_bootstrap", "get_ledger"];
  }
};

const allOf = (needs: string[], have: Set<string>) => needs.every((n) => have.has(n));

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
            "A line for each day of the month for the person the key acts as. The month is YYYY-MM.",
          mimeType: "application/json",
        },
      ]
    : [];
}

/** What a resource address names, or null when it names nothing this server has (including another kitchen’s). */
export function parseResource(uri: string): ResourceRef | null {
  if (!uri.startsWith(RESOURCE_PREFIX)) return null;
  const rest = uri.slice(RESOURCE_PREFIX.length);
  if (rest === "guide" || rest === "menu" || rest === "holidays") return { kind: rest };
  const m = /^ledger\/([^/?#]+)$/.exec(rest);
  if (m?.[1] && isValidMonth(m[1])) return { kind: "ledger", month: m[1] };
  return null;
}

/** True when the key has what the resource is read through. */
export const canRead = (ref: ResourceRef, toolNames: readonly string[]): boolean =>
  allOf(resourceNeeds(ref), new Set(toolNames));

export const KITCHEN_GUIDE = `How this kitchen works

A kitchen cooks lunch for its members on working days. Each member is billed for the meals they take, at the prices on the kitchen's rate card, and settles at the end of each month. You are acting for one person, in one role, with the scopes your key has. You can do what that person could do with the scopes you were given, and nothing else; what the kitchen's rules or database refuse that person they refuse you.

Units
- Money is in paise, hundredths of a rupee: 100 paise is 1 rupee. Tools take and give paise as whole numbers. Show people rupees.
- A date is YYYY-MM-DD, in the kitchen's own time zone. A month is YYYY-MM.
- A meal is Veg or Non Veg. Extras are Chapati and Bhakri.

Entries (the log)
- Leave: the person does not eat that day. Whether it is charged depends on the kitchen's rules.
- Switch to Veg, Switch to Non Veg: the person eats the other meal that day.
- Extra Chapati, Extra Bhakri: more of those, with a quantity.
- Supplier Off: the kitchen is closed that day for everyone. Only the supplier or an admin can log it.
- A member can log only for themselves. An entry after the cut-off, on a day that is not a working day, or in a month that is closed is refused or warned about, in words. Holidays the kitchen has confirmed are days it does not cook.

Payments
- A payment is first claimed (by the member, or an agent for them) and then confirmed or queried by the person who takes payment. A claim is not yet money paid. You can make or withdraw a claim; you cannot confirm, reverse or settle one.

How to use the tools
- Start with get_bootstrap: the kitchen, who you are (me.personId, role), today, the current month, the rules, the rate card and the holidays.
- Read before you write. To log an entry, check it first with post_log_check, which writes nothing, then post_log. delete_log_id withdraws an entry.
- Before any write, tell the person what you will do and ask. Write only after they agree.
- Each tool call is an ordinary request to the kitchen, counted against its day and recorded in its history as done through an agent.
- If a tool is not listed, your key cannot do it. Closing months, changing prices, rules, people or holidays, and making keys stay with a person.
`;

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
}

export interface Completion {
  values: string[];
  total: number;
  hasMore: boolean;
}

/** The log changes a role may write: a member's own, a supplier's day off, an admin's both. */
export const changesFor = (role: Role): string[] =>
  role === "consumer"
    ? LOG_CHANGES.filter((c) => c !== "Supplier Off")
    : role === "supplier"
      ? ["Supplier Off"]
      : [...LOG_CHANGES];

const RECENT_MONTHS = 12;
const LOOKAHEAD_DAYS = 45;

/** The arguments there is something to suggest for. */
export const COMPLETABLE = ["month", "date", "change", "method"] as const;

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
    case "change":
      return finish(changesFor(ctx.role), typed, true);
    case "method":
      return finish([...PAY_METHODS], typed, true);
    default:
      return { values: [], total: 0, hasMore: false };
  }
}
