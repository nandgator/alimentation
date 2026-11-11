---
title: Privacy and who can read what
description:
  What is stored, what is encrypted, who can read it, and what happens to it when you leave.
---

# Privacy and who can read what

## Each kitchen is its own database

A kitchen's records live in a database of their own, not in a table shared with other kitchens.
Nobody else's data sits beside yours, and when you leave, the whole database goes.

## What is encrypted, and what is not

Personal details are encrypted **before** they are stored, with a key that belongs to your kitchen
alone:

- people's **names** and **contact** details;
- the **notes** on entries, the **reference** on a claim, and the **reason** on a dispute or a
  reversal;
- the **note** on a settlement.

The database holds only ciphertext for these. They do not appear in the database's own logs. The
audit trail copies them as they are stored, so it shows "(encrypted)" where a name or note would be.

**Everything else is stored as plain text in your kitchen's database**: who ate on which day (by an
id, not a name), the amounts, the payments and who made them, the prices, the rules, the holidays,
the dates, each person's role, and your kitchen's name. Only the fields listed above are encrypted.

One thing about a person is **not** encrypted: the optional **key**, your own code for them (a room
or staff number) that a file import is matched on. It has to be compared, which ciphertext cannot
be, so it is kept as plain text, limited to letters, digits and a few marks so that a name, an email
address or a phone number does not fit. Choose codes that mean nothing outside your kitchen. Only
the admin is shown it.

## Who can read what, inside the app

| What                                   | Member                                            | Supplier                    | Admin                   |
| -------------------------------------- | ------------------------------------------------- | --------------------------- | ----------------------- |
| People                                 | Only themselves                                   | The members, and themselves | Everyone                |
| Entries and their notes                | Their own, and the kitchen's off days             | All members'                | All                     |
| Claims, decisions, settlements, closes | Their own                                         | All                         | All                     |
| Prices, rules and holidays             | All                                               | All                         | All                     |
| **History** (plain words)              | Their own records, and what everyone is billed by | What they can read          | Reads the audit instead |
| **Audit** (the raw record)             | No                                                | No                          | All                     |
| Contact details                        | Never                                             | Never                       | Yes                     |
| A person's key (your own code)         | Never                                             | Never                       | Yes                     |

These limits are enforced **in the database**, per row, not only on the screen. A member's request
for another member's rows returns nothing.

## What the history shows

**History** is written for the person reading it. A member sees _"The admin removed your Leave
entry"_ and never another member's name. Notes and reasons are not copied into it.

## Whoever runs the service

Through the app, whoever runs the service sees only **metadata** about your kitchen: its address,
its state, where its database is, when it was made, how many requests it made today, its limits, and
the events of its life (made, moved, wiped), which carry no names. They are not a member of your
kitchen, so the app does not open it to them. They also see the sign-in email of anyone who asks
them for a place.

That is what the app shows. It is **not** the limit of what they can reach. The people who run the
service hold the keys that unlock every kitchen's encrypted fields, and the addresses and passwords
of every kitchen's database, and the ledger is plain text in those databases. Someone with that
access to the servers can read everything a kitchen holds, names and notes included. Encryption
keeps your people's details out of logs, backups and a host's recovery copies, and makes deleting a
kitchen immediate; it does not stand between your kitchen and the people who run the service.

If that matters to you:

- **Choose who runs it.** A kitchen on a service run by its own organisation is in that
  organisation's hands.
- **Move to a database of your own.** The data then sits on a server you control and you can cut the
  service off by changing its password. While the service keeps serving your kitchen, though, it
  still holds that password and the keys, so this gives you custody, not secrecy from it.
- **Move to an Alimentation of your own.** The kitchen is re-encrypted under keys made there and the
  old keys are destroyed. You then run it, and are the one who can read it.

See [Copying, moving and deleting](/guides/fair/your-data/) and, for the exact list of what an
operator sees and can reach, [the trust model](/docs/concepts/trust-model/).

## Logs

The server's logs carry no names, emails or notes. A test fails the build if personal data reaches
the database's log.

## Leaving

When you delete a kitchen, **the keys are destroyed first**. From that moment the names, contacts
and notes in it cannot be read by anyone, including whoever runs the service. Then the database is
removed, with the amounts and dates, then every record of who was in it. You get a **receipt** that
names no one. See [Moving and deleting](/guides/fair/your-data/).
