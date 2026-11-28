import { expect, type Page, test } from "@playwright/test";
import {
  aWorkingDayThisMonth,
  expectAccessible,
  firstOfMonth,
  shot,
  signIn,
  watchPage,
} from "./support.ts";

/**
 * A kitchen's first hour on a phone: made from a starter, with nothing else yet. What it asks for is one thing
 * at a time, no screen quotes an engine error back, a day before the menu is said so in words, and the forms
 * and the list of entries fit a 390 pixel screen.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Every tick box and radio button of the page sits on the row of its words, left of them, not above. */
async function expectControlsBesideWords(page: Page, where: string) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const input of document.querySelectorAll<HTMLInputElement>(
      "label > input[type=checkbox], label > input[type=radio]",
    )) {
      const label = input.closest("label");
      const words = [...(label?.childNodes ?? [])].find(
        (n) => n !== input && (n.textContent ?? "").trim() !== "",
      );
      if (!label || !words) continue;
      const range = document.createRange();
      range.selectNodeContents(words);
      const w = range.getBoundingClientRect();
      const c = input.getBoundingClientRect();
      if (c.width === 0) continue;
      const beside = w.left >= c.right - 1 && w.top < c.bottom && w.bottom > c.top;
      if (!beside) out.push(`${label.textContent?.trim().slice(0, 40)}`);
    }
    return out;
  });
  expect(bad, `${where}: controls not beside their words`).toEqual([]);
}

test("a kitchen made from a starter has one next step, a menu from the first of the month, and no raw errors", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const stamp = Date.now().toString(36);
  const slug = `first-${info.project.name}-${stamp}`;
  await signIn(page, `first-${info.project.name}-${stamp}@example.org`, "Owner");

  await test.step("the create screen puts each control on one row with its words", async () => {
    await page.goto("/app/new");
    await expect(page.getByRole("heading", { name: "New kitchen", level: 1 })).toBeVisible();
    await expectControlsBesideWords(page, "create a kitchen");
    await expectAccessible(page, "create a kitchen");
    await shot(page, info, "after-create-kitchen");
  });

  await test.step("the address is checked as it is typed, and the money choice has no default", async () => {
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(`Willow ${stamp}`);
    await page.getByLabel("Address").fill(slug);
    await expect(page.getByText("Available", { exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Track money/ })).not.toBeChecked();
    await expect(page.getByRole("radio", { name: /^Meals only/ })).not.toBeChecked();
    // Without a choice the form says so, beside the choice, and makes nothing.
    await page.getByRole("button", { name: "Create kitchen" }).click();
    await expect(page.getByText("Choose whether this kitchen tracks money").first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/new$/);
  });

  await test.step("a taken address says so, with another to use", async () => {
    const first = await page.request.post("/api/workspaces", {
      data: { slug: `taken-${info.project.name}-${stamp}`, name: "Taken" },
    });
    expect(first.status()).toBe(201);
    await page.getByLabel("Address").fill(`taken-${info.project.name}-${stamp}`);
    await expect(page.getByText(/^Taken\. Try /)).toBeVisible();
    await page
      .getByRole("button", { name: new RegExp(`taken-${info.project.name}-${stamp}-2`) })
      .click();
    await expect(page.getByLabel("Address")).toHaveValue(`taken-${info.project.name}-${stamp}-2`);
    await page.getByLabel("Address").fill(slug);
    await expect(page.getByText("Available", { exact: true })).toBeVisible();
  });

  await test.step("it is made from the home lunch starter", async () => {
    await page.getByRole("radio", { name: /Home lunch/ }).check();
    await page.getByRole("radio", { name: /^Track money/ }).check();
    await page.getByRole("button", { name: "Create kitchen" }).click();
    await page.waitForURL(`**/w/${slug}`);
  });

  await test.step("the Home shows the one next step, and says nothing can be billed yet", async () => {
    await expect(page.getByRole("heading", { level: 1, name: `Willow ${stamp}` })).toBeVisible();
    // The setup checklist is the one place that says what is left; the first thing to do is the people.
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toBeVisible();
    await expect(page.getByText("2 of 4 done")).toBeVisible();
    await expect(page.getByText("Add the people you feed")).toBeVisible();
    // No money figures before there is anything to bill, and no engine wording.
    await expect(page.getByRole("region", { name: "This month" })).toHaveCount(0);
    await expect(page.getByText("Owed to the kitchen")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("no menu is in force");
    // Nothing to pay or bill yet, so those are not offered, and an admin has no History.
    await expect(page.getByRole("link", { name: "Payments" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Bills" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
    await expectAccessible(page, "blank home");
    await shot(page, info, "after-blank-dash");
  });

  await test.step("the menu began with the month, so the whole month counts", async () => {
    const menus = await page.request.get(`/api/w/${slug}/menus`);
    const list = (await menus.json()) as { effectiveFrom: string }[];
    expect(list.map((m) => m.effectiveFrom)).toEqual([firstOfMonth()]);
  });

  await test.step("with a person and prices the month shows, with no refusal on any screen", async () => {
    const w = `/api/w/${slug}`;
    const person = await page.request.post(`${w}/people`, {
      data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
    });
    expect(person.status()).toBe(201);
    const items = (await (await page.request.get(`${w}/catalogue`)).json()) as {
      id: string;
      name: string;
    }[];
    const card = await page.request.post(`${w}/rate-cards`, {
      data: {
        effectiveFrom: firstOfMonth(),
        monthlyFee: 0,
        prices: items.map((i) => ({ itemId: i.id, serviceId: null, amount: 10000 })),
      },
    });
    expect(card.status()).toBe(201);
    for (const path of ["", "/today", "/meals", "/payments"]) {
      await page.goto(`/w/${slug}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/no menu is in force|No menu/);
      await expect(page.getByRole("main").getByRole("alert"), `at ${path || "/"}`).toHaveCount(0);
      // Everything is set up now, so the checklist is gone.
      await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toHaveCount(0);
    }
  });

  await test.step("the log says in words when the menu starts later than the day chosen", async () => {
    await page.goto(`/w/${slug}/meals`);
    await page.getByRole("button", { name: "Skip a meal" }).click();
    const dlg = page.getByRole("dialog", { name: "Skip a meal" });
    await dlg.getByLabel("Who is it for?").selectOption({ label: "Asha" });
    await expect(dlg.getByText(/Your menu starts on/)).toHaveCount(0);
    // Another day: the same day of the month before the menu began.
    await dlg.getByLabel("Which day?").click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await page
      .getByRole("gridcell", { name: /\b15th\b/ })
      .getByRole("button")
      .click();
    await expect(
      dlg.getByText(
        /Your menu starts on 1 \w+ \d{4}, so days before that are not counted\. Set an earlier start under Menu\./,
      ),
    ).toBeVisible();
    await expect(dlg).not.toContainText(/SERVICE_NOT_SERVED|is not served/);
    await expect(dlg.getByRole("button", { name: "Skip", exact: true })).toBeDisabled();
  });

  expect(problems).toEqual([]);
});

test("the log fits a phone: each entry is a card that shows who it is for and that it was late", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const stamp = Date.now().toString(36);
  const slug = `phone-log-${info.project.name}-${stamp}`;
  await signIn(page, `phone-log-${info.project.name}-${stamp}@example.org`, "Owner");
  const made = await page.request.post("/api/workspaces", {
    data: { slug, name: `Willow Home ${stamp}`, alsoSupplier: true },
  });
  expect(made.status()).toBe(201);
  const { seedHome } = await import("./seed.ts");
  await seedHome(page.request, slug);
  const w = `/api/w/${slug}`;
  const person = (await (
    await page.request.post(`${w}/people`, {
      data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
    })
  ).json()) as { id: string };
  const day = aWorkingDayThisMonth();
  const logged = await page.request.post(`${w}/log`, {
    data: {
      date: day,
      personId: person.id,
      allConsumers: false,
      action: "Leave",
      serviceId: null,
      itemId: null,
      qty: null,
      note: "A long note about why, long enough to need more than one line on a phone",
    },
  });
  expect(logged.status(), await logged.text()).toBe(201);

  await page.goto(`/w/${slug}/meals`);
  // One card to an entry: what it did, for whom, the note, and that it was late when it was.
  const entry = page.getByRole("main").getByRole("listitem").filter({ hasText: "A long note" });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Skip");
  await expect(entry).toContainText("Asha");
  const today = new Date();
  const iso = (t: Date) =>
    `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  if (day < iso(today)) await expect(entry).toContainText(/Added \d+ days? after/);
  // Nothing is cut off at the side: the entry is as wide as the screen allows and the page does not scroll.
  const edge = await entry.boundingBox();
  expect(edge && edge.x + edge.width).toBeLessThanOrEqual(390);
  await expectControlsBesideWords(page, "meals");
  await expectAccessible(page, "meals on a phone");
  await shot(page, info, "after-home-log");

  await test.step("the admin has no History, and an address for it says why", async () => {
    await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
    await page.goto(`/w/${slug}/history`);
    await expect(
      page.getByRole("heading", { level: 1, name: "This is for cooks and consumers" }),
    ).toBeVisible();
    await expect(
      page.getByText("History is open to cooks and consumers. Switch to that view to see it."),
    ).toBeVisible();
  });

  expect(problems).toEqual([]);
});
