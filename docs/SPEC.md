# Lunch Tracker: PWA Rebuild Spec

> Source: a working Google Sheets system (Master, feeds, per-person files), rebuilt as a
> single web app. The spreadsheet version proved the rules; this document is the source of truth.

---

## 1. Purpose

Track home-cooked weekday lunches that a **supplier** (Namrata) provides to **consumers** (Jovial, Smruti, and more later).

- Bill each consumer monthly, based on default meals minus exceptions.
- Let consumers log exceptions and claim payments.
- Let the supplier confirm or dispute payments.
- Give an **admin** full control and an audit trail.
- Keep each consumer's data private from the other consumers.

## 2. Roles

| Role     | Who               | Can see                                                                          | Can do                                                                   |
| -------- | ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Admin    | Owner             | Everything                                                                       | Rates, menu, people, holidays, settlements, month close, resolve queries |
| Supplier | Namrata           | All consumers' bills, meals, payments, claims; total receivable                  | Log "Supplier Off" days; confirm/dispute payment claims                  |
| Consumer | Jovial, Smruti, … | **Only their own** bill, daily meals, payments, claim status; current rates/menu | Log their own exceptions; submit payment claims                          |

Hard privacy rule: a consumer must never be able to read another consumer's rows, through the UI **or the API**. Enforce it in the database (Row Level Security), not just in the UI.

## 3. Billing rules (domain logic)

### 3.1 Rate card (effective-dated, never retroactive)

Each rate row has: `effective_from, veg, non_veg, extra_chapati, extra_bhakri, extras_per_month, menu{mon..fri}, note`.

- A date uses the **latest row with effective_from ≤ that date**.
- To change prices, **add a new row**. Never edit old rows. Past months must not change.
- Initial row (01-Apr-2026): Veg ₹150, Non Veg ₹170, Extra Chapati ₹15, Extra Bhakri ₹30, Extras ₹40/month.
  Menu: Mon Veg, Tue Veg, Wed Non Veg, Thu Veg, Fri Non Veg.
- Default portion: 4 chapati / 2 bhakri. "Extra" means pieces beyond that.
- "Extras ₹40/month" covers papad, carrot, cucumber, onion and similar. It is charged once per month **if the consumer had ≥1 meal** that month.

### 3.2 Working days

- Mon–Fri only.
- Exclude **holidays** (table: name, date, location, classification). Only rows classified as confirmed holidays count; tentative ones are kept but don't count.
- 2026–27 Mumbai holidays: 01-May, 14-Sep, 02-Oct, 20-Oct, 09/10/11-Nov, 25-Dec.
  Tentative: 12-Nov, 13-Nov.
- A consumer is billed only between `active_from` and `active_to` (active_to optional).
  Jovial and Smruti start 01-Oct-2026.

### 3.3 Default meal

Every working day, each active consumer gets the menu's meal for that weekday (Veg or Non Veg) at that day's rate. **People log exceptions only**; anything not logged means the default.

### 3.4 Exceptions (log entries)

| Change                            | Who logs                                    | Effect                                |
| --------------------------------- | ------------------------------------------- | ------------------------------------- |
| Leave                             | Consumer (for self)                         | No meal, ₹0                           |
| Switch to Veg / Switch to Non Veg | Consumer                                    | That day's meal type and price change |
| Extra Chapati (qty 1–20)          | Consumer                                    | + qty × extra_chapati                 |
| Extra Bhakri (qty 1–20)           | Consumer                                    | + qty × extra_bhakri                  |
| Supplier Off                      | Supplier only; applies to **all** consumers | No meal for anyone that day           |

Validation rules:

- No weekends.
- A date is required.
- Qty is required for the Extra types.
- A consumer can only log for themselves.
- "All consumers" can only be used with Supplier Off.
- Every entry stores `logged_by` and `logged_at`.

### 3.5 Daily ledger (derived, never stored manually)

For each (date, consumer): `status ∈ {Meal, Leave, Holiday, Supplier Off, Inactive}`, plus meal type, extra chapati, extra bhakri, `day_total`, and `basis`.

- `basis` = **Actual** if date ≤ today, **Projected** if date > today.
- `day_total` = meal price + extras; it is 0 when status ≠ Meal.

### 3.6 Monthly statement (per month × consumer)

- **Counts:** meals, veg, non_veg, leave, extra_chapati, extra_bhakri.
- **Amounts:**
  - meals_amt and bread_amt come from the daily ledger.
  - extras_amt = extras_per_month if meals > 0.
  - live_total = meals_amt + bread_amt + extras_amt.
  - actual_to_date = live_total counting only Actual days (extras is included once there's ≥1 actual meal).
  - **billed** = the closed (archived) amount if the month is closed, otherwise live_total.
  - changed_after_close = live_total − billed. If this is non-zero, flag "⚠ Changed after close".
  - paid = confirmed payments + admin settlement payments.
  - claimed_pending = claims not yet decided.
  - balance = billed − paid.
  - open_queries = admin "Query" entries + disputed claims − admin "Query Resolved" entries.
- **Status** (first match wins):
  `—` (billed = 0) → `⚠ Changed after close` → `Query open` → `Settled` (paid ≥ billed) → `Awaiting confirmation` (claimed_pending > 0) → `Part paid` (paid > 0) → `Due` (month ended) → `Projected`.
- `basis` = Actual once the month has ended; Projected until then.
- "Earlier unpaid" = the sum of balances from earlier months.
- Months generated: from the earliest consumer active_from through the current month. This rolls forward automatically.

### 3.7 Month close (archive)

The admin closes a month for a consumer, which freezes `billed` (stores meals count, amount, closed_on, closed_by). Later edits to logs or holidays for that month don't change the bill; they show up as "Changed after close" with the difference.

## 4. Payments: claim → confirm

1. **Consumer claims** a payment with these fields: `paid_at (date + optional time), for_month, amount > 0, method {UPI, Cash, Bank transfer, Other}, ref_note`.
   - Part payments are separate claims.
   - Claim label/id is shown as `"{Consumer} · {Mon-YY} · ₹{amount} · {dd-Mon-yy[ hh:mm]}"`. Use a real UUID in the app.
2. The claim stays **Pending** until the supplier decides. It shows to both sides as "Claimed ₹ (pending)", and the statement status is "Awaiting confirmation".
3. **The supplier decides once** on each claim: **Confirmed** or **Disputed**. A reason is required for Disputed.
   - **One decision per claim, and the first one is final** (the user's requirement: "once a mutual acknowledgement happens that transaction must be frozen").
     - In the app, put a unique constraint on decision.claim_id and give the supplier no update or delete permission.
     - Only the admin can reverse a decision, and that reversal is itself an audited entry.
   - The supplier's pick-list only shows undecided claims.
4. **Confirmed** adds the amount to Paid and lowers the balance. **Disputed** opens a query; the admin resolves it with a settlement entry.
5. The consumer sees each claim's status: Pending / Confirmed / Disputed.
6. Admin **settlements** (manual override): `date, consumer, for_month, type {Payment, Query, Query Resolved}, amount, note, recorded_by`. These are append-only.

## 5. Data model (Postgres / Supabase suggested)

```sql
people(id, name, role enum('admin','supplier','consumer'), active_from date, active_to date null, auth_user_id uuid unique)
rate_cards(id, effective_from date unique, veg int, non_veg int, extra_chapati int, extra_bhakri int,
           extras_per_month int, menu_mon text, menu_tue text, menu_wed text, menu_thu text, menu_fri text, note text)
holidays(id, name, date date, location text, classification text, confirmed bool)
log_entries(id, date date, person_id null, all_consumers bool, change enum(...), qty int null, note,
            logged_by uuid, logged_at timestamptz)
claims(id uuid, consumer_id, paid_at timestamptz, for_month date, amount int, method, ref_note, created_at)
claim_decisions(claim_id uuid PRIMARY KEY, decision enum('Confirmed','Disputed'), note, decided_by, decided_at)
settlements(id, date, consumer_id, for_month, type, amount null, note, recorded_by, created_at)
month_closes(for_month date, consumer_id, meals int, billed int, closed_on, closed_by, PRIMARY KEY(for_month, consumer_id))
audit_log(id, table_name, row_id, action, actor, at, before jsonb, after jsonb)   -- trigger-filled
```

Compute ledger and statement in **SQL views** (or server functions) so that the UI, the tests and every role use the same logic.

**RLS policies:**

- consumer: `SELECT` own rows from log_entries, claims, decisions (via claim), statement view. `INSERT` log_entries and claims only where person_id = self and change ≠ 'Supplier Off'.
- supplier: `SELECT` all statements and claims. `INSERT` log_entries with change = 'Supplier Off'. `INSERT` claim_decisions; **no UPDATE/DELETE**.
- admin: full access.
- Everyone can read rate_cards and holidays. Only the admin can write them.
- Log entries and claims: the author may edit or delete only while the month is open **and** (for claims) before a decision exists.

## 6. Screens

**Consumer**

- **Dashboard:** month picker (default "Current month"); a Projected/Actual tag; tiles for Bill, Actual to Date, Paid, Claimed, Balance, Status and Earlier Unpaid; the current rates line; a monthly bill bar chart (projected months marked with \*).
- **Daily:** a list or calendar of days (status, meal, extras, ₹), with projected days greyed.
- **My Log:** add an exception (date, change, qty, note), with a live validation hint.
- **My Payments:** add a claim and see each claim's status.

**Supplier**

- **Dashboard:** tiles for Bill, Actual to Date, Paid, Balance, Earlier Unpaid, Receivable and To Confirm; a consumer table (meals, leave, bill, actual, paid, balance, status, earlier unpaid, claimed); a chart with one series per consumer.
- **Confirm Payments:** a queue of pending claims, with Confirm and Dispute (reason) buttons.
- **My Log:** Supplier Off days.

**Admin**

- **Dashboard:** the supplier view plus totals.
- Settings: rate cards, menu, people.
- Holidays.
- Settlements.
- Month close.
- Claims overview.
- Audit log.

**UI conventions**

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
- **PWA**: web app manifest (name "Lunch Tracker", theme #1F3864), installable on Android and iOS, offline reads of the last statement. Use `next-pwa`, or Serwist plus a service worker.
- Optional: web push for "New claim to confirm" and "Payment confirmed". Send it from a Supabase Edge Function on insert.
- **Deploy**: Vercel (or Netlify). Env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only).

## 8. Deploy steps

1. Create a Supabase project. Run the migrations for the §5 schema, views and RLS. Seed from §10.
2. Create the auth users and link `people.auth_user_id`.
3. `npx create-next-app`, add the Supabase client, build the screens.
4. Add the PWA manifest and service worker. Check installability in Lighthouse.
5. Push to GitHub, import into Vercel or Netlify, set the env vars, deploy.
6. Add a custom domain (optional). Share the URL; each person signs in and sees only their role's data.

## 9. Lessons from the Sheets version (don't repeat these)

- The Sheets version needed IMPORTRANGE "Allow access" hand-offs, a separate feed file per person (because any editor with import access could read the whole source), and manual prompts for every file. A single database with RLS replaces all of that.
- Formulas can't record when an entry was made. The app stores `created_at` and `logged_by` server-side.
- Dropdown-only safeguards can be bypassed. Enforce rules with database constraints.
- Decisions must be immutable once made: unique per claim, no update.

## 10. Seed data

- People:
  - Admin (owner).
  - Namrata (supplier).
  - Jovial (consumer, from 2026-10-01).
  - Smruti (consumer, from 2026-10-01).
- Rate card: as in §3.1.
- Holidays: as in §3.2.
- Log entries:
  - 2026-10-01, Jovial, Extra Bhakri, qty 2.
  - 2026-10-16, Smruti, Leave, note "WFH".

## 11. Reference test cases (must pass)

**October 2026:** 22 weekdays, minus holidays 02-Oct and 20-Oct, gives **20 working days**. Wed + Fri: 8 Non Veg; the other 12 are Veg.

| Consumer | Calculation                                                      | Billed     |
| -------- | ---------------------------------------------------------------- | ---------- |
| Jovial   | 12×150 + 8×170 = 3,160; + bread 2×30 = 60; + extras 40           | **₹3,260** |
| Smruti   | 3,160 − 170 (Fri 16-Oct leave, Non Veg day) = 2,990; + extras 40 | **₹3,030** |
| Total    |                                                                  | **₹6,290** |

**Supplier's handwritten check for a full month:** 22 days, 8 Non Veg, 14 Veg. 14×150 = 2,100; 8×170 = 1,360; subtotal 3,460; + ₹40 extras = **₹3,500**.

Other tests:

- **Rate change isn't retroactive:** add a rate row from 01-Nov at Veg 160 / Non Veg 180. October is unchanged; November reprices.
- **Claim flow:** Jovial claims ₹100 for Oct. While pending, status = Awaiting confirmation and claimed = 100. After the supplier confirms: paid = 100, balance = 3,160, status = Part paid. A second decision attempt is rejected.
- **Dispute:** the supplier disputes a claim with a reason. open_queries = 1 and status = Query open. After an admin "Query Resolved" entry, the query closes.
- **Privacy:** logged in as Jovial, any query for Smruti's rows returns nothing.
- **Month close:** after closing October, editing an October log entry leaves billed unchanged and shows "⚠ Changed after close" with the difference.
