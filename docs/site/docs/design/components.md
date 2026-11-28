---
title: Components
description: The pieces every screen is made of, shown with the one rule for using each.
---

# Components

<!-- markdownlint-disable MD013 -->

A screen is assembled from these pieces and nothing else. If a screen needs something that is not
here, add it here first, with an example and a rule, then use it. The examples below are drawn in
plain HTML from the same tokens as the application, so they follow the theme; the real components
are in `apps/web/src/components/ui/` and `apps/web/src/components/app/`.

## Where they come from

- **`components/ui/`** is **shadcn/ui, Base UI flavour**, put there by the shadcn command
  (`bunx shadcn@latest add button`) and owned by the app. Base UI supplies the behaviour (focus,
  keyboard, ARIA); Tailwind utilities supply the look; `cn` in `lib/utils.ts` joins class names.
  Nothing in it is written by hand, so an upgrade is a re-run of the command.
- **`components/app/`** is the **app kit**, built once on top of them: the pieces that carry the
  kitchen's own rules (money, status, dates, forms, tables). A screen composes these and the ui
  components, and restyles neither.
- **Icons** are `lucide-react`, and nothing else. **Toasts** are sonner, **tables** TanStack Table,
  **forms** react-hook-form with zod, **dates** react-day-picker, **charts** recharts through the
  shadcn Chart, and the **command menu** cmdk through the shadcn Command.

The Base UI flavour has no drawer. A sheet that comes from the bottom (`Sheet side="bottom"`) takes
its place.

## Buttons

One button with six looks. **A page has one primary action;** the others are quiet.

<div class="demo">
<button type="button" class="ds-btn primary">Save the rates</button>
<button type="button" class="ds-btn secondary">Import</button>
<button type="button" class="ds-btn outline">Cancel</button>
<button type="button" class="ds-btn ghost">Skip</button>
<button type="button" class="ds-btn destructive">Retire Curd</button>
<button type="button" class="ds-btn link">Show older</button>
<button type="button" class="ds-btn primary" disabled>Disabled</button>
</div>

| Look        | Use it for                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| Default     | The one thing this page or form is for.                                     |
| Secondary   | A second action beside it.                                                  |
| Outline     | Cancel, back, and an action in a toolbar.                                   |
| Ghost       | An action inside a row or a menu.                                           |
| Destructive | Only what cannot be undone, and always behind a confirmation that names it. |
| Link        | A word that goes somewhere.                                                 |

A button says what it does (_Save the rates_, _Close November 2026_), never _OK_ or _Submit_. It is
44px high under a finger and 36px under a mouse. A button that is working has a `loading` state: a
spinner before its label, the label changed to _Saving…_, and presses refused until it is done. A
button is disabled for a request in flight, never for a rule the person has not been told about:
tell them instead. A button that is a link keeps its own colour and has no underline.

## Fields and forms

Every field is a `Field`: a label above, the control, a hint or an error below. The input, textarea
and select share one look: a one-pixel `--input` edge, the `md` radius, a ring for focus and a red
ring while the value is invalid (`aria-invalid`).

<div class="demo">
<div class="ds-field"><label for="demo-name">Name</label><input id="demo-name" class="ds-input" type="text" autocomplete="off" value="Asha Rao"><span class="hint">As you want it to show on the bill.</span></div>
<div class="ds-field"><label for="demo-amount">Amount</label><span class="ds-group"><span class="ds-prefix" aria-hidden="true">₹</span><input id="demo-amount" class="ds-input" type="text" inputmode="decimal" autocomplete="off" value="1,250"></span><span class="hint">The amount due is filled in.</span></div>
<div class="ds-field"><label for="demo-bad">Paid on</label><input id="demo-bad" class="ds-input" type="text" autocomplete="off" value="31 Nov 2026" aria-invalid="true" aria-describedby="demo-bad-err"><span id="demo-bad-err" class="ds-error">November has 30 days. Pick a date from the calendar.</span></div>
</div>

The kit has the inputs a kitchen needs: `MoneyInput` (a ₹ prefix, the decimal keyboard, tidied when
you leave it), `CountInput` (the numeric keyboard, never `type="number"`), `DateField` (a calendar
in a popover on a desktop, in a sheet on a phone, with _Today_ and _Yesterday_ chips) and
`MonthPicker` (written "November 2026", kept in the address as `?month=2026-11`).

`AppForm` and `FormField` check on leaving a field, then on every change. An error sits under its
field, says what is wrong and what to do, and is joined to the control with `aria-describedby`. A
form of more than three fields shows a summary that takes focus when it is submitted with errors,
and a refusal from the server is placed on its field (`mapServerError`). The browser's own checking
is switched off (`noValidate`), so every error looks the same.

## Status badges

A status is an icon, a word and a colour. `StatusBadge` is the only way to draw one.

<div class="demo">
<span class="ds-badge success"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>Paid</span>
<span class="ds-badge warning"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Owed</span>
<span class="ds-badge destructive strong"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>Overdue</span>
<span class="ds-badge neutral"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/></svg>Pending</span>
<span class="ds-badge destructive"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Disputed</span>
</div>

The statuses are _paid_, _owed_, _overdue_, _pending_, _confirmed_, _disputed_, _projected_,
_active_, _invited_ and _disabled_. A badge is never a filled dot, square or triangle, and is never
drawn on or beside a meal row as a shape: see the
[rules for colour](/docs/design/foundations/#rules-for-colour).

## Alerts

A sentence the person must not miss, in the flow of the page. An alert that reports an error is
announced to a screen reader at once (`role="alert"`). On a page it is also how a failure to load
looks: the message, a _Try again_ button, and the last data kept on screen.

<div class="demo">
<div class="ds-alert info">The month closes on 31 October. Until then anyone can still catch up.</div>
<div class="ds-alert success">Your payment was confirmed by the cook.</div>
<div class="ds-alert warning">This entry was added three days after the day itself.</div>
<div class="ds-alert destructive">That month is closed. Ask the admin to add it for you: it will be marked late.</div>
</div>

## Money and stat cards

`Money` is the only way to draw an amount: ₹0 for zero (never a dash), a true minus (−) for a
negative number, and _Credit ₹580_ where a balance is in the person's favour. A column of amounts
uses the same number of decimals in every row. A stat card is a figure and its name; the few that
answer _where do I stand?_ sit larger and above the rest.

<div class="demo">
<div class="ds-stat"><div class="k">You owe</div><div class="v">₹1,250</div></div>
<div class="ds-stat"><div class="k">Paid so far</div><div class="v">₹2,600</div></div>
<div class="ds-stat"><div class="k">Balance</div><div class="v">Credit ₹580</div></div>
<div class="ds-stat"><div class="k">Eating today</div><div class="v">18</div></div>
</div>

A figure that is a forecast carries a _Projected_ badge and the caption _Projected to month end_.
Money is only ever drawn when the kitchen tracks money: every screen has a form that works without
it.

## Cards, tables and lists

A card lies flat on the page, held by a one-pixel border (never a shadow). A table is a `DataTable`
on TanStack: sorting, a search box, filter chips, a pager that says _1-10 of 42_, a sticky header
and first column, and a row-actions menu whose column header is hidden but named _Actions_. Amounts
and counts are right-aligned with tabular numerals. **Below 768px the table becomes a list of
items**, each row a card with the name first and the figure large.

<div class="demo">
<div class="tablewrap" tabindex="0" role="region" aria-label="An example table">
<table><thead><tr><th>Person</th><th>Month</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>
<tr><td>Kabir Nair</td><td>Nov 2026</td><td class="r">₹1,250</td><td><span class="ds-badge warning"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Owed</span></td></tr>
<tr><td>Asha Rao</td><td>Nov 2026</td><td class="r">₹2,600</td><td><span class="ds-badge success"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>Paid</span></td></tr>
</tbody></table>
</div>
</div>

## Dialogs and sheets

`FormDialog` is the one way to ask for something on top of a page. At 768px and wider it is a
dialog; below that it is a full-height sheet from the bottom. Either way it has a title and a close
button, a body that scrolls, and a footer that stays in view with the secondary action first and the
primary after it. A form that has been changed asks _Discard changes?_ before it closes, and the
Back button closes it instead of leaving the page.

`ConfirmAction` is the ladder of seriousness for an action, from the lightest to the heaviest:

| Level     | What happens                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `undo`    | It acts at once and shows a toast with _Undo_. For what can be put back: confirming a claim, skipping a meal.                                          |
| `confirm` | An alert dialog names the thing and says what will happen, with the destructive button on the right and _Keep it_ focused.                             |
| `typed`   | The person types an exact string (the kitchen's address, the month in words), which has a copy button and a live _Matches_. For what cannot come back. |

A dialog says what will happen and has a button that names it: _Retire Curd_, not _Yes_.

## Toasts

A short note that something happened, from sonner: `toast.success`, `toast.error`, `toast.info` and
`toast.undo(message, fn)`. It stays six seconds, pauses while it is pointed at or focused, and has a
close button. It sits at the bottom right on a desktop and at the bottom centre, above the bar, on a
phone. A toast is never the only record of something important: the thing it reports is also visible
on the page.

## Navigation

Each role has its own home and its own menu, drawn from one list (`sections.ts`). On screen the
roles are _Admin_, _Cook_ and _Consumer_.

| Role     | Sidebar, in order                                  | Phone bottom bar                    |
| -------- | -------------------------------------------------- | ----------------------------------- |
| Admin    | Home, Today, People, Payments, Bills, Setup, Books | Home, Today, Payments, People, More |
| Cook     | Today, Meals, Payments, History                    | Today, Meals, Payments, History     |
| Consumer | Home, Meals, Pay, History                          | Home, Meals, Pay, History           |

**On a desktop (1024px and wider)** the shell is the shadcn sidebar: a kitchen switcher at the head,
the role's pages in one flat group, and the account menu at the foot. It folds to an icon rail (the
shortcut is Ctrl or Cmd with B), and a search menu opens with Cmd or Ctrl and K, or `/`. **On a
phone** a 56px top bar carries the page title, and a 64px bottom bar carries the pages, with the
active one marked in the brand colour and a saffron bar. **More** opens a bottom sheet that traps
focus and closes with Escape or Back.

On every route change the page's title is set to _Page · Kitchen · Alimentation_, focus moves to the
page's heading, the page scrolls to the top (unless it was Back or Forward), and a polite live
region announces the title. A _Skip to content_ link is the first thing the keyboard reaches.

## Page header, empty states and skeletons

Every page starts with a `PageHeader`: its name as the one `h1`, a line saying what it is for, one
primary action, and its tabs. A page with nothing to show uses an `EmptyState`: an icon, one
sentence, and the action that fills it. While data is on its way a page shows a skeleton of its own
layout, after 150ms and for at least 300ms, never the text _Loading…_. A refused page, a missing
page and a kitchen the person is not in all use `NotAvailable`, with a reason and a way home.

## Theme choice

The theme is **Auto, Light or Dark**. In the app it is in the account menu, on the home page it is a
group of three radios in the footer, and on the guides and docs it is one button in the top bar that
steps through the three. All of them keep the choice under the `theme` key, so every page answers to
it. `public/theme.js` applies it before the first paint, and a change of theme dissolves instead of
switching. Auto removes the `data-theme` attribute and the stylesheet follows the system again.

## The site header

The home page, the guides and the docs share one header: the brand mark, **Guides**, **Docs**, and
then **Open your kitchen** for someone signed in or **Sign in** for anyone else. On the guides and
docs, someone signed in also gets a **Back to** the kitchen they came from, under the bar. The
guides and docs add a search field and the theme button; the home page adds the names of its own
sections. Opening _Help_ from the app opens these pages in a new tab.

## Icon buttons

A button that is only a picture, for an action everyone knows (copy, close). It is named for a
screen reader (`aria-label`) and, with a pointer, by its tooltip. It is as high as any control, so
it can be hit. A picture alone is for an action that is obvious; anything that is not gets words.

<div class="demo">
<button type="button" class="icon-btn" aria-label="Copy this" title="Copy"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button>
<button type="button" class="icon-btn" aria-label="Copied" title="Copied"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
</div>

## Code

A listing is on a board, dark in both themes, and it is a component like the rest: `.code`, with an
optional bar (`.code-bar`) that says what it is, and the code in a `pre`. In the pages of these
sites it is written as a fenced block
([how](/docs/contributing/layout-and-testing/#code-and-diagrams-in-the-pages)), and what is below is
those blocks.

- **The bar** says the language, or the file and which lines of it. The copy button, an icon button,
  is at its end.
- **The copy button** comes forward when the block is pointed at or has focus, so it is not always
  over the code. Where there is no pointer to point with (a phone) it is always there, and a
  keyboard user finds it by tabbing into the block. When it has copied it turns green and says so,
  and a screen reader is told.
- **Line numbers** are in the margin and cannot be selected or copied. A listing is numbered from
  six lines on, and a block of lines from a real file carries that file's own numbers.
- **A console** is a session. A `$` before a line marks what is typed, and the rest is what came
  back, dimmer. Copying takes the commands only.

```ts
export function owed(balance: number, earlier: number): number {
  // A credit counts as nothing, so one person's cannot hide another's debt.
  return Math.max(0, balance + earlier);
}
```

```console
$ docker compose run --rm app node cli.mjs keys:rewrap
{"currentKey":2,"workspaces":14,"retiredCopies":0,"skipped":0,"stillOnOldKey":0}
$ docker compose ps
```

```sh
# A script, which has no prompt and nothing coming back.
set -eu
bun run build
```

The colours are tokens (`--board`, `--board-ink`, `--board-dim` and the `--code-*` set), so a
listing follows a change of theme without being drawn again.

## Rules for using the pieces

1. **Compose; do not restyle.** A screen sets no colour, size or shadow of its own. If a piece does
   not fit, the piece is wrong: change it here.
2. **Use the kit's control, not the browser's.** A number is a `CountInput` or a `MoneyInput`, a
   date is a `DateField`, a choice is a select, a toggle group or a radio group. The checker refuses
   `type="number"`, a native date, checkbox, radio or file input, and a bare `<select>` outside the
   kit.
3. **Every page has a `PageHeader` or a `NotAvailable`,** so no page can leave out its title or its
   focus handling.
4. **Words first.** A label, a button and a message are written for the person (see
   [Principles](/docs/design/principles/)).
5. **Attribution stays visible.** A list of entries shows who added each and when it was late.
6. **Both themes, every time.** Look at a new piece in light and dark before it is used.
