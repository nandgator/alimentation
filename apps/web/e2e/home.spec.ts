import { expect, test } from '@playwright/test';
import { expectAccessible, shot, watchPage } from './support.ts';

test.describe('the home page', () => {
  test('says what it is, states each promise with its catch, and fits the screen', async ({
    page,
  }, info) => {
    const problems = watchPage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Who ate, what it');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('cost, who paid');
    await expect(page.getByText(/of 80 free kitchens taken/)).toBeVisible();

    const promises = page.locator('#promises li');
    await expect(promises).toHaveCount(7);
    await expect(page.locator('#promises .limit')).toHaveCount(7);
    await expect(page.getByText('Leave, and everything goes.')).toBeVisible();
    await expect(page.getByRole('figure', { name: /example wipe receipt/i })).toBeVisible();

    // The headline is two lines at every width: the page's first answer is held in one glance.
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('h1 .line-in')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      }),
    );
    expect(lines, 'two authored lines, each fitting on one rendered line').toEqual([1, 1]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    await shot(page, info, 'home-light');
    expect(problems, 'nothing refused by the security policy, nothing thrown').toEqual([]);
    const res = await page.request.get('/');
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test('lets a visitor try a month, and bills it on the real rules', async ({ page }) => {
    await page.goto('/');
    const total = page.locator('.board-bill .total b');
    // One leave, one switched dish and one extra-chapati day are marked from the start.
    await expect(total).toHaveText('₹2,960');
    const monday = page.getByRole('button', { name: /^Monday 1 March: Veg, ₹120/ });
    await monday.click(); // leave: the day's veg meal (120) is gone
    await expect(total).toHaveText('₹2,840');
    await expect(page.getByRole('button', { name: /^Monday 1 March: Leave/ })).toBeVisible();
    await page.getByRole('button', { name: /^Monday 1 March/ }).click(); // switched to non-veg: +30
    await expect(total).toHaveText('₹2,990');
    await page.getByRole('button', { name: /^Monday 1 March/ }).click(); // two extra chapatis: +20
    await expect(total).toHaveText('₹2,980');
    await page.getByRole('button', { name: /^Monday 1 March/ }).click(); // back to the day's meal
    await expect(total).toHaveText('₹2,960');
    await page.getByRole('button', { name: 'Clear every change' }).click();
    await expect(total).toHaveText('₹3,060'); // 14 veg at 120, 9 non-veg at 150, 30 of extras
    // Every day can be reached and changed from the keyboard.
    await page.getByRole('button', { name: /^Tuesday 2 March/ }).focus();
    await page.keyboard.press('Enter');
    await expect(total).toHaveText('₹2,940');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`is readable in ${scheme} mode`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page, `home (${scheme})`);
      await shot(page, info, `home-${scheme}`);
    });
  }

  test('leads to sign-in, and the sign-in page is accessible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Start your kitchen' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectAccessible(page, 'sign in');
  });

  test('can be installed: it has a manifest with icons, and a service worker takes over', async ({
    page,
    request,
  }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app');
    expect(manifest.theme_color).toBe('#1F4D3A');
    const sizes = manifest.icons.map(
      (i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

    await page.goto('/');
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
      .toBe('activated');
  });

  test('shows nothing of any kitchen to a stranger, and sends them to sign in', async ({
    page,
  }) => {
    await page.goto('/w/whatever');
    await expect(page).toHaveURL(/\/signin\?next=/);
    await page.goto('/receipt/not-a-real-receipt');
    await expect(page.getByText('There is no receipt with that address.')).toBeVisible();
  });
  test.describe('with motion on', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('every part arrives as it is reached, and nothing is left hidden', async ({ page }) => {
      const problems = watchPage(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const waiting = () =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-reveal]')].filter(
              (e) => !e.classList.contains('is-in'),
            ).length,
        );
      expect(await waiting(), 'parts below the first screen wait to be reached').toBeGreaterThan(
        10,
      );
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 350) {
        await page.evaluate((to) => window.scrollTo(0, to), y);
        await page.waitForTimeout(40);
      }
      await expect.poll(waiting, { message: 'every part has arrived' }).toBe(0);
      expect(problems).toEqual([]);
    });

    test('the carrier is lifted from place to place as the page is read', async ({ page }) => {
      await page.goto('/');
      const poses = [
        'translate(178px, 330px) scale(0.34)',
        'translate(538px, 213px) scale(0.62)',
        'translate(930px, 265px) scale(0.62)',
      ];
      const centre = (i: number) =>
        page.evaluate((n) => {
          const li = document.querySelectorAll('.steps li')[n]!;
          const r = li.getBoundingClientRect();
          window.scrollBy({
            top: r.top + r.height / 2 - window.innerHeight / 2,
            behavior: 'instant',
          });
        }, i);
      for (const [i, pose] of poses.entries()) {
        await centre(i);
        await expect(page.locator('.moving')).toHaveAttribute('data-step', String(i));
        // The hop takes a second; afterwards the carrier is exactly where the step says.
        await expect
          .poll(() => page.locator('.mover').evaluate((el) => (el as SVGElement).style.transform))
          .toBe(pose);
        await expect(page.locator('.steps li').nth(i)).toHaveClass(/on/);
      }
    });
  });
});
