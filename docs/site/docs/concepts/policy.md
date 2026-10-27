---
title: The rules document
description: The typed, versioned, effective-dated document that holds a kitchen's rules, with every field, its default and how a version takes effect.
---

# The rules document

A kitchen's rules are a _policy_: a JSON document, validated by a schema, **appended and never edited**, like a rate card. A new version takes effect from the first of a month, and a month is evaluated under the version in force on its first day. The schema is `.strict()` throughout, so a rule this build does not know is refused, never silently dropped.

## Shape

```json
{
  "version": 1,
  "workingDays": [1, 2, 3, 4, 5],
  "holidays": { "count": "confirmed" },
  "extras": { "minMeals": 1 },
  "leave": { "chargeBps": 0 },
  "monthClose": { "mode": "manual", "afterClose": "flag" },
  "exceptionCutoff": null,
  "payments": "claim_confirm",
  "rateCards": { "backdating": "current_month" }
}
```

That is `DEFAULT_POLICY`, and what a kitchen runs on until it adds a version.

## Fields

| Field                   | Values                                                                                                                               | Default             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `workingDays`           | Distinct integers 0 to 6 (0 is Sunday), at least one. Each needs a menu entry on the rate card.                                      | `[1,2,3,4,5]`       |
| `holidays.count`        | `confirmed` (only confirmed holidays cancel a meal) or `all`.                                                                        | `confirmed`         |
| `extras`                | `{ "minMeals": 1–31 }` or `null` for no monthly extras. The amount comes from the rate card.                                         | `{ "minMeals": 1 }` |
| `leave.chargeBps`       | 0 to 10000: the share of the day's meal charged on a leave day, in basis points.                                                     | `0`                 |
| `monthClose`            | `{ "mode": "off" }`; `{ "mode": "manual", "afterClose": … }`; or `{ "mode": "auto", "afterDays": 0–60, "afterClose": … }`.           | `manual`, `flag`    |
| `monthClose.afterClose` | `flag` (the change is allowed and shown as _changed after close_) or `block` (it is refused until the month is reopened).            | `flag`              |
| `exceptionCutoff`       | `{ "daysBefore": 0–7, "time": "HH:MM" }` or `null`. A member's exception must be made before this.                                   | `null`              |
| `payments`              | `claim_confirm` (a member claims, the supplier decides) or `direct` (members cannot claim).                                          | `claim_confirm`     |
| `rateCards.backdating`  | `none` (a card may start today or later), `current_month` (from the start of this month, never into a closed month), `unrestricted`. | `current_month`     |

## Taking effect

- `addPolicy` accepts a version only if `effectiveFrom` is the first of a month and is not in a month before the current one. A version for the current month is allowed.
- `policyForMonth(versions, month)` returns the version in force on the month's first day, or `DEFAULT_POLICY` if there is none.
- With `monthClose.mode = 'auto'`, a month is open through `monthEnd + afterDays` and counts as closed from the day after (`autoCloseDate`). The server writes the close, at the amounts the month had, the first time the kitchen is opened after that date.
- The database reads the same document: `policy_on(date)` and the helper functions behind the log-entry triggers (working days, whether a month is closed, whether a close blocks the admin) read `policy_version` directly, so a rule holds even when a caller skips the application's checks.

## In the app

**Rates & rules** shows the rules in force as a sentence each, and **Change rules** adds a version. The reference for the people who set them is in the guides: [the rules of a kitchen](/guides/admin/kitchen-rules/).

## When a kitchen moves

A move carries the policy versions across. If the destination's release cannot represent a rule (it fails `PolicySchema`), `unsupportedRules` lists it and the move is refused. Rules are never approximated.
