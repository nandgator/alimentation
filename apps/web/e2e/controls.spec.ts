import { expect, test } from "@playwright/test";
import { expectAccessible } from "./support.ts";

/**
 * The shared controls as drawn, on the kit page (/dev/kit: development, or a build made with VITE_KIT=1):
 * touch targets, the font every control inherits, and a visible focus ring. Selected by role and label only.
 */
test.describe("the controls as drawn", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/dev/kit");
        await expect(page.getByRole("heading", { level: 1, name: "App kit" })).toBeVisible();
      });

      test("every button and field is at least 44px high on touch and 36px with a pointer", async ({
        page,
      }, info) => {
        const touch = info.project.name === "phone";
        const least = touch ? 44 : 36;
        const targets = [
          page.getByRole("button", { name: "Open form dialog" }),
          page.getByRole("button", { name: "Save person" }),
          page.getByLabel(/^Name/),
          page.getByLabel("Monthly fee"),
          page.getByLabel("Meals a day"),
          page.getByRole("button", { name: "Previous month" }),
        ];
        for (const t of targets) {
          const box = await t.first().boundingBox();
          expect(box, "drawn").not.toBeNull();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(least - 0.5);
        }
        if (touch)
          for (const name of ["Previous month", "Next month"]) {
            const box = await page.getByRole("button", { name }).boundingBox();
            expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
          }
      });

      test("every control uses the page font, not the browser's own", async ({ page }) => {
        const fonts = await page.evaluate(() => {
          const body = getComputedStyle(document.body).fontFamily;
          const seen = [...document.querySelectorAll("button, input, select, textarea")]
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => getComputedStyle(e).fontFamily);
          return { body, seen };
        });
        expect(fonts.seen.length).toBeGreaterThan(5);
        for (const f of fonts.seen) expect(f).toBe(fonts.body);
        expect(fonts.body).toContain("Figtree");
      });

      test("the keyboard focus ring is visible", async ({ page }) => {
        const field = page.getByLabel(/^Name/);
        await field.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        const ring = await field.evaluate((e) => {
          const s = getComputedStyle(e);
          return { shadow: s.boxShadow, outline: s.outlineStyle };
        });
        expect(ring.shadow !== "none" || ring.outline !== "none").toBe(true);
      });

      test("the kit has no serious accessibility violations", async ({ page }) => {
        await expectAccessible(page, `kit (${scheme})`);
      });
    });
  }

  test("a table becomes a list below 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/dev/kit");
    await expect(page.getByRole("table", { name: "People" })).toBeVisible();
    await page.setViewportSize({ width: 767, height: 900 });
    await expect(page.getByRole("table", { name: "People" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "People" })).toBeVisible();
  });

  test("a table pages as '1-10 of N' and searches", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dev/kit");
    await expect(page.getByText("1-10 of 64")).toBeVisible();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("11-20 of 64")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search" }).fill("Jovial 1");
    await expect(page.getByText("1 row")).toBeVisible();
  });
});
