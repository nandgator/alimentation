# Lunch Tracker: PWA Rebuild Spec

> Source: a working Google Sheets system (Master, feeds, per-person files), rebuilt as a single web
> app. The spreadsheet version proved the rules; this document is the source of truth.

---

## 1. Purpose

Track home-cooked weekday lunches that a **supplier** (Maple) provides to **consumers** (Jovial,
Smruti, and more later).

- Bill each consumer monthly, based on default meals minus exceptions.
- Let consumers log exceptions and claim payments.
- Let the supplier confirm or dispute payments.
- Give an **admin** full control and an audit trail.
- Keep each consumer's data private from the other consumers.

## 2. Roles

| Role     | Who               | Can see                                                                          | Can do                                                                               |
| -------- | ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Admin    | Owner             | Everything                                                                       | Catalogue, menu, prices, people, holidays, settlements, month close, resolve queries |
| Supplier | Maple             | All consumers' bills, meals, payments, claims; total receivable                  | Log "Supplier Off" days; confirm/dispute payment claims                              |
| Consumer | Jovial, Smruti, … | **Only their own** bill, daily meals, payments, claim status; current rates/menu | Log their own exceptions; submit payment claims                                      |

Hard privacy rule: a consumer must never be able to read another consumer's rows, through the UI
**or the API**. Enforce it in the database (Row Level Security), not just in the UI.

## 3. Billing rules (domain logic)

A kitchen says what it serves, as data. Nothing in the rules below knows a dish by name; **Veg**,
**Non Veg**, **Chapati** and **Bhakri** appear only in the worked example (§3.9, §10, §11), which is
one kitchen's catalogue like any other. Only the behaviour is fixed: two kinds of item and four log
actions.

### 3.1 Catalogue, services, menu and rate card

**Catalogue.** The kitchen lists what it serves as _items_, each with a stable id, a free-form name
and unit (for example "plate", "piece", "cup"), and one of two fixed kinds:

- a **meal**: what a service serves on a weekday (a plate of something);
- an **add-on**: something asked for beyond the meal, in a quantity (`max_qty` per entry, 1 to 99,
  20 by default).

An item's kind, unit and `max_qty` never change. Its name can, and the rename is audited. Items are
never deleted: **retiring** one sets `archived_on` once, hides it from pickers from that date, and
is refused while a menu in force on or after that date still offers it. Names are unique
(case-insensitively), retired ones included. History shows an item's current name.

**Services.** A _service_ is a time of day the kitchen serves (Lunch, Dinner). A kitchen has one or
more, up to 6; items are at most 60. A service is renamed or retired in the same way as an item. A
kitchen with one service hides every service control.

**Enrolment.** A _person_service_ row says which services a consumer takes, and from when
(`active_from`, optional `active_to`, inclusive). A new consumer takes every service. A consumer is
billed for a service only on the days they are enrolled in it; the rows of one person and service
never overlap.

**Menu.** A **menu** row has `effective_from` and a note, and says, for each service, which meal it
serves on each weekday (a weekday with no cell is not served by that service) and which other items
it **offers**: the meals a person may switch to and the add-ons they may ask for. Every working day
(§3.2) needs a meal from at least one service.

**Rate card.** A **rate card** row has `effective_from`, a price in paise for each item, optionally
a different price for one item in one service (an _override_), a `monthly_fee` and a note. Only a
kitchen that tracks money (§3.8) has rate cards. Such a kitchen is billed only when every item its
menus offer has a price.

- A date uses the **latest row with effective_from ≤ that date**, of each.
- A price is the exact (item, service) line if there is one, otherwise the (item, any service) line;
  if neither exists the engine raises `NO_PRICE`.
- To change a menu or a rate card, **add a new row**. Never edit old rows. Past months must not
  change.
- The **monthly fee** is one kitchen-wide amount. It is charged once a month **if the consumer had
  meals on at least `minDays` different days** that month (§3.6). Days are counted, not servings, so
  eating two services on one day counts once.

### 3.2 Working days

- Mon–Fri by default; the kitchen's rules may choose any subset of the week.
- Exclude **holidays** (table: name, date, location, classification). Only rows classified as
  confirmed holidays count; tentative ones are kept but don't count.
- A consumer is billed only between `active_from` and `active_to` (active_to optional).

### 3.3 Default meal

Every working day, each active consumer gets, for each service they take that is served that
weekday, the menu's meal for that weekday at that day's price. **People log exceptions only**;
anything not logged means the default.

### 3.4 Exceptions (log entries)

There are four actions. What each applies to is the kitchen's own catalogue and services.

| Action       | Who logs                                    | Scope                                                    | Effect                                               |
| ------------ | ------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Leave        | Consumer (for self)                         | The whole day (default), or one service                  | No meal there; ₹0, or the leave charge of §3.6       |
| Switch       | Consumer                                    | One service, to another meal that service offers         | That service's meal and its price change for the day |
| Extra        | Consumer                                    | One service, an add-on it offers, qty 1 to the `max_qty` | + qty × the add-on's price                           |
| Supplier Off | Supplier only; applies to **all** consumers | The whole day (default), or one service                  | No meal for anyone that day, or in that service      |

Validation rules:

- No day outside the working days.
- A date is required, and the person must be enrolled in the service on it.
- A Switch or Extra names a service and an item that service **offers** in the menu in force; the
  item is not retired and the quantity does not exceed its `max_qty`.
- A service must be served that weekday.
- Qty is required for Extra and not allowed otherwise.
- At most one Switch per person, day and service, and one Extra per item.
- A whole-day Leave (or Supplier Off) and a single-service one on the same day cannot both stand
  (`OVERLAPPING_SCOPE`); two of the same scope are a duplicate.
- A consumer can only log for themselves.
- "All consumers" can only be used with Supplier Off.
- Every entry stores `logged_by` and `logged_at`.

### 3.5 Daily ledger (derived, never stored manually)

One row for each (date, consumer, service the consumer takes that is served that weekday):
`status ∈ {Meal, Leave, Holiday, Supplier Off, Inactive}`, plus the meal served, the add-ons (item,
qty, amount), `meal_price`, `add_on_amount`, `leave_amount`, `row_total` and `basis`. A date on
which the person is not active is one row with no service.

- `basis` = **Actual** if date ≤ today, **Projected** if date > today.
- Precedence per row: Holiday, then Supplier Off (whole day or that service), then Leave (whole day
  or that service), then Meal.
- On a Meal row the meal is the menu's, replaced by the latest Switch for that service. Extras sum
  per item. A Switch or Extra never affects another service.
- `row_total` = meal price + add-ons; it is 0 when status ≠ Meal, apart from a leave charge.

### 3.6 Monthly statement (per month × consumer)

- **Counts:** `meals` (servings: one for each Meal row), `leave` (service slots on leave), `items`
  (meal rows by item) and `add_ons` (quantity by item).
- **Amounts:**
  - meals_amt and add_on_amt come from the daily ledger.
  - leave_amt = the leave charge: `leave.chargeBps` of the price of the meal that service would have
    served (after Switches), rounded for each row. Zero by default.
  - fee_amt = the rate card's `monthly_fee` if the number of days with a Meal row ≥ `minDays`. The
    card is the one in force on the 1st of the month (or on the first Meal day if the first card
    starts mid-month).
  - lines: one for each item (item, qty, amount), meals then add-ons, for the bill. The leave charge
    and the fee are not lines.
  - live_total = meals_amt + add_on_amt + leave_amt + fee_amt.
  - actual_to_date = live_total counting only Actual days (the fee is included once there are
    `minDays` Actual days).
  - **billed** = the closed (archived) amount if the month is closed, otherwise live_total.
  - changed_after_close = live_total − billed. If this is non-zero, flag "⚠ Changed after close".
  - paid = confirmed payments + admin settlement payments.
  - claimed_pending = claims not yet decided.
  - balance = billed − paid.
  - open_queries = admin "Query" entries + disputed claims − admin "Query Resolved" entries.
- **Status** (first match wins): `—` (billed = 0) → `⚠ Changed after close` → `Query open` →
  `Settled` (paid ≥ billed) → `Awaiting confirmation` (claimed_pending > 0) → `Part paid` (paid > 0)
  → `Due` (month ended) → `Projected`.
- `basis` = Actual once the month has ended; Projected until then.
- "Earlier unpaid" = the sum of balances from earlier months.
- Months generated: from the earliest consumer active_from through the current month. This rolls
  forward automatically.

### 3.7 Month close (archive)

The admin closes a month for a consumer, which freezes `billed` (stores meals count, amount,
closed_on, closed_by). Later edits to logs or holidays for that month don't change the bill; they
show up as "Changed after close" with the difference.

### 3.8 A kitchen without money

A kitchen is made either with money or without it, and the choice is **fixed** once it is made. A
kitchen without money counts meals and does not price them. It keeps its catalogue, services,
enrolments and menu (these carry no price), people and roles, holidays, working days, leave and
exception logging with its cut-off, Supplier Off, add-ons as counts (never priced), the Daily and
Dashboard screens as counts per item, history and audit, export, move, agent keys for reading and
logging, and invitations. A month close is a plain **lock** of the month: the `month_close` row has
no `billed` amount. It does not have a rate card, a bill, a claim, a decision, a reversal, a
settlement, a balance, or the four rules about money (leave charge, monthly fee, payments, rate card
back-dating). The database refuses to hold any of them (`DESIGN.md` §5.16).

### 3.9 Worked example: the home kitchen

The kitchen the rules were first written for is the **seed** that tests and the first starter use
(`homeKitchenSeed()` in `packages/core/test/seed.ts`); §10 lists it and §11 checks it to the paisa.

- **Service:** Lunch.
- **Items:** meals Veg and Non Veg (unit "plate"); add-ons Chapati and Bhakri (unit "piece", at most
  20). "Extra" means pieces beyond the default portion of 4 chapati and 2 bhakri.
- **Menu from 01-Apr-2026:** Mon Veg, Tue Veg, Wed Non Veg, Thu Veg, Fri Non Veg. Lunch offers all
  four items.
- **Rate card from 01-Apr-2026:** Veg ₹150, Non Veg ₹170, Chapati ₹15, Bhakri ₹30, monthly fee ₹40
  (it covers papad, carrot, cucumber, onion and similar). A second card from 01-Nov-2026 has Veg
  ₹160 and Non Veg ₹180 and the rest as before.
- **Rules:** the defaults, with the monthly fee from `minDays` 1.
- **Holidays (2026–27 Mumbai):** 01-May, 14-Sep, 02-Oct, 20-Oct, 09/10/11-Nov, 25-Dec. Tentative:
  12-Nov, 13-Nov.

## 4. Payments: claim → confirm

1. **Consumer claims** a payment with these fields:

<!-- markdownlint-disable-next-line MD013 -->

`paid_at (date + optional time), for_month, amount > 0, method {UPI, Cash, Bank transfer, Other}, ref_note`.

- Part payments are separate claims.
- Claim label/id is shown as `"{Consumer} · {Mon-YY} · ₹{amount} · {dd-Mon-yy[ hh:mm]}"`. Use a real
  UUID in the app.

1. The claim stays **Pending** until the supplier decides. It shows to both sides as "Claimed ₹
   (pending)", and the statement status is "Awaiting confirmation".
2. **The supplier decides once** on each claim: **Confirmed** or **Disputed**. A reason is required
   for Disputed.
   - **One decision per claim, and the first one is final** (the user's requirement: "once a mutual
     acknowledgement happens that transaction must be frozen").
     - In the app, put a unique constraint on decision.claim_id and give the supplier no update or
       delete permission.
     - Only the admin can reverse a decision, and that reversal is itself an audited entry.
   - The supplier's pick-list only shows undecided claims.
3. **Confirmed** adds the amount to Paid and lowers the balance. **Disputed** opens a query; the
   admin resolves it with a settlement entry.
4. The consumer sees each claim's status: Pending / Confirmed / Disputed.
5. Admin **settlements** (manual override):
   `date, consumer, for_month, type {Payment, Query, Query Resolved}, amount, note, recorded_by`.
   These are append-only.

## 5. Data model (Postgres / Supabase suggested)

```sql
people(id, name, role enum('admin','supplier','consumer'), active_from date, active_to date null, auth_user_id uuid unique)
services(id, name unique, position, archived_on date null)
catalogue_items(id, kind enum('meal','addon'), name unique, unit, max_qty, archived_on date null)
person_services(id, person_id, service_id, active_from date, active_to date null)   -- dated enrolment, no overlap
menus(id, effective_from date unique, note text, created_at, created_by)
menu_offers(menu_id, service_id, item_id)                       -- what a service offers
menu_days(menu_id, service_id, weekday 0..6, meal_id)           -- no row = not served that weekday
rate_cards(id, effective_from date unique, monthly_fee int, note text)   -- only in a kitchen that tracks money
rate_prices(card_id, item_id, service_id null, amount int)      -- null service = the price in every service
holidays(id, name, date date, location text, classification text, confirmed bool)
log_entries(id, date date, person_id null, all_consumers bool, action enum('Leave','Switch','Extra','Supplier Off'),
            service_id null, item_id null, qty int null, note, logged_by uuid, logged_at timestamptz)
claims(id uuid, consumer_id, paid_at timestamptz, for_month date, amount int, method, ref_note, created_at)
claim_decisions(claim_id uuid PRIMARY KEY, decision enum('Confirmed','Disputed'), note, decided_by, decided_at)
settlements(id, date, consumer_id, for_month, type, amount null, note, recorded_by, created_at)
month_closes(for_month date, consumer_id, meals int, billed int null, closed_on, closed_by, PRIMARY KEY(for_month, consumer_id))  -- billed is null for a lock
audit_log(id, table_name, row_id, action, actor, at, before jsonb, after jsonb)   -- trigger-filled
```

Constraints that carry the rules:

- Services and items are never deleted (no delete privilege); a retired one stays for history.
- An item's `kind`, `unit` and `max_qty` cannot change; `archived_on` is set once.
- Menus, offers, days, rate cards and prices are append-only. A child row is inserted only in its
  parent's transaction.
- A menu day refers to a meal the same service offers (a composite foreign key), and only to an item
  of kind meal.
- A log entry's item and kind are a foreign key to the catalogue. A Switch needs a service and a
  meal, an Extra a service, an add-on and a qty; Leave and Supplier Off take neither item nor qty.
- One Leave, one Supplier Off, one Switch per scope and day, and one Extra per item, by unique
  indexes (a whole-day entry has a null service, and nulls count as equal). A trigger refuses a
  whole-day entry beside a single-service one.
- A log entry is refused for a retired item, a qty above the item's `max_qty`, a service the person
  is not enrolled in on that date, or an item the menu in force does not offer.

Compute ledger and statement in **SQL views** (or server functions) so that the UI, the tests and
every role use the same logic.

**RLS policies:**

- consumer: `SELECT` own rows from log_entries, claims, decisions (via claim), person_services,
  statement view. `INSERT` log_entries and claims only where person_id = self and action ≠ 'Supplier
  Off'.
- supplier: `SELECT` all statements, claims and enrolments. `INSERT` log_entries with action =
  'Supplier Off'. `INSERT` claim_decisions; **no UPDATE/DELETE**.
- admin: full access.
- Everyone can read the catalogue, services, menus, rate cards and holidays. Only the admin can
  write them.
- Log entries and claims: the author may edit or delete only while the month is open **and** (for
  claims) before a decision exists.

## 6. Screens

### Consumer

- **Dashboard:** month picker (default "Current month"); a Projected/Actual tag; tiles for Bill,
  Actual to Date, Paid, Claimed, Balance, Status and Earlier Unpaid; the current monthly fee and
  prices line; a monthly bill bar chart (projected months marked with \*).
- **Daily:** a list or calendar of days (status, meal, add-ons, ₹), with projected days greyed.
- **My Log:** add an exception (date, action, service, item, qty, note), with a live validation
  hint.
- **My Payments:** add a claim and see each claim's status.

### Supplier

- **Dashboard:** tiles for Bill, Actual to Date, Paid, Balance, Earlier Unpaid, Receivable and To
  Confirm; a consumer table (meals, leave, bill, actual, paid, balance, status, earlier unpaid,
  claimed); a chart with one series per consumer.
- **Confirm Payments:** a queue of pending claims, with Confirm and Dispute (reason) buttons.
- **My Log:** Supplier Off days.

### Admin

- **Dashboard:** the supplier view plus totals.
- Settings: catalogue and services, menu, prices (rate cards), rules, people and the services each
  takes.
- Holidays.
- Settlements.
- Month close.
- Claims overview.
- Audit log.

### UI conventions

- Navy #1F3864 headers.
- Series colours #1F3864, #C55A11, then greys.
- Money as ₹#,##0 with zero shown as "-".
- Dates as dd-MMM-yyyy; months as MMM-yy.
- Projected values in grey italics.
- Time zone Asia/Kolkata for "today".
- Short, non-wrapping labels.

## 7. Tech stack (recommended)

- **Next.js (App Router) + TypeScript**, Tailwind, a chart library (Recharts).
- **Supabase**: Postgres, Auth (email magic link or Google), RLS, SQL views.
- **PWA**: web app manifest (name "Lunch Tracker", theme #1F3864), installable on Android and iOS,
  offline reads of the last statement. Use `next-pwa`, or Serwist plus a service worker.
- Optional: web push for "New claim to confirm" and "Payment confirmed". Send it from a Supabase
  Edge Function on insert.
- **Deploy**: Vercel (or Netlify). Env vars `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only).

## 8. Deploy steps

1. Create a Supabase project. Run the migrations for the §5 schema, views and RLS. Seed from §10.
2. Create the auth users and link `people.auth_user_id`.
3. `npx create-next-app`, add the Supabase client, build the screens.
4. Add the PWA manifest and service worker. Check installability in Lighthouse.
5. Push to GitHub, import into Vercel or Netlify, set the env vars, deploy.
6. Add a custom domain (optional). Share the URL; each person signs in and sees only their role's
   data.

## 9. Lessons from the Sheets version (don't repeat these)

- The Sheets version needed IMPORTRANGE "Allow access" hand-offs, a separate feed file per person
  (because any editor with import access could read the whole source), and manual prompts for every
  file. A single database with RLS replaces all of that.
- Formulas can't record when an entry was made. The app stores `created_at` and `logged_by`
  server-side.
- Dropdown-only safeguards can be bypassed. Enforce rules with database constraints.
- Decisions must be immutable once made: unique per claim, no update.

## 10. Seed data

The home kitchen of §3.9, as `homeKitchenSeed()`:

- People:
  - Admin (owner).
  - Maple (supplier).
  - Jovial (consumer, from 2026-10-01).
  - Smruti (consumer, from 2026-10-01).
- Service: Lunch. Enrolment: Jovial and Smruti in Lunch from 2026-10-01.
- Items: Veg and Non Veg (meals, plate); Chapati and Bhakri (add-ons, piece, at most 20).
- Menu and rate cards: as in §3.9.
- Holidays: as in §3.9.
- Log entries:
  - 2026-10-01, Jovial, Extra, Lunch, Bhakri, qty 2.
  - 2026-10-16, Smruti, Leave, whole day, note "WFH".

## 11. Reference test cases (must pass)

All of them run on the seed of §10.

**October 2026:** 22 weekdays, minus holidays 02-Oct and 20-Oct, gives **20 working days**. Wed +
Fri: 8 Non Veg meals; the other 12 are Veg.

| Consumer | Calculation                                                           | Billed     |
| -------- | --------------------------------------------------------------------- | ---------- |
| Jovial   | 12×150 + 8×170 = 3,160; + Bhakri 2×30 = 60; + monthly fee 40          | **₹3,260** |
| Smruti   | 3,160 − 170 (Fri 16-Oct leave, Non Veg day) = 2,990; + monthly fee 40 | **₹3,030** |
| Total    |                                                                       | **₹6,290** |

**Supplier's handwritten check for a full month:** 22 days, 8 Non Veg, 14 Veg. 14×150 = 2,100; 8×170
= 1,360; subtotal 3,460; + ₹40 fee = **₹3,500**. It is built from counts, not from a calendar month.

Other tests:

- **Rate change isn't retroactive:** the second rate card from 01-Nov (Veg 160 / Non Veg 180).
  October is unchanged; November reprices (18 working days, **₹3,060** with nothing logged).
- **Mid-month card choice:** a day uses the card in force on that date.
- **Three services:** a fixture with three services and awkward prices (an override in one service,
  a whole-day Leave, a Switch and an Extra in one service, a one-service Supplier Off, leave charged
  per row) is worked out by hand and must match to the paisa. The monthly fee counts days: a person
  who eats two services on one day with `minDays` 2 is not charged.
- **Rename and retire change no bill:** renaming or retiring an item leaves every ledger and
  statement identical.
- **Without money:** the same run gives the same counts, per item, with no price read.
- **Claim flow:** Jovial claims ₹100 for Oct. While pending, status = Awaiting confirmation and
  claimed = 100. After the supplier confirms: paid = 100, balance = 3,160, status = Part paid. A
  second decision attempt is rejected.
- **Dispute:** the supplier disputes a claim with a reason. open_queries = 1 and status = Query
  open. After an admin "Query Resolved" entry, the query closes.
- **Privacy:** logged in as Jovial, any query for Smruti's rows (log, enrolment or audit) returns
  nothing.
- **Month close:** after closing October, editing an October log entry leaves billed unchanged and
  shows "⚠ Changed after close" with the difference.
