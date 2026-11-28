import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { seedHome } from "./seed.ts";
import { expectAccessible, expectNoSidewaysScroll, firstOfMonth, signIn } from "./support.ts";

/** A kitchen with prices, a consumer who has joined, and a claim waiting, made through the API. */
async function seed(owner: Page, member: Page, tag: string) {
  const slug = `shl-${tag}-${Date.now().toString(36)}`;
  await signIn(owner, `owner-${slug}@example.org`, "Owner");
  const api = owner.request;
  await api.post("/api/workspaces", { data: { slug, name: `Shell ${tag}`, alsoSupplier: true } });
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
  await member.request.post(`${w}/claims`, {
    data: {
      consumerId: id,
      paidAt: new Date().toISOString().slice(0, 10),
      forMonth: firstOfMonth().slice(0, 7),
      amount: 100000,
      method: "UPI",
    },
  });
  return { slug };
}

const sections = (page: Page) => page.getByRole("navigation", { name: "Sections", exact: true });

test.describe("the phone shell", () => {
  test.skip(({ isMobile }) => !isMobile, "the bottom bar exists only on a phone");

  test("the bar holds each role's entries, More opens a sheet, and nothing scrolls sideways", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "bar");

    await page.goto(`/w/${slug}`);
    const bar = sections(page);
    for (const name of ["Home", "Today", "Payments", "People"])
      await expect(bar.getByRole("link", { name })).toBeVisible();
    await expect(bar.getByRole("button", { name: "More" })).toBeVisible();
    await expectNoSidewaysScroll(page, "admin home");

    // More is a sheet: its rows, a close button, Esc to close, and Back closes it too.
    await bar.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    for (const name of ["Bills", "Setup", "Books"])
      await expect(sheet.getByRole("link", { name })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await bar.getByRole("button", { name: "More" }).click();
    await page.goBack();
    await expect(sheet).toBeHidden();

    // A screen behind More marks More as the current one.
    await bar.getByRole("button", { name: "More" }).click();
    await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Setup" }).click();
    await expect(page).toHaveURL(/\/setup\/items$/);
    await expect(bar.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");

    // The account lives in the top bar's avatar, as a sheet; signing out is only there.
    await page.getByRole("button", { name: /^Account/ }).click();
    const account = page.getByRole("dialog", { name: "Account" });
    await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(account.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    await expectAccessible(page, "the account sheet");
    await page.keyboard.press("Escape");

    // The consumer's bar.
    await mp.goto(`/w/${slug}`);
    const mbar = sections(mp);
    for (const name of ["Home", "Meals", "Pay", "History"])
      await expect(mbar.getByRole("link", { name })).toBeVisible();
    await expect(mbar.getByRole("button", { name: "More" })).toHaveCount(0);
    await expectNoSidewaysScroll(mp, "consumer home");
    await member.close();
  });

  test("the bar stays inside every phone width", async ({ page, browser }, info) => {
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "width");
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/w/${slug}/people`);
      await expect(sections(page).getByRole("link", { name: "People" })).toBeVisible();
      await expectNoSidewaysScroll(page, `${width}px`);
      const box = await sections(page).boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    await member.close();
  });
});

test.describe("the desktop shell", () => {
  test.skip(({ isMobile }) => isMobile, "a wide screen has the sidebar");

  test("the sidebar lists the admin's seven entries, folds to icons, and the account menu has what it should", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "side");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/w/${slug}`);

    const nav = sections(page);
    for (const name of ["Home", "Today", "People", "Payments", "Bills", "Setup", "Books"])
      await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expectNoSidewaysScroll(page, "1440px");
    await expect(nav.getByRole("link", { name: /^Payments/ })).toContainText("to confirm");

    // Fold to the rail and open again; the choice is kept over a reload.
    await page.getByRole("button", { name: "Collapse menu" }).click();
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand menu" })).toBeVisible();
    await page.getByRole("button", { name: "Expand menu" }).click();
    await expect(page.getByRole("button", { name: "Collapse menu" })).toBeVisible();

    // The kitchen switcher: this kitchen, All kitchens.
    await page.getByRole("button", { name: /Shell side/ }).click();
    await expect(page.getByRole("menuitem", { name: "All kitchens" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The account menu: the viewer's roles (this owner is also the cook), the theme, help, sign out.
    await page.getByRole("button", { name: /Owner/ }).click();
    await expect(page.getByRole("menuitemradio", { name: "Cook" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "System" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Help and guides/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The search opens on Ctrl+K and goes to a screen.
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Search this kitchen" });
    await search.getByRole("combobox").fill("people");
    await search.getByRole("option", { name: "People" }).first().click();
    await expect(page).toHaveURL(/\/people$/);

    // The breadcrumb names the kitchen, the screen and the tab.
    await page.goto(`/w/${slug}/setup/menu`);
    const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
    await expect(crumbs).toContainText("Setup");
    await expect(crumbs).toContainText("Menu");
    await member.close();
  });

  test("the consumer's sidebar has four entries and Pay", async ({ page, browser }, info) => {
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "cons");
    await mp.setViewportSize({ width: 1280, height: 800 });
    await mp.goto(`/w/${slug}`);
    const nav = sections(mp);
    for (const name of ["Home", "Meals", "Pay", "History"])
      await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await member.close();
  });
});
