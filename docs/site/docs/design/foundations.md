---
title: Foundations
description: The tokens every screen is built from: colour, type, space, shape, elevation, layers, motion and breakpoints, shown with the real stylesheet.
---

# Foundations

Every value a screen uses comes from a **token**: a CSS custom property defined once in `apps/web/src/styles.css` and used by name. This page is rendered with that stylesheet, so everything shown here is the real thing. Switch the theme (top right) and the swatches follow.

> [!NOTE]
> The only place a raw colour, size or duration may be written is the definition of a token. Everywhere else the [conformance check](/docs/design/conformance/) refuses it.

## Colour

Colours have a **job**, not a name. Use the one for the job.

### Surfaces and text

<div class="swatches">
<div class="swatch sw-bg"><i></i><b>--bg</b><span>The page. Also called --paper.</span></div>
<div class="swatch sw-paper-2"><i></i><b>--paper-2</b><span>A recessed area: table heads, chips, code.</span></div>
<div class="swatch sw-card"><i></i><b>--card</b><span>Something that lies on the page.</span></div>
<div class="swatch sw-hair"><i></i><b>--hair</b><span>Hairlines and borders.</span></div>
<div class="swatch sw-ink"><i></i><b>--ink</b><span>Text.</span></div>
<div class="swatch sw-ink-2"><i></i><b>--ink-2</b><span>Secondary text, and borders of controls.</span></div>
</div>

### Action and attention

<div class="swatches">
<div class="swatch sw-brand"><i></i><b>--brand</b><span>The main action, links, the current menu item. Text on it is --brand-ink.</span></div>
<div class="swatch sw-accent"><i></i><b>--accent</b><span>The one thing that wants attention. Text on it is --accent-ink.</span></div>
<div class="swatch sw-accent-soft"><i></i><b>--accent-soft</b><span>A quiet highlight.</span></div>
</div>

### Meaning

Colour alone never carries meaning: a word or a shape always comes with it.

<div class="swatches">
<div class="swatch sw-good"><i></i><b>--good</b><span>Settled, confirmed, paid. Paired with --good-soft.</span></div>
<div class="swatch sw-good-soft"><i></i><b>--good-soft</b><span>The ground for good text.</span></div>
<div class="swatch sw-warn"><i></i><b>--warn</b><span>Waiting, late, nearly full. Paired with --warn-soft.</span></div>
<div class="swatch sw-warn-soft"><i></i><b>--warn-soft</b><span>The ground for warn text.</span></div>
<div class="swatch sw-bad"><i></i><b>--bad</b><span>Disputed, refused, destructive. Paired with --bad-soft; text on it is --bad-ink.</span></div>
<div class="swatch sw-bad-soft"><i></i><b>--bad-soft</b><span>The ground for bad text.</span></div>
</div>

### The kitchen

Used by the home page and the occasional brand moment, not by everyday screens.

<div class="swatches">
<div class="swatch sw-field-green"><i></i><b>--field-green</b><span>The deep green of a mess tray.</span></div>
<div class="swatch sw-board"><i></i><b>--board</b><span>The chalkboard: code blocks and the home page's menu board.</span></div>
</div>

### Light and dark

Each token above is redefined for dark mode, in two places: under `prefers-color-scheme: dark` unless the person chose light, and under `[data-theme='dark']` when they chose it. Do not write a colour twice; write a token once and give it both values. Pairs are chosen to meet contrast in both themes, and the end-to-end run checks that.

## Type

Two families. **Young Serif** (`--serif`) is for names, headings and figures that want weight. **Figtree** (`--sans`) is for everything else. `--mono` is for code and addresses. Both web fonts are served from the app itself.

<div class="specimens">
<p><code>--text-2xs</code><span class="t-2xs">0.6875rem, the smallest print: a badge, a legal line</span></p>
<p><code>--text-xs</code><span class="t-xs">0.75rem, labels and the small caps above a heading</span></p>
<p><code>--text-sm</code><span class="t-sm">0.875rem, secondary text, table cells, hints</span></p>
<p><code>--text-md</code><span class="t-md">1rem, controls and the body of a form</span></p>
<p><code>--text-base</code><span class="t-base">1.0625rem, running text</span></p>
<p><code>--text-lg</code><span class="t-lg serif">1.25rem, section headings</span></p>
<p><code>--text-xl</code><span class="t-xl serif">1.625rem, page titles</span></p>
<p><code>--text-2xl</code><span class="t-2xl serif">2.25rem, the big figure</span></p>
</div>

Sizes are in `rem`, so they follow the person's own setting. Fluid sizes (`clamp()`) are allowed for display type on the home page; nothing else is sized in pixels. Figures use lining, tabular numerals so columns of money line up.

## Space

A two-pixel grid up to 24 pixels, then a few larger steps. Gaps between related things are small; gaps between groups are large. Anything with a gap that is not on the grid is refused by the check.

<div class="rulers">
<div class="ruler"><code>--space-1</code><i class="sp-1"></i><span>4px</span></div>
<div class="ruler"><code>--space-2</code><i class="sp-2"></i><span>8px</span></div>
<div class="ruler"><code>--space-3</code><i class="sp-3"></i><span>12px</span></div>
<div class="ruler"><code>--space-4</code><i class="sp-4"></i><span>16px, also the page gutter</span></div>
<div class="ruler"><code>--space-5</code><i class="sp-5"></i><span>24px</span></div>
<div class="ruler"><code>--space-6</code><i class="sp-6"></i><span>32px</span></div>
<div class="ruler"><code>--space-7</code><i class="sp-7"></i><span>48px</span></div>
<div class="ruler"><code>--space-8</code><i class="sp-8"></i><span>64px</span></div>
</div>

Components that need a gap between tokens set it with `--gap` (see `.stack` and `.row`) rather than with a style attribute, which the content-security policy forbids.

### Size of a control

| Token          | Value | For                                                   |
| -------------- | ----- | ----------------------------------------------------- |
| `--control`    | 44px  | Every button and field. The least a thumb should hit. |
| `--control-sm` | 36px  | A control inside a row of text, and `btn small`.      |
| `--bar-h`      | 56px  | The bottom bar on a phone.                            |
| `--topbar-h`   | 58px  | The top bar.                                          |

### Reading

Running text, which is what the guides and the docs are, has three tokens of its own and takes the rest from the scale above. They were set once, so a long page is as easy to follow at its end as at its start, and a table or a list never feels crowded against the text around it.

| Token            | Value | For                                                                                          |
| ---------------- | ----- | -------------------------------------------------------------------------------------------- |
| `--measure`      | 46rem | The widest a line of running text runs. Longer lines are harder to follow back to the start. |
| `--leading`      | 1.7   | The height of a line of running text, as a multiple of its size.                             |
| `--leading-lede` | 1.55  | The same for the larger opening paragraph of a page, which is set quieter and bigger.        |
| `--flow`         | 20px  | The rest between paragraphs, lists, tables and code, about three quarters of a line.         |

A heading is set off from what came before by `--space-7` and from what it introduces by `--space-3`, so it belongs to its text. Nothing in a stylesheet is sized in `rem` for space: a `rem` is read as the pixels it comes to and must land on the grid like any other, so a gap cannot be made roomier by stepping around the scale.

## Shape

Anything round is a pill. Everything else uses one of five radii.

<div class="shapes">
<div class="shape r-xs">xs 4px</div>
<div class="shape r-sm">sm 8px</div>
<div class="shape r-md">md 12px</div>
<div class="shape r-lg">lg 16px</div>
<div class="shape r-pill">pill</div>
</div>

Buttons, chips and the search field are pills. Cards, tiles, tables and dialogs are `lg` or `md`. Small details inside them are `sm` or `xs`.

## Elevation

A card does not cast a shadow; it lies on the page, held by a hairline. **Only a layer that rises over the page casts one,** and the deeper the layer, the longer it is. There are three, and they are tokens.

<div class="layers">
<div class="layer lay-flat">a card<br>hairline only</div>
<div class="layer lay-menu">--elev-menu<br>menu, drawer</div>
<div class="layer lay-toast">--elev-toast<br>a note</div>
<div class="layer lay-dialog">--elev-dialog<br>a dialog</div>
</div>

In dark mode a shadow barely shows, so each of the three also gains a hairline edge of light. The home page has its own two, `--lift` for boxes and `--lift-cut` for shapes with a cut edge (the receipt), because there things hang on a wall rather than float over a page; the checker applies the same discipline there.

## Layers

What is above what is a scale, not a number to invent.

| Token        | Value | What sits there                                     |
| ------------ | ----- | --------------------------------------------------- |
| `--z-nav`    | 19    | The sidebar and the sub-navigation.                 |
| `--z-bar`    | 20    | The top bar and the phone's bottom bar.             |
| `--z-drawer` | 25    | The drawer menu, and the dim behind it at one less. |
| `--z-pop`    | 40    | Menus and result lists that open from a control.    |
| `--z-toast`  | 50    | A note that something happened.                     |

Inside a component, `-1`, `0`, `1` and `2` are allowed to stack its own parts. Nothing else is.

## Motion

Things move to show where they came from. By convention only `transform` and `opacity` move, so nothing reflows. Three durations and three curves are tokens.

| Token           | Value                            | For                                         |
| --------------- | -------------------------------- | ------------------------------------------- |
| `--dur-1`       | 140ms                            | A press or a hover.                         |
| `--dur-2`       | 220ms                            | A slide: a drawer, a panel, a toast.        |
| `--dur-3`       | 400ms                            | An arrival: a figure, a picture.            |
| `--ease-out`    | `cubic-bezier(0.22, 1, 0.36, 1)` | Most things. Fast to start, gentle to land. |
| `--ease-expo`   | `cubic-bezier(0.16, 1, 0.3, 1)`  | Large movements.                            |
| `--ease-in-out` | `cubic-bezier(0.76, 0, 0.24, 1)` | Things that go and come back.               |

Plain `ease`, `linear` and friends are allowed for colour changes. Anything that moves is inside `@media (prefers-reduced-motion: no-preference)` or switched off in a `prefers-reduced-motion: reduce` block, where `!important` is permitted for this one purpose. The end-to-end tests run with reduced motion so that nothing is measured halfway through a fade; a test that is about the motion turns it back on for itself.

## Breakpoints

The app and these documentation pages change layout at these widths and no others. (The home page's pictures were drawn at widths of their own, and are the one exemption.)

| Width (px)  | What changes                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 480         | The narrowest phones: the brand's name leaves the top bar and only the mark stays.                                                      |
| 560         | The account name and the Help link leave the top bar (Help moves into the bottom bar's More panel), and the lead figures stack as rows. |
| 720         | A phone. The kitchen's menu becomes the fixed bottom bar, and the top bar holds one line.                                               |
| 959 / 960   | Below 960 the kitchen's menu is a row under the top bar, or the bottom bar; from 960 it is a sidebar that can be hidden.                |
| 1199 / 1200 | From 1200 the documentation shows its contents beside the page.                                                                         |

Write the narrow layout first, then add `max-width` queries from this list.
