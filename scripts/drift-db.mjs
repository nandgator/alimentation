// Drift testing for the database guards. Each defect below removes or loosens one
// guard in a freshly provisioned workspace; the database tests are then run and the
// test written for that guard must fail. A defect no test notices is a guard
// nobody is checking.
//
//   node scripts/drift-db.mjs            run every defect
//   node scripts/drift-db.mjs rls        run those whose name contains "rls"
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = `(SELECT value FROM meta WHERE key = 'app_role')`;
const dropChecks = (table) => `DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = '${table}'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', c.conname);
  END LOOP; END $$`;
const asApp = (template, ...more) =>
  `DO $$ BEGIN EXECUTE format('${template}', ${APP}${more.length ? ', ' + more.join(', ') : ''}); END $$`;

// [name, as, sql, a fragment of the name of the test that must fail]
const defects = [
  // Row-level security: who may read what.
  [
    'rls: consumers read every person',
    'owner',
    `ALTER POLICY person_read ON person USING (true)`,
    'only themselves',
  ],
  [
    'rls: consumers read every log entry',
    'owner',
    `ALTER POLICY log_read ON log_entry USING (app_role() IS NOT NULL)`,
    'their own entries',
  ],
  [
    'rls: log readable with no role set (the leak found in review)',
    'owner',
    `ALTER POLICY log_read ON log_entry USING (app_role() IN ('admin','supplier') OR person_id = app_person() OR all_consumers)`,
    'shows nobody anything',
  ],
  [
    'rls: consumers read every claim',
    'owner',
    `ALTER POLICY claim_read ON claim USING (true)`,
    'only their own claims',
  ],
  [
    'rls: consumers read every decision',
    'owner',
    `ALTER POLICY decision_read ON claim_decision USING (true)`,
    'only their own claims',
  ],
  [
    'rls: consumers read every settlement',
    'owner',
    `ALTER POLICY settlement_read ON settlement USING (true)`,
    'only their own claims',
  ],
  [
    'rls: consumers read every close',
    'owner',
    `ALTER POLICY close_read ON month_close USING (true)`,
    'only their own claims',
  ],
  [
    'rls: consumers read the audit trail',
    'owner',
    `ALTER POLICY audit_admin_read ON audit_log USING (true)`,
    'shows the supplier every consumer',
  ],
  [
    'rls: row security off on person',
    'owner',
    `ALTER TABLE person DISABLE ROW LEVEL SECURITY`,
    'only themselves',
  ],
  [
    'rls: row security off on claim',
    'owner',
    `ALTER TABLE claim DISABLE ROW LEVEL SECURITY`,
    'only their own claims',
  ],
  [
    'rls: consumers write for anyone',
    'owner',
    `ALTER POLICY log_insert ON log_entry WITH CHECK (true)`,
    'stops a consumer writing',
  ],
  [
    'rls: anyone decides claims',
    'owner',
    `ALTER POLICY decision_supplier_insert ON claim_decision WITH CHECK (true)`,
    'stops a consumer writing',
  ],
  [
    'rls: consumers insert prices',
    'owner',
    `ALTER POLICY rate_card_admin_insert ON rate_card WITH CHECK (true)`,
    'stops a consumer changing prices',
  ],
  [
    'rls: consumers insert settlements',
    'owner',
    `ALTER POLICY settlement_admin_insert ON settlement WITH CHECK (true)`,
    'stops a consumer changing prices',
  ],
  [
    'rls: consumers edit people',
    'owner',
    `ALTER POLICY person_admin_update ON person USING (true) WITH CHECK (true)`,
    'stops a consumer changing prices',
  ],
  [
    'rls: decided claims can be withdrawn',
    'owner',
    `ALTER POLICY claim_delete ON claim USING (true)`,
    'only until it is decided',
  ],
  [
    'rls: row security bypassed by the application role',
    'admin',
    asApp('ALTER ROLE %I BYPASSRLS'),
    'only themselves',
  ],

  // Append-only: decisions, settlements, prices, rules, the audit trail.
  [
    'append-only: decisions updatable by the application role',
    'owner',
    asApp('GRANT UPDATE, DELETE ON claim_decision TO %I'),
    'no right to change or remove',
  ],
  [
    'append-only: settlements deletable by the application role',
    'owner',
    asApp('GRANT DELETE ON settlement TO %I'),
    'no right to change or remove',
  ],
  [
    'append-only: prices updatable by the application role',
    'owner',
    asApp('GRANT UPDATE ON rate_card TO %I'),
    'no right to change or remove',
  ],
  [
    'append-only: audit trail writable by the application role',
    'owner',
    asApp('GRANT UPDATE, DELETE ON audit_log TO %I'),
    'no right to change or remove',
  ],
  [
    'append-only: no trigger on decisions',
    'owner',
    `DROP TRIGGER claim_decision_append_only ON claim_decision`,
    'by trigger',
  ],
  [
    'append-only: no trigger on settlements',
    'owner',
    `DROP TRIGGER settlement_append_only ON settlement`,
    'by trigger',
  ],
  [
    'append-only: no trigger on prices',
    'owner',
    `DROP TRIGGER rate_card_append_only ON rate_card`,
    'by trigger',
  ],
  [
    'append-only: no trigger on the audit trail',
    'owner',
    `DROP TRIGGER audit_log_append_only ON audit_log`,
    'by trigger',
  ],
  [
    'append-only: a second decision is allowed',
    'owner',
    `ALTER TABLE claim_reversal DROP CONSTRAINT claim_reversal_claim_id_fkey; ALTER TABLE claim_decision DROP CONSTRAINT claim_decision_pkey`,
    'decide a claim once',
  ],
  [
    'append-only: reversal not unique',
    'owner',
    `ALTER TABLE claim_reversal DROP CONSTRAINT claim_reversal_pkey`,
    'only the admin reverse',
  ],
  [
    'append-only: decided claims deletable by the owner (no foreign key)',
    'owner',
    `ALTER TABLE claim_decision DROP CONSTRAINT claim_decision_claim_id_fkey`,
    'only until it is decided',
  ],

  // Who did it, and when.
  [
    'stamp: log entries keep a forged author',
    'owner',
    `DROP TRIGGER log_entry_stamp ON log_entry`,
    'forged author',
  ],
  [
    'stamp: decisions keep a forged decider',
    'owner',
    `DROP TRIGGER claim_decision_stamp ON claim_decision`,
    'forged decider',
  ],
  [
    'stamp: settlements keep a forged recorder',
    'owner',
    `DROP TRIGGER settlement_stamp ON settlement`,
    'forged decider',
  ],
  [
    'stamp: claims keep a forged time',
    'owner',
    `DROP TRIGGER claim_stamp ON claim`,
    'forged decider',
  ],

  // What an entry may be.
  [
    'rules: weekends allowed',
    'owner',
    `CREATE OR REPLACE FUNCTION is_working_day(d date) RETURNS boolean LANGUAGE sql AS 'SELECT true'`,
    'weekends',
  ],
  [
    'rules: anyone is billed on any day',
    'owner',
    `CREATE OR REPLACE FUNCTION person_billing(p_person uuid) RETURNS TABLE (role text, active_from date, active_to date) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT 'consumer'::text, '2000-01-01'::date, NULL::date $$`,
    'not billed that day',
  ],
  ['rules: entry shape unchecked', 'owner', dropChecks('log_entry'), 'shape of an entry'],
  ['rules: second leave allowed', 'owner', `DROP INDEX log_entry_one_leave`, 'second leave'],
  ['rules: second switch allowed', 'owner', `DROP INDEX log_entry_one_switch`, 'second leave'],
  [
    'rules: second Supplier Off allowed',
    'owner',
    `DROP INDEX log_entry_one_supplier_off`,
    'second leave',
  ],
  [
    'rules: payments without an amount',
    'owner',
    dropChecks('settlement'),
    'amount to record a payment',
  ],
  ['rules: disputes without a reason', 'owner', dropChecks('claim_decision'), 'reason to dispute'],

  // Closed months.
  [
    'closed: month lock removed',
    'owner',
    `DROP TRIGGER log_entry_stamp ON log_entry`,
    'closed month',
  ],
  [
    'closed: holidays unlocked',
    'owner',
    `DROP TRIGGER holiday_guard ON holiday`,
    'same lock to holidays',
  ],
  [
    'closed: closes ignored',
    'owner',
    `CREATE OR REPLACE FUNCTION month_closed(d date, pid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT false'`,
    'closed month',
  ],

  // Caps.
  [
    'caps: people cap removed',
    'owner',
    `DROP TRIGGER person_cap ON person`,
    'adding people past the cap',
  ],
  [
    'caps: record cap removed from log entries',
    'owner',
    `DROP TRIGGER log_entry_cap ON log_entry`,
    'every record against the cap',
  ],
  [
    'caps: record cap counts only what the caller can see',
    'owner',
    `ALTER FUNCTION enforce_row_cap() SECURITY INVOKER`,
    'every record against the cap',
  ],

  // Personal data.
  [
    'pii: ciphertext check removed',
    'owner',
    `ALTER DOMAIN enc_blob DROP CONSTRAINT enc_blob_check`,
    'plain text in a personal column',
  ],
  [
    'pii: a plain-text name column appears',
    'owner',
    `ALTER TABLE person ADD COLUMN display_name text`,
    'unreviewed plain-text column',
  ],
  [
    'pii: a plain-text note column appears',
    'owner',
    `ALTER TABLE claim ADD COLUMN remark text`,
    'unreviewed plain-text column',
  ],
  [
    'pii: a personal column loses its type',
    'owner',
    `ALTER TABLE person ALTER COLUMN contact_enc TYPE bytea`,
    'typed as ciphertext',
  ],
  [
    'pii: audit trail stops recording people',
    'owner',
    `DROP TRIGGER person_audit ON person`,
    'audit trail as stored',
  ],
  [
    'pii: audit trail stops recording decisions',
    'owner',
    `DROP TRIGGER claim_decision_audit ON claim_decision`,
    'each kind of change',
  ],

  // Credentials and limits.
  [
    'creds: anyone may connect',
    'owner',
    `DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO PUBLIC', current_database()); END $$`,
    'another workspace',
  ],
  [
    'creds: application role may create tables',
    'owner',
    `GRANT CREATE ON SCHEMA public TO PUBLIC`,
    'build, empty',
  ],
  [
    'creds: helper functions open to everyone',
    'owner',
    `GRANT EXECUTE ON FUNCTION grant_to_app(text, regclass) TO PUBLIC`,
    'build, empty',
  ],
  ['creds: meta writable', 'owner', asApp('GRANT UPDATE ON meta TO %I'), 'build, empty'],
  [
    'creds: no connection limit',
    'admin',
    asApp('ALTER ROLE %I CONNECTION LIMIT -1'),
    'how many connections',
  ],
  [
    'creds: no statement timeout',
    'admin',
    asApp('ALTER ROLE %I IN DATABASE %I RESET statement_timeout', 'current_database()'),
    'runs too long',
  ],

  // Who is asking, closing, time.
  [
    'actor: disabled people still resolve',
    'owner',
    `CREATE OR REPLACE FUNCTION resolve_actor(p_account uuid) RETURNS TABLE (person_id uuid, role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT id, role FROM person WHERE account_id = p_account $$`,
    'disabled person',
  ],
  [
    'actor: second account can bind',
    'owner',
    `ALTER TABLE person DROP CONSTRAINT person_account_id_key`,
    'second account',
  ],
  [
    'close: automatic close ignores the due date',
    'owner',
    `CREATE OR REPLACE FUNCTION workspace_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT '2999-01-01'::date $$`,
    'only once it is due',
  ],
  [
    'time: unknown zone accepted',
    'owner',
    `DROP TRIGGER workspace_time_zone_known ON workspace`,
    'time zone honest',
  ],

  // Placement.
  ['migrate: runner without the lock', 'owner', `SELECT 1`, null], // control: a no-op defect must NOT be caught
];

const filter = process.argv[2];
const picks = defects.filter(([n]) => !filter || n.includes(filter));
const out = [];
let bad = 0;
for (const [name, as, sql, expect] of picks) {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  const file = join(dir, 'r.json');
  const r = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      'apps/api/test/workspace.db.test.ts',
      'apps/api/test/workspace.guards.test.ts',
      '--reporter=json',
      `--outputFile=${file}`,
    ],
    {
      env: { ...process.env, ALIMENTATION_DRIFT: JSON.stringify({ as, sql }) },
      encoding: 'utf8',
    },
  );
  let failed = [];
  let setupBroke = false;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    for (const f of j.testResults)
      for (const t of f.assertionResults)
        if (t.status === 'failed') failed.push(t.fullName ?? t.title);
  } catch {
    failed = ['(no report: ' + (r.stderr || '').slice(-200) + ')'];
  }
  rmSync(dir, { recursive: true, force: true });
  let verdict;
  if (expect === null)
    verdict =
      failed.length === 0
        ? 'ok (control: nothing broken, nothing failed)'
        : 'WRONG (control failed)';
  else if (failed.length === 0) verdict = 'MISSED';
  else if (setupBroke && !failed.some((f) => !f.startsWith('(suite failed')))
    verdict = 'DEFECT DID NOT APPLY: ' + failed[0];
  else if (failed.some((f) => f.toLowerCase().includes(expect.toLowerCase())))
    verdict =
      failed.length > 12 ? 'caught (but broadly: ' + failed.length + ' failures)' : 'caught';
  else verdict = 'CAUGHT BY THE WRONG TEST: ' + failed.slice(0, 2).join(' | ');
  if (!verdict.startsWith('caught') && !verdict.startsWith('ok')) bad++;
  out.push(`${verdict.padEnd(10).slice(0, 60)}  ${name}`);
  console.log(out.at(-1));
}
console.log(`\n${picks.length} defects, ${bad} not caught by their own test`);
process.exit(bad ? 1 : 0);
