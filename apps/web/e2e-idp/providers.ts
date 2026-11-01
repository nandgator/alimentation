import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * What differs between providers: who the test people are and what their sign-in pages look like.
 * Everything else about signing in is the app's and is the same for all of them, so it is tested once
 * in signin.spec.ts. To add a provider, add its sign-in page here and its kit under dev/idp/providers.
 */

const STATE = join(import.meta.dirname, '..', '..', '..', 'dev', 'idp', '.state');
const secret = (file: string) => readFileSync(join(STATE, file), 'utf8').trim();

export interface Person {
  name: string;
  email: string;
  password: string;
  /** Runs the instance (is in OPERATOR_EMAILS). */
  operator: boolean;
}

export interface Provider {
  /** The first part of the address the sign-in page has. */
  origin: RegExp;
  people: Record<'operator' | 'member', Person>;
  /** On the provider's own page: give who you are, and say yes to what is asked. */
  signIn(page: Page, who: Person): Promise<void>;
  /** The same, giving a wrong password, ending on whatever the provider shows for that. */
  signInWrongly(page: Page, who: Person): Promise<void>;
  /** Refuse to let the app have the person's details, if the provider asks. */
  refuse(page: Page, who: Person): Promise<void>;
}

const authelia = (name: string, operator: boolean): Person => ({
  name,
  email: `${name}@example.com`,
  password: secret(`authelia/password_${name}`),
  operator,
});

const providers: Record<string, () => Provider> = {
  authelia: () => ({
    origin: /^https:\/\/authelia\.localhost:9091\//,
    people: { operator: authelia('alice', true), member: authelia('bina', false) },
    async signIn(page, who) {
      await page.locator('#username-textfield').fill(who.name);
      await page.locator('#password-textfield').fill(who.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('button', { name: 'Accept' }).click();
    },
    async signInWrongly(page, who) {
      await page.locator('#username-textfield').fill(who.name);
      await page.locator('#password-textfield').fill('not-the-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByText('Incorrect username or password').waitFor();
    },
    async refuse(page, who) {
      await page.locator('#username-textfield').fill(who.name);
      await page.locator('#password-textfield').fill(who.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('button', { name: 'Deny' }).click();
    },
  }),
};

/** The provider named by IDP, or null when none is (the tests then skip). */
export function chosen(): { name: string; provider: Provider } | null {
  const name = process.env.IDP ?? '';
  const make = providers[name];
  return make ? { name, provider: make() } : null;
}

export const known = Object.keys(providers);
