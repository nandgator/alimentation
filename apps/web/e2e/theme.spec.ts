import { expect, test } from "@playwright/test";
import { expectAccessible, shot, signIn } from "./support.ts";

const stored = (page: import("@playwright/test").Page) =>
  page.evaluate(() => localStorage.getItem("theme"));

/**
 * Waits until the dissolve is over. A scan made before that is made on a page that is a picture of itself, and is
 * answered wrongly in some browsers.
 */
const overAndStill = async (page: import("@playwright/test").Page) => {
  await expect(page.locator("html")).not.toHaveClass(/theme-fading/);
  // And a few frames more: what a scan finds under a point is stale for a moment after a dissolve in some browsers.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let frames = 0;
        const next = () => (++frames < 8 ? requestAnimationFrame(next) : done());
        requestAnimationFrame(next);
      }),
  );
};

test.describe("the theme choice", () => {
  test("is one choice for every page: the home page, the guides and the docs", async ({
    page,
  }, info) => {
    await page.goto("/");
    const theme = page.getByRole("group", { name: "Theme", exact: true });
    await expect(theme.getByRole("radio", { name: "Auto" })).toBeChecked();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

    await theme.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await stored(page)).toBe("dark");
    await overAndStill(page);
    await expectAccessible(page, "the home page in the dark, with the choice open");
    await shot(page, info, "theme-home-dark");

    // Remembered, and applied before the page is drawn.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.getByRole("group", { name: "Theme", exact: true }).getByRole("radio", { name: "Dark" }),
    ).toBeChecked();

    // The documentation answers to the same choice, and the same button changes it.
    await page.goto("/guides/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const button = page.getByRole("button", { name: /Theme: dark/ });
    await expect(button).toHaveText("Theme: Dark");
    await button.click(); // Dark, then Auto
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    expect(await stored(page)).toBeNull();
    await page.getByRole("button", { name: /Theme: auto/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await stored(page)).toBe("light");

    // Back on the home page, the choice made in the docs is the one shown.
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("group", { name: "Theme", exact: true }).getByRole("radio", { name: "Light" }),
    ).toBeChecked();
  });

  /** Starts watching for a dissolve: whether the page is ever held in a transition, and the longest a fade runs. */
  const watchFade = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const w = window as unknown as { fade: { seen: boolean; ms: number } };
      w.fade = { seen: false, ms: 0 };
      setInterval(() => {
        if (document.documentElement.classList.contains("theme-fading")) w.fade.seen = true;
        for (const a of document.documentElement.getAnimations({ subtree: true }))
          if (a.effect && /view-transition-group\(root\)/.test(a.effect.pseudoElement ?? ""))
            w.fade.ms = Math.max(w.fade.ms, Number(a.effect.getComputedTiming().duration));
      }, 16);
    });
  const fade = (page: import("@playwright/test").Page) =>
    page.evaluate(() => (window as unknown as { fade: { seen: boolean; ms: number } }).fade);

  test("dissolves from one theme to the other, where motion is allowed, and switches at once where it is not", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await page.goto("/");
    await watchFade(page);
    const theme = page.getByRole("group", { name: "Theme", exact: true });
    await theme.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).not.toHaveClass(/theme-fading/);
    // It was held in a transition, as long as the design system says a change of theme takes (--dur-4).
    expect(await fade(page)).toEqual({ seen: true, ms: 600 });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await watchFade(page);
    await theme.getByRole("radio", { name: "Light" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await fade(page), "reduced motion changes the theme with no dissolve").toEqual({
      seen: false,
      ms: 0,
    });
  });

  test("dissolves the same way from the button in the guides and the docs", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
    await page.goto("/guides/");
    await watchFade(page);
    await page.getByRole("button", { name: /Theme: auto/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).not.toHaveClass(/theme-fading/);
    expect(await fade(page)).toEqual({ seen: true, ms: 600 });
  });

  test("keeps the choice the documentation made before it was shared", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("docs-theme", "dark"));
    await page.goto("/docs/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: /Theme: dark/ }).click();
    expect(await page.evaluate(() => localStorage.getItem("docs-theme"))).toBeNull();
  });

  test("is applied before the first paint, so a chosen theme never flashes the other one", async ({
    page,
  }) => {
    // The page is light by the system's setting, and the person chose dark. The attribute must be set once, by
    // the script in the head, before anything is drawn, and never changed back and forth.
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      const seen: string[] = [];
      (window as unknown as { seen: string[] }).seen = seen;
      new MutationObserver(() =>
        seen.push(document.documentElement.dataset.theme ?? "none"),
      ).observe(document, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
    });
    await page.goto("/signin");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([
      "dark",
    ]);
    // The ground is the dark one: its lightness is low, in sRGB terms well under a third.
    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r = 255, g = 255, b = 255] = (ground.match(/[\d.]+/g) ?? []).map(Number);
    expect(Math.max(r, g, b)).toBeLessThan(80);
  });

  test("answers to the system's setting until a choice is made, and to the choice after", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto("/signin");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(light, "a chosen light theme beats a dark system").not.toBe(dark);
  });

  test("can be changed inside a kitchen, whatever the screen", async ({ page, isMobile }, info) => {
    const slug = `col-${Date.now().toString(36)}`;
    await signIn(page, `owner-${slug}@example.org`, "Owner");
    await page.request.post("/api/workspaces", {
      data: { slug, name: `Theme ${slug}`, alsoSupplier: true },
    });
    await page.goto(`/w/${slug}`);
    // The control is in the account menu: the name in the sidebar's foot on a wide screen, and the avatar in the top
    // bar (a sheet with a Theme group) on a phone.
    const group = page.getByRole("group", { name: "Theme", exact: true });
    const choose = async (label: "Light" | "Dark" | "Auto") => {
      if (!(await group.isVisible())) {
        await page
          .getByRole("button", { name: /Account|Owner/ })
          .first()
          .click();
      }
      const name = label === "Auto" ? /^(Auto|System)$/ : label;
      const option = page
        .getByRole("menuitemradio", { name })
        .or(page.getByRole("radio", { name }))
        .first();
      await option.click();
      // A wide screen's menu closes itself; a phone's sheet is closed with Escape.
      if (isMobile) await page.keyboard.press("Escape");
    };
    await choose("Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await overAndStill(page);
    await expectAccessible(page, "a kitchen in the dark");
    await shot(page, info, "theme-kitchen-dark");
    // The choice outlasts a reload, inside the kitchen as on the home page.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await choose("Auto");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });
});
