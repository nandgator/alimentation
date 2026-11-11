/**
 * Delimited text, read and written. Everything here is pure. Holidays and people are imported from it, and
 * people are exported to it, so what one reads the other writes.
 */

/** The text without the byte-order mark a spreadsheet puts first. */
export const withoutBom = (text: string): string => text.replace(/^\uFEFF/, "");

/** The delimiter of pasted or uploaded text: whichever of comma, tab and semicolon the first line has most of. */
export const delimiterOf = (text: string): string => {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return [",", "\t", ";"].reduce((best, d) =>
    first.split(d).length > first.split(best).length ? d : best,
  );
};

/** Cells of delimited text, quotes honoured (a doubled quote is one), with the line each record began on. */
export function records(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let touched = false;
  const endCell = () => {
    cells.push(cell);
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (touched) out.push({ line: startLine, cells });
    cells = [];
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (!touched) startLine = line;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      touched = true;
    } else if (ch === delimiter) {
      endCell();
      touched = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
    } else {
      cell += ch;
      if (ch.trim() !== "") touched = true;
    }
  }
  endRecord();
  return out.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

// --- writing -----------------------------------------------------------------------------------------

/** A spreadsheet treats a cell that begins with one of these as a formula, and runs it. */
const FORMULA = /^'*[=+\-@\t\r]/;
const GUARDED = /^'+[=+\-@\t\r]/;

/**
 * One cell of a file a spreadsheet may open. A cell that would be taken for a formula (it begins with =, +,
 * -, @, a tab or a carriage return, after any apostrophes) gets an apostrophe in front, which a spreadsheet
 * shows as plain text; `unguardCell` takes it off again. Quotes are added where the cell needs them.
 */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? "";
  if (FORMULA.test(v)) v = `'${v}`;
  return /[",;\n\r\t]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The cell as `csvCell` found it: the one apostrophe it put in front of a would-be formula is taken off. */
export const unguardCell = (cell: string): string => (GUARDED.test(cell) ? cell.slice(1) : cell);

/** Rows as text: a line each, ending in a line break, with every cell guarded and quoted by `csvCell`. */
export const toCsv = (rows: (string | null | undefined)[][]): string =>
  rows.map((r) => `${r.map(csvCell).join(",")}\r\n`).join("");
