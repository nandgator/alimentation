// Draws the app icons from one design: the ledger of the mark (see src/components/Mark.tsx), cream on indigo,
// with a saffron tick. The colours are the sRGB of the theme's tokens (src/theme.css, light):
// --primary, --background and --highlight.
//   node scripts/make-icons.mjs

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const INDIGO = "#3442a6";
const PAPER = "#fbfaf7";
const SAFFRON = "#f98f3a";

// `inset` shrinks the drawing so a maskable icon keeps it inside the safe zone.
const svg = ({ rounded, inset }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>Alimentation</title>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${INDIGO}"/>
  <g transform="translate(256 256) scale(${inset * 17}) translate(-12 -12.5)">
    <rect x="3.6" y="2.4" width="16.8" height="20.2" rx="2.6" fill="${PAPER}"/>
    <g fill="${INDIGO}" opacity="0.85">
      <rect x="6.4" y="7.6" width="6.6" height="1.6" rx="0.8"/>
      <rect x="6.4" y="11.6" width="11.2" height="1.8" rx="0.9"/>
      <rect x="6.4" y="16" width="11.2" height="1.8" rx="0.9"/>
      <rect x="6.4" y="20.3" width="11.2" height="1.6" rx="0.8"/>
    </g>
    <path d="M14.8 2.4h3.2v7.6l-1.6-1.4-1.6 1.4z" fill="${SAFFRON}"/>
  </g>
</svg>`;

writeFileSync("public/favicon.svg", svg({ rounded: true, inset: 1 }));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
for (const [file, size, opts] of [
  ["icon-192.png", 192, { rounded: true, inset: 1 }],
  ["icon-512.png", 512, { rounded: true, inset: 1 }],
  ["icon-180.png", 180, { rounded: false, inset: 0.86 }],
  ["icon-maskable-512.png", 512, { rounded: false, inset: 0.74 }],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(opts)}`,
  );
  await page.screenshot({ path: `public/${file}`, omitBackground: true });
}
await browser.close();
console.log("icons written");
