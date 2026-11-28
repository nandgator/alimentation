import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { seedHome } from "./seed.ts";
import { firstOfMonth, signIn } from "./support.ts";

async function seed(owner: Page, member: Page, tag: string) {
  const slug = `nav-${tag}-${Date.now().toString(36)}`;
  await signIn(owner, `owner-${slug}@example.org`, "Owner");
  const api = owner.request;
  await api.post("/api/workspaces", { data: { slug, name: `Nav ${tag}`, alsoSupplier: true } });
  const w = `/api/w/${slug}`;
  await seedHome(api, slug);
  const made = await api.post(`${w}/people`, {
    data: { name: "Jovial", role: "consumer", activeFrom: firstOfMonth() },
  });
  const id = (await made.json()).id as string;
  const email = `member-${slug}@example.org`;
  const inv = await api.post(`${w}/people/${id}/invite`, { data: { email } });
  const link = (await inv.json()).link as string;
  await signIn(member, email, "Jovial");
  await member.request.post("/api/invites/accept", { data: { token: link.split("#")[1] } });
  return { slug };
}

/** Opens a screen by its name: the sidebar on a wide screen, the bottom bar (or More) on a phone. */
async function openSection(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Sections", exact: true });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link").first()).toBeVisible();
  const link = nav.getByRole("link", { name, exact: true });
  if (await link.isVisible().catch(() => false)) return link.click();
  await nav.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name }).click();
}

test.describe("moving between screens", () => {
  test("every route has its own title, focus lands on the heading, and the skip link is first", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "titles");
    await page.goto(`/w/${slug}`);
    await expect(page.locator("main h1").first()).toBeVisible();

    // The first thing to take focus is the skip link, which jumps to the page.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    const titles = new Set<string>();
    for (const name of ["Today", "People"]) {
      await openSection(page, name);
      await expect(page).toHaveTitle(new RegExp(`^${name} · Nav titles · Alimentation$`));
      titles.add(await page.title());
      // The title is announced for a screen reader.
      await expect(page.getByRole("status").filter({ hasText: name }).first()).toBeAttached();
      // Focus is on the page's own heading.
      await expect(page.locator("main h1").first()).toBeFocused();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    }
    await page.goto(`/w/${slug}/setup/rules`);
    await expect(page).toHaveTitle(/^Rules · Setup · Nav titles · Alimentation$/);
    titles.add(await page.title());
    await page.goto(`/w/${slug}/books/audit`);
    await expect(page).toHaveTitle(/^Audit · Books · Nav titles · Alimentation$/);
    titles.add(await page.title());
    expect(titles.size).toBe(4);

    await member.close();
  });

  test("a role switch changes the view without reloading the page", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "switch");
    await page.goto(`/w/${slug}`);
    await page.evaluate(() => {
      (window as unknown as { marker: string }).marker = "same page";
    });
    if (info.project.name === "phone") {
      await page.getByRole("button", { name: /^Account/ }).click();
      await page
        .getByRole("dialog", { name: "Account" })
        .getByRole("radio", { name: "Cook" })
        .click();
    } else {
      await page.getByRole("button", { name: /Owner/ }).click();
      await page.getByRole("menuitemradio", { name: "Cook" }).click();
    }
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByText("Now viewing as Cook")).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Sections", exact: true })
        .getByRole("link", { name: "History" }),
    ).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe(
      "same page",
    );
    await member.close();
  });

  test("Back and Forward work between screens", async ({ page, browser }, info) => {
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "history");
    await page.goto(`/w/${slug}`);
    await openSection(page, "People");
    await expect(page).toHaveURL(/\/people$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));
    await page.goForward();
    await expect(page).toHaveURL(/\/people$/);
    await member.close();
  });

  test("every denial is a page of its own, with the way out", async ({ page, browser }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "denied");

    // A consumer at an admin screen.
    await mp.goto(`/w/${slug}/people`);
    await expect(mp.getByRole("heading", { name: "This is for admins", level: 1 })).toBeVisible();
    await expect(mp.getByText(/People is open to admins\. Ask .* if you need it\./)).toBeVisible();
    await expect(mp.getByRole("button", { name: "Go to your home" })).toBeVisible();
    await expect(mp.getByRole("button", { name: "All kitchens" })).toBeVisible();

    // An address that is nothing, and one that is not in this kitchen at all.
    await page.goto(`/w/${slug}/nowhere`);
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await page.goto("/w/no-such-kitchen-here");
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Your kitchens" })).toBeVisible();

    // The admin at a screen that is the cook's and the consumer's.
    await page.goto(`/w/${slug}/history`);
    await expect(
      page.getByRole("heading", { name: "This is for cooks and consumers", level: 1 }),
    ).toBeVisible();
    await member.close();
  });

  test("the audit trail shows an import, and a screen that breaks leaves the kitchen standing", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const { slug } = await seed(page, await member.newPage(), "audit");
    const entry = (over: object) => ({
      id: 1,
      table: "person_import",
      rowId: "file-1",
      action: "IMPORT",
      actor: null,
      at: new Date().toISOString(),
      before: null,
      after: { rows: 3 },
      ...over,
    });
    const serve = (rows: unknown[]) =>
      page.route("**/api/w/*/audit*", (r) => r.fulfill({ json: rows }));

    // The verb the database writes for a people import has its own word.
    await serve([entry({})]);
    await page.goto(`/w/${slug}/books/audit`);
    await expect(page.getByText("Imported").locator("visible=true").first()).toBeVisible();

    // A row that cannot be drawn costs the one screen, not the kitchen: the sidebar stays and Try again is offered.
    await page.unroute("**/api/w/*/audit*");
    await serve([entry({ table: { not: "a name" } })]);
    await page.goto(`/w/${slug}/books/audit`);
    await expect(
      page.getByRole("heading", { name: "This screen could not be shown", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await member.close();
  });

  test("a kitchen without money has no Payments, Bills or Prices", async ({ page }) => {
    test.setTimeout(120_000);
    const slug = `nav-meals-${Date.now().toString(36)}`;
    await signIn(page, `owner-${slug}@example.org`, "Owner");
    await page.request.post("/api/workspaces", {
      data: { slug, name: "Meals only", moneyEnabled: false },
    });
    await page.goto(`/w/${slug}`);
    const nav = page.getByRole("navigation", { name: "Sections", exact: true });
    await expect(nav.getByRole("link", { name: "People" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Payments/ })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Bills" })).toHaveCount(0);
    await page.goto(`/w/${slug}/payments`);
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await page.goto(`/w/${slug}/setup/prices`);
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await page.goto(`/w/${slug}/setup/rules`);
    await expect(page).toHaveTitle(/^Rules · Setup · Meals only · Alimentation$/);
  });
});
