// Drift testing for the database guards. Each defect below removes or loosens one
// guard in a freshly provisioned workspace; the database tests are then run and the
// test written for that guard must fail. A defect no test notices is a guard
// nobody is checking.
//
//   node scripts/drift-db.mjs            run every defect
//   node scripts/drift-db.mjs rls        run those whose name contains "rls"
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = `(SELECT value FROM meta WHERE key = 'app_role')`;
const dropChecks = (table) => `DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = '${table}'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', c.conname);
  END LOOP; END $$`;
const asApp = (template, ...more) =>
  `DO $$ BEGIN EXECUTE format('${template}', ${APP}${more.length ? `, ${more.join(", ")}` : ""}); END $$`;

// Loosens one rule inside a function: the text `from` must be in its definition, and is replaced by `to`.
const lit = (t) => `'${t.replaceAll("'", "''")}'`;
const patch = (fn, from, to) =>
  `DO $x$ DECLARE d text := pg_get_functiondef('${fn}'::regprocedure); BEGIN
    IF position(${lit(from)} IN d) = 0 THEN RAISE EXCEPTION 'defect does not apply: ${from.slice(0, 30).replaceAll("'", "")}'; END IF;
    EXECUTE replace(d, ${lit(from)}, ${lit(to)}); END $x$`;
const readOnly = (t) => [
  `frozen: the flag is ignored on ${t}`,
  "owner",
  `DROP TRIGGER ${t}_read_only ON ${t}`,
  "cannot be written while the kitchen is being moved",
];

// [name, as, sql, a fragment of the name of the test that must fail]
const defects = [
  // Row-level security: who may read what.
  [
    "rls: consumers read every person",
    "owner",
    `ALTER POLICY person_read ON person USING (true)`,
    "only themselves",
  ],
  [
    "rls: consumers read every log entry",
    "owner",
    `ALTER POLICY log_read ON log_entry USING (app_role() IS NOT NULL)`,
    "their own entries",
  ],
  [
    "rls: log readable with no role set (the leak found in review)",
    "owner",
    `ALTER POLICY log_read ON log_entry USING (app_role() IN ('admin','supplier') OR person_id = app_person() OR all_consumers)`,
    "shows nobody anything",
  ],
  [
    "rls: consumers read every claim",
    "owner",
    `ALTER POLICY claim_read ON claim USING (true)`,
    "only their own claims",
  ],
  [
    "rls: consumers read every decision",
    "owner",
    `ALTER POLICY decision_read ON claim_decision USING (true)`,
    "only their own claims",
  ],
  [
    "rls: consumers read every settlement",
    "owner",
    `ALTER POLICY settlement_read ON settlement USING (true)`,
    "only their own claims",
  ],
  [
    "rls: consumers read every close",
    "owner",
    `ALTER POLICY close_read ON month_close USING (true)`,
    "only their own claims",
  ],
  [
    "rls: everyone reads the whole audit trail",
    "owner",
    `ALTER POLICY audit_admin_read ON audit_log USING (true)`,
    "trail of their own records",
  ],
  [
    "rls: members read the trail of other members",
    "owner",
    `ALTER POLICY audit_member_read ON audit_log USING (app_role() = 'consumer')`,
    "trail of their own records",
  ],
  [
    "rls: members cannot read the trail of their own records",
    "owner",
    `DROP POLICY audit_member_read ON audit_log`,
    "trail of their own records",
  ],
  [
    "rls: the supplier reads the trail of people",
    "owner",
    `ALTER POLICY audit_supplier_read ON audit_log USING (app_role() = 'supplier')`,
    "not of people or the workspace",
  ],
  [
    "rls: row security off on person",
    "owner",
    `ALTER TABLE person DISABLE ROW LEVEL SECURITY`,
    "only themselves",
  ],
  [
    "rls: row security off on claim",
    "owner",
    `ALTER TABLE claim DISABLE ROW LEVEL SECURITY`,
    "only their own claims",
  ],
  [
    "rls: consumers write for anyone",
    "owner",
    `ALTER POLICY log_insert ON log_entry WITH CHECK (true)`,
    "stops a consumer writing",
  ],
  [
    "rls: anyone decides claims",
    "owner",
    `ALTER POLICY decision_supplier_insert ON claim_decision WITH CHECK (true)`,
    "stops a consumer writing",
  ],
  [
    "rls: consumers insert prices",
    "owner",
    `ALTER POLICY rate_card_admin_insert ON rate_card WITH CHECK (true)`,
    "stops a consumer changing prices",
  ],
  [
    "rls: consumers insert settlements",
    "owner",
    `ALTER POLICY settlement_admin_insert ON settlement WITH CHECK (true)`,
    "stops a consumer changing prices",
  ],
  [
    "rls: consumers edit people",
    "owner",
    `ALTER POLICY person_admin_update ON person USING (true) WITH CHECK (true)`,
    "stops a consumer changing prices",
  ],
  [
    "rls: decided claims can be withdrawn",
    "owner",
    `ALTER POLICY claim_delete ON claim USING (true)`,
    "only until it is decided",
  ],
  [
    "rls: row security bypassed by the application role",
    "admin",
    asApp("ALTER ROLE %I BYPASSRLS"),
    "only themselves",
  ],

  // Append-only: decisions, settlements, prices, rules, the audit trail.
  [
    "append-only: decisions updatable by the application role",
    "owner",
    asApp("GRANT UPDATE, DELETE ON claim_decision TO %I"),
    "no right to change or remove",
  ],
  [
    "append-only: settlements deletable by the application role",
    "owner",
    asApp("GRANT DELETE ON settlement TO %I"),
    "no right to change or remove",
  ],
  [
    "append-only: prices updatable by the application role",
    "owner",
    asApp("GRANT UPDATE ON rate_card TO %I"),
    "no right to change or remove",
  ],
  [
    "append-only: audit trail writable by the application role",
    "owner",
    asApp("GRANT UPDATE, DELETE ON audit_log TO %I"),
    "no right to change or remove",
  ],
  [
    "append-only: no trigger on decisions",
    "owner",
    `DROP TRIGGER claim_decision_append_only ON claim_decision`,
    "by trigger",
  ],
  [
    "append-only: no trigger on settlements",
    "owner",
    `DROP TRIGGER settlement_append_only ON settlement`,
    "by trigger",
  ],
  [
    "append-only: no trigger on prices",
    "owner",
    `DROP TRIGGER rate_card_append_only ON rate_card`,
    "by trigger",
  ],
  [
    "append-only: no trigger on the audit trail",
    "owner",
    `DROP TRIGGER audit_log_append_only ON audit_log`,
    "by trigger",
  ],
  [
    "append-only: a second decision is allowed",
    "owner",
    `ALTER TABLE claim_reversal DROP CONSTRAINT claim_reversal_claim_id_fkey; ALTER TABLE claim_decision DROP CONSTRAINT claim_decision_pkey`,
    "decide a claim once",
  ],
  [
    "append-only: reversal not unique",
    "owner",
    `ALTER TABLE claim_reversal DROP CONSTRAINT claim_reversal_pkey`,
    "only the admin reverse",
  ],
  [
    "append-only: decided claims deletable by the owner (no foreign key)",
    "owner",
    `ALTER TABLE claim_decision DROP CONSTRAINT claim_decision_claim_id_fkey`,
    "only until it is decided",
  ],

  // Who did it, and when.
  [
    "stamp: log entries keep a forged author",
    "owner",
    `DROP TRIGGER log_entry_stamp ON log_entry`,
    "forged author",
  ],
  [
    "stamp: decisions keep a forged decider",
    "owner",
    `DROP TRIGGER claim_decision_stamp ON claim_decision`,
    "forged decider",
  ],
  [
    "stamp: settlements keep a forged recorder",
    "owner",
    `DROP TRIGGER settlement_stamp ON settlement`,
    "forged decider",
  ],
  [
    "stamp: claims keep a forged time",
    "owner",
    `DROP TRIGGER claim_stamp ON claim`,
    "forged decider",
  ],

  // What an entry may be.
  [
    "rules: weekends allowed",
    "owner",
    `CREATE OR REPLACE FUNCTION is_working_day(d date) RETURNS boolean LANGUAGE sql AS 'SELECT true'`,
    "weekends",
  ],
  [
    "rules: anyone is billed on any day",
    "owner",
    `CREATE OR REPLACE FUNCTION person_billing(p_person uuid) RETURNS TABLE (role text, active_from date, active_to date) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT 'consumer'::text, '2000-01-01'::date, NULL::date $$`,
    "not billed that day",
  ],
  ["rules: entry shape unchecked", "owner", dropChecks("log_entry"), "shape of an entry"],
  ["rules: second leave allowed", "owner", `DROP INDEX log_one_leave`, "second leave"],
  ["rules: second switch allowed", "owner", `DROP INDEX log_one_switch`, "second leave"],
  ["rules: second Supplier Off allowed", "owner", `DROP INDEX log_one_off`, "second leave"],
  [
    "rules: payments without an amount",
    "owner",
    dropChecks("settlement"),
    "amount to record a payment",
  ],
  ["rules: disputes without a reason", "owner", dropChecks("claim_decision"), "reason to dispute"],

  // Closed months.
  [
    "closed: month lock removed",
    "owner",
    `DROP TRIGGER log_entry_stamp ON log_entry`,
    "closed month",
  ],
  [
    "closed: holidays unlocked",
    "owner",
    `DROP TRIGGER holiday_guard ON holiday`,
    "same lock to holidays",
  ],
  [
    "closed: closes ignored",
    "owner",
    `CREATE OR REPLACE FUNCTION month_closed(d date, pid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT false'`,
    "closed month",
  ],

  // Caps.
  [
    "caps: people cap removed",
    "owner",
    `DROP TRIGGER person_cap ON person`,
    "adding people past the cap",
  ],
  [
    "caps: record cap removed from log entries",
    "owner",
    `DROP TRIGGER log_entry_cap ON log_entry`,
    "every record against the cap",
  ],
  [
    "caps: record cap counts only what the caller can see",
    "owner",
    `ALTER FUNCTION enforce_row_cap() SECURITY INVOKER`,
    "every record against the cap",
  ],
  [
    "caps: the admin may change their own caps",
    "owner",
    `DROP TRIGGER workspace_keep_caps ON workspace`,
    "change its own caps",
  ],

  // The kitchen's own code for a person.
  [
    "key: two people may share a code",
    "owner",
    `DROP INDEX person_external_key`,
    "allows one person to a key",
  ],
  [
    "key: a name or an email can be a code",
    "owner",
    `ALTER TABLE person DROP CONSTRAINT person_external_key_form`,
    "keeps a key to a code",
  ],
  [
    "key: a code can be changed or cleared once set",
    "owner",
    `DROP TRIGGER person_keep_external_key ON person`,
    "keeps a key once it is set",
  ],
  [
    "key: anyone may record an import in the trail",
    "owner",
    `CREATE OR REPLACE FUNCTION record_person_import(p_detail jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN IF is_app_session() AND (SELECT read_only FROM workspace) THEN RAISE EXCEPTION 'ALIMENTATION_RULE: this workspace is read-only while it is moved' USING ERRCODE = 'P0001'; END IF; INSERT INTO audit_log (table_name, row_id, action, actor, via, before, after) VALUES ('person_import', coalesce(p_detail ->> 'fileHash', ''), 'IMPORT', app_person(), app_via(), NULL, p_detail); END $$`,
    "for the admin alone",
  ],
  [
    "key: an import is recorded while the workspace is moved",
    "owner",
    `CREATE OR REPLACE FUNCTION record_person_import(p_detail jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN IF is_app_session() AND app_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'only the admin can import people' USING ERRCODE = '42501'; END IF; INSERT INTO audit_log (table_name, row_id, action, actor, via, before, after) VALUES ('person_import', coalesce(p_detail ->> 'fileHash', ''), 'IMPORT', app_person(), app_via(), NULL, p_detail); END $$`,
    "nor an import recorded",
  ],
  [
    "key: the trail lets a member read an import",
    "owner",
    `CREATE POLICY audit_any_import ON audit_log FOR SELECT USING (table_name = 'person_import')`,
    "for the admin alone",
  ],

  // Personal data.
  [
    "pii: ciphertext check removed",
    "owner",
    `ALTER DOMAIN enc_blob DROP CONSTRAINT enc_blob_check`,
    "plain text in a personal column",
  ],
  [
    "pii: a plain-text name column appears",
    "owner",
    `ALTER TABLE person ADD COLUMN display_name text`,
    "unreviewed plain-text column",
  ],
  [
    "pii: a plain-text note column appears",
    "owner",
    `ALTER TABLE claim ADD COLUMN remark text`,
    "unreviewed plain-text column",
  ],
  [
    "pii: a personal column loses its type",
    "owner",
    `ALTER TABLE person ALTER COLUMN contact_enc TYPE bytea`,
    "typed as ciphertext",
  ],
  [
    "pii: audit trail stops recording people",
    "owner",
    `DROP TRIGGER person_audit ON person`,
    "audit trail as stored",
  ],
  [
    "pii: audit trail stops recording decisions",
    "owner",
    `DROP TRIGGER claim_decision_audit ON claim_decision`,
    "each kind of change",
  ],

  // Read-only while moving.
  [
    "frozen: the flag is ignored on log entries",
    "owner",
    `DROP TRIGGER log_entry_read_only ON log_entry`,
    "database itself",
  ],
  [
    "frozen: the flag is ignored on claims",
    "owner",
    `DROP TRIGGER claim_read_only ON claim`,
    "database itself",
  ],
  [
    "frozen: the flag is ignored on people",
    "owner",
    `DROP TRIGGER person_read_only ON person`,
    "database itself",
  ],
  [
    "frozen: the flag is ignored on the workspace row",
    "owner",
    `DROP TRIGGER workspace_read_only ON workspace`,
    "database itself",
  ],
  [
    "frozen: the guard never fires",
    "owner",
    `CREATE OR REPLACE FUNCTION guard_read_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
    "database itself",
  ],
  [
    "frozen: an automatic close ignores the flag",
    "owner",
    `UPDATE workspace SET read_only = false; CREATE OR REPLACE FUNCTION system_close_month(p_month date, p_consumer uuid, p_meals integer, p_billed bigint) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES (p_month, p_consumer, p_meals, p_billed, now()::date) ON CONFLICT DO NOTHING $$`,
    "automatic close",
  ],

  // Credentials and limits.
  [
    "creds: anyone may connect",
    "owner",
    `DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO PUBLIC', current_database()); END $$`,
    "another workspace",
  ],
  [
    "creds: application role may create tables",
    "owner",
    `GRANT CREATE ON SCHEMA public TO PUBLIC`,
    "build, empty",
  ],
  [
    "creds: helper functions open to everyone",
    "owner",
    `GRANT EXECUTE ON FUNCTION grant_to_app(text, regclass) TO PUBLIC`,
    "build, empty",
  ],
  ["creds: meta writable", "owner", asApp("GRANT UPDATE ON meta TO %I"), "build, empty"],
  [
    "creds: no connection limit",
    "admin",
    asApp("ALTER ROLE %I CONNECTION LIMIT -1"),
    "how many connections",
  ],
  [
    "creds: no statement timeout",
    "admin",
    asApp("ALTER ROLE %I IN DATABASE %I RESET statement_timeout", "current_database()"),
    "runs too long",
  ],

  // Who is asking, closing, time.
  [
    "actor: disabled people still resolve",
    "owner",
    `CREATE OR REPLACE FUNCTION resolve_actor(p_account uuid) RETURNS TABLE (person_id uuid, role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT id, role FROM person WHERE account_id = p_account $$`,
    "disabled person",
  ],
  ["actor: second account can bind", "owner", `DROP INDEX person_account_role`, "second account"],
  [
    "close: automatic close ignores the due date",
    "owner",
    `CREATE OR REPLACE FUNCTION workspace_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT '2999-01-01'::date $$`,
    "only once it is due",
  ],
  [
    "time: unknown zone accepted",
    "owner",
    `DROP TRIGGER workspace_time_zone_known ON workspace`,
    "time zone honest",
  ],

  // A kitchen without money, and the menu that every kitchen has.
  [
    "money: a kitchen without money accepts a price",
    "owner",
    `DROP TRIGGER rate_card_guard_money ON rate_card`,
    "refuses a price",
  ],
  [
    "money: a kitchen without money accepts a claim",
    "owner",
    `DROP TRIGGER claim_guard_money ON claim`,
    "refuses a claim, a decision",
  ],
  [
    "money: a kitchen without money accepts a decision",
    "owner",
    `DROP TRIGGER claim_decision_guard_money ON claim_decision`,
    "refuses a claim, a decision",
  ],
  [
    "money: a kitchen without money accepts a reversal",
    "owner",
    `DROP TRIGGER claim_reversal_guard_money ON claim_reversal`,
    "refuses a claim, a decision",
  ],
  [
    "money: a kitchen without money accepts a settlement",
    "owner",
    `DROP TRIGGER settlement_guard_money ON settlement`,
    "refuses a claim, a decision",
  ],
  [
    "money: the guard on money never fires",
    "owner",
    `CREATE OR REPLACE FUNCTION guard_money() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END $$`,
    "refuses a price",
  ],
  [
    "money: the kitchen always answers that it tracks money",
    "owner",
    `CREATE OR REPLACE FUNCTION money_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT true'`,
    "refuses a price",
  ],
  [
    "money: a close freezes an amount in a kitchen without money",
    "owner",
    `DROP TRIGGER month_close_guard_close ON month_close`,
    "only locks the month",
  ],
  [
    "money: a close with no amount is taken from a person in a kitchen with money",
    "owner",
    `CREATE OR REPLACE FUNCTION guard_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.billed IS NOT NULL AND NOT money_enabled() THEN RAISE EXCEPTION 'ALIMENTATION_RULE: this kitchen does not track money, so a close freezes no amount' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`,
    "freezes an amount when it closes",
  ],
  [
    "money: an automatic close freezes an amount in a kitchen without money",
    "owner",
    `CREATE OR REPLACE FUNCTION system_close_month(p_month date, p_consumer uuid, p_meals integer, p_billed bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ BEGIN ALTER TABLE month_close DISABLE TRIGGER month_close_guard_close; INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on) VALUES (p_month, p_consumer, p_meals, p_billed, now()::date) ON CONFLICT DO NOTHING; ALTER TABLE month_close ENABLE TRIGGER month_close_guard_close; END $$`,
    "by its own rule without an amount",
  ],
  [
    "money: whether a kitchen tracks money can be changed",
    "owner",
    `DROP TRIGGER workspace_keep_money_enabled ON workspace`,
    "refuses any change to it",
  ],
  [
    "money: the flag is guarded only against the application",
    "owner",
    `CREATE OR REPLACE FUNCTION keep_money_enabled() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF is_app_session() AND NEW.money_enabled IS DISTINCT FROM OLD.money_enabled THEN RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: whether a kitchen tracks money is chosen when it is made and cannot change' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END $$`,
    "refuses any change to it",
  ],
  ["menu: a menu can be edited", "owner", `DROP TRIGGER menu_append_only ON menu`, "never edited"],
  [
    "menu: the application role may edit a menu",
    "owner",
    asApp("GRANT UPDATE, DELETE ON menu TO %I"),
    "never edited",
  ],
  [
    "menu: consumers insert menus",
    "owner",
    `ALTER POLICY menu_admin_insert ON menu WITH CHECK (true)`,
    "never edited",
  ],
  [
    "menu: row security off on the menu",
    "owner",
    `ALTER TABLE menu DISABLE ROW LEVEL SECURITY`,
    "shows nobody anything",
  ],
  [
    "menu: the audit trail stops recording menus",
    "owner",
    `DROP TRIGGER menu_audit ON menu`,
    "shown in the trail",
  ],
  [
    "frozen: the flag is ignored on the menu",
    "owner",
    `DROP TRIGGER menu_read_only ON menu`,
    "cannot be written while the kitchen is being moved",
  ],

  // The catalogue and the services: what a kitchen serves, as data with stable ids.
  [
    "catalogue: service names unchecked",
    "owner",
    dropChecks("service"),
    "holds a name of one to forty",
  ],
  [
    "catalogue: item names, kinds, units and quantities unchecked",
    "owner",
    dropChecks("catalogue_item"),
    "holds a kind of meal or add-on",
  ],
  [
    "catalogue: two services may share a name",
    "owner",
    `DROP INDEX service_name`,
    "keeps a name once",
  ],
  [
    "catalogue: two items may share a name",
    "owner",
    `DROP INDEX catalogue_item_name`,
    "keeps a name once",
  ],
  [
    "catalogue: the kind, unit and largest quantity of an item can change",
    "owner",
    `DROP TRIGGER catalogue_item_keep_shape ON catalogue_item`,
    "keeps the kind, unit and largest quantity",
  ],
  [
    "catalogue: the kind of an item is checked by the owner only against the application",
    "owner",
    patch(
      "keep_item_shape()",
      "IF NEW.kind IS DISTINCT FROM OLD.kind OR",
      "IF is_app_session() AND NEW.kind IS DISTINCT FROM OLD.kind OR",
    ),
    "keeps the kind, unit and largest quantity",
  ],
  [
    "catalogue: the date an item was retired can move",
    "owner",
    `DROP TRIGGER catalogue_item_keep_archived_once ON catalogue_item`,
    "retires a service or an item once",
  ],
  [
    "catalogue: the date a service was retired can move",
    "owner",
    `DROP TRIGGER service_keep_archived_once ON service`,
    "retires a service or an item once",
  ],
  [
    "catalogue: consumers add services",
    "owner",
    `ALTER POLICY service_admin_insert ON service WITH CHECK (true)`,
    "lets the admin alone add or change a service",
  ],
  [
    "catalogue: consumers add items",
    "owner",
    `ALTER POLICY item_admin_insert ON catalogue_item WITH CHECK (true)`,
    "lets the admin alone add or change a service",
  ],
  [
    "catalogue: consumers rename services",
    "owner",
    `ALTER POLICY service_admin_update ON service USING (true) WITH CHECK (true)`,
    "lets the admin alone add or change a service",
  ],
  [
    "catalogue: consumers rename items",
    "owner",
    `ALTER POLICY item_admin_update ON catalogue_item USING (true) WITH CHECK (true)`,
    "lets the admin alone add or change a service",
  ],
  [
    "catalogue: row security off on services",
    "owner",
    `ALTER TABLE service DISABLE ROW LEVEL SECURITY`,
    "lets the admin alone add or change a service",
  ],
  [
    "catalogue: services deletable by the application role",
    "owner",
    asApp("GRANT DELETE ON service TO %I"),
    "nobody remove one",
  ],
  [
    "catalogue: items deletable by the application role",
    "owner",
    asApp("GRANT DELETE ON catalogue_item TO %I"),
    "nobody remove one",
  ],
  [
    "catalogue: the audit trail stops recording items",
    "owner",
    `DROP TRIGGER catalogue_item_audit ON catalogue_item`,
    "a rename that is written in the trail",
  ],
  [
    "catalogue: the audit trail stops recording services",
    "owner",
    `DROP TRIGGER service_audit ON service`,
    "every change of enrolment in the trail",
  ],
  readOnly("service"),
  readOnly("catalogue_item"),
  readOnly("person_service"),
  readOnly("menu_offer"),
  readOnly("menu_day"),
  readOnly("rate_price"),

  // Who takes which service.
  [
    "enrolment: a service can be taken twice at once",
    "owner",
    patch("stamp_person_service()", "IF EXISTS (", "IF false AND EXISTS ("),
    "refuses a service taken twice on one day",
  ],
  [
    "enrolment: the overlap stops one day early",
    "owner",
    patch(
      "stamp_person_service()",
      "x.active_from <= coalesce(NEW.active_to, far)",
      "x.active_from < coalesce(NEW.active_to, far)",
    ),
    "refuses a service taken twice on one day",
  ],
  [
    "enrolment: anyone can take a service",
    "owner",
    patch(
      "stamp_person_service()",
      "IS DISTINCT FROM 'consumer'",
      "IS DISTINCT FROM 'consumer' AND false",
    ),
    "is for consumers only",
  ],
  [
    "enrolment: no trigger",
    "owner",
    `DROP TRIGGER person_service_stamp ON person_service`,
    "refuses a service taken twice on one day",
  ],
  [
    "enrolment: who takes which service can change",
    "owner",
    patch(
      "stamp_person_service()",
      "NEW.person_id <> OLD.person_id OR",
      "false AND NEW.person_id <> OLD.person_id OR",
    ),
    "does not let who takes which service change",
  ],
  [
    "enrolment: the end may come before the start",
    "owner",
    dropChecks("person_service"),
    "refuses a span that ends before it starts",
  ],
  [
    "enrolment: closed months ignored",
    "owner",
    `CREATE OR REPLACE FUNCTION enrolment_locked(p_person uuid, lo date, hi date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT false'`,
    "is refused like a log entry",
  ],
  [
    "enrolment: a closed month locks one day too few",
    "owner",
    patch("enrolment_locked(uuid, date, date)", "c.for_month <= hi", "c.for_month < hi"),
    "is refused like a log entry",
  ],
  [
    "enrolment: the admin is held to a closed month even where the workspace only flags it",
    "owner",
    patch(
      "enrolment_locked(uuid, date, date)",
      "IS DISTINCT FROM 'admin' OR close_blocks_admin(c.for_month)",
      "IS DISTINCT FROM 'admin' OR true",
    ),
    "is allowed to the platform as the owner",
  ],
  [
    "enrolment: a change reaching a closed month through the end date is missed",
    "owner",
    patch(
      "stamp_person_service()",
      "IF NEW.active_to IS DISTINCT FROM OLD.active_to THEN",
      "IF false THEN",
    ),
    "refuses to end, move or remove a span",
  ],
  [
    "enrolment: a change reaching a closed month through the start date is missed",
    "owner",
    patch("stamp_person_service()", "IF NEW.active_from <> OLD.active_from THEN", "IF false THEN"),
    "refuses to end, move or remove a span",
  ],
  [
    "enrolment: removing a span in a closed month is allowed",
    "owner",
    patch(
      "stamp_person_service()",
      "ELSIF TG_OP = 'DELETE' THEN",
      "ELSIF TG_OP = 'DELETE' AND false THEN",
    ),
    "refuses to end, move or remove a span",
  ],
  [
    "enrolment: consumers read everyone's enrolment",
    "owner",
    `ALTER POLICY person_service_read ON person_service USING (app_role() IS NOT NULL)`,
    "shows a member only the services they take",
  ],
  [
    "enrolment: row security off",
    "owner",
    `ALTER TABLE person_service DISABLE ROW LEVEL SECURITY`,
    "shows a member only the services they take",
  ],
  [
    "enrolment: consumers write enrolment",
    "owner",
    `ALTER POLICY person_service_admin_write ON person_service USING (true) WITH CHECK (true)`,
    "is written by the admin alone",
  ],
  [
    "enrolment: the audit trail stops recording it",
    "owner",
    `DROP TRIGGER person_service_audit ON person_service`,
    "every change of enrolment in the trail",
  ],
  [
    "enrolment: members read the enrolment trail of others",
    "owner",
    `CREATE POLICY audit_any_enrolment ON audit_log FOR SELECT USING (table_name = 'person_service')`,
    "every change of enrolment in the trail",
  ],
  [
    "enrolment: the supplier cannot read the trail of what is served",
    "owner",
    `ALTER POLICY audit_supplier_read ON audit_log USING (app_role() = 'supplier' AND table_name IN ('log_entry', 'claim', 'claim_decision', 'claim_reversal', 'settlement', 'month_close', 'rate_card', 'menu', 'policy_version', 'holiday'))`,
    "every change of enrolment in the trail",
  ],

  // What a log entry may be, with a service and an item.
  [
    "log: an entry for a service the person does not take",
    "owner",
    patch(
      "stamp_log_entry()",
      "NOT enrolled_on(NEW.person_id",
      "false AND NOT enrolled_on(NEW.person_id",
    ),
    "does not take the service that day",
  ],
  [
    "log: enrolment starts a day late",
    "owner",
    patch("enrolled_on(uuid, uuid, date)", "active_from <= d", "active_from < d"),
    "does not take that service",
  ],
  [
    "log: enrolment ends a day early",
    "owner",
    patch("enrolled_on(uuid, uuid, date)", "d <= active_to", "d < active_to"),
    "does not take the service that day",
  ],
  [
    "log: an item retired on the day is still served",
    "owner",
    patch("stamp_log_entry()", "it.archived_on <= NEW.on_date", "it.archived_on < NEW.on_date"),
    "refuses an item from the day it is retired",
  ],
  [
    "log: a retired item is still served",
    "owner",
    patch(
      "stamp_log_entry()",
      "IF it.archived_on IS NOT NULL AND",
      "IF false AND it.archived_on IS NOT NULL AND",
    ),
    "refuses an item from the day it is retired",
  ],
  [
    "log: a quantity above the largest of the item",
    "owner",
    patch("stamp_log_entry()", "IF NEW.qty > it.max_qty THEN", "IF false THEN"),
    "refuses a quantity above the largest",
  ],
  [
    "log: the largest quantity is refused too",
    "owner",
    patch("stamp_log_entry()", "IF NEW.qty > it.max_qty THEN", "IF NEW.qty >= it.max_qty THEN"),
    "refuses a quantity above the largest",
  ],
  [
    "log: an item the menu does not offer",
    "owner",
    patch(
      "stamp_log_entry()",
      "IF NEW.service_id IS NOT NULL AND NOT EXISTS (",
      "IF false AND NOT EXISTS (",
    ),
    "refuses a switch or an extra the menu in force does not offer",
  ],
  [
    "log: the menu in force is the first and not the latest",
    "owner",
    patch(
      "stamp_log_entry()",
      "ORDER BY m.effective_from DESC LIMIT 1)",
      "ORDER BY m.effective_from ASC LIMIT 1)",
    ),
    "refuses a switch or an extra the menu in force does not offer",
  ],
  [
    "log: a whole day and a service both left",
    "owner",
    patch(
      "stamp_log_entry()",
      "      IF EXISTS (\n           SELECT 1 FROM log_entry x",
      "      IF false AND EXISTS (\n           SELECT 1 FROM log_entry x",
    ),
    "refuses a whole day and one of its services both left",
  ],
  [
    "log: a whole day and a service both left, one way round only",
    "owner",
    patch(
      "stamp_log_entry()",
      "AND (x.service_id IS NULL OR NEW.service_id IS NULL)",
      "AND (x.service_id IS NULL)",
    ),
    "refuses a whole day and one of its services both left",
  ],
  [
    "log: a whole day and a service both off, the kitchen",
    "owner",
    patch(
      "stamp_log_entry()",
      "IF NEW.action IN ('Leave', 'Supplier Off') THEN",
      "IF NEW.action IN ('Leave') THEN",
    ),
    "refuses a whole day and one of its services both left",
  ],
  [
    "log: an item of the wrong kind can be named",
    "owner",
    `ALTER TABLE log_entry DROP CONSTRAINT log_entry_item_id_item_kind_fkey`,
    "holds the kind of an item",
  ],
  [
    "log: a service that does not exist can be named",
    "owner",
    `ALTER TABLE log_entry DROP CONSTRAINT log_entry_service_id_fkey`,
    "holds the kind of an item",
  ],
  [
    "log: two whole-day leaves (a null service is taken to differ)",
    "owner",
    `DROP INDEX log_one_leave; CREATE UNIQUE INDEX log_one_leave ON log_entry (on_date, person_id, service_id) WHERE action = 'Leave'`,
    "allows one leave, one switch",
  ],
  [
    "log: two whole-day Supplier Offs (a null service is taken to differ)",
    "owner",
    `DROP INDEX log_one_off; CREATE UNIQUE INDEX log_one_off ON log_entry (on_date, service_id) WHERE action = 'Supplier Off'`,
    "allows one leave, one switch",
  ],
  [
    "log: a second switch in a service",
    "owner",
    `DROP INDEX log_one_switch`,
    "allows one leave, one switch",
  ],
  [
    "log: a second extra of an item in a service",
    "owner",
    `DROP INDEX log_one_extra`,
    "allows one leave, one switch",
  ],
  [
    "log: a switch needs no meal",
    "owner",
    `ALTER TABLE log_entry DROP CONSTRAINT log_entry_check3`,
    "keeps the shape of each action",
  ],
  [
    "log: the supplier writes more than a Supplier Off",
    "owner",
    `ALTER POLICY log_insert ON log_entry WITH CHECK (app_role() = 'admin' OR (app_role() = 'consumer' AND person_id = app_person() AND action <> 'Supplier Off') OR app_role() = 'supplier')`,
    "lets a consumer log only for themselves and the supplier only a Supplier Off",
  ],

  // The menu and the prices: written whole, never added to.
  [
    "menu: an offer can be added to an old menu",
    "owner",
    `DROP TRIGGER menu_offer_same_transaction ON menu_offer`,
    "takes the offers and days of a menu",
  ],
  [
    "menu: a day can be added to an old menu",
    "owner",
    `DROP TRIGGER menu_day_same_transaction ON menu_day`,
    "takes the offers and days of a menu",
  ],
  [
    "menu: a price can be added to an old card",
    "owner",
    `DROP TRIGGER rate_price_same_transaction ON rate_price`,
    "takes the prices of a card",
  ],
  [
    "menu: the transaction rule asks only that the parent exists",
    "owner",
    patch(
      "guard_same_transaction()",
      "IF made IS DISTINCT FROM now() THEN",
      "IF made IS NULL THEN",
    ),
    "takes the offers and days of a menu",
  ],
  [
    "menu: offers can be edited",
    "owner",
    `DROP TRIGGER menu_offer_append_only ON menu_offer`,
    "does not let the application role or the owner change",
  ],
  [
    "menu: days can be edited",
    "owner",
    `DROP TRIGGER menu_day_append_only ON menu_day`,
    "does not let the application role or the owner change",
  ],
  [
    "menu: prices can be edited",
    "owner",
    `DROP TRIGGER rate_price_append_only ON rate_price`,
    "does not let the application role or the owner change",
  ],
  [
    "menu: the application role may edit an offer",
    "owner",
    asApp("GRANT UPDATE, DELETE ON menu_offer TO %I"),
    "does not let the application role or the owner change",
  ],
  [
    "menu: the application role may edit a day",
    "owner",
    asApp("GRANT UPDATE, DELETE ON menu_day TO %I"),
    "does not let the application role or the owner change",
  ],
  [
    "menu: the application role may edit a price",
    "owner",
    asApp("GRANT UPDATE, DELETE ON rate_price TO %I"),
    "does not let the application role or the owner change",
  ],
  [
    "menu: a meal can be served by a service that does not offer it",
    "owner",
    `ALTER TABLE menu_day DROP CONSTRAINT menu_day_menu_id_service_id_meal_id_fkey`,
    "serves a meal only in a service that offers it",
  ],
  [
    "menu: an add-on can be served as the meal of the day",
    "owner",
    `ALTER TABLE menu_day DROP CONSTRAINT menu_day_meal_id_meal_kind_fkey`,
    "holds the kind of an item",
  ],
  [
    "menu: a weekday out of range",
    "owner",
    dropChecks("menu_day"),
    "serves a meal only in a service that offers it",
  ],
  [
    "menu: two meals on one weekday",
    "owner",
    `ALTER TABLE menu_day DROP CONSTRAINT menu_day_pkey`,
    "serves a meal only in a service that offers it",
  ],
  [
    "menu: two prices for an item in every service (a null service is taken to differ)",
    "owner",
    `ALTER TABLE rate_price DROP CONSTRAINT rate_price_card_id_item_id_service_id_key; ALTER TABLE rate_price ADD UNIQUE (card_id, item_id, service_id)`,
    "holds a price per item",
  ],
  [
    "menu: consumers add offers to a menu made in the same transaction",
    "owner",
    `ALTER POLICY menu_offer_admin_insert ON menu_offer WITH CHECK (true)`,
    "is written by the admin alone, even in the transaction",
  ],
  [
    "menu: consumers add days to a menu made in the same transaction",
    "owner",
    `ALTER POLICY menu_day_admin_insert ON menu_day WITH CHECK (true)`,
    "is written by the admin alone, even in the transaction",
  ],
  [
    "menu: consumers add prices to a card made in the same transaction",
    "owner",
    `ALTER POLICY rate_price_admin_insert ON rate_price WITH CHECK (true)`,
    "is written by the admin alone, even in the transaction",
  ],
  [
    "menu: row security off on offers",
    "owner",
    `ALTER TABLE menu_offer DISABLE ROW LEVEL SECURITY`,
    "shows nobody anything",
  ],
  [
    "menu: the audit trail stops recording offers",
    "owner",
    `DROP TRIGGER menu_offer_audit ON menu_offer`,
    "is in the trail, which a member and the supplier read",
  ],
  [
    "menu: the audit trail stops recording days",
    "owner",
    `DROP TRIGGER menu_day_audit ON menu_day`,
    "is in the trail, which a member and the supplier read",
  ],
  [
    "menu: the audit trail stops recording prices",
    "owner",
    `DROP TRIGGER rate_price_audit ON rate_price`,
    "is in the trail, which a member and the supplier read",
  ],
  [
    "money: a kitchen without money accepts a price on an item",
    "owner",
    `DROP TRIGGER rate_price_guard_money ON rate_price`,
    "refuses a price on an item",
  ],

  // Placement.
  ["migrate: runner without the lock", "owner", `SELECT 1`, null], // control: a no-op defect must NOT be caught
];

const filter = process.argv[2];
const picks = defects.filter(([n]) => !filter || n.includes(filter));
const out = [];
let bad = 0;
for (const [name, as, sql, expect] of picks) {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const file = join(dir, "r.json");
  const r = spawnSync(
    "bunx",
    [
      "vitest",
      "run",
      "apps/api/test/workspace.db.test.ts",
      "apps/api/test/workspace.guards.test.ts",
      "apps/api/test/workspace.money.test.ts",
      "apps/api/test/workspace.catalogue.test.ts",
      "--reporter=json",
      `--outputFile=${file}`,
    ],
    {
      env: { ...process.env, ALIMENTATION_DRIFT: JSON.stringify({ as, sql }) },
      encoding: "utf8",
    },
  );
  let failed = [];
  const setupBroke = false;
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    for (const f of j.testResults) {
      for (const t of f.assertionResults)
        if (t.status === "failed") failed.push(t.fullName ?? t.title);
      // A file that cannot even set itself up (the seed is refused by the defect) is caught by its message.
      if (f.status === "failed" && !f.assertionResults.some((t) => t.status === "failed"))
        failed.push(`(suite failed: ${String(f.message ?? "").slice(0, 300)})`);
    }
  } catch {
    failed = [`(no report: ${(r.stderr || "").slice(-200)})`];
  }
  rmSync(dir, { recursive: true, force: true });
  let verdict;
  if (expect === null)
    verdict =
      failed.length === 0
        ? "ok (control: nothing broken, nothing failed)"
        : "WRONG (control failed)";
  else if (failed.length === 0) verdict = "MISSED";
  else if (setupBroke && !failed.some((f) => !f.startsWith("(suite failed")))
    verdict = `DEFECT DID NOT APPLY: ${failed[0]}`;
  else if (failed.some((f) => f.toLowerCase().includes(expect.toLowerCase())))
    verdict = failed.length > 12 ? `caught (but broadly: ${failed.length} failures)` : "caught";
  else verdict = `CAUGHT BY THE WRONG TEST: ${failed.slice(0, 2).join(" | ")}`;
  if (!verdict.startsWith("caught") && !verdict.startsWith("ok")) bad++;
  out.push(`${verdict.padEnd(10).slice(0, 60)}  ${name}`);
  console.log(out.at(-1));
}
console.log(`\n${picks.length} defects, ${bad} not caught by their own test`);
process.exit(bad ? 1 : 0);
