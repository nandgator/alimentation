// Draws the app icons from one design: a plate seen from above, with a small bowl on its rim.
//   node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const NAVY = '#1F3864';
const IVORY = '#FBF8F2';
const COPPER = '#E08A4B';

// `inset` shrinks the drawing so a maskable icon keeps it inside the safe zone.
const svg = ({ rounded, inset }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${NAVY}"/>
  <g transform="translate(256 256) scale(${inset}) translate(-256 -256)">
    <circle cx="256" cy="256" r="168" fill="none" stroke="${IVORY}" stroke-width="22"/>
    <circle cx="256" cy="256" r="95" fill="none" stroke="${IVORY}" stroke-width="13" opacity="0.6"/>
    <circle cx="334" cy="178" r="38" fill="${COPPER}"/>
  </g>
</svg>`;

writeFileSync('public/favicon.svg', svg({ rounded: true, inset: 1 }));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
for (const [file, size, opts] of [
  ['icon-192.png', 192, { rounded: true, inset: 1 }],
  ['icon-512.png', 512, { rounded: true, inset: 1 }],
  ['icon-180.png', 180, { rounded: false, inset: 0.86 }],
  ['icon-maskable-512.png', 512, { rounded: false, inset: 0.74 }],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(opts)}`,
  );
  await page.screenshot({ path: `public/${file}`, omitBackground: true });
}
await browser.close();
console.log('icons written');
