import { expect, type Page, test } from "@playwright/test";
import { type Seeded, seedHome } from "./seed.ts";
import { aWorkingDayThisMonth, expectAccessible, firstOfMonth, shot, signIn } from "./support.ts";

const clean = (t: string) => t.replace(/\s+/g, " ").trim();
const has = (names: string[], name: string) =>
  names.some((n) => n === name || n.startsWith(`${name} `));

/** Every name in the menu, whether it is in the sidebar, in the bottom bar or behind More. */
async function menuNames(p: Page): Promise<string[]> {
  const nav = p.getByRole("navigation", { name: "Sections", exact: true });
  // The menu is drawn once the kitchen has been read: wait for it before asking what is in it.
  await nav.getByRole("link").first().waitFor();
  const names = (await nav.getByRole("link").allInnerTexts()).map(clean);
  const more = nav.getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
    const sheet = p.getByRole("dialog", { name: "More" });
    names.push(...(await sheet.getByRole("link").allInnerTexts()).map(clean));
    await p.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  return names;
}

/** A kitchen made through the API, so these specs do not depend on the new-kitchen page. */
async function makeKitchen(
  page: Page,
  slug: string,
  name: string,
  opts: { moneyEnabled: boolean; alsoSupplier?: boolean },
) {
  const made = await page.request.post("/api/workspaces", {
    data: { slug, name, alsoSupplier: opts.alsoSupplier ?? false, moneyEnabled: opts.moneyEnabled },
  });
  expect(made.status()).toBe(201);
}

test("a kitchen without money: the Home counts meals, no screen about money is there, and nothing shows a rupee", async ({
  page,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 180_000));
  const slug = `meals-${info.project.name}-${Date.now().toString(36)}`;
  const w = `/api/w/${slug}`;
  await signIn(page, `meals-${slug}@example.org`, "Owner");
  await makeKitchen(page, slug, "Plain Mess", { moneyEnabled: false });
  let seeded: Seeded | undefined;

  await test.step("a new kitchen's Home is a checklist of three steps, with no prices among them", async () => {
    await page.goto(`/w/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Plain Mess" })).toBeVisible();
    const list = page.getByRole("heading", { name: "Set up your kitchen" });
    await expect(list).toBeVisible();
    await expect(page.getByText("0 of 3 done")).toBeVisible();
    for (const step of ["People", "What you serve", "Menu"])
      await expect(page.getByRole("link", { name: new RegExp(`^${step}`) }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Prices/ })).toHaveCount(0);
    await expect(page.getByText("Add prices to start billing.")).toHaveCount(0);
    await expectAccessible(page, "new kitchen without money");
    await shot(page, info, "m1-new-kitchen");
  });

  await test.step("the menu has no screen about money, and keeps the others under their new names", async () => {
    const names = await menuNames(page);
    for (const gone of ["Payments", "Bills"]) expect(has(names, gone), gone).toBe(false);
    for (const kept of ["Home", "Today", "People", "Setup", "Books"])
      expect(has(names, kept), kept).toBe(true);
  });

  await test.step("an address for a screen about money is not there, and the server says why", async () => {
    for (const path of ["payments", "bills", "setup/prices", "books/settlements"]) {
      await page.goto(`/w/${slug}/${path}`);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    }
    const res = await page.request.get(`${w}/rate-cards`);
    expect(res.status()).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "money_not_tracked",
    );
  });

  await test.step("what is served, the menu and the people end the checklist", async () => {
    seeded = await seedHome(page.request, slug, { prices: false });
    expect(seeded.services).toHaveLength(1);
    const made = await page.request.post(`${w}/people`, {
      data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
    });
    expect(made.status()).toBe(201);
    const id = ((await made.json()) as { id: string }).id;
    const logged = await page.request.post(`${w}/log`, {
      data: {
        date: aWorkingDayThisMonth(),
        personId: id,
        allConsumers: false,
        action: "Extra",
        serviceId: seeded.services[0],
        itemId: seeded.chapati,
        qty: 3,
      },
    });
    expect(logged.status()).toBe(201);
    // These were added behind the page's back, so it reads the kitchen again.
    await page.goto(`/w/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Plain Mess" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toHaveCount(0);
  });

  await test.step("the Home counts meals, leave and extras, and who ate", async () => {
    const stats = page.getByRole("region", { name: "This month" });
    for (const label of ["Meals this month", "Leave days", "Eating today"])
      await expect(stats.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByTestId("meals-chart")).toBeVisible();
    // The table is a table on a desktop and a list of items on a phone: either way Asha is in it, with her 3 extras.
    const who = page.getByRole("region", { name: "People" });
    await expect(who.getByText("Asha", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₹");
    await expectAccessible(page, "home without money");
    await shot(page, info, "m4-home");
  });

  await test.step("no screen of the kitchen shows a rupee or a column about money", async () => {
    for (const path of [
      "today",
      "people",
      "setup/items",
      "setup/menu",
      "setup/rules",
      "setup/holidays",
      "books/month-end",
      "books/audit",
    ]) {
      await page.goto(`/w/${slug}/${path}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator("main"), path).not.toContainText("₹");
      await expect(
        page.getByRole("columnheader", { name: /^(Billed|Amount|Price|Live total)/ }),
      ).toHaveCount(0);
    }
    // Rules keeps its name, and says nothing about leave charges, a monthly fee or payments.
    await page.goto(`/w/${slug}/setup/rules`);
    for (const word of [/leave day is charged/i, /monthly fee/i])
      await expect(page.getByText(word)).toHaveCount(0);
    await shot(page, info, "m3-rules");
  });
});

test("a kitchen that tracks money asks for prices on its Home, and then has Payments and Bills", async ({
  page,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 180_000));
  const slug = `money-${info.project.name}-${Date.now().toString(36)}`;
  const w = `/api/w/${slug}`;
  await signIn(page, `money-${slug}@example.org`, "Owner");
  await makeKitchen(page, slug, "Priced Mess", { moneyEnabled: true });
  // It starts with what it serves and a menu, and people to feed; prices come last.
  await seedHome(page.request, slug, { prices: false });
  const made = await page.request.post(`${w}/people`, {
    data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
  });
  expect(made.status()).toBe(201);

  await test.step("the checklist has four steps and the last is Prices; Payments and Bills wait for it", async () => {
    await page.goto(`/w/${slug}`);
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toBeVisible();
    await expect(page.getByText("3 of 4 done")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Prices/ })).toBeVisible();
    const names = await menuNames(page);
    for (const later of ["Payments", "Bills"]) expect(has(names, later), later).toBe(false);
    for (const kept of ["Home", "Today", "People", "Setup", "Books"])
      expect(has(names, kept), kept).toBe(true);
    await shot(page, info, "m5-money-checklist");
  });

  await test.step("with prices the checklist is gone and the Home leads with what is owed", async () => {
    const items = (await (await page.request.get(`${w}/catalogue`)).json()) as { id: string }[];
    const card = await page.request.post(`${w}/rate-cards`, {
      data: {
        effectiveFrom: firstOfMonth(),
        monthlyFee: 0,
        prices: items.map((i) => ({ itemId: i.id, serviceId: null, amount: 10000 })),
      },
    });
    expect(card.status()).toBe(201);
    await page.goto(`/w/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Priced Mess" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toHaveCount(0);
    const stats = page.getByRole("region", { name: "This month" });
    for (const label of ["Owed to the kitchen", "Collected this month", "Eating today"])
      await expect(stats.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
    const names = await menuNames(page);
    for (const kept of ["Payments", "Bills"]) expect(has(names, kept), kept).toBe(true);
    await expectAccessible(page, "home with money");
    await shot(page, info, "m6-money-home");
  });

  await test.step("Bills has the month, three figures, a chart and a bill for each person", async () => {
    await page.goto(`/w/${slug}/bills`);
    await expect(page.getByRole("heading", { level: 1, name: "Bills" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Month", exact: true })).toBeVisible();
    const figures = page.getByRole("region", { name: "This month" });
    for (const label of ["Billed", "Collected", "Owed"])
      await expect(figures.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByTestId("bills-chart")).toBeVisible();
    await page.getByRole("button", { name: "Show as table" }).click();
    await expect(page.getByRole("columnheader", { name: "Billed" })).toBeVisible();
    await page.getByRole("button", { name: "Show as chart" }).click();
    await expectAccessible(page, "bills");
    await shot(page, info, "m7-bills");

    // A bill opens from the person's row: a sheet on a desktop, a page of its own on a phone.
    await page
      .getByRole("region", { name: "People" })
      .getByRole("button", { name: "Asha" })
      .first()
      .click();
    if (page.viewportSize() && page.viewportSize()!.width >= 768) {
      const sheet = page.getByRole("dialog", { name: "Asha" });
      await expect(sheet.getByText("Balance due")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Print" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    } else {
      await expect(page).toHaveURL(/\/bills\/[0-9a-f-]+/);
      await expect(page.getByRole("heading", { level: 1, name: "Asha" })).toBeVisible();
      await expect(page.getByText("Balance due")).toBeVisible();
    }
  });
});

// The second instance the config starts, to move a kitchen to.
const OTHER = `http://localhost:${process.env.E2E_OTHER_PORT ?? 18901}`;
const OTHER_TOKEN = "e2e-migration-token-0123456789abcdef";

test("a kitchen that counts meals moves to an instance that tracks money: the same meals, then prices to add", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 240_000));
  const slug = `willow-${info.project.name}-${Date.now().toString(36)}`;
  const w = `/api/w/${slug}`;
  const email = `move-${slug}@example.org`;
  await signIn(page, email, "Owner");
  const made = await page.request.post("/api/workspaces", {
    data: { slug, name: "Willow", alsoSupplier: true, moneyEnabled: false },
  });
  expect(made.status()).toBe(201);
  const seeded = await seedHome(page.request, slug, { prices: false });
  const person = await page.request.post(`${w}/people`, {
    data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
  });
  const asha = ((await person.json()) as { id: string }).id;
  const day = aWorkingDayThisMonth();
  const logged = await page.request.post(`${w}/log`, {
    data: {
      date: day,
      personId: asha,
      allConsumers: false,
      action: "Extra",
      serviceId: seeded.services[0],
      itemId: seeded.chapati,
      qty: 3,
    },
  });
  expect(logged.status()).toBe(201);
  const counts = async (request: typeof page.request, base: string) => {
    const res = await request.get(`${base}/statements?months=${firstOfMonth().slice(0, 7)}`);
    const rows = (await res.json()) as {
      counts: { meals: number; items: Record<string, number>; addOns: Record<string, number> };
    }[];
    return rows.map((r) => r.counts);
  };
  const before = await counts(page.request, w);
  expect(before[0]?.addOns[seeded.chapati]).toBe(3);

  await test.step("the old kitchen is moved to the other instance, and asked to track money there", async () => {
    await page.goto(`/w/${slug}/books/data`);
    await page
      .getByRole("group", { name: "Where to" })
      .getByRole("button", { name: "My own instance" })
      .click();
    await page.getByLabel("Address of your instance").fill(OTHER);
    await page.getByLabel("Token").fill(OTHER_TOKEN);
    await page.getByRole("checkbox", { name: /Track money in the new kitchen/ }).check();
    await page.getByRole("button", { name: "Check it first" }).click();
    await expect(page.getByText("It will work. Nothing has been changed.")).toBeVisible();
    await expectAccessible(page, "move preview");
    await page
      .getByRole("region", { name: "Move" })
      .getByRole("button", { name: "Move now" })
      .click();
    // Moving cannot be taken back, so it asks for the kitchen's address to be typed.
    const sure = page.getByRole("alertdialog", { name: "Move this kitchen?" });
    await sure.getByLabel(`Type ${slug} to confirm`).fill(slug);
    await sure.getByRole("button", { name: "Move now" }).click();
    // The old copy is now read-only and says where the kitchen went.
    await expect(page.getByText(/This kitchen has moved/)).toBeVisible();
    await expect(page.getByRole("link", { name: OTHER })).toBeVisible();
    await shot(page, info, "mm1-moved");
  });

  await test.step("there it tracks money, has the same meals and the same food, and asks only for prices", async () => {
    const there = await browser.newContext({ ...info.project.use, baseURL: OTHER });
    const p2 = await there.newPage();
    try {
      await signIn(p2, email, "Owner");
      const boot = await p2.request.get(`${w}/bootstrap`);
      expect(boot.status()).toBe(200);
      const b = (await boot.json()) as {
        workspace: { moneyEnabled: boolean };
        catalogue: { id: string; name: string }[];
        setup: { message: string }[];
      };
      expect(b.workspace.moneyEnabled).toBe(true);
      expect(b.catalogue.map((i) => i.name)).toEqual(["Veg", "Non Veg", "Chapati", "Bhakri"]);
      expect(b.setup.map((s) => s.message)).toContain(
        "Price 4 items to start billing: Veg, Non Veg, Chapati, Bhakri.",
      );

      // The Home asks for the one step left, Prices; everything before it is done.
      await p2.goto(`/w/${slug}?as=admin`);
      await expect(p2.getByRole("heading", { name: "Set up your kitchen" })).toBeVisible();
      await expect(p2.getByText("3 of 4 done")).toBeVisible();
      await expect(p2.getByRole("link", { name: /^Prices/ })).toBeVisible();

      const card = await p2.request.post(`${w}/rate-cards`, {
        data: {
          effectiveFrom: firstOfMonth(),
          monthlyFee: 0,
          prices: [
            { itemId: b.catalogue[0]?.id, serviceId: null, amount: 15000 },
            { itemId: b.catalogue[1]?.id, serviceId: null, amount: 17000 },
            { itemId: b.catalogue[2]?.id, serviceId: null, amount: 1500 },
            { itemId: b.catalogue[3]?.id, serviceId: null, amount: 3000 },
          ],
        },
      });
      expect(card.status()).toBe(201);
      await p2.goto(`/w/${slug}?as=admin`);
      await expect(p2.getByRole("heading", { name: "Set up your kitchen" })).toHaveCount(0);
      await expect(
        p2.getByRole("region", { name: "This month" }).getByText("Owed to the kitchen"),
      ).toBeVisible();
      await expectAccessible(p2, "home after the move");
      await shot(p2, info, "mm2-priced");
    } finally {
      await there.close();
    }
  });
});
