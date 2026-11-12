import { expect, type Page, test } from "@playwright/test";
import { type Seeded, seedHome } from "./seed.ts";
import { aWorkingDayThisMonth, expectAccessible, firstOfMonth, shot, signIn } from "./support.ts";

/** Opens a screen from the menu, behind More on a phone. */
async function go(p: Page, name: string | RegExp) {
  const nav = p.getByRole("navigation", { name: "Sections" });
  const link = nav.getByRole("link", { name });
  // The menu is drawn once the kitchen has been read: wait for it before asking what is in it.
  await nav.getByRole("link").first().waitFor();
  if (!(await link.isVisible())) await nav.getByRole("button", { name: "More" }).click();
  await link.click();
}

/** Every name in the menu, whether it is shown or sits behind More. */
async function menuNames(p: Page): Promise<string[]> {
  const nav = p.getByRole("navigation", { name: "Sections" });
  const more = nav.getByRole("button", { name: "More" });
  if (await more.isVisible()) await more.click();
  return (await nav.getByRole("link").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
}

test("a kitchen without money: made with a choice, and every screen counts meals and shows no money", async ({
  page,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 180_000));
  const slug = `meals-${info.project.name}-${Date.now().toString(36)}`;
  const w = `/api/w/${slug}`;
  await signIn(page, `meals-${slug}@example.org`, "Owner");
  let seeded: Seeded | undefined;

  await test.step("the choice is offered, in plain words, with its consequence", async () => {
    await expect(page.getByRole("heading", { name: "Your kitchens" })).toBeVisible();
    const track = page.getByLabel("Track money in this kitchen");
    await expect(track).toBeChecked();
    await expect(page.getByText("It cannot be changed later.")).toBeVisible();
    await expectAccessible(page, "start a kitchen");
    await track.uncheck();
    await expect(page.getByText(/There are no prices, bills or payments\./)).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Plain Mess");
    await page.getByLabel("Address").fill(slug);
    await page.getByLabel(/^Blank/).check();
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(`**/w/${slug}`);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  await test.step("the menu says what is missing, and no screen about money is in it", async () => {
    await expect(
      page.getByText("Add what you serve, then the menu, to start counting meals."),
    ).toBeVisible();
    await expect(page.getByText("Add prices to start billing.")).toHaveCount(0);
    const names = await menuNames(page);
    for (const gone of ["Payments", "Prices", "Settlements"]) expect(names).not.toContain(gone);
    for (const kept of ["Dashboard", "Daily", "My log", "People", "Menu", "Rules", "Holidays"])
      expect(names).toContain(kept);
    await expectAccessible(page, "new kitchen without money");
    await shot(page, info, "m1-new-kitchen");
  });

  await test.step("what is served has no prices, and the menu is set on its own screen, for the working days", async () => {
    seeded = await seedHome(page.request, slug, { menu: false });
    // The items were added behind the page's back, so it reads the kitchen again.
    await page.goto(`/w/${slug}`);
    await go(page, "Catalogue");
    await expect(page.getByRole("cell", { name: "Non Veg", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Price" })).toHaveCount(0);
    await expect(page.getByText("Not priced")).toHaveCount(0);
    expect(seeded.services).toHaveLength(1);
    await go(page, "Menu");
    await page.getByRole("button", { name: "New menu" }).click();
    const dlg = page.getByRole("dialog", { name: "New menu" });
    await dlg.getByLabel("Applies from").fill(firstOfMonth());
    for (const [d, m] of [
      ["Mon", "Veg"],
      ["Tue", "Veg"],
      ["Wed", "Non Veg"],
      ["Thu", "Veg"],
      ["Fri", "Non Veg"],
    ])
      await dlg.getByLabel(`Menu on ${d}`).selectOption({ label: m! });
    await dlg.getByLabel("Chapati").check();
    await expect(dlg.getByLabel("Menu on Sat")).toHaveCount(0);
    await expectAccessible(page, "menu dialog");
    await dlg.getByRole("button", { name: "Add menu" }).click();
    await expect(page.getByRole("cell", { name: "Non Veg" }).first()).toBeVisible();
    await expect(
      page.getByText("Add what you serve, then the menu, to start counting meals."),
    ).toHaveCount(0);
    await shot(page, info, "m2-menu");
  });

  await test.step("the rules leave out what is about money", async () => {
    await go(page, "Rules");
    await expect(page.getByRole("heading", { name: "Rules", exact: true })).toBeVisible();
    await expect(page.getByText("Meals on Mon, Tue, Wed, Thu, Fri.")).toBeVisible();
    for (const money of [/leave day is charged/i, /monthly fee/i, /payment/i])
      await expect(page.getByText(money)).toHaveCount(0);
    await page.getByRole("button", { name: "Change rules" }).click();
    const dlg = page.getByRole("dialog", { name: "Change the rules" });
    for (const label of [
      "Charge on a leave day (%)",
      "Monthly fee applies from",
      "Payments",
      "Rate cards may start",
    ])
      await expect(dlg.getByLabel(label)).toHaveCount(0);
    await expect(dlg.getByLabel("Holidays that cancel a meal")).toBeVisible();
    await expectAccessible(page, "rules dialog");
    await page.keyboard.press("Escape");
    await shot(page, info, "m3-rules");
  });

  await test.step("people and meals are counted, and nothing is priced", async () => {
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
        serviceId: seeded?.services[0],
        itemId: seeded?.chapati,
        qty: 3,
      },
    });
    expect(logged.status()).toBe(201);
    // The people were added behind the page's back, so it reads the kitchen again.
    await page.goto(`/w/${slug}`);
    await go(page, "Dashboard");
    await expect(page.locator(".tile", { hasText: "Meals" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Chapati" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("₹");
    await expectAccessible(page, "dashboard without money");
    await shot(page, info, "m4-dashboard");

    await go(page, "Daily");
    await expect(page.getByRole("columnheader", { name: "Meal" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("₹");
    await expectAccessible(page, "daily without money");
    await shot(page, info, "m5-daily");

    await go(page, "Month close");
    await expect(page.getByRole("columnheader", { name: "Billed" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Live total" })).toHaveCount(0);
    await expectAccessible(page, "month close without money");
    await shot(page, info, "m6-close");
  });

  await test.step("an address for a screen about money is not there, and the server says why", async () => {
    await page.goto(`/w/${slug}/payments`);
    await expect(page.getByText("There is nothing at this address for your role.")).toBeVisible();
    await page.goto(`/w/${slug}/prices`);
    await expect(page.getByText("There is nothing at this address for your role.")).toBeVisible();
    const res = await page.request.get(`${w}/rate-cards`);
    expect(res.status()).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "money_not_tracked",
    );
  });

  await test.step("Your data says what a move does with money, and offers no claims scope to a helper", async () => {
    await page.goto(`/w/${slug}`);
    await go(page, "Your data");
    await page.getByText("AI agents").click();
    await expect(page.getByLabel(/May add and withdraw entries/)).toBeVisible();
    await expect(page.getByLabel(/May say that a payment was made/)).toHaveCount(0);
    await page.getByRole("tab", { name: "My own instance" }).click();
    await expect(page.getByLabel(/Track money in the new kitchen/)).toBeVisible();
    await expectAccessible(page, "your data without money");
    await shot(page, info, "m7-your-data");
  });
});

test("a kitchen that tracks money still shows its prices, so the two are told apart", async ({
  page,
}) => {
  const slug = `money-${Date.now().toString(36)}`;
  await signIn(page, `money-${slug}@example.org`, "Owner");
  await page.getByLabel("Name", { exact: true }).fill("Priced Mess");
  await page.getByLabel("Address").fill(slug);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(`**/w/${slug}`);
  // It starts from a home lunch, so what it serves is there already and only the prices are missing.
  await expect(page.getByText(/^Price 4 items to start billing: /)).toBeVisible();
  const names = await menuNames(page);
  for (const kept of ["Payments", "Prices", "Settlements", "Menu", "Rates & rules"])
    expect(names).toContain(kept);
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
    await page.goto(`/w/${slug}/data`);
    await page.getByRole("tab", { name: "My own instance" }).click();
    await page.getByLabel("Address of your instance").fill(OTHER);
    await page.getByLabel("Token").fill(OTHER_TOKEN);
    await page.getByLabel(/Track money in the new kitchen/).check();
    await page.getByRole("button", { name: "Check it first" }).click();
    await expect(page.getByText("It will work. Nothing has been changed.")).toBeVisible();
    await expectAccessible(page, "move preview");
    await page
      .getByRole("region", { name: "Move" })
      .getByLabel(`Type ${slug} to confirm`)
      .fill(slug);
    await page.getByRole("button", { name: "Move now" }).click();
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
        catalogue: { name: string }[];
        setup: { message: string }[];
      };
      expect(b.workspace.moneyEnabled).toBe(true);
      expect(b.catalogue.map((i) => i.name)).toEqual(["Veg", "Non Veg", "Chapati", "Bhakri"]);
      expect(b.setup.map((s) => s.message)).toContain(
        "Price 4 items to start billing: Veg, Non Veg, Chapati, Bhakri.",
      );

      await p2.goto(`/w/${slug}`);
      await expect(p2.getByText(/Price 4 items to start billing/)).toBeVisible();
      await go(p2, "Prices");
      await p2.getByRole("button", { name: "New prices" }).click();
      const dlg = p2.getByRole("dialog", { name: "New prices" });
      await dlg.getByLabel("Applies from").fill(firstOfMonth());
      for (const [label, rupees] of [
        ["Veg (₹ per plate)", "150"],
        ["Non Veg (₹ per plate)", "170"],
        ["Chapati (₹ per piece)", "15"],
        ["Bhakri (₹ per piece)", "30"],
      ] as const)
        await dlg.getByLabel(label, { exact: true }).fill(rupees);
      await dlg.getByRole("button", { name: "Add prices" }).click();
      await expect(p2.getByRole("cell", { name: "₹150" })).toBeVisible();
      await go(p2, "Dashboard");
      await expect(
        p2.locator(".tile", { has: p2.locator(".k", { hasText: /^Bill$/ }) }),
      ).toBeVisible();
      await expectAccessible(p2, "dashboard after the move");
      await shot(p2, info, "mm2-priced");
    } finally {
      await there.close();
    }
  });
});
