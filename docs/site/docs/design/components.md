---
title: Components
description: The pieces every screen is made of, shown live, with the one rule for using each.
---

# Components

A screen is assembled from these pieces and nothing else. If a screen needs something that is not here, add it here first, with an example and a rule, then use it. The examples below are the application's own classes, rendered with its own stylesheet.

## Buttons

One button, four tones. **A screen has at most one primary button;** the others are quiet.

<div class="demo">
<button type="button" class="btn">Save</button>
<button type="button" class="btn accent">Pay now</button>
<button type="button" class="btn ghost">Cancel</button>
<button type="button" class="btn danger">Delete everything</button>
<button type="button" class="btn small ghost">Small</button>
<button type="button" class="btn" disabled>Disabled</button>
</div>

| Tone    | Class        | Use it for                                                                  |
| ------- | ------------ | --------------------------------------------------------------------------- |
| Primary | `btn`        | The one thing this form or screen is for.                                   |
| Accent  | `btn accent` | A single call to attention. Rare.                                           |
| Quiet   | `btn ghost`  | Everything else: cancel, back, a second action.                             |
| Danger  | `btn danger` | Only what cannot be undone, and always behind a confirmation that names it. |
| Small   | `btn small`  | Inside a row of text or a table. Still 36px high.                           |

A button says what it does (_Save the rates_, _Close the month_), never _OK_ or _Submit_. It shrinks slightly on press and answers a pointer only where there is one. A disabled button is for a request in flight, never for a rule the person has not been told about: tell them instead.

## Fields and forms

A label above, a hint below, one column on a phone. Fields are 44px high. A select draws its own arrow, 16px in from the right edge and in the ink colour, so it follows the theme; a rule that sets a select's padding keeps the 40px at the right that the arrow needs.

<div class="demo">
<div class="field"><label for="demo-name">Name</label><input id="demo-name" type="text" autocomplete="off" value="Anita"><span class="hint">As you want it to show on the bill.</span></div>
<div class="field"><label for="demo-day">Menu for Monday</label><select id="demo-day"><option>Veg</option><option>Non Veg</option></select></div>
</div>

A hint says what the field is for or what shape it takes; an error says what is wrong and what to do (_Add a date in the last month_), next to the field when it can and in a banner above the form when it cannot. A form disables itself while it sends and shows what the server said when it refuses (`useAction`).

## Chips

A word with a colour behind it, for a status. The word carries the meaning; the colour agrees with it.

<div class="demo">
<span class="chip">Open</span>
<span class="chip good">Confirmed</span>
<span class="chip warn">Late</span>
<span class="chip bad">Disputed</span>
</div>

## Banners

A sentence the person must not miss, in the flow of the page. A banner that reports an error is announced to a screen reader at once (`role="alert"`).

<div class="demo">
<div class="banner info">The month closes on 31 October. Until then anyone can still catch up.</div>
<div class="banner good">Your payment was confirmed by the supplier.</div>
<div class="banner warn">This entry was added three days after the day itself.</div>
<div class="banner bad">That month is closed. Ask the admin to add it for you: it will be marked late.</div>
</div>

## Tiles

One figure and its name. The few that answer _where do I stand?_ are `lead` and sit larger above the rest; on a phone they stack as three rows with the figure at the right. A figure that is a forecast is `projected`, set lighter and in italics, so it never looks settled.

<div class="demo">
<div class="tiles lead">
<div class="tile lead"><div class="k">You owe</div><div class="v">₹1,240</div></div>
<div class="tile lead"><div class="k">Paid so far</div><div class="v">₹2,600</div></div>
<div class="tile lead projected"><div class="k">This month, if it goes on</div><div class="v">₹3,840</div></div>
</div>
<div class="tiles">
<div class="tile"><div class="k">Meals</div><div class="v">19</div></div>
<div class="tile"><div class="k">Extras</div><div class="v">₹60</div></div>
<div class="tile"><div class="k">Waiting</div><div class="v">1</div></div>
</div>
</div>

## Cards and tables

A card lies flat on the page, held by a hairline (never a shadow). A table sits in a `tablewrap`, which scrolls sideways inside itself on a narrow screen rather than pushing the page wider, and which can be focused so the keyboard can scroll it. Figures are right-aligned with tabular numerals (`.num`). A cell that opens something is a real button inside the cell.

<div class="demo">
<div class="card">A card holds one thing that belongs together: a form, a statement, a list.</div>
<div class="card danger">A card with a red edge is for what cannot be undone.</div>
</div>

## Page and section heads

Every screen starts with a `PageHead`: its name as the one `h1`, a line saying what it is for, and the things to do here on the right. Inside a screen, a `SectionHead` introduces each part with an `h2`. Headings go in order and never skip a level.

## Dialog

A modal `<dialog>` with a title, used for a decision that needs the whole screen's attention: confirming something that cannot be undone, or a short form that would crowd the page. It traps focus, closes with Escape, and is the only thing besides the toast that casts the deepest shadow (`--elev-dialog`). A dialog says what will happen and has a button that names it.

## Toast

A short note that something happened, which rises from the bottom and goes after a few seconds. A success is a quiet note (`toast(msg)`); a refusal is `toast(msg, 'bad')`, stays for six seconds and is announced at once. A toast is never the only record of something important: the thing it reports is also visible on the page.

## Navigation

The kitchen's screens are one list ([Layout and testing](/docs/contributing/layout-and-testing/)); the menu is drawn from it in whichever form the width allows.

| Width           | Form                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 960px and wider | A sidebar in three groups (_Day to day_, _The kitchen_, _The books_). It can be hidden with **Hide this menu**; it then becomes a drawer behind **Menu** in the top bar, and the choice is remembered on that device. |
| 720 to 959px    | A row of the screens under the top bar.                                                                                                                                                                               |
| 720px and under | A fixed bottom bar with the five most used screens and **More**, which opens a panel with the rest, grouped, and **Help**.                                                                                            |

The kitchen's name and the role being acted as (a switch, for someone who holds more than one role) belong to the menu, because they decide what every screen in it means. So they travel with it: at the head of the sidebar when there is one, and in the top bar when the menu is a row or a bottom bar. The top bar always holds what is about the person and the place: the mark, **Help** (which opens the guides), the account name and **Sign out**. The bar is sticky, so **Sign out** is always at the top right and never scrolls away, and on a phone the account name and Help give way to make room (Help is in the panel behind **More**).

The menu hides and shows by sliding with `transform` and `opacity` only, is `inert` while hidden so the keyboard cannot reach what the eye cannot see, and does not move when motion is reduced.

## Colour choice

`ThemeSwitch` is a group of three radio buttons (Auto, Light, Dark) in a pill. It is the one control for the colour theme, and the choice is kept under the `theme` key in local storage, so the app, the home page, the guides and the docs all answer to it. `public/theme.js` applies it before the first paint. Auto removes the `data-theme` attribute and the stylesheet follows the system again. The control sits at the foot of the sidebar, in the phone's More panel, at the end of the row under the top bar on a tablet, and in the home page's footer; the documentation sites have the same choice as one button in the top bar that steps through the three.

## Charts

A bar chart has a data table beside it, shown to a screen reader and available to everyone, and takes its colours from the same tokens. It measures its width before it draws, so it never flashes at the wrong size.

## Rules for using the pieces

1. **Compose; do not restyle.** A screen sets no colour, size or shadow of its own. If a piece does not fit, the piece is wrong: change it here.
2. **Layout is classes, not styles.** Gaps and flow come from `stack`, `row`, `between`, `grow` and `--gap`. A `style` attribute may only hand a value to the stylesheet (`style={{ '--gap': '8px' }}`).
3. **Words first.** A label, a button and a message are written for the person (see [Principles](/docs/design/principles/)).
4. **Attribution stays visible.** A list of entries shows who added each and when it was late.
5. **Both themes, every time.** Look at a new piece in light and dark before it is used.
