import { delimiterOf, records, toCsv, unguardCell, withoutBom } from "./csv.ts";
import { isValidDate } from "./dates.ts";
import type { RowProblem } from "./holidays.ts";
import type { Role } from "./types.ts";

/**
 * Putting many people into a kitchen at once, from a file or a list, and taking them out as a file that
 * can be put back. Everything here is pure: it turns what was pasted into rows, and rows and the people
 * already there into what would happen to each. Writing, the cap on people and the closed-month rules are
 * for the server.
 *
 * A row with an `externalKey` is matched to the person who has that key (a number the kitchen already
 * uses, such as a room or a staff number): added if nobody has it, changed if somebody does. A row without
 * one is always added. People who are not in the file are never touched.
 */

/** The most rows one import may carry. */
export const MAX_PEOPLE_IMPORT_ROWS = 1000;
/** The most bytes one import may be, as text. */
export const MAX_PEOPLE_IMPORT_BYTES = 1_000_000;

export const PERSON_NAME_MAX = 120;
export const PERSON_CONTACT_MAX = 200;
export const EXTERNAL_KEY_MAX = 64;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#-]*$/;

/** Why a key cannot be used, or null when it can. A key is a short code, never a name, an email or a number to call. */
export function checkExternalKey(key: string): string | null {
  if (key.length > EXTERNAL_KEY_MAX)
    return `A key can have at most ${EXTERNAL_KEY_MAX} characters.`;
  if (!KEY_RE.test(key))
    return "A key is letters, digits and . _ : / # - only, starting with a letter or digit (no spaces). Use a code your kitchen already has, not a name, email or phone number.";
  return null;
}

/**
 * Why these details cannot be a person's, or null when they can. The one check behind adding a person by
 * hand, changing one, and every row of an import.
 */
export function checkPersonFields(p: {
  name: string;
  role: Role;
  contact?: string | null;
  activeFrom?: string | null;
  activeTo?: string | null;
}): string | null {
  const name = p.name.trim();
  if (!name || name.length > PERSON_NAME_MAX)
    return `Give a name of up to ${PERSON_NAME_MAX} characters.`;
  if ((p.contact ?? "").trim().length > PERSON_CONTACT_MAX)
    return `A contact can have at most ${PERSON_CONTACT_MAX} characters.`;
  if (p.role !== "consumer" && (p.activeFrom || p.activeTo))
    return "Only consumers are billed between dates.";
  for (const d of [p.activeFrom, p.activeTo])
    if (d && !isValidDate(d)) return `"${d}" is not a date`;
  if (p.activeTo && !p.activeFrom) return "A last date needs a first date.";
  if (p.activeFrom && p.activeTo && p.activeTo < p.activeFrom)
    return "The last date is before the first.";
  return null;
}

// --- the rows --------------------------------------------------------------------------------------

/**
 * One person as it arrives. A field left out (undefined) is not given at all; one that is null or empty is
 * given blank. The difference matters to `overwrite`, which clears what is given blank.
 */
export interface PersonImportItem {
  externalKey?: string | null;
  name?: string | null;
  role?: string | null;
  contact?: string | null;
  activeFrom?: string | null;
  activeTo?: string | null;
}

export type PersonImportMode = "merge" | "overwrite";
export type PersonImportAction = "create" | "update" | "unchanged" | "error";
export type PersonField = "role" | "name" | "contact" | "activeFrom" | "activeTo";

export interface PersonFieldChange {
  field: PersonField;
  from: string | null;
  to: string | null;
}

export interface PersonImportRow {
  /** The row's place in the list (from 1), or its line in the pasted text. */
  row: number;
  action: PersonImportAction;
  externalKey: string | null;
  name: string;
  /** The person it is, once there is one: who is changed, or who was added by a committed import. */
  id: string | null;
  /** What changes: for an addition, what the new person gets; for an update, each field that differs. */
  diff: PersonFieldChange[];
  message: string;
}

export interface PersonImportResult {
  mode: PersonImportMode;
  dryRun: boolean;
  /** True when the people are now in the kitchen. Always false for a dry run, and when any row is refused. */
  committed: boolean;
  /** SHA-256 of the text or rows that were sent, as hex. The audit trail keeps it and nothing else of the file. */
  fileHash: string;
  rows: PersonImportRow[];
  summary: { create: number; update: number; unchanged: number; error: number };
}

/** A person already in the kitchen, as far as a row is compared with them. */
export interface ExistingPerson {
  id: string;
  externalKey: string;
  role: Role;
  name: string;
  contact: string | null;
  activeFrom: string | null;
  activeTo: string | null;
}

export interface NewPerson {
  externalKey: string | null;
  name: string;
  role: Role;
  contact: string | null;
  activeFrom: string | null;
  activeTo: string | null;
  /** The row of the answer to fill in with the new person's id. */
  result: PersonImportRow;
}
export interface PersonUpdate {
  id: string;
  sets: Partial<Record<"name" | "contact" | "activeFrom" | "activeTo", string | null>>;
}

const ROLE_WORDS: Record<string, Role> = {
  admin: "admin",
  supplier: "supplier",
  consumer: "consumer",
  member: "consumer",
};

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * What would happen to each row, given the people already there who have the keys the rows name. The
 * rows come back in order, with the writes that follow from them. Nothing is written for a row that is
 * refused, and the caller writes nothing at all if any row is.
 */
export function planPeopleImport(
  entries: { row: number; item: PersonImportItem }[],
  mode: PersonImportMode,
  existing: ReadonlyMap<string, ExistingPerson>,
): { rows: PersonImportRow[]; creates: NewPerson[]; updates: PersonUpdate[] } {
  const rows: PersonImportRow[] = [];
  const creates: NewPerson[] = [];
  const updates: PersonUpdate[] = [];

  const lines = new Map<string, number[]>();
  for (const { row, item } of entries) {
    const key = clean(item.externalKey);
    if (key) lines.set(key, [...(lines.get(key) ?? []), row]);
  }

  for (const { row, item } of entries) {
    const key = clean(item.externalKey);
    const result: PersonImportRow = {
      row,
      action: "error",
      externalKey: key || null,
      name: clean(item.name),
      id: null,
      diff: [],
      message: "",
    };
    rows.push(result);
    const refuse = (message: string) => {
      result.action = "error";
      result.message = message;
    };

    if (key) {
      const bad = checkExternalKey(key);
      if (bad) {
        refuse(bad);
        continue;
      }
      const same = lines.get(key) ?? [];
      if (same.length > 1) {
        refuse(
          `The key ${key} is on more than one row (${same.join(", ")}). Each key may be given once in a file.`,
        );
        continue;
      }
    }
    const roleWord = clean(item.role).toLowerCase();
    const role = ROLE_WORDS[roleWord];
    if (!role) {
      refuse(
        roleWord
          ? `"${clean(item.role)}" is not a role. Use member, supplier or admin.`
          : "Give a role: member, supplier or admin.",
      );
      continue;
    }
    const given = {
      contact: item.contact !== undefined,
      activeFrom: item.activeFrom !== undefined,
      activeTo: item.activeTo !== undefined,
    };
    const want = {
      name: clean(item.name),
      contact: clean(item.contact) || null,
      activeFrom: clean(item.activeFrom) || null,
      activeTo: clean(item.activeTo) || null,
    };
    const found = key ? existing.get(key) : undefined;
    if (!found) {
      const badFields = checkPersonFields({ ...want, role });
      if (badFields) {
        refuse(badFields);
        continue;
      }
      const diff: PersonFieldChange[] = [{ field: "role", from: null, to: role }];
      for (const field of ["name", "contact", "activeFrom", "activeTo"] as const)
        if (want[field] !== null) diff.push({ field, from: null, to: want[field] });
      result.action = "create";
      result.diff = diff;
      result.message = key
        ? "Will be added: nobody has this key yet."
        : "Will be added. It has no key, so the same file would add it again.";
      creates.push({ externalKey: key || null, role, result, ...want });
      continue;
    }

    result.id = found.id;
    if (found.role !== role) {
      refuse(
        `This key belongs to a ${found.role === "consumer" ? "member" : found.role}, and a role cannot be changed here.`,
      );
      continue;
    }
    // `merge` sets what the row gives and leaves blank cells alone; `overwrite` sets everything the row gives.
    const next: { name: string } & Record<"contact" | "activeFrom" | "activeTo", string | null> = {
      name: want.name,
      contact: found.contact,
      activeFrom: found.activeFrom,
      activeTo: found.activeTo,
    };
    for (const field of ["contact", "activeFrom", "activeTo"] as const)
      if (given[field] && (mode === "overwrite" || want[field] !== null)) next[field] = want[field];
    const stillBad = checkPersonFields({ ...next, role });
    if (stillBad) {
      refuse(stillBad);
      continue;
    }
    const diff: PersonFieldChange[] = [];
    const sets: PersonUpdate["sets"] = {};
    for (const field of ["name", "contact", "activeFrom", "activeTo"] as const) {
      const from = field === "name" ? found.name : found[field];
      if (next[field] === from) continue;
      diff.push({ field, from, to: next[field] });
      sets[field] = next[field];
    }
    result.diff = diff;
    if (diff.length === 0) {
      result.action = "unchanged";
      result.message = "Already as in the file.";
    } else {
      result.action = "update";
      result.message = `Will change ${diff.map((d) => d.field).join(", ")}.`;
      updates.push({ id: found.id, sets });
    }
  }
  return { rows, creates, updates };
}

// --- text ------------------------------------------------------------------------------------------

const COLUMN_OF: Record<string, keyof PersonImportItem> = {
  externalkey: "externalKey",
  key: "externalKey",
  externalid: "externalKey",
  name: "name",
  role: "role",
  contact: "contact",
  activefrom: "activeFrom",
  from: "activeFrom",
  eatingfrom: "activeFrom",
  activeto: "activeTo",
  until: "activeTo",
  to: "activeTo",
};

/** The columns of a file of people, in the order the app writes them. */
export const PEOPLE_CSV_COLUMNS = [
  "externalKey",
  "name",
  "role",
  "contact",
  "activeFrom",
  "activeTo",
] as const;

/**
 * People pasted as text or read from a file: a first line naming the columns (`externalKey`, `name`, `role`,
 * `contact`, `activeFrom`, `activeTo`, in any order; `name` and `role` are needed), then a row for each
 * person. Commas, semicolons or tabs may separate the cells. A column that is not in the file is not given
 * at all; one that is, with an empty cell, is given blank. What `peopleToCsv` writes is read back as it was.
 */
export function parsePeopleCsv(input: string): {
  items: { row: number; item: PersonImportItem }[];
  problems: RowProblem[];
} {
  const text = withoutBom(input);
  const rows = records(text, delimiterOf(text));
  const head = rows[0];
  if (!head) return { items: [], problems: [{ row: 1, message: "There is nothing to import." }] };

  const index = new Map<keyof PersonImportItem, number>();
  const problems: RowProblem[] = [];
  head.cells.forEach((raw, i) => {
    const col =
      COLUMN_OF[
        raw
          .trim()
          .toLowerCase()
          .replace(/[\s_-]/g, "")
      ];
    if (!col) problems.push({ row: head.line, message: `"${raw.trim()}" is not a column.` });
    else if (index.has(col))
      problems.push({ row: head.line, message: `The column "${col}" is given twice.` });
    else index.set(col, i);
  });
  for (const need of ["name", "role"] as const)
    if (!index.has(need))
      problems.push({
        row: head.line,
        message: `The first line must name the columns, and one of them must be "${need}".`,
      });
  if (problems.length > 0) return { items: [], problems };

  const items: { row: number; item: PersonImportItem }[] = [];
  for (const r of rows.slice(1)) {
    if (
      r.cells.length > head.cells.length &&
      r.cells.slice(head.cells.length).some((c) => c.trim())
    ) {
      problems.push({
        row: r.line,
        message: "This row has more cells than the first line has columns.",
      });
      continue;
    }
    const item: PersonImportItem = {};
    for (const [col, at] of index) item[col] = unguardCell((r.cells[at] ?? "").trim());
    items.push({ row: r.line, item });
  }
  return { items, problems };
}

/** People as a file a spreadsheet can open and `parsePeopleCsv` can read back. Cells that look like formulas are made safe. */
export function peopleToCsv(
  people: {
    externalKey: string | null;
    name: string;
    role: Role;
    contact: string | null;
    activeFrom: string | null;
    activeTo: string | null;
  }[],
): string {
  return toCsv([
    [...PEOPLE_CSV_COLUMNS],
    ...people.map((p) => [p.externalKey, p.name, p.role, p.contact, p.activeFrom, p.activeTo]),
  ]);
}

/** A file to start from: the columns, and two made-up people to show what goes where. */
export const peopleCsvTemplate = (): string =>
  toCsv([
    [...PEOPLE_CSV_COLUMNS],
    ["A-101", "Example Member", "consumer", "", "2026-04-01", ""],
    ["S-1", "Example Supplier", "supplier", "", "", ""],
  ]);
