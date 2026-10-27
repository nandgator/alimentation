import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, expectNoSidewaysScroll, shot, watchPage } from './support.ts';

interface Row {
  t: string;
  u: string;
}
const SITES = [
  { dir: 'guides', name: 'Guides' },
  { dir: 'docs', name: 'Docs' },
] as const;

async function pagesOf(page: Page, dir: string): Promise<string[]> {
  const res = await page.request.get(`/${dir}/search-index.json`);
  expect(res.ok(), `${dir} has a search index`).toBe(true);
  return ((await res.json()) as Row[]).map((r) => r.u);
}

test.describe('the documentation sites', () => {
  for (const { dir } of SITES) {
    test(`every page of the ${dir} is readable, fits the screen and passes the accessibility checks`, async ({
      page,
    }) => {
      test.setTimeout(360_000);
      const problems = watchPage(page);
      const urls = await pagesOf(page, dir);
      expect(urls.length).toBeGreaterThan(10);
      for (const url of urls) {
        const res = await page.goto(url);
        expect(res?.status(), url).toBe(200);
        await expect(page.getByRole('heading', { level: 1 }), url).toHaveCount(1);
        await expectNoSidewaysScroll(page, url);
        await expectAccessible(page, url);
      }
      expect(problems, 'nothing refused by the security policy, nothing thrown').toEqual([]);
    });
  }

  test('reads well in the dark, too: the front pages and the pages that show the colours', async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const url of [
      '/guides/',
      '/guides/fair/honest-by-design/',
      '/docs/',
      '/docs/concepts/trust-model/',
      '/docs/design/foundations/',
      '/docs/design/components/',
      '/docs/design/conformance/',
    ]) {
      await page.goto(url);
      await expectNoSidewaysScroll(page, `${url}, dark`);
      await expectAccessible(page, `${url}, dark`);
    }
    await shot(page, info, 'docs-components-dark');
  });

  test('shows the design system with the real stylesheet, in both themes', async ({
    page,
  }, info) => {
    await page.goto('/docs/design/foundations/');
    await expect(page.locator('.swatch')).toHaveCount(17);
    const colour = (sel: string) =>
      page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
    const brandLight = await colour('.sw-brand i');
    expect(brandLight).not.toBe('rgba(0, 0, 0, 0)');
    await shot(page, info, 'docs-foundations-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await colour('.sw-brand i'), 'the swatch follows the theme').not.toBe(brandLight);

    await page.goto('/docs/design/components/');
    await expect(page.locator('.demo .btn.danger')).toBeVisible();
    await expect(page.locator('.demo .tile.lead')).toHaveCount(3);
    const height = await page
      .locator('.demo .btn')
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height, 'a button is at least 44px high, as the system says').toBeGreaterThanOrEqual(44);
  });

  test('has a door each way between the people’s guides and the technical docs', async ({
    page,
  }) => {
    await page.goto('/guides/');
    await expect(page.getByRole('heading', { level: 1, name: 'Guides' })).toBeVisible();
    const switcher = page.getByRole('navigation', { name: 'Documentation' });
    await expect(switcher.getByRole('link', { name: 'Guides' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await switcher.getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Alimentation documentation' }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Documentation' })
      .getByRole('link', { name: 'Guides' })
      .click();
    await expect(page).toHaveURL(/\/guides\/$/);
  });

  test('is found without a trailing slash, and the app’s own screens are not mistaken for it', async ({
    page,
  }) => {
    for (const [path, heading] of [
      ['/guides', 'Guides'],
      ['/docs', 'Alimentation documentation'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Guides' }).first()).toHaveAttribute(
      'href',
      '/guides/',
    );
  });

  test('searches the site you are in, with the keyboard, and goes to the page found', async ({
    page,
  }) => {
    await page.goto('/guides/');
    const q = page.getByRole('combobox', { name: 'Search the guides' });
    await q.fill('late');
    const results = page.getByRole('listbox', { name: 'Search results' });
    await expect(results.getByRole('option').first()).toBeVisible();
    // The guides are searched, not the technical docs.
    expect(
      await results.locator('a').evaluateAll((a) => a.map((x) => x.getAttribute('href'))),
    ).toEqual(expect.not.arrayContaining([expect.stringMatching(/^\/docs\//)]));
    await q.press('ArrowDown');
    await q.press('Enter');
    await expect(page).toHaveURL(/\/guides\/.+/);

    await page.goto('/docs/');
    const d = page.getByRole('combobox', { name: 'Search the docs' });
    await d.fill('configuration');
    await expect(
      page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
    ).toContainText('Configuration');
    await d.fill('zzzzqx');
    await expect(page.getByText('Nothing found. Try a shorter word.')).toBeVisible();
    await d.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeHidden();
  });

  test('opens on a front page: a hero, a few cards, and no menu beside them', async ({
    page,
  }, info) => {
    for (const { dir, name, first } of [
      { dir: 'guides', name: 'Guides', first: /Start a kitchen/ },
      { dir: 'docs', name: 'Documentation', first: /Run it yourself/ },
    ]) {
      await page.goto(`/${dir}/`);
      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toContainText('Alimentation');
      await expect(h1).toContainText(name);
      await expect(page.getByRole('link', { name: first })).toBeVisible();
      await expect(page.getByRole('navigation', { name: `${name} contents` })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Menu' })).toHaveCount(0);
      const cards = page.locator('main .feature');
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      await shot(page, info, `docs-front-${dir}`);
      // A card is a whole link: it goes to the page it names, which has the menu.
      const href = await cards.first().getAttribute('href');
      await cards.first().click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    }
  });

  test('has a menu that opens on a phone and a contents list beside the page on a wide screen', async ({
    page,
    isMobile,
  }, info) => {
    await page.goto('/docs/concepts/billing-engine/');
    const nav = page.getByRole('navigation', { name: 'Docs contents' });
    if (isMobile) {
      await expect(nav).toBeHidden();
      const menu = page.getByRole('button', { name: 'Menu' });
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('link', { name: 'The trust model' })).toBeVisible();
      await expectAccessible(page, 'the open menu');
      await shot(page, info, 'docs-menu-open');
    } else {
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link', { name: 'The billing engine' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
    }
  });

  test('copies code, and scrolls a wide table inside itself rather than the page', async ({
    page,
    context,
    isMobile,
  }) => {
    await page.goto('/docs/self-hosting/install/');
    const copy = page.getByRole('button', { name: 'Copy this code' }).first();
    await expect(copy).toBeVisible();
    if (!isMobile) {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await copy.click();
      await expect(copy).toHaveText('Copied');
    }
    await page.goto('/docs/api/workspace/');
    await expectNoSidewaysScroll(page, 'the API reference');
    await expect(page.locator('.tablewrap').first()).toHaveAttribute('tabindex', '0');
  });

  test('is served under the same strict security policy as the app', async ({ page }) => {
    for (const url of ['/guides/', '/docs/', '/doc-assets/docs.css', '/guides/search-index.json']) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
    }
    const res = await page.request.get('/docs/');
    expect(res.headers()['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers()['content-security-policy']).toContain("style-src 'self'");
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });
});
