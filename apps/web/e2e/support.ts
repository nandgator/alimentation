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
  await page.screenshot({
    path: info.outputPath(`${info.project.name}-${name}.png`),
    fullPage: true,
  });
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
