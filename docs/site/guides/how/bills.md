---
title: How a bill is worked out
description: Rate cards, working days, holidays, exceptions and extras, with a month worked through to the rupee.
---

# How a bill is worked out

A bill is never typed in. It is **computed** from a few things you set once and the exceptions people log. The same calculation runs on the server, in the browser (for the projection you see while the month is open) and when a kitchen moves, so they always agree.

## The ingredients

**A rate card** has the price of a veg meal and a non-veg meal, of an extra chapati and an extra bhakri, a flat monthly amount for extras, and a menu: which meal is served on each working day. A card applies **from a date**. A day uses the latest card that started on or before it.

**Working days** are Monday to Friday unless the kitchen's rules say otherwise. A day that is not a working day has no meal and no bill.

**Holidays** cancel the meal. By default only **confirmed** holidays count; a **tentative** one is kept on the list and does nothing until confirmed.

**People are billed between dates.** A member is billed from the day they start eating, and until the day they stop, if there is one.

## The default meal

Every working day, every member who is active gets the meal the menu says for that weekday, at that day's price. **Nobody logs a plain lunch.** The only entries are the exceptions.

## Exceptions

| Entry                                 | Effect on that day                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| **Leave**                             | No meal. Costs nothing, or a fixed share of the meal if your kitchen says so. |
| **Switch to Veg / Switch to Non Veg** | The meal and its price change for that day.                                   |
| **Extra Chapati / Extra Bhakri** ×n   | Adds n × the price per piece. n is 1 to 20.                                   |
| **Supplier Off**                      | No meal for **anyone** that day.                                              |

A day's total is the price of its meal plus its extras, or nothing on a leave day, a holiday, a supplier-off day, or a day the person is not billed.

## The monthly extras

The flat **extras** amount (papad, salad, and so on) is charged **once a month**, if the member had at least one meal that month. Your kitchen can raise that to "from the Nth meal".

## Projected and actual

Each day is **Actual** if it has already happened, and **Projected** if it is still to come. A month's bill is a projection until the month ends. You see projections in _italics_. **Actual to date** is the bill counting only the days that have happened.

## A month, worked through

Take a kitchen with these prices: veg ₹120, non-veg ₹150, an extra chapati ₹10, extras ₹30 a month. The menu is veg on Monday, Tuesday and Thursday, and non-veg on Wednesday and Friday. March 2027 has 23 working days: 14 veg days and 9 non-veg days.

| Line                                | Working              |     Amount |
| ----------------------------------- | -------------------- | ---------: |
| Veg meals                           | 14 × ₹120            |     ₹1,680 |
| Non-veg meals                       | 9 × ₹150             |     ₹1,350 |
| Monthly extras                      | once                 |        ₹30 |
| **If nobody logs anything**         |                      | **₹3,060** |
| A leave on a Friday (a non-veg day) | less ₹150            |      −₹150 |
| A Tuesday switched to non-veg       | ₹150 instead of ₹120 |       +₹30 |
| Two extra chapatis on one day       | 2 × ₹10              |       +₹20 |
| **The member's bill**               |                      | **₹2,960** |

The home page lets you try exactly this, on today's calendar.

## The status of a bill

Each month's bill carries one status, the first that applies:

1. **Changed after close**: the month was closed and a meal has changed since.
2. **Query open**: a payment was disputed and not yet settled.
3. **Settled**: paid in full.
4. **Awaiting confirmation**: a claim is waiting for the supplier.
5. **Part paid**: some has been paid.
6. **Due**: the month has ended and nothing is paid.
7. **Projected**: the month has not ended.

## The clock

"Today" is the kitchen's own date, in the kitchen's own time zone, not the viewer's. A kitchen in Mumbai changes day at midnight in Mumbai.
