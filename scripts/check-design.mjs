// Does the application keep to its design system?  node scripts/check-design.mjs [--list]
//
// The system is written down in docs/research/ui-rewrite-plan.md (section 2, and section 7 for these rules) and
// drawn from the tokens of apps/web/src/theme.css. This checks the parts of it a machine can:
//
//   colour      no raw colour (hex, rgb, hsl, oklch, lab, lch) outside theme.css: not in a stylesheet, not in a class
//   shadow      no shadow of its own: a stylesheet uses `none` or a token, a class a shadow of the scale
//   radius      no radius of its own: a stylesheet uses a token, `0`, a pill or a circle, a class one of the scale
//   arbitrary   no arbitrary Tailwind length (`w-[13px]`) outside components/ui/
//   control     no native number, date, checkbox, radio or file input and no <select> outside components/ui/ and
//               components/app/: the kit's controls are used instead
//   reload      no window.location.reload: a screen loads its data again, not the page
//   title       a screen that is a route renders a PageHeader or a NotAvailable
//   icon        no icon set but lucide-react, and no inline <svg> outside Mark, the home page and the charts
//   role        no "Supplier" or "Member" in a string a person reads: the labels come from ROLE_LABEL
//   inline      no style={{ ... }} without a reason
//   status      no small filled dot beside a status: a status is a badge with words
//   selector    no end-to-end test finds a thing by its class: they ask by role, label and visible text
//
// A line that has a good reason to break a rule says so, on that line or the one above it: `// design: the reason`,
// `/* design: the reason */` or `{/* design: the reason */}`. (What a page looks like once drawn is measured in the
// browser, in apps/web/e2e.) Run by `bun run design`, and by the test suite.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");

/** The stylesheets, and the rules that apply to each. The home page's pictures are drawn, so shape is theirs. */
const CSS = [
  { file: "apps/web/src/shell/shell.css", rules: "colour shadow radius" },
  { file: "apps/web/scripts/docs/docs.css", rules: "colour shadow radius" },
  { file: "apps/web/src/home/art.css", rules: "colour shadow" },
];

const COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/;
const COLOUR_HEX = /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;

/** Where a file lives, as a path under apps/web with forward slashes. */
const under = (file) =>
  file
    .replace(/\\/g, "/")
    .replace(/^.*?apps\/web\//, "")
    .replace(/^\.\//, "");

/**
 * The text of a source file with its comments blanked (lengths and line numbers stay) and the lines that are
 * waived: the lines of a comment that says `design:`, and the one after it.
 */
function strip(text, { css = false } = {}) {
  const waived = new Set();
  let out = "";
  let line = 1;
  const waive = (body) => {
    if (!/\bdesign:/.test(body)) return;
    const last = line + (body.match(/\n/g)?.length ?? 0);
    for (let l = line; l <= last + 1; l++) waived.add(l);
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      const body = text.slice(i, stop);
      waive(body);
      out += body.replace(/[^\n]/g, " ");
      line += body.match(/\n/g)?.length ?? 0;
      i = stop;
    } else if (!css && two === "//" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      const body = text.slice(i, stop);
      waive(body);
      out += " ".repeat(body.length);
      i = stop;
    } else if (!css && (ch === '"' || ch === "'" || ch === "`")) {
      // A string: copy it whole, so that `//` and `/*` inside it are not taken for comments.
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        else if (ch !== "`" && text[j] === "\n") break;
        j++;
      }
      const body = text.slice(i, j + 1);
      out += body;
      line += body.match(/\n/g)?.length ?? 0;
      i = j + 1;
    } else {
      out += ch;
      if (ch === "\n") line++;
      i++;
    }
  }
  return { rows: out.split("\n"), waived };
}

const problem = (file, line, rule, why, text) => ({
  file,
  line,
  rule,
  why,
  text: text.trim().replace(/\s+/g, " ").slice(0, 110),
});

/** The rules of one stylesheet's text. `rules` is `all`, or the names of those that apply. */
export function checkCssText(text, file = "a.css", rules = "all") {
  const want = (r) => rules === "all" || rules.split(" ").includes(r);
  const problems = [];
  const { rows, waived } = strip(text, { css: true });
  // A declaration may span lines: join to the semicolon, keeping the line it began on.
  const decls = [];
  let current = "";
  let start = 0;
  rows.forEach((row, i) => {
    for (const piece of row.split(/([;{}])/)) {
      if (piece === ";" || piece === "{" || piece === "}") {
        if (piece === ";" && current.trim()) decls.push({ text: current, line: start });
        current = "";
      } else if (piece.trim()) {
        if (!current.trim()) start = i + 1;
        current += ` ${piece}`;
      }
    }
  });
  for (const d of decls) {
    if (waived.has(d.line)) continue;
    const m = /^\s*([a-z-]+|--[a-z0-9-]+)\s*:\s*(.*)$/.exec(d.text);
    if (!m) continue;
    const [, prop, value] = m;
    const add = (rule, why) => problems.push(problem(file, d.line, rule, why, d.text));
    if (want("colour") && (COLOUR_FN.test(value) || COLOUR_HEX.test(value)))
      add("colour", "a raw colour: colours are written in theme.css only");
    const token = prop.startsWith("--");
    if (want("shadow") && !token && (prop === "box-shadow" || /drop-shadow\(/.test(value))) {
      const plain = /^(none|inherit|var\(--[a-z0-9-]+\))$/.test(value.trim());
      if (!plain && !/^(filter|-webkit-filter)$/.test(prop))
        add("shadow", "a shadow that is not none or a token");
      if (/^(filter|-webkit-filter)$/.test(prop) && /drop-shadow\((?!var\()/.test(value))
        add("shadow", "a shadow that is not a token");
    }
    if (want("radius") && !token && /^border(-[a-z]+)*-radius$/.test(prop)) {
      for (const part of value.split(/[\s/]+/))
        if (part && !/^(0|inherit|50%|100%|999px|var\(.*\)|calc\(.*\))$/.test(part))
          add("radius", `${part} is not a radius token`);
    }
  }
  return problems;
}

/** A class string's arbitrary values: the `[...]` parts of utilities such as `w-[13px]` and `shadow-[...]`. */
function arbitraryValues(row) {
  const out = [];
  const re =
    /(?<![\w[\]-])(?:[a-z0-9&_>*:[\]()=.%-]+:)*!?-?([a-z][a-z0-9-]*)-\[((?:[^\][]|\[[^\]]*\])*)\]/g;
  for (const m of row.matchAll(re)) out.push({ utility: m[1], value: m[2] });
  return out;
}

/** What a component, a page or a helper may not do. `file` is its path, which decides the rules that apply. */
export function checkTsxText(text, file = "a.tsx") {
  const problems = [];
  const where = under(file);
  const { rows, waived } = strip(text);
  const inUi = where.startsWith("src/components/ui/");
  const inKit = inUi || where.startsWith("src/components/app/");
  const isTsx = file.endsWith(".tsx");
  const svgOk =
    inUi ||
    where.startsWith("src/home/") ||
    /(^|\/)(Mark|MonthlyChart|chart)\.tsx$/.test(where) ||
    where === "src/pages/Home.tsx";
  const roleOk = /(^|\/)sections\.ts$/.test(where);
  rows.forEach((row, i) => {
    const n = i + 1;
    if (waived.has(n)) return;
    const add = (rule, why) => problems.push(problem(file, n, rule, why, row));

    if (COLOUR_FN.test(row) || COLOUR_HEX.test(row))
      add("colour", "a raw colour: use a colour token (bg-primary, text-muted-foreground, ...)");

    if (!inUi)
      for (const { utility, value } of arbitraryValues(row)) {
        if (/^(shadow|inset-shadow|drop-shadow)$/.test(utility) && !/var\(--/.test(value))
          add("shadow", `${utility}-[${value}] is a shadow of its own: use a shadow of the scale`);
        else if (/^rounded(-[a-z]{1,2})?$/.test(utility) && !/var\(--/.test(value))
          add("radius", `${utility}-[${value}] is a radius of its own: use a radius of the scale`);
        else if (
          /(?:^|[^\w.-])-?\d*\.?\d+(?:px|rem|em)\b/.test(value) &&
          !/^(length|color|image|url):/.test(value)
        )
          add("arbitrary", `${utility}-[${value}]: use a size of the scale, or say why`);
      }

    if (!inKit) {
      if (/\btype=(?:"number"|'number'|\{"number"\})/.test(row) || /\btype:\s*"number"/.test(row))
        add("control", 'type="number": use CountInput or MoneyInput');
      if (
        /<input\b[^>]*\btype=(?:"|')?(date|checkbox|radio|file|datetime-local|month|time)\b/.test(
          row,
        )
      )
        add(
          "control",
          "a native input of this type: use the kit's DateField, Checkbox, RadioGroup or a file control",
        );
      if (/<select\b/.test(row))
        add("control", "a native <select>: use Select, or ToggleGroup for a short choice");
    }

    if (/\b(?:window\.)?location\.reload\(/.test(row))
      add("reload", "a page reload: load the data again instead");

    if (
      /from\s+["'](?:react-icons|@heroicons|@tabler\/icons|@phosphor-icons|@radix-ui\/react-icons|@remixicon|@fortawesome|@mui\/icons|@ant-design\/icons|iconoir|feather-icons|bootstrap-icons)/.test(
        row,
      )
    )
      add("icon", "an icon set other than lucide-react");
    if (isTsx && !svgOk && /<svg\b/.test(row))
      add("icon", "an inline <svg>: use a lucide-react icon");

    if (isTsx && !roleOk) {
      // A string literal, or the words of a JSX element: not an identifier, not an API value.
      for (const s of row.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]*)</g)) {
        const t = s[1] ?? s[2] ?? s[3] ?? s[4] ?? "";
        if (/\b(?:Supplier|Member)s?\b/.test(t))
          add(
            "role",
            'a role name written out: take it from ROLE_LABEL (the words are "Admin", "Cook", "Consumer")',
          );
      }
    }

    if (isTsx && /style=\{\{/.test(row))
      add("inline", "an inline style: use a class or a token, or say why with a design: comment");

    if (
      !inUi &&
      /\brounded-full\b/.test(row) &&
      /(?<![\w-])size-[23](?![\w.-])/.test(row) &&
      /\bbg-[a-z]/.test(row)
    )
      add("status", "a small filled dot: a status is a badge with words (StatusBadge)");
  });
  return problems;
}

/** What an end-to-end test may not do: find a thing by its class. */
export function checkSpecText(text, file = "a.spec.ts") {
  const problems = [];
  const { rows, waived } = strip(text);
  const call =
    /(?:locator|querySelector(?:All)?|\$\$?|closest|matches)\s*(?:<[^>]*>)?\(\s*(["'`])((?:(?!\1).)*)\1/g;
  rows.forEach((row, i) => {
    if (waived.has(i + 1)) return;
    for (const m of row.matchAll(call))
      if (/(^|[\s>+~,(])[a-z0-9*]*\.[a-zA-Z_][\w-]*|\[class[~|^$*]?=/.test(m[2]))
        problems.push(
          problem(
            file,
            i + 1,
            "selector",
            "finds a thing by its class: ask by role, label or visible text",
            row,
          ),
        );
  });
  return problems;
}

/** A screen that is a route renders a PageHeader or a NotAvailable (itself, or through the layout that does). */
export function checkPageText(text, file = "Page.tsx") {
  if (/\b(PageHeader|NotAvailable|Unavailable|NotFound)\b/.test(text)) return [];
  return [
    problem(
      file,
      1,
      "title",
      "a screen with no PageHeader or NotAvailable: it has no title to read or focus",
      file,
    ),
  ];
}

/** Files the routers import that are not screens: the public site's home page (its own headline) and a provider. */
const NOT_SCREENS = new Set(["src/pages/Home.tsx", "src/pages/workspace/context.tsx"]);

const walk = (dir, keep) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === "dist" ? [] : walk(p, keep);
    return keep(f) ? [p] : [];
  });

/** The files of src/pages that the routers name, which are the screens. */
function routedPages() {
  const files = new Set();
  for (const router of ["src/App.tsx", "src/shell/Routes.tsx", "src/shell/WorkspaceShell.tsx"]) {
    let text = "";
    try {
      text = readFileSync(join(web, router), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(
      /(?:from\s+|import\()\s*["']((?:\.{1,2}\/)+pages\/[^"']+?)(?:\.tsx)?["']/g,
    ))
      files.add(join(web, router, "..", `${m[1]}.tsx`));
  }
  return [...files];
}

export function check() {
  const problems = [];
  for (const { file, rules } of CSS)
    problems.push(...checkCssText(readFileSync(join(root, file), "utf8"), file, rules));
  const sources = walk(join(web, "src"), (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  for (const path of sources)
    problems.push(...checkTsxText(readFileSync(path, "utf8"), relative(root, path)));
  for (const path of walk(join(web, "e2e"), (f) => /\.spec\.ts$/.test(f)))
    problems.push(...checkSpecText(readFileSync(path, "utf8"), relative(root, path)));
  for (const path of routedPages()) {
    if (NOT_SCREENS.has(under(path))) continue;
    try {
      problems.push(...checkPageText(readFileSync(path, "utf8"), relative(root, path)));
    } catch {
      // A route that names a file that is not there is the compiler's to report.
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = check();
  const by = new Map();
  for (const p of problems) by.set(p.rule, (by.get(p.rule) ?? 0) + 1);
  if (process.argv.includes("--list"))
    for (const p of problems)
      console.log(`${p.file}:${p.line}  [${p.rule}] ${p.why}\n    ${p.text}`);
  console.log(
    problems.length
      ? `\n${problems.length} places leave the design system: ${[...by].map(([r, n]) => `${r} ${n}`).join(", ")}`
      : "The application keeps to the design system.",
  );
  process.exit(problems.length ? 1 : 0);
}
