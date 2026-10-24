-- Workspace database, version 1.
--
-- One workspace per database. The role that runs this file owns every object. The
-- application role (named in meta.app_role by the provisioner before this runs)
-- owns nothing and bypasses nothing: row-level security applies to it, and it has
-- only the privileges granted at the end of this file.
--
-- The server states who is asking by setting, inside each transaction:
--   app.role       'admin' | 'supplier' | 'consumer'
--   app.person_id  the person's id
-- With neither set, the policies below match no rows.

CREATE TABLE meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- The provisioner records the application role's name here (not in a setting the
-- role could change itself) so that triggers can tell the application from the
-- owner, who imports and wipes.
INSERT INTO meta (key, value) VALUES ('app_role', current_setting('alimentation.app_role'));

-- session_user, not current_user: inside a SECURITY DEFINER function current_user is
-- the function's owner, which would make the application look like the owner.
CREATE FUNCTION is_app_session() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT session_user = (SELECT value FROM meta WHERE key = 'app_role') $$;

CREATE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

CREATE FUNCTION app_person() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

-- Personal data is stored only as ciphertext produced by the application:
-- version byte 1, 12 byte nonce, ciphertext, 16 byte tag. Anything shorter or
-- differently versioned (such as plain text by mistake) is refused.
CREATE DOMAIN enc_blob AS bytea
  CHECK (octet_length(VALUE) >= 29 AND get_byte(VALUE, 0) = 1);

-- Money is whole paise.
CREATE DOMAIN paise AS bigint
  CHECK (VALUE >= 0 AND VALUE <= 10000000000);

CREATE TABLE workspace (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  time_zone  text NOT NULL DEFAULT 'Asia/Kolkata',
  currency   char(3) NOT NULL DEFAULT 'INR',
  -- Null means no cap (a dedicated workspace). The platform sets these on free ones.
  -- Set while the workspace is being moved. Enforced here, in the database, so no
  -- instance holding a stale idea of the workspace can write after the snapshot.
  read_only  boolean NOT NULL DEFAULT false,
  people_cap integer CHECK (people_cap IS NULL OR people_cap >= 0),
  row_cap    integer CHECK (row_cap IS NULL OR row_cap >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION workspace_time_zone_known() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: unknown time zone %', NEW.time_zone USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_time_zone_known BEFORE INSERT OR UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION workspace_time_zone_known();

CREATE FUNCTION workspace_today() RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT (now() AT TIME ZONE (SELECT time_zone FROM workspace))::date $$;

CREATE TABLE person (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  -- The sign-in account (held by the platform) this person logs in as.
  account_id  uuid,
  role        text NOT NULL CHECK (role IN ('admin', 'supplier', 'consumer')),
  name_enc    enc_blob NOT NULL,
  contact_enc enc_blob,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  active_from date,
  active_to   date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'consumer' OR (active_from IS NULL AND active_to IS NULL)),
  CHECK (active_to IS NULL OR (active_from IS NOT NULL AND active_to >= active_from))
);

-- One login can hold one role of each kind, so the owner of a kitchen who is also
-- its supplier is two people here, both reached from one sign-in.
CREATE UNIQUE INDEX person_account_role ON person (account_id, role) WHERE account_id IS NOT NULL;

-- Rules and prices are appended and never edited, so past months cannot change.
CREATE TABLE policy_version (
  effective_from date PRIMARY KEY,
  doc            jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);

CREATE TABLE rate_card (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  effective_from  date NOT NULL UNIQUE,
  veg             paise NOT NULL,
  non_veg         paise NOT NULL,
  extra_chapati   paise NOT NULL,
  extra_bhakri    paise NOT NULL,
  extras_per_month paise NOT NULL,
  menu_sun text CHECK (menu_sun IN ('Veg', 'Non Veg')),
  menu_mon text CHECK (menu_mon IN ('Veg', 'Non Veg')),
  menu_tue text CHECK (menu_tue IN ('Veg', 'Non Veg')),
  menu_wed text CHECK (menu_wed IN ('Veg', 'Non Veg')),
  menu_thu text CHECK (menu_thu IN ('Veg', 'Non Veg')),
  menu_fri text CHECK (menu_fri IN ('Veg', 'Non Veg')),
  menu_sat text CHECK (menu_sat IN ('Veg', 'Non Veg')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE holiday (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  on_date    date NOT NULL,
  location   text,
  confirmed  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX holiday_on_date ON holiday (on_date);

CREATE TABLE log_entry (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  on_date       date NOT NULL,
  person_id     uuid REFERENCES person (id),
  all_consumers boolean NOT NULL DEFAULT false,
  change        text NOT NULL CHECK (change IN
                  ('Leave', 'Switch to Veg', 'Switch to Non Veg', 'Extra Chapati', 'Extra Bhakri', 'Supplier Off')),
  qty           integer CHECK (qty IS NULL OR qty BETWEEN 1 AND 20),
  note_enc      enc_blob,
  logged_by     uuid NOT NULL REFERENCES person (id),
  logged_at     timestamptz NOT NULL DEFAULT now(),
  -- Supplier Off is for everyone and for no one in particular; all else is for one person.
  CHECK ((change = 'Supplier Off') = all_consumers),
  CHECK ((person_id IS NULL) = all_consumers),
  CHECK ((change IN ('Extra Chapati', 'Extra Bhakri')) = (qty IS NOT NULL))
);
CREATE INDEX log_entry_person_date ON log_entry (person_id, on_date);
CREATE INDEX log_entry_date ON log_entry (on_date);
CREATE UNIQUE INDEX log_entry_one_leave ON log_entry (on_date, person_id) WHERE change = 'Leave';
CREATE UNIQUE INDEX log_entry_one_supplier_off ON log_entry (on_date) WHERE change = 'Supplier Off';
CREATE UNIQUE INDEX log_entry_one_switch ON log_entry (on_date, person_id, change)
  WHERE change IN ('Switch to Veg', 'Switch to Non Veg');

CREATE TABLE claim (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  consumer_id uuid NOT NULL REFERENCES person (id),
  paid_at     timestamptz NOT NULL,
  for_month   date NOT NULL CHECK (extract(day FROM for_month) = 1),
  amount      paise NOT NULL CHECK (amount > 0),
  method      text NOT NULL CHECK (method IN ('UPI', 'Cash', 'Bank transfer', 'Other')),
  ref_note_enc enc_blob,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_consumer_month ON claim (consumer_id, for_month);

-- One decision per claim, and the first is final: the primary key is the claim.
CREATE TABLE claim_decision (
  claim_id   uuid PRIMARY KEY REFERENCES claim (id),
  decision   text NOT NULL CHECK (decision IN ('Confirmed', 'Disputed')),
  note_enc   enc_blob,
  decided_by uuid NOT NULL REFERENCES person (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'Disputed' OR note_enc IS NOT NULL)
);

-- Only the admin can undo a decision, and says why. The decision row itself stays.
CREATE TABLE claim_reversal (
  claim_id    uuid PRIMARY KEY REFERENCES claim_decision (claim_id),
  reason_enc  enc_blob NOT NULL,
  reversed_by uuid NOT NULL REFERENCES person (id),
  reversed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  on_date     date NOT NULL,
  consumer_id uuid NOT NULL REFERENCES person (id),
  for_month   date NOT NULL CHECK (extract(day FROM for_month) = 1),
  type        text NOT NULL CHECK (type IN ('Payment', 'Query', 'Query Resolved')),
  amount      paise,
  note_enc    enc_blob,
  recorded_by uuid NOT NULL REFERENCES person (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'Payment') = (amount IS NOT NULL AND amount > 0))
);
CREATE INDEX settlement_consumer_month ON settlement (consumer_id, for_month);

CREATE TABLE month_close (
  for_month   date NOT NULL CHECK (extract(day FROM for_month) = 1),
  consumer_id uuid NOT NULL REFERENCES person (id),
  meals       integer NOT NULL CHECK (meals >= 0),
  billed      paise NOT NULL,
  closed_on   date NOT NULL,
  -- Null when the workspace's automatic rule closed it.
  closed_by   uuid REFERENCES person (id),
  PRIMARY KEY (for_month, consumer_id)
);

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  row_id     text NOT NULL,
  action     text NOT NULL,
  actor      uuid,
  at         timestamptz NOT NULL DEFAULT now(),
  -- Rows as they were and are. Personal columns are ciphertext, so this is too.
  before     jsonb,
  after      jsonb
);

-- ---------------------------------------------------------------------------
-- Rules that hold whoever is writing.

CREATE FUNCTION policy_on(d date) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(
      (SELECT doc FROM policy_version WHERE effective_from <= d ORDER BY effective_from DESC LIMIT 1),
      '{"workingDays":[1,2,3,4,5],"monthClose":{"mode":"manual","afterClose":"flag"}}'::jsonb)
  $$;

CREATE FUNCTION is_working_day(d date) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT (policy_on(date_trunc('month', d)::date) -> 'workingDays') @> to_jsonb(extract(dow FROM d)::int)
  $$;

-- Whether a stored close exists, and the workspace does not run without closing.
CREATE FUNCTION month_closed(d date, pid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT (policy_on(date_trunc('month', d)::date) -> 'monthClose' ->> 'mode') IS DISTINCT FROM 'off'
       AND EXISTS (
         SELECT 1 FROM month_close
          WHERE for_month = date_trunc('month', d)::date
            AND (pid IS NULL OR consumer_id = pid))
  $$;

-- The admin may still edit a closed month unless the workspace blocks changes after close.
CREATE FUNCTION close_blocks_admin(d date) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT (policy_on(date_trunc('month', d)::date) -> 'monthClose' ->> 'afterClose') = 'block' $$;

CREATE FUNCTION forbid_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: % is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER rate_card_append_only BEFORE UPDATE OR DELETE ON rate_card
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER policy_version_append_only BEFORE UPDATE OR DELETE ON policy_version
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER claim_decision_append_only BEFORE UPDATE OR DELETE ON claim_decision
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER claim_reversal_append_only BEFORE UPDATE OR DELETE ON claim_reversal
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER settlement_append_only BEFORE UPDATE OR DELETE ON settlement
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Who did it, and when, is the server's word and never the caller's. The owner
-- (importing a moved workspace) keeps what the file says.
CREATE FUNCTION person_billing(p_person uuid) RETURNS TABLE (role text, active_from date, active_to date)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT role, active_from, active_to FROM person WHERE id = p_person $$;

CREATE FUNCTION stamp_log_entry() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  who record;
BEGIN
  IF TG_OP = 'INSERT' AND is_app_session() THEN
    NEW.logged_by := app_person();
    NEW.logged_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.logged_by <> OLD.logged_by OR NEW.logged_at <> OLD.logged_at) THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: who logged an entry, and when, cannot change' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NOT is_working_day(NEW.on_date) THEN
      RAISE EXCEPTION 'ALIMENTATION_RULE: % is not a working day', NEW.on_date USING ERRCODE = 'P0001';
    END IF;
    IF NEW.person_id IS NOT NULL THEN
      SELECT * INTO who FROM person_billing(NEW.person_id);
      IF who.role IS DISTINCT FROM 'consumer' THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: only consumers are billed' USING ERRCODE = 'P0001';
      END IF;
      IF who.active_from IS NULL OR NEW.on_date < who.active_from
         OR (who.active_to IS NOT NULL AND NEW.on_date > who.active_to) THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: that person is not billed on %', NEW.on_date USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- A closed month is closed to everyone but the admin, and to the admin too where
  -- the workspace says so.
  IF is_app_session() THEN
    IF month_closed(CASE WHEN TG_OP = 'DELETE' THEN OLD.on_date ELSE NEW.on_date END,
                    CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END)
       AND (app_role() <> 'admin'
            OR close_blocks_admin(CASE WHEN TG_OP = 'DELETE' THEN OLD.on_date ELSE NEW.on_date END)) THEN
      RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER log_entry_stamp BEFORE INSERT OR UPDATE OR DELETE ON log_entry
  FOR EACH ROW EXECUTE FUNCTION stamp_log_entry();

CREATE FUNCTION stamp_decision() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF is_app_session() THEN
    NEW.decided_by := app_person();
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER claim_decision_stamp BEFORE INSERT ON claim_decision
  FOR EACH ROW EXECUTE FUNCTION stamp_decision();

CREATE FUNCTION stamp_reversal() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF is_app_session() THEN
    NEW.reversed_by := app_person();
    NEW.reversed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER claim_reversal_stamp BEFORE INSERT ON claim_reversal
  FOR EACH ROW EXECUTE FUNCTION stamp_reversal();

CREATE FUNCTION stamp_settlement() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF is_app_session() THEN
    NEW.recorded_by := app_person();
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_stamp BEFORE INSERT ON settlement
  FOR EACH ROW EXECUTE FUNCTION stamp_settlement();

CREATE FUNCTION stamp_claim() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF is_app_session() THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER claim_stamp BEFORE INSERT ON claim
  FOR EACH ROW EXECUTE FUNCTION stamp_claim();

-- A holiday in a closed month changes bills, so the same lock applies.
CREATE FUNCTION guard_holiday() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  d date := CASE WHEN TG_OP = 'DELETE' THEN OLD.on_date ELSE NEW.on_date END;
BEGIN
  IF is_app_session() AND month_closed(d, NULL) AND close_blocks_admin(d) THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER holiday_guard BEFORE INSERT OR UPDATE OR DELETE ON holiday
  FOR EACH ROW EXECUTE FUNCTION guard_holiday();

-- ---------------------------------------------------------------------------
-- Read-only. While a workspace is being moved, the application role can read and
-- nothing else. Statement-level, so it fires even when no row would change.

CREATE FUNCTION guard_read_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF is_app_session() AND (SELECT read_only FROM workspace) THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: this workspace is read-only while it is moved' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER workspace_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON workspace
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER person_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON person
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER policy_version_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON policy_version
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER rate_card_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON rate_card
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER holiday_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON holiday
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER log_entry_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON log_entry
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER claim_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON claim
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER claim_decision_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON claim_decision
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER claim_reversal_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON claim_reversal
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER settlement_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON settlement
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER month_close_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON month_close
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();

-- ---------------------------------------------------------------------------
-- Caps. Null means none. A free workspace has them; a dedicated one does not.

CREATE FUNCTION enforce_people_cap() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cap integer;
BEGIN
  SELECT people_cap INTO cap FROM workspace;
  IF cap IS NOT NULL AND (SELECT count(*) FROM person) >= cap THEN
    RAISE EXCEPTION 'ALIMENTATION_QUOTA: this workspace is at its limit of % people', cap USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_cap BEFORE INSERT ON person
  FOR EACH ROW EXECUTE FUNCTION enforce_people_cap();

CREATE FUNCTION enforce_row_cap() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cap integer;
BEGIN
  SELECT row_cap INTO cap FROM workspace;
  IF cap IS NOT NULL AND
     (SELECT (SELECT count(*) FROM log_entry) + (SELECT count(*) FROM claim)
           + (SELECT count(*) FROM settlement) + (SELECT count(*) FROM claim_decision)) >= cap THEN
    RAISE EXCEPTION 'ALIMENTATION_QUOTA: this workspace is at its limit of % records', cap USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER log_entry_cap BEFORE INSERT ON log_entry FOR EACH ROW EXECUTE FUNCTION enforce_row_cap();
CREATE TRIGGER claim_cap BEFORE INSERT ON claim FOR EACH ROW EXECUTE FUNCTION enforce_row_cap();
CREATE TRIGGER settlement_cap BEFORE INSERT ON settlement FOR EACH ROW EXECUTE FUNCTION enforce_row_cap();
CREATE TRIGGER claim_decision_cap BEFORE INSERT ON claim_decision FOR EACH ROW EXECUTE FUNCTION enforce_row_cap();

-- ---------------------------------------------------------------------------
-- Audit trail: every change to the records people care about, written by the
-- database so no code path can forget. SECURITY DEFINER because the application
-- role may not write the table directly.

CREATE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  src jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  rid text;
BEGIN
  SELECT string_agg(src ->> k, '|' ORDER BY ord) INTO rid
    FROM unnest(string_to_array(TG_ARGV[0], ',')) WITH ORDINALITY AS t(k, ord);
  INSERT INTO audit_log (table_name, row_id, action, actor, before, after)
  VALUES (TG_TABLE_NAME, rid, TG_OP, app_person(),
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN NULL;
END $$;

CREATE TRIGGER workspace_audit AFTER INSERT OR UPDATE OR DELETE ON workspace
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER person_audit AFTER INSERT OR UPDATE OR DELETE ON person
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER policy_version_audit AFTER INSERT OR UPDATE OR DELETE ON policy_version
  FOR EACH ROW EXECUTE FUNCTION audit_row('effective_from');
CREATE TRIGGER rate_card_audit AFTER INSERT OR UPDATE OR DELETE ON rate_card
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER holiday_audit AFTER INSERT OR UPDATE OR DELETE ON holiday
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER log_entry_audit AFTER INSERT OR UPDATE OR DELETE ON log_entry
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER claim_audit AFTER INSERT OR UPDATE OR DELETE ON claim
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER claim_decision_audit AFTER INSERT OR UPDATE OR DELETE ON claim_decision
  FOR EACH ROW EXECUTE FUNCTION audit_row('claim_id');
CREATE TRIGGER claim_reversal_audit AFTER INSERT OR UPDATE OR DELETE ON claim_reversal
  FOR EACH ROW EXECUTE FUNCTION audit_row('claim_id');
CREATE TRIGGER settlement_audit AFTER INSERT OR UPDATE OR DELETE ON settlement
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER month_close_audit AFTER INSERT OR UPDATE OR DELETE ON month_close
  FOR EACH ROW EXECUTE FUNCTION audit_row('for_month,consumer_id');

-- ---------------------------------------------------------------------------
-- Who is asking. The platform knows the signed-in account; the workspace knows
-- which person that account is.

CREATE FUNCTION resolve_actor(p_account uuid) RETURNS TABLE (person_id uuid, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT id, role FROM person WHERE account_id = p_account AND status = 'ACTIVE' $$;

-- Binds a sign-in account to a person once, when an invitation is accepted. The
-- platform has already checked the invitation.
CREATE FUNCTION bind_account(p_person uuid, p_account uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE person SET account_id = p_account
   WHERE id = p_person AND status = 'ACTIVE' AND (account_id IS NULL OR account_id = p_account);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: that person is already linked to another sign-in' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- An automatic close, made on behalf of the workspace's own rule. The amounts
-- come from the engine; this checks the rule really has come due.
CREATE FUNCTION system_close_month(p_month date, p_consumer uuid, p_meals integer, p_billed bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rule jsonb := policy_on(p_month) -> 'monthClose';
  due  date;
BEGIN
  IF (SELECT read_only FROM workspace) THEN
    RETURN;
  END IF;
  IF rule ->> 'mode' IS DISTINCT FROM 'auto' THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: this workspace does not close months automatically' USING ERRCODE = 'P0001';
  END IF;
  due := (p_month + interval '1 month' - interval '1 day')::date + (rule ->> 'afterDays')::int;
  IF workspace_today() <= due THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: that month is not due to close yet' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO month_close (for_month, consumer_id, meals, billed, closed_on, closed_by)
  VALUES (p_month, p_consumer, p_meals, p_billed, workspace_today(), NULL)
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security. With no role set, nothing matches.

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_reversal ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE month_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_read ON workspace FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY workspace_admin_update ON workspace FOR UPDATE
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

CREATE POLICY person_read ON person FOR SELECT USING (
  app_role() = 'admin' OR id = app_person() OR (app_role() = 'supplier' AND role = 'consumer'));
CREATE POLICY person_admin_insert ON person FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY person_admin_update ON person FOR UPDATE
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

CREATE POLICY policy_read ON policy_version FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY policy_admin_insert ON policy_version FOR INSERT WITH CHECK (app_role() = 'admin');

CREATE POLICY rate_card_read ON rate_card FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY rate_card_admin_insert ON rate_card FOR INSERT WITH CHECK (app_role() = 'admin');

CREATE POLICY holiday_read ON holiday FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY holiday_admin_write ON holiday FOR ALL
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

-- A consumer sees their own entries and the days the kitchen was off, because
-- those change their own bill.
CREATE POLICY log_read ON log_entry FOR SELECT USING (
  app_role() IN ('admin', 'supplier')
  OR (app_role() = 'consumer' AND (person_id = app_person() OR all_consumers)));
CREATE POLICY log_insert ON log_entry FOR INSERT WITH CHECK (
  app_role() = 'admin'
  OR (app_role() = 'consumer' AND person_id = app_person() AND change <> 'Supplier Off')
  OR (app_role() = 'supplier' AND change = 'Supplier Off'));
CREATE POLICY log_update ON log_entry FOR UPDATE
  USING (app_role() = 'admin' OR logged_by = app_person())
  WITH CHECK (app_role() = 'admin' OR logged_by = app_person());
CREATE POLICY log_delete ON log_entry FOR DELETE
  USING (app_role() = 'admin' OR logged_by = app_person());

CREATE POLICY claim_read ON claim FOR SELECT USING (
  app_role() IN ('admin', 'supplier') OR consumer_id = app_person());
CREATE POLICY claim_insert ON claim FOR INSERT WITH CHECK (
  app_role() = 'admin' OR (app_role() = 'consumer' AND consumer_id = app_person()));
-- Withdrawing a claim is allowed only while nobody has decided it.
CREATE POLICY claim_delete ON claim FOR DELETE USING (
  (app_role() = 'admin' OR consumer_id = app_person())
  AND NOT EXISTS (SELECT 1 FROM claim_decision d WHERE d.claim_id = claim.id));

CREATE POLICY decision_read ON claim_decision FOR SELECT USING (
  app_role() IN ('admin', 'supplier')
  OR EXISTS (SELECT 1 FROM claim c WHERE c.id = claim_id AND c.consumer_id = app_person()));
CREATE POLICY decision_supplier_insert ON claim_decision FOR INSERT WITH CHECK (app_role() = 'supplier');

CREATE POLICY reversal_read ON claim_reversal FOR SELECT USING (
  app_role() IN ('admin', 'supplier')
  OR EXISTS (SELECT 1 FROM claim c WHERE c.id = claim_id AND c.consumer_id = app_person()));
CREATE POLICY reversal_admin_insert ON claim_reversal FOR INSERT WITH CHECK (app_role() = 'admin');

CREATE POLICY settlement_read ON settlement FOR SELECT USING (
  app_role() IN ('admin', 'supplier') OR consumer_id = app_person());
CREATE POLICY settlement_admin_insert ON settlement FOR INSERT WITH CHECK (app_role() = 'admin');

CREATE POLICY close_read ON month_close FOR SELECT USING (
  app_role() IN ('admin', 'supplier') OR consumer_id = app_person());
CREATE POLICY close_admin_insert ON month_close FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY close_admin_delete ON month_close FOR DELETE USING (app_role() = 'admin');

CREATE POLICY audit_admin_read ON audit_log FOR SELECT USING (app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Privileges for the application role. Everything not listed is refused, which
-- is what makes decisions, settlements and prices append-only even before the
-- triggers are consulted.

-- How far this database has been migrated; the application role may ask, not change.
CREATE FUNCTION schema_version() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce(max(version), 0) FROM schema_migration $$;

CREATE FUNCTION grant_to_app(p_privileges text, p_table regclass) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT %s ON %s TO %I', p_privileges, p_table, (SELECT value FROM meta WHERE key = 'app_role'));
END $$;

-- Postgres lets every role execute a new function. Here nothing is executable unless
-- it is granted on purpose, below. This is done with an explicit revoke, not with
-- default privileges, so it never changes how anything else in the database behaves.
-- Every migration that adds a function must end with the same revoke and its own grants.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  app text := (SELECT value FROM meta WHERE key = 'app_role');
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app);
  EXECUTE format('GRANT EXECUTE ON FUNCTION app_role(), app_person(), is_app_session(), workspace_today(), '
                 'policy_on(date), is_working_day(date), month_closed(date, uuid), close_blocks_admin(date), person_billing(uuid), '
                 'resolve_actor(uuid), bind_account(uuid, uuid), system_close_month(date, uuid, integer, bigint), schema_version() TO %I', app);
END $$;

SELECT grant_to_app('SELECT', 'meta');
SELECT grant_to_app('SELECT, UPDATE', 'workspace');
SELECT grant_to_app('SELECT, INSERT, UPDATE', 'person');
SELECT grant_to_app('SELECT, INSERT', 'policy_version');
SELECT grant_to_app('SELECT, INSERT', 'rate_card');
SELECT grant_to_app('SELECT, INSERT, UPDATE, DELETE', 'holiday');
SELECT grant_to_app('SELECT, INSERT, UPDATE, DELETE', 'log_entry');
SELECT grant_to_app('SELECT, INSERT, DELETE', 'claim');
SELECT grant_to_app('SELECT, INSERT', 'claim_decision');
SELECT grant_to_app('SELECT, INSERT', 'claim_reversal');
SELECT grant_to_app('SELECT, INSERT', 'settlement');
SELECT grant_to_app('SELECT, INSERT, DELETE', 'month_close');
SELECT grant_to_app('SELECT', 'audit_log');
