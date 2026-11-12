---
title: Glossary
description: The words Alimentation uses, in one place.
---

# Glossary

**Actual.** A day that has already happened, and a bill counting only such days. The opposite of
_projected_.

**Add-on.** An item a member asks for on top of the meal, in a number (a piece, a cup). It is logged
as an _Extra_. The kitchen names its add-ons.

**Admin.** The role that runs the books: people, prices, rules, holidays, settlements and closing.

**Audit.** The raw record of every change in a kitchen, written by the database. Only the admin
reads it. Everyone else has their own **History**.

**Balance.** The bill less what has been paid.

**Billed.** The amount a month was frozen at when it was closed. Before the close, it is the live
total.

**Catalogue.** What a kitchen serves: its meals and add-ons, each with a name and a unit. Items can
be renamed and retired, never deleted.

**Changed after close.** A flag on a closed month when a meal has changed since the close. It shows
the difference and never alters the bill.

**Claim.** A member's statement that they paid, with an amount, a month and a method. It is
_pending_ until the supplier decides.

**Close.** Freezing what each person is billed for a month that has ended. Meals and leave freeze;
payments do not.

**Decision.** The supplier's answer to a claim: _confirmed_ or _disputed_. One per claim, final, and
reversible only by the admin.

**Default meal.** The meal the menu serves on a working day. Everyone gets it unless they log an
exception.

**Dispute.** A decision that a claim is not right. It needs a reason, and opens a _query_.

**Entry.** One thing someone wrote down: an exception, a claim, a decision or a settlement. It is
what the free tier counts. The default meals are not entries.

**Exception.** A change to a day's default meal: _Leave_, a _Switch_ or an _Extra_. The kitchen
being off is the supplier's exception, _Supplier Off_.

**Item.** A meal or an add-on in the catalogue.

**Kitchen without money.** A kitchen made to count meals only, with no prices, bills or payments.
Chosen when the kitchen is made, and never changed.

**Late.** An entry added after its day. It is allowed, and marked, with the number of days.

**Member.** Someone who eats at the kitchen and is billed for it.

**Menu.** Which meal each service serves on each working day, and which other items it offers, from
a date. Added, never edited. Every kitchen has one.

**Monthly fee.** A flat amount charged once a month to a member who ate on enough days. One amount
for the kitchen.

**Projected.** A day still to come, and a bill that counts it at the menu's meal. Shown in italics.

**Query.** An open question about a bill, raised by a dispute or by the admin, and closed by a
_Query Resolved_ settlement.

**Rate card.** The price of each item and the monthly fee, from a date. Added, never edited. Only a
kitchen that tracks money has them.

**Reversal.** The admin's undoing of a decision, with a reason. The decision stays on record.

**Service.** A time of day the kitchen serves (Lunch, Dinner). A member takes some or all of them.

**Settlement.** An entry the admin makes on a member's bill: a _Payment_, a _Query_, or a _Query
Resolved_.

**Supplier.** The role that cooks and decides claims.

**Working day.** A day the kitchen serves a meal, Monday to Friday by default.
