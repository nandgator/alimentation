import { expect, type Locator, type Page, test } from "@playwright/test";
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
  p.getByLabel("Meal", { exact: true }),
  p.getByLabel("Meals", { exact: true }),
  p.getByText("Which meal?", { exact: true }),
  p.getByText("Which meals?", { exact: true }),
  p.getByText("Services", { exact: true }),
  p.getByText(/^Offered in /),
  p.getByText("Different price in a service"),
];

async function expectNone(p: Page, where: string) {
  for (const c of serviceControls(p)) await expect(c, `${where}: a service control`).toHaveCount(0);
}

/** One person on the list, whether it is a table row (wide) or an item of a list (phone). */
const entry = (page: Page, name: string | RegExp) =>
  page
    .getByRole("main")
    .getByRole("row", { name })
    .or(page.getByRole("main").getByRole("listitem").filter({ hasText: name }));

/** A row's menu: "Actions for Asha", then one of its items. */
async function rowAction(page: Page, row: string, item: string) {
  await page.getByRole("button", { name: `Actions for ${row}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Closes a form dialog that may have been changed: asks to discard when it is asked. */
async function closeDialog(page: Page, dlg: Locator) {
  await page.keyboard.press("Escape");
  const ask = page.getByRole("alertdialog", { name: "Discard changes?" });
  if (await ask.isVisible()) await ask.getByRole("button", { name: "Discard" }).click();
  await expect(dlg).toBeHidden();
}

/** Opens a log form from the Meals screen and picks the person it is for. */
async function openLog(page: Page, slug: string, button: string, who: string | null) {
  await page.goto(`/w/${slug}/meals`);
  await page.getByRole("button", { name: button, exact: true }).click();
  // The form is titled for what is done: the button that marks the kitchen off opens "Kitchen off".
  const dlg = page.getByRole("dialog", {
    name: button === "Mark the kitchen off" ? "Kitchen off" : button,
  });
  if (who) await dlg.getByLabel("Who is it for?").selectOption({ label: who });
  return dlg;
}

test("a kitchen with one service has no service control on any screen of its day", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const { slug } = await kitchen(page, `one-${info.project.name}`, []);

  await test.step("the log asks for nothing about a service, whatever is logged", async () => {
    for (const [button, who] of [
      ["Skip a meal", "Asha"],
      ["Change a meal", "Asha"],
      ["Add an extra", "Asha"],
      ["Mark the kitchen off", null],
    ] as const) {
      const dlg = await openLog(page, slug, button, who);
      await expect(dlg.getByLabel("Which day?")).toBeVisible();
      await expectNone(page, `log, ${button}`);
      if (button === "Add an extra") {
        await expect(dlg.getByLabel("What do you want?")).toBeVisible();
        await expectAccessible(page, "log, one service");
        await shot(page, info, "c1-log");
      }
      await closeDialog(page, dlg);
    }
  });

  await test.step("Today is one list, with no tab for a meal", async () => {
    await page.goto(`/w/${slug}/today?date=${aWorkingDayThisMonth()}`);
    await expect(page.getByText(/^On the menu:/)).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Meals" })).toHaveCount(0);
    await expectNone(page, "today, one service");
    await expectAccessible(page, "today, one service");
  });

  await test.step("people, the menu and the prices ask for no service", async () => {
    await page.goto(`/w/${slug}/people`);
    await expect(entry(page, /Asha/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Eats" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Services" })).toHaveCount(0);
    await rowAction(page, "Asha", "Edit");
    const person = page.getByRole("dialog", { name: "Edit Asha" });
    await expect(person).toBeVisible();
    await expectNone(page, "edit person");
    await closeDialog(page, person);

    await page.goto(`/w/${slug}/setup/menu`);
    await page.getByRole("button", { name: "New menu" }).click();
    const menu = page.getByRole("dialog", { name: "New menu" });
    await expect(menu.getByLabel("Menu on Mon")).toBeVisible();
    await expectNone(page, "new menu");
    await expectAccessible(page, "new menu, one service");
    await closeDialog(page, menu);

    await page.goto(`/w/${slug}/setup/prices`);
    await page.getByRole("button", { name: "New prices" }).first().click();
    const prices = page.getByRole("dialog", { name: "New prices" });
    await expect(prices.getByLabel("Veg, per plate", { exact: true })).toBeVisible();
    await expectNone(page, "new prices");
    await expectAccessible(page, "new prices, one service");
    await closeDialog(page, prices);
  });

  expect(problems).toEqual([]);
});

test("a kitchen with three services has the controls, and each does what it says", async ({
  page,
}, info) => {
  const problems = watchPage(page);
  const { slug } = await kitchen(page, `three-${info.project.name}`, ["Dinner", "Breakfast"]);

  await test.step("the log asks which meal where it matters, and a skip can be for one", async () => {
    const dlg = await openLog(page, slug, "Skip a meal", "Asha");
    // The whole day, or one meal.
    const meals = dlg.getByRole("group", { name: "Meals" });
    await expect(meals).toBeVisible();
    await expect(meals.getByRole("button", { name: "Whole day" })).toBeVisible();
    await meals.getByRole("button", { name: "Dinner" }).click();
    await expect(meals.getByRole("button", { name: "Dinner" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expectAccessible(page, "log, three services");
    await shot(page, info, "c2-log");
    await dlg.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole("main").getByText("Skip · Dinner")).toBeVisible();
    // Extra: which meal it is for, then what.
    await page.getByRole("button", { name: "Add an extra", exact: true }).click();
    const extra = page.getByRole("dialog", { name: "Add an extra" });
    await extra.getByLabel("Who is it for?").selectOption({ label: "Asha" });
    const meal = extra.getByRole("group", { name: "Meal", exact: true });
    await expect(meal).toBeVisible();
    await expect(meal.getByRole("button")).toHaveCount(3);
    await closeDialog(page, extra);
  });

  await test.step("Today has a tab for each meal", async () => {
    await page.goto(`/w/${slug}/today?date=${aWorkingDayThisMonth()}`);
    const tabs = page.getByRole("tablist", { name: "Meals" });
    for (const sv of ["Lunch", "Dinner", "Breakfast"])
      await expect(tabs.getByRole("tab", { name: sv })).toBeVisible();
    await tabs.getByRole("tab", { name: "Dinner" }).click();
    await expect(page.getByText(/^On the menu:/)).toBeVisible();
    await expectAccessible(page, "today, three services");
    await shot(page, info, "c3-daily");
  });

  await test.step("people can be given a service each, from a date", async () => {
    await page.goto(`/w/${slug}/people`);
    if (info.project.name !== "phone")
      await expect(page.getByRole("columnheader", { name: "Eats" })).toBeVisible();
    await expect(entry(page, /Asha/)).toContainText("Lunch, Dinner, Breakfast");
    await rowAction(page, "Asha", "Edit");
    const dlg = page.getByRole("dialog", { name: "Edit Asha" });
    await expect(dlg.getByText("Services", { exact: true })).toBeVisible();
    await expectAccessible(page, "edit person, three services");
    await dlg.getByRole("checkbox", { name: "Breakfast" }).uncheck();
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toBeHidden();
    const row = entry(page, /Asha/);
    await expect(row).toContainText("Lunch, Dinner");
    await expect(row).not.toContainText("Breakfast");
  });

  await test.step("the menu is a grid of days by services, with what each offers", async () => {
    await page.goto(`/w/${slug}/setup/menu`);
    await page.getByRole("button", { name: "New menu" }).click();
    const menu = page.getByRole("dialog", { name: "New menu" });
    for (const sv of ["Lunch", "Dinner", "Breakfast"])
      await expect(menu.getByLabel(`Mon, ${sv}`)).toBeVisible();
    if (info.project.name !== "phone")
      for (const sv of ["Lunch", "Dinner", "Breakfast"])
        await expect(menu.getByRole("columnheader", { name: sv })).toBeVisible();
    await expect(menu.getByLabel("Mon, Dinner")).toHaveValue(/.+/);
    // Taking every service off a working day is said aloud and cannot be sent.
    for (const sv of ["Lunch", "Dinner", "Breakfast"])
      await menu.getByLabel(`Tue, ${sv}`).selectOption({ label: "Not served" });
    await expect(menu.getByText(/Nothing is served on Tue/)).toBeVisible();
    await menu.getByRole("button", { name: "Add menu" }).click();
    await expect(menu).toBeVisible();
    // Said twice once the send is refused: the live note beside the grid and the refusal at the top.
    await expect(menu.getByRole("alert")).toContainText(/Nothing is served on Tue/);
    await expect(menu.getByRole("status")).toContainText(/Nothing is served on Tue/);
    const sent = (await (await page.request.get(`/api/w/${slug}/menus`)).json()) as unknown[];
    expect(sent, "nothing was sent").toHaveLength(1);
    await menu.getByLabel("Tue, Dinner").selectOption({ label: "Veg" });
    await expect(menu.getByText(/Nothing is served on Tue/)).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Add menu" })).toBeEnabled();
    await expect(menu.getByText("Offered in Dinner")).toBeVisible();
    await expectAccessible(page, "new menu, three services");
    await shot(page, info, "c4-menu");
    await closeDialog(page, menu);
  });

  await test.step("a price can differ in one service", async () => {
    await page.goto(`/w/${slug}/setup/prices`);
    await page.getByRole("button", { name: "New prices" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New prices" });
    await dlg.getByText("Different price in a service").first().click();
    await dlg.getByLabel("Veg in Dinner", { exact: true }).fill("180");
    // From today: the month's first day already has its prices.
    await expectAccessible(page, "new prices, three services");
    await dlg.getByRole("button", { name: "Add prices" }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText("Dinner", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^₹180(\.00)?$/).first()).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
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
    // The checklist says what is left, the people first; the server's own wording is not quoted.
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toBeVisible();
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
    await page.goto(`/w/${slug}/setup/items`);
    await expect(page.getByRole("main").getByText("Dinner", { exact: true }).first()).toBeVisible();
    await expectAccessible(page, "what a mess serves");
    await shot(page, info, "c5-mess-catalogue");
  });

  await test.step("blank has nothing, and says where to begin", async () => {
    const slug = `blank-${info.project.name}-${stamp}`;
    await start(slug, "Blank Place", /^Blank/);
    const b = await boot(slug);
    expect(b.services).toEqual([]);
    expect(b.catalogue).toEqual([]);
    await expect(page.getByRole("heading", { name: "Set up your kitchen" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^What you serve/ })).toBeVisible();
    await page.goto(`/w/${slug}/setup/menu`);
    await expect(page.getByText("Add what you serve first")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to What you serve" })).toBeVisible();
  });
});

test("a rename shows everywhere and an item in use cannot be retired out from under the menu", async ({
  page,
}, info) => {
  const { slug } = await kitchen(page, `ren-${info.project.name}`, []);
  await page.goto(`/w/${slug}/setup/items`);
  await rowAction(page, "Veg", "Rename");
  const dlg = page.getByRole("dialog", { name: "Rename Veg" });
  await dlg.getByLabel("Name").fill("Dal thali");
  await expectAccessible(page, "rename");
  await dlg.getByRole("button", { name: "Rename" }).click();
  await expect(dlg).toBeHidden();
  await expect(
    page.getByRole("main").getByText("Dal thali", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(`/w/${slug}/setup/menu`);
  await expect(page.getByRole("main").getByText("Dal thali").first()).toBeVisible();

  // The menu in force offers it, so retiring it is refused, in words.
  await page.goto(`/w/${slug}/setup/items`);
  await rowAction(page, "Dal thali", "Retire");
  const retire = page.getByRole("alertdialog", { name: "Retire Dal thali?" });
  await expectAccessible(page, "retire");
  await retire.getByRole("checkbox", { name: /I understand this name stays taken/ }).check();
  await retire.getByRole("button", { name: "Retire Dal thali" }).click();
  await expect(retire.getByRole("alert")).toBeVisible();
  // While the dialog is open the page behind it is hidden from assistive technology; closed, it is read again.
  await page.keyboard.press("Escape");
  await expect(retire).toBeHidden();
  await expect(page.getByRole("main").getByText("In use", { exact: true }).first()).toBeVisible();
});
