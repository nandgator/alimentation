import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, shot, signIn, watchPage } from "./support.ts";

test("an admin gives an agent a key, sees it once, uses it, and ends it", async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const problems = watchPage(page);
  const stamp = Date.now().toString(36);
  const slug = `agent-${stamp}`;
  await signIn(page, `agent-admin-${stamp}@example.org`, "Agent Admin");
  expect(
    await page.evaluate(async (s) => {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: s, name: "Agent Mess" }),
      });
      return r.status;
    }, slug),
  ).toBe(201);

  await page.goto(`/w/${slug}/books/data`);
  await expect(page.getByRole("heading", { name: "Your data", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New key" }).click();
  const form = page.getByRole("dialog", { name: "New key" });
  await form.getByLabel("Name for the key").fill("Lunch bot");
  await form.getByRole("checkbox", { name: "May add and withdraw entries" }).check();
  await form.getByRole("button", { name: "Make a key" }).click();

  const shown = page.getByLabel("The key", { exact: true });
  await expect(shown).toBeVisible();
  const token = await shown.inputValue();
  expect(token).toMatch(/^alk_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByText("copy this key now")).toBeVisible();
  await expect(page.getByText("/mcp", { exact: false }).first()).toBeVisible();
  await expectAccessible(page, "keys for agents");
  await expectNoSidewaysScroll(page, "keys for agents");
  await shot(page, info, "agent-keys");

  // The key works, from nowhere that is signed in, as the admin it was made by.
  const nobody = await playwright.request.newContext({ baseURL });
  const asKey = { headers: { authorization: `Bearer ${token}` } };
  const boot = await nobody.get(`/api/w/${slug}/bootstrap`, asKey);
  expect(boot.status()).toBe(200);
  expect((await boot.json()).me.role).toBe("admin");
  // And what is a person's alone is refused.
  expect(
    (await nobody.post(`/api/w/${slug}/wipe`, { ...asKey, data: { confirm: slug } })).status(),
  ).toBe(403);
  // The MCP server speaks to it.
  const tools = await nobody.post("/mcp", {
    ...asKey,
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  const names = ((await tools.json()).result.tools as { name: string }[]).map((t) => t.name);
  expect(names).toContain("post_log");
  expect(names).not.toContain("post_wipe");

  // It is not shown again, and appears in the list; ending it ends it.
  await page.getByRole("button", { name: "I have copied it" }).click();
  await expect(shown).toHaveCount(0);
  await page.reload();
  // A table row on a desktop, a list item on a phone.
  const row = page
    .getByRole("main")
    .getByRole("row", { name: /Lunch bot/ })
    .or(page.getByRole("main").getByRole("listitem").filter({ hasText: "Lunch bot" }));
  await expect(row).toContainText("You, as admin");
  await expect(row).toContainText("read, log");
  await expect(page.getByText(token)).toHaveCount(0);
  // Ending a key is not undone, so it asks first, with "Keep it" as the default.
  await row.getByRole("button", { name: "Actions for Lunch bot" }).click();
  await page.getByRole("menuitem", { name: "End it" }).click();
  const ask = page.getByRole("alertdialog", { name: "End Lunch bot?" });
  await expect(ask.getByRole("button", { name: "Keep it" })).toBeFocused();
  await ask.getByRole("button", { name: "End the key" }).click();
  await expect(row).toContainText("Ended");
  expect((await nobody.get(`/api/w/${slug}/bootstrap`, asKey)).status()).toBe(401);
  expect(problems).toEqual([]);
});
