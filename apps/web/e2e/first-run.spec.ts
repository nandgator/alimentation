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

async function banners(page: Page) {
  return page.locator("main .banner").allInnerTexts();
}

test("a kitchen made from a starter has one next step, a menu from the first of the month, and no raw errors", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const stamp = Date.now().toString(36);
  const slug = `first-${info.project.name}-${stamp}`;
  await signIn(page, `first-${info.project.name}-${stamp}@example.org`, "Owner");

  await test.step("the create screen puts each control on one row with its words", async () => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Start a kitchen" })).toBeVisible();
    await expectControlsBesideWords(page, "create a kitchen");
    await expectAccessible(page, "create a kitchen");
    await shot(page, info, "after-create-kitchen");
  });

  await test.step("it is made from the home lunch starter", async () => {
    await page.getByLabel("Name", { exact: true }).fill(`Willow ${stamp}`);
    await page.getByLabel("Address").fill(slug);
    await page.getByRole("radio", { name: /Home lunch/ }).check();
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(`**/w/${slug}`);
  });

  await test.step("the dashboard shows one next step, and says nothing can be billed yet", async () => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const said = await banners(page);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("Add the people you feed");
    await expect(page.getByText("Who owes what, and what has been paid")).toHaveCount(0);
    await expect(
      page.getByText("Bills will show here once the kitchen has a menu, people and prices."),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("no menu is in force");
    // Nothing to pay or settle yet, so those are not offered.
    await expect(page.getByRole("link", { name: "Payments" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settlements" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
    await expectAccessible(page, "blank dashboard");
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
    for (const path of ["", "/daily", "/log", "/payments"]) {
      await page.goto(`/w/${slug}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/no menu is in force|No menu/);
      await expect(page.locator(".banner.bad")).toHaveCount(0);
      expect(await banners(page), `at ${path || "/"}`).toEqual([]);
    }
  });

  await test.step("the log says in words when the menu starts later than the day chosen", async () => {
    await page.goto(`/w/${slug}/log`);
    await page.getByLabel("Date").fill(aWorkingDayThisMonth());
    await expect(page.getByText(/Your menu starts on/)).toHaveCount(0);
    const before = new Date();
    before.setMonth(before.getMonth() - 1, 15);
    const iso = `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, "0")}-15`;
    await page.getByLabel("Date").fill(iso);
    await expect(
      page.getByText(
        /Your menu starts on 01-.*, so days before that are not counted\. Set an earlier start under Menu\./,
      ),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/SERVICE_NOT_SERVED|is not served/);
    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  expect(problems).toEqual([]);
});

test("the log fits a phone: each entry is a card that shows who added it and that it was late", async ({
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

  await page.goto(`/w/${slug}/log`);
  await expect(page.getByRole("heading", { name: "Recent entries" })).toBeVisible();
  const list = page.locator(".tablewrap.cards");
  await expect(list).toContainText("Added by");
  await expect(list).toContainText("Leave");
  // Nothing is cut off at the side: the list is as wide as the screen and does not scroll.
  const clipped = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(clipped).toBeLessThanOrEqual(1);
  const edge = await page.locator("table.cards td[data-label='Added by']").first().boundingBox();
  expect(edge && edge.x + edge.width).toBeLessThanOrEqual(390);
  await expectControlsBesideWords(page, "log");
  await expectAccessible(page, "log on a phone");
  await shot(page, info, "after-home-log");

  await test.step("the admin has no History, and an address for it says why", async () => {
    await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
    await page.goto(`/w/${slug}/history`);
    await expect(
      page.getByText("History is not part of the admin view of this kitchen."),
    ).toBeVisible();
  });

  expect(problems).toEqual([]);
});
