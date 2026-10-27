import type { Role } from '@alimentation/core';

/**
 * Every screen of a kitchen, written down once: its address, its name, where it sits in the menu and
 * who may open it. The menu, the routes and the "not for your role" answer are all read from this
 * list, so a screen cannot be in one and forgotten in another. (The server still decides what each
 * role may do; this only decides what is shown.)
 */
export type SectionKey =
  | 'dashboard'
  | 'daily'
  | 'log'
  | 'payments'
  | 'history'
  | 'people'
  | 'rates'
  | 'holidays'
  | 'settlements'
  | 'close'
  | 'audit'
  | 'data';

export type GroupKey = 'day' | 'kitchen' | 'books';

export interface Section {
  key: SectionKey;
  /** After the kitchen's own address. Empty for the first screen. */
  path: string;
  label: string;
  group: GroupKey;
  roles: readonly Role[];
}

export const GROUP_LABEL: Record<GroupKey, string> = {
  day: 'Day to day',
  kitchen: 'The kitchen',
  books: 'The books',
};

const EVERYONE: readonly Role[] = ['admin', 'supplier', 'consumer'];
const ADMIN: readonly Role[] = ['admin'];

export const SECTIONS: readonly Section[] = [
  { key: 'dashboard', path: '', label: 'Dashboard', group: 'day', roles: EVERYONE },
  { key: 'daily', path: '/daily', label: 'Daily', group: 'day', roles: EVERYONE },
  { key: 'log', path: '/log', label: 'My log', group: 'day', roles: EVERYONE },
  { key: 'payments', path: '/payments', label: 'Payments', group: 'day', roles: EVERYONE },
  {
    key: 'history',
    path: '/history',
    label: 'History',
    group: 'day',
    roles: ['supplier', 'consumer'],
  },
  { key: 'people', path: '/people', label: 'People', group: 'kitchen', roles: ADMIN },
  { key: 'rates', path: '/rates', label: 'Rates & rules', group: 'kitchen', roles: ADMIN },
  { key: 'holidays', path: '/holidays', label: 'Holidays', group: 'kitchen', roles: ADMIN },
  { key: 'settlements', path: '/settlements', label: 'Settlements', group: 'books', roles: ADMIN },
  { key: 'close', path: '/close', label: 'Month close', group: 'books', roles: ADMIN },
  { key: 'audit', path: '/audit', label: 'Audit', group: 'books', roles: ADMIN },
  { key: 'data', path: '/data', label: 'Your data', group: 'books', roles: ADMIN },
];

export const sectionsFor = (role: Role): Section[] =>
  SECTIONS.filter((s) => s.roles.includes(role));

/** The menu for a role, in groups; a group with nothing in it for that role is left out. */
export function groupsFor(role: Role): { key: GroupKey; label: string; sections: Section[] }[] {
  const mine = sectionsFor(role);
  return (Object.keys(GROUP_LABEL) as GroupKey[])
    .map((key) => ({
      key,
      label: GROUP_LABEL[key],
      sections: mine.filter((s) => s.group === key),
    }))
    .filter((g) => g.sections.length > 0);
}

export const hrefOf = (base: string, section: Section) => `${base}${section.path}`;

/** Whether `location` is this screen (or something under it). */
export function isHere(base: string, section: Section, location: string): boolean {
  const href = hrefOf(base, section);
  if (section.path === '') return location === href || location === `${href}/`;
  return location === href || location.startsWith(`${href}/`);
}
