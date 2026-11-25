/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The contrast gate (docs/research/ui-rewrite-plan.md, section 2): every pair of colours in `theme.css` that
 * the interface puts one on the other, measured in both themes. A pair that fails is mended by changing only
 * the lightness of the failing token.
 */

type Rgb = [number, number, number];
type Colour = { rgb: Rgb; alpha: number };

const css = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

/** The declarations of a block, found by its opening selector. */
function block(opening: string): Record<string, string> {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`theme.css has no ${opening}`);
  let depth = 0;
  let i = css.indexOf("{", start);
  const from = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) break;
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(from, i).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g))
    if (m[1] && m[2]) out[m[1]] = m[2].trim();
  return out;
}

const light = block(":root {");
const dark = block(':root[data-theme="dark"]');
// The same values answer the system's setting when no theme is chosen. The inner block is the one after the media query.
const system = block(':root:not([data-theme="light"])');

/** `oklch(L C H)` or `oklch(L C H / A%)` to linear-light sRGB, then to sRGB. */
function parse(value: string): Colour {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%\s*)?\)$/);
  if (!m) throw new Error(`not an oklch colour: ${value}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / 100;
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
  const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return { rgb: linear.map(encode) as Rgb, alpha };
}

/** A colour with some transparency, laid over a ground. */
function over(top: Colour, ground: Colour): Rgb {
  return top.rgb.map((c, i) => c * top.alpha + (ground.rgb[i] ?? 0) * (1 - top.alpha)) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

/** [the colour, what it lies on, the least ratio]. */
const PAIRS: [string, string, number][] = [
  ["--foreground", "--background", 7],
  ["--foreground", "--card", 7],
  ["--foreground", "--popover", 7],
  ["--card-foreground", "--card", 7],
  ["--popover-foreground", "--popover", 7],
  ["--sidebar-foreground", "--sidebar", 7],
  ["--muted-foreground", "--background", 4.5],
  ["--muted-foreground", "--card", 4.5],
  ["--muted-foreground", "--muted", 4.5],
  ["--primary-foreground", "--primary", 4.5],
  ["--destructive-foreground", "--destructive", 4.5],
  ["--secondary-foreground", "--secondary", 4.5],
  ["--accent-foreground", "--accent", 4.5],
  ["--highlight-foreground", "--highlight", 4.5],
  ["--success-foreground", "--success-soft", 4.5],
  ["--warning-foreground", "--warning-soft", 4.5],
  ["--info-foreground", "--info-soft", 4.5],
  ["--primary", "--background", 4.5],
  ["--input", "--card", 3],
  ["--ring", "--background", 3],
  ["--chart-1", "--card", 3],
  ["--chart-2", "--card", 3],
  ["--chart-3", "--card", 3],
  ["--chart-4", "--card", 3],
  ["--chart-5", "--card", 3],
];

describe("the theme's contrast gate", () => {
  for (const [name, tokens] of [
    ["light", light],
    ["dark", { ...light, ...dark }],
  ] as const) {
    describe(name, () => {
      for (const [fg, bg, least] of PAIRS) {
        it(`${fg} on ${bg} is at least ${least}:1`, () => {
          const ground = parse(tokens[bg] ?? "");
          const top = parse(tokens[fg] ?? "");
          const measured = ratio(over(top, ground), ground.rgb);
          expect(measured, `${fg} on ${bg}`).toBeGreaterThanOrEqual(least);
        });
      }
    });
  }

  it("gives the system's dark theme the values of the chosen dark theme", () => {
    expect(system).toEqual(dark);
  });

  it("names every colour the dark theme changes in the light theme too", () => {
    for (const name of Object.keys(dark)) expect(light, name).toHaveProperty([name]);
  });
});
