---
title: Conformance
description:
  What the design check enforces, how to run it, how to waive a rule with a reason, and what only a
  person or another test can judge.
---

# Conformance

A design system nobody checks is a suggestion. `scripts/check-design.mjs` reads every stylesheet and
component of the web app and fails when one leaves the system. It runs as `bun run design`, as a
test in the suite (`apps/web/src/design.test.ts`), and in the compose test run, so a departure fails
the same build a broken test does.

```console
$ bun run design              # one line: kept, or how many places leave it
$ node scripts/check-design.mjs --list    # every place, with its file, line, rule and text
```

## What it enforces

The checker works on the utilities in the markup and on the tokens, which is how the app is now
written. Its rules are:

| Rule        | What it refuses                                                                                                                                | Use instead                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `colour`    | A hex, `rgb()`, `hsl()` or `oklch()` colour outside `src/theme.css`: in a stylesheet, in a class string, or in an arbitrary value (`bg-[#…]`). | A token: `bg-primary`, `text-muted-foreground`.   |
| `arbitrary` | An arbitrary Tailwind length (`w-[13px]`) outside `src/components/ui/`.                                                                        | A step of the scale, or a waiver that says why.   |
| `control`   | `type="number"`, a native date, checkbox, radio or file input, or a `<select>`, outside `components/ui/` and `components/app/`.                | `CountInput`, `MoneyInput`, `DateField`, the kit. |
| `reload`    | `window.location.reload`.                                                                                                                      | Refetch the data.                                 |
| `title`     | A page under `src/pages/` that renders neither a `PageHeader` nor a `NotAvailable`.                                                            | `PageHeader`.                                     |
| `icon`      | An icon that is not from `lucide-react`; an inline `<svg>` outside `Mark.tsx`, `src/home/` and the chart.                                      | `lucide-react`.                                   |
| `role-name` | A string in the interface that says _Supplier_ or _Member_.                                                                                    | `ROLE_LABEL`: _Cook_, _Consumer_.                 |
| `inline`    | A `style={{ … }}` that sets anything but a custom property, which the charts and the sidebar need and which carries a waiver.                  | A class.                                          |
| `status`    | A `rounded-full` element with a background fill, 8 or 12px across, beside status text: the no-dot rule.                                        | `StatusBadge`.                                    |

The `inline` rule is also a requirement of the content-security policy, which forbids inline styles:
a `style` attribute that sets how something looks would be blocked in production, so the check keeps
the code from ever relying on one.

### Where each rule applies

| File                                           | Rules                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| Every `.tsx` and `.css` under `apps/web/src`   | All, except `colour` in `src/theme.css`, where the tokens are made. |
| `apps/web/src/components/ui/`                  | All but `arbitrary` and `control`: they are the shadcn components.  |
| `apps/web/src/home/` (the drawn pictures)      | All but `icon` for `<svg>`: the pictures are drawn.                 |
| `apps/web/scripts/docs/docs.css` (these pages) | `colour`: every colour is a token or a mix of tokens.               |

## Waiving a rule

Sometimes a rule is right in general and wrong in one place. Say so on that line, with the reason:

```css
margin-left: -1px; /* design: it overlaps the rule beside it by that rule's own width */
```

```tsx
// design: a place taken from where the page is scrolled, so it cannot be a class
<div style={{ top: y }} />
```

In CSS the comment sits on the same line, or on a line of the same declaration. In a component it
sits on that line or the one before. A waiver must begin `design:` and say **why**; one with no
reason is a departure with extra steps, and review should treat it so. The list of waivers is short
enough to read: `grep -rn "design:" apps/web`.

## What it cannot check

A script can tell that a value is a token. It cannot tell that the token is right. These are judged
elsewhere:

| Matter                                                                        | Where it is judged                                                                      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Contrast of every pair of colours, in both themes                             | `apps/web/src/tokens.test.ts`, which computes each pair and fails below its floor.      |
| Contrast, labels, focus and headings in order on every page                   | axe in `apps/web/e2e/a11y.spec.ts`, for every route and role, in both themes and sizes. |
| A layout that fits at 390 and at 1440, and a page that never scrolls sideways | The end-to-end specs, which run each at both sizes.                                     |
| A control that is 44px under a finger, and uses the page's font               | `apps/web/e2e/controls.spec.ts`.                                                        |
| A unique title for every route, and focus on the heading                      | `apps/web/e2e/navigation.spec.ts`.                                                      |
| The right component for the job                                               | Review, against [Components](/docs/design/components/).                                 |
| Words a person would use                                                      | Review, against [Principles](/docs/design/principles/).                                 |
| Only `transform` and `opacity` move                                           | Convention; reviewed.                                                                   |

## Changing the system

1. Change the token in `theme.css`, in light and dark, and run `tokens.test.ts`. If a pair fails,
   change only the lightness of the failing token.
2. To change a component, run `bunx shadcn@latest add` again for a ui component, or change the app
   kit's one component; never restyle it in a screen.
3. Update the page here that shows it. The examples use the real tokens, so they change with them;
   the words beside them may not.
4. If a rule of the check needs to move, change it in `scripts/check-design.mjs`, add a case to
   `design.test.ts`, and say why in the commit.
5. Run `bun run design` and the end-to-end tests.

## The checker is itself tested

`apps/web/src/design.test.ts` runs the check over the real application and requires an empty list.
It also feeds the checker small files that break each rule, in each notation, and requires it to
notice; and feeds it ones written in tokens and requires it to stay quiet.
