---
title: What you serve: items, services, the menu and prices
description:
  How a kitchen says what it cooks and when, with the Catalogue, services, the menu and the prices,
  and what renaming or retiring does to a bill.
---

# What you serve: items, services, the menu and prices

Nothing in Alimentation assumes what you cook. You tell it, once, and every screen, bill and log
form then uses your own words. This page is for the admin.

## Items: meals and add-ons

Open **Catalogue** and choose **Add an item**. An item is one of two kinds:

- a **meal** is what a service serves on a day: a plate of something;
- an **add-on** is something a member asks for on top of the meal, in a number: a piece, a cup.

| Field                 | What to put                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| **Kind**              | _Meal_ or _Add-on_.                                                    |
| **Name**              | What your people call it.                                              |
| **Counted in**        | The unit: plate, piece, cup.                                           |
| **Most in one entry** | For an add-on, the largest number a member may log at once (up to 99). |

The kind, the unit and the largest number **cannot be changed** after the item is made. The name
can. If the food is different, make a new item: _"new food means a new item"_.

> [!TIP] **Rename** fixes a typo or a better name. Old bills and the History show the current name,
> and the amounts do not change, because they follow the item, not its name. **Retire** takes an
> item out of the pickers from today. It cannot be undone, and its name stays taken. Nothing is ever
> deleted, so a bill from last year can still say what it was for.

You cannot retire an item while a menu in force from today on still offers it. Make a new menu
without it first.

## Services

A **service** is a time of day you serve: Lunch, or Breakfast, Lunch and Dinner. A kitchen needs
one. Open **Catalogue** and use **Add a service**; you can rename or retire a service like an item.

A kitchen with one service shows no service controls anywhere: not in the menu, not in the log, not
on People. They appear when you add a second service.

**Who takes which service.** On **People**, a member has a checklist of services, each with a date
it starts. A new member takes every service. A member who only takes lunch is not asked to log leave
for dinner on every day. If you change it later, the change applies from the date you give, and a
month that is closed cannot be touched.

## The menu

Open **Menu** and choose **New menu**. It is a grid with a row for each weekday and a column for
each service. Choose a meal, or **Not served**, in each cell. Every working day must be served by at
least one service. Under it, tick **Also offered** (or **Offered in** each service when there are
several): the other meals a member may switch to, and the add-ons they may ask for.

A menu applies **from a date** and is never edited: add a new one when it changes. Past months keep
the menu they had.

## Prices

Only a kitchen that tracks money has **Prices**. Choose **New prices**. The form lists every item
your menus offer, with a field for each price, and a **Monthly fee** at the bottom.

- If one item costs more in one service (a dinner plate dearer than a lunch plate), open **Different
  price in a service** on its line and give that service its own price.
- The monthly fee is one amount for the kitchen. It is charged once a month to a member who ate on
  at least the number of **days** your rules say (the first day, by default). A member who eats two
  services on one day has eaten on one day.
- Every offered item needs a price before the kitchen can bill. The dashboard says which are
  missing: **Price 3 items to start billing: ...**.

Prices apply from a date and are never edited, like the menu.

## Moving from a kitchen without money

A kitchen that only counts meals has its items, services and menu already. When it is moved into a
kitchen that tracks money, they arrive as they were, and the dashboard asks you to price exactly
those items. See [A kitchen without money](/guides/admin/a-kitchen-without-money/).
