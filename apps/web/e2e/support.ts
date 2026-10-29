import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

export async function signIn(page: Page, email: string, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/app');
}

/** Fails on anything a person with a screen reader or low vision would hit, serious or worse. */
export async function expectAccessible(page: Page, where: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map((v) => `${where}: ${v.id} (${v.nodes.length}): ${v.nodes[0]?.html.slice(0, 120)}`),
    'accessibility',
  ).toEqual([]);
}

/** A page wider than the screen is a layout bug: on a phone it also pushes the fixed bar out of reach. */
export async function expectNoSidewaysScroll(page: Page, where: string) {
  const extra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth - (window.visualViewport?.width ?? window.innerWidth),
  );
  expect(extra, `${where}: wider than the screen by ${extra}px`).toBeLessThanOrEqual(1);
}

export async function shot(page: Page, info: TestInfo, name: string) {
  await expectNoSidewaysScroll(page, name);
  const take = () =>
    page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });
  try {
    await take();
  } catch (e) {
    // Now and then the browser itself fails to capture a very tall page ("Unable to capture screenshot", a protocol
    // error that says nothing about the page, and passes when taken again). Only that is tried a second time.
    if (!/Unable to capture screenshot/.test(String(e))) throw e;
    await take();
  }
}

export const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/** A weekday in the current month that has already happened (or today), for an entry that is allowed. */
export function aWorkingDayThisMonth(): string {
  const d = new Date();
  for (let i = 0; i < 31; i++) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    if (t.getMonth() !== d.getMonth()) break;
    if (t.getDay() >= 1 && t.getDay() <= 5)
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  return firstOfMonth();
}

export async function newPerson(context: BrowserContext) {
  const page = await context.newPage();
  return page;
}

/** Collects anything the browser refuses under the page's security policy, or that throws. */
export function watchPage(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) seen.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => seen.push(`script error: ${e.message}`.slice(0, 200)));
  return seen;
}
