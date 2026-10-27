import { expect, test, type Locator, type Page } from '@playwright/test';
import { firstOfMonth, signIn } from './support.ts';

/**
 * What a page looks like once it is drawn is not something a stylesheet check can see: that is measured here, on the
 * pixels. A select's arrow is found in the picture of the select, whoever drew it (the browser or the stylesheet), and
 * must sit clear of the edge and level with the text.
 */
async function arrowOf(page: Page, select: Locator, savedAs: string) {
  await select.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const png = (await select.screenshot({ path: savedAs })).toString('base64');
  const box = (await select.boundingBox())!;
  return page.evaluate(
    async ({ png, cssWidth }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const scale = width / cssWidth;
      // The select's own background, read from its picture (a corner of it clear of the text and the arrow),
      // so it does not matter what notation the stylesheet used to name the colour.
      const ref = (Math.round(3 * scale) * width + Math.round(width - 30 * scale)) * 4;
      const [br, bgr, bb] = [data[ref]!, data[ref + 1]!, data[ref + 2]!];
      const differs = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return (
          Math.abs(data[i]! - br!) + Math.abs(data[i + 1]! - bgr!) + Math.abs(data[i + 2]! - bb!) >
          60
        );
      };
      // The right-hand 56px, inside the 1px border, and the middle of the height, clear of the rounded corners, where the border curves in.
      const x0 = Math.max(0, Math.round(width - 56 * scale));
      const x1 = Math.round(width - 2 * scale);
      const y0 = Math.round(height * 0.38);
      const y1 = Math.round(height * 0.62);
      let right = -1;
      let top = height;
      let bottom = -1;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          if (differs(x, y)) {
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      if (right < 0) return null;
      return {
        // CSS pixels from the select's right edge to the arrow's nearest point.
        gap: (width - 1 - right) / scale,
        // How far the arrow's middle is from the middle of the select, in CSS pixels.
        off: ((top + bottom) / 2 - (height - 1) / 2) / scale,
      };
    },
    { png, cssWidth: box.width },
  );
}

const PATHS = [
  '',
  '/daily',
  '/log',
  '/payments',
  '/people',
  '/rates',
  '/holidays',
  '/settlements',
  '/close',
];

test.describe('the controls as drawn', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`every select shows an arrow, clear of the right edge and level with the text (${scheme})`, async ({
      page,
    }, info) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      const slug = `ctl-${scheme}-${Date.now().toString(36)}`;
      await signIn(page, `owner-${slug}@example.org`, 'Owner');
      const api = page.request;
      await api.post('/api/workspaces', {
        data: { slug, name: `Controls ${scheme}`, alsoSupplier: true },
      });
      await api.post(`/api/w/${slug}/rate-cards`, {
        data: {
          effectiveFrom: firstOfMonth(),
          veg: 15000,
          nonVeg: 17000,
          extraChapati: 1500,
          extraBhakri: 3000,
          extrasPerMonth: 4000,
          menu: { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' },
        },
      });
      await api.post(`/api/w/${slug}/people`, {
        data: { name: 'Jovial', role: 'consumer', activeFrom: firstOfMonth() },
      });

      const seen: string[] = [];
      for (const path of PATHS) {
        await page.goto(`/w/${slug}${path}`);
        await page.locator('main.page').waitFor();
        const selects = page.locator(
          'main select:visible, .side select:visible, .topbar select:visible',
        );
        const n = await selects.count();
        for (let i = 0; i < n; i++) {
          const select = selects.nth(i);
          const where = `${path || '/'} select ${i + 1} (${scheme})`;
          const arrow = await arrowOf(
            page,
            select,
            info.outputPath(`${scheme}${path.replace('/', '-') || '-home'}-${i + 1}.png`),
          );
          expect(arrow, `${where}: no arrow is drawn`).not.toBeNull();
          expect(
            arrow!.gap,
            `${where}: the arrow is ${arrow!.gap.toFixed(1)}px from the edge, too close`,
          ).toBeGreaterThanOrEqual(12);
          expect(
            arrow!.gap,
            `${where}: the arrow floats ${arrow!.gap.toFixed(1)}px in`,
          ).toBeLessThanOrEqual(24);
          expect(
            Math.abs(arrow!.off),
            `${where}: the arrow is not level with the text`,
          ).toBeLessThanOrEqual(2);
          seen.push(where);
        }
      }
      // The check looked at something: the kitchen's own selects, and not nothing.
      expect(seen.length, 'selects measured').toBeGreaterThanOrEqual(5);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`the open list of a select is drawn from the design tokens, not the browser's own menu (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/docs/design/components/');
      const drawable = await page.evaluate(() => CSS.supports('appearance', 'base-select'));
      test.skip(
        !drawable,
        'this browser has no way to restyle the open list, so it shows its own (Firefox, for now)',
      );
      const select = page.locator('#demo-day');
      await select.scrollIntoViewIfNeeded();
      await select.click();
      const painted = await page.evaluate(() => {
        const s = document.querySelector<HTMLSelectElement>('#demo-day')!;
        const picker = getComputedStyle(s, '::picker(select)');
        const chosen = getComputedStyle(s.querySelector('option:checked')!);
        // What a token resolves to, by asking the browser to paint with it.
        const token = (name: string, prop: 'backgroundColor' | 'color' = 'backgroundColor') => {
          const probe = document.createElement('i');
          probe.style.setProperty(prop === 'color' ? 'color' : 'background-color', `var(${name})`);
          document.body.append(probe);
          const v = getComputedStyle(probe)[prop];
          probe.remove();
          return v;
        };
        return {
          open: s.matches(':open'),
          background: picker.backgroundColor,
          card: token('--card'),
          radius: picker.borderTopLeftRadius,
          shadow: picker.boxShadow,
          chosenBackground: chosen.backgroundColor,
          brand: token('--brand'),
        };
      });
      expect(painted.open, 'the list is open').toBe(true);
      expect(painted.background, 'the list is on the card colour').toBe(painted.card);
      expect(painted.radius, 'the list has the medium radius').toBe('12px');
      expect(painted.shadow, 'the list floats, so it has a shadow').not.toBe('none');
      expect(painted.chosenBackground, 'the chosen option is in the brand colour').toBe(
        painted.brand,
      );
      await select.press('Escape');
    });
  }
});
