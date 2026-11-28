import type { ComponentType } from "react";
import { Audit } from "../pages/workspace/books/Audit.tsx";
import { CloseMonths } from "../pages/workspace/books/MonthEnd.tsx";
import { Retention } from "../pages/workspace/books/Retention.tsx";
import { Settlements } from "../pages/workspace/books/Settlements.tsx";
import { YourData } from "../pages/workspace/books/YourData.tsx";
import { History } from "../pages/workspace/history/History.tsx";
import { Dashboard } from "../pages/workspace/home/Dashboard.tsx";
import { LogPage } from "../pages/workspace/meals/LogPage.tsx";
import { Payments } from "../pages/workspace/payments/Payments.tsx";
import { People } from "../pages/workspace/people/People.tsx";
import type { SectionKey } from "../pages/workspace/sections.ts";
import { Catalogue } from "../pages/workspace/setup/Catalogue.tsx";
import { Holidays } from "../pages/workspace/setup/Holidays.tsx";
import { Menu } from "../pages/workspace/setup/Menu.tsx";
import { Prices } from "../pages/workspace/setup/Prices.tsx";
import { Rates } from "../pages/workspace/setup/Rates.tsx";
import { Daily } from "../pages/workspace/today/Daily.tsx";

/**
 * What each address shows: the one place the shell is joined to the screens of the packages that own them.
 * When a package renames or splits its screen it changes its line here by asking WP2; the rest of the shell
 * reads only this table and `sections.ts`.
 */

/** A screen that is one page (the hubs are made of their tabs, below). */
export const VIEW: Record<Exclude<SectionKey, "setup" | "books">, ComponentType> = {
  // TODO(WP3): the admin's Home and the consumer's Home are two pages (home/**); today both are the old dashboard.
  home: Dashboard,
  today: Daily,
  meals: LogPage,
  payments: Payments,
  history: History,
  people: People,
  // TODO(WP3): Bills is a screen of its own (bills/**); until it is, it shows the old statements.
  bills: Dashboard,
};

/** A page below a screen: one person, one statement. */
export const DETAIL: Partial<Record<SectionKey, ComponentType>> = {
  // TODO(WP6): the person's page (people/:id) with its tabs.
  people: People,
  // TODO(WP3): one statement (bills/:personId).
  bills: Dashboard,
};

/** The tabs of the two hubs, by their key in `sections.ts`. */
// TODO(WP7, WP8): each hub becomes one page with its own header and tabs (setup/**, books/**); the shell then routes to it whole.
export const TAB_VIEW: Record<string, ComponentType> = {
  items: Catalogue,
  menu: Menu,
  prices: Prices,
  rules: Rates,
  holidays: Holidays,
  "month-end": CloseMonths,
  settlements: Settlements,
  older: Retention,
  audit: Audit,
  data: YourData,
};
