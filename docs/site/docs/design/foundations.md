---
title: Foundations
description: The tokens every screen is built from: colour, type, space, shape, elevation, motion and breakpoints, shown with the real stylesheet.
---

# Foundations

<!-- markdownlint-disable MD013 -->

Every value a screen uses comes from a **token**: a CSS custom property defined once in
`apps/web/src/theme.css` and used by name. The names are shadcn/ui's, so any block from the shadcn
library drops in without recolouring. This page is rendered with that stylesheet, so everything
shown here is the real thing. Switch the theme (top right) and the swatches follow.

> [!NOTE] The only place a raw colour may be written is `theme.css`. A component says `bg-primary`,
> never a colour. Everywhere else the [conformance check](/docs/design/conformance/) refuses it.

## Colour

Colours have a **job**, not a name. Use the one for the job. The warm neutrals sit at hue 85 to 90,
the indigo at 272, and the three money states far from it: green at 155, amber at 60 to 85, red
at 27.

### Surfaces and text

<div class="swatches">
<div class="swatch sw-background"><i></i><b>--background</b><span>The page, a warm ledger paper.</span></div>
<div class="swatch sw-card"><i></i><b>--card</b><span>Something that lies on the page. Also --popover.</span></div>
<div class="swatch sw-muted"><i></i><b>--muted</b><span>A recessed area: table heads, chips, code.</span></div>
<div class="swatch sw-secondary"><i></i><b>--secondary</b><span>A quiet button.</span></div>
<div class="swatch sw-border"><i></i><b>--border</b><span>Decorative lines only.</span></div>
<div class="swatch sw-input"><i></i><b>--input</b><span>The edge of a control, at 3:1 or more.</span></div>
<div class="swatch sw-foreground"><i></i><b>--foreground</b><span>Text.</span></div>
<div class="swatch sw-muted-foreground"><i></i><b>--muted-foreground</b><span>Secondary text.</span></div>
</div>

### The brand

<div class="swatches">
<div class="swatch sw-primary"><i></i><b>--primary</b><span>The main action, links, the current menu item. Text on it is --primary-foreground.</span></div>
<div class="swatch sw-accent"><i></i><b>--accent</b><span>A quiet indigo tint: a hover, a selected row. Text on it is --accent-foreground.</span></div>
<div class="swatch sw-ring"><i></i><b>--ring</b><span>Focus.</span></div>
<div class="swatch sw-highlight"><i></i><b>--highlight</b><span>Saffron. The brand mark, a two-pixel selection marker, and the bar under the active tab. Never text, a status or a button fill.</span></div>
</div>

### Status

Every status is an icon, a word and a colour together. The `-foreground` token is the one that
carries text; the plain one is for an edge or an icon, and the `-soft` one is the ground.

<div class="swatches">
<div class="swatch sw-success"><i></i><b>--success</b><span>Paid, confirmed. With --success-soft and --success-foreground.</span></div>
<div class="swatch sw-warning"><i></i><b>--warning</b><span>Owed, waiting, nearly full. With --warning-soft and --warning-foreground.</span></div>
<div class="swatch sw-destructive"><i></i><b>--destructive</b><span>Overdue, disputed, refused, cannot be undone. Text on it is --destructive-foreground.</span></div>
<div class="swatch sw-info"><i></i><b>--info</b><span>Neutral news. With --info-soft and --info-foreground.</span></div>
</div>

### Charts

<div class="swatches">
<div class="swatch sw-chart-1"><i></i><b>--chart-1</b><span>Billed. Also the indigo.</span></div>
<div class="swatch sw-chart-2"><i></i><b>--chart-2</b><span>Collected.</span></div>
<div class="swatch sw-chart-3"><i></i><b>--chart-3</b><span>A third series.</span></div>
<div class="swatch sw-chart-4"><i></i><b>--chart-4</b><span>A neutral series.</span></div>
<div class="swatch sw-chart-5"><i></i><b>--chart-5</b><span>A fifth series.</span></div>
</div>

### Code

A listing is on a board that is dark in both themes. Its colours are written in the theme's own
tokens, mixed toward the board's ink so that each reads at 4.5:1 and more.

<div class="swatches">
<div class="swatch sw-board"><i></i><b>--board</b><span>The board a listing is on. Its ink is --board-ink, and its quiet text --board-dim.</span></div>
<div class="swatch sw-code-keyword"><i></i><b>--code-keyword</b><span>Keywords, tags, selectors.</span></div>
<div class="swatch sw-code-string"><i></i><b>--code-string</b><span>Strings and what is written into them.</span></div>
<div class="swatch sw-code-number"><i></i><b>--code-number</b><span>Numbers, and true, false and null.</span></div>
<div class="swatch sw-code-type"><i></i><b>--code-type</b><span>Types, classes and built-ins.</span></div>
<div class="swatch sw-code-name"><i></i><b>--code-name</b><span>Attributes, properties and variables.</span></div>
<div class="swatch sw-code-function"><i></i><b>--code-function</b><span>The names of functions and sections.</span></div>
</div>

### Rules for colour

1. **Status is shown three ways**: an icon, a word and a colour. Paid is green with a check. Owed is
   amber with a clock. Overdue is red with an alert icon and bold text. Pending is neutral with a
   dot-circle icon. Disputed is red with a message icon.
2. **No status or brand element is a filled circle, square or triangle** on or beside a meal row.
   Those shapes are the FSSAI vegetarian and non-vegetarian marks.
3. **Saffron is never text, a status or a button fill.**
4. **`--border` is for decorative lines.** The edge of a control uses `--input`, which is at least
   3:1 against the card.
5. **Warning and info colours never carry text.** Text uses their `-foreground` tokens.

### Light and dark

Each token above is redefined for dark mode, in two places: under `prefers-color-scheme: dark`
unless the person chose light, and under `[data-theme='dark']` when they chose it. Tailwind's
`dark:` variant follows the same attribute. Do not write a colour twice; write a token once and give
it both values.

A test, `apps/web/src/tokens.test.ts`, parses the theme, turns every pair into sRGB and checks it
against a floor, in both themes:

| Pairs                                                        | Least contrast |
| ------------------------------------------------------------ | -------------- |
| Text on the page, a card and a popover                       | 7              |
| Secondary text on the page, a card and a muted ground        | 4.5            |
| Button text on `--primary`; text on `--destructive`          | 4.5            |
| Each `-foreground` on its `-soft` ground                     | 4.5            |
| `--primary` on the page, because it is used as link text     | 4.5            |
| The edge of a control, the focus ring, and each chart colour | 3              |

When a pair fails, only the lightness of the failing token changes, never its hue or chroma.

## Type

One family. **Figtree** (`--font-sans`, also used for headings) is for everything: headings, figures
and sentences. **Noto Sans Devanagari** stands behind it for Devanagari text and for the rupee sign,
so ₹ always draws. `--font-mono` is for code and addresses. Every web font is served from the app
itself.

<div class="specimens">
<p><code>Body</code><span class="t-body">14px on a desktop, 16px on a phone (a form field is never smaller), weight 400</span></p>
<p><code>Label</code><span class="t-label">14px, weight 500</span></p>
<p><code>H1</code><span class="t-h1">24px, 20px on a phone, weight 650</span></p>
<p><code>H2</code><span class="t-h2">18px, weight 600</span></p>
<p><code>Stat</code><span class="t-stat">₹12,400</span></p>
<p><code>Caption</code><span class="t-caption">12px, weight 500, and nothing is smaller</span></p>
</div>

The big figure of a page is 30px at weight 650. Every amount, count and date column uses tabular
numerals and is right-aligned, so columns of money line up. Sizes are in `rem`, so they follow the
person's own setting.

## Space

Tailwind's four-pixel grid: `1` is 4px, `2` is 8px, `4` is 16px, and so on. Gaps between related
things are small; gaps between groups are large. A gap that is not on the grid is written as a
utility, not as a pixel value.

<div class="rulers">
<div class="ruler"><code>1</code><i class="sp-1"></i><span>4px</span></div>
<div class="ruler"><code>2</code><i class="sp-2"></i><span>8px</span></div>
<div class="ruler"><code>3</code><i class="sp-3"></i><span>12px</span></div>
<div class="ruler"><code>4</code><i class="sp-4"></i><span>16px, also the page gutter</span></div>
<div class="ruler"><code>6</code><i class="sp-5"></i><span>24px</span></div>
<div class="ruler"><code>8</code><i class="sp-6"></i><span>32px</span></div>
<div class="ruler"><code>12</code><i class="sp-7"></i><span>48px</span></div>
<div class="ruler"><code>16</code><i class="sp-8"></i><span>64px</span></div>
</div>

### Size of a control

Every control is **44px high on a touch screen** (`h-11`) and **36px under a mouse or trackpad**
(`h-9`, applied under `@media (pointer: fine)`). A touch target is never smaller than 44 by 44. The
two sizes are decided by the pointer, not by the width of the window.

| Where            | Size                                                |
| ---------------- | --------------------------------------------------- |
| Phone top bar    | 56px, with the safe-area inset at the top.          |
| Phone bottom bar | 64px plus the safe-area inset; each item 48px wide. |
| Desktop sidebar  | Folds to an icon rail, shown from 1024px wide.      |

### Reading

Running text, which is what the guides and the docs are, has a few tokens of its own, local to these
pages, and takes the rest from the scale above. They were set once, so a long page is as easy to
follow at its end as at its start.

| Token            | Value | For                                                                                  |
| ---------------- | ----- | ------------------------------------------------------------------------------------ |
| `--measure`      | 46rem | The widest a line of running text runs. Longer lines are harder to follow back.      |
| `--leading`      | 1.7   | The height of a line of running text, as a multiple of its size.                     |
| `--leading-lede` | 1.55  | The same for the larger opening paragraph of a page.                                 |
| `--flow`         | 20px  | The rest between paragraphs, lists, tables and code, about three quarters of a line. |

## Shape

One base, `--radius`, of 0.625rem (10px). shadcn derives the steps from it, and a component says
which it is.

<div class="shapes">
<div class="shape r-sm">sm</div>
<div class="shape r-md">md</div>
<div class="shape r-lg">lg</div>
<div class="shape r-xl">xl</div>
<div class="shape r-pill">full</div>
</div>

A control is `rounded-md` or `rounded-lg`. A card is `rounded-xl`. A badge is `rounded-full`. Only a
thing that is round by nature, such as an avatar or a switch, is a pill.

## Elevation

A card does not cast a shadow; it lies on the page, held by a one-pixel border. **Only a layer that
rises over the page casts one,** and the deeper the layer, the longer it is. There are three levels
and no more.

<div class="layers">
<div class="layer lay-flat">a card<br>border, no shadow</div>
<div class="layer lay-menu">shadow-md<br>menu, popover</div>
<div class="layer lay-dialog">shadow-lg<br>dialog, sheet</div>
</div>

The home page has its own two, `--lift` for boxes and `--lift-cut` for shapes with a cut edge (the
receipt), because there things hang on a wall rather than float over a page.

## Motion

Things move to show where they came from. Three durations and two curves are tokens in `theme.css`.

| Token           | Value                          | For                                         |
| --------------- | ------------------------------ | ------------------------------------------- |
| `--dur-1`       | 100ms                          | A menu, a popover, a tooltip.               |
| `--dur-2`       | 150ms                          | A dialog, a route change, a fade.           |
| `--dur-3`       | 250ms                          | A sheet sliding in; the sidebar folding.    |
| `--ease-out`    | `cubic-bezier(0.2, 0, 0, 1)`   | Most things. Fast to start, gentle to land. |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Things that go and come back.               |

| What                     | Motion                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| A route change           | The old page fades out in 90ms, and the new one fades in over 150ms and rises 4px. The shell does not move. |
| A dialog                 | Fades and scales from 0.98 to 1 over `--dur-2`.                                                             |
| A sheet                  | Slides from its edge over `--dur-3`; the scrim fades over `--dur-2`.                                        |
| A popover, menu, tooltip | A fade and a 2px shift over `--dur-1`. A tooltip opens after 300ms.                                         |
| A skeleton               | A 1.5s pulse that appears only after 150ms and stays at least 300ms.                                        |
| An optimistic toggle     | Changes at once. A rollback shakes it 2px over 150ms and shows an error.                                    |
| Never animated           | Money figures, table sorting, and anything on first paint.                                                  |

Under `prefers-reduced-motion: reduce` nothing moves: a route, a sheet and a dialog change at once
or by an opacity change of 100ms or less, and the pulse stops. The end-to-end tests run with reduced
motion so that nothing is measured halfway through a fade; a test that is about the motion turns it
back on for itself.

## Breakpoints

The app changes layout at the widths below, tested at 390 by 844 and 1440 by 900. These
documentation pages have two of their own, at 960 and 1200.

| Width (px) | What changes                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 768        | A table becomes a list of items. A dialog becomes a bottom sheet below this width.             |
| 1024       | The phone's top bar and bottom bar give way to the sidebar, which folds to an icon rail.       |
| 960 / 1200 | These pages: below 960 the contents is behind a button, and from 1200 it sits beside the page. |

Write the narrow layout first, then add what a wider screen can use.
