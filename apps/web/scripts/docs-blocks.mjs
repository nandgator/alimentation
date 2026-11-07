// The two kinds of fenced block in the documentation that are more than text: code, and diagrams.
//
//   ```ts                                     highlighted; numbered when it is long enough to point at
//   ```ts file=packages/core/src/engine.ts#L12-L30
//                                             the lines of that file, as they are in it, numbered as
//                                             in it. The build fails if the file or the lines are gone
//   ```ts hl=3,5-7        marks lines          numbers / nonumbers  force them on or off
//   ```console            a session: a line after "$ " is typed, every other line is what came back
//   ```mermaid title="Where a request goes"   a diagram, drawn at build time and left as an SVG
//
// Nothing here runs in the page. The content-security policy forbids inline style, so highlighting is
// class names (coloured in docs.css, from the design system's own tokens) and a diagram has its style
// element and style attribute taken out and its colours set by the same stylesheet, from the same
// tokens. So a diagram, like code, is right in the light and the dark theme without being drawn again.
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { renderMermaidSVG } from "beautiful-mermaid";

const LANGUAGES = {
  bash,
  css,
  diff,
  dockerfile,
  ini,
  javascript,
  json,
  markdown,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, grammar] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, grammar);

/** What the label above a block says, by the grammar's own name. */
const LABEL = {
  bash: "Shell",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  ini: "TOML",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "HTML",
  yaml: "YAML",
};
/** Fences with no highlighting. */
const PLAIN = new Set(["", "text", "txt", "plain", "plaintext"]);
/** A block of commands to type is not a listing: it is not numbered unless asked. */
const COMMANDS = new Set(["bash"]);
/** From this many lines on, a listing is numbered, so that it can be pointed at. */
const NUMBER_FROM = 6;
/** A whole file is shown only when it is short; a longer one needs a range. */
const WHOLE_FILE_MOST = 60;

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `ts file=a/b.ts#L1-L9 hl=2,4-5 title="Two words" numbers` as a language and its settings. */
export function parseFence(info) {
  const words = [];
  const re = /([\w-]+)=("[^"]*"|\S+)|(\S+)/g;
  for (const m of (info ?? "").matchAll(re)) words.push(m);
  const first = words[0] && words[0][3] ? words.shift()[3] : "";
  const settings = {};
  const flags = new Set();
  for (const m of words) {
    if (m[1]) settings[m[1]] = m[2].replace(/^"|"$/g, "");
    else flags.add(m[3]);
  }
  return { lang: first.toLowerCase(), settings, flags };
}

/** `3,5-7` as the set of lines 3, 5, 6 and 7. */
function lineSet(spec, where) {
  const out = new Set();
  for (const part of spec.split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`${where}: "${part}" is not a line or a range of lines (hl=3,5-7)`);
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    for (let n = from; n <= to; n++) out.add(n);
  }
  return out;
}

/**
 * Highlighted HTML as one string per line. A token that runs over a line break (a comment, a template
 * string) is closed at the end of its line and opened again on the next, so that every line stands alone
 * and can carry its own number.
 */
export function splitLines(html) {
  const lines = [];
  const open = [];
  let line = "";
  for (const m of html.matchAll(/<span[^>]*>|<\/span>|[^<]+/g)) {
    const piece = m[0];
    if (piece.startsWith("<span")) {
      open.push(piece);
      line += piece;
    } else if (piece === "</span>") {
      open.pop();
      line += piece;
    } else {
      piece.split("\n").forEach((text, i) => {
        if (i > 0) {
          lines.push(line + "</span>".repeat(open.length));
          line = open.join("");
        }
        line += text;
      });
    }
  }
  lines.push(line);
  return lines;
}

/** The lines of a real file named in a fence, and the number the first of them has in it. */
function excerpt(path, where, repo) {
  const m = /^([^#]+)(?:#L(\d+)(?:-L?(\d+))?)?$/.exec(path);
  if (!m) throw new Error(`${where}: file=${path} is not a path with #L12-L30 after it`);
  const file = resolve(repo, m[1]);
  if (file !== repo && !file.startsWith(repo + sep))
    throw new Error(`${where}: file=${m[1]} is outside the repository`);
  if (!existsSync(file) || !statSync(file).isFile())
    throw new Error(`${where}: file=${m[1]} does not exist`);
  const all = readFileSync(file, "utf8").replace(/\n$/, "").split("\n");
  const from = m[2] ? Number(m[2]) : 1;
  const to = m[3] ? Number(m[3]) : m[2] ? from : all.length;
  if (from < 1 || to < from || to > all.length)
    throw new Error(
      `${where}: ${m[1]} has ${all.length} lines, so lines ${from} to ${to} are not in it`,
    );
  if (!m[2] && all.length > WHOLE_FILE_MOST)
    throw new Error(
      `${where}: ${m[1]} is ${all.length} lines; name the lines to show (file=${m[1]}#L1-L30)`,
    );
  return {
    text: all.slice(from - 1, to).join("\n"),
    first: from,
    last: to,
    name: relative(repo, file).split(sep).join("/"),
  };
}

/** The name a grammar is registered under, whichever of its usual names a fence uses (ts, sh, yml, html...). */
function canonical(name, where) {
  if (PLAIN.has(name)) return name;
  const grammar = hljs.getLanguage(name);
  if (!grammar)
    throw new Error(
      `${where}: no highlighting for "${name}". It can be ${[...Object.keys(LANGUAGES), "text"].join(", ")}, or one of their usual names (ts, sh, yml, html...)`,
    );
  return Object.keys(LANGUAGES).find((key) => hljs.getLanguage(key) === grammar) ?? name;
}

/** A word that follows a dash is part of an option (`--rm`), not a command of its own, whatever it spells. */
const optionsAreNotCommands = (html) =>
  html.replace(/(\s--?)<span class="hljs-built_in">([\w-]+)<\/span>/g, "$1$2");

function highlight(text, lang) {
  if (PLAIN.has(lang)) return text.split("\n").map(esc);
  const html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  return splitLines(lang === "bash" ? optionsAreNotCommands(html) : html);
}

/**
 * A session as rows: `$ command` is typed (and a line after a trailing backslash goes on with it), and every
 * other line is what came back. The prompt is not kept: the stylesheet draws it, so that it is never selected
 * or copied.
 */
export function parseConsole(text) {
  const rows = [];
  let going = false;
  for (const raw of text.split("\n")) {
    if (going) {
      rows.push({ kind: "cont", text: raw });
      going = /\\\s*$/.test(raw);
      continue;
    }
    const typed = /^\$ ?(.*)$/.exec(raw);
    if (typed) {
      rows.push({ kind: "cmd", text: typed[1] });
      going = /\\\s*$/.test(typed[1]);
    } else rows.push({ kind: "out", text: raw });
  }
  return rows;
}

/** The block itself: a bar with what it is, then the code. The copy button is added by the page's script. */
function figure({ cls, bar, klass = "", body }) {
  return `<figure class="${cls}">${bar}<pre tabindex="0"><code${klass}>${body}</code></pre></figure>\n`;
}

const barOf = (label, range) =>
  label
    ? `<figcaption class="code-bar"><span class="code-name">${esc(label)}</span>${range ? `<span class="code-range">${range}</span>` : ""}</figcaption>`
    : "";

/**
 * The Markdown of a page with the lines of every `file=` excerpt put in, for a reader that gets the text and
 * not the page (a language model, `llms-full.txt`): an empty block that says "lines 28 to 39 of a file" would tell
 * it nothing. The same excerpt, with the same refusals, as the page itself.
 */
export function expandExcerpts(markdown, repo, where) {
  return markdown.replace(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm, (whole, info, text) => {
    const { lang, settings } = parseFence(info);
    if (!settings.file) return whole;
    const found = excerpt(settings.file, where, repo);
    return `\`\`\`${lang}\n// ${found.name}, lines ${found.first} to ${found.last}\n${found.text}\n\`\`\``;
  });
}

export function createBlocks({ repo }) {
  /** Each distinct stylesheet a diagram came with, scoped to diagrams, to be added to the site's. */
  const diagramStyles = new Set();
  let diagrams = 0;

  function code(token, where) {
    const { lang: asked, settings, flags } = parseFence(token.lang);
    if (asked === "mermaid") return diagram(token.text, settings, where);
    if (asked === "console") return consoleBlock(token.text, settings, where);
    // An empty block is never what was meant: it is a fence left open, or one left behind.
    if (!settings.file && !token.text.trim())
      throw new Error(
        `${where}: a code block with nothing in it (a fence left open, or left behind?)`,
      );

    let text = token.text;
    let first = 1;
    let name = null;
    let range = null;
    if (settings.file) {
      if (token.text.trim())
        throw new Error(
          `${where}: a block with file= takes its lines from the file, so it is empty`,
        );
      const found = excerpt(settings.file, where, repo);
      text = found.text;
      first = found.first;
      name = found.name;
      if (/#L/.test(settings.file)) range = `lines ${found.first}–${found.last}`;
    }
    const lang = canonical(asked, where);
    const lines = highlight(text, lang);
    const plain = PLAIN.has(lang);
    const numbered = flags.has("nonumbers")
      ? false
      : flags.has("numbers") ||
        !!settings.file ||
        (lines.length >= NUMBER_FROM && !COMMANDS.has(lang) && !plain);
    const marked = settings.hl ? lineSet(settings.hl, where) : new Set();

    const body = lines
      .map((html, i) => {
        const n = first + i;
        const cls = marked.has(i + 1) ? "line hl" : "line";
        return `<span class="${cls}"${numbered ? ` data-n="${n}"` : ""}>${html}</span>`;
      })
      .join("\n");
    const label = settings.title ?? name ?? (plain ? null : (LABEL[lang] ?? lang));
    const bar = barOf(label, range);
    const cls = ["code", numbered ? "numbered" : "", bar ? "has-bar" : ""]
      .filter(Boolean)
      .join(" ");
    const klass = plain ? "" : ` class="language-${esc(lang)} hljs"`;
    return figure({ cls, bar, klass, body });
  }

  function consoleBlock(text, settings, where) {
    const rows = parseConsole(text.replace(/\n$/, ""));
    if (!rows.some((r) => r.kind === "cmd"))
      throw new Error(
        `${where}: a console block shows a command typed: start the line with "$ " (use sh for a script)`,
      );
    const lines = [];
    for (let i = 0; i < rows.length; ) {
      if (rows[i].kind === "out") {
        lines.push({ kind: "out", html: esc(rows[i].text) });
        i++;
        continue;
      }
      // A command and its continuation lines are highlighted as one, so a quote that runs over a line break holds.
      let j = i + 1;
      while (j < rows.length && rows[j].kind === "cont") j++;
      const chunk = rows
        .slice(i, j)
        .map((r) => r.text)
        .join("\n");
      highlight(chunk, "bash").forEach((html, k) =>
        lines.push({ kind: k === 0 ? "cmd" : "cont", html }),
      );
      i = j;
    }
    const body = lines.map((l) => `<span class="line ${l.kind}">${l.html}</span>`).join("\n");
    return figure({
      cls: "code console has-bar",
      bar: barOf(settings.title ?? "Console"),
      klass: ' class="language-console hljs"',
      body,
    });
  }

  function diagram(source, settings, where) {
    const title = settings.title;
    if (!title)
      throw new Error(
        `${where}: a diagram needs a title, which is what a reader who cannot see it is told (mermaid title="Where a request goes")`,
      );
    let svg;
    try {
      svg = renderMermaidSVG(source, { transparent: true, padding: 24 });
    } catch (e) {
      throw new Error(`${where}: the diagram "${title}" cannot be drawn: ${e.message}`);
    }
    // The stylesheet it came with moves to the site's, scoped, without the font it asks a third party for.
    const styles = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)];
    svg = svg.replace(/<style>[\s\S]*?<\/style>\s*/g, "");
    for (const [, sheet] of styles) diagramStyles.add(scope(sheet, where));
    // The colours it was given on its root element, which the stylesheet gives it instead.
    svg = svg.replace(/^<svg([^>]*?) style="[^"]*"/, "<svg$1");
    const id = `diagram-${++diagrams}`;
    svg = svg.replace(/^<svg /, `<svg role="img" aria-labelledby="${id}" focusable="false" `);
    // What the policy would refuse, or would send a reader's browser to someone else, is not allowed through.
    for (const [bad, what] of [
      [/\sstyle\s*=/i, "an inline style"],
      [/<style/i, "a style element"],
      [/<script/i, "a script"],
      [/\son[a-z]+\s*=/i, "an event handler"],
      [/https?:\/\/(?!www\.w3\.org\/)/i, "an address outside the site"],
      [/@import/i, "an import"],
    ])
      if (bad.test(svg)) throw new Error(`${where}: the diagram "${title}" comes out with ${what}`);
    return `<figure class="diagram" role="group" aria-labelledby="${id}"><div class="diagram-scroll" tabindex="0" role="region" aria-label="Diagram: ${esc(title)}; scrolls sideways when it is wider than the screen">${svg}</div><figcaption id="${id}">${esc(title)}</figcaption><details class="diagram-source"><summary>The diagram as text</summary>${figure({ cls: "code has-bar", bar: barOf("Mermaid"), body: esc(source) })}</details></figure>\n`;
  }

  /** The stylesheet a diagram came with, for diagrams only: no `@import`, and every selector under `.diagram`. */
  function scope(sheet, where) {
    const withoutComments = sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
    if (/@(media|supports|font-face|keyframes)/.test(withoutComments))
      throw new Error(`${where}: a diagram brought a kind of rule that is not handled here`);
    const rules = [];
    for (const m of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `.diagram ${s}`);
      // The font is the site's own, set in docs.css.
      const declarations = m[2]
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && !/^font-family\s*:/.test(d));
      if (declarations.length)
        rules.push(`${selectors.join(", ")} {\n  ${declarations.join(";\n  ")};\n}`);
    }
    return rules.join("\n");
  }

  return {
    code,
    /** What the diagrams drawn so far need added to the site's stylesheet. */
    diagramCss: () => [...diagramStyles].join("\n"),
  };
}
