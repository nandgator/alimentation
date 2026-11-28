# Interface rewrite: decision record and plan

Status: decided, 2026-11-25. This plan acts on [ui-audit-2026-11.md](ui-audit-2026-11.md), and finding IDs (NAV-, FRM-, DAT-, VIS-) refer to it. Nothing is live, so the rewrite carries no backward compatibility. Routes, components, CSS and tests are replaced outright.

## 1. Decisions at a glance

| # | Decision |
| --- | --- |
| D1 | Visual direction **"Bahi"**: indigo ink on warm ledger paper, with a saffron highlight used only in the brand mark and as a selection marker. Green stops being the brand colour. |
| D2 | **shadcn/ui, Base UI flavour**, installed with the shadcn CLI into `src/components/ui/`. It replaces the six coss/ui files. |
| D3 | **One sans family**, Figtree Variable, for headings and body. Noto Sans Devanagari is the fallback for Devanagari text and ₹. Amounts use tabular numerals. Young Serif is removed. |
| D4 | Libraries: **lucide-react** (icons), **sonner** (toasts), **@tanstack/react-table** (data tables), **react-hook-form + zod + @hookform/resolvers** (forms), **react-day-picker** (calendar), **recharts** through the shadcn Chart component, and **cmdk** through the shadcn Command component. |
| D5 | **Each role has its own home and navigation.** On screen the roles are Admin, Cook and Consumer. The API and database keep `admin`, `supplier` and `member`. |
| D6 | The admin menu drops from 15 entries to 7. Setup and Books become hubs with tabs. |
| D7 | On desktop, the shell is the shadcn **sidebar-07** pattern (it collapses to an icon rail). On phones, it is a top app bar with the page title plus a bottom navigation bar, and More opens a bottom **Sheet**. |
| D8 | Routes change with a 150ms View Transitions fade, and focus moves to the H1 on every route. Loading uses skeletons, never the text "Loading…". |
| D9 | `styles.css` and `home.css` are deleted by the end of the rewrite. The design checker is rewritten for Tailwind and the tokens. |
| D10 | e2e tests select by role, label and text only. Class selectors are not allowed in tests. |

## 2. Visual direction: "Bahi"

### Why

The brief named three candidates: Haldi (turmeric), Cocoa (chocolate) and Bahi (indigo).

- **Haldi.** Its turmeric primary sits within 15° of hue of the amber "owed" state, so a call to action and a warning would look alike.
- **Cocoa.** Brown is the FSSAI non-vegetarian mark. A brown button beside a meal row reads as "non-veg", which is the owner's worry with green turned around.
- **Bahi.** Indigo (hue 272) is far from green (155, paid), amber (60-85, owed) and red (27, overdue), so no money state can be mistaken for the brand. White on indigo measures about 7:1. Indigo is also safe as text, so links, the active nav item and the focus ring need no second colour.

Bahi was the winner. Its known weakness is coldness, a generic fintech look. The fix is warm, paper-like neutrals with hue 85-90, and saffron kept for the brand mark alone.

### Rules for colour meaning

1. Status is always shown three ways: an icon, a word and a colour. Paid is green with a check. Owed is amber with a clock. Overdue is red with an alert icon and bold text. Pending is neutral with a dot-circle icon. Disputed is red with a message icon.
2. No status or brand element is ever a filled circle, square or triangle on or next to a meal row. Those shapes belong to the FSSAI veg and non-veg marks. If dish marking is added later, it draws the FSSAI shapes exactly.
3. Saffron (`--highlight`) is used only for the brand mark, the 2px selected-row marker and the bar under the active tab. It is never text, a status or a button fill.
4. `--border` is for decorative lines only. Control edges use `--input` at 3:1 or more (VIS-02).
5. Warning and info colours never carry text. Text uses their `-foreground` tokens.

### Tokens: light (`:root`)

```css
:root {
  --radius: 0.625rem;
  --background: oklch(0.985 0.004 90);
  --foreground: oklch(0.22 0.02 268);
  --card: oklch(0.998 0.002 90);
  --card-foreground: oklch(0.22 0.02 268);
  --popover: oklch(0.998 0.002 90);
  --popover-foreground: oklch(0.22 0.02 268);
  --primary: oklch(0.43 0.16 272);
  --primary-foreground: oklch(0.985 0.004 90);
  --secondary: oklch(0.955 0.008 85);
  --secondary-foreground: oklch(0.26 0.02 268);
  --muted: oklch(0.965 0.007 85);
  --muted-foreground: oklch(0.49 0.02 268);
  --accent: oklch(0.95 0.025 272);
  --accent-foreground: oklch(0.34 0.12 272);
  --destructive: oklch(0.55 0.2 27);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.915 0.008 85);
  --input: oklch(0.62 0.015 265);
  --ring: oklch(0.55 0.17 272);
  --highlight: oklch(0.75 0.16 55);
  --highlight-foreground: oklch(0.25 0.04 55);
  --success: oklch(0.52 0.12 155);
  --success-soft: oklch(0.96 0.04 155);
  --success-foreground: oklch(0.46 0.11 155);
  --warning: oklch(0.7 0.15 75);
  --warning-soft: oklch(0.96 0.05 90);
  --warning-foreground: oklch(0.45 0.11 60);
  --info: oklch(0.5 0.13 225);
  --info-soft: oklch(0.96 0.03 225);
  --info-foreground: oklch(0.45 0.12 225);
  --chart-1: oklch(0.43 0.16 272);
  --chart-2: oklch(0.62 0.11 195);
  --chart-3: oklch(0.6 0.17 330);
  --chart-4: oklch(0.55 0.03 268);
  --chart-5: oklch(0.7 0.1 300);
  --sidebar: oklch(0.975 0.006 88);
  --sidebar-foreground: oklch(0.26 0.02 268);
  --sidebar-primary: oklch(0.43 0.16 272);
  --sidebar-primary-foreground: oklch(0.985 0.004 90);
  --sidebar-accent: oklch(0.94 0.012 85);
  --sidebar-accent-foreground: oklch(0.22 0.02 268);
  --sidebar-border: oklch(0.91 0.008 85);
  --sidebar-ring: oklch(0.55 0.17 272);
}
```

### Tokens: dark

The same values go in two blocks:

- `:root[data-theme="dark"]`
- `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`

Tailwind's `dark:` variant stays mapped to `[data-theme="dark"]`, which is what `theme.ts` already sets.

```css
:root[data-theme="dark"] {
  --background: oklch(0.17 0.015 268);
  --foreground: oklch(0.96 0.005 90);
  --card: oklch(0.21 0.017 268);
  --card-foreground: oklch(0.96 0.005 90);
  --popover: oklch(0.24 0.018 268);
  --popover-foreground: oklch(0.96 0.005 90);
  --primary: oklch(0.76 0.12 272);
  --primary-foreground: oklch(0.2 0.04 270);
  --secondary: oklch(0.27 0.015 268);
  --secondary-foreground: oklch(0.96 0.005 90);
  --muted: oklch(0.26 0.015 268);
  --muted-foreground: oklch(0.72 0.02 268);
  --accent: oklch(0.3 0.05 272);
  --accent-foreground: oklch(0.92 0.04 272);
  --destructive: oklch(0.7 0.19 22);
  --destructive-foreground: oklch(0.2 0.03 25);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 35%);
  --ring: oklch(0.7 0.13 272);
  --highlight: oklch(0.8 0.15 60);
  --highlight-foreground: oklch(0.22 0.04 55);
  --success: oklch(0.75 0.14 155);
  --success-soft: oklch(0.28 0.05 155);
  --success-foreground: oklch(0.8 0.13 155);
  --warning: oklch(0.82 0.14 85);
  --warning-soft: oklch(0.3 0.05 80);
  --warning-foreground: oklch(0.85 0.13 85);
  --info: oklch(0.75 0.11 225);
  --info-soft: oklch(0.28 0.04 225);
  --info-foreground: oklch(0.8 0.1 225);
  --chart-1: oklch(0.76 0.12 272);
  --chart-2: oklch(0.75 0.11 195);
  --chart-3: oklch(0.72 0.16 330);
  --chart-4: oklch(0.7 0.03 268);
  --chart-5: oklch(0.78 0.09 300);
  --sidebar: oklch(0.2 0.016 268);
  --sidebar-foreground: oklch(0.96 0.005 90);
  --sidebar-primary: oklch(0.76 0.12 272);
  --sidebar-primary-foreground: oklch(0.2 0.04 270);
  --sidebar-accent: oklch(0.27 0.015 268);
  --sidebar-accent-foreground: oklch(0.96 0.005 90);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.7 0.13 272);
}
```

**Contrast gate.** `src/tokens.test.ts` parses `theme.css`, converts every pair to sRGB and checks it against a threshold, in both themes:

| Pairs | Minimum ratio |
| --- | --- |
| foreground on background, card and popover | 7 |
| muted-foreground on background, card and muted | 4.5 |
| primary-foreground on primary; destructive-foreground on destructive | 4.5 |
| each `-foreground` on its `-soft` | 4.5 |
| primary on background (used as link text) | 4.5 |
| input on card; ring on background; chart-1 to chart-5 on card | 3 |

If a pair fails, the engineer changes only the lightness of the failing token, keeps its hue and chroma, and notes the change in this file.

- **Change made by WP0:** light `--chart-5` went from lightness 0.7 to 0.64 (2.75:1 on card, under the 3:1 minimum). Nothing else failed.

### Type, shape and size

- **Family.** Body and headings both use `--font-sans: "Figtree Variable", "Noto Sans Devanagari Variable", system-ui, sans-serif`. Noto Sans Devanagari is loaded with a `unicode-range` of Devanagari plus U+20B9, so ₹ always renders. Code in the docs uses `ui-monospace, "SF Mono", Menlo, monospace`.
- **Scale.**

  | Use | Size | Weight |
  | --- | --- | --- |
  | Body (16px is the phone minimum for inputs) | 14px desktop, 16px phone | 400 |
  | Labels | 14px | 500 |
  | H1 | 24px desktop, 20px phone | 650, tracking -0.01em |
  | H2 | 18px | 600 |
  | Stat figure | 30px | 650, tabular |
  | Captions and badges | 12px, never smaller | 500 |

- **Numbers.** Every amount, count and date column uses `tabular-nums` and is right-aligned.
- **Radius.** `--radius` is 0.625rem. Shadcn derives `rounded-sm/md/lg/xl` from it: controls are `rounded-md`, cards `rounded-xl`, badges `rounded-full`.
- **Size.** Every control is 44px high on touch (`h-11`) and 36px on desktop pointers (`h-9`, under `@media (pointer: fine)`). Touch targets are at least 44×44px.
- **Elevation.** Cards have a 1px border and no shadow. Popovers and menus use `shadow-md`, dialogs and sheets `shadow-lg`.
- **Brand mark.** `Mark.tsx` is redrawn as an indigo ledger bar with a saffron tick. The PWA `theme_color` is `#3730a3`, which is the sRGB of the light primary and must be recomputed in WP0. The app icons are regenerated with `scripts/make-icons.mjs`.

## 3. Component system

### Why shadcn/ui on Base UI

- **No second engine.** The coss/ui components already run on Base UI (`@base-ui/react` 1.9). Shadcn's Base UI flavour uses the same primitives, so the app keeps one headless engine. Adopting Radix would bundle two.
- **Blocks are pasted, not reinvented.** shadcn ships the blocks this plan depends on: sidebar-07, dashboard-01, login-03, the chart blocks and the data-table recipe. Coss has no equivalents.
- **No external dependency at runtime.** The components are copied into the repo and owned by the app, and the six coss files are replaced by their shadcn counterparts.
- **Theme compatibility.** The shadcn variable names in §2 make any block drop in without recolouring.

**Install.** Run `bunx shadcn@latest init` with the Base UI component library, CSS variables, `src/components/ui` as the UI alias, `src/lib/utils.ts` for `cn`, and lucide as the icon library. The CLI writes the exact `style` key into `components.json`; that output is committed as is. Every component is added with `bunx shadcn@latest add`, and no component is written by hand.

**Tailwind.** Preflight is turned on (the reset is no longer skipped). The legacy `styles.css` is imported into a `legacy` layer below `base`, so new components win over it until it is deleted (WP11). The base layer sets `button, input, select, textarea { font: inherit }` (VIS-01).

### Components to add

The components are installed in WP0. Each line gives the component and what it is used for.

- **Buttons and fields:** `button` (adds a `loading` prop: spinner plus busy label, per FRM-10), `button-group`, `input`, `input-group` (₹ prefix), `textarea`, `label`, `field` (Field, FieldLabel, FieldDescription, FieldError, FieldSet, FieldLegend).
- **Choices:** `select` for long lists, `native-select` for long lists on phones, `checkbox`, `radio-group`, `switch`, `toggle-group` (2-4 options, weekday chips).
- **Dates:** `calendar` and `popover`.
- **Dialogs and overlays:** `dialog` (header with close X, sticky footer), `alert-dialog` (destructive confirmations), `sheet` (bottom on phones, right on desktop), `dropdown-menu`, `tooltip`, `command`.
- **Layout:** `tabs`, `card`, `separator`, `scroll-area`, `accordion`, `collapsible`, `breadcrumb`, `sidebar`.
- **Data and status:** `table`, `badge`, `avatar`, `chart`.
- **Feedback:** `skeleton`, `spinner`, `empty`, `progress`, `sonner`.
- **Utility:** `kbd`, `item`.

The Base UI flavour has no `drawer`, which shadcn builds on vaul and Radix. `sheet side="bottom"` takes its place.

### App components

These are built once in WP1 in `src/components/app/`, on top of the ui components:

| Component | What it does | Findings |
| --- | --- | --- |
| `PageHeader` | H1 (tabIndex=-1, focused on route change), description, primary action slot, tabs slot; sets the document title through `usePageTitle` | NAV-01, NAV-02 |
| `PageSkeleton` variants: `StatsSkeleton`, `TableSkeleton`, `ListSkeleton`, `FormSkeleton` | Shown after 150ms and for at least 300ms | NAV-08 |
| `EmptyState` | Built on `empty`: icon, one sentence, primary action | NAV-12 |
| `StatusBadge` | Statuses: paid, owed, overdue, pending, confirmed, disputed, projected, active, invited, disabled; always icon + word | DAT-05 |
| `Money` | Display: ₹0 for zero, a true minus, "Credit ₹580" for credits, column-consistent paise via a `fraction` prop | DAT-04 |
| `MoneyInput` | Input-group with ₹ prefix, `inputMode="decimal"`, normalises on blur | FRM-07 |
| `CountInput` | `inputMode="numeric"`, `type="text"` | FRM-07 |
| `DateField` | Calendar in a popover on desktop and in a sheet on phones; `min`, `max` and preset chips (Today, Yesterday) | FRM-06 |
| `MonthPicker` | "November 2026" labels; the value is kept in the URL search param `?month=2026-11` | FRM-06, NAV-16 |
| `DataTable` | TanStack: sorting, a global search box, faceted filters, pagination "1-50 of N", sticky header and first column, scroll shadows, a row-actions dropdown with a hidden "Actions" header; below 768px it renders an `item` list from a `mobile` column spec | DAT-01, DAT-14 |
| `FormDialog` | A Dialog on ≥768px and a full-height bottom Sheet below; header with close; scrolling body; sticky footer (secondary, then primary); guards a dirty form ("Discard changes?"); initial focus on the title for phones; history entry so Back closes it | FRM-04, FRM-17, NAV-16 |
| `ConfirmAction` | The severity ladder: `level="undo"` acts and shows a toast with Undo; `level="confirm"` opens an AlertDialog with a destructive action on the right and "Keep it" as the default focus; `level="typed"` asks the user to type an exact string, with a copy button and a live "Matches" check | FRM-01, FRM-15 |
| `AppForm`, `FormField` | react-hook-form + zod; `noValidate`; validates on blur once touched, then on change; error under the control with `aria-invalid` and `aria-describedby`; an error summary that takes focus when the form has more than three fields; `mapServerError(code) → field` | FRM-02, FRM-03 |
| `NotAvailable` | For 404, role-denied and not-a-member | NAV-10 |
| `toast` helpers | Wrap sonner; `success(msg, {action})`, `error`, `undo(msg, fn)`; 6s duration; pause on hover and focus; close button | FRM-10 |
| `useUrlState` | Typed search-param state for the month, tab and filters | NAV-16 |

## 4. App shell and navigation

### Routes

All routes are new paths. The old paths are deleted, and no redirects are kept.

| Path | Screen | Roles |
| --- | --- | --- |
| `/w/:slug` | Home (the role's own) | all |
| `/w/:slug/today` | Today | admin, cook |
| `/w/:slug/meals` | Meals (the log: "My meals" for a consumer) | all |
| `/w/:slug/payments` | Payments | all (when money is on) |
| `/w/:slug/history` | History | cook, consumer |
| `/w/:slug/people`, `/w/:slug/people/:id` | People, person detail | admin |
| `/w/:slug/bills`, `/w/:slug/bills/:personId` | Bills, one statement | admin (consumers see their own statement on Home) |
| `/w/:slug/setup/{items,menu,prices,rules,holidays}` | Setup hub | admin |
| `/w/:slug/books/{month-end,settlements,older,audit,data}` | Books hub | admin |
| `/app`, `/app/new`, `/app/operator`, `/app/org/:id` | Kitchens, new kitchen, operator, organisation | signed in |
| `/signin`, `/join/:token`, `/r/:id` | Sign in, join, receipt | public |

When money is off, Payments, Prices and Bills are hidden and "Rules" keeps its name. This replaces the old "Rates & rules" versus "Rules" switch.

### Navigation by role

| Role | Desktop sidebar (in order) | Phone bottom bar | Under phone More |
| --- | --- | --- | --- |
| Admin | Home, Today, People, Payments, Bills, Setup, Books | Home, Today, Payments, People, More | Bills, Setup, Books |
| Cook | Today (home), Meals, Payments, History | Today, Meals, Payments, History | no More |
| Consumer | Home, Meals, Pay, History | Home, Meals, Pay, History | no More |

The labels are fixed: "Pay" for consumers and "Payments" for admins and cooks. The Payments badge appears only for admins and counts claims to confirm; the Pay badge for consumers counts what they owe as "1 due". Every item has a lucide icon:

| Item | Icon |
| --- | --- |
| Home | `House` |
| Today | `CalendarCheck` |
| Meals | `UtensilsCrossed` |
| Payments, Pay | `IndianRupee` |
| People | `Users` |
| Bills | `ReceiptText` |
| Setup | `SlidersHorizontal` |
| Books | `BookOpen` |
| History | `History` |

### The desktop shell (≥1024px; block sidebar-07)

- **Sidebar header: the kitchen switcher.** It is a DropdownMenu, built after the sidebar-07 TeamSwitcher, that lists the user's kitchens and then "All kitchens" (`/app`). Operators also get an "Operator" entry (`/app/operator`).
- **Sidebar content.** The role's items appear as one flat group, with no group labels.
- **Sidebar footer: NavUser.** It opens a DropdownMenu with:
  - The name and email.
  - "View as" (a radio group of the user's roles), shown only when the user has more than one role.
  - Theme (Light, Dark or System).
  - "Help and guides ↗", which opens in a new tab.
  - "Times in Asia/Kolkata", shown as a caption.
  - Sign out.
- **Collapsing.** The sidebar collapses to an icon rail, with tooltips on the icons. Its state persists in a cookie or localStorage. A `SidebarTrigger` sits in the page header, with `Ctrl/Cmd+B`.
- **Page header bar.** It holds the trigger, a breadcrumb (Kitchen › Section › Tab or record) and a `⌘K` search button.
- **Command menu (`⌘K`, `/`).** It searches three groups: Go to (sections), People (admin), and Actions ("Log a meal", "Record a payment", "Add a person", "New prices"). It is shown on desktop for all roles.

### The phone shell (<1024px)

- **Top app bar.** It is 56px and sticky. It shows a back arrow on detail routes, or the kitchen avatar, which opens the kitchen switcher sheet. Next to it is the page title (from the registry) and, on the right, the account avatar, which opens the NavUser menu as a bottom sheet. Sign out appears only inside that menu (NAV-03).
- **Bottom bar.** It is 64px plus the safe-area inset. Each item is an icon above a 12px label with a 48px target. The active item is drawn in primary with a saffron 2px top bar. More is marked active when the current section lives under it (NAV-04).
- **More.** It opens a bottom Sheet with a scrim, a drag handle, a close button and Esc, and traps focus. Its items are rows with an icon and a label.
- **Sticky page action.** A page's primary action sits as a full-width button above the bottom bar, for example "Log a meal" on Today and "I paid" on Pay.

### Behaviour on every route change (in `src/shell/RouteEffects.tsx`)

1. Set `document.title` to `{Page} · {Kitchen} · Alimentation`. Pages outside a kitchen drop the kitchen part (NAV-01).
2. Scroll to the top, unless the change is a back or forward navigation, which restores the scroll position. Focus the page H1 (NAV-02).
3. Announce the title in a polite live region.
4. Run a View Transition, as described in §6.
5. Draw a thin 2px primary progress bar at the top while lazy chunks or data are pending for more than 150ms.

The first focusable element is a "Skip to content" link, which becomes visible on focus.

### Boot and state

- **Instant shell.** The shell is drawn at once from the cached bootstrap. On a cold start it shows the sidebar skeleton and the page skeleton (NAV-08).
- **Data.** Data is fetched per page, and the old data stays on screen while it refetches. A refetch replaces `reload()` everywhere.
- **Banners.** Offline and migrating states are a single status bar above the page header with a fixed reserved height. Setup gaps move to the admin home checklist (NAV-11, NAV-12).
- **Switching role.** A role switch is a client-side state change. It lives in the `?as=` search param and persists to localStorage. It navigates to the new role's home and shows the toast "Now viewing as Cook". It never reloads the page (NAV-09).

## 5. Page-by-page specs

Every page is built from the same parts:

- A `PageHeader`.
- One primary action.
- A skeleton that matches the layout.
- An `EmptyState`.
- An error state: an inline Alert with "Try again" that keeps the last data.
- A success toast where an action applies.

The specs below list only what differs from that.

### Sign in (`/signin`). Block: login-03

- A centred card, with the brand mark above it.
- Step 1 asks for the email (`inputMode="email"`, `autoCapitalize="none"`, `spellCheck={false}`, `autoComplete="email"`).
- Step 2 asks for "Your name" only if the account is new.
- The button reads "Continue" and shows "Signing in…" with a spinner while busy.
- Errors are inline (FRM-14).

### Join (`/join/:token`)

- A card that reads "{Admin} invited you to {Kitchen} as a Consumer". It carries a primary "Join" and, when signed out, an email step.
- An expired or used token shows `NotAvailable` with the reason "This invite has expired. Ask your admin for a new one."

### Kitchens (`/app`)

- The H1 is "Your kitchens", with a primary "New kitchen" button.
- The list uses `item` rows: avatar initial, name, the role badges, and "3 people · ₹12,400 owed" where money is on. Slugs are hidden.
- A "Manage" dropdown holds "Copy a setup" (it opens a FormDialog) and "Start an organisation".
- Operators get a summary row of three stat cards above the list.
- The empty state reads "You are not in a kitchen yet" and offers "New kitchen".

### New kitchen (`/app/new`)

- A full page with one column, max 560px.
- **Name.** The address is derived from it with a live check (debounced 300ms) that shows a check icon for "Available" or "Taken. Try demo-mess-2."
- **Start from.** Radio cards, each with a bold title and a muted description.
- **Money.** Two radio cards, neither selected by default:
  - "Track money: bills, payments and balances".
  - "Meals only: no money, can't be turned on later".

  The consequence is stated in bold.
- Submit reads "Create kitchen" and is full width on phones. On success the user lands in the new kitchen's admin Home with its checklist (FRM-09).

### Operator (`/app/operator`), Organisation (`/app/org/:id`)

- A PageHeader with tabs: Kitchens, People, Settings.
- Lists use DataTable.
- Destructive operations use `ConfirmAction level="typed"`.

### Home: admin (`/w/:slug`). Starts from block dashboard-01, reduced

- **Setup checklist card.** It appears only while setup is incomplete. It is a task list (People, What you serve, Menu, Prices) with "2 of 4 done", and each row is a link with a status icon.
- **"Needs you" card.** It shows claims to confirm (a count and the first three, each with Confirm or Open), disputed claims, and entries logged late. Its empty state reads "Nothing waiting. ✓".
- **Stats.** One row of three cards: "Owed to the kitchen" (Money, large), "Collected this month", and "Eating today" (a count linking to Today). A projected month shows the caption "Projected to month end".
- **Today strip.** Today's menu and the headcount per meal, linking to Today.
- **Copy.** The H1 is the kitchen name and the description is the date, e.g. "Wednesday, 25 Nov 2026".

### Home: consumer (`/w/:slug`)

- **Hero card.** "You owe ₹1,250 for November" (or "You're all paid up", or "Credit ₹580"), shown with a StatusBadge and a primary "Pay" button.
- **This month.** A compact bill statement (see Bills), collapsible.
- **Your next meals.** Today and tomorrow, with "Skip" chips that act as undo-level actions.
- **Recent.** The last three history items and "See all".

### Today (`/w/:slug/today`; this is the cook's home)

- **Header.** A date switcher of chips for Yesterday, Today and Tomorrow, plus a calendar button.
- **Meal tabs.** Breakfast, Lunch and Dinner.
- **Each tab:**
  - The menu for that meal.
  - The headcount: "18 eating · 2 on leave".
  - A searchable list of people with toggle chips for eating, leave and extra. Each tap saves optimistically and shows an Undo toast.
- The sticky phone action is "Log a delivery" for cooks and "Log a meal" for admins.
- Skeleton: the tabs plus 8 list rows.

### Meals (`/w/:slug/meals`)

- **Consumer: intent buttons first.** "Skip a meal", "Add an extra" and "Guest". Each opens a FormDialog that asks for date chips (today, tomorrow, the next 7 days, or a calendar) and the meals (a toggle group). A note is under "More details".
- **Admin and cook.** The same intents, plus a person picker.
- **Below the intents.** A list of entries grouped by day, with a StatusBadge and row actions in a menu: Edit, or Remove at undo level.
- **Copy.** "Change: Leave" becomes "Skip". Late entries show "Added 8 days after".
- An error such as "already logged" sits under the Date field (FRM-02, FRM-16).

### Payments / Pay (`/w/:slug/payments`)

- **Admin.** Tabs in the URL: To confirm (default, with a badge), Pending, Confirmed, Disputed, All.
  - The DataTable columns are Person, Month ("Nov 2026"), Amount, Method, Paid on, and Status. A dispute note appears as a second line.
  - Row actions in a menu: Confirm (undo level), Dispute (FormDialog), and Reverse (`ConfirmAction confirm`). The reason is marked "Required", and the effect is stated: "Kabir's November payment goes back to pending."
  - A footer shows the total for the filtered set.
  - The primary action is "Record a payment", which opens a FormDialog.
- **Consumer.**
  - The hero shows what is due.
  - "I paid" opens a FormDialog, pre-filled with:
    - the amount due (MoneyInput)
    - the current month
    - the last method used, as a toggle group (UPI, Cash, Bank)
    - today's date
    - a reference marked optional, with a counter
  - Below it is the list of my claims, with StatusBadges.
- **Cook.** What the kitchen owes the cook and what has been paid, as a read-only list.

### History (`/w/:slug/history`)

- A feed grouped by day, with a sticky day heading on each.
- Each row has a type icon (bill, payment, meal, menu), a short sentence with the amount or date in bold, and the time on the right.
- Filter chips in the URL: All, Bills, Payments, Meals.
- The pager reads "Show older (24 more)" (DAT-11).

### People (`/w/:slug/people`, `/people/:id`)

- **Table.** A DataTable with the columns Name (the email under it), Roles (badges, one row per person whatever their roles), Eats (a services summary that wraps), Account (Active or Invited, as a StatusBadge), and From.
  - A search box.
  - Filter chips: Consumers, Cooks, Admins, Disabled. Disabled people are hidden by default.
  - On phones the rows become an `item` list.
- **Actions.** The primary is "Add a person" (a FormDialog of Name, Role as radio cards, and Eating from; Contact, Key and Until sit under "More details"). A secondary "Import" opens the import FormDialog.
- **Import.** A file button styled as a drop zone, a link to the template, and a code block that wraps. The modes are radio cards: Merge (recommended), or Overwrite with a warning badge. A preview step ("12 to add, 3 to update, 0 errors") comes before Apply (FRM-08).
- **Person detail.** A page with tabs: Overview, Meals, Payments, Bill. Actions: Invite (the title reads "Invite Asha Rao"), Edit, and Disable (`ConfirmAction confirm`).

### Bills (`/w/:slug/bills`, `/bills/:personId`)

- **Header.** The MonthPicker in the URL. A projected month is badged "Projected", with a tooltip: "Figures to date plus the rest of the month as planned."
- **Stats.** Three cards: Billed, Collected, Owed.
- **Chart.** The shadcn Chart, as a bar chart with two series (Billed on chart-1, Collected on chart-2) over the last 6 months. It has a tooltip on hover and focus, a key that reads "* projected", and a table fallback through "Show as table".
- **Table.** A DataTable with Name, Balance (sorted highest first) and Status, plus a row detail Sheet showing Meals, Leave, Bill, Paid, Earlier unpaid and Claimed. On phones it becomes cards with the balance in large type.
- **Statement** (sheet on desktop, its own route on phones):
  - A header with the person, the period and the status.
  - Lines of Item, Qty, Rate and Amount.
  - Subtotal, Payments and Balance due.
  - A bold total row.
  - Actions: "Share receipt" and "Print".
- The per-person bill tables stacked down the page are deleted (DAT-02, DAT-03, DAT-07, DAT-12).

### Setup hub (`/w/:slug/setup/*`)

- **Tabs.** What you serve, Menu, Prices, Rules, Holidays.
- **What you serve.** A DataTable of the items. Adding an item opens a FormDialog. Kind is a radio group, and a count uses CountInput. Retire is `ConfirmAction confirm`: the title reads "Retire Curd?", a checkbox reads "I understand this name stays taken", and the destructive button sits on the right with "Keep it" focused (FRM-01).
- **Menu.** A week grid on desktop. On phones it is a day list with the meals as rows. Editing a day opens a Sheet.
- **Prices.** A list of the price sets, each with "Applies from". "New prices" opens a FormDialog with a sticky footer and MoneyInput rows.
- **Rules.** Settings cards, each with a title, a one-line description and the control. Two- to four-option choices use a toggle group. Working days are seven equal chips. "Change the rules" opens a FormDialog that starts with "Applies from" in a DateField, which does not autofocus.
- **Holidays.** A list of the holidays plus "Add a holiday" (a DateField range in which the end is at least the start) and "Import".

### Books hub (`/w/:slug/books/*`)

- **Tabs.** Month end, Settlements, Older months, Audit, Your data.
- **Month end.** A checklist of month status ("To confirm: 2", "Disputed: 0") and then "Close November 2026" (`ConfirmAction confirm`). An "Entries after close" setting links to Rules.
- **Settlements.** A DataTable and "Record a settlement", a FormDialog with MoneyInput, Note (optional) and the Month.
- **Older months.** A list of the months with retention status. Discarding one is `ConfirmAction typed`, with the month in words.
- **Audit.** A DataTable with a toolbar: search, Person, Action (Added, Changed, Removed), Entity (in plain words) and a date range. Rows are grouped by day, the pager reads "1-50 of N", and the detail opens in a right Sheet with a before/after diff (DAT-06).
- **Your data.** Export cards (CSV, JSON), agent keys (a DataTable plus "New key"), and the Danger zone card (Move, Delete; `ConfirmAction typed`, with the slug).

### NotAvailable (all denials and 404)

- A full page with an icon, an H1 and a reason, then a primary "Go to your home" and a secondary "All kitchens".
- The H1 is "Page not found", "This is for admins" or "You're not in this kitchen".
- The reason for a role denial reads "People is open to admins. Ask {admin name} if you need it."

### Receipt (`/r/:id`)

- A printable statement card. It uses the same statement component as Bills, has print styles, and its only chrome is the site header.

### Home page, guides and docs

- **Site header.** One shared header across all three: the brand mark, Guides, Docs, and then "Open your kitchen" when signed in or "Sign in" when not. When a session exists, the guides and docs show a "Back to {Kitchen}" link (NAV-17).
- **Home page.** It is restyled to the Bahi tokens, with the drawn pictures kept. `home.css` is rewritten to Tailwind utilities. The drawn art keeps only the rules it needs, in `src/home/art.css`.

### Global copy changes

| Old | New |
| --- | --- |
| Supplier, Member (on screen) | Cook, Consumer |
| Dashboard | Home (each role) and Bills (the admin's money statement) |
| Daily | Today |
| My log | Meals ("My meals" for consumers) |
| Catalogue | What you serve |
| Rates & rules / Rules | Rules |
| Month close | Month end |
| Day to day / The kitchen / The books | (no groups) / Setup / Books |
| Change: Leave | Skip |
| insert, update, delete (audit) | Added, Changed, Removed |
| Nov-26, 22-Nov-2026 | Nov 2026, 22 Nov 2026 |
| - (for zero) | ₹0 |
| -₹580 | Credit ₹580 |
| Loading… | (a skeleton, no text) |
| Hide this menu | (the icon trigger, tooltip "Collapse menu ⌘B") |
| Signed in: Yes / Not yet | Account: Active / Invited |
| Older / Older entries | Show older (N more) |

## 6. Motion and transition rules

**Timing tokens.** These are defined in `theme.css`:

| Token | Value |
| --- | --- |
| `--dur-1` | 100ms |
| `--dur-2` | 150ms |
| `--dur-3` | 250ms |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |

**What moves and how:**

| What | Motion |
| --- | --- |
| Route change | View Transitions API. The `main` region has `view-transition-name: page`. The old page fades out over 90ms and the new one fades in over 150ms with a 4px rise. The shell does not animate. Browsers without the API swap instantly. |
| Dialog | Fade, plus a scale from 0.98 to 1, over `--dur-2`. |
| Sheet | Slides from its edge over `--dur-3`. The scrim fades over `--dur-2`. |
| Popover, menu, tooltip | Fade plus a 2px shift over `--dur-1`. Tooltips open after a 300ms delay. |
| Sidebar collapse | Width over `--dur-3`. |
| Toast | Sonner's defaults, positioned bottom-centre on phones (above the bottom bar) and bottom-right on desktop. |
| Skeleton | A pulse that runs for 1.5s. It appears only after 150ms and stays at least 300ms, so it never flashes. |
| Optimistic toggle | The chip changes at once with no animation. A rollback shakes it 2px over 150ms and shows an error toast. |
| Never animated | Money figures, table sorting, or anything on first paint. |

**Reduced motion.** Under `prefers-reduced-motion: reduce`, nothing moves: route, sheet and dialog transitions become instant or an opacity change of 100ms or less, and the skeleton pulse stops.

## 7. What to delete

| What | When | By |
| --- | --- | --- |
| `src/styles.css` (1,895 lines) | After every screen is ported | WP11 |
| `src/home.css` (1,502 lines), replaced by utilities plus `src/home/art.css` | With the home page | WP10 |
| `src/components/ui.tsx` (Form, Field, Spinner, Toaster, Modal) | When its last import is gone | WP11 |
| `src/components/Chrome.tsx`, `ThemeSwitch.tsx` | Replaced by the shell | WP2 |
| `src/components/Chart.tsx` | Replaced by the Bills chart | WP3 |
| The six coss files in `src/components/ui/` | Overwritten by shadcn | WP0 |
| The `@fontsource/young-serif` dependency, and the `--brand`, `--serif` and legacy token aliases in `theme.css` | When tokens are rewritten | WP0 |
| `Shell.tsx` banner stack, `PRIMARY=4` slicing, "Acting as" select, `reload()` calls | Rebuilt | WP2 and each page WP |
| `docs/site/docs/design/**` (the old design-system pages) | Rewritten for Bahi and shadcn | WP10 |

### The design checker (`scripts/check-design.mjs` and `src/design.test.ts`)

WP11 rewrites the checker. The old rules (the radius set, the 2px spacing grid, the breakpoint list and the select-arrow rule) are dropped. The new rules are:

1. **Colours.** No raw colour (hex, rgb, hsl or oklch) outside `src/theme.css`. This covers CSS, TSX class strings and arbitrary Tailwind values such as `bg-[#…]`.
2. **Arbitrary values.** No arbitrary Tailwind length (`[13px]`) outside `src/components/ui/`, unless the line carries `/* design: reason */` or the class has a `// design:` waiver.
3. **Native controls.** Outside `src/components/ui/` and `src/components/app/`:
   - no `type="number"`
   - no native `<input type="date|checkbox|radio|file">`
   - no `<select>`
4. **Reloads.** No `window.location.reload`.
5. **Page titles.** Every file under `src/pages/**` that exports a page renders a `PageHeader` or a `NotAvailable`.
6. **Icons.** No icon other than `lucide-react`. No inline `<svg>` outside `Mark.tsx`, `src/home/` and the chart.
7. **Role names.** No UI string literal containing "Supplier" or "Member". The role labels come from `ROLE_LABEL` only.
8. **Inline styles.** No `style={{` except the CSS-variable passing that charts and the sidebar need, which must carry a waiver.
9. **Status shapes.** No `rounded-full` element with a background fill smaller than 12px next to status text. This enforces the no-dot rule; the check is a heuristic on `size-2` or `size-3` plus `bg-*`.

## 8. How the tests change

**Selectors.** e2e selectors use `getByRole`, `getByLabel` and `getByText` only. Class selectors and `data-testid` are not allowed, except `data-testid` on charts. `e2e/support.ts` gains these helpers: `signInAs(role)`, `openSection(name)` (the sidebar on desktop, the bottom bar or More on phones), `expectToast(text)` and `fillMoney(label, value)`.

**Viewports.** Every spec runs at 390×844 and 1440×900, set as two Playwright projects in `playwright.config.ts`.

**Existing specs and who rewrites them:**

| Spec | Today | Action | Owner |
| --- | --- | --- | --- |
| `layout.spec.ts` | `.shell`, `.topbar`, `.side`, `.subnav`, `.toast` | Rewrite as `shell.spec.ts`. It covers sidebar collapse, the bottom bar per role, More as a sheet with Esc, the kitchen switcher, the account menu, and no horizontal scroll at 390px. | WP2 |
| `theme.spec.ts` | the `html` attribute | Keep and extend: the theme menu item, persistence, and no flash of the other theme. | WP0 |
| `controls.spec.ts` | the select arrow measure | Rewrite: 44px targets on touch, the font inherited by every control, and the visible focus ring. | WP1 |
| `catalogue.spec.ts` | `tr.service-row`, `tr.day-row` | Rewrite for Setup › What you serve and Menu, including the retire confirm. | WP7 |
| `meals-only.spec.ts` | `.tile`, `.k` | Rewrite: no money anywhere (Payments, Prices and Bills hidden; Rules named). | WP3 |
| `people-import.spec.ts` | roles | Update the flow for the preview step. | WP6 |
| `retention.spec.ts`, `agents.spec.ts` | roles | Update the paths to `/books/*`. | WP8 |
| `first-run.spec.ts`, `kitchens.spec.ts` | `main`, two classes | Rewrite for `/app`, `/app/new` and the live address check. | WP9 |
| `home.spec.ts`, `docs.spec.ts` | 30 and 12 class selectors | Rewrite for the shared site header and "Back to kitchen". | WP10 |
| `journey.spec.ts` | three classes | Rewrite last: admin sets up, consumer pays, admin confirms, cook logs, at both viewports. | WP11 |

**New specs:**

| Spec | What it checks | Owner |
| --- | --- | --- |
| `navigation.spec.ts` | A unique title per route; focus on the H1 after navigation; the skip link; the scroll reset; back closing a sheet; the role switch without a reload; NotAvailable for each denial | WP2 |
| `a11y.spec.ts` | axe on every route × role × theme at both viewports, with zero serious or critical violations | WP11 |
| `forms.spec.ts` | Inline errors with `aria-invalid`; the error summary takes focus; a server error lands on its field; the dirty-form guard; the sticky footer is visible at 390×844 | WP1 |

**Unit tests:**

| Test | What it covers | Owner |
| --- | --- | --- |
| `sections.test.ts` | The nav per role and per money mode, rewritten | WP2 |
| `format.test.ts` and the `packages/core` money tests | ₹0, the true minus, Credit, column paise, the date and month formats | WP1 |
| `tokens.test.ts` | The contrast gate in §2 | WP0 |
| `design.test.ts` | Follows the new checker | WP11 |

## 9. Implementation plan

The work is split into twelve packages, WP0 to WP11. Each file has exactly one owner. A package may import another's public components but never edits its files. If a package needs a change elsewhere, it asks the owner, or adds a `// TODO(WPn)` comment and works around the gap.

**Phases:**

| Phase | Packages | Notes |
| --- | --- | --- |
| A | WP0 | Alone, about 3 days. |
| B | WP1 and WP2 | In parallel. WP1 publishes its component signatures, as stubs, on day 1 of the phase. |
| C | WP3 to WP10 | In parallel, once WP1 and WP2 have landed their first usable slice. |
| D | WP11 | Last. |

### WP0. Foundation (blocking)

**Owns:**

- `package.json` and the lockfile
- `components.json`
- `src/theme.css`
- `src/lib/utils.ts`
- `src/components/ui/**`
- `src/components/Mark.tsx`
- `index.html`
- `src/main.tsx`
- `vite.config.ts` (the PWA manifest colours)
- `scripts/make-icons.mjs` and `public/` icons
- `src/tokens.test.ts`
- `e2e/theme.spec.ts`

**Does:**

1. Adds the dependencies from D4 and removes Young Serif.
2. Runs shadcn init and adds every component in §3.
3. Writes the tokens from §2, the dark blocks, the motion tokens, preflight, the control font inherit, and `styles.css` moved into the lowest `legacy` layer.
4. Redraws the mark and regenerates the icons.
5. Makes the mechanical move commit: workspace views are moved, with no change in behaviour, to the folder layout in the table below, and the imports are fixed. `Money.tsx` is split into `setup/Holidays.tsx`, `books/Settlements.tsx` and `books/MonthEnd.tsx`.

| Folder | Files moved there |
| --- | --- |
| `src/pages/workspace/home/` | Dashboard |
| `today/` | Daily |
| `meals/` | LogPage |
| `payments/` | Payments |
| `history/` | History |
| `people/` | People, PeopleImport |
| `bills/` | BillLines |
| `setup/` | Catalogue, Menu, Prices, Rates, Holidays |
| `books/` | Settlements, CloseMonths, Retention, Audit, YourData, AgentKeys |

**Accepted when:**

- `bun run build` passes.
- `tokens.test.ts` passes in both themes.
- Every control renders in Figtree.
- The existing screens still render. They may look rough, but they must work, and the current e2e suite passes apart from the specs that select by class.
- `theme.spec.ts` passes.

### WP1. App kit

**Owns:**

- `src/components/app/**`
- `src/hooks/**`
- `src/format.ts` and `format.test.ts`
- `packages/core/src/money.ts` (formatting only) and its tests
- `e2e/controls.spec.ts`
- `e2e/forms.spec.ts`

**Does:** builds every component in the §3 app-components table, and the form helpers with `mapServerError`. It also adds a `/dev/kit` route, available only in development, that shows every component in every state at both viewports.

**Accepted when:**

- Each component is shown on `/dev/kit` in light and dark, and in its empty, loading, error and disabled states.
- DataTable switches to a list at 767px.
- FormDialog becomes a sheet below 768px, with the footer visible at 390×844.
- `ConfirmAction` covers all three levels.
- `Money` passes the format tests (₹0, U+2212, Credit).
- `controls.spec` and `forms.spec` pass.
- axe reports no violations on `/dev/kit`.

### WP2. Shell and navigation

**Owns:**

- `src/App.tsx`
- `src/shell/**`, the new home of the shell, route effects, the command menu and the kitchen switcher
- `src/pages/workspace/Shell.tsx`, which is deleted
- `sections.ts` and `sections.test.ts`
- `context.tsx`
- `src/theme.ts`
- `src/components/Chrome.tsx` and `ThemeSwitch.tsx`, which are deleted
- `e2e/layout.spec.ts`, which becomes `shell.spec.ts`
- `e2e/navigation.spec.ts`

**Does:** everything in §4: the routes table, the per-role nav, sidebar-07 on desktop, the phone top bar, bottom bar and More sheet, NavUser, the role switch, the command menu, the route effects, View Transitions, the progress bar, the skip link, the boot skeleton, the status bar, and `NotAvailable` wiring for every denial.

**Accepted when:**

- Every finding NAV-01 to NAV-11 and NAV-13 to NAV-17 is closed for the shell. NAV-12 is closed by WP3.
- No horizontal scroll at 390px.
- The admin sidebar fits 1440×900 with no clipping.
- A role switch does not reload the page.
- `shell.spec`, `navigation.spec` and `sections.test` pass.

### WP3. Homes and Bills

**Owns:**

- `src/pages/workspace/home/**`
- `bills/**`
- `src/pages/Receipt.tsx`
- `src/setup.ts` and `setup.test.ts` (the checklist logic)
- `src/components/Chart.tsx`, which is deleted
- `e2e/meals-only.spec.ts`

**Does:** the admin and consumer Homes, Bills with its chart, table and statement, and the Receipt, all as in §5.

**Accepted when:**

- DAT-02, DAT-03, DAT-07, DAT-08, DAT-12 and NAV-12 are closed.
- The admin home shows the checklist on `demo-empty` and the "Needs you" card on `demo-mess`.
- A consumer sees what they owe above the fold at 390×844.
- `meals-only.spec` passes.

### WP4. Today, Meals, History

**Owns:**

- `today/**`
- `meals/**`
- `history/**`
- `src/logForm.ts` and `logForm.test.ts`

**Does:** Today, built around its tabs with optimistic toggles; Meals, with its intents and FormDialogs; and History, grouped by day.

**Accepted when:**

- FRM-16, DAT-11 and the log part of FRM-02 and FRM-06 are closed.
- A consumer can skip tomorrow's lunch in three taps or fewer, from Home or Meals.
- A toggle on Today updates in under 100ms, rolls back if the server fails, and offers Undo.

### WP5. Payments

**Owns:**

- `payments/**`

**Does:** the admin tabs and DataTable; the consumer's Pay flow with its pre-fills; the cook's view; and the Reverse, Dispute and Confirm actions through `ConfirmAction`.

**Accepted when:**

- DAT-10 and FRM-11 are closed, along with the payments part of FRM-07.
- Each claim appears exactly once on screen.
- The amount field opens the decimal keyboard.
- The last payment method is remembered.

### WP6. People

**Owns:**

- `people/**`
- `src/enrolment.ts` and `enrolment.test.ts`
- `e2e/people-import.spec.ts`

**Does:** the People DataTable, which becomes a list on phones; Add person; the person detail page; and Import, with its preview step.

**Accepted when:**

- DAT-01, DAT-09 and FRM-08 are closed, along with the people part of FRM-13.
- Each person appears exactly once, whatever their roles.
- Import shows a preview before applying.
- Import does not overflow at 390px.
- `people-import.spec` passes.

### WP7. Setup hub

**Owns:**

- `setup/**`
- `src/catalogue.ts`, `menuGrid.ts` and `priceForm.ts`, with their tests
- `e2e/catalogue.spec.ts`

**Does:** the Setup tabs, as in §5.

**Accepted when:**

- FRM-01, FRM-12 and FRM-19 are closed, along with the setup parts of FRM-04, FRM-06 and FRM-07.
- Retire is red, requires its checkbox, and "Keep it" has default focus.
- The Rules dialog footer is visible on open at 390×844 and at 1440×900.
- `catalogue.spec` passes.

### WP8. Books hub

**Owns:**

- `books/**`
- `src/retention.ts` and `retention.test.ts`
- `e2e/retention.spec.ts` and `agents.spec.ts`

**Does:** Month end, Settlements, Older months, Audit and Your data, as in §5.

**Accepted when:**

- DAT-06 and FRM-15 are closed.
- Audit filters, search and pages through rows, with the filters kept in the URL.
- Every typed confirm shows the string to copy and whether the typed text matches.
- The mutation score on `retention.ts` stays at or above 99%.

### WP9. Outside the workspace

**Owns:**

- `src/pages/SignIn.tsx`, `Join.tsx`, `Places.tsx`, `ManyKitchens.tsx`, `CopySetup.tsx`, `Operator.tsx` and `Organisation.tsx`
- `src/pages/workspace/HeadOffice.tsx`
- `src/kitchens.ts`, `copySetup.ts` and `starters.ts`, with their tests
- `e2e/first-run.spec.ts` and `kitchens.spec.ts`

**Does:** Sign in, Join, `/app`, `/app/new`, Operator and Organisation, as in §5.

**Accepted when:**

- FRM-09 and FRM-14 are closed.
- The address check shows its result before submit.
- The money choice has no default.
- Sign-in asks for a name only for new accounts.

### WP10. Public site and docs

**Owns:**

- `src/pages/Home.tsx`, `src/home/**` and `src/home.css`, which is deleted and replaced by `src/home/art.css`
- `scripts/build-docs.mjs`, `scripts/docs-blocks.mjs` and `scripts/docs/**`
- `docs/site/docs/design/**`
- `e2e/home.spec.ts` and `docs.spec.ts`

**Does:**

- Builds the shared site header and the "Back to kitchen" link.
- Restyles the home page to Bahi.
- Points the docs CSS at the tokens.
- Rewrites the design-system docs to describe this plan's tokens, components and rules.

**Accepted when:**

- NAV-17 is closed.
- No green brand colour remains on any public page.
- `home.spec` and `docs.spec` pass using role and text selectors.

### WP11. Checker, journey, cleanup (last)

**Owns:**

- `scripts/check-design.mjs` and `src/design.test.ts`
- `src/styles.css` and `src/components/ui.tsx`, both deleted
- `e2e/support.ts` and `seed.ts`, which the other packages may extend by asking WP11
- `e2e/journey.spec.ts`
- `e2e/a11y.spec.ts`
- `playwright.config.ts`

**Does:**

1. Writes the new checker from §7.
2. Deletes the legacy CSS and `ui.tsx` once nothing imports them.
3. Writes the journey and a11y specs.
4. Adds the two viewport projects to the Playwright config.
5. Writes a final pass over the audit: every finding ID is marked Closed, each with the commit that closed it, in a table appended to `ui-audit-2026-11.md`.

**Accepted when:**

- `styles.css`, `home.css` and `ui.tsx` are gone.
- The checker reports no violations.
- axe reports no serious or critical violations on any route × role × theme × viewport.
- The full e2e suite, the unit tests and the build all pass.
- The audit's closure table has no open IDs.

**Day-one rule.** Until WP1 publishes its stubs, Phase C packages may start only on data and logic in their own folders. Every page ships through `PageHeader`, so no page can leave out its title or focus handling.
