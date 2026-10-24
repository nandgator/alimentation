import { expect, test } from '@playwright/test';
import { expectAccessible, shot, watchPage } from './support.ts';

test.describe('the home page', () => {
  test('says the principle, states each promise with its limit, and fits the screen', async ({
    page,
  }, info) => {
    const problems = watchPage(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A kitchen’s accounts');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('returned to you whole');
    await expect(page.getByText(/of 80 free places taken/)).toBeVisible();

    const promises = page.locator('#promises li');
    await expect(promises).toHaveCount(7);
    await expect(page.locator('#promises .limit')).toHaveCount(7);
    await expect(page.getByText('Leave, and everything goes.')).toBeVisible();
    await expect(page.getByRole('figure', { name: /example wipe receipt/i })).toBeVisible();

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
    await page.getByRole('link', { name: 'Start a kitchen' }).click();
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
    expect(manifest.theme_color).toBe('#1F3864');
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
});
