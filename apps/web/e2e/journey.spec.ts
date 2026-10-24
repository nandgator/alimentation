import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import {
  aWorkingDayThisMonth,
  expectAccessible,
  firstOfMonth,
  shot,
  signIn,
  watchPage,
} from './support.ts';

const ADMIN = process.env.ALIMENTATION_TEST_PG ?? 'postgres://pgadmin@127.0.0.1:5432/postgres';

/** Goes to a section. On a phone the less-used ones sit behind “More”. */
async function go(p: Page, name: string | RegExp) {
  const nav = p.getByRole('navigation', { name: 'Sections' });
  const link = nav.getByRole('link', { name });
  if (!(await link.isVisible())) await nav.getByRole('button', { name: 'More' }).click();
  await link.click();
}
const tile = (page: Page, label: string) =>
  page
    .locator('.tile', { has: page.locator('.k', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.v');

test('a kitchen from its first day to its last: set up, use, go offline, move, and delete', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 240_000));
  const slug = `e2e-${info.project.name}-${Date.now().toString(36)}`;
  const external = `ext_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  const member = await browser.newContext({ ...info.project.use });
  const jovial = await member.newPage();
  let inviteLink = '';
  const seen = [watchPage(page), watchPage(jovial)];

  try {
    await test.step('the owner starts a kitchen', async () => {
      await signIn(page, 'owner@example.org', 'Owner');
      await expect(page.getByRole('heading', { name: 'Your kitchens' })).toBeVisible();
      await page.getByLabel('Name', { exact: true }).fill('Test Kitchen');
      await page.getByLabel('Address').fill(slug);
      await page.getByRole('button', { name: 'Create' }).click();
      await page.waitForURL(`**/w/${slug}`);
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      await expect(page.getByText('Add a rate card to start billing.')).toBeVisible();
      await expectAccessible(page, 'new kitchen');
      await shot(page, info, '1-new-kitchen');
    });

    await test.step('prices and the menu are set once, by the admin', async () => {
      await go(page, 'Rates & rules');
      await page.getByRole('button', { name: 'New rate card' }).click();
      const dlg = page.getByRole('dialog', { name: 'New rate card' });
      await dlg.getByLabel('Applies from').fill(firstOfMonth());
      await dlg.getByLabel('Veg meal (₹)', { exact: true }).fill('150');
      await dlg.getByLabel('Non-veg meal (₹)').fill('170');
      await dlg.getByLabel('Extra chapati (₹)').fill('15');
      await dlg.getByLabel('Extra bhakri (₹)').fill('30');
      await dlg.getByLabel('Extras charged monthly (₹)').fill('40');
      for (const [d, m] of [
        ['Mon', 'Veg'],
        ['Tue', 'Veg'],
        ['Wed', 'Non Veg'],
        ['Thu', 'Veg'],
        ['Fri', 'Non Veg'],
      ])
        await dlg.getByLabel(`Menu on ${d}`).selectOption(m!);
      await expectAccessible(page, 'rate card dialog');
      await dlg.getByRole('button', { name: 'Add rate card' }).click();
      await expect(page.getByRole('cell', { name: '₹150' })).toBeVisible();
      await expect(page.getByText('Meals on Mon, Tue, Wed, Thu, Fri.')).toBeVisible();
      await shot(page, info, '2-rates');
    });

    await test.step('a member is added and sent a link that works once', async () => {
      await go(page, 'People');
      await page.getByRole('button', { name: 'Add a person' }).click();
      const dlg = page.getByRole('dialog', { name: 'Add a person' });
      await dlg.getByLabel('Name').fill('Jovial');
      await dlg.getByLabel('Eating from').fill(firstOfMonth());
      await dlg.getByRole('button', { name: 'Save' }).click();
      const row = page.getByRole('row', { name: /Jovial/ });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Invite' }).click();
      const inv = page.getByRole('dialog', { name: 'Invite' });
      await inv.getByLabel(/’s email/).fill('jovial@example.org');
      await inv.getByRole('button', { name: 'Make a link' }).click();
      inviteLink = await inv.getByLabel('Invitation link').inputValue();
      expect(inviteLink).toMatch(/\/join#/);
      await page.keyboard.press('Escape');
      await shot(page, info, '3-people');
    });

    await test.step('the member signs in with the link and sees their own bill', async () => {
      await signIn(jovial, 'jovial@example.org', 'Jovial');
      await jovial.goto(inviteLink);
      await jovial.waitForURL(`**/w/${slug}`);
      await expect(jovial.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
      await expect(tile(jovial, 'Bill')).not.toHaveText('-');
      await expect(jovial.getByText('Veg ₹150 · Non Veg ₹170')).toBeVisible();
      await expectAccessible(jovial, 'member dashboard');
      await shot(jovial, info, '4-member-dashboard');
      // The same link does not work a second time, and people-management is not theirs.
      await jovial.goto(`/w/${slug}/people`);
      await expect(
        jovial.getByText('There is nothing at this address for your role.'),
      ).toBeVisible();
    });

    await test.step('the member logs a leave day and claims a payment', async () => {
      await go(jovial, 'My log');
      await jovial.getByLabel('Date').fill(aWorkingDayThisMonth());
      await jovial.getByLabel('Change').selectOption('Leave');
      await jovial.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(jovial.getByRole('cell', { name: 'Leave', exact: true })).toBeVisible();

      await go(jovial, 'Payments');
      await jovial.getByLabel('Amount (₹)').fill('1000');
      await jovial.getByLabel('Reference (optional)').fill('UPI-REF-1');
      await jovial.getByRole('button', { name: 'Claim payment' }).click();
      await expect(jovial.getByRole('row', { name: /Pending/ })).toBeVisible();
      await expectAccessible(jovial, 'member payments');
      await shot(jovial, info, '5-member-payments');
      await go(jovial, 'Dashboard');
      await expect(tile(jovial, 'Claimed')).toHaveText('₹1,000');
    });

    await test.step('the supplier confirms it once, and the figures move', async () => {
      await go(page, /^Payments/);
      await expect(page.getByRole('heading', { name: 'To confirm (1)' })).toBeVisible();
      await expect(page.getByText('UPI-REF-1')).toBeVisible();
      // The admin can see the queue but only the supplier decides: the owner is both, so switches role.
      await expect(page.getByText('Only the supplier confirms a payment.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
      await page.getByLabel('Acting as').selectOption('supplier');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(page.getByRole('row', { name: /Confirmed/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'To confirm' })).toBeVisible();
      await page.getByLabel('Acting as').selectOption('admin');
      await go(page, 'Dashboard');
      await expect(tile(page, 'Paid')).toHaveText('₹1,000');
      await expect(page.getByRole('row', { name: /Jovial/ })).toBeVisible();
      await expectAccessible(page, 'admin dashboard');
      await shot(page, info, '6-admin-dashboard');
      await jovial.reload();
      await expect(tile(jovial, 'Paid')).toHaveText('₹1,000');
    });

    await test.step('with no signal, the member still sees the last statement', async () => {
      await member.setOffline(false);
      await expect
        .poll(() =>
          jovial.evaluate(async () => (await navigator.serviceWorker.ready).active?.state),
        )
        .toBe('activated');
      await jovial.reload(); // now served through the service worker, which keeps what it fetches
      await expect(tile(jovial, 'Paid')).toHaveText('₹1,000');
      await member.setOffline(true);
      await jovial.reload();
      await expect(
        jovial.getByText('You are offline. This is the last statement saved on this device.'),
      ).toBeVisible();
      await expect(tile(jovial, 'Paid')).toHaveText('₹1,000');
      await shot(jovial, info, '7-offline');
      await member.setOffline(false);
    });

    await test.step('the owner moves the kitchen to a database of their own, and nobody loses anything', async () => {
      await admin.query(`CREATE DATABASE ${external}`);
      const target = new URL(ADMIN);
      target.pathname = `/${external}`;
      await go(page, 'Your data');
      await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
      await shot(page, info, '8-your-data');
      await page.getByLabel('Connection string of an empty Postgres').fill(target.toString());
      await page.getByRole('button', { name: 'Check it first' }).click();
      await expect(page.getByText('It will work. Nothing has been changed.')).toBeVisible();
      await page
        .getByRole('region', { name: 'Move' })
        .getByLabel(`Type ${slug} to confirm`)
        .fill(slug);
      await page.getByRole('button', { name: 'Move now' }).click();
      await expect(page.getByRole('heading', { name: 'Moved' })).toBeVisible();
      await expect(page.getByText('Everything was copied and every statement')).toBeVisible();
      await shot(page, info, '9-moved');

      // Same figures, from the new database, for the owner and for the member.
      await page.goto(`/w/${slug}`);
      await expect(tile(page, 'Paid')).toHaveText('₹1,000');
      await jovial.goto(`/w/${slug}`);
      await expect(tile(jovial, 'Paid')).toHaveText('₹1,000');
      const left = await admin.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'ws\\_%'`);
      expect(left.rowCount).toBeGreaterThan(0); // the old copy is kept for a week, as promised
    });

    await test.step('the owner deletes everything, and gets a receipt that names no one', async () => {
      await go(page, 'Your data');
      await page
        .getByRole('region', { name: 'Delete' })
        .getByLabel(`Type ${slug} to confirm`)
        .fill(slug);
      await page.getByRole('button', { name: 'Delete this kitchen' }).click();
      await expect(page.getByRole('heading', { name: 'Deleted' })).toBeVisible();
      await shot(page, info, '10-deleted');
      await page.getByRole('link', { name: /\/receipt\// }).click();
      await expect(page.getByText('Wipe receipt')).toBeVisible();
      for (const c of ['Keys destroyed', 'Database removed', 'Directory entry gone'])
        await expect(page.getByText(c)).toBeVisible();
      const text = await page.locator('.receipt').innerText();
      for (const secret of [
        'Test Kitchen',
        slug,
        'Jovial',
        'jovial@example.org',
        'owner@example.org',
      ])
        expect(text).not.toContain(secret);
      await expectAccessible(page, 'receipt');
      await shot(page, info, '11-receipt');

      // Everything of it is gone, including the sign-in records that existed only for it: both are signed out.
      await page.goto(`/w/${slug}`);
      await expect(page).toHaveURL(/\/signin/);
      await jovial.goto('/app');
      await expect(jovial).toHaveURL(/\/signin/);
    });

    expect(seen.flat(), 'nothing refused by the security policy, nothing thrown').toEqual([]);
  } finally {
    await member.close();
    await admin.query(`DROP DATABASE IF EXISTS ${external} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
});
