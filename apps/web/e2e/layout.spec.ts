import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectAccessible, firstOfMonth, signIn } from './support.ts';

const MENU = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' };

/** A kitchen with prices, a member who has joined, and a claim waiting, made through the API. */
async function seed(owner: Page, member: Page, tag: string) {
  const slug = `lay-${tag}-${Date.now().toString(36)}`;
  await signIn(owner, `owner-${slug}@example.org`, 'Owner');
  const api = owner.request;
  await api.post('/api/workspaces', { data: { slug, name: `Layout ${tag}`, alsoSupplier: true } });
  const w = `/api/w/${slug}`;
  await api.post(`${w}/rate-cards`, {
    data: {
      effectiveFrom: firstOfMonth(),
      veg: 15000,
      nonVeg: 17000,
      extraChapati: 1500,
      extraBhakri: 3000,
      extrasPerMonth: 4000,
      menu: MENU,
    },
  });
  const made = await api.post(`${w}/people`, {
    data: { name: 'Jovial', role: 'consumer', activeFrom: firstOfMonth() },
  });
  const id = (await made.json()).id as string;
  const email = `member-${slug}@example.org`;
  const inv = await api.post(`${w}/people/${id}/invite`, { data: { email } });
  const link = (await inv.json()).link as string;
  await signIn(member, email, 'Jovial');
  await member.request.post('/api/invites/accept', { data: { token: link.split('#')[1] } });
  await member.request.post(`${w}/claims`, {
    data: {
      consumerId: id,
      paidAt: new Date().toISOString().slice(0, 10),
      forMonth: firstOfMonth().slice(0, 7),
      amount: 100000,
      method: 'UPI',
    },
  });
  return { slug };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  b: number;
}
const rect = async (page: Page, selector: string): Promise<Rect> =>
  page
    .locator(selector)
    .first()
    .evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
    });

/** The page is as wide as the screen, and no wider: a bar pushed past the edge stretches a phone's view. */
async function expectFits(page: Page, width: number, where: string) {
  // An emulated screen settles a moment after a page loads.
  await expect
    .poll(() => page.evaluate(() => window.innerWidth), { timeout: 4000 })
    .toBe(width)
    .catch(() => undefined);
  const [inner, scroll] = await page.evaluate(() => [
    window.innerWidth,
    document.documentElement.scrollWidth,
  ]);
  if (inner !== width) {
    // Name what is wider than the screen, outside anything that scrolls by itself.
    const wide = await page.evaluate((w) => {
      const scrolls = (e: Element | null): boolean => {
        for (let a = e?.parentElement; a && a !== document.body; a = a.parentElement) {
          const o = getComputedStyle(a).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
        }
        return false;
      };
      return [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > w + 1 && !scrolls(e))
        .slice(0, 6)
        .map(
          (e) =>
            `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)}`,
        );
    }, width);
    throw new Error(`${where}: the view was stretched past ${width}px by: ${wide.join(' | ')}`);
  }
  expect(inner, `${where}: the view was stretched past ${width}px`).toBe(width);
  expect(scroll, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(width);
}

/**
 * Puts an emulated phone at a width and waits until it really is that wide. The emulation sometimes
 * keeps a stale width after a page loads; asking again, and reloading, brings it into line. A page
 * that is wider than its screen is a different matter: that is named and fails.
 */
async function settle(page: Page, width: number, height: number) {
  for (let tries = 0; tries < 4; tries++) {
    await page.setViewportSize({ width, height });
    const ok = await expect
      .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]), { timeout: 2500 })
      .toEqual([width, height])
      .then(
        () => true,
        () => false,
      );
    if (ok) return;
    await page.reload();
  }
}

const WIDTHS = [320, 360, 390, 430];
const HEIGHT = 800;

test.describe('the phone layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'the bottom bar exists only on a phone');

  test('the bar at the bottom fits every phone width, on every kind of screen, and nothing hides behind it', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, 'bar');
    for (const width of WIDTHS) {
      for (const [who, p, paths] of [
        ['admin', page, ['', '/people', '/payments', '/close']],
        ['member', mp, ['', '/history']],
      ] as const) {
        for (const path of paths) {
          const where = `${who} ${width}px ${path || '/'}`;
          await p.goto(`/w/${slug}${path}`);
          await p.locator('.subnav .nav').waitFor();
          await settle(p, width, HEIGHT);
          await expectFits(p, width, where);

          // The bar is flush with the bottom of the screen and tall enough to press.
          const bar = await rect(p, '.subnav');
          const vp = await p.evaluate(() => [
            window.innerWidth,
            window.innerHeight,
            window.visualViewport?.scale,
          ]);
          expect(
            Math.abs(bar.b - HEIGHT),
            `${where}: bar not at the bottom (bar ${Math.round(bar.y)}-${Math.round(bar.b)}, view ${vp})`,
          ).toBeLessThanOrEqual(1);
          expect(bar.h, `${where}: bar height`).toBeGreaterThanOrEqual(52);
          expect(bar.h, `${where}: bar height`).toBeLessThanOrEqual(72);

          // Five items, in a row, inside the bar, none on top of another, each big enough to press.
          const items = await p
            .locator('.subnav .nav > a, .subnav .nav > .more')
            .evaluateAll((els) =>
              els.map((e) => {
                const r = e.getBoundingClientRect();
                return {
                  name: e.textContent ?? '',
                  x: r.x,
                  y: r.y,
                  w: r.width,
                  h: r.height,
                  r: r.right,
                };
              }),
            );
          expect(items, where).toHaveLength(5);
          for (const [i, it] of items.entries()) {
            expect(it.h, `${where}: ${it.name} too short`).toBeGreaterThanOrEqual(44);
            expect(it.x, `${where}: ${it.name} off the left`).toBeGreaterThanOrEqual(0);
            expect(it.r, `${where}: ${it.name} off the right`).toBeLessThanOrEqual(width);
            expect(it.y, `${where}: ${it.name} not level`).toBeCloseTo(items[0]!.y, 0);
            expect(it.h, `${where}: ${it.name} not as tall`).toBeCloseTo(items[0]!.h, 0);
            if (i > 0)
              expect(it.x, `${where}: ${it.name} overlaps`).toBeGreaterThanOrEqual(
                items[i - 1]!.r - 0.5,
              );
          }

          if (path === '' || path === '/people')
            await p.screenshot({
              path: info.outputPath(`bar-${who}-${width}${path.replace('/', '-')}.png`),
            });

          // At the end of the page, the last of it is clear of the bar.
          await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const foot = await rect(p, '.page .foot');
          expect(
            bar.y - foot.b,
            `${where}: the end of the page is under the bar`,
          ).toBeGreaterThanOrEqual(16);

          // The top bar keeps to one or two lines and stays inside the screen.
          const top = await rect(p, '.topbar');
          expect(top.h, `${where}: the top bar wraps onto a second line`).toBeLessThanOrEqual(72);
          const out = await p
            .locator('.topbar .wrap > *')
            .evaluateAll(
              (els, w) => els.filter((e) => e.getBoundingClientRect().right > w).length,
              width,
            );
          expect(out, `${where}: something in the top bar is off the screen`).toBe(0);
        }
      }

      // The panel behind More: inside the screen, above the bar, below the top bar, in reach.
      const where = `${width}px panel`;
      await page.goto(`/w/${slug}`);
      await settle(page, width, HEIGHT);
      await page.getByRole('button', { name: 'More' }).click();
      const panel = await rect(page, '.nav .extras');
      const bar = await rect(page, '.subnav');
      const top = await rect(page, '.topbar');
      expect(panel.x, where).toBeGreaterThanOrEqual(0);
      expect(panel.r, where).toBeLessThanOrEqual(width);
      expect(panel.b, `${where}: touches the bar`).toBeLessThanOrEqual(bar.y);
      expect(panel.y, `${where}: under the top bar`).toBeGreaterThanOrEqual(top.b);
      const links = await page
        .locator('.nav .extras a')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(links.length).toBeGreaterThanOrEqual(8); // the other screens, and Help
      for (const h of links) expect(h, `${where}: a link is too short`).toBeGreaterThanOrEqual(44);
      const groups = await page.locator('.nav .extras [role="group"]').count();
      expect(groups, `${where}: the panel keeps the menu's groups`).toBe(2);
      await page.screenshot({ path: info.outputPath(`more-${width}.png`) });
      if (width === 360) await expectAccessible(page, 'the panel behind More');
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await member.close();
  });

  test('a note that something happened floats above the bar, not over it', async ({
    page,
    browser,
  }, info) => {
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, 'toast');
    for (const width of [320, 430]) {
      await page.goto(`/w/${slug}/people`);
      await settle(page, width, HEIGHT);
      await page.getByRole('button', { name: 'Add a person' }).click();
      const dlg = page.getByRole('dialog', { name: 'Add a person' });
      await dlg.getByLabel('Name').fill(`Guest ${width}`);
      await dlg.getByRole('button', { name: 'Save' }).click();
      const toast = page.locator('.toast');
      await expect(toast).toBeVisible();
      const [t, bar] = [await rect(page, '.toast'), await rect(page, '.subnav')];
      expect(bar.y - t.b, `${width}px: the note is on the bar`).toBeGreaterThanOrEqual(8);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.r).toBeLessThanOrEqual(width);
    }
    await member.close();
  });
});

test.describe('the wide layout', () => {
  test.skip(({ isMobile }) => isMobile, 'a wide screen has a side menu');

  test('the side menu, the top bar and the page line up and fit at every wide width', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, 'wide');
    for (const width of [960, 1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['', '/people', '/close']) {
        const where = `${width}px ${path || '/'}`;
        await page.goto(`/w/${slug}${path}`);
        await page.locator('.side').waitFor();
        await expectFits(page, width, where);
        const [top, shell, side, main] = [
          await rect(page, '.topbar .wrap'),
          await rect(page, '.shell'),
          await rect(page, '.side'),
          await rect(page, '.page'),
        ];
        expect(
          Math.abs(top.x - shell.x),
          `${where}: top bar and page do not line up`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(top.r - shell.r),
          `${where}: top bar and page do not line up`,
        ).toBeLessThanOrEqual(1);
        expect(side.r, `${where}: menu runs into the page`).toBeLessThanOrEqual(main.x - 16);
        expect(main.w, `${where}: the page is too narrow`).toBeGreaterThanOrEqual(560);
        // Kitchen and role live in the menu here, not in the top bar.
        await expect(page.locator('.side .kitchen')).toContainText('Layout wide');
        await expect(page.locator('.topbar')).not.toContainText('Layout wide');
      }
    }
    await member.close();
  });

  test('the menu can be hidden, opens as a drawer over the page, and the choice is kept', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, 'drawer');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/w/${slug}`);
    const menu = page.getByRole('navigation', { name: 'Sections' });
    await expect(menu.getByRole('link', { name: 'People' })).toBeVisible();
    const pinnedWidth = (await rect(page, '.page')).w;

    // Hidden: the page takes the room, and the menu is out of the way for everyone, including a screen reader.
    await page.getByRole('button', { name: 'Hide this menu' }).click();
    await expect(page.locator('.shell')).toHaveAttribute('data-pinned', 'false');
    await expect(menu.getByRole('link', { name: 'People' })).toBeHidden();
    expect((await rect(page, '.page')).w).toBeGreaterThan(pinnedWidth + 150);
    expect((await rect(page, '.page')).w).toBeGreaterThanOrEqual(1100);

    // A button in the top bar brings it back as a drawer, without moving the page.
    const before = await rect(page, '.page');
    const open = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'People' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toBeFocused();
    expect(await rect(page, '.page')).toEqual(before);
    await expectAccessible(page, 'the menu as a drawer');

    // Escape closes it and gives focus back to the button.
    await page.keyboard.press('Escape');
    await expect(menu.getByRole('link', { name: 'People' })).toBeHidden();
    await expect(open).toBeFocused();

    // Choosing a screen closes it.
    await open.click();
    await menu.getByRole('link', { name: 'People' }).click();
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'People' })).toBeHidden();

    // A click on the page behind closes it.
    await open.click();
    await page.mouse.click(1000, 500);
    await expect(menu.getByRole('link', { name: 'People' })).toBeHidden();

    // The choice is the device's, and survives a reload.
    await page.reload();
    await expect(page.locator('.shell')).toHaveAttribute('data-pinned', 'false');
    await open.click();
    await page.getByRole('button', { name: 'Keep this menu open' }).click();
    await expect(page.locator('.shell')).toHaveAttribute('data-pinned', 'true');
    await expect(menu.getByRole('link', { name: 'People' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.shell')).toHaveAttribute('data-pinned', 'true');
    await member.close();
  });
});
