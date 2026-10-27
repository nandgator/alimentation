// Does the application keep to its design system?  node scripts/check-design.mjs [--list]
//
// The system is written down in docs/site/docs/design/ (rendered at /docs/design/). This checks
// the parts of it a machine can: that colour, shadow, layering, motion, type, shape and
// spacing come from the shared tokens, and that nothing is styled inline. A line that
// has a good reason to break a rule says so, in the same line: /* design: the reason */.
// Run by `npm run design`, and by the test suite.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');

/** What each file answers to. The home page's pictures are drawn, so shape and spacing are theirs. */
const CSS = [
  { file: 'apps/web/src/styles.css', rules: 'all' },
  { file: 'apps/web/scripts/docs/docs.css', rules: 'all' },
  { file: 'apps/web/src/home.css', rules: 'colour shadow layer important font' },
];

const NUMBER = String.raw`-?\d*\.?\d+`;
export const SCALES = {
  // The radii a shape may have. Anything round is a pill.
  radius: new Set(['0', '4px', '8px', '12px', '16px', '999px', '50%']),
  // Space is on a grid of two pixels up to 24, then these.
  space: new Set([28, 32, 40, 48, 56, 64, 80, 96]),
  // Type: rem steps, or something fluid, or a size taken from its parent.
  fontSize: /^(inherit|var\(--text-[a-z0-9]+\)|clamp\(.*\)|calc\(.*\)|[\d.]+em|[\d.]+%)$/,
  // The widths at which the layout changes.
  breakpoints: new Set([480, 560, 720, 959, 960, 1199, 1200]),
  // How long things take, and how they move, are tokens; these are the plain exceptions.
  easing: new Set(['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out']),
};

/** The text of a stylesheet with comments blanked (so lengths and line numbers stay) and waivers noted. */
function lines(text) {
  const waived = new Set();
  const stripped = text.replace(/\/\*([\s\S]*?)\*\//g, (m, body, offset) => {
    if (/^\s*design:/.test(body)) {
      const line = text.slice(0, offset).split('\n').length + m.split('\n').length - 1;
      for (let l = text.slice(0, offset).split('\n').length; l <= line; l++) waived.add(l);
    }
    return m.replace(/[^\n]/g, ' ');
  });
  return { rows: stripped.split('\n'), waived };
}

/** The statements of a stylesheet, each with the lines it spans: a rule's opening, a declaration, a closing brace. */
function statements(text) {
  const { rows, waived } = lines(text);
  const out = [];
  let current = '';
  let start = 1;
  rows.forEach((row, i) => {
    for (const ch of row) {
      if (!current.trim()) start = i + 1;
      if (ch === '{' || ch === '}' || ch === ';') {
        const body = current.trim();
        if (body) out.push({ text: ch === ';' ? body : body, open: ch === '{', start, end: i + 1 });
        if (ch === '}') out.push({ text: '}', close: true, start: i + 1, end: i + 1 });
        current = '';
      } else current += ch;
    }
    current += '\n';
  });
  const rest = current.trim();
  if (rest) out.push({ text: rest, start, end: rows.length });
  return { out, waived };
}

/** The rules of one stylesheet's text. `rules` is `all`, or the names of those that apply. */
export function checkCssText(text, file = 'a.css', rules = 'all') {
  const problems = [];
  const want = (r) => rules === 'all' || rules.split(' ').includes(r);
  const { out, waived } = statements(text);
  let depth = 0;
  let reduced = 0; // the depth inside a reduced-motion block, while we are in one
  for (const st of out) {
    if (st.close) {
      depth--;
      if (reduced && depth < reduced) reduced = 0;
      continue;
    }
    const line = st.text.replace(/\s+/g, ' ');
    if (st.open) {
      depth++;
      if (/@media[^{]*prefers-reduced-motion:\s*reduce/.test(line)) reduced = depth;
      const media = /@media\s*\(\s*(?:max|min)-width:\s*(\d+)px\s*\)/.exec(line);
      let isWaived = false;
      for (let l = st.start; l <= st.end; l++) isWaived ||= waived.has(l);
      if (media && !isWaived && want('breakpoint') && !SCALES.breakpoints.has(Number(media[1])))
        problems.push({
          file,
          line: st.start,
          rule: 'breakpoint',
          why: `${media[1]}px is not one of ${[...SCALES.breakpoints].join(', ')}`,
          text: line.slice(0, 110),
        });
      continue;
    }
    let isWaived = false;
    for (let l = st.start; l <= st.end; l++) isWaived ||= waived.has(l);
    if (isWaived) continue;
    const decl = /^([a-z-]+|--[a-z0-9-]+)\s*:\s*(.*)$/.exec(line);
    if (!decl) continue;
    const add = (rule, why) =>
      problems.push({ file, line: st.start, rule, why, text: line.slice(0, 110) });
    const [, prop, value] = decl;
    const isToken = prop.startsWith('--');
    const inReduced = reduced > 0;

    // Colour comes from a token. A token's own definition may name a colour; nothing else may.
    if (
      want('colour') &&
      !isToken &&
      /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|oklch|lab)\(/.test(value)
    )
      add('colour', 'a raw colour: use a colour token');
    // What rises above the page casts a shadow from the scale; nothing else invents one.
    if (
      want('shadow') &&
      !isToken &&
      (prop === 'box-shadow' || /drop-shadow\(/.test(value)) &&
      !/^(none|var\(--[a-z-]+\))$/.test(value.trim())
    )
      add('shadow', 'a shadow that is not a token');
    if (
      want('layer') &&
      prop === 'z-index' &&
      !/^(-?[0-2]|var\(--z-[a-z]+\)|calc\(var\(--z-[a-z]+\) [-+] \d+\))$/.test(value.trim())
    )
      add('layer', 'a z-index that is not on the scale');
    if (want('important') && /!important/.test(value) && !inReduced)
      add('important', '!important outside the reduced-motion block');
    if (
      want('font') &&
      prop === 'font-family' &&
      !/^(inherit|var\(--(serif|sans|mono)\))$/.test(value.trim())
    )
      add('font', 'a font that is not a token');
    if (
      want('font') &&
      prop === 'font' &&
      !isToken &&
      !/var\(--(serif|sans|mono)\)|^inherit$/.test(value)
    )
      add('font', 'a font shorthand with no font token');
    if (want('type') && prop === 'font-size' && !SCALES.fontSize.test(value.trim()))
      add('type', `${value} is not a size on the type scale`);
    if (want('type') && prop === 'font' && !isToken) {
      const size = /(?<![\w.#-])([\d.]+(?:rem|px))(?=\/|\s)/.exec(value);
      if (size) add('type', `${size[1]} in a font shorthand is not on the type scale`);
    }
    if (
      want('space') &&
      /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/.test(prop) &&
      !isToken
    ) {
      for (const px of value.matchAll(/(?<![\w.#-])(-?\d+(?:\.\d+)?)px/g)) {
        const n = Math.abs(Number(px[1]));
        if (!(Number.isInteger(n) && ((n <= 24 && n % 2 === 0) || SCALES.space.has(n))))
          add('space', `${px[1]}px is off the two-pixel grid`);
      }
    }
    if (want('radius') && /^border(-[a-z]+)*-radius$/.test(prop)) {
      for (const part of value.split(/[\s/]+/))
        if (part && !SCALES.radius.has(part) && !/^var\(|^inherit$|^calc\(/.test(part))
          add('radius', `${part} is not a radius on the scale`);
    }
    if (want('motion') && /^(transition|animation)(-duration)?$/.test(prop) && !inReduced) {
      const durations = value.match(new RegExp(`(?<![-\\w.])${NUMBER}m?s\\b`, 'g')) ?? [];
      const nonZero = durations.filter((d) => !/^0(\.0+)?m?s$/.test(d));
      if (nonZero.length) add('motion', `${nonZero.join(', ')}: use a duration token`);
      for (const word of value.match(/\b(ease-in-out|ease-in|ease-out|ease|linear)\b/g) ?? [])
        if (!SCALES.easing.has(word)) add('motion', `${word} is not an easing`);
      if (/cubic-bezier\(/.test(value)) add('motion', 'an easing curve that is not a token');
    }
  }
  return problems;
}

function checkCss({ file, rules }, problems) {
  problems.push(...checkCssText(readFileSync(join(root, file), 'utf8'), file, rules));
}

/** TSX: no styling inline except to pass a value to the stylesheet. */
function checkTsx(problems) {
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : walk(p);
      return /\.tsx$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
  for (const path of walk(join(web, 'src')))
    problems.push(...checkTsxText(readFileSync(path, 'utf8'), relative(root, path)));
}

/** The inline styles in one component's text. */
export function checkTsxText(text, file = 'a.tsx') {
  const problems = [];
  {
    const rows = text.split('\n');
    rows.forEach((row, i) => {
      if (/design:/.test(row) || /design:/.test(rows[i - 1] ?? '')) return;
      const m = /style=\{\{(.*)$/.exec(row);
      if (!m) return;
      // A single-line style object is fine only when every key hands a value to the stylesheet.
      const keys = [...m[1].matchAll(/(?:\[\s*'(--[a-z0-9-]+)'[^\]]*\]|(\w+))\s*:/g)].map(
        (k) => k[1] ?? k[2],
      );
      const loose = keys.filter((k) => !k.startsWith('--'));
      if (!keys.length || loose.length)
        problems.push({
          file,
          line: i + 1,
          rule: 'inline',
          why: `inline style (${loose.join(', ') || 'multi-line'}): use a class or a token`,
          text: row.trim().slice(0, 110),
        });
    });
  }
  return problems;
}

export function check() {
  const problems = [];
  for (const c of CSS) checkCss(c, problems);
  checkTsx(problems);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = check();
  const by = new Map();
  for (const p of problems) by.set(p.rule, (by.get(p.rule) ?? 0) + 1);
  if (process.argv.includes('--list'))
    for (const p of problems)
      console.log(`${p.file}:${p.line}  [${p.rule}] ${p.why}\n    ${p.text}`);
  console.log(
    problems.length
      ? `\n${problems.length} places leave the design system: ${[...by].map(([r, n]) => `${r} ${n}`).join(', ')}`
      : 'The application keeps to the design system.',
  );
  process.exit(problems.length ? 1 : 0);
}
