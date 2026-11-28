import { expect, type Page, test } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, shot, signIn, watchPage } from "./support.ts";

const FILE = [
  "externalKey,name,role,contact,activeFrom,activeTo",
  "A-101,Example Member,member,member@example.org,2026-04-01,",
  "S-1,Example Supplier,supplier,,,",
].join("\n");

/** A new kitchen with its owner, who is its admin and its cook, opened on People. */
async function peopleOf(page: Page, tag: string, info: { project: { name: string } }) {
  const slug = `${tag}-${info.project.name}-${Date.now().toString(36)}`;
  await signIn(page, `owner-${slug}@example.org`, "Owner");
  const made = await page.request.post("/api/workspaces", {
    data: { slug, name: "Import Kitchen", alsoSupplier: true },
  });
  expect(made.ok()).toBe(true);
  await page.goto(`/w/${slug}/people`);
  await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
  return slug;
}

/** One person on the list, whether it is a table row (wide) or an item of a list (phone). */
const entry = (page: Page, name: string | RegExp) =>
  page
    .getByRole("main")
    .getByRole("row", { name })
    .or(page.getByRole("main").getByRole("listitem").filter({ hasText: name }));

/** Opens a person's page from the list: the name is a link on a wide screen and a button on a phone. */
async function openPerson(page: Page, name: string) {
  await page
    .getByRole("link", { name, exact: true })
    .or(page.getByRole("button", { name: new RegExp(`^${name}`) }))
    .first()
    .click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

test("people come in from a file after a preview, a second run changes nothing, and they go back out as a file", async ({
  page,
}, info) => {
  const seen = watchPage(page);
  await peopleOf(page, "imp", info);

  // The owner is one person, not an admin and a cook.
  await expect(entry(page, /Owner/)).toHaveCount(1);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Import people" });

  // Nothing to preview yet: the field says so, in place.
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText("Paste the people, or choose a file.")).toBeVisible();
  await expect(dlg.getByLabel("People", { exact: true })).toHaveAttribute("aria-invalid", "true");

  // The choices are cards with a title and a line, and Overwrite is marked.
  await expect(dlg.getByRole("radio", { name: /^Merge/ })).toBeChecked();
  await expect(dlg.getByText("Clears blanks")).toBeVisible();
  await expectNoSidewaysScroll(page, "import dialog");

  await dlg.getByLabel("People", { exact: true }).fill(FILE);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/2 to add, 0 to update, 0 unchanged, 0 errors/)).toBeVisible();
  await expect(dlg.getByText("Example Member").first()).toBeVisible();
  await expect(dlg.getByText("Example Supplier").first()).toBeVisible();
  // Nothing has been written: the list behind the dialog is as it was.
  await expectNoSidewaysScroll(page, "import preview");
  await expectAccessible(page, "import people");
  await shot(page, info, "people-import-preview");
  await dlg.getByRole("button", { name: "Apply" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(/2 people added, 0 changed/)).toBeVisible();
  await expect(entry(page, /Example Member/)).toHaveCount(1);
  await expect(entry(page, /Example Supplier/)).toHaveCount(1);

  // The key and the contact are on the person's own page.
  await openPerson(page, "Example Member");
  await expect(page.getByText("A-101").first()).toBeVisible();
  await expect(page.getByText("member@example.org").first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();

  // The same file again: nothing to do, so nothing to apply.
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await dlg.getByLabel("People", { exact: true }).fill(FILE);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/0 to add, 0 to update, 2 unchanged, 0 errors/)).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Apply" })).toBeDisabled();

  // A row that is refused stops the lot, and "Change the file" goes back to it.
  await dlg.getByRole("button", { name: "Change the file" }).click();
  await dlg
    .getByLabel("People", { exact: true })
    .fill(`${FILE.replace("member@example.org", "new@example.org")}\nA-101,Twin,supplier,,,`);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/2 errors/)).toBeVisible();
  await expect(
    dlg.getByText("Nothing is added or changed until every row is fixed."),
  ).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Apply" })).toBeDisabled();

  // A change shows what changes before it is made.
  await dlg.getByRole("button", { name: "Change the file" }).click();
  await dlg
    .getByLabel("People", { exact: true })
    .fill(FILE.replace("member@example.org", "new@example.org"));
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(
    dlg.getByText(/contact: member@example.org to new@example.org/).first(),
  ).toBeVisible();
  await dlg.getByRole("button", { name: "Apply" }).click();
  await expect(dlg).toBeHidden();
  await openPerson(page, "Example Member");
  await expect(page.getByText("new@example.org").first()).toBeVisible();

  // The key is fixed once it is set.
  await page.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Example Member" });
  // The fold is already open for a person with a key or a contact; open it only if it is shut.
  const more = edit.getByRole("button", { name: "More details" });
  if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(edit.getByLabel("Key (optional)")).toHaveJSProperty("readOnly", true);
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await page.goBack();

  // And out again as a file, safe to open in a spreadsheet.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("people.csv");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "");
  expect(text.split("\r\n")[0]).toBe("externalKey,name,role,contact,activeFrom,activeTo");
  expect(text).toContain("A-101,Example Member,consumer,new@example.org,2026-04-01,");

  expect(seen, "nothing refused by the security policy, nothing thrown").toEqual([]);
});

test("a person is added, found, invited, disabled and enabled again", async ({ page }, info) => {
  const seen = watchPage(page);
  await peopleOf(page, "ppl", info);

  // Add: a name is asked for in place, and a role is chosen from cards.
  await page.getByRole("button", { name: "Add a person" }).click();
  const add = page.getByRole("dialog", { name: "Add a person" });
  await add.getByRole("button", { name: "Add person" }).click();
  await expect(add.getByText("Enter a name.")).toBeVisible();
  await expect(add.getByLabel(/^Name/)).toHaveAttribute("aria-invalid", "true");
  await add.getByLabel(/^Name/).fill("Example Cook");
  await add.getByRole("radio", { name: /^Cook/ }).check();
  await expect(add.getByRole("button", { name: "Add person" })).toBeInViewport();
  await add.getByRole("button", { name: "Add person" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByText("Example Cook added.")).toBeVisible();

  // Each person once, with a badge for each role they hold.
  await expect(entry(page, /Example Cook/)).toHaveCount(1);
  await expect(entry(page, /Owner/)).toHaveCount(1);
  await expectNoSidewaysScroll(page, "people list");
  await shot(page, info, "people-list");

  // Search narrows the list, and the filter chips keep their place in the address.
  await page.getByRole("searchbox", { name: "Search people" }).fill("cook");
  await expect(entry(page, /Owner/)).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search people" }).fill("");
  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("button", { name: /^Cooks/ }).click();
  await expect(page).toHaveURL(/show=supplier/);
  await expect(entry(page, /Example Cook/)).toHaveCount(1);
  await show.getByRole("button", { name: /^All/ }).click();

  // Disable asks first, with "Keep it" as the default, and the person moves to the Disabled chip.
  await page.getByRole("button", { name: "Actions for Example Cook" }).click();
  await page.getByRole("menuitem", { name: "Disable" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Disable Example Cook?" });
  await expect(confirm.getByRole("button", { name: "Keep it" })).toBeFocused();
  await confirm.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText("Example Cook is disabled.")).toBeVisible();
  await expect(entry(page, /Example Cook/)).toHaveCount(0);
  await show.getByRole("button", { name: /^Disabled/ }).click();
  await expect(entry(page, /Example Cook/)).toHaveCount(1);
  await page.getByRole("button", { name: "Actions for Example Cook" }).click();
  await page.getByRole("menuitem", { name: "Enable" }).click();
  await expect(page.getByText("Example Cook is enabled.")).toBeVisible();
  await show.getByRole("button", { name: /^All/ }).click();
  await expect(entry(page, /Example Cook/)).toHaveCount(1);

  // Invite names the person in its title and ends in a link to copy.
  await page.getByRole("button", { name: "Actions for Example Cook" }).click();
  await page.getByRole("menuitem", { name: "Invite" }).click();
  const invite = page.getByRole("dialog", { name: "Invite Example Cook" });
  await invite.getByRole("button", { name: "Make a link" }).click();
  await expect(invite.getByText(/Enter an email address/)).toBeVisible();
  await invite.getByLabel(/email/i).fill("cook@example.org");
  await invite.getByRole("button", { name: "Make a link" }).click();
  await expect(invite.getByLabel("Invitation link")).toHaveValue(/join/);
  await expectAccessible(page, "invite link");

  expect(seen, "nothing refused by the security policy, nothing thrown").toEqual([]);
});
