---
title: Importing people
description:
  How a file of people is matched on the kitchen's own code, what merge and overwrite do, what is
  refused, what is written to the audit trail, and the routes and files that do it.
---

# Importing people

A kitchen that already keeps a list somewhere else (a room number, a staff number, a member number)
can bring it in with one file, and bring a corrected file again later without adding everyone twice.
The code that makes this possible is the person's **key** (`externalKey`): a short code the kitchen
chose, unique within the kitchen, set once and never changed.

The route is `POST /api/w/{slug}/people/import`. It is the admin's alone, it is not open to an
agent's key (and so there is no MCP tool for it), and it is counted and rate-limited like any other
request of the kitchen. The [reference](/docs/api/reference/) lists it with its schema.

## What goes in

JSON, with the mode and `dryRun` in the body:

```console
$ curl -s -X POST https://kitchen.example.org/api/w/<kitchen>/people/import \
    -H 'content-type: application/json' -H "cookie: $SESSION" \
    -d '{"mode":"merge","dryRun":true,"rows":[
          {"externalKey":"A-101","name":"Example Member","role":"consumer","activeFrom":"2026-04-01"}]}'
```

or a `text/csv` body, with `mode` and `dryRun` in the query because a file has nowhere to say them:

```console
$ curl -s -X POST 'https://kitchen.example.org/api/w/<kitchen>/people/import?mode=merge&dryRun=true' \
    -H 'content-type: text/csv' -H "cookie: $SESSION" --data-binary @people.csv
```

The CSV's first line names the columns, in any order: `externalKey`, `name`, `role`, `contact`,
`activeFrom` and `activeTo`. `name` and `role` are needed. `role` is `consumer` (or `member`),
`supplier` or `admin`. Commas, semicolons and tabs all separate cells, quotes are honoured, and a
byte-order mark is skipped. A row that is not what it should be is reported with its line.

At most **1,000 rows** and **1 MB** are read; a larger body is refused (413) as soon as it grows
past the limit, and more than 1,000 rows is a 422.

## How a row is matched

| The row has                        | And                   | Then                                                     |
| ---------------------------------- | --------------------- | -------------------------------------------------------- |
| a key                              | nobody has that key   | the person is **added** with it                          |
| a key                              | somebody has that key | that person is **changed** (or left as they are)         |
| no key                             |                       | the person is **always added**; the same file adds again |
| a key that another row also has    |                       | **error**: a key may be given once in a file             |
| a key that belongs to another role |                       | **error**: an import never changes a role                |

Keys are compared exactly, after trimming. People who are not in the file are **never** removed or
disabled, whatever the mode.

A key is letters, digits and `. _ : / # -`, starting with a letter or a digit, at most 64
characters. That keeps a name, an email address or a phone number from being used as one (see the
note on storage below).

## Merge and overwrite

| For a person who is already there                                | `merge`          | `overwrite`      |
| ---------------------------------------------------------------- | ---------------- | ---------------- |
| `name`                                                           | set to the row's | set to the row's |
| `contact`, `activeFrom`, `activeTo` given with a value           | set to it        | set to it        |
| given **blank** (an empty cell, `""` or `null`)                  | left as it is    | **cleared**      |
| not given (the column is not in the file, the field is left out) | left as it is    | left as it is    |
| `status`                                                         | never touched    | never touched    |

Whatever the mode, each row is checked with the checks that adding or changing one person by hand
goes through (`checkPersonFields` in `packages/core/src/people-import.ts`), applied to the
**result**: a name of up to 120 characters, a contact of up to 200, real dates, dates for members
only, and an end date that is not before the start. A row that would leave a person with an end date
and no start date is an error.

## What comes back

```json
{
  "mode": "merge",
  "dryRun": true,
  "committed": false,
  "fileHash": "9f2c…",
  "rows": [
    {
      "row": 1,
      "action": "update",
      "externalKey": "A-101",
      "name": "Example Member",
      "id": "0191…",
      "diff": [{ "field": "contact", "from": null, "to": "member@example.org" }],
      "message": "Will change contact."
    }
  ],
  "summary": { "create": 0, "update": 1, "unchanged": 0, "error": 0 }
}
```

`action` is `create`, `update`, `unchanged` or `error`. `diff` lists each field that changes (for an
addition, what the new person gets). `id` is null for an addition until it is committed. A dry run
does exactly the planning a real run does and writes nothing, so what it reports is what a real run
of the same file would do.

## All or nothing

The whole file is one transaction. If **any** row is an error, nothing is written and `committed` is
`false` (a 200: the rows say which and why). If the file would add more people than the kitchen's
limit leaves room for, the answer is `409 quota_exceeded` with a sentence that says how many it
would add and how much room there is, counted before anything is written, for a dry run too. If the
database fails part-way through, every row so far is taken back.

Running the same file again, in either mode, changes nothing: every row is `unchanged` and nothing
is written, including the audit line below.

## What is recorded

Each person added or changed has the usual rows in the audit trail (`person`, written by the
trigger). A committed import that changed anything adds **one more**, `person_import`, written by
the database function `record_person_import` (the application role cannot write the table itself):

```json
{
  "mode": "merge",
  "source": "csv",
  "rows": 12,
  "create": 3,
  "update": 2,
  "unchanged": 7,
  "fileHash": "9f2c…"
}
```

`fileHash` is the SHA-256 of the text (or of the rows as JSON) that was sent. The file itself is
kept nowhere. Only the admin can read this row, and it appears in the admin's **History** as a
sentence with the counts.

## The key in the database

Migration `0004_people_have_an_external_key.sql` adds `person.external_key`:

- **Plain text, on purpose.** Ciphertext cannot be compared, and the key must be unique. It is a
  code the kitchen chose, not a name, email or number to call, and a `CHECK` holds it to the form
  above. It appears in the audit trail and in a copy of the kitchen as it is. This is the one
  personal-detail column that is not encrypted, and `workspace.guards.test.ts` lists it as reviewed.
- **Unique per kitchen**: a partial unique index over the rows that have one. Several people may
  have none. One database is one kitchen, so two kitchens may use the same key for different people.
- **Set once**: a trigger refuses to change or clear a key that is set (`409 immutable`). A person
  who has none may be given one, once, by `PATCH /people/{id}` or by the person's form.
- **Frozen with the rest**: the table's read-only trigger refuses every write while the kitchen is
  being moved, and the bundle carries the key (`people[].externalKey`, optional so that older
  bundles still import).

## Taking the people out as a file

**Export CSV** on the People screen writes the same columns, with the keys, so the file can be
edited and put back. Any cell a spreadsheet would run as a formula (one that begins `=`, `+`, `-`,
`@`, a tab or a carriage return) is written with an apostrophe in front, and the apostrophe is taken
off again on the way in, so what goes out comes back as it was. A person with no key is exported
with an empty key cell, and importing that row adds them again: give people keys before you rely on
the round trip. The parsing and writing are the pure functions `parsePeopleCsv` and `peopleToCsv`,
built on the same reader as the holidays import.
