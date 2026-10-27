import { expect, test } from '@playwright/test';
import { expectAccessible, shot, signIn } from './support.ts';

const stored = (page: import('@playwright/test').Page) =>
  page.evaluate(() => localStorage.getItem('theme'));

test.describe('the colour choice', () => {
  test('is one choice for every page: the home page, the guides and the docs', async ({
    page,
  }, info) => {
    await page.goto('/');
    const colours = page.getByRole('group', { name: 'Colours' });
    await expect(colours.getByRole('radio', { name: 'Auto' })).toBeChecked();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

    await colours.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await stored(page)).toBe('dark');
    await expectAccessible(page, 'the home page in the dark, with the choice open');
    await shot(page, info, 'theme-home-dark');

    // Remembered, and applied before the page is drawn.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(
      page.getByRole('group', { name: 'Colours' }).getByRole('radio', { name: 'Dark' }),
    ).toBeChecked();

    // The documentation answers to the same choice, and the same button changes it.
    await page.goto('/guides/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const button = page.getByRole('button', { name: /Colour theme: dark/ });
    await expect(button).toHaveText('Theme: Dark');
    await button.click(); // Dark, then Auto
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await stored(page)).toBeNull();
    await page.getByRole('button', { name: /Colour theme: auto/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await stored(page)).toBe('light');

    // Back on the home page, the choice made in the docs is the one shown.
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(
      page.getByRole('group', { name: 'Colours' }).getByRole('radio', { name: 'Light' }),
    ).toBeChecked();
  });

  test('keeps the choice the documentation made before it was shared', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('docs-theme', 'dark'));
    await page.goto('/docs/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: /Colour theme: dark/ }).click();
    expect(await page.evaluate(() => localStorage.getItem('docs-theme'))).toBeNull();
  });

  test('can be changed inside a kitchen, whatever the screen', async ({ page, isMobile }, info) => {
    const slug = `col-${Date.now().toString(36)}`;
    await signIn(page, `owner-${slug}@example.org`, 'Owner');
    await page.request.post('/api/workspaces', {
      data: { slug, name: `Colours ${slug}`, alsoSupplier: true },
    });
    await page.goto(`/w/${slug}`);
    if (isMobile) await page.getByRole('button', { name: 'More' }).click();
    const colours = page.getByRole('group', { name: 'Colours' });
    await expect(colours).toBeVisible();
    await colours.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectAccessible(page, 'a kitchen in the dark');
    await shot(page, info, 'theme-kitchen-dark');
    await colours.getByRole('radio', { name: 'Auto' }).check();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});
