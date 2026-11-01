import { expect, test, type Page } from '@playwright/test';
import { chosen, known, type Person } from './providers';

/**
 * A person signs in to a running Alimentation through a real identity provider, comes back as
 * themselves, and signs out. Run it after `dev/idp/idp.sh up <provider>` (see dev/idp/README.md).
 */

const idp = chosen();
test.skip(
  !idp,
  `Set IDP to one of: ${known.join(', ')}, with that provider running (dev/idp/idp.sh up).`,
);
const { provider } = idp!;

interface Me {
  account: { email: string; name: string | null } | null;
  operator?: boolean;
  workspaces?: { slug: string }[];
  signInWithProvider: boolean;
  authDev: boolean;
}
const me = async (page: Page) => (await (await page.request.get('/api/me')).json()) as Me;

/** From the app's own Sign in link, through the provider's page, and back. */
async function signInFromTheApp(page: Page, who: Person) {
  await page.goto('/');
  await page
    .getByRole('link', { name: /^sign in$/i })
    .first()
    .click();
  await page.getByRole('link', { name: 'Continue with your account' }).click();
  await page.waitForURL(provider.origin);
  await provider.signIn(page, who);
  await page.waitForURL(/\/app/);
}

test('is set up to sign in through a provider, not with any email', async ({ page }) => {
  const state = await me(page);
  expect(state.signInWithProvider).toBe(true);
  expect(state.authDev).toBe(false);
  expect(state.account).toBeNull();
  // The development door is shut.
  expect(
    (await page.request.post('/auth/dev-login', { data: { email: 'x@example.org' } })).status(),
  ).toBe(404);
});

test('sends a person to the provider, and brings them back as themselves', async ({ page }) => {
  const who = provider.people.operator;
  await signInFromTheApp(page, who);
  const state = await me(page);
  expect(state.account?.email).toBe(who.email);
  expect(state.account?.name?.toLowerCase()).toContain(who.name);
  expect(state.operator).toBe(true);
});

test('lets the person who runs the instance make a kitchen, and no one else', async ({
  page,
  browser,
}) => {
  await signInFromTheApp(page, provider.people.operator);
  const slug = `idp-${Date.now().toString(36)}`;
  const made = await page.request.post('/api/workspaces', {
    data: { slug, name: 'Signed in through the provider' },
  });
  expect(made.status()).toBe(201);
  const state = await me(page);
  expect(state.workspaces?.some((w) => w.slug === slug)).toBe(true);
  // Leave nothing behind.
  const gone = await page.request.post(`/api/w/${slug}/wipe`, { data: { confirm: slug } });
  expect([200, 202]).toContain(gone.status());

  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await other.newPage();
  await signInFromTheApp(second, provider.people.member);
  expect((await me(second)).operator).toBe(false);
  expect(
    (
      await second.request.post('/api/workspaces', {
        data: { slug: `no-${slug}`, name: 'Not allowed' },
      })
    ).status(),
  ).toBe(403);
  await other.close();
});

test('signs the person out of the app', async ({ page }) => {
  await signInFromTheApp(page, provider.people.operator);
  expect((await page.request.post('/auth/logout')).status()).toBe(204);
  expect((await me(page)).account).toBeNull();
});

test('does not sign anyone in who is wrong at the provider, or who refuses to share their details', async ({
  page,
}) => {
  await page.goto('/auth/login');
  await page.waitForURL(provider.origin);
  await provider.signInWrongly(page, provider.people.member);
  expect(page.url()).toMatch(provider.origin);
  expect((await me(page)).account).toBeNull();

  await provider.refuse(page, provider.people.member);
  await page.waitForURL(/\/auth\/callback/);
  expect((await me(page)).account).toBeNull();
});
