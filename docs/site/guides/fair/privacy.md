---
title: Privacy and who can read what
description: What is stored, what is encrypted, who can read it, and what happens to it when you leave.
---

# Privacy and who can read what

## Each kitchen is its own database

A kitchen's records live in a database of their own, not in a table shared with other kitchens. Nobody else's data sits beside yours, and when you leave, the whole database goes.

## What is encrypted

Personal details are encrypted **before** they are stored, with a key that belongs to your kitchen alone:

- people's **names** and **contact** details;
- the **notes** on entries, the **reference** on a claim, and the **reason** on a dispute or a reversal;
- the **note** on a settlement.

The database holds only ciphertext for these. They do not appear in the database's own logs. The audit trail copies them as they are stored, so it shows "(encrypted)" where a name or note would be.

## Who can read what

| What                                   | Member                                            | Supplier                    | Admin                   |
| -------------------------------------- | ------------------------------------------------- | --------------------------- | ----------------------- |
| People                                 | Only themselves                                   | The members, and themselves | Everyone                |
| Entries and their notes                | Their own, and the kitchen's off days             | All members'                | All                     |
| Claims, decisions, settlements, closes | Their own                                         | All                         | All                     |
| Prices, rules and holidays             | All                                               | All                         | All                     |
| **History** (plain words)              | Their own records, and what everyone is billed by | What they can read          | Reads the audit instead |
| **Audit** (the raw record)             | No                                                | No                          | All                     |
| Contact details                        | Never                                             | Never                       | Yes                     |

These limits are enforced **in the database**, per row, not only on the screen. A member's request for another member's rows returns nothing.

## What the history shows

**History** is written for the person reading it. A member sees _"The admin removed your Leave entry"_ and never another member's name. Notes and reasons are not copied into it.

## Logs

The server's logs carry no names, emails or notes. A test fails the build if personal data reaches the database's log.

## Leaving

When you delete a kitchen, **the keys are destroyed first**. From that moment nothing in it can be read by anyone, including whoever runs the service. Then the database is removed, then every record of who was in it. You get a **receipt** that names no one. See [Moving and deleting](/guides/fair/your-data/).
