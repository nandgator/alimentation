import { expect, type Page, test } from "@playwright/test";
import { expectAccessible, shot, signIn, watchPage } from "./support.ts";

async function go(p: Page, name: string | RegExp) {
  const nav = p.getByRole("navigation", { name: "Sections" });
  const link = nav.getByRole("link", { name });
  if (!(await link.isVisible())) await nav.getByRole("button", { name: "More" }).click();
  await link.click();
}

const FILE = [
  "externalKey,name,role,contact,activeFrom,activeTo",
  "A-101,Example Member,member,member@example.org,2026-04-01,",
  "S-1,Example Supplier,supplier,,,",
].join("\n");

test("people come in from a file after a preview, a second run changes nothing, and they go back out as a file", async ({
  page,
}, info) => {
  const seen = watchPage(page);
  const slug = `imp-${info.project.name}-${Date.now().toString(36)}`;
  await signIn(page, "import-owner@example.org", "Owner");
  await page.getByLabel("Name", { exact: true }).fill("Import Kitchen");
  await page.getByLabel("Address").fill(slug);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(`**/w/${slug}`);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await go(page, "People");

  await page.getByRole("button", { name: "Import" }).click();
  const dlg = page.getByRole("dialog", { name: "Import people" });
  await expect(dlg.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await dlg.getByLabel("People", { exact: true }).fill(FILE);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(
    dlg.getByText(/2 to add, 0 to change, 0 already as in the file, 0 refused/),
  ).toBeVisible();
  await expect(dlg.getByRole("row", { name: /A-101.*Example Member.*Add/ })).toBeVisible();
  await expectAccessible(page, "import people");
  await shot(page, info, "people-import-preview");
  await dlg.getByRole("button", { name: "Confirm" }).click();
  await expect(dlg).toBeHidden();
  const row = page.getByRole("row", { name: /Example Member/ });
  await expect(row).toContainText("A-101");
  await expect(row).toContainText("member@example.org");
  await expect(page.getByRole("row", { name: /Example Supplier/ })).toContainText("S-1");

  // The same file again: nothing to do, so nothing to confirm.
  await page.getByRole("button", { name: "Import" }).click();
  await dlg.getByLabel("People", { exact: true }).fill(FILE);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/0 to add, 0 to change, 2 already as in the file/)).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Confirm" })).toBeDisabled();

  // A change shows what changes; a refused row stops the lot.
  await dlg
    .getByLabel("People", { exact: true })
    .fill(`${FILE.replace("member@example.org", "new@example.org")}\nA-101,Twin,supplier,,,`);
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/2 refused/)).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await dlg
    .getByLabel("People", { exact: true })
    .fill(FILE.replace("member@example.org", "new@example.org"));
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/contact: member@example.org to new@example.org/)).toBeVisible();
  await dlg.getByRole("button", { name: "Confirm" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByRole("row", { name: /Example Member/ })).toContainText("new@example.org");

  // The key is fixed once it is set.
  await page.getByRole("button", { name: "Edit Example Member" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit person" }).getByLabel("Key (optional)"),
  ).toHaveJSProperty("readOnly", true);
  await page.keyboard.press("Escape");

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
