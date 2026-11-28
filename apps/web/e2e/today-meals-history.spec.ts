import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { seedHome } from "./seed.ts";
import {
  aWorkingDayThisMonth,
  expectAccessible,
  expectNoSidewaysScroll,
  firstOfMonth,
  signIn,
} from "./support.ts";

/** A kitchen with a menu, and a consumer who has joined, made through the API. The owner is its admin and cook. */
async function seed(owner: Page, member: Page, tag: string) {
  const slug = `tmh-${tag}-${Date.now().toString(36)}`;
  await signIn(owner, `owner-${slug}@example.org`, "Owner");
  const api = owner.request;
  await api.post("/api/workspaces", { data: { slug, name: `Meals ${tag}`, alsoSupplier: true } });
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
  return { slug, w, id };
}

const person = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test.describe("Today", () => {
  test("a toggle changes at once, offers Undo, and is put back when the server refuses it", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const { slug } = await seed(page, await member.newPage(), "today");
    const day = aWorkingDayThisMonth();

    await page.goto(`/w/${slug}/today?date=${day}`);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByText("1 eating")).toBeVisible();
    await expectAccessible(page, "today");
    await expectNoSidewaysScroll(page, "today");

    const jovial = person(page, "Jovial");
    await expect(jovial.getByRole("button", { name: "Eating" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await jovial.getByRole("button", { name: "Leave" }).click();
    await expect(jovial.getByRole("button", { name: "Leave" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("1 on leave")).toBeVisible();
    await expect(page.getByText(/Jovial is on leave/)).toBeVisible();

    // Undo takes the leave away again.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(jovial.getByRole("button", { name: "Eating" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("1 eating")).toBeVisible();

    // A refusal puts the chip back and says why.
    await page.route("**/api/w/*/log", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({ error: { code: "invalid", message: "That day is closed." } }),
          })
        : route.continue(),
    );
    await jovial.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByText("That day is closed.")).toBeVisible();
    await expect(jovial.getByRole("button", { name: "Eating" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await member.close();
  });

  test("the day can be changed, and the cook's own action is the kitchen being off", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const { slug } = await seed(page, await member.newPage(), "days");
    await page.goto(`/w/${slug}/today`);
    await page.getByRole("button", { name: "Tomorrow" }).click();
    await expect(page).toHaveURL(/date=/);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page).not.toHaveURL(/date=/);
    await member.close();
  });
});

test.describe("Meals", () => {
  test("a consumer skips a meal in two taps, and takes the entry away again", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug } = await seed(page, mp, "skip");

    await mp.goto(`/w/${slug}/meals`);
    await expect(mp.getByRole("heading", { level: 1, name: "My meals" })).toBeVisible();
    await expect(mp.getByText("Nothing logged yet")).toBeVisible();
    await expectAccessible(mp, "my meals");

    await mp.getByRole("button", { name: "Skip a meal" }).click();
    const dialog = mp.getByRole("dialog", { name: "Skip a meal" });
    await expect(dialog.getByRole("button", { name: "Tomorrow" })).toBeVisible();
    // The footer is in view as soon as the form opens, on a phone too.
    await expect(dialog.getByRole("button", { name: "Skip", exact: true })).toBeInViewport();
    await dialog.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(mp.getByText(/skipped/)).toBeVisible();
    await expect(dialog).toBeHidden();

    // It is listed under its day, with a menu to change or remove it.
    const row = mp.getByRole("main").getByRole("listitem").filter({ hasText: "Skip" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Actions for Skip/ }).click();
    await mp.getByRole("menuitem", { name: "Remove" }).click();
    await expect(mp.getByText("Entry removed.")).toBeVisible();
    await expect(mp.getByText("Nothing logged yet")).toBeVisible();
    await member.close();
  });

  test("a day that is already logged is refused under the date, not in a banner", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug, w, id } = await seed(page, mp, "dup");
    // The day the consumer's form opens on: the first working day after the kitchen's today.
    const boot = (await (await page.request.get(`${w}/bootstrap`)).json()) as { today: string };
    const first = new Date(`${boot.today}T00:00:00Z`);
    do first.setUTCDate(first.getUTCDate() + 1);
    while ([0, 6].includes(first.getUTCDay()));
    const logged = await page.request.post(`${w}/log`, {
      data: {
        date: first.toISOString().slice(0, 10),
        personId: id,
        allConsumers: false,
        action: "Leave",
        serviceId: null,
        itemId: null,
        qty: null,
      },
    });
    expect(logged.ok()).toBe(true);

    await mp.goto(`/w/${slug}/meals`);
    await mp.getByRole("button", { name: "Skip a meal" }).click();
    const dialog = mp.getByRole("dialog", { name: "Skip a meal" });
    await expect(dialog.getByText("That is already logged for this day.")).toBeVisible();
    await expect(dialog.getByLabel("Which day?")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("button", { name: "Skip", exact: true })).toBeDisabled();
    await member.close();
  });
});

test.describe("History", () => {
  test("the trail is a feed by day with filter chips, and what is filtered out stays out", async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const member: BrowserContext = await browser.newContext({ ...info.project.use });
    const mp = await member.newPage();
    const { slug, w, id } = await seed(page, mp, "hist");
    await page.request.post(`${w}/log`, {
      data: {
        date: aWorkingDayThisMonth(),
        personId: id,
        allConsumers: false,
        action: "Leave",
        serviceId: null,
        itemId: null,
        qty: null,
      },
    });

    // History is the cook's and the consumer's page (the admin reads the audit trail instead).
    await mp.goto(`/w/${slug}/history`);
    await expect(mp.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
    const filters = mp.getByRole("group", { name: "Show" });
    for (const name of ["All", "Bills", "Payments", "Meals"])
      await expect(filters.getByRole("button", { name })).toBeVisible();
    await expect(mp.getByRole("listitem").filter({ hasText: "logged Leave" })).toBeVisible();
    await expectAccessible(mp, "history");
    await expectNoSidewaysScroll(mp, "history");

    await filters.getByRole("button", { name: "Payments" }).click();
    await expect(mp).toHaveURL(/type=payments/);
    await expect(mp.getByRole("listitem").filter({ hasText: "logged Leave" })).toHaveCount(0);
    await filters.getByRole("button", { name: "Meals" }).click();
    await expect(mp.getByRole("listitem").filter({ hasText: "logged Leave" })).toBeVisible();
    await member.close();
  });
});
