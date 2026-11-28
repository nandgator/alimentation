---
title: Design principles
description:
  What the look and feel of Alimentation is for, the choices that follow from it, and where the
  system is written down.
---

# Design principles

Alimentation keeps the accounts of a kitchen. It is used by people who know each other, on a phone,
a few times a month, usually to answer one question: **where do I stand?** The design exists to make
that answer quick, calm and believable. Everything on the next pages follows from the principles
here.

## The feel

A ledger, a **bahi**: **indigo ink on warm paper.** Paper-coloured backgrounds with a faint warmth,
a deep indigo for actions, links and the current place, and a saffron highlight that is used for
almost nothing: the tick in the brand's mark, a two-pixel marker beside the selected row, and the
bar under the active tab. One plain humanist sans, Figtree, carries every heading, every figure and
every sentence; Noto Sans Devanagari stands behind it for Devanagari and the rupee sign. The home
page draws its pictures as a kitchen would, in the same colours, and the app borrows only the
colours and the type, never the decoration. The app is a tool; the home page is a poster.

Green is not the brand. A green on a kitchen's screen should only ever mean _paid_, and an amber
only _owed_, so the colour of a button can never be mistaken for the state of a bill. Indigo sits
far from green, amber and red on the colour wheel for that reason.

## Principles

### 1. Say it the way a person would

Words are for the person reading, not for the database. _"Still waiting"_, not _"Pending"_. _"The
admin removed your Leave entry for 14 Oct"_, not _"DELETE log_entry"_. Every message says what
happened and what to do next. Messages live in one place (`packages/core/src/messages.ts`) so the
browser and the server say the same thing.

### 2. Lead with the figure that answers the question

A screen leads with the few numbers that say where you stand, larger and above the rest (a stat
card, or the hero card of a consumer's home), then the detail. Anything that is a projection, not a
fact, is badged _Projected_ with a caption that says what it is, and never looks settled.

### 3. Nothing is hidden, and nothing is anonymous

Every change shows who made it and when, to the people it affects. The History screen, the _Added
by_ column and the _Late_ chip are the design of the trust model, not decoration on it
([The trust model](/docs/concepts/trust-model/)). A design that made a change harder to attribute
would be a bug.

### 4. Flat by default; only what floats casts a shadow

A card lies on the page, held by a hairline. A shadow means _this is above the page_: a menu or a
popover (`shadow-md`), a dialog or a sheet (`shadow-lg`). A control rests on the page with a
hairline edge and no shadow. The home page has its own idea of depth for things hung on a wall.

### 5. Say the state three ways

A status is never a colour alone. Every one is an icon, a word and a colour: _Paid_ with a check on
green, _Owed_ with a clock on amber, _Overdue_ with an alert on red. And no status or brand element
is ever a filled circle, square or triangle on or beside a meal row: those shapes belong to the
FSSAI vegetarian and non-vegetarian marks, and a coloured dot beside a dish would be read as one.

### 6. Motion explains; it never decorates

Things move to show where they came from or went: a sheet slides from the edge it lives on, a toast
rises from the bottom, a page fades into the next in 150 milliseconds. Motion is limited to
`transform` and `opacity`, uses three durations and two curves, and stops when the person has asked
for less motion. Money figures and table sorting never animate.

The home page is the one exception, because it is the one place that persuades rather than serves.
What it does is one motion, read from top to bottom, and not a set of effects. Its parts:

- **One protagonist.** The carrier on the first screen's shelf is lifted off it as the page is first
  read and carried down to the first chapter's heading, where it stands while the heading is read.
  As the heading goes up it is put into the bar, where the mark, a ledger, has its rulings filled
  one after another as the rest of the page is read; and when the next chapter's heading comes up
  from the foot of the screen it is taken out of the bar and carried down to stand on that, and so
  on to the last. While the page is moving it is placed from the scroll alone, so it goes back the
  way it came as the page goes back. It is never left in the air: when the page has stopped for a
  moment it eases on to the rest it was nearer, back to the one it came from if the page left it
  less than half way and on to the one it was going to if more, as a desktop that is swiped half way
  goes to one side or the other; and when the page moves again it lets go of that without a pull.
  The bar shows a ghost of its mark from the first screen on, so there is always a place it is going
  to. The guides and docs have the same mark, filled by the same scroll.
- **Sheets.** Each section lies over the bottom of the one before with its top corners rounded, and
  the corners ease flat as it comes up the screen, so one colour is poured into the next and not cut
  off from it.
- **Arrivals follow the scroll.** What is below the first screen arrives by how far up the screen it
  has come: headings rise line by line, figures roll, the receipt prints and stamps its checks, and
  the light over the name at the foot comes on. A hard scroll sweeps them in as fast as it goes and
  a scroll back lets them go. Where a browser cannot tie an animation to the scroll, the same
  arrivals are timed, once.
- **Steam.** A few bold lines of steam are drawn from behind the lids of the carrier and the pot, as
  heavy as the picture's own lines, each its own length, thickness, lean and sway. The wisps of one
  lid share one pace and start at spread points of it, so a lid is never quiet and never puffs;
  wisps on paces of their own drift into step and do. The carrier on the Moving stage steams when it
  is set down, and not while it is in the air.
- **A carrier that cannot snap.** Where the carrier is, is one number that a spring follows, and the
  page only says where it should be. A page scrolled back and forth turns the carrier round in the
  air; a timed hop that is cancelled and restarted would put it back where it last landed.
- **The first screen lets go in layers**: its words fall a little behind the scroll and its picture
  rises a little ahead. The chapter being read is underlined in the bar.
- **A light over the name** at the foot that follows a pointer and otherwise wanders. A change of
  theme made from the footer hides the page from the pointer for as long as it dissolves, and that
  is not the pointer leaving, so the light stays where the hand is.
- **A change of theme dissolves.** Choosing another theme, from any page, cross-fades the whole page
  over `--dur-4` instead of switching it, and with reduced motion switches at once.

Beyond `transform` and `opacity` the home page may move a mask, a clip, a corner radius and a line's
dash, each in a small area and none of them text. Everything on it runs only while in view, and with
reduced motion nothing moves: the steam is drawn in full, the sheets keep their corners, the mark
stays empty, the light over the name rests in the middle and still follows a pointer, which is the
person's own movement.

### 7. One way to do each job

A screen exists once, in a list (`sections.ts`), and the menu, the routes and the _not for your
role_ answer are all read from it. A control has one look in one place: it is a component of the app
kit, built on shadcn/ui, and a screen composes the kit and restyles nothing. A new need is first a
question of which existing piece does it, and only then of a new piece.

Each role has a home of its own and a menu of its own. On screen the roles are _Admin_, _Cook_ and
_Consumer_.

### 8. The thumb is the pointer

The phone is the main device. Navigation sits at the bottom, where a thumb is, and the main action
of a page sits just above it; every control is at least 44 pixels high under a finger and 36 under a
mouse; a form on a phone is a sheet that rises from the bottom, with its buttons always in view.
Every page is tested at 390 by 844 and at 1440 by 900. Hover is an addition for those who have a
pointer, never the only way to learn something.

### 9. Accessible because it is tested

Every colour pair in the theme meets its contrast ratio in both themes, and a test computes it.
Focus is always visible and moves to the page's heading on every route change. Every route, for
every role, in both themes and at both sizes, passes axe, and no page scrolls sideways. A rule that
depends on remembering is not a rule; these are in tests
([Layout and testing](/docs/contributing/layout-and-testing/)).

### 10. Trust the system, then check it

A design system that nobody checks is a suggestion. The tokens and the components are enforced by a
script that fails the build ([Conformance](/docs/design/conformance/)).

## Where it is written down

| Page                                     | What it holds                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| [Foundations](/docs/design/foundations/) | The tokens: colour, type, space, shape, elevation, motion and breakpoints. Shown live.  |
| [Components](/docs/design/components/)   | The pieces the screens are made of, and the rules for using them. Shown live.           |
| [Conformance](/docs/design/conformance/) | What the checker enforces, how to waive a rule with a reason, and what it cannot check. |

The source of truth for every value is the theme, `apps/web/src/theme.css`. These pages are rendered
with that very stylesheet, so every swatch and scale shown is the real one: if a token changes, this
page changes with it. The reasoning behind the choices, and what was weighed against them, is in the
decision record, `docs/research/ui-rewrite-plan.md`.
