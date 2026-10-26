// Draws the app icons from one design: a tiffin carrier (handle, lid, three tiers, side clips) on
// curry-leaf green.
//   node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const GREEN = '#1F4D3A';
const TILE = '#EEF1EC';
const TURMERIC = '#F0B323';

// `inset` shrinks the drawing so a maskable icon keeps it inside the safe zone.
const svg = ({ rounded, inset }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${GREEN}"/>
  <g transform="translate(256 256) scale(${inset * 17}) translate(-12 -12.5)">
    <g fill="${TILE}">
      <rect x="7" y="2.4" width="10" height="1.8" rx="0.9"/>
      <rect x="8.6" y="3.8" width="1.6" height="3.2"/>
      <rect x="13.8" y="3.8" width="1.6" height="3.2"/>
      <rect x="4.6" y="6.8" width="14.8" height="3" rx="1.5"/>
      <rect x="5.6" y="10.8" width="12.8" height="3.4" rx="1.7"/>
      <rect x="5.6" y="15.2" width="12.8" height="3.4" rx="1.7"/>
      <rect x="5.6" y="19.6" width="12.8" height="3" rx="1.5"/>
    </g>
    <g fill="${TURMERIC}">
      <rect x="3.6" y="7" width="1.8" height="14.4" rx="0.9"/>
      <rect x="18.6" y="7" width="1.8" height="14.4" rx="0.9"/>
    </g>
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
