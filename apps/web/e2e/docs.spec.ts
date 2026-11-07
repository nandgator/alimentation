import { expect, type Page, test } from "@playwright/test";
import { expectAccessible, expectNoSidewaysScroll, shot, watchPage } from "./support.ts";

interface Row {
  t: string;
  u: string;
}
const SITES = [
  { dir: "guides", name: "Guides" },
  { dir: "docs", name: "Docs" },
] as const;

async function pagesOf(page: Page, dir: string): Promise<string[]> {
  const res = await page.request.get(`/${dir}/search-index.json`);
  expect(res.ok(), `${dir} has a search index`).toBe(true);
  return ((await res.json()) as Row[]).map((r) => r.u);
}

test.describe("the documentation sites", () => {
  for (const { dir } of SITES) {
    test(`every page of the ${dir} is readable, fits the screen and passes the accessibility checks`, async ({
      page,
    }) => {
      test.setTimeout(360_000);
      const problems = watchPage(page);
      const urls = await pagesOf(page, dir);
      expect(urls.length).toBeGreaterThan(10);
      for (const url of urls) {
        const res = await page.goto(url);
        expect(res?.status(), url).toBe(200);
        await expect(page.getByRole("heading", { level: 1 }), url).toHaveCount(1);
        await expectNoSidewaysScroll(page, url);
        await expectAccessible(page, url);
      }
      expect(problems, "nothing refused by the security policy, nothing thrown").toEqual([]);
    });
  }

  test("reads well in the dark, too: the front pages and the pages that show the colours", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: "dark" });
    for (const url of [
      "/guides/",
      "/guides/fair/honest-by-design/",
      "/docs/",
      "/docs/concepts/trust-model/",
      "/docs/design/foundations/",
      "/docs/design/components/",
      "/docs/design/conformance/",
    ]) {
      await page.goto(url);
      await expectNoSidewaysScroll(page, `${url}, dark`);
      await expectAccessible(page, `${url}, dark`);
    }
    await shot(page, info, "docs-components-dark");
  });

  test("shows the design system with the real stylesheet, in both themes", async ({
    page,
  }, info) => {
    await page.goto("/docs/design/foundations/");
    await expect(page.locator(".swatch")).toHaveCount(23);
    const colour = (sel: string) =>
      page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
    const brandLight = await colour(".sw-brand i");
    expect(brandLight).not.toBe("rgba(0, 0, 0, 0)");
    await shot(page, info, "docs-foundations-light");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await colour(".sw-brand i"), "the swatch follows the theme").not.toBe(brandLight);

    await page.goto("/docs/design/components/");
    await expect(page.locator(".demo .btn.danger")).toBeVisible();
    await expect(page.locator(".demo .tile.lead")).toHaveCount(3);
    const height = await page
      .locator(".demo .btn")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height, "a button is at least 44px high, as the system says").toBeGreaterThanOrEqual(44);
  });

  test("has a door each way between the people’s guides and the technical docs", async ({
    page,
  }) => {
    await page.goto("/guides/");
    await expect(page.getByRole("heading", { level: 1, name: "Guides" })).toBeVisible();
    const switcher = page.getByRole("navigation", { name: "Documentation" });
    await expect(switcher.getByRole("link", { name: "Guides" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await switcher.getByRole("link", { name: "Docs" }).click();
    await expect(page).toHaveURL(/\/docs\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Alimentation documentation" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Documentation" })
      .getByRole("link", { name: "Guides" })
      .click();
    await expect(page).toHaveURL(/\/guides\/$/);
  });

  test("is found without a trailing slash, and the app’s own screens are not mistaken for it", async ({
    page,
  }) => {
    for (const [path, heading] of [
      ["/guides", "Guides"],
      ["/docs", "Alimentation documentation"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Guides" }).first()).toHaveAttribute(
      "href",
      "/guides/",
    );
  });

  test("searches the site you are in, with the keyboard, and goes to the page found", async ({
    page,
  }) => {
    await page.goto("/guides/");
    const q = page.getByRole("combobox", { name: "Search the guides" });
    await q.fill("late");
    const results = page.getByRole("listbox", { name: "Search results" });
    await expect(results.getByRole("option").first()).toBeVisible();
    // The guides are searched, not the technical docs.
    expect(
      await results.locator("a").evaluateAll((a) => a.map((x) => x.getAttribute("href"))),
    ).toEqual(expect.not.arrayContaining([expect.stringMatching(/^\/docs\//)]));
    await q.press("ArrowDown");
    await q.press("Enter");
    await expect(page).toHaveURL(/\/guides\/.+/);

    await page.goto("/docs/");
    const d = page.getByRole("combobox", { name: "Search the docs" });
    await d.fill("configuration");
    await expect(
      page.getByRole("listbox", { name: "Search results" }).getByRole("option").first(),
    ).toContainText("Configuration");
    await d.fill("zzzzqx");
    await expect(page.getByText("Nothing found. Try a shorter word.")).toBeVisible();
    await d.press("Escape");
    await expect(page.getByRole("listbox", { name: "Search results" })).toBeHidden();
  });

  test("opens on a front page: a hero, a few cards, and no menu beside them", async ({
    page,
  }, info) => {
    for (const { dir, name, first } of [
      { dir: "guides", name: "Guides", first: /Start a kitchen/ },
      { dir: "docs", name: "Documentation", first: /Run it yourself/ },
    ]) {
      await page.goto(`/${dir}/`);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toContainText("Alimentation");
      await expect(h1).toContainText(name);
      await expect(page.getByRole("link", { name: first })).toBeVisible();
      await expect(page.getByRole("navigation", { name: `${name} contents` })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
      const cards = page.locator("main .feature");
      expect(await cards.count()).toBeGreaterThanOrEqual(3);
      await shot(page, info, `docs-front-${dir}`);
      // A card is a whole link: it goes to the page it names, which has the menu.
      const href = await cards.first().getAttribute("href");
      await cards.first().click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });

  test("has a menu that opens on a phone and a contents list beside the page on a wide screen", async ({
    page,
    isMobile,
  }, info) => {
    await page.goto("/docs/concepts/billing-engine/");
    const nav = page.getByRole("navigation", { name: "Docs contents" });
    if (isMobile) {
      await expect(nav).toBeHidden();
      const menu = page.getByRole("button", { name: "Menu" });
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(nav.getByRole("link", { name: "The trust model" })).toBeVisible();
      await expectAccessible(page, "the open menu");
      await shot(page, info, "docs-menu-open");
    } else {
      await expect(nav).toBeVisible();
      await expect(nav.getByRole("link", { name: "The billing engine" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
    }
  });

  test("opens only the part being read in the contents, and any other part at a touch or a key", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/docs/lifecycle/bundle-and-move/");
    if (isMobile) await page.getByRole("button", { name: "Menu" }).click();
    const nav = page.getByRole("navigation", { name: "Docs contents" });
    await expect(nav.locator("details.docs-group[open]")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Bundles and moves" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Install a trial instance" })).toBeHidden();

    // A part is opened by its heading, with the keyboard as well as a touch.
    const heading = nav.getByText("Self-hosting", { exact: true });
    await heading.focus();
    await page.keyboard.press("Enter");
    await expect(nav.getByRole("link", { name: "Install a trial instance" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(nav.getByRole("link", { name: "Install a trial instance" })).toBeHidden();
  });

  test("keeps a name in the tables whole where it fits, and a table never pushes the page sideways", async ({
    page,
  }) => {
    await page.goto("/docs/self-hosting/configuration/");
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll(".docs-article td:first-child code")]
        .filter((c) => !c.querySelector("wbr"))
        .filter((c) => c.getClientRects().length > 1)
        .map((c) => c.textContent),
    );
    expect(broken, "a short piece of code is not broken across lines").toEqual([]);
    await expectNoSidewaysScroll(page, "the configuration page");
  });

  test("has the same tiffin in its bar as the home page, packed as the page is read", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/guides/how/bills/");
    const can = await page.evaluate(() => CSS.supports("animation-timeline: scroll()"));
    test.skip(!can, "this browser cannot tie an animation to the scroll");
    const packed = () =>
      page.evaluate(() =>
        [1, 2, 3, 4].map((n) => {
          const m = new DOMMatrix(
            getComputedStyle(document.querySelector(`.docs-mark .mark-fill-${n}`)!).transform,
          );
          return Math.round(m.a * 100) / 100;
        }),
      );
    await expect.poll(packed).toEqual([0, 0, 0, 0]);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect.poll(packed).toEqual([1, 1, 1, 1]);
  });

  test("copies code, and scrolls a wide table inside itself rather than the page", async ({
    page,
    context,
    isMobile,
    browserName,
  }) => {
    await page.goto("/docs/self-hosting/install/");
    const copy = page.getByRole("button", { name: "Copy this code" }).first();
    await expect(copy).toBeVisible();
    // Only Chromium can be given leave to read the clipboard.
    if (!isMobile && browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await copy.click();
      await expect(copy).toHaveAttribute("data-state", "copied");
      await expect(copy).toContainText("Copied");
      // It says so for a screen reader too, and goes back to being an icon.
      await expect(
        page.getByRole("status").filter({ hasText: "Copied to the clipboard." }),
      ).toHaveCount(1);
      await expect(copy).not.toHaveAttribute("data-state", "copied");
    }
    await page.goto("/docs/self-hosting/configuration/");
    await expectNoSidewaysScroll(page, "the configuration page");
    await expect(page.locator(".tablewrap").first()).toHaveAttribute("tabindex", "0");
  });

  test("shows the copy icon when a block is pointed at or tabbed into, and always where there is no pointer", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/docs/self-hosting/cli/");
    const block = page.locator("figure.code").first();
    const copy = block.getByRole("button", { name: "Copy this code" });
    const shown = () => copy.evaluate((el) => getComputedStyle(el).opacity);
    if (isMobile) {
      expect(await shown(), "with no pointer it is always there").toBe("1");
    } else {
      await page.mouse.move(0, 0);
      await expect.poll(shown, "it keeps out of the way").toBe("0");
      await block.hover();
      await expect.poll(shown, "and comes forward when the block is pointed at").toBe("1");
      await page.mouse.move(0, 0);
      await block.locator("pre").focus();
      await expect.poll(shown, "and when the block has focus").toBe("1");
    }
    // An icon, not a word: the label for a screen reader is on the button, and the picture is hidden from it.
    await expect(copy.locator("svg.i-copy")).toBeVisible();
    await expect(copy.locator("svg")).toHaveCount(2);
    expect(await copy.getAttribute("aria-label")).toBe("Copy this code");
    const box = await copy.boundingBox();
    expect(box!.height, "as high as a small button").toBeGreaterThanOrEqual(36);
    expect(box!.width).toBeGreaterThanOrEqual(36);
  });

  test("draws a console with a prompt the reader cannot select, and copies only what is typed", async ({
    page,
    context,
    isMobile,
    browserName,
  }) => {
    await page.goto("/docs/self-hosting/cli/");
    const block = page.locator("figure.console", { hasText: "keys:rewrap" });
    await expect(block.locator(".code-name")).toHaveText("Console");
    const prompt = await block
      .locator(".line.cmd")
      .first()
      .evaluate((el) => {
        const c = getComputedStyle(el, "::before");
        return { content: c.content, select: c.userSelect };
      });
    expect(prompt).toEqual({ content: '"$"', select: "none" });
    // What came back is there, dimmer than what was typed, and is not marked as a command.
    const colours = await block.evaluate((el) => ({
      out: getComputedStyle(el.querySelector(".line.out")!).color,
      typed: getComputedStyle(el.querySelector(".line.cmd")!).color,
    }));
    expect(colours.out).not.toBe(colours.typed);
    await expectAccessible(page, "a page with a console");
    // Only Chromium can be given leave to read the clipboard.
    if (!isMobile && browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await block.getByRole("button", { name: "Copy this code" }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe("node cli.mjs keys:rewrap");
      expect(copied).not.toContain("$");
      expect(copied).not.toContain("currentKey");
    }
  });

  test("draws a diagram in the page\u2019s own colours, so it follows the theme, under the same policy", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto("/docs/overview/architecture/");
    const figure = page.locator("figure.diagram").first();
    await expect(figure.locator(".diagram-scroll svg")).toBeVisible();
    await expect(figure.locator(":scope > figcaption")).toHaveText(/Where a request goes/);
    const node = figure.locator(".diagram-scroll svg rect").first();
    const paint = () =>
      node.evaluate((el) => {
        const c = getComputedStyle(el);
        return { fill: c.fill, stroke: c.stroke };
      });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    const light = await paint();
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await paint();
    for (const p of [light.fill, dark.fill]) expect(p).toMatch(/^(rgb|color)\(/);
    expect(dark.fill, "a node is another colour in the dark").not.toBe(light.fill);
    expect(dark.stroke).not.toBe(light.stroke);
    // For anyone who cannot see it, and for copying: the diagram as text.
    await figure.getByText("The diagram as text").click();
    await expect(figure.locator("details pre code")).toContainText("flowchart TD");
    await expectNoSidewaysScroll(page, "a page with a diagram");
    expect(problems, "nothing refused by the security policy, nothing thrown").toEqual([]);
  });

  test("numbers the lines of a listing in the margin as they are in the file it shows, and copies only the code", async ({
    page,
    context,
    isMobile,
    browserName,
  }) => {
    await page.goto("/docs/concepts/billing-engine/");
    const block = page.locator("figure.code", { hasText: "EngineData" }).first();
    await expect(block.locator(".code-name")).toHaveText("packages/core/src/engine.ts");
    await expect(block.locator(".code-range")).toHaveText("lines 28\u201339");
    const first = block.locator(".line").first();
    const margin = await first.evaluate((el) => {
      const c = getComputedStyle(el, "::before");
      return { content: c.content, select: c.userSelect };
    });
    expect(margin).toEqual({ content: '"28"', select: "none" });
    // Highlighted: a keyword is not the colour of the text around it.
    const colours = await block.evaluate((el) => ({
      text: getComputedStyle(el.querySelector("code")!).color,
      keyword: getComputedStyle(el.querySelector(".hljs-keyword")!).color,
    }));
    expect(colours.keyword).not.toBe(colours.text);
    // Only Chromium can be given leave to read the clipboard.
    if (!isMobile && browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await block.getByRole("button", { name: "Copy this code" }).click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(await block.locator("code").evaluate((el) => el.textContent));
      expect(copied.startsWith("export interface EngineData {")).toBe(true);
      expect(copied).not.toMatch(/^\s*\d+\s/m);
    }
  });

  test("keeps the copy button where it is while a long line of code is scrolled", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const urls = await pagesOf(page, "docs");
    for (const url of urls) {
      await page.goto(url);
      const wide = page
        .locator("figure.code")
        .filter({ has: page.locator("pre") })
        .evaluateAll((all) =>
          all.findIndex(
            (f) =>
              // One that is shut away in a disclosure cannot be scrolled, or its button found.
              !f.closest("details:not([open])") &&
              f.querySelector("pre")!.scrollWidth > f.querySelector("pre")!.clientWidth + 8,
          ),
        );
      const at = await wide;
      if (at < 0) continue;
      const figure = page.locator("figure.code").nth(at);
      const copy = figure.getByRole("button", { name: "Copy this code" });
      await figure.scrollIntoViewIfNeeded();
      const before = await copy.boundingBox();
      await figure.locator("pre").evaluate((el) => (el.scrollLeft = 120));
      expect(await copy.boundingBox(), `${url}: the button stays on the bar`).toEqual(before);
      return;
    }
    test.skip(true, "no listing is wider than its column at this size");
  });

  test("has the menu at the right on a phone, with the name at the left, and the switch and the theme on the next row", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "a phone");
    await page.goto("/docs/self-hosting/cli/");
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const [brand, menu, sw, theme, search] = [
      await box(".docs-brand"),
      await box(".docs-menu"),
      await box(".docs-switch"),
      await box(".docs-theme"),
      await box(".docs-search"),
    ];
    const width = page.viewportSize()!.width;
    expect(menu.x, "the menu is after the name").toBeGreaterThan(brand.x + brand.width);
    expect(Math.abs(menu.y + menu.height / 2 - (brand.y + brand.height / 2))).toBeLessThan(12);
    expect(menu.x + menu.width, "and against the right edge").toBeGreaterThan(width - 30);
    expect(sw.y, "the switch is on the row below").toBeGreaterThan(brand.y + brand.height - 4);
    expect(theme.x, "with the theme at its right").toBeGreaterThan(sw.x + sw.width);
    expect(Math.abs(theme.y - sw.y)).toBeLessThan(16);
    expect(search.y).toBeGreaterThan(sw.y + sw.height - 4);
    await expectNoSidewaysScroll(page, "the docs bar on a phone");
  });

  test("glides between the guides and the docs the way the switch has them, and only then", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/guides/");
    const can = await page.evaluate(
      () =>
        "PageRevealEvent" in window && CSS.supports("selector(:active-view-transition-type(x))"),
    );
    test.skip(!can, "this browser cannot move one page into another");
    await page.addInitScript(() => {
      addEventListener("pagereveal", (e) => {
        const vt = (e as unknown as { viewTransition?: { ready: Promise<void> } }).viewTransition;
        void vt?.ready.then(() => {
          (window as unknown as { __moved: string[] }).__moved = document
            .getAnimations()
            .map((a) => (a as CSSAnimation).animationName)
            .filter(Boolean);
        });
      });
    });
    const moved = () =>
      page.evaluate(() => (window as unknown as { __moved?: string[] }).__moved ?? null);
    const to = async (name: string, url: RegExp) => {
      await page
        .getByRole("navigation", { name: "Documentation" })
        .getByRole("link", { name })
        .click();
      await page.waitForURL(url);
      await page.waitForFunction(() => (window as unknown as { __moved?: unknown }).__moved);
      return moved();
    };
    // To the docs: the new page arrives from the right, as the docs are on the right of the switch.
    expect(await to("Docs", /\/docs\/$/)).toContain("glide-in-from-right");
    // And back: from the left.
    expect(await to("Guides", /\/guides\/$/)).toContain("glide-in-from-left");
    // Within one of them the page only dissolves into the next: nothing glides.
    await page.locator('main a[href^="/guides/"]').first().click();
    await page.waitForURL(/\/guides\/.+/);
    await page.waitForFunction(() => (window as unknown as { __moved?: unknown }).__moved);
    expect((await moved())!.filter((n) => n.startsWith("glide-"))).toEqual([]);
  });

  test("is served under the same strict security policy as the app", async ({ page }) => {
    for (const url of ["/guides/", "/docs/", "/doc-assets/docs.css", "/guides/search-index.json"]) {
      const res = await page.request.get(url);
      expect(res.status(), url).toBe(200);
    }
    const res = await page.request.get("/docs/");
    expect(res.headers()["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers()["content-security-policy"]).toContain("style-src 'self'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
  });
});
