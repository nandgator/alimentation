import { expect, type Page, test } from "@playwright/test";
import { seedHome } from "./seed.ts";
import {
  aWorkingDayThisMonth,
  expectAccessible,
  firstOfMonth,
  shot,
  signIn,
  watchPage,
} from "./support.ts";

/** A kitchen with prices, a service or three, and one member, made through the API. */
async function kitchen(page: Page, tag: string, more: string[]) {
  const slug = `cat-${tag}-${Date.now().toString(36)}`;
  await signIn(page, `owner-${slug}@example.org`, "Owner");
  const made = await page.request.post("/api/workspaces", {
    data: { slug, name: `Willow ${tag}`, alsoSupplier: true },
  });
  expect(made.status()).toBe(201);
  const seeded = await seedHome(page.request, slug, { more });
  const person = await page.request.post(`/api/w/${slug}/people`, {
    data: { name: "Asha", role: "consumer", activeFrom: firstOfMonth() },
  });
  expect(person.status()).toBe(201);
  return { slug, seeded };
}

/** The service controls of a screen: anything that asks which service. */
const serviceControls = (p: Page) => [
  p.getByLabel("Service", { exact: true }),
  p.getByLabel("Applies to", { exact: true }),
  p.getByText("Services", { exact: true }),
  p.getByText(/^Offered in /),
  p.getByText("Different price in a service"),
];

async function expectNone(p: Page, where: string) {
  for (const c of serviceControls(p)) await expect(c, `${where}: a service control`).toHaveCount(0);
}

test("a kitchen with one service has no service control on any screen of its day", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const { slug } = await kitchen(page, `one-${info.project.name}`, []);

  await test.step("the log asks for nothing about a service, whatever is logged", async () => {
    await page.goto(`/w/${slug}/log`);
    await page.getByLabel("Date").fill(aWorkingDayThisMonth());
    for (const action of ["Leave", "Switch", "Extra", "Supplier Off"]) {
      await page.getByLabel("Change").selectOption(action);
      await expectNone(page, `log, ${action}`);
    }
    await page.getByLabel("Change").selectOption("Extra");
    await expect(page.getByLabel("Item")).toBeVisible();
    await expectAccessible(page, "log, one service");
    await shot(page, info, "c1-log");
  });

  await test.step("the daily page is one row to a day", async () => {
    await page.goto(`/w/${slug}/daily`);
    await expect(page.getByRole("columnheader", { name: "Meal" })).toBeVisible();
    await expect(page.locator("tr.service-row")).toHaveCount(0);
    await expect(page.locator("tr.day-row")).toHaveCount(0);
    await expectAccessible(page, "daily, one service");
  });

  await test.step("people, the menu and the prices ask for no service", async () => {
    await page.goto(`/w/${slug}/people`);
    await expect(page.getByRole("columnheader", { name: "Services" })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit Asha" }).click();
    await expectNone(page, "edit person");
    await page.keyboard.press("Escape");

    await page.goto(`/w/${slug}/menu`);
    await page.getByRole("button", { name: "New menu" }).click();
    const menu = page.getByRole("dialog", { name: "New menu" });
    await expect(menu.getByRole("columnheader", { name: "Meal" })).toBeVisible();
    await expectNone(page, "new menu");
    await expectAccessible(page, "new menu, one service");
    await page.keyboard.press("Escape");

    await page.goto(`/w/${slug}/prices`);
    await page.getByRole("button", { name: "New prices" }).click();
    await expectNone(page, "new prices");
    await expectAccessible(page, "new prices, one service");
    await page.keyboard.press("Escape");
  });

  expect(problems).toEqual([]);
});

test("a kitchen with three services has the controls, and each does what it says", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const { slug } = await kitchen(page, `three-${info.project.name}`, ["Dinner", "Breakfast"]);

  await test.step("the log asks which service where it matters, and a leave can be for one", async () => {
    await page.goto(`/w/${slug}/log`);
    const day = aWorkingDayThisMonth();
    await page.getByLabel("Date").fill(day);
    // Leave: the whole day, or one service.
    await expect(page.getByLabel("Applies to", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Applies to", { exact: true })).toHaveValue("");
    await page.getByLabel("Applies to", { exact: true }).selectOption({ label: "Dinner" });
    await expectAccessible(page, "log, three services");
    await shot(page, info, "c2-log");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Leave · Dinner" })).toBeVisible();
    // Extra: which service it is for, then what.
    await page.getByLabel("Change").selectOption("Extra");
    await expect(page.getByLabel("Service", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Service", { exact: true }).locator("option")).toHaveCount(3);
  });

  await test.step("the daily page has a row for each service under the day", async () => {
    await page.goto(`/w/${slug}/daily`);
    await expect(page.locator("tr.day-row").first()).toBeVisible();
    await expect(page.locator("tr.service-row").first()).toBeVisible();
    await expect(
      page.locator("tr.service-row").filter({ hasText: "Dinner" }).first(),
    ).toBeVisible();
    await expectAccessible(page, "daily, three services");
    await shot(page, info, "c3-daily");
  });

  await test.step("people can be given a service each, from a date", async () => {
    await page.goto(`/w/${slug}/people`);
    await expect(page.getByRole("columnheader", { name: "Services" })).toBeVisible();
    await page.getByRole("button", { name: "Edit Asha" }).click();
    const dlg = page.getByRole("dialog", { name: "Edit person" });
    await expect(dlg.getByText("Services", { exact: true })).toBeVisible();
    await expectAccessible(page, "edit person, three services");
    await dlg.getByRole("checkbox", { name: "Breakfast" }).uncheck();
    await dlg.getByRole("button", { name: "Save" }).click();
    const row = page.getByRole("row", { name: /Asha/ });
    await expect(row).toContainText("Lunch, Dinner");
    await expect(row).not.toContainText("Breakfast");
  });

  await test.step("the menu is a grid of days by services, with what each offers", async () => {
    await page.goto(`/w/${slug}/menu`);
    await page.getByRole("button", { name: "New menu" }).click();
    const menu = page.getByRole("dialog", { name: "New menu" });
    for (const sv of ["Lunch", "Dinner", "Breakfast"])
      await expect(menu.getByRole("columnheader", { name: sv })).toBeVisible();
    await expect(menu.getByLabel("Mon, Dinner")).toHaveValue(/.+/);
    // Taking every service off a working day is said aloud and cannot be sent.
    for (const sv of ["Lunch", "Dinner", "Breakfast"])
      await menu.getByLabel(`Tue, ${sv}`).selectOption({ label: "Not served" });
    await expect(menu.getByText(/Nothing is served on Tue/)).toBeVisible();
    await expect(menu.getByRole("button", { name: "Add menu" })).toBeDisabled();
    await menu.getByLabel("Tue, Dinner").selectOption({ label: "Veg" });
    await expect(menu.getByRole("button", { name: "Add menu" })).toBeEnabled();
    await expect(menu.getByText("Offered in Dinner")).toBeVisible();
    await expectAccessible(page, "new menu, three services");
    await shot(page, info, "c4-menu");
    await page.keyboard.press("Escape");
  });

  await test.step("a price can differ in one service", async () => {
    await page.goto(`/w/${slug}/prices`);
    await page.getByRole("button", { name: "New prices" }).click();
    const dlg = page.getByRole("dialog", { name: "New prices" });
    await dlg.getByText("Different price in a service").first().click();
    await dlg.getByLabel("Veg in Dinner (₹)", { exact: true }).fill("180");
    // From today: the month's first day already has its prices.
    await expectAccessible(page, "new prices, three services");
    await dlg.getByRole("button", { name: "Add prices" }).click();
    await expect(page.getByRole("cell", { name: "Dinner", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "₹180" })).toBeVisible();
  });

  expect(problems).toEqual([]);
});

test("a new kitchen starts from a home lunch, a mess or nothing, set up with ordinary calls", async ({
  page,
}, info) => {
  const stamp = Date.now().toString(36);
  await signIn(page, `starter-${info.project.name}-${stamp}@example.org`, "Owner");

  const start = async (slug: string, name: string, choice: RegExp) => {
    await page.goto("/app");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Address").fill(slug);
    await page.getByLabel(choice).check();
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForURL(`**/w/${slug}`);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  };
  const boot = async (slug: string) =>
    (await (await page.request.get(`/api/w/${slug}/bootstrap`)).json()) as {
      services: { name: string }[];
      catalogue: { name: string }[];
      menu: { days: Record<string, Record<string, string>> } | null;
      setup: { message: string }[];
    };

  await test.step("home lunch is what a kitchen starts from if nothing is chosen", async () => {
    const slug = `home-${info.project.name}-${stamp}`;
    await start(slug, "Willow Home", /^Home lunch/);
    const b = await boot(slug);
    expect(b.services.map((s) => s.name)).toEqual(["Lunch"]);
    expect(b.catalogue.map((i) => i.name)).toEqual(["Veg", "Non Veg", "Chapati", "Bhakri"]);
    expect(Object.keys(b.menu?.days ?? {})).toHaveLength(1);
    expect(b.setup.map((s) => s.message)).toContain(
      "Price 4 items to start billing: Veg, Non Veg, Chapati, Bhakri.",
    );
    // One next step at a time: the people come before the prices.
    await expect(page.getByText("Add the people you feed")).toBeVisible();
    await expect(page.getByText(/Price 4 items to start billing/)).toHaveCount(0);
    await expectAccessible(page, "a home lunch kitchen");
  });

  await test.step("a mess has breakfast, lunch and dinner", async () => {
    const slug = `mess-${info.project.name}-${stamp}`;
    await start(slug, "Maple Mess", /^Mess/);
    const b = await boot(slug);
    expect(b.services.map((s) => s.name)).toEqual(["Breakfast", "Lunch", "Dinner"]);
    expect(b.catalogue.map((i) => i.name)).toEqual(["Breakfast", "Thali", "Khichdi", "Curd"]);
    expect(Object.keys(b.menu?.days ?? {})).toHaveLength(3);
    await page.goto(`/w/${slug}/catalogue`);
    await expect(page.getByRole("cell", { name: "Dinner", exact: true })).toBeVisible();
    await expectAccessible(page, "catalogue of a mess");
    await shot(page, info, "c5-mess-catalogue");
  });

  await test.step("blank has nothing, and says where to begin", async () => {
    const slug = `blank-${info.project.name}-${stamp}`;
    await start(slug, "Blank Place", /^Blank/);
    const b = await boot(slug);
    expect(b.services).toEqual([]);
    expect(b.catalogue).toEqual([]);
    await expect(
      page.getByText("Add what you serve, then the menu, to start counting meals."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add what you serve" })).toBeVisible();
  });
});

test("a rename shows everywhere and an item in use cannot be retired out from under the menu", async ({
  page,
}, info) => {
  const { slug } = await kitchen(page, `ren-${info.project.name}`, []);
  await page.goto(`/w/${slug}/catalogue`);
  await page.getByRole("button", { name: "Rename Veg", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Rename" });
  await dlg.getByLabel("Name").fill("Dal thali");
  await expectAccessible(page, "rename");
  await dlg.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("cell", { name: "Dal thali", exact: true })).toBeVisible();
  await page.goto(`/w/${slug}/menu`);
  await expect(page.getByRole("cell", { name: "Dal thali" }).first()).toBeVisible();

  // The menu in force offers it, so retiring it is refused, in words.
  await page.goto(`/w/${slug}/catalogue`);
  await page.getByRole("button", { name: "Retire Dal thali" }).click();
  const retire = page.getByRole("dialog", { name: "Retire" });
  await expectAccessible(page, "retire");
  await retire.getByRole("button", { name: "Retire Dal thali" }).click();
  await expect(retire.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("cell", { name: /^In use$/ }).first()).toBeVisible();
});
