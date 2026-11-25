# Interface audit, 2026-11

This audit is the evidence behind [ui-rewrite-plan.md](ui-rewrite-plan.md). It covers the web app in `apps/web` as built on 2026-11-25 (commit `64be810`, branch `build`): every workspace section for the three roles (admin, cook, consumer), the signed-out pages, `/app`, sign-in, join, the receipt, and the guides and docs. A built instance ran at `http://localhost:8787` on demo data. The fixture kitchens are named `demo-mess` and `demo-empty`.

## How it was done

The audit used four lenses: navigation and state, forms and dialogs, data display, and the visual system. Each lens read the screenshots in `apps/web/.audit/shots` (306 captures at 390x844 and 1440x900, light and dark, populated and blank kitchens) and the source in `apps/web/src`. Overlapping findings from different lenses are merged here into one entry.

Each finding carries:

- **Severity.** Critical: it can cause a wrong money or data outcome, or it blocks a primary task on the primary device. High: it hurts a daily task or fails WCAG A/AA. Medium: friction or inconsistency that users work around. Low: polish.
- **Principle.** The heuristic, guideline or standard it breaks.
- **Evidence.** Screenshot names (in `apps/web/.audit/shots`) and source lines.

Limits:

- The title, focus and scroll findings (NAV-01, NAV-02) come from source, not a runtime check.
- Toasts were never captured (`INDEX.md`, "Not captured: Toasts"). FRM-10 rests on source.
- The visual lens report was cut off after its first finding. VIS-02 to VIS-06 are taken from its summary and from the contrast measured on the token proposals.
- Cook and consumer dashboards, and the settlements, close, retention, rates and catalogue screens, were read less closely than the admin screens.

## Counts

| Theme | Critical | High | Medium | Low | Total |
| --- | --: | --: | --: | --: | --: |
| Navigation, shell and state (NAV) | 0 | 8 | 6 | 3 | 17 |
| Forms, dialogs and feedback (FRM) | 1 | 9 | 6 | 5 | 21 |
| Data display (DAT) | 1 | 6 | 7 | 0 | 14 |
| Visual system (VIS) | 0 | 4 | 2 | 0 | 6 |
| **All** | **2** | **27** | **21** | **8** | **58** |

## Findings by screen

The table indexes each finding by the screen where it appears. Findings marked "all" affect every screen and are listed under "Every screen".

| Screen | Findings |
| --- | --- |
| Every screen | NAV-01, NAV-02, NAV-08, NAV-11, NAV-17, FRM-02, FRM-03, FRM-05, FRM-10, FRM-21, DAT-04, DAT-05, DAT-13, DAT-14, VIS-01 to VIS-06 |
| Workspace shell, phone | NAV-03, NAV-04, NAV-09, NAV-13 |
| Workspace shell, desktop | NAV-05, NAV-06, NAV-13, NAV-15 |
| Navigation model and roles | NAV-07, NAV-09, NAV-10, NAV-14 |
| Dashboard (admin) | NAV-12, DAT-02, DAT-03, DAT-07, DAT-08, DAT-12 |
| Dashboard (cook, consumer) | NAV-07, DAT-08 |
| Daily, My log | FRM-06, FRM-12, FRM-16 |
| Payments | FRM-07, FRM-11, FRM-16, DAT-10 |
| History | DAT-11 |
| People, People import | FRM-08, FRM-13, DAT-01, DAT-09 |
| Catalogue | FRM-01, FRM-07, FRM-19 |
| Menu, Prices, Rates and rules, Holidays | FRM-04, FRM-06, FRM-07, FRM-12, FRM-17, FRM-19 |
| Settlements, Month close | FRM-07, FRM-12, FRM-13 |
| Older months, Your data | FRM-15 |
| Audit | DAT-06, NAV-16 |
| Blank kitchen (all sections) | NAV-12 |
| Restricted section, 404 | NAV-10 |
| `/app` (Your kitchens, operator) | NAV-06, FRM-09 |
| Sign in | FRM-03, FRM-14 |
| Home, guides, docs | NAV-17 |

## Critical

### FRM-01. Retiring a catalogue item looks like adding one
- **Screen:** Catalogue, retire dialog.
- **Problem:** Retiring is irreversible ("This cannot be undone, and a retired name stays taken"). Its confirm button, "Retire Curd", still uses the default primary style, the same as the harmless "Add". The safe action, "Keep it", comes second and is outlined. The dialog has no typed or checkbox confirmation, although Retention and Move have one. The title "Retire" does not name the item.
- **Fix:** Use the destructive variant on the left of a footer whose right-hand default is "Keep it". Title it "Retire Curd?". Add a checkbox confirmation, following the severity ladder in FRM-15.
- **Principle:** Nielsen #5 error prevention; Apple HIG (a destructive action is red and never the default); Material 3 dialog button hierarchy.
- **Evidence:** `phone-light-catalogue-retire-dialog.png`, `desktop-light-catalogue-retire-dialog.png`; `src/pages/workspace/Catalogue.tsx` about 215-228.

### DAT-01. Wide tables are cropped on phones
- **Screen:** People. The same happens on the Dashboard, Payments and Audit tables on phones.
- **Problem:** On a phone the 8-column People table shows Name, Key, Role and part of Services ("Breakfast, Lun", cut mid-word). Signed in, Contact, From, Until and the Invite action are hidden behind a horizontal scroll that nothing signals. Only the Log table uses the card layout.
- **Fix:** Below 768px, a data table renders as a list: a primary line, secondary text, and a trailing action. This should be the default behaviour of the shared DataTable, not an opt-in. Text is never clipped mid-word.
- **Principle:** WCAG 2.2 SC 1.4.10 Reflow; Material 3 lists on compact widths; Apple HIG lists.
- **Evidence:** `phone-light-admin-people-populated.png`; `src/styles.css:739-790` (`table.cards` is used only at `LogPage.tsx:281`).

## High

### Navigation, shell and state

#### NAV-01. No screen has its own document title
- **Problem:** Nothing in `src` sets `document.title`. Every route, including 404 and sign-in, keeps the static "Alimentation: mess and tiffin accounts". The tabs, the history and the screen-reader announcement are the same everywhere.
- **Fix:** Each page sets the title "{Page} · {Kitchen} · Alimentation" from the section registry, so it cannot be left out.
- **Principle:** WCAG 2.2 SC 2.4.2 Page Titled (A); GOV.UK (page title = H1 + service name).
- **Evidence:** `apps/web/index.html:14`; no match for `document.title` anywhere in `src`.

#### NAV-02. A route change leaves focus and scroll where they were
- **Problem:** On navigation, focus stays on the nav link, nothing is announced, and the scroll offset carries over from the previous page (the dashboard is 3800px tall). There is no skip link.
- **Fix:** On every location change, scroll to the top and focus the page H1 (`tabIndex=-1`). Make a "Skip to content" link the first focusable element.
- **Principle:** WCAG 2.2 SC 2.4.1, 2.4.3, 4.1.3.
- **Evidence:** `Shell.tsx:178-195` manages focus for the drawer only.

#### NAV-03. The phone top bar has no page name, and Sign out is one tap away
- **Problem:** The top bar holds the logo, a truncated kitchen name, the role select and a full-size Sign out button, but no page title and no back control. The only "where am I" cue is the bottom tab, and a section reached through More highlights no tab at all.
- **Fix:** Put the page title in the top bar. Move Sign out, Help and Theme into an account menu. Mark More as current, and show the section name, when the active section lives under it.
- **Principle:** Nielsen #1; Apple HIG navigation bars; Material 3 top app bar; Fitts's law.
- **Evidence:** `phone-light-admin-dashboard-viewport.png`, `phone-light-nav-more-open.png`; `Chrome.tsx:22-52`.

#### NAV-04. The phone bottom bar and the More panel
- **Problem:**
  - The bottom bar has four text-only tabs and More.
  - The first four tabs are taken from the top of the list, whatever the role. For an admin, 11 of 15 destinations sit under More, so People, Menu and Prices take two taps.
  - More opens a full-width overlay of text tiles with no scrim, no close button and no Esc.
  - The overlay also holds "Help and guides", which leaves the app, and the theme switch.
- **Fix:** Each role gets four chosen primaries, each with an icon, a label and a 44px+ target. More becomes a bottom sheet with a scrim, a close button, Esc and a focus trap. Help and Theme move out of the navigation list.
- **Principle:** Material 3 navigation bar; Apple HIG tab bars; Nielsen #3 and #7; Hick's law.
- **Evidence:** `phone-light-nav-more-open.png`; `Shell.tsx:30` (`PRIMARY=4`), `Shell.tsx:392-420`; `styles.css:1412-1500`.

#### NAV-05. The desktop sidebar cuts off its last items
- **Problem:** At 1440x900 the 15-item admin sidebar clips "Audit" in half and hides "Your data". Nothing shows that the list scrolls. The theme switch below the list cannot be reached without scrolling. There are no icons and no collapsed mode.
- **Fix:** Use the sidebar pattern of a pinned header (kitchen switcher), scrolling content and a pinned footer (help, account). Add icons, a collapsed icon rail and a scroll cue, and reduce the admin items to 7 (see NAV-14).
- **Principle:** Nielsen #6; Refactoring UI (do not hide content without a cue); the shadcn Sidebar convention.
- **Evidence:** `desktop-light-admin-dashboard-populated.png`, `desktop-light-loading-people.png`; `styles.css:1193-1201`.

#### NAV-06. There is no way to switch kitchen
- **Problem:** The kitchen name is a static card. The only way back to "Your kitchens" is the logo, which does not say where it goes. Operator and Organisation can be reached only from the top bar on `/app`. The workspace has no breadcrumb.
- **Fix:** Make the kitchen name a switcher menu listing the user's kitchens, with "All kitchens" and, for operators, "Operator". Give the logo an accessible name that says where it leads.
- **Principle:** Nielsen #3 and #4; the shadcn "team switcher" convention.
- **Evidence:** `Shell.tsx:312-318`, `Chrome.tsx:31-33`.

#### NAV-07. Every role gets the admin's dashboard and the system's names for roles
- **Problem:**
  - Cooks, consumers and admins all land on the same Dashboard, which is the admin's money statement. A cook's first job (today's meals, headcount, logging) is on the second tab.
  - The roles are labelled "Supplier" and "Member", while the owner and the product copy say "cook" and "consumer".
  - The cook's and the consumer's dashboards were not read closely, but they reuse the admin layout of tiles over a table.
- **Fix:** Each role gets its own home and its own navigation (plan §5). The UI says Admin, Cook and Consumer.
- **Principle:** Nielsen #2; role-based information architecture; Refactoring UI (design for the primary job).
- **Evidence:** `phone-light-cook-dashboard-viewport.png`, `desktop-light-consumer-dashboard-populated.png`; `ROLE_LABEL` in `Shell.tsx:30-34`; `sections.ts` (`EVERYONE` on dashboard, daily, log, payments).

#### NAV-08. Loading is a line of text, and the layout jumps
- **Problem:**
  - Loading shows a muted "Loading…" paragraph in more than 20 places. `Spinner` is a `<p>`.
  - During boot only the app bar is drawn, so the shell jumps in when the data arrives.
  - Switching sections discards the page in favour of the spinner.
  - The organisation page's `Suspense fallback={null}` shows a blank screen.
  - Nothing is drawn as a skeleton.
- **Fix:** Draw the shell at once from the cached bootstrap. Each page has a skeleton that matches its layout. Keep the previous content while refetching. Show a thin progress bar for route loads.
- **Principle:** Nielsen #1; Core Web Vitals CLS; Doherty threshold.
- **Evidence:** `ui.tsx:64-68`, `Shell.tsx:455-464`, `Chrome.tsx:76`, `App.tsx:19`; `styles.css` has no skeleton class.

### Forms, dialogs and feedback

#### FRM-02. Errors are not tied to the fields they are about
- **Problem:** `Field` has no error prop, no `aria-invalid` and no `aria-describedby`. `Form` shows a single banner below the submit button. Server errors appear far from the field they concern, often below the fold on a phone: "That address is taken.", "Enter the amount in rupees.", and "That is already logged for this day.", which sits above a disabled Add with no pointer to Date.
- **Fix:** Show a field error directly under its control, linked with `aria-invalid` and `aria-describedby`. Map server error codes to field names. A form with more than three fields gets an error summary that takes focus.
- **Principle:** WCAG 2.2 SC 3.3.1, 1.3.1; Nielsen #9; GOV.UK error summary and error message.
- **Evidence:** `src/components/ui.tsx:104-140`; `phone-light-settlements-record-open.png`, `phone-light-firstrun-2-error-address-taken.png`, `phone-light-admin-log-form-top.png`.

#### FRM-03. Validation is left to the browser's bubble
- **Problem:** Required fields rely on the native bubble ("Please fill out this field."). It is unstyled, covers the next field's label, shows one error at a time and appears only on submit. Nothing marks the field afterwards. `aria-invalid` styling exists in `input.tsx` but nothing sets the attribute.
- **Fix:** Set `noValidate` and validate with a schema. Validate a field on blur once it has been touched, and again on each change after its first error. Move focus to the first error on submit.
- **Principle:** WCAG 3.3.1 and 3.3.3; Nielsen #4; Baymard inline validation.
- **Evidence:** `phone-light-people-add-dialog-validation.png`, `phone-light-payments-claim-validation.png`, `desktop-light-signin-invalid-email.png`; `src/components/ui/input.tsx:6`.

#### FRM-04. Long dialogs hide their primary action and have no close button
- **Problem:**
  - The body of Rates "Change the rules", Prices "New prices", People import and Menu scrolls, and Save sits at the very bottom. On a phone, or on a 900px desktop, Save is off screen when the dialog opens.
  - No dialog has a close button. "Add item" and "Add person" have no Cancel.
  - Dismissing a dialog with input in it throws the input away without asking.
- **Fix:** A dialog has a header (title and close button), a scrolling body and a sticky footer. On a phone, a form of more than four fields opens as a full-height sheet. Closing a dirty form asks for confirmation.
- **Principle:** Material 3 full-screen dialogs; Apple HIG sheets; Nielsen #3.
- **Evidence:** `desktop-light-rates-change-rules-dialog.png`, `phone-light-prices-new-prices-dialog.png`, `phone-light-people-add-dialog.png`, `phone-light-catalogue-add-item-dialog.png`; `src/components/ui/dialog.tsx:19-32`; `styles.css:967-991`.

#### FRM-05. Buttons have no consistent hierarchy or placement
- **Problem:** Submit buttons are content-width and left-aligned inside cards (Claim payment, Save, Record, Add), so on a phone they are small targets at the edge. Start a kitchen and Sign in are full width. Button order changes from dialog to dialog. Some surfaces carry two primary-looking buttons (Operator; Rates "Change rules").
- **Fix:** Use one footer pattern. On phones the primary is full width with the secondary stacked under it. On desktop the actions are right-aligned, secondary then primary. A surface has one primary, and a destructive action is always red.
- **Principle:** Material 3 (one primary per surface); Fitts's law; the shadcn DialogFooter order.
- **Evidence:** `phone-light-payments-claim-validation.png`, `phone-light-settlements-record-open.png`, `phone-light-firstrun-3-form-filled.png`; `Money.tsx:104-115`, `Payments.tsx:145`.

#### FRM-06. Dates use the native input everywhere, with no limits and no shortcuts
- **Problem:**
  - Every date field uses `<input type=date>`, which looks and behaves differently in each browser and pops its picker when a dialog opens.
  - The fields have no limits. Log accepts any date, "Until" may come before "From", and payments may be dated in the future.
  - There are no "Today" or "Yesterday" shortcuts.
  - Month selects read "Nov-26".
- **Fix:** Use one date picker (a calendar in a popover on desktop, a sheet on phones) with min and max set. The log offers Today and Yesterday chips. Months read "November 2026".
- **Principle:** Baymard date entry; GOV.UK date input; Nielsen #6.
- **Evidence:** `desktop-light-rates-change-rules-dialog.png`, `phone-light-admin-log-form-top.png`, `phone-light-settlements-record-open.png`; `People.tsx:120-160`, `Payments.tsx:128-135`, `Rates.tsx:57`.

#### FRM-07. Money and number inputs differ from screen to screen
- **Problem:** Payments and Prices use `type=text` with `inputMode=decimal`. Rates, Catalogue, Retention and Operator use `type=number`, with spinners, scroll-wheel changes and no inputMode. The Settlements amount has neither, so phones show the full keyboard. The rupee sign is in the label only. No field explains how to enter paise.
- **Fix:** One `MoneyInput`: a ₹ prefix, `inputMode=decimal`, normalised on blur, with the hint "Like 450 or 450.50". Counts use `type=text` with `inputMode=numeric`. `type=number` is not used anywhere.
- **Principle:** GOV.UK (avoid `type=number`); WCAG 1.3.5; Baymard keyboards.
- **Evidence:** `Money.tsx:453-460`, `Rates.tsx:107-124, 180, 234`, `Catalogue.tsx:145`, `Retention.tsx:102`, `Payments.tsx:108-113`.

#### FRM-08. The People import dialog overflows on a phone
- **Problem:**
  - The textarea, the format hint (`externalKey,name,role,…`) and two sentences run off the right edge.
  - The native "Choose File" control uses the system font.
  - "Download a template" runs into the next heading.
  - The Merge and Overwrite options are three-line sentences, and the destructive Overwrite is not marked as such.
  - Nothing previews the import before it is applied.
- **Fix:** Wrap the code text. Use a styled file button or drop zone. Write each radio option as a title plus a hint, and give Overwrite a warning style. Show a preview with counts before applying.
- **Principle:** WCAG 1.4.10; Nielsen #4 and #5.
- **Evidence:** `phone-light-people-import-dialog.png`; `PeopleImport.tsx:106-150`.

#### FRM-09. `/app` buries "Start a kitchen" under two advanced forms
- **Problem:**
  - The page is about 2,400px tall. It stacks a summary, the kitchen list, "Copy a setup", "Start an organisation" and, last, "Start a kitchen", which is the first task for a new operator.
  - The list shows raw slugs.
  - The address field is checked only on submit, and its error lands below the button.
  - The irreversible "Track money in this kitchen" is a pre-checked checkbox with the warning in small print.
  - The "Start from" radios run each title into its description.
- **Fix:** The list is the page, with a primary "New kitchen" button at the top that opens its own route. Copy setup and Organisation move under "Manage". The address is checked as the user types, with suggestions when it is taken. The money choice becomes two unselected radio cards that spell out the consequence. Radio cards show a bold title with the description under it.
- **Principle:** Nielsen #5, #6, #8; serial-position effect; GOV.UK "one thing per page".
- **Evidence:** `desktop-light-app-operator-kitchens.png`, `phone-light-firstrun-3-form-filled.png`, `phone-light-firstrun-2-error-address-taken.png`; `src/pages/Places.tsx:193-270`.

#### FRM-10. Busy and success states are weak, and toasts are a single slot
- **Problem:**
  - A busy button is disabled at 60% opacity with no spinner and no label change, so it looks broken.
  - Toasts have one slot (`setMessage` replaces the last one), vanish after 3.5 seconds, and have no close, undo or view action. None were caught in any capture.
  - Most feedback after an action is a `reload()` that blanks the page.
  - Nothing updates optimistically.
- **Fix:** Use a toast queue with dismiss and pause-on-hover. A toast carries a View or Undo action where one applies, as in "Saved. View entry". The primary button shows a spinner and a busy label ("Saving…"). Common cook and consumer actions (log a meal, confirm a claim) update optimistically. Refetch instead of reloading.
- **Principle:** Nielsen #1; WCAG 4.1.3 and 2.2.1; Material 3 snackbar.
- **Evidence:** `src/components/ui.tsx:35-70`; `LogPage.tsx:102-110`; `phone-light-admin-log-form-top.png`.

### Data display

#### DAT-02. The dashboard table has ten equal columns
- **Problem:** The per-person table has Meals, Leave, Bill, Actual, Paid, Balance, Status, Earlier unpaid and Claimed, all with the same weight. Bill, Actual and Balance often hold the same figure. On a phone the table is clipped after Actual.
- **Fix:** Lead with Name, Balance and Status, sorted by balance, highest first. The remaining figures go into a row detail sheet. The table gets a search box and a status filter. On phones each person is a card with the balance in large type.
- **Principle:** Refactoring UI (de-emphasise secondary data); Material 3 data tables; Miller and Hick.
- **Evidence:** `desktop-light-admin-dashboard-populated.png`, `phone-light-admin-dashboard-populated.png`; `Dashboard.tsx:339-380`.

#### DAT-03. "Bills, line by line" repeats one table per person down the page
- **Problem:** Eight per-person bill tables of about 200px each run down the page, which ends up about 3,800px tall. Each table's only label is the person's name, as a small centred caption. Nothing lets the reader jump to one person, and the figures repeat the summary table above.
- **Fix:** A bill opens from the person's row, as a sheet on desktop and its own route on phones. The bill is a statement as described in DAT-12. Remove the stacked tables.
- **Principle:** Nielsen #8; Pareto.
- **Evidence:** `desktop-light-admin-dashboard-populated.png` (y 590-2200); `BillLines.tsx:33-62`.

#### DAT-04. Money formatting is inconsistent
- **Problem:**
  - `formatMoney` returns "-" for zero, so "nothing" looks like "not available".
  - Paise appear only when non-zero, so one column can mix ₹4,920 and ₹4,920.50.
  - The function is hand-rolled rather than `Intl.NumberFormat('en-IN')`.
  - Negative figures appear as "-₹580", with a hyphen and no word to say whether that is a credit or an overpayment.
- **Fix:** Zero shows as ₹0. Within a column, paise appear on every figure or on none. A negative figure is written in words ("Credit ₹580"). Where a sign is needed, use a true minus (U+2212). Figures use tabular numerals.
- **Principle:** Nielsen #4; GOV.UK numbers and money.
- **Evidence:** `packages/core/src/money.ts:30-39`, `apps/web/src/format.ts:1-12`; Earlier unpaid column in `desktop-light-admin-dashboard-populated.png`.

#### DAT-05. Status badges rely on colour, are small and use green
- **Problem:** Statuses (Projected, Awaiting confirmation, Pending, Confirmed, Disputed, Yes or Not yet) are pastel pills of about 11px text. They carry no icon, and the green success badge has marginal contrast. The audit table shows raw database verbs ("insert", "update").
- **Fix:** One StatusBadge component, which shows an icon, a word and a colour together. Its text is at least 12px and reaches 4.5:1 contrast. Plain words replace the database verbs ("Added", "Changed").
- **Principle:** WCAG 1.4.1 and 1.4.3; Apple HIG (do not rely on colour alone).
- **Evidence:** `desktop-light-admin-payments-populated.png`, `desktop-light-admin-people-populated.png`, `desktop-light-admin-audit-populated.png`; `styles.css:633-655`.

#### DAT-06. The audit trail cannot be searched or filtered
- **Problem:** The trail is 50 rows followed by a bare "Older entries" button. It has no search and no filter by person, action, entity or date. Entities appear under internal names ("menu day"). Who did what cannot be told apart when two accounts share a name. Every detail is behind a "show" disclosure.
- **Fix:** Add a toolbar with a search box and filters for person, action, entity and date range. Group rows by day. Show "Showing 1-50 of N" with pagination. Name entities in plain words. Open the detail in a side sheet.
- **Principle:** Nielsen #6 and #7; Material 3 table toolbars.
- **Evidence:** `desktop-light-admin-audit-populated.png`, `desktop-light-audit-row-expanded.png`; `Audit.tsx:46-60`.

#### DAT-07. The monthly bill chart cannot be read
- **Problem:** The chart draws eight people as eight bars a month in near-identical tones, with ticks only at 0, ₹5,000 and ₹10,000. It has no value labels and no tooltips. The asterisk for "projected" is explained only in a code comment.
- **Fix:** Chart the kitchen per month as two series, billed and collected. Add a tooltip on hover and on focus, and a visible key for "projected". The per-person figures stay in the table.
- **Principle:** dataviz series limits; WCAG 1.4.1 and 1.4.11.
- **Evidence:** `desktop-light-admin-dashboard-populated.png` (y 2230-2460); `src/components/Chart.tsx:1-80`.

### Visual system

#### VIS-01. Controls do not inherit the app's font
- **Problem:** Buttons render in the browser's default sans, not Figtree: Sign in, Save, Retire Curd, Export CSV, Import. Selects and date inputs differ again in font and size. The coss Button sets `text-base` but no font family, and Tailwind is loaded without its preflight.
- **Fix:** In the base layer, set `button, input, select, textarea { font: inherit }`, and add `font-sans` to every control.
- **Principle:** Refactoring UI; Nielsen #4.
- **Evidence:** `desktop-light-signin-invalid-email.png`, `phone-light-people-add-dialog-validation.png`, `phone-light-catalogue-retire-dialog.png`; `src/components/ui/button.tsx:11`.

#### VIS-02. Field edges are too faint to see
- **Problem:** The input border measures about 1.3:1 against the page, both today and in all three direction proposals. Controls nearly vanish in sunlight.
- **Fix:** Use a separate `--input` token for control edges at 3:1 or more. `--border` is reserved for decorative lines.
- **Principle:** WCAG 2.2 SC 1.4.11 Non-text Contrast.
- **Evidence:** Contrast measured by script on the token sets (see the plan, §2).

#### VIS-03. The green brand clashes with the vegetarian mark
- **Problem:** The brand is a deep green (`--brand: #1f4d3a`). In India a green dot in a square is the FSSAI vegetarian mark, and food apps show it on every dish. A green fill beside a meal row can read as "veg". The same green also stands for "success" and "paid".
- **Fix:** Drop green as the brand colour. Keep green only for success, drawn as a check with a word, never as a dot or a square.
- **Principle:** Match with the real world (Nielsen #2); FSSAI labelling rules; the owner's brief.
- **Evidence:** `src/styles.css:18`; FSSAI labelling FAQ (see the research notes in the plan).

#### VIS-04. Two design systems meet in every screen
- **Problem:** The new coss/ui components sit on top of 3,400 lines of older CSS (`styles.css`, `home.css`). Their fonts, radii, colours and disabled states differ. Because the old sheet is unlayered, it wins over the utilities. The design checker governs only the old CSS.
- **Fix:** Use one system. Delete the old CSS screen by screen as each screen is rebuilt, and rewrite the checker for the new system.
- **Principle:** Nielsen #4; Refactoring UI.
- **Evidence:** `src/theme.css:1-10`; `scripts/check-design.mjs`.

## Medium

### Navigation, shell and state

#### NAV-09. Changing role reloads the page and may land on a dead end
- **Problem:** The "Acting as" select reloads the whole workspace when it changes. The role is not part of the URL. An admin on `/people` who switches to cook lands on "not part of the supplier view". On a phone the select is an 11px pill.
- **Fix:** Put the role switch in the account menu as a radio group. Switching changes the view without a reload, goes to the role's home, and confirms the change with a toast.
- **Principle:** WCAG 3.2.2 On Input; Nielsen #5.
- **Evidence:** `Shell.tsx:61-100`; `phone-light-admin-dashboard-viewport.png`.

#### NAV-10. A restricted section and a 404 are different dead ends
- **Problem:** A section outside the user's role shows a muted sentence and a link, with no H1 and no word on who can open it. The 404 page and an unknown in-kitchen route use two other layouts.
- **Fix:** One NotAvailable screen: an H1, the reason, the role needed, "Ask your admin" where that applies, and a primary button to the user's home. The same screen covers 404, role-denied and not-a-member.
- **Principle:** Nielsen #9; GOV.UK "Page not found"; WCAG 2.4.6.
- **Evidence:** `phone-light-cook-people-not-for-role.png`, `phone-light-notfound-nope-404.png`; `Shell.tsx:240-247`, `App.tsx:30-37`.

#### NAV-11. Pages switch with no transition, and banners push content down
- **Problem:** Pages swap instantly, while the drawer and the More panel animate. The offline, migrating and setup banners push the page down as they load.
- **Fix:** Add a 150ms fade-through between routes with the View Transitions API, and drop it under reduced motion. Status banners reserve their space or appear as toasts.
- **Principle:** Material 3 motion; Doherty threshold; CLS.
- **Evidence:** `Shell.tsx:197-247`; `styles.css:1157-1171`.

#### NAV-12. A new kitchen shows one hint at a time and empty tables
- **Problem:** A new kitchen gets a single "next step" banner above the page heading, mixed in with status banners, with its link inline after the text. Nothing shows how many steps there are. Cooks and consumers see the message but have no action. Empty sections show table headers over nothing and dashes in the tiles.
- **Fix:**
  - The admin home shows a setup checklist (People, What you serve, Menu, Prices) with a progress count, hidden from roles that cannot act on it.
  - Each empty state shows an icon, one sentence and the primary action.
  - Empty tables and empty tile rows are hidden.
- **Principle:** GOV.UK task list; Material 3 empty states; Nielsen #10.
- **Evidence:** `desktop-light-empty-dashboard-blank.png`, `desktop-light-empty-people-blank.png`; `Shell.tsx:197-225`.

#### NAV-13. The account is plain text, not a menu
- **Problem:** The top bar shows the account name ("Owner") as faint plain text next to Help and a bordered Sign out button. There is no way to see the email or reach settings. Help is a hard link out of the app. On `/app` the "Operator" pill looks like a button but leads to another area without saying so.
- **Fix:** Add an account menu with the name, email, role switch, theme, Help (marked as opening in a new tab) and Sign out. Operator becomes an entry in the kitchen switcher.
- **Principle:** Nielsen #4; the shadcn NavUser convention.
- **Evidence:** `Chrome.tsx:36-52`; `desktop-light-app-operator-kitchens.png`.

#### NAV-14. Sections are named for the system, not for the task
- **Problem:**
  - The groups are "Day to day", "The kitchen" and "The books".
  - Rates & rules becomes "Rules" when money is off.
  - Older months, Month close, Settlements and Your data overlap.
  - For a consumer, Daily, Dashboard, My log and History cannot be told apart by name.
  - The Payments badge means "to confirm" for an admin and something else for a consumer.
- **Fix:** Use the task names in plan §5. The admin menu drops to 7 entries, with a Setup hub and a Books hub that hold tabs.
- **Principle:** Nielsen #2 and #4; Hick's law; GOV.UK content design.
- **Evidence:** `sections.ts` (`SECTIONS`, `GROUP_LABEL`); `phone-light-nav-more-open.png`.

### Forms, dialogs and feedback

#### FRM-11. The Reverse dialog does not say why its button is disabled
- **Problem:** Reverse is a washed-out red button, disabled until a reason is typed, but nothing says that the reason is required. The title does not say what changes in the books.
- **Fix:** Mark the reason "Required". Keep the button enabled and show an error on submit. State the effect: "Kabir's November payment goes back to pending."
- **Principle:** WCAG 3.3.2; Nielsen #1.
- **Evidence:** `phone-light-payments-reverse-action.png`; `Payments.tsx:195-205`.

#### FRM-12. Short choices are hidden in selects, and the selects misalign
- **Problem:** Two- to four-option choices are native selects: Method, Type, Applies to, Change, Charge on a leave day, Entries after close. In the Rates dialog, long labels wrap and make the selects different heights.
- **Fix:** A choice of two to four options is a toggle group or radio cards. A long list stays a select at a fixed height, centred vertically.
- **Principle:** Material 3 segmented buttons; Apple HIG segmented controls.
- **Evidence:** `desktop-light-rates-change-rules-dialog.png`, `phone-light-admin-log-form-top.png`; `Rates.tsx:87-209`.

#### FRM-13. "Optional" is marked unevenly, and long hints push the form down
- **Problem:** Settlements "Note" is optional but not marked. Hints run to five lines on a phone ("Key (optional)"), and nothing announces them.
- **Fix:** Mark "(optional)" on every optional field. Keep hints to one line, wired with `aria-describedby`. Put rarely used fields (Key, Until, Contact) under "More details".
- **Principle:** GOV.UK; WCAG 3.3.2; Nielsen #8.
- **Evidence:** `phone-light-people-add-dialog-validation.png`, `phone-light-settlements-record-open.png`; `ui.tsx:104-123`.

#### FRM-14. Sign-in asks for a name on every visit
- **Problem:** Name is required at every sign-in, although it is needed only when the account is created. The email field lacks `inputMode=email` and `autoCapitalize=none`. The button gives no sign that it is working.
- **Fix:** Sign-in asks for the email first and asks for a name only for a new account. Set the right keyboard attributes on the email field, and show "Signing in…" with a spinner.
- **Principle:** WCAG 3.3.7 Redundant Entry; Baymard.
- **Evidence:** `desktop-light-signin-invalid-email.png`, `phone-light-signin-signin.png`; `SignIn.tsx:54-69`.

#### FRM-15. Irreversible actions are confirmed in different ways
- **Problem:** Retention asks the user to type the month in words. Move and Delete ask for the slug. Retire, Reverse and Disable person take one click. Move uses the yellow accent variant, Retention the destructive one. Nothing shows whether the typed text matches.
- **Fix:** Use one severity ladder, applied the same way everywhere:
  1. Reversible: act at once, and offer Undo in a toast.
  2. Irreversible and small: a destructive alert dialog.
  3. Irreversible and large: type to confirm, with the exact string shown to copy and live feedback on whether it matches.
- **Principle:** WCAG 3.3.4; Nielsen #5.
- **Evidence:** `YourData.tsx:296-307, 410-421`; `Retention.tsx:380-415`.

#### FRM-16. Cooks and consumers fill in the admin's long forms
- **Problem:** Claiming a payment or logging leave takes five or six stacked selects plus a date. Nothing is remembered or pre-filled. The log form opens on "Change: Leave", which is jargon.
- **Fix:** Lead with intent buttons ("Skip a meal", "Extra"), a row of date chips, and progressive disclosure. Remember the last payment method. Default the month to the current one. Pre-fill the amount with what is due.
- **Principle:** Hick's law; Baymard smart defaults; GOV.UK "ask only what you need".
- **Evidence:** `phone-light-admin-log-form-top.png`, `phone-light-payments-consumer-claim-validation.png`; `LogPage.tsx:120-210`, `Payments.tsx:93-130`.

### Data display

#### DAT-08. The stat tiles have two sizes and no clear lead
- **Problem:** Seven tiles come in two sizes. Their labels are small low-contrast capitals. "To confirm 2" is not a link. The "Projected" badge floats beside the month picker, away from the figures it qualifies.
- **Fix:** Use one tile size and lead with the balance owed. Put the projected state as a caption on the tiles themselves. Make "To confirm" link to Payments.
- **Principle:** Refactoring UI; Nielsen #1.
- **Evidence:** `desktop-light-admin-dashboard-populated.png`, `phone-light-admin-dashboard-populated.png`.

#### DAT-09. The People table is noisy and duplicates accounts
- **Problem:** "Owner" appears twice (Admin and Supplier) with nothing to tell the rows apart. Every name is an underlined link. The table has no search, sort or filter, and disabled people are listed with active ones. "Signed in: Not yet / Yes" is unclear.
- **Fix:** Add search, sort, and filter chips (Consumers, Cooks, Admins, Disabled). Show one row per person with their role badges, and the email under the name. Rename the column "Account", with the values Invited and Active. Underline links on hover only.
- **Principle:** Nielsen #4 and #6.
- **Evidence:** `desktop-light-admin-people-populated.png`.

#### DAT-10. Payments shows each claim twice
- **Problem:** A claim appears as a card under "To confirm" and again in "All claims". Free text appended to the status makes the rows uneven. Each row has outline Withdraw and Reverse buttons. The month and the date use two formats in one row. The "I paid" form sits between the queue and the history.
- **Fix:** Use tabs (To confirm, Pending, Confirmed, Disputed, All), with one row per claim. Row actions go into a menu. A dispute note gets its own line. Show a total for the filtered set. "I paid" becomes a button that opens a sheet.
- **Principle:** Refactoring UI; Material 3 overflow menus.
- **Evidence:** `desktop-light-admin-payments-populated.png`; `Payments.tsx:301-330`.

#### DAT-11. The history feed is hard to scan
- **Problem:** The feed repeats the same time on every row under one date heading. It has no filter by type and no icons. Its sentences are long, and the amounts inside them are not emphasised. "Older" gives no count.
- **Fix:** Group rows by day. Give each row a type icon, a bold amount or date, and a short sentence. Add filter chips (All, Bills, Payments, Meals). Label the button "Show older (N more)".
- **Principle:** Nielsen #6; GOV.UK front-loading.
- **Evidence:** `desktop-light-consumer-history-populated.png`.

#### DAT-12. The bill statement does not show how a figure was reached
- **Problem:** The statement has no rate column, so 17 × ₹55 cannot be checked. The total row is faint. The person's name is a centred caption. It shows no period, no payments so far and no balance due. A projected bill is not labelled inside the bill.
- **Fix:** Show the statement in this order:
  1. A header: person, period, and the Projected label where it applies.
  2. Lines of item, quantity, rate and amount.
  3. Subtotal, payments and balance due.
  4. A bold total row.
- **Principle:** GOV.UK (show how a figure was worked out); Baymard order summaries.
- **Evidence:** `BillLines.tsx:33-62`.

#### DAT-13. Dates appear in four or more formats
- **Problem:** The app shows "25 Nov 2026, 07:23", "22-Nov-2026", "Nov-26", "Wed, 25 Nov 2026" and ISO dates. "Nov-26" reads as either 26 November or November 2026. The time zone footer repeats on every page.
- **Fix:** One date format ("25 Nov 2026") and one month format ("Nov 2026"). Relative times only for recent events, with the absolute time in a tooltip. The time zone appears once, in the account menu.
- **Principle:** Nielsen #4; GOV.UK dates.
- **Evidence:** `src/format.ts:10-12`; the Audit, Payments and History shots.

#### DAT-14. Tables lack scroll cues, sticky columns and action headers
- **Problem:** A wide table gives no cue that it scrolls. Action columns have an empty `<th />`. Nothing is sticky. Row action targets are small.
- **Fix:** Give action columns a visually hidden "Actions" header. Make the header row and the first column sticky. Add scroll shadows. Row actions are at least 24px, and 44px on touch screens.
- **Principle:** WCAG 1.3.1 and 2.5.8.
- **Evidence:** `Dashboard.tsx:160-165, 375-377`, `Payments.tsx:310`.

### Visual system

#### VIS-05. There is no icon system
- **Problem:** Navigation, statuses, empty states and row actions are text only, which slows scanning on phones.
- **Fix:** Use one icon set, lucide-react, at 16px (inline) or 20px (navigation), with a 1.75 stroke.
- **Principle:** Nielsen #6; Material 3 navigation bar.
- **Evidence:** No icon library appears in `package.json`.

#### VIS-06. Contrast falls short in dark mode, in charts and in secondary text
- **Problem:** The visual lens found contrast failures, mainly in dark mode, in chart series and in muted secondary text. The tile labels and pastel badges in DAT-05 and DAT-08 are examples.
- **Fix:** The new token set is checked by script. Every text pair must reach 4.5:1 and every control edge, chart mark and focus ring 3:1, in both themes.
- **Principle:** WCAG 1.4.3, 1.4.11.
- **Evidence:** Visual lens summary; contrast measured on the tokens.

## Low

#### NAV-15. "Hide this menu" is easy to miss and its drawer does not trap focus
- **Problem:** "Hide this menu" is a small link in the middle of the sidebar. Hiding the sidebar leaves a "Menu" text button. The hidden-menu drawer does not trap focus or return it. Tablets under 960px get the phone bar.
- **Fix:** Replace it with an icon SidebarTrigger in the header, with a tooltip and Ctrl/Cmd+B. When collapsed, the sidebar becomes an icon rail. Use the sidebar below 1024px only on phones.
- **Principle:** WCAG 2.4.3 and 2.1.2.
- **Evidence:** `Shell.tsx:168-189, 286-304`.

#### NAV-16. View state is not kept in the URL
- **Problem:** The month picker, filters and expanded rows live in local state. Back leaves the section instead of undoing the change, and a dialog does not close on Back.
- **Fix:** Keep the month, filters and tab in search params. A phone sheet pushes a history entry, so Back closes it.
- **Principle:** Nielsen #3.
- **Evidence:** `phone-light-admin-dashboard-viewport.png`, `desktop-light-audit-row-expanded.png`.

#### NAV-17. Home, guides, docs and the app each have their own header
- **Problem:** The home page, the guides, the docs and the app each draw a different header. Help navigates out of the app, and the guides offer no way back to the kitchen. A signed-out redirect shows "Loading…" first.
- **Fix:** Use one site header across all four. When a session exists, the guides show "Back to your kitchen". Help opens in a new tab.
- **Principle:** WCAG 3.2.3 and 3.2.4.
- **Evidence:** `Chrome.tsx:76`, `Home.tsx:99-111`.

#### FRM-17. Dialogs focus the first field when they open
- **Problem:** A dialog moves focus to its first field. In Rates and Prices that field is a date, so the picker and the keyboard pop up as soon as the dialog opens on a phone.
- **Fix:** On phones, focus the dialog title. On desktop, focus the first text field and never a date field.
- **Principle:** WCAG 3.2.1.
- **Evidence:** `desktop-light-rates-change-rules-dialog.png`, `phone-light-prices-new-prices-dialog.png`.

#### FRM-18. Dialogs have no description and generic titles
- **Problem:** No dialog renders a Description, so the paragraph that states the consequence is not announced. Titles are generic ("Retire", "Invite").
- **Fix:** Add a DialogDescription and use specific titles ("Invite Asha Rao").
- **Principle:** WCAG 4.1.2; the ARIA dialog pattern.
- **Evidence:** `src/components/ui/dialog.tsx:26-29`; `People.tsx:387`.

#### FRM-19. Checkboxes and radios are raw inputs with small targets
- **Problem:** Checkboxes and radios are raw inputs, some with labels outside the hit area. The weekday checkboxes wrap, leaving "Sun" alone on a line.
- **Fix:** Use Checkbox and RadioGroup with a full-row hit area of at least 44px. Show the working days as a toggle group of seven equal chips.
- **Principle:** WCAG 2.5.8; Apple HIG 44pt.
- **Evidence:** `desktop-light-rates-change-rules-dialog.png`; `Rates.tsx:69`, `Money.tsx:97`, `Places.tsx:222-253`.

#### FRM-20. Text limits are invisible
- **Problem:** Fields have `maxLength` but no counter, so a user hits the limit without warning. No placeholder shows an example of the expected format.
- **Fix:** Show a character count on fields that allow more than 100 characters. Show an example as hint text, never as the label.
- **Principle:** GOV.UK character count.
- **Evidence:** `Payments.tsx:145-150`.

#### FRM-21. A disabled button is the normal button at 60% opacity
- **Problem:** A disabled button is drawn at 60% opacity. Faded white-on-green measures about 3:1 and looks broken. Disabled controls are exempt from contrast rules, but here the faded button is the only sign of the state.
- **Fix:** Draw disabled buttons in a neutral fill and give a reason in text next to them, or keep the button enabled and validate on submit.
- **Principle:** Refactoring UI; Nielsen #1.
- **Evidence:** `phone-light-admin-log-form-top.png`, `phone-light-payments-reverse-action.png`; `button.tsx:11`.
