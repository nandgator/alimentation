import { expect, type Locator, type Page, test } from "@playwright/test";
import pg from "pg";
import {
  aWorkingDayThisMonth,
  expectAccessible,
  firstOfMonth,
  shot,
  signIn,
  watchPage,
} from "./support.ts";

const ADMIN = process.env.ALIMENTATION_TEST_PG ?? "postgres://pgadmin@127.0.0.1:5432/postgres";

/** Goes to a section. On a phone the less-used ones sit behind “More”, a sheet of links. */
async function go(p: Page, name: string | RegExp) {
  const nav = p.getByRole("navigation", { name: "Sections", exact: true });
  await expect(nav.getByRole("link").first()).toBeVisible();
  const link = nav.getByRole("link", { name, exact: typeof name === "string" });
  if (await link.isVisible()) return link.click();
  // A toast sits over the sheet on a phone, and stays while the pointer is over it: close what is showing first.
  for (const close of await p.getByRole("button", { name: "Close toast" }).all()) {
    await close.click({ timeout: 2000 }).catch(() => undefined);
  }
  await nav.getByRole("button", { name: "More" }).click();
  await p
    .getByRole("dialog", { name: "More" })
    .getByRole("link", { name, exact: typeof name === "string" })
    .click();
}
/** A tab of Setup or Books: a link in the row under the page's title. */
const tab = (p: Page, name: string) =>
  p
    .getByRole("navigation", { name: /^(Setup|Books)$/ })
    .getByRole("link", { name, exact: true })
    .or(p.getByRole("tab", { name, exact: true }))
    .first();
/**
 * One thing on a list, whether it is a row of a table (wide) or an item of a list (phone). A string is the exact
 * name of the thing; a pattern is matched against the whole of it.
 */
const entry = (p: Page, name: string | RegExp) =>
  p
    .getByRole("main")
    .getByRole("row", { name: typeof name === "string" ? new RegExp(`^${name}\\b`) : name })
    .or(
      p
        .getByRole("main")
        .getByRole("listitem")
        .filter(
          typeof name === "string"
            ? { has: p.getByText(name, { exact: true }) }
            : { hasText: name },
        ),
    );
/** A day from the calendar a date field opens, in the month the field is showing or the ones before it. */
async function pickDay(p: Page, field: Locator, iso: string) {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const month = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long" });
  await field.click();
  const day = p.getByRole("button", { name: new RegExp(`${month} ${d}(st|nd|rd|th), ${y}`) });
  for (let back = 0; back < 3; back++) {
    if (await day.isVisible({ timeout: 1500 }).catch(() => false)) break;
    await p.getByRole("button", { name: /previous month/i }).click();
  }
  await day.click();
}
/** The kitchen's own date, as the kitchen says it. */
async function kitchenToday(p: Page, slug: string): Promise<string> {
  const boot = await (await p.request.get(`/api/w/${slug}/bootstrap`)).json();
  return boot.today as string;
}
/** Switches the person's view of the kitchen in the account menu: a menu on a wide screen, a sheet on a phone. */
async function viewAs(p: Page, role: "Admin" | "Cook") {
  const phone = (p.viewportSize()?.width ?? 0) < 1024;
  if (phone) {
    await p.getByRole("button", { name: /^Account/ }).click();
    await p.getByRole("dialog", { name: "Account" }).getByRole("radio", { name: role }).click();
  } else {
    await p.getByRole("button", { name: /Owner/ }).click();
    await p.getByRole("menuitemradio", { name: role }).click();
  }
  await expect(p.getByText(`Now viewing as ${role}`)).toBeVisible();
}
/** Opens the folded bill of the month on a phone (it is open on a wide screen). */
async function openThisMonth(p: Page) {
  const fold = p.getByRole("button", { name: /^This month/ });
  if ((await fold.getAttribute("aria-expanded")) === "false") await fold.click();
}

test("a kitchen from its first day to its last: set up, use, go offline, move, and delete", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 240_000));
  const slug = `e2e-${info.project.name}-${Date.now().toString(36)}`;
  const external = `ext_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  const member = await browser.newContext({ ...info.project.use });
  const jovial = await member.newPage();
  let inviteLink = "";
  const seen = [watchPage(page), watchPage(jovial)];
  const wide = () => (page.viewportSize()?.width ?? 0) >= 1024;

  try {
    await test.step("the owner starts a kitchen", async () => {
      await signIn(page, "owner@example.org", "Owner");
      await expect(page.getByRole("heading", { name: "Your kitchens" })).toBeVisible();
      await page.getByLabel("Name", { exact: true }).fill("Test Kitchen");
      await page.getByLabel("Address").fill(slug);
      // A kitchen can start from a home lunch, a mess or nothing; this one starts from nothing, and is built by hand.
      await expect(page.getByLabel(/^Home lunch/)).toBeChecked();
      await page.getByLabel(/^Blank/).check();
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(`**/w/${slug}`);
      await expect(page.getByRole("heading", { name: "Test Kitchen", level: 1 })).toBeVisible();
      // The first screen is a checklist of the four steps, with the first of them still to do.
      await expect(page.getByText("Set up your kitchen")).toBeVisible();
      await expect(page.getByText("0 of 4 done")).toBeVisible();
      for (const step of ["People", "What you serve", "Menu", "Prices"])
        await expect(
          page.getByRole("main").getByRole("link", { name: new RegExp(`^${step}`) }),
        ).toBeVisible();
      await expect(page.getByText("Add the meals and extras you cook.")).toBeVisible();
      await expectAccessible(page, "new kitchen");
      // One menu: a column beside the page on a wide screen, and a bar at the bottom on a phone, with the rest
      // behind More. Payments and Bills wait for prices.
      const menu = page.getByRole("navigation", { name: "Sections", exact: true });
      for (const name of ["Home", "Today", "People"])
        await expect(menu.getByRole("link", { name })).toBeVisible();
      await expect(menu.getByRole("link", { name: /^(Payments|Bills)/ })).toHaveCount(0);
      if (wide()) {
        for (const name of ["Setup", "Books"])
          await expect(menu.getByRole("link", { name })).toBeVisible();
        await expect(menu.getByRole("button", { name: "More" })).toHaveCount(0);
      } else {
        await expect(menu.getByRole("button", { name: "More" })).toBeVisible();
      }
      await shot(page, info, "1-new-kitchen");
    });

    await test.step("what is served, the menu and the prices are set once, by the admin, each on its own screen", async () => {
      await go(page, "Setup");
      await expect(page).toHaveURL(/\/setup\/items$/);
      // A kitchen made by hand has no service yet: the first is Lunch.
      await page.getByRole("button", { name: "Add a service" }).first().click();
      const svc = page.getByRole("dialog", { name: "Add a service" });
      await svc.getByLabel("Name").fill("Lunch");
      await svc.getByRole("button", { name: "Add service" }).click();
      await expect(entry(page, "Lunch")).toBeVisible();
      for (const [kind, name, unit] of [
        ["Meal", "Veg", "plate"],
        ["Meal", "Non Veg", "plate"],
        ["Add-on", "Chapati", "piece"],
        ["Add-on", "Bhakri", "piece"],
      ] as const) {
        await page.getByRole("button", { name: "Add an item" }).first().click();
        const add = page.getByRole("dialog", { name: "Add an item" });
        await add.getByRole("radio", { name: new RegExp(`^${kind}`) }).check();
        await add.getByLabel("Name", { exact: true }).fill(name);
        await add.getByLabel("Counted in").fill(unit);
        if (name === "Veg") await expectAccessible(page, "add an item");
        await add.getByRole("button", { name: "Add item" }).click();
        await expect(entry(page, name)).toBeVisible();
      }
      await expectAccessible(page, "what you serve");
      await shot(page, info, "1b-items");

      await tab(page, "Menu").click();
      await page.getByRole("button", { name: "New menu" }).first().click();
      const menuDlg = page.getByRole("dialog", { name: "New menu" });
      // The first menu of a kitchen starts with the month.
      for (const [d, m] of [
        ["Mon", "Veg"],
        ["Tue", "Veg"],
        ["Wed", "Non Veg"],
        ["Thu", "Veg"],
        ["Fri", "Non Veg"],
      ])
        await menuDlg.getByLabel(`Menu on ${d}`).selectOption({ label: m! });
      // One service: no service anywhere in the form.
      await expect(menuDlg.getByText("Offered in")).toHaveCount(0);
      for (const item of ["Chapati", "Bhakri"])
        await menuDlg.getByRole("checkbox", { name: item }).check();
      await expectAccessible(page, "menu dialog");
      await menuDlg.getByRole("button", { name: "Add menu" }).click();
      await expect(page.getByRole("main").getByText("Non Veg").first()).toBeVisible();
      await shot(page, info, "2-menu");

      await tab(page, "Prices").click();
      await page.getByRole("button", { name: "New prices" }).first().click();
      const dlg = page.getByRole("dialog", { name: "New prices" });
      await pickDay(page, dlg.getByLabel("Applies from"), firstOfMonth());
      await dlg.getByLabel("Veg, per plate", { exact: true }).fill("150");
      await dlg.getByLabel("Non Veg, per plate").fill("170");
      await dlg.getByLabel("Chapati, per piece").fill("15");
      await dlg.getByLabel("Bhakri, per piece").fill("30");
      await dlg.getByLabel("Monthly fee").fill("40");
      await expect(dlg.getByText("Different price in a service")).toHaveCount(0);
      await expectAccessible(page, "prices dialog");
      await dlg.getByRole("button", { name: "Add prices" }).click();
      await expect(page.getByRole("main").getByText("₹150").first()).toBeVisible();
      await shot(page, info, "2-prices");

      await tab(page, "Rules").click();
      await expect(page.getByText("Mon to Fri")).toBeVisible();
    });

    await test.step("a member is added and sent a link that works once", async () => {
      await go(page, "People");
      await page.getByRole("button", { name: "Add a person" }).first().click();
      const dlg = page.getByRole("dialog", { name: "Add a person" });
      await dlg.getByLabel("Name").fill("Jovial");
      await pickDay(page, dlg.getByLabel("Eating from"), firstOfMonth());
      await dlg.getByRole("button", { name: "Add person" }).click();
      await expect(entry(page, "Jovial")).toBeVisible();
      await page.getByRole("button", { name: "Actions for Jovial" }).click();
      await page.getByRole("menuitem", { name: "Invite" }).click();
      const inv = page.getByRole("dialog", { name: "Invite Jovial" });
      await inv.getByLabel(/’s email/).fill("jovial@example.org");
      await inv.getByRole("button", { name: "Make a link" }).click();
      inviteLink = await inv.getByLabel("Invitation link").inputValue();
      expect(inviteLink).toMatch(/\/join#/);
      await page.keyboard.press("Escape");
      await shot(page, info, "3-people");
    });

    await test.step("a person is disabled and enabled again from the list, in either theme", async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.getByRole("button", { name: "Actions for Jovial" }).click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      const dlg = page.getByRole("dialog", { name: "Edit Jovial" });
      await expectAccessible(page, "edit person, dark");
      await shot(page, info, "3b-edit-person-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await expectAccessible(page, "edit person");
      await page.keyboard.press("Escape");
      await expect(dlg).toBeHidden();

      await page.getByRole("button", { name: "Actions for Jovial" }).click();
      await page.getByRole("menuitem", { name: "Disable" }).click();
      const sure = page.getByRole("alertdialog", { name: "Disable Jovial?" });
      await sure.getByRole("button", { name: "Disable", exact: true }).click();
      // Disabled people are out of the default list (DAT-09); the Disabled filter shows them.
      await expect(entry(page, "Jovial")).toHaveCount(0);
      await page.getByRole("button", { name: /^Disabled, 1/ }).click();
      await expect(entry(page, "Jovial").getByText("Disabled", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Actions for Jovial" }).click();
      await expect(page.getByRole("menuitem", { name: "Invite" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Enable" }).click();
      await expect(entry(page, "Jovial")).toHaveCount(0);
      await page.getByRole("button", { name: /^All, / }).click();
      await expect(entry(page, "Jovial")).toBeVisible();
      await expect(entry(page, "Jovial").getByText("Disabled", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Actions for Jovial" }).click();
      await expect(page.getByRole("menuitem", { name: "Invite" })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("the member signs in with the link and sees their own bill", async () => {
      await signIn(jovial, "jovial@example.org", "Jovial");
      await jovial.goto(inviteLink);
      // Opening a link changes nothing; joining is a click.
      await jovial.getByRole("button", { name: "Join" }).click();
      await jovial.waitForURL(`**/w/${slug}`);
      await expect(jovial.getByRole("heading", { name: "Test Kitchen", level: 1 })).toBeVisible();
      await expect(jovial.getByRole("heading", { name: /^You owe ₹/ })).toBeVisible();
      await openThisMonth(jovial);
      await expect(jovial.getByRole("cell", { name: "Veg", exact: true })).toBeVisible();
      await expect(jovial.getByRole("row", { name: /^Veg \d+ ₹150 / })).toBeVisible();
      await expectAccessible(jovial, "member home");
      await shot(jovial, info, "4-member-home");
      // People-management is not theirs.
      await jovial.goto(`/w/${slug}/people`);
      await expect(
        jovial.getByRole("heading", { name: "This is for admins", level: 1 }),
      ).toBeVisible();
    });

    await test.step("the member logs a leave day and claims a payment", async () => {
      await go(jovial, "Meals");
      await expect(jovial.getByRole("heading", { name: "My meals", level: 1 })).toBeVisible();
      const leaveDay = aWorkingDayThisMonth();
      const afterTheDay = leaveDay < (await kitchenToday(jovial, slug));
      await jovial.getByRole("button", { name: "Skip a meal" }).click();
      const skip = jovial.getByRole("dialog", { name: "Skip a meal" });
      await pickDay(jovial, skip.getByLabel("Which day?"), leaveDay);
      await skip.getByRole("button", { name: "Skip", exact: true }).click();
      await expect(skip).toBeHidden();
      const logged = jovial.getByRole("listitem").filter({ hasText: /Skip|Leave/ });
      await expect(logged.first()).toBeVisible();
      // After its day an entry is allowed, and shows as late.
      if (afterTheDay) await expect(jovial.getByText(/Added \d+ days? after/)).toBeVisible();

      await go(jovial, /\bPay\b/);
      await jovial.getByRole("button", { name: "I paid" }).first().click();
      const claim = jovial.getByRole("dialog", { name: "I paid" });
      await claim.getByLabel("Amount").fill("1000");
      await claim.getByLabel("Reference (optional)").fill("UPI-REF-1");
      await claim.getByRole("button", { name: "Send claim" }).click();
      await expect(claim).toBeHidden();
      await expect(entry(jovial, /Pending/)).toBeVisible();
      await expectAccessible(jovial, "member payments");
      await shot(jovial, info, "5-member-payments");
      await go(jovial, "Home");
      await expect(
        jovial.getByText(/You have claimed ₹1,000, waiting to be confirmed\./).first(),
      ).toBeVisible();
    });

    await test.step("the supplier confirms it once, and the figures move", async () => {
      await go(page, /^Payments/);
      await expect(page.getByRole("tab", { name: /^To confirm\s*1/ })).toBeVisible();
      await expect(page.getByText("UPI-REF-1")).toBeVisible();
      // The admin can see the queue but only the supplier decides: the owner is both, so switches role.
      await expect(
        page.getByText(/^Only the cook confirms a payment\. View as Cook/),
      ).toBeVisible();
      await page.getByRole("button", { name: /^Actions for Jovial/ }).click();
      await expect(page.getByRole("menuitem", { name: "Confirm", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await viewAs(page, "Cook");
      await go(page, /^Payments/);
      await page.getByRole("button", { name: /^Actions for Jovial/ }).click();
      await page.getByRole("menuitem", { name: "Confirm", exact: true }).click();
      // The claim leaves the "To confirm" tab (no count left on it) and is on the "Confirmed" one.
      await expect(page.getByRole("tab", { name: /^To confirm$/ })).toBeVisible();
      await page.getByRole("tab", { name: "Confirmed", exact: true }).click();
      await expect(entry(page, /Jovial.*Confirmed/)).toBeVisible();
      await viewAs(page, "Admin");
      await go(page, "Home");
      await expect(page.getByRole("region", { name: "This month" })).toContainText(
        /Collected this month\s*₹1,000/,
      );
      await go(page, "Bills");
      await expect(entry(page, /Jovial/)).toBeVisible();
      await expectAccessible(page, "admin bills");
      await shot(page, info, "6-admin-bills");
      await page.emulateMedia({ colorScheme: "dark" });
      await expectAccessible(page, "admin bills, dark");
      await shot(page, info, "6b-admin-bills-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await jovial.reload();
      await openThisMonth(jovial);
      await expect(jovial.getByRole("row", { name: /^Payments\s+[−-]₹1,000/ })).toBeVisible();
    });

    await test.step("the admin removes the member’s leave, and the member can see who did it and when", async () => {
      // The admin's menu has no Meals: what the kitchen logged is at its address, and Today is where it is changed.
      await page.goto(`/w/${slug}/meals`);
      const row = page.getByRole("listitem").filter({ hasText: /Jovial/ });
      await row.getByRole("button", { name: /^Actions for .*Jovial/ }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: /Jovial/ })).toHaveCount(0);
      await go(jovial, "History");
      await expect(jovial.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
      await expect(jovial.getByText(/You logged Leave on /)).toBeVisible();
      await expect(jovial.getByText(/The admin removed your Leave entry for /)).toBeVisible();
      await expect(jovial.getByText(/You claimed ₹1,000 for \w{3} \d{4} \(UPI\)\./)).toBeVisible();
      await expect(
        jovial.getByText(/The supplier confirmed your claim of ₹1,000 for \w{3} \d{4}\./),
      ).toBeVisible();
      // Nothing about anyone else, and no name but their own.
      await expect(jovial.getByRole("main")).not.toContainText(/Owner|Maple|owner@/);
      await expectAccessible(jovial, "member history");
      await shot(jovial, info, "5b-member-history");
      await go(jovial, "Home");
    });

    await test.step("with no signal, the member still sees the last statement", async () => {
      await member.setOffline(false);
      await expect
        .poll(() =>
          jovial.evaluate(async () => (await navigator.serviceWorker.ready).active?.state),
        )
        .toBe("activated");
      await jovial.reload(); // now served through the service worker, which keeps what it fetches
      await openThisMonth(jovial);
      await expect(jovial.getByRole("row", { name: /^Payments\s+[−-]₹1,000/ })).toBeVisible();
      await member.setOffline(true);
      await jovial.reload();
      await expect(
        jovial.getByText("You are offline. This is the last statement saved on this device."),
      ).toBeVisible();
      await openThisMonth(jovial);
      await expect(jovial.getByRole("row", { name: /^Payments\s+[−-]₹1,000/ })).toBeVisible();
      await shot(jovial, info, "7-offline");
      await member.setOffline(false);
    });

    await test.step("the owner moves the kitchen to a database of their own, and nobody loses anything", async () => {
      await admin.query(`CREATE DATABASE ${external}`);
      const target = new URL(ADMIN);
      target.pathname = `/${external}`;
      await go(page, "Books");
      await tab(page, "Your data").click();
      await expect(page.getByRole("heading", { name: "Your data", level: 1 })).toBeVisible();
      await shot(page, info, "8-your-data");
      await page.getByLabel("Connection string of an empty Postgres").fill(target.toString());
      await page.getByRole("button", { name: "Check it first" }).click();
      await expect(page.getByText("It will work. Nothing has been changed.")).toBeVisible();
      await page.getByRole("button", { name: "Move now" }).click();
      const sure = page.getByRole("alertdialog", { name: "Move this kitchen?" });
      await sure.getByLabel(`Type ${slug} to confirm`).fill(slug);
      await sure.getByRole("button", { name: "Move now" }).click();
      await expect(page.getByRole("heading", { name: "Moved" })).toBeVisible();
      await expect(page.getByText("Everything was copied and every statement")).toBeVisible();
      await shot(page, info, "9-moved");

      // Same figures, from the new database, for the owner and for the member.
      await page.goto(`/w/${slug}`);
      await expect(page.getByRole("region", { name: "This month" })).toContainText(
        /Collected this month\s*₹1,000/,
      );
      await jovial.goto(`/w/${slug}`);
      await openThisMonth(jovial);
      await expect(jovial.getByRole("row", { name: /^Payments\s+[−-]₹1,000/ })).toBeVisible();
      const left = await admin.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'ws\\_%'`);
      expect(left.rowCount).toBeGreaterThan(0); // the old copy is kept for a week, as promised
    });

    await test.step("the owner deletes everything, and gets a receipt that names no one", async () => {
      await go(page, "Books");
      await tab(page, "Your data").click();
      await page.getByRole("button", { name: "Delete this kitchen" }).click();
      const sure = page.getByRole("alertdialog", { name: "Delete this kitchen for good?" });
      await sure.getByLabel(`Type ${slug} to confirm`).fill(slug);
      await sure.getByRole("button", { name: "Delete for good" }).click();
      await expect(page.getByRole("heading", { name: "Deleted" })).toBeVisible();
      await shot(page, info, "10-deleted");
      await page.getByRole("link", { name: /\/r\// }).click();
      await expect(page.getByRole("heading", { name: "Wipe receipt", level: 1 })).toBeVisible();
      for (const c of ["Keys destroyed", "Database removed", "Directory entry gone"])
        await expect(page.getByText(c)).toBeVisible();
      const text = await page.getByRole("main").innerText();
      for (const secret of [
        "Test Kitchen",
        slug,
        "Jovial",
        "jovial@example.org",
        "owner@example.org",
      ])
        expect(text).not.toContain(secret);
      await expectAccessible(page, "receipt");
      await shot(page, info, "11-receipt");

      // Everything of it is gone, including the sign-in records that existed only for it: both are signed out.
      await page.goto(`/w/${slug}`);
      await expect(page).toHaveURL(/\/signin/);
      await jovial.goto("/app");
      await expect(jovial).toHaveURL(/\/signin/);
    });

    expect(seen.flat(), "nothing refused by the security policy, nothing thrown").toEqual([]);
  } finally {
    await member.close();
    await admin.query(`DROP DATABASE IF EXISTS ${external} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
});
