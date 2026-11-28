import { expect, test } from "@playwright/test";

/** Forms and dialogs as the kit page (/dev/kit) builds them: roles, labels and text only. */
test.describe("forms", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/kit");
    await expect(page.getByRole("heading", { level: 1, name: "App kit" })).toBeVisible();
  });

  test("a failed submit shows inline errors and sends focus to the summary of a long form", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Save person" }).click();
    const name = page.getByLabel(/^Name/);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAttribute("aria-describedby", /.+/);
    await expect(page.getByRole("alert").filter({ hasText: "things need fixing" })).toBeFocused();
  });

  test("a field is checked when left, and again as it is fixed", async ({ page }) => {
    const fee = page.getByLabel("Monthly fee");
    await fee.fill("12x");
    await fee.blur();
    await expect(fee).toHaveAttribute("aria-invalid", "true");
    await fee.fill("12.5");
    await expect(fee).not.toHaveAttribute("aria-invalid", "true");
    await fee.blur();
    await expect(fee).toHaveValue("12.50");
  });

  test("a server refusal lands on its field", async ({ page }) => {
    await page.getByLabel(/^Name/).fill("taken");
    await page.getByLabel("Monthly fee").fill("3200");
    await page.getByLabel("Meals a day").fill("2");
    await page.getByLabel("Starts on").click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Save person" }).click();
    await expect(page.getByText("That name is already used here.")).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveAttribute("aria-invalid", "true");
  });

  test("a dirty dialog asks before it is discarded, and the footer stays in view", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Open form dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a holiday" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add holiday" })).toBeInViewport();
    await dialog.getByLabel("Title").fill("Festival");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await page.goBack();
    await expect(page.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Back closes a clean dialog", async ({ page }) => {
    await page.getByRole("button", { name: "Open form dialog" }).click();
    await expect(page.getByRole("dialog", { name: "Add a holiday" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the confirmation ladder", async ({ page }) => {
    await page.getByRole("button", { name: "Retire (confirm)" }).click();
    await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Delete kitchen (typed)" }).click();
    const act = page.getByRole("alertdialog").getByRole("button", { name: "Delete kitchen" });
    await expect(act).toBeDisabled();
    await page.getByLabel("Type Sample Kitchen to confirm").fill("Sample Kitchen");
    await expect(page.getByText("Matches")).toBeVisible();
    await expect(act).toBeEnabled();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Remove (undo)" }).click();
    await expect(page.getByText("Rice removed from the menu.")).toBeVisible();
    await page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect(page.getByText("Present.")).toBeVisible();
  });
});
