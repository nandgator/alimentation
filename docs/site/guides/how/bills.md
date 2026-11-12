---
title: How a bill is worked out
description:
  The catalogue, services, menu, rate cards, working days, holidays, exceptions and the monthly fee,
  with a month worked through to the rupee.
---

# How a bill is worked out

A bill is never typed in. It is **computed** from a few things you set once and the exceptions
people log. The same calculation runs on the server, in the browser (for the projection you see
while the month is open) and when a kitchen moves, so they always agree.

## The ingredients

**The catalogue** is what the kitchen serves: meals, and add-ons that people ask for on top of a
meal. **A service** is a time of day it serves (Lunch, Dinner); a kitchen has one or more. **A
menu** says which meal each service serves on each working day. **A rate card** has the price of
each item (sometimes a different price in one service) and a flat monthly fee. The menu and the rate
card each apply **from a date**. A day uses the latest of each that started on or before it. A
kitchen needs both before it can bill. (A kitchen without money has a menu and no rate card; see
[A kitchen without money](/guides/admin/a-kitchen-without-money/).)

**Working days** are Monday to Friday unless the kitchen's rules say otherwise. A day that is not a
working day has no meal and no bill.

**Holidays** cancel the meal. By default only **confirmed** holidays count; a **tentative** one is
kept on the list and does nothing until confirmed.

**People are billed between dates.** A member is billed from the day they start eating, and until
the day they stop, if there is one. They are billed for a service only on the days they take it; a
new member takes every service.

## The default meal

Every working day, every member who is active gets, in each service they take, the meal the menu
says for that weekday, at that day's price. **Nobody logs a plain lunch.** The only entries are the
exceptions.

## Exceptions

| Entry            | Effect on that day                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Leave**        | No meal. Costs nothing, or a fixed share of the meal if your kitchen says so. For the whole day, or for one service. |
| **Switch**       | The meal in one service changes to another it offers, and so does its price, for that day.                           |
| **Extra** ×n     | Adds n × the add-on's price, in one service. n is 1 up to the most the kitchen allows.                               |
| **Supplier Off** | No meal for **anyone** that day, or in one service.                                                                  |

A service's total for a day is the price of its meal plus its extras, or nothing on a leave day, a
holiday, a supplier-off day, or a day the person is not billed. A day with two services is two
amounts that add up, and a switch or an extra in one never touches the other.

## The monthly fee

The flat **monthly fee** (for the things that are not counted one by one) is charged **once a
month**, if the member ate on at least one **day** that month. Your kitchen can raise that to "from
the Nth day". It counts days, not plates, so eating two services on one day counts once.

## Projected and actual

Each day is **Actual** if it has already happened, and **Projected** if it is still to come. A
month's bill is a projection until the month ends. You see projections in _italics_. **Actual to
date** is the bill counting only the days that have happened.

## A month, worked through

Take an example kitchen with one service. It serves a veg meal at ₹120 and a non-veg meal at ₹150,
and an add-on, chapati, at ₹10 a piece, and charges ₹30 a month. The menu is veg on Monday, Tuesday
and Thursday, and non-veg on Wednesday and Friday. March 2027 has 23 working days: 14 veg days and 9
non-veg days.

| Line                                | Working              |     Amount |
| ----------------------------------- | -------------------- | ---------: |
| Veg meals                           | 14 × ₹120            |     ₹1,680 |
| Non-veg meals                       | 9 × ₹150             |     ₹1,350 |
| Monthly fee                         | once                 |        ₹30 |
| **If nobody logs anything**         |                      | **₹3,060** |
| A leave on a Friday (a non-veg day) | less ₹150            |      −₹150 |
| A Tuesday switched to non-veg       | ₹150 instead of ₹120 |       +₹30 |
| Two extra chapatis on one day       | 2 × ₹10              |       +₹20 |
| **The member's bill**               |                      | **₹2,960** |

The home page lets you try exactly this, on today's calendar.

## What a bill lists

A bill lists each item by its own name and how many: _Veg × 14_, _Chapati × 2_, then the monthly
fee. You can check it against your own count. Renaming an item later changes the word on old bills
and never their amounts.

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

"Today" is the kitchen's own date, in the kitchen's own time zone, not the viewer's. A kitchen in
Mumbai changes day at midnight in Mumbai.
