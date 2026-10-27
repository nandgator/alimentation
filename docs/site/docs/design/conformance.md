---
title: Conformance
description: What the design check enforces, how to run it, how to waive a rule with a reason, and what only a person or another test can judge.
---

# Conformance

A design system nobody checks is a suggestion. `scripts/check-design.mjs` reads every stylesheet and component of the web app and fails when one leaves the system. It runs as `npm run design`, as a test in the suite (`apps/web/src/design.test.ts`), and in the compose test run, so a departure fails the same build a broken test does.

```sh
npm run design              # one line: kept, or how many places leave it
node scripts/check-design.mjs --list    # every place, with its file, line, rule and text
```

At the time of writing the app has **no departures** and **three waivers**.

## What it enforces

| Rule         | What it refuses                                                                                                                                                         | Use instead                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `colour`     | A hex, `rgb()`, `hsl()`, `oklch()` or `lab()` colour outside the definition of a token.                                                                                 | A colour token, or `color-mix()` of tokens.                 |
| `shadow`     | A `box-shadow` or `drop-shadow()` that is not `none` or a token.                                                                                                        | `--elev-menu`, `--elev-toast`, `--elev-dialog`.             |
| `layer`      | A `z-index` outside `-2` to `2` (for a component's own parts) that is not a `--z-*` token, optionally plus or minus a small number.                                     | `--z-nav`, `--z-bar`, `--z-drawer`, `--z-pop`, `--z-toast`. |
| `important`  | `!important`, anywhere but the `prefers-reduced-motion: reduce` block.                                                                                                  | A selector that wins on its own.                            |
| `font`       | A `font-family`, or a `font` shorthand, that does not use `--serif`, `--sans` or `--mono`.                                                                              | The font tokens.                                            |
| `type`       | A `font-size` that is not a `--text-*` token, `inherit`, `em` or `%`, `clamp()` or `calc()`; or a `rem`/`px` size inside a `font` shorthand.                            | `--text-2xs` … `--text-2xl`.                                |
| `space`      | A `padding`, `margin` or `gap` in pixels off the two-pixel grid (to 24px), or not one of 28, 32, 40, 48, 56, 64, 80, 96.                                                | Multiples of two, or `--space-*`.                           |
| `radius`     | A `border-radius` other than 0, 4, 8, 12, 16, 999px, 50%, or a variable.                                                                                                | `--radius-xs` … `--radius-pill`.                            |
| `motion`     | A `transition` or `animation` with a duration in milliseconds, a `cubic-bezier()`, or an easing keyword outside `ease`, `ease-in`, `ease-out`, `ease-in-out`, `linear`. | `--dur-1..3`, `--ease-*`.                                   |
| `breakpoint` | An `@media (max-width)` or `min-width` that is not 480, 560, 720, 959, 960, 1199 or 1200.                                                                               | One of those ([Foundations](/docs/design/foundations/)).    |
| `inline`     | A `style={{ … }}` in a component that sets anything but a custom property. Multi-line style objects are refused.                                                        | A class, or `style={{ '--gap': '8px' }}`.                   |

The last rule is also a requirement of the content-security policy, which forbids inline styles: a `style` attribute that sets how something looks would be blocked in production, so the check keeps the code from ever relying on one.

### Where each rule applies

| File                                           | Rules                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/styles.css`                      | All.                                                                                                                                       |
| `apps/web/scripts/docs/docs.css` (these pages) | All.                                                                                                                                       |
| `apps/web/src/home.css`                        | `colour`, `shadow`, `layer`, `important` and `font`. The home page's pictures are drawn, so their shape and spacing are the drawing's own. |
| Every `.tsx` under `apps/web/src`              | `inline`.                                                                                                                                  |

## Waiving a rule

Sometimes a rule is right in general and wrong in one place. Say so on that line, with the reason:

```css
margin-left: -1px; /* design: it overlaps the rule beside it by that rule's own width */
```

```tsx
// design: a place taken from where the page is scrolled, so it cannot be a class
<div style={{ top: y }} />
```

In CSS the comment sits on the same line, or on a line of the same declaration. In a component it sits on that line or the one before. A waiver must begin `design:` and say **why**; one with no reason is a departure with extra steps, and review should treat it so. The list of waivers is short enough to read: `grep -rn "design:" apps/web`.

## What it cannot check

A script can tell that a value is a token. It cannot tell that the token is right. These are judged elsewhere:

| Matter                                                           | Where it is judged                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Contrast, labels, focus, headings in order                       | axe in the end-to-end journey, in light and dark.                      |
| A layout that fits at 320 to 430px, a bar that is not off-screen | `apps/web/e2e/layout.spec.ts`, which names the element that overflows. |
| The right component for the job                                  | Review, against [Components](/docs/design/components/).                |
| Words a member would use                                         | Review, against [Principles](/docs/design/principles/).                |
| Only `transform` and `opacity` move                              | Convention; reviewed.                                                  |

## Changing the system

1. Change the token or the component in `styles.css`, in light and dark.
2. Update the page here that shows it. The examples use the real stylesheet, so they change with it; the words beside them may not.
3. If a rule of the check needs to move (a new breakpoint, a new radius), change the scale in `scripts/check-design.mjs`, add a case to `design.test.ts`, and say why in the commit.
4. Run `npm run design` and the end-to-end tests.

## The checker is itself tested

`apps/web/src/design.test.ts` runs the check over the real application and requires an empty list. It also feeds the checker small stylesheets that break each rule, in each notation, and requires it to notice; and feeds it ones written in tokens and requires it to stay quiet. The checker reads statements, not lines, so a `transition` spread over several lines is read as one.
