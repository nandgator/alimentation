---
title: AI agents and MCP
description:
  How a person gives an AI agent a key, what the key may and may not do, how what the agent does is
  recorded, and the MCP server it uses.
---

# AI agents and MCP

An agent is a way for a person to have software act for them. It is not a new kind of person: it
holds a **key** that a person made, it acts **as that person**, **in one role**, **in one kitchen**,
and what it does is **marked as an agent's** in the kitchen's own record, where the people it
affects can read it. The decisions behind this are in `docs/DESIGN.md` (section 5.13).

## Making a key

A person makes it in the app, under **Your data** in the kitchen (the admin's page), or through the
API while signed in:

```console
$ curl -s -X POST https://kitchen.example.org/api/w/<kitchen>/agents \
    -H 'content-type: application/json' -H "cookie: $SESSION" \
    -d '{"name":"Lunch bot","scopes":["log"],"days":90}'
```

The answer has the **token**, which starts `alk_`, and it is the only time it is shown: only a hash
is kept. The key is for the role the person is acting as when they make it (`X-Acting-As`), carries
`read` and the scopes asked for, and ends after `days` (90 unless asked, a year at most). A person
can have five at once in one kitchen.

| Scope    | What it lets the agent do                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `read`   | Everything the role can read: the kitchen, menus, statements, the day ledger, the log, claims, settlements and its own History. |
| `log`    | Add an entry (a leave, a switch, an extra, a day off) and withdraw one, under the rules that apply to the person.               |
| `claims` | Say that a payment was made, and withdraw such a claim.                                                                         |

`read` is always there. The three are the whole list: there is nothing wider to ask for.

In a kitchen that does not track money (`workspace.moneyEnabled` is false in the bootstrap) there is
nothing for `claims` to do, so a key cannot have it (`422 money_not_tracked`), and the routes about
money answer `404 money_not_tracked` whoever asks. The MCP server offers no tool, prompt or resource
that comes from them (below).

## What stays with a person

An agent cannot confirm, dispute or reverse a payment, record a settlement, close or reopen a month,
add, change or import people, invite anyone, change prices, rules or holidays, take a copy of the
kitchen, move it, delete it, share its totals with a head office, or make or end keys. A request for
any of these with a key is answered 403 and does nothing. The list is a single table, `AGENT_ACCESS`
in `apps/api/src/openapi.ts`; the API enforces it, the MCP server is made from it, and each route in
the [reference](/docs/api/reference/) says which side it is on. A test fails if a route is added
that is on neither.

A key does not widen what its person may do. The kitchen's rules and its database apply to the agent
exactly as they would to the person: an entry after the cut-off is refused, a closed month stays
closed, a member's key sees only that member's own books.

It also stops working, at once, when it is ended, when it expires, or when its person is no longer
in that role in that kitchen.

## How it is recorded

The database writes it. The request states which agent it came through (`app.via`, beside `app.role`
and `app.person_id`), and the audit trail records it with who it was for (`audit_log.via`). History
then says it in words, to the people the change affects, like any other change:

> You, through the agent “Lunch bot”, logged Leave on 28-Oct-2026.

The admin's audit page shows the same row with `via`. A kitchen that is moved takes the marks with
it. A person's own entries have none.

## The MCP server

`POST /mcp` is a
[Model Context Protocol](https://github.com/modelcontextprotocol/modelcontextprotocol) server over
Streamable HTTP (JSON-RPC 2.0). It offers tools, prompts, resources and argument completion. Send
the key as `Authorization: Bearer alk_…`. It has no session and no stream, so `GET` and `DELETE`
are 405.

- **`tools/list`** returns one tool for each route the key's scopes open, named for the route
  (`get_bootstrap`, `get_catalogue`, `get_services`, `get_menus`, `get_statements`,
  `post_log_check`, `post_log`, `delete_log_id`, `post_claims`), with a short human `title` beside
  the name, and an input schema made from the same schemas the route itself reads. It offers none
  for what stays with a person, so a model is never shown a tool that would be refused, and none for
  a route about money (`get_rate_cards`, `get_claims`, `get_settlements`, `post_claims` and the
  rest) in a kitchen that does not track money.
- **Naming what to log.** The log tools take `{date, action, service?, item?, qty?}`. `service` and
  `item` accept the kitchen's own name or an id, matched without regard to case; a name that is
  unknown, or fits more than one, is answered with the names to choose from. The guide resource, the
  help text of the tools and the prompts are written from the kitchen's own catalogue, so they use
  its words and name no dish it does not serve.
- **`tools/call`** is an ordinary request to the kitchen with the same key. It is checked, counted
  against the kitchen's day and recorded exactly as it would be through the API, and the answer is
  what the kitchen said: the JSON, or its error in its own words, with `isError` set.
- **`prompts/list`** and **`prompts/get`** give a few starting points for common jobs, as messages
  to the assistant: `log-my-meals` (`date`, `action`, `service`, `item`), `whats-my-balance`
  (`month`), `month-end-summary` (`month`), `am-i-square-for-the-month` (`month`) and
  `mark-payment-made` (`amount`, `method`, `month`). A prompt is listed only when the key's scopes
  can do everything it asks for, so a key with only `read` is shown the three that read, and
  `log-my-meals` and `mark-payment-made` need `log` and `claims`. Each tells the assistant, in plain
  words, which tools to call, to read before it writes, to show the person what it will do and ask
  before any write, and, for the ones about money, that money is in paise. A missing or unusable
  argument is answered `-32602` with what is missing. In a kitchen without money only `log-my-meals`
  is listed: the four that talk of balances and payments need money, and are refused with `-32602`
  if asked for.
- **`resources/list`**, **`resources/templates/list`** and **`resources/read`** offer
  `alimentation://kitchen/guide` (the units, the rules and how to use the tools, as plain text),
  `alimentation://kitchen/catalogue` (the services and every meal and add-on, with the prices in
  force only where the kitchen tracks money), `alimentation://kitchen/menu` (the services and every
  menu), `alimentation://kitchen/prices` (the rate cards, only where the kitchen tracks money),
  `alimentation://kitchen/holidays`, and the template `alimentation://kitchen/ledger/{month}` (the
  day ledger of the person the key acts as: counts, with no amounts, in a kitchen without money).
  Each is read by making the same request a tool would, with the same key, so it is checked, counted
  against the kitchen's day and refused exactly as that request would be; the guide is text and
  costs nothing. An address there is no resource for, including one that names another kitchen, is
  `-32002`. The address has no kitchen in it: a key is for one.
- **`completion/complete`** suggests values for a prompt's arguments (or the ledger template's
  month): `month` (the last twelve), `date` (upcoming working days, without the kitchen's holidays),
  `action` (the log actions the key's role may write), `service` and `item` (the kitchen's own
  names, from its catalogue; only meals for a switch, only add-ons for an extra, and nothing for a
  supplier, who logs only a day off) and `method`. At most 100 values come back, with `total` and
  `hasMore`. Suggesting `date` reads the kitchen once, which counts like any request.
- **`initialize`** says which kitchen the key is for, as which role and with which scopes, and where
  to start (`get_bootstrap`). Its capabilities are `tools`, `prompts`, `resources` and
  `completions`.

Most clients take the address and a header. For Claude Code, for example:

```console
$ claude mcp add --transport http alimentation https://kitchen.example.org/mcp --header "Authorization: Bearer alk_…"
```

A tool's answer is the kitchen's JSON in a single text block, as it was: it is not given a summary
line in front, because a client that reads the block as JSON would then fail to.

Other clients differ in where they put these two things; the address and the header are all there
is.

## Documentation for language models

`/llms.txt` is a short map of these pages, one line each, and `/llms-full.txt` is every page in one
file, with the lines of any code excerpt put in. Both follow the
[llms.txt convention](https://github.com/AnswerDotAI/llms-txt) and are built with the rest of the
documentation, so they cannot fall behind it. `/reference/openapi.json` is the whole API as OpenAPI
3.1, with each route's agent access.

## What is not built

- A kitchen's admin widening or narrowing what agents may do there. The scopes are the person's
  choice, inside the list above.
- A screen for a member's own keys. The admin has one, under **Your data**; a member makes theirs
  through the API, as above.
- A separate log of agents' requests for the operator. What an agent did is in the kitchen's record,
  where the people it affected can read it; the platform's own record notes only that a key was made
  or ended, with no names.
