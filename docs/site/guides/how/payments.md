---
title: Payments and disputes
description: How a payment is claimed, confirmed, disputed, settled and reversed, and why a decision cannot be quietly changed.
---

# Payments and disputes

Alimentation never moves money. People pay each other themselves. What it keeps is the **agreement** that a payment happened, and it takes two people to make one.

## Claim, then confirm

1. **The member claims.** They say how much they paid, for which month, how, and when. The claim is **Pending**.
2. **The supplier decides, once.** They **confirm** it, or **dispute** it with a reason.
3. **Confirmed** counts as paid and lowers the balance. **Disputed** opens a query on that bill.

A part payment is a separate claim. A member can withdraw a claim only while it is pending.

## Why a decision is final

The first decision on a claim is final: there is one decision per claim, and neither the supplier nor anyone else can edit or delete it. This is a database rule, not a courtesy of the screen.

Only the **admin** can undo a decision, by **reversing** it with a reason. The original decision stays on record. The claim stops counting. The member sees the reversal and the reason, and files a new claim if the payment was real.

## Queries and settlements

When the supplier **disputes** a claim, that bill shows **Query open**. The admin resolves it by recording a **settlement**.

A settlement is an entry on a member's bill made by the admin. There are three kinds:

| Type               | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| **Payment**        | Money the admin knows was taken outside the app. It counts as paid. |
| **Query**          | A question about the bill, raised by the admin.                     |
| **Query Resolved** | The answer. It closes a query.                                      |

Settlements are added, never changed.

## What counts as paid

**Paid** is the total of confirmed claims plus settlement payments, less any reversed. **Claimed** is only what is still waiting for a decision. A pending claim never counts as paid, and it never counts against the member either.

> [!TIP]
> One payment, one record. If a member claims a payment and the admin also records it as a settlement, the bill counts it twice. Pick one way for each payment.

## When payments are recorded directly

A kitchen can choose, in its rules, **Recorded directly**. Members then cannot claim, and the admin records each payment as a settlement. Choose this only where nobody wants a second pair of eyes on the money.

## After the month closes

Closing freezes meals and leave. **Payments are never frozen.** A claim can still be made, decided and settled after the month has closed, so nobody has to rush a supplier who is away.
