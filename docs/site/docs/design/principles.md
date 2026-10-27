---
title: Design principles
description: What the look and feel of Alimentation is for, the choices that follow from it, and where the system is written down.
---

# Design principles

Alimentation keeps the accounts of a kitchen. It is used by people who know each other, on a phone, a few times a month, usually to answer one question: **where do I stand?** The design exists to make that answer quick, calm and believable. Everything on the next pages follows from the principles here.

## The feel

A kitchen ledger: **steel, green and turmeric.** Paper-coloured backgrounds, a deep green for actions, a turmeric accent for the one thing that wants attention, a serif for names and headings (Young Serif) and a plain humanist sans (Figtree) for everything you read and press. The home page draws its pictures as a kitchen would, and the app borrows only its colours and type, never its decoration. The app is a tool; the home page is a poster.

## Principles

### 1. Say it the way a member would

Words are for the person reading, not for the database. _"Still waiting"_, not _"Pending"_. _"The admin removed your Leave entry for 14 Oct"_, not _"DELETE log_entry"_. Every message says what happened and what to do next. Messages live in one place (`packages/core/src/messages.ts`) so the browser and the server say the same thing.

### 2. Lead with the figure that answers the question

A screen leads with the few numbers that say where you stand, larger and above the rest (`Tile lead`), then the detail. Anything that is a projection, not a fact, is drawn as one (`tile projected`) and never looks settled.

### 3. Nothing is hidden, and nothing is anonymous

Every change shows who made it and when, to the people it affects. The History screen, the _Added by_ column and the _Late_ chip are the design of the trust model, not decoration on it ([The trust model](/docs/concepts/trust-model/)). A design that made a change harder to attribute would be a bug.

### 4. Flat by default; only what floats casts a shadow

A card lies on the page, held by a hairline. A shadow means _this is above the page_: a menu, a toast, a dialog. The deeper the layer, the longer the shadow. There are three, and they are tokens (`--elev-menu`, `--elev-toast`, `--elev-dialog`). The home page has its own idea of depth for things hung on a wall.

### 5. Motion explains; it never decorates

Things move to show where they came from or went: a menu slides from the edge it lives on, a toast rises from the bottom. Motion is limited to `transform` and `opacity`, uses three durations and three curves, and stops when the person has asked for less motion.

### 6. One way to do each job

A screen exists once, in a list (`sections.ts`), and the menu, the routes and the _not for your role_ answer are all read from it. A control has one look in one place. A new need is first a question of which existing piece does it, and only then of a new piece.

### 7. The thumb is the pointer

The phone is the main device. Navigation sits at the bottom, where a thumb is; every control is at least 44 pixels high (36 where it sits in a row of text); the bottom bar fits from 320 pixels wide up, and is tested at 320, 360, 390 and 430. Hover is an addition for those who have a pointer, never the only way to learn something.

### 8. Accessible because it is tested

Colour pairs meet contrast in both themes. Focus is always visible. Every stage of the end-to-end journey passes axe, the main screens again in dark, and no page scrolls sideways. A rule that depends on remembering is not a rule; these are in tests ([Layout and testing](/docs/contributing/layout-and-testing/)).

### 9. Trust the system, then check it

A design system that nobody checks is a suggestion. The tokens are enforced by a script that fails the build ([Conformance](/docs/design/conformance/)).

## Where it is written down

| Page                                     | What it holds                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Foundations](/docs/design/foundations/) | The tokens: colour, type, space, shape, elevation, layers, motion, breakpoints. Shown live. |
| [Components](/docs/design/components/)   | The pieces the screens are made of, and the rules for using them. Shown live.               |
| [Conformance](/docs/design/conformance/) | What the checker enforces, how to waive a rule with a reason, and what it cannot check.     |

The source of truth for every value is the stylesheet, `apps/web/src/styles.css`. These pages are rendered with that very stylesheet, so every swatch, scale and component shown is the real one: if a token changes, this page changes with it.
