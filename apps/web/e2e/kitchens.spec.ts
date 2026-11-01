import { expect, test, type Page } from '@playwright/test';
import {
  expectAccessible,
  expectNoSidewaysScroll,
  firstOfMonth,
  shot,
  signIn,
  watchPage,
} from './support.ts';

const MENU = { 1: 'Veg', 2: 'Veg', 3: 'Non Veg', 4: 'Veg', 5: 'Non Veg' };
const rupees = (n: number) => n * 100;

/** A request as the person who is signed in, from the page, the way the app itself makes one. */
async function send(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ([p, b]) => {
      const r = await fetch(p as string, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      });
      return {
        status: r.status,
        json: (await r.json().catch(() => null)) as { id?: string } | null,
      };
    },
    [path, body] as const,
  );
}

test('a person in several kitchens sees each one with its figures, and the figures added up', async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const stamp = Date.now().toString(36);
  const north = `north-${stamp}`;
  const south = `south-${stamp}`;
  await signIn(page, `hari-${stamp}@example.org`, 'Hari');

  // One kitchen with prices and someone to feed, one that is only just begun.
  expect((await send(page, '/api/workspaces', { slug: north, name: 'North Mess' })).status).toBe(
    201,
  );
  expect((await send(page, '/api/workspaces', { slug: south, name: 'South Mess' })).status).toBe(
    201,
  );
  expect(
    (
      await send(page, `/api/w/${north}/rate-cards`, {
        effectiveFrom: '2026-01-01',
        veg: rupees(150),
        nonVeg: rupees(170),
        extraChapati: rupees(15),
        extraBhakri: rupees(30),
        extrasPerMonth: rupees(40),
        menu: MENU,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await send(page, `/api/w/${north}/people`, {
        name: 'Asha',
        role: 'consumer',
        activeFrom: firstOfMonth(),
      })
    ).status,
  ).toBe(201);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your kitchens' })).toBeVisible();

  const card = (name: string) =>
    page.locator('.card', { has: page.getByRole('heading', { name, level: 3 }) });
  await expect(card('North Mess')).toContainText(/₹[\d,]+(\.\d\d)? owed/);
  await expect(card('South Mess')).toContainText('Needs setting up');
  await expect(card('South Mess')).toContainText('Nothing owed');

  // Two kitchens, so there is a line across both; and it says what the first one says.
  const across = page.getByRole('region', { name: 'Across your 2 kitchens' });
  await expect(across).toBeVisible();
  const owedHere = (await card('North Mess').innerText()).match(/(₹[\d,]+(?:\.\d\d)?) owed/)![1];
  await expect(across.locator('.tile', { hasText: 'Owed to your kitchens' })).toContainText(
    owedHere!,
  );

  await expectAccessible(page, 'your kitchens');
  await expectNoSidewaysScroll(page, 'your kitchens');
  await shot(page, info, 'your-kitchens');
  expect(problems).toEqual([]);
});

test('a person in one kitchen is shown nothing for several: no figures, no totals, nothing asked of the kitchen', async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  await signIn(page, `solo-${stamp}@example.org`, 'Solo');
  expect(
    (await send(page, '/api/workspaces', { slug: `only-${stamp}`, name: 'Only Mess' })).status,
  ).toBe(201);
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(w|organisations)\//.test(r.url())) asked.push(new URL(r.url()).pathname);
  });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Only Mess' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The list is as it was: the kitchen is asked about when it is opened, and not before.
  expect(asked).toEqual([]);
  for (const text of [
    'Needs setting up',
    'Reading the figures',
    'Start an organisation',
    'Copy a setup',
    'Head office',
  ])
    await expect(page.getByText(text)).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Across your/ })).toHaveCount(0);
});

/** What the signed-in person's own kitchen says, read the way the app reads it. */
async function read<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => (await fetch(p, { credentials: 'same-origin' })).json(), path);
}

test('prices, rules and holidays copy from one kitchen to another, after showing what would be added', async ({
  page,
}, info) => {
  const stamp = Date.now().toString(36);
  const north = `cn-${stamp}`;
  const south = `cs-${stamp}`;
  await signIn(page, `copy-${stamp}@example.org`, 'Copy');
  for (const [slug, name] of [
    [north, 'North Copy Mess'],
    [south, 'South Copy Mess'],
  ] as const)
    expect((await send(page, '/api/workspaces', { slug, name })).status).toBe(201);

  const now = new Date();
  const later = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-28`;
  const boot = await read<{ policy: unknown }>(page, `/api/w/${north}/bootstrap`);
  expect(
    (
      await send(page, `/api/w/${north}/rate-cards`, {
        effectiveFrom: '2026-01-01',
        veg: rupees(150),
        nonVeg: rupees(170),
        extraChapati: rupees(15),
        extraBhakri: rupees(30),
        extrasPerMonth: rupees(40),
        menu: MENU,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await send(page, `/api/w/${north}/policies`, {
        effectiveFrom: firstOfMonth(),
        doc: boot.policy,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await send(page, `/api/w/${north}/holidays`, {
        name: 'Founders day',
        date: later,
        confirmed: true,
      })
    ).status,
  ).toBe(201);

  await page.goto('/app');
  const section = page.getByRole('region', { name: 'Copy a setup to other kitchens' });
  await section.getByLabel('Copy from').selectOption({ label: 'North Copy Mess' });
  await section.getByLabel('South Copy Mess').check();
  await section.getByRole('button', { name: 'See what would be added' }).click();
  await expect(section).toContainText('Will add 1 price list, 1 set of rules, 1 holiday.');
  await expectAccessible(page, 'copy a setup');
  await shot(page, info, 'copy-setup');
  // Looking changes nothing.
  expect((await read<unknown[]>(page, `/api/w/${south}/rate-cards`)).length).toBe(0);

  await section.getByRole('button', { name: 'Copy to 1 kitchen' }).click();
  await expect(section).toContainText('Added 3');
  expect((await read<unknown[]>(page, `/api/w/${south}/rate-cards`)).length).toBe(1);
  expect((await read<unknown[]>(page, `/api/w/${south}/policies`)).length).toBe(1);
  const there = await read<{ holidays: { name: string }[] }>(page, `/api/w/${south}/bootstrap`);
  expect(there.holidays.map((h) => h.name)).toEqual(['Founders day']);

  // Once copied, there is nothing left to add.
  await section.getByRole('button', { name: 'See what would be added' }).click();
  await expect(section).toContainText('Nothing to add.');
  await expect(section.getByRole('button', { name: /^Copy to/ })).toBeDisabled();
});

test('a head office sees its kitchens added up, and a kitchen can join, and stop, by itself', async ({
  page,
}, info) => {
  const stamp = Date.now().toString(36);
  const north = `hn-${stamp}`;
  const south = `hs-${stamp}`;
  await signIn(page, `office-${stamp}@example.org`, 'Office');
  for (const [slug, name] of [
    [north, 'North Hall'],
    [south, 'South Hall'],
  ] as const)
    expect((await send(page, '/api/workspaces', { slug, name })).status).toBe(201);
  expect(
    (
      await send(page, `/api/w/${north}/rate-cards`, {
        effectiveFrom: '2026-01-01',
        veg: rupees(150),
        nonVeg: rupees(170),
        extraChapati: rupees(15),
        extraBhakri: rupees(30),
        extrasPerMonth: rupees(40),
        menu: MENU,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await send(page, `/api/w/${north}/people`, {
        name: 'Secret Eater',
        role: 'consumer',
        activeFrom: firstOfMonth(),
      })
    ).status,
  ).toBe(201);

  // Someone with two kitchens is offered an organisation, and starts one.
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Start an organisation' })).toBeVisible();
  await page.locator('#org-name').fill('Hall Group');
  await page.getByRole('button', { name: 'Start it' }).click();
  await expect(page.getByRole('heading', { name: 'Hall Group', level: 1 })).toBeVisible();
  await expect(page.getByText('No kitchen shares its totals')).toBeVisible();

  // They run both, so they add them.
  for (const name of ['North Hall', 'South Hall']) {
    await page.getByLabel('A kitchen you run').selectOption({ label: name });
    await page.getByRole('button', { name: 'Add it' }).click();
    await expect(page.getByRole('cell', { name })).toBeVisible();
  }
  await expect(page.getByText('Owed', { exact: true }).first()).toBeVisible();
  const table = page.getByRole('region', { name: /^Table/ });
  await expect(table).toContainText('North Hall');
  await expect(table).toContainText('South Hall');
  // Nothing in the page names a person.
  await expect(page.getByText('Secret Eater')).toHaveCount(0);
  await expectAccessible(page, 'an organisation');
  await shot(page, info, 'organisation');

  // The kitchen says who receives its totals, to everyone in it, and can stop.
  await page.goto(`/w/${north}`);
  await expect(page.getByText('shares its totals', { exact: false })).toBeVisible();
  await page.goto(`/w/${north}/data`);
  await expect(page.getByText('Hall Group').first()).toBeVisible();
  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(page.getByText('Share this kitchen', { exact: false })).toBeVisible();

  // And it can join again with a link its head office made, after being told whom it is for.
  await page.goto('/app');
  await page.getByRole('link', { name: 'Open' }).last().click();
  await page.getByRole('button', { name: 'Make a link' }).click();
  const link = await page.getByLabel('The link', { exact: true }).inputValue();
  expect(link.length).toBeGreaterThan(20);
  await page.goto(`/w/${north}/data`);
  await page.getByText('Share this kitchen', { exact: false }).click();
  await page.getByLabel('The link their head office sent you').fill(link);
  await page.getByRole('button', { name: 'See who it is for' }).click();
  await expect(page.getByText('This link is for')).toBeVisible();
  await expect(page.getByText('Hall Group', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: /^Share this kitchen's totals with/ }).click();
  await expect(page.getByRole('button', { name: 'Stop sharing' })).toBeVisible();
});
