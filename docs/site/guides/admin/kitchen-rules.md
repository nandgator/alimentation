---
title: The rules of a kitchen
description: Every option a kitchen can set under Rates & rules, what it does, and its default.
---

# The rules of a kitchen

Each kitchen runs on a small set of rules. They are kept like prices: **added, never edited**. A new version applies from the first day of a month that has not yet gone by, and a month is billed under the version in force on its first day.

You change them in **Rates & rules**, under **Change rules**. The page shows the rules in force, in a sentence each.

| Rule                            | Options                                                                                        | Default                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| **Working days**                | Any days of the week. Each needs a menu entry on the rate card.                                | Monday to Friday                 |
| **Holidays that cancel a meal** | Only confirmed ones, or every one listed.                                                      | Only confirmed                   |
| **Charge on a leave day**       | 0 to 100 percent of the day's meal.                                                            | 0 percent                        |
| **Monthly extras apply from**   | A number of meals, or no monthly extras.                                                       | The first meal                   |
| **Payments**                    | _Member claims, supplier confirms_, or _Recorded directly_.                                    | Member claims, supplier confirms |
| **Month close**                 | _Never closed_, _Closed by the admin_, or _Closes by itself_ a number of days after month end. | Closed by the admin              |
| **Entries after close**         | _Allowed, and flagged_, or _Not allowed_.                                                      | Allowed, and flagged             |
| **Rate cards may start**        | _Only from today_, _From the start of this month_, or _Any date_.                              | From the start of this month     |
| **Exceptions due**              | None, or a number of days before the day, by a time of day.                                    | None                             |

## Notes on each

**Working days.** The menu on the rate card must serve every working day. The form refuses a rate card that leaves one out.

**Charge on a leave day.** Some kitchens charge a share of the meal for a leave day, because the food was already bought. At 0 percent, a leave costs nothing.

**Month close.** _Closes by itself_ gives everyone a fixed catch-up window. The close uses the amounts the month had at that moment. See [Month end and catching up](/guides/admin/month-end/).

**Entries after close.** With _Not allowed_, even the admin cannot change a closed month until it is reopened. With _Allowed, and flagged_, the admin can, and the change shows as **Changed after close**.

**Rate cards may start.** This limits how far back a new price can reach. It cannot reach into a month that has already been closed.

**Exceptions due.** A member cannot log an exception after the cut-off. The admin still can, and it is marked late. With no cut-off, a member can add anything at any time before the close, and a late one is marked as such.

> [!NOTE]
> A kitchen that is moved to another instance keeps every one of these rules exactly. If the other instance cannot represent a rule, the move is refused. Rules are never approximated.
