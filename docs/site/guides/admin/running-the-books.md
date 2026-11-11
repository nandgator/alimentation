---
title: Running the books as the admin
description: People, prices, holidays, rules, settlements and closing, and what each screen is for.
---

# Running the books as the admin

You set the kitchen up and keep it straight. Everything you do is recorded with your role and the
time, and the people it affects can see it.

## People

**People** lists everyone in the kitchen. The name in each row opens the person. There you change
their name, contact and dates, and **disable** them or **enable** them again.

- **Invite** on a member's row makes a one-use link for seven days, tied to the email you type.
- **Disabling** someone keeps their history and stops new entries. It is not deleting.
- **Eating from** and **Until** are the dates a member is billed between.
- **Contact** is yours alone, and is stored encrypted.
- **Key** is your own code for a person, such as a room or staff number. It is optional, it must be
  unique in the kitchen, and once it is set it cannot be changed. Use a code you already have, not a
  name, an email address or a phone number: letters, digits and `. _ : / # -` only. Unlike a name or
  a contact, a key is not encrypted (it has to be compared), and only you are shown it.

### Bringing many people in from a file

**Import** on the People screen takes a file (or text pasted in) with one person to a row. The first
line names the columns: `externalKey`, `name`, `role`, `contact`, `activeFrom`, `activeTo`. Only
`name` and `role` are needed, and `role` is member, supplier or admin. **Download a template** gives
you a file to start from.

```text
externalKey,name,role,contact,activeFrom,activeTo
A-101,Example Member,member,,2026-04-01,
S-1,Example Supplier,supplier,,,
```

A row **with a key** finds the person who has it: if there is one, they are changed; if not, they
are added. A row **without a key** always adds a new person, so bring a file without keys twice and
you have everyone twice. Anyone who is not in the file is left exactly as they are: an import never
removes or disables anybody, and never changes a role (that row is refused).

Choose what happens when the person is already there:

- **Merge** sets what the file gives, and a blank cell leaves what is there as it is.
- **Overwrite** sets everything the file gives, so a blank contact or date clears it. A column the
  file does not have at all is left alone by both.

**Preview** shows each row before anything is written: added, changed (with what changes), already
as in the file, or refused with the reason. **Confirm** is possible only when no row is refused: an
import is all or nothing, so one bad row means nothing is written. A file that would add more people
than the free tier leaves room for is refused whole, saying how much room there is. The most is
1,000 rows or 1 MB. Bringing the same file again changes nothing.

The audit trail gets one line for the import (how many added and changed, the mode, and a
fingerprint of the file, never the file), beside the usual line for each person.

**Export CSV** writes the same columns, keys included, so you can correct a list in a spreadsheet
and import it back. People you have not given a key will be added again if you import their rows,
which the preview shows.

## Rates and rules

- **Rate cards** carry the prices and the weekly menu from a date. They are **added, never edited**:
  a new card applies from its date, and earlier months keep their prices.
- **Rules for this kitchen** are the options in [the rules reference](/guides/admin/kitchen-rules/).
  A change applies from the first of a month. It can start in the current month or later, never in a
  month that has passed.

## Holidays

A holiday is **confirmed** (the meal is cancelled) or **tentative** (kept on the list, not counted).
Changing one changes the bills for that day in any month that is not closed.

**Several days at once.** Fill in the optional **End date** when you add a holiday and one holiday
is added for each day from the date to the end date, weekends too (up to 366 days). Each can be
confirmed or made tentative, or removed, on its own afterwards.

**Importing a list.** **Import** on the Holidays screen takes text pasted in, or a file, with one
holiday to a line and the first line naming the columns: `name`, `from`, `to`, `location` and
`confirmed` (`date` works in place of `from`; leave `to` empty for one day and `confirmed` empty for
yes). For example:

```text
name,from,to,location,confirmed
Founders' day,2026-10-02,,,yes
Diwali break,2026-11-08,2026-11-11,,no
```

Choose what happens when a day already has a holiday. **Keep what is there** adds the new ones and
skips a holiday that is already listed (the same day, name and place). **Replace** swaps what is on
the days in your list for your list, and leaves every other day as it is. **Preview** shows what
will happen to each row before anything is written. Rows that cannot be added, such as one in a
month that is closed to changes, are marked with the reason, and by default nothing is added until
they are dealt with; tick the box to add the rest instead. An import can be up to 1,000 days, ranges
counted. Every holiday added or removed is in the audit trail.

## Logging for someone else

The admin can add an entry for a member, for example when they phone to say they are away. It is
stored with your name as the author, and the member sees it in their **History** as _"The admin
logged Leave on 14-Oct-2026 for you."_ If it is after the day, it is marked late.

## Settlements

**Settlements** are your own entries on a member's bill: **Payment** (money taken outside the app),
**Query** and **Query Resolved**. They are **added and never changed**. The member and the supplier
can both see them.

> [!TIP] Record a payment **once**. Either the member claims it and the supplier confirms it, or you
> record a settlement. If both happen, the bill counts two payments; the way to put that right is to
> reverse the confirmed claim, with a reason.

## Reversing a decision

When the supplier confirmed or disputed a claim by mistake, open **Payments**, find the claim, and
use **Reverse**. You give a reason. The original decision stays on record, the claim no longer
counts, and the member sees the reversal and the reason. The member files a new claim.

## Closing the month

**Month close** freezes what each person is billed for a month that has ended. It shows, beside each
name, what is **still waiting**: money claimed but not yet decided, and open queries. Closing does
not stop those: payments carry on. Read [Month end and catching up](/guides/admin/month-end/) before
your first close.

## Audit

**Audit** is the raw record of every change in the kitchen, written by the database: what, who and
when. Names and notes appear as "(encrypted)". Members and the supplier have their own
plain-language **History**.

## Your data

**Your data** shows the free-tier meter and lets you take a copy, move the kitchen, or delete it.
See [Moving and deleting](/guides/fair/your-data/).
