import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedHome } from "./seed.ts";
import { expectAccessible, shot, signIn, watchPage } from "./support.ts";

/** The kitchen's own today, which is where the months are counted from. */
const todayInKitchen = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addMonths = (month: string, n: number): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const WORDS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inWords = (month: string) => `${WORDS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
/** The first Monday of a month, a day on which a meal is served. */
const mondayOf = (month: string): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test("[P8] older months are handed over: prepare, download, upload, type the month, and every bill after it is unchanged", async ({
  page,
}, info) => {
  test.setTimeout(Number(process.env.E2E_TIMEOUT ?? 240_000));
  const seen = watchPage(page);
  const stamp = Date.now().toString(36);
  const slug = `old-${info.project.name}-${stamp}`;
  const w = `/api/w/${slug}`;
  const now = todayInKitchen().slice(0, 7);
  const m0 = addMonths(now, -27);
  const m1 = addMonths(now, -26);
  const cut = addMonths(now, -25);
  const live = Array.from({ length: 25 }, (_, i) => addMonths(now, i - 24));
  await signIn(page, `old-${slug}@example.org`, "Owner");

  const ids: Record<string, string> = {};
  await test.step("a kitchen with two members, bills from 27 months back, and something owed", async () => {
    const made = await page.request.post("/api/workspaces", {
      data: { slug, name: `Willow Old ${stamp}`, alsoSupplier: true },
    });
    expect(made.status()).toBe(201);
    const seeded = await seedHome(page.request, slug, { from: `${m0}-01` });
    for (const name of ["Willow", "Maple"]) {
      const person = await page.request.post(`${w}/people`, {
        data: { name, role: "consumer", activeFrom: `${m0}-01` },
      });
      expect(person.status(), await person.text()).toBe(201);
      ids[name] = ((await person.json()) as { id: string }).id;
    }
    const entry = async (date: string, name: string, extra: Record<string, unknown>) => {
      const res = await page.request.post(`${w}/log`, {
        data: {
          date,
          personId: ids[name],
          allConsumers: false,
          serviceId: null,
          itemId: null,
          qty: null,
          ...extra,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
    };
    await entry(mondayOf(m0), "Willow", { action: "Leave" });
    await entry(mondayOf(m1), "Maple", {
      action: "Extra",
      serviceId: seeded.services[0],
      itemId: seeded.chapati,
      qty: 3,
    });
    await entry(mondayOf(now), "Willow", { action: "Leave" });
    // Willow pays part of the first month; Maple pays nothing, so there is something to carry.
    const paid = await page.request.post(`${w}/settlements`, {
      data: { consumerId: ids.Willow, forMonth: m0, type: "Payment", amount: 5000 },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    for (const month of [m0, m1, cut]) {
      const closed = await page.request.post(`${w}/closes`, { data: { month } });
      expect(closed.status(), await closed.text()).toBe(201);
    }
  });

  const statements = async () => {
    const res = await page.request.get(`${w}/statements?months=${live.join(",")}`);
    expect(res.status(), await res.text()).toBe(200);
    return res.json();
  };
  const before = await statements();

  await test.step("near a limit, the Your data screen offers older months before a move", async () => {
    await page.context().route(`**${w}/bootstrap`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body.meter) body.meter = { ...body.meter, state: "ASK" };
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`/w/${slug}/books/data`);
    await expect(page.getByRole("heading", { name: "Your data", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Archive older months" })).toBeVisible();
    await expect(
      page.getByText(`Everything through ${inWords(cut)} can be handed over`),
    ).toBeVisible();
    // It comes ahead of the move.
    const order = await page.evaluate(() => {
      const text = (n: string) => document.body.innerText.indexOf(n);
      return [text("Archive older months"), text("Move to a place of your own")];
    });
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[0]).toBeLessThan(order[1] ?? 0);
    await expectAccessible(page, "your data with the archive banner");
    await page.context().unroute(`**${w}/bootstrap`);
    await page.getByRole("link", { name: "Archive older months" }).click();
    await expect(page.getByRole("heading", { name: "Older months", level: 1 })).toBeVisible();
  });

  await test.step("the screen says what can go, what it frees and who owes", async () => {
    const card = page.getByRole("region", { name: "Hand over" });
    await expect(card.getByText(inWords(cut), { exact: false }).first()).toBeVisible();
    await expect(card).toContainText("freed");
    await expect(card).toContainText("owe");
    await expect(card).not.toContainText(/not_closed|pending_claim|\d{4}-\d{2}/);
    await expectAccessible(page, "older months");
    await shot(page, info, "r1-choose");
  });

  const saved = info.outputPath("handed-over.json");
  await test.step("download: the dialog says to keep the file, and the file is saved", async () => {
    await page.getByRole("button", { name: "Download these months" }).click();
    const dlg = page.getByRole("dialog", { name: /Download everything through/ });
    await expect(dlg).toContainText("Keep this file. There is no second copy.");
    await expect(dlg).toContainText("payments for them are recorded on the first live month");
    await expectAccessible(page, "download dialog");
    await shot(page, info, "r2-download-dialog");
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      dlg.getByRole("button", { name: "Download and keep the file" }).click(),
    ]);
    await file.saveAs(saved);
    expect(file.suggestedFilename()).toMatch(/\.alimentation\.json$/);
    await expect(page.getByRole("heading", { name: "Upload the file you saved" })).toBeVisible();
  });

  await test.step("upload: an altered file is refused, the saved one is accepted", async () => {
    const altered = info.outputPath("altered.json");
    writeFileSync(altered, readFileSync(saved, "utf8").replace("Willow", "Willox"));
    await page.getByLabel("The saved file", { exact: true }).setInputFiles(altered);
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByRole("alert")).toContainText(/damaged or has been altered|not the file/);
    await expectAccessible(page, "refused file");
    await page.getByLabel("The saved file", { exact: true }).setInputFiles(saved);
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByRole("heading", { name: "Remove the months" })).toBeVisible();
    await shot(page, info, "r3-confirmed");
  });

  await test.step("apply: only the typed month removes them", async () => {
    await page.getByRole("button", { name: "Remove these months" }).click();
    const dlg = page.getByRole("alertdialog", {
      name: `Remove everything through ${inWords(cut)}`,
    });
    await expect(dlg).toContainText("Keep this file. There is no second copy.");
    // The month to type is on screen, with a button that copies it, and the screen says whether what is typed matches.
    await expect(dlg.getByRole("button", { name: "Copy" })).toBeVisible();
    const go = dlg.getByRole("button", { name: "Remove for good" });
    const typed = dlg.getByLabel(`Type ${inWords(cut)} to confirm`);
    await expect(go).toBeDisabled();
    await typed.fill(inWords(m1));
    await expect(dlg.getByText("Does not match yet")).toBeVisible();
    await expect(go).toBeDisabled();
    await expectAccessible(page, "apply dialog");
    await shot(page, info, "r4-apply-dialog");
    await typed.fill(inWords(cut));
    await expect(dlg.getByText("Matches", { exact: true })).toBeVisible();
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByRole("heading", { name: "Handed over", exact: true })).toBeVisible();
    await expect(page.getByText(/came out the same, to the paisa/)).toBeVisible();
  });

  await test.step("the cut is on record, in words, and the bills after it are exactly as before", async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Handed over so far" })).toContainText(
      new RegExp(
        `Older records through ${inWords(cut)} were handed over as a backup \\(checksum [0-9a-f]{8}\\) on \\d{1,2} [A-Z][a-z]{2} \\d{4}, confirmed by an administrator\\.`,
      ),
    );
    expect(await statements()).toEqual(before);
    await expectAccessible(page, "older months after the cut");
    await shot(page, info, "r5-after");
  });

  await test.step("the old months are gone from the screens, said in plain words", async () => {
    const gone = new RegExp(
      `Records through ${inWords(cut)} were handed over as a backup and are no longer kept here`,
    );
    const asMonth = (url: string, key: string, value: string) =>
      url.replace(new RegExp(`${key}=[^&]+`), `${key}=${value}`);
    // The pages never ask for these months; a stale address or an old link does. The server's answer is shown.
    const toOld = (r: {
      request(): { url(): string };
      continue(o: { url: string }): Promise<void>;
    }) => r.continue({ url: asMonth(r.request().url(), "months", m0) });
    await page.context().route(`**${w}/statements?*`, toOld);
    await page.goto(`/w/${slug}/bills`);
    await expect(page.getByRole("alert").first()).toContainText(gone);
    await expect(page.getByRole("alert").first()).not.toContainText(/archived_month|\d{4}-\d{2}/);
    await shot(page, info, "r6-bills");

    await page.goto(`/w/${slug}/bills/${ids.Willow}`);
    await expect(page.getByRole("alert").first()).toContainText(gone);
    await page.context().unroute(`**${w}/statements?*`);

    // A day typed into the meals form is checked by the meals spec (WP4); the write itself is checked below.
  });

  await test.step("a write into an archived month is refused with the same words", async () => {
    const res = await page.request.post(`${w}/log`, {
      data: {
        date: mondayOf(m0),
        personId: ids.Maple,
        allConsumers: false,
        action: "Leave",
        serviceId: null,
        itemId: null,
        qty: null,
      },
    });
    expect(res.status()).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("archived_month");
  });

  expect(seen).toEqual([]);
});
