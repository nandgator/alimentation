import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, shot, watchPage } from "./support.ts";

test.describe("the home page", () => {
  test("says what it is, states each promise with its catch, and fits the screen", async ({
    page,
  }, info) => {
    const problems = watchPage(page);
    await page.goto("/");
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("Who ate, what it");
    await expect(h1).toContainText("cost, who paid");
    await expect(page.getByText(/of 80 free kitchens taken/)).toBeVisible();

    const promises = page.getByRole("region", { name: /Eight promises/ });
    await expect(promises.getByRole("heading", { level: 3 })).toHaveCount(8);
    await expect(promises.getByText("The catch.")).toHaveCount(8);
    await expect(page.getByText("Leave, and everything goes.")).toBeVisible();
    await expect(page.getByRole("figure", { name: /example wipe receipt/i })).toBeVisible();

    await shot(page, info, "home-light");
    expect(problems, "nothing refused by the security policy, nothing thrown").toEqual([]);
    const res = await page.request.get("/");
    expect(res.headers()["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });

  test("has the site header the guides and the docs have: the mark, Guides, Docs and the way in", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Alimentation" })).toHaveAttribute("href", "/");
    const docs = header.getByRole("navigation", { name: "Documentation" });
    await expect(docs.getByRole("link")).toHaveText(["Guides", "Docs"]);
    await expect(docs.getByRole("link", { name: "Guides" })).toHaveAttribute("href", "/guides/");
    await expect(docs.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs/");
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
  });

  test("names its sections in the bar where there is room, and in the foot where there is not", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/");
    const names = ["Try it", "Free", "Moving", "Leaving", "Promises"];
    const links = (name: string) =>
      page.getByRole("navigation", { name, exact: true }).getByRole("link");
    if (isMobile) {
      await expect(links("Footer")).toHaveText(names);
    } else {
      await expect(links("Sections")).toHaveText(names);
      await expect(
        page.getByRole("navigation", { name: "Footer", exact: true }),
        "the bar already says them",
      ).toBeHidden();
    }
  });

  test.describe("the live calendar", () => {
    // The page uses the visitor's own date; here it is fixed to Wednesday 10 March 2027.
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(2027, 2, 10, 10, 0));
    });

    test("freezes the days that have happened, leaves the rest tentative, and bills on the real rules", async ({
      page,
    }) => {
      await page.goto("/");
      const total = (text: string) => expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Meera, March 2027" })).toBeVisible();
      await expect(page.getByText("Today is Wednesday 10 March.")).toBeVisible();
      await total("₹2,830");
      await total("₹950");

      // Up to and including today: frozen, and cannot be changed.
      await expect(page.getByRole("button", { name: /^Monday 1 March: .*frozen/ })).toBeDisabled();
      await expect(
        page.getByRole("button", { name: /^Wednesday 10 March: .*today, frozen/ }),
      ).toBeDisabled();
      // After today: tentative, and a tap steps it through leave, switched dish, extra chapatis.
      const thursday = page.getByRole("button", { name: /^Thursday 11 March: .*tentative/ });
      await expect(thursday).toBeEnabled();
      await thursday.click(); // leave: the day's veg meal (120) is gone
      await total("₹2,710");
      await page.getByRole("button", { name: /^Thursday 11 March: Leave/ }).click(); // non-veg: +30
      await total("₹2,860");
      await page.getByRole("button", { name: /^Thursday 11 March/ }).click(); // two chapatis: +20
      await total("₹2,850");
      await page.getByRole("button", { name: /^Thursday 11 March/ }).click(); // back to the day's meal
      await total("₹2,830");
      await total("₹950"); // a change to come does not touch what is frozen

      // Every day to come can be changed from the keyboard.
      await page.getByRole("button", { name: /^Friday 12 March/ }).focus();
      await page.keyboard.press("Enter");
      await total("₹2,950");

      // Clearing removes only what is still to come; the frozen history stays.
      await page.getByRole("button", { name: "Clear the changes still to come" }).click();
      await total("₹2,930");
      await total("₹950");
    });

    test("looks ahead to a month not begun, and back at one that is over", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Next month" }).click();
      await expect(page.getByRole("heading", { name: "Meera, April 2027" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Next month" })).toBeDisabled();
      await expect(page.getByText("₹2,940", { exact: true })).toBeVisible();
      await expect(page.getByText("Frozen so far"), "nothing is frozen yet").toHaveCount(0);

      await page.getByRole("button", { name: "Previous month" }).click();
      await page.getByRole("button", { name: "Previous month" }).click();
      await expect(page.getByRole("heading", { name: "Meera, February 2027" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
      await expect(page.getByText("₹2,670", { exact: true })).toBeVisible();
      await expect(page.getByText("Meera’s bill for February", { exact: true })).toBeVisible();
    });
  });

  test("says what an entry is, and that the figures are for the whole kitchen", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText(/What counts as an entry\?/)).toBeVisible();
    await expect(page.getByText(/counted for the kitchen as a whole/)).toBeVisible();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`is readable in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expectNoSidewaysScroll(page, `the home page, ${scheme}`);
      await expectAccessible(page, `the home page, ${scheme}`);
    });
  }

  test("has no green brand colour: its first screen is the indigo of the theme", async ({
    page,
  }) => {
    await page.goto("/");
    const hue = await page.getByRole("heading", { level: 1 }).evaluate((el) => {
      const wall = el.closest("section");
      const c = getComputedStyle(wall as Element).backgroundColor;
      const [r = 0, g = 0, b = 0] = c.match(/[\d.]+/g)!.map(Number);
      return { r, g, b };
    });
    expect(hue.b, "blue leads").toBeGreaterThan(hue.g);
    expect(hue.b, "blue leads").toBeGreaterThan(hue.r);
  });

  test("leads to sign-in, and the sign-in page is accessible", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Start your kitchen" }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectAccessible(page, "sign in");
  });

  test("can be installed: it has a manifest with icons, and a service worker takes over", async ({
    page,
    request,
  }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/app");
    expect(manifest.theme_color).toBe("#3442a6");
    const sizes = manifest.icons.map(
      (i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ""}`,
    );
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512", "512x512:maskable"]));
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
      .toBe("activated");
  });

  test("shows nothing of any kitchen to a stranger, and sends them to sign in", async ({
    page,
  }) => {
    await page.goto("/w/whatever");
    await expect(page).toHaveURL(/\/signin\?next=/);
    await page.goto("/r/not-a-real-receipt");
    await expect(page.getByText("There is no receipt with that address")).toBeVisible();
  });
});
