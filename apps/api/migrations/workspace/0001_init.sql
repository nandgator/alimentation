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
  -- Whether the kitchen puts a price on its meals. Chosen when the kitchen is made and fixed after: a guard
  -- below refuses any change. A kitchen without money counts meals and keeps no prices, claims, settlements
  -- or billed amounts, and the database refuses to hold them (see guard_money).
  money_enabled boolean NOT NULL DEFAULT true,
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

-- What a kitchen serves and when, as data with stable ids. Names, units and prices are the kitchen's own; only
-- two item kinds (a meal, an add-on) and four log actions are fixed. Nothing here carries a price, so every
-- kitchen has it whether or not it tracks money. Nothing is deleted: a service or an item is retired from a
-- date, once, and the rows that name it keep naming it.
CREATE TABLE service (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  position   smallint NOT NULL DEFAULT 0,
  archived_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
-- Retired ones count: a name is not reused for something else.
CREATE UNIQUE INDEX service_name ON service (lower(name));

CREATE TABLE catalogue_item (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  kind       text NOT NULL CHECK (kind IN ('meal', 'addon')),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  unit       text NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),
  max_qty    integer NOT NULL DEFAULT 20 CHECK (max_qty BETWEEN 1 AND 99),
  archived_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  -- What a log entry and a menu cell point at, so that an item of the wrong kind cannot be named.
  UNIQUE (id, kind)
);
CREATE UNIQUE INDEX catalogue_item_name ON catalogue_item (lower(name));

-- Which services a consumer takes, and from when. Dated and inclusive at both ends.
CREATE TABLE person_service (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id   uuid NOT NULL REFERENCES person (id),
  service_id  uuid NOT NULL REFERENCES service (id),
  active_from date NOT NULL,
  active_to   date,
  CHECK (active_to IS NULL OR active_to >= active_from)
);
CREATE INDEX person_service_person ON person_service (person_id, service_id);

-- What is served, dated and append-only like a rate card, and with no prices in it. The menu is one record
-- for the whole kitchen; what each service offers and which meal it serves on which weekday are its children.
CREATE TABLE menu (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  effective_from  date NOT NULL UNIQUE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- What a service offers: the meals one can switch to and the add-ons one can ask for.
CREATE TABLE menu_offer (
  menu_id    uuid NOT NULL REFERENCES menu (id),
  service_id uuid NOT NULL REFERENCES service (id),
  item_id    uuid NOT NULL REFERENCES catalogue_item (id),
  PRIMARY KEY (menu_id, service_id, item_id)
);

-- No row means that service is not served on that weekday.
CREATE TABLE menu_day (
  menu_id    uuid NOT NULL,
  service_id uuid NOT NULL,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  meal_id    uuid NOT NULL,
  meal_kind  text NOT NULL DEFAULT 'meal' CHECK (meal_kind = 'meal'),
  PRIMARY KEY (menu_id, service_id, weekday),
  FOREIGN KEY (menu_id, service_id, meal_id) REFERENCES menu_offer (menu_id, service_id, item_id),
  FOREIGN KEY (meal_id, meal_kind) REFERENCES catalogue_item (id, kind)
);

-- Prices only. A kitchen that does not track money has none (see guard_money).
CREATE TABLE rate_card (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  effective_from  date NOT NULL UNIQUE,
  monthly_fee     paise NOT NULL DEFAULT 0,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- A price per item, with an optional price for one service. No service means the price in every service.
CREATE TABLE rate_price (
  card_id    uuid NOT NULL REFERENCES rate_card (id),
  item_id    uuid NOT NULL REFERENCES catalogue_item (id),
  service_id uuid REFERENCES service (id),
  amount     paise NOT NULL,
  UNIQUE NULLS NOT DISTINCT (card_id, item_id, service_id)
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
  action        text NOT NULL CHECK (action IN ('Leave', 'Switch', 'Extra', 'Supplier Off')),
  -- Null means the whole day. Leave and Supplier Off may be either; Switch and Extra name the one service.
  service_id    uuid REFERENCES service (id),
  item_id       uuid,
  item_kind     text,
  qty           integer CHECK (qty IS NULL OR qty BETWEEN 1 AND 99),
  note_enc      enc_blob,
  logged_by     uuid NOT NULL REFERENCES person (id),
  logged_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (item_id, item_kind) REFERENCES catalogue_item (id, kind),
  CHECK ((item_id IS NULL) = (item_kind IS NULL)),
  -- Supplier Off is for everyone and for no one in particular; all else is for one person.
  CHECK ((action = 'Supplier Off') = all_consumers),
  CHECK ((person_id IS NULL) = all_consumers),
  -- coalesce, because a CHECK that comes out null passes.
  CHECK (CASE action
    WHEN 'Leave' THEN item_id IS NULL AND qty IS NULL
    WHEN 'Supplier Off' THEN item_id IS NULL AND qty IS NULL
    WHEN 'Switch' THEN service_id IS NOT NULL AND coalesce(item_kind = 'meal', false) AND qty IS NULL
    WHEN 'Extra' THEN service_id IS NOT NULL AND coalesce(item_kind = 'addon', false) AND qty IS NOT NULL
  END)
);
CREATE INDEX log_entry_person_date ON log_entry (person_id, on_date);
CREATE INDEX log_entry_date ON log_entry (on_date);
-- A whole day (no service) and one service are different to an index; the stamp trigger refuses the pair.
CREATE UNIQUE INDEX log_one_leave ON log_entry (on_date, person_id, service_id) NULLS NOT DISTINCT
  WHERE action = 'Leave';
CREATE UNIQUE INDEX log_one_off ON log_entry (on_date, service_id) NULLS NOT DISTINCT
  WHERE action = 'Supplier Off';
CREATE UNIQUE INDEX log_one_switch ON log_entry (on_date, person_id, service_id) WHERE action = 'Switch';
CREATE UNIQUE INDEX log_one_extra ON log_entry (on_date, person_id, service_id, item_id) WHERE action = 'Extra';

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
  -- Null when the close only locks the month, which is all a kitchen without money can do (see guard_close).
  billed      paise,
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
CREATE TRIGGER menu_append_only BEFORE UPDATE OR DELETE ON menu
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER menu_offer_append_only BEFORE UPDATE OR DELETE ON menu_offer
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER menu_day_append_only BEFORE UPDATE OR DELETE ON menu_day
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER rate_price_append_only BEFORE UPDATE OR DELETE ON rate_price
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

-- Whether a person takes a service on a date. Definer, because a consumer may read only their own rows.
CREATE FUNCTION enrolled_on(p_person uuid, p_service uuid, d date) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM person_service
       WHERE person_id = p_person AND service_id = p_service
         AND active_from <= d AND (active_to IS NULL OR d <= active_to))
  $$;

-- Whether a person has a closed month between two dates (both included; a null end is open) that the caller
-- may not change: the same lock a log entry is under.
CREATE FUNCTION enrolment_locked(p_person uuid, lo date, hi date) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM month_close c
       WHERE c.consumer_id = p_person
         AND c.for_month >= date_trunc('month', lo)::date
         AND (hi IS NULL OR c.for_month <= hi)
         AND (policy_on(c.for_month) -> 'monthClose' ->> 'mode') IS DISTINCT FROM 'off'
         AND (app_role() IS DISTINCT FROM 'admin' OR close_blocks_admin(c.for_month)))
  $$;

CREATE FUNCTION stamp_log_entry() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  who record;
  it record;
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
      IF NEW.service_id IS NOT NULL AND NOT enrolled_on(NEW.person_id, NEW.service_id, NEW.on_date) THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: that person does not take that service on %', NEW.on_date USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.item_id IS NOT NULL THEN
      SELECT * INTO it FROM catalogue_item WHERE id = NEW.item_id;
      -- An item that does not exist is the foreign key's to refuse, and an entry with no service where one
      -- is needed is the shape check's.
      IF FOUND THEN
        IF it.archived_on IS NOT NULL AND it.archived_on <= NEW.on_date THEN
          RAISE EXCEPTION 'ALIMENTATION_RULE: % is no longer served on %', it.name, NEW.on_date USING ERRCODE = 'P0001';
        END IF;
        IF NEW.qty > it.max_qty THEN
          RAISE EXCEPTION 'ALIMENTATION_RULE: at most % of % at a time', it.max_qty, it.name USING ERRCODE = 'P0001';
        END IF;
        IF NEW.service_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM menu_offer o
              WHERE o.menu_id = (SELECT m.id FROM menu m WHERE m.effective_from <= NEW.on_date
                                  ORDER BY m.effective_from DESC LIMIT 1)
                AND o.service_id = NEW.service_id AND o.item_id = NEW.item_id) THEN
          RAISE EXCEPTION 'ALIMENTATION_RULE: % is not offered by that service on %', it.name, NEW.on_date USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
    -- A whole day and one of its services cannot both be left, or both be off. The unique indexes see
    -- the same scope twice; this sees a whole day against a part. Serialised, so that two writers
    -- who cannot see each other's row do not both pass.
    IF NEW.action IN ('Leave', 'Supplier Off') THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.action || NEW.on_date::text || coalesce(NEW.person_id::text, '*'), 0));
      IF EXISTS (
           SELECT 1 FROM log_entry x
            WHERE x.on_date = NEW.on_date AND x.action = NEW.action
              AND x.person_id IS NOT DISTINCT FROM NEW.person_id
              AND x.id <> NEW.id
              AND x.service_id IS DISTINCT FROM NEW.service_id
              AND (x.service_id IS NULL OR NEW.service_id IS NULL)) THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: the whole day and one of its services cannot both be %', lower(NEW.action) USING ERRCODE = 'P0001';
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

-- A service or an item is retired from a date, once. The date cannot move or be cleared, so a bill that
-- was right when it was made stays right.
CREATE FUNCTION keep_archived_once() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_on IS NOT NULL AND NEW.archived_on IS DISTINCT FROM OLD.archived_on THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: % was retired on % and that cannot change', OLD.name, OLD.archived_on USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER service_keep_archived_once BEFORE UPDATE ON service
  FOR EACH ROW EXECUTE FUNCTION keep_archived_once();
CREATE TRIGGER catalogue_item_keep_archived_once BEFORE UPDATE ON catalogue_item
  FOR EACH ROW EXECUTE FUNCTION keep_archived_once();

-- Behaviour hangs on the kind, the unit is what a count is of, and the largest quantity is what an entry was
-- checked against: none of them changes under an item that has been used. A rename is allowed (and audited).
CREATE FUNCTION keep_item_shape() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.max_qty IS DISTINCT FROM OLD.max_qty THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: the kind, unit and largest quantity of an item cannot change; add a new item' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalogue_item_keep_shape BEFORE UPDATE ON catalogue_item
  FOR EACH ROW EXECUTE FUNCTION keep_item_shape();

-- The services a person takes: a consumer, once at a time per service, and a closed month stays as it was.
CREATE FUNCTION stamp_person_service() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  who record;
  far constant date := '9999-12-31';
  lo date;
  hi date;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.person_id <> OLD.person_id OR NEW.service_id <> OLD.service_id) THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: who takes which service cannot change; end it and add another' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT * INTO who FROM person_billing(NEW.person_id);
    IF who.role IS DISTINCT FROM 'consumer' THEN
      RAISE EXCEPTION 'ALIMENTATION_RULE: only consumers take a service' USING ERRCODE = 'P0001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('person_service' || NEW.person_id::text, 0));
    IF EXISTS (
         SELECT 1 FROM person_service x
          WHERE x.person_id = NEW.person_id AND x.service_id = NEW.service_id AND x.id <> NEW.id
            AND x.active_from <= coalesce(NEW.active_to, far) AND NEW.active_from <= coalesce(x.active_to, far)) THEN
      RAISE EXCEPTION 'ALIMENTATION_RULE: that person already takes that service on some of those days' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The days whose bill this changes, and whether any of them is in a month the caller may not touch.
  IF is_app_session() THEN
    IF TG_OP = 'INSERT' THEN
      IF enrolment_locked(NEW.person_id, NEW.active_from, NEW.active_to) THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF enrolment_locked(OLD.person_id, OLD.active_from, OLD.active_to) THEN
        RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF NEW.active_from <> OLD.active_from THEN
        lo := least(NEW.active_from, OLD.active_from);
        hi := greatest(NEW.active_from, OLD.active_from) - 1;
        IF enrolment_locked(NEW.person_id, lo, hi) THEN
          RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
        END IF;
      END IF;
      IF NEW.active_to IS DISTINCT FROM OLD.active_to THEN
        lo := least(coalesce(NEW.active_to, far), coalesce(OLD.active_to, far)) + 1;
        hi := greatest(coalesce(NEW.active_to, far), coalesce(OLD.active_to, far));
        IF enrolment_locked(NEW.person_id, lo, CASE WHEN hi = far THEN NULL ELSE hi END) THEN
          RAISE EXCEPTION 'ALIMENTATION_RULE: that month is closed' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER person_service_stamp BEFORE INSERT OR UPDATE OR DELETE ON person_service
  FOR EACH ROW EXECUTE FUNCTION stamp_person_service();

-- A menu or a rate card is written in one transaction with its children, and never added to later. The
-- application role cannot add an offer, a day or a price to a menu or card that already exists, so a
-- published record cannot be extended behind the append-only rule. (The owner, who imports a moved kitchen,
-- keeps the dates the file says.)
CREATE FUNCTION guard_same_transaction() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  made timestamptz;
BEGIN
  IF is_app_session() THEN
    IF TG_TABLE_NAME = 'rate_price' THEN
      SELECT created_at INTO made FROM rate_card WHERE id = NEW.card_id;
    ELSE
      SELECT created_at INTO made FROM menu WHERE id = NEW.menu_id;
    END IF;
    IF made IS DISTINCT FROM now() THEN
      RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: % can only be added in the transaction that made its parent', TG_TABLE_NAME USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER menu_offer_same_transaction BEFORE INSERT ON menu_offer
  FOR EACH ROW EXECUTE FUNCTION guard_same_transaction();
CREATE TRIGGER menu_day_same_transaction BEFORE INSERT ON menu_day
  FOR EACH ROW EXECUTE FUNCTION guard_same_transaction();
CREATE TRIGGER rate_price_same_transaction BEFORE INSERT ON rate_price
  FOR EACH ROW EXECUTE FUNCTION guard_same_transaction();

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
CREATE TRIGGER menu_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON menu
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER service_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON service
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER catalogue_item_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON catalogue_item
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER person_service_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON person_service
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER menu_offer_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON menu_offer
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER menu_day_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON menu_day
  FOR EACH STATEMENT EXECUTE FUNCTION guard_read_only();
CREATE TRIGGER rate_price_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON rate_price
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
CREATE TRIGGER menu_audit AFTER INSERT OR UPDATE OR DELETE ON menu
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER service_audit AFTER INSERT OR UPDATE OR DELETE ON service
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER catalogue_item_audit AFTER INSERT OR UPDATE OR DELETE ON catalogue_item
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER person_service_audit AFTER INSERT OR UPDATE OR DELETE ON person_service
  FOR EACH ROW EXECUTE FUNCTION audit_row('id');
CREATE TRIGGER menu_offer_audit AFTER INSERT OR UPDATE OR DELETE ON menu_offer
  FOR EACH ROW EXECUTE FUNCTION audit_row('menu_id,service_id,item_id');
CREATE TRIGGER menu_day_audit AFTER INSERT OR UPDATE OR DELETE ON menu_day
  FOR EACH ROW EXECUTE FUNCTION audit_row('menu_id,service_id,weekday');
CREATE TRIGGER rate_price_audit AFTER INSERT OR UPDATE OR DELETE ON rate_price
  FOR EACH ROW EXECUTE FUNCTION audit_row('card_id,item_id,service_id');
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
-- come from the engine; this checks the rule really has come due. A kitchen
-- without money writes the close without an amount, whatever it is given: the
-- month is locked and nothing is frozen.
CREATE FUNCTION system_close_month(p_month date, p_consumer uuid, p_meals integer, p_billed bigint) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rule jsonb := policy_on(p_month) -> 'monthClose';
  due  date;
  money boolean := (SELECT money_enabled FROM workspace);
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
  VALUES (p_month, p_consumer, p_meals, CASE WHEN money THEN p_billed END, workspace_today(), NULL)
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security. With no role set, nothing matches.

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE service ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_price ENABLE ROW LEVEL SECURITY;
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

CREATE POLICY service_read ON service FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY service_admin_insert ON service FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY service_admin_update ON service FOR UPDATE
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

CREATE POLICY item_read ON catalogue_item FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY item_admin_insert ON catalogue_item FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY item_admin_update ON catalogue_item FOR UPDATE
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

-- A member sees which services they take and no one else's.
CREATE POLICY person_service_read ON person_service FOR SELECT USING (
  app_role() IN ('admin', 'supplier') OR person_id = app_person());
CREATE POLICY person_service_admin_write ON person_service FOR ALL
  USING (app_role() = 'admin') WITH CHECK (app_role() = 'admin');

CREATE POLICY menu_read ON menu FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY menu_admin_insert ON menu FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY menu_offer_read ON menu_offer FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY menu_offer_admin_insert ON menu_offer FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY menu_day_read ON menu_day FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY menu_day_admin_insert ON menu_day FOR INSERT WITH CHECK (app_role() = 'admin');

CREATE POLICY rate_card_read ON rate_card FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY rate_card_admin_insert ON rate_card FOR INSERT WITH CHECK (app_role() = 'admin');
CREATE POLICY rate_price_read ON rate_price FOR SELECT USING (app_role() IS NOT NULL);
CREATE POLICY rate_price_admin_insert ON rate_price FOR INSERT WITH CHECK (app_role() = 'admin');

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
  OR (app_role() = 'consumer' AND person_id = app_person() AND action <> 'Supplier Off')
  OR (app_role() = 'supplier' AND action = 'Supplier Off'));
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
                 'enrolled_on(uuid, uuid, date), enrolment_locked(uuid, date, date), '
                 'resolve_actor(uuid), bind_account(uuid, uuid), system_close_month(date, uuid, integer, bigint), schema_version() TO %I', app);
END $$;

SELECT grant_to_app('SELECT', 'meta');
SELECT grant_to_app('SELECT, UPDATE', 'workspace');
SELECT grant_to_app('SELECT, INSERT, UPDATE', 'person');
SELECT grant_to_app('SELECT, INSERT', 'policy_version');
SELECT grant_to_app('SELECT, INSERT, UPDATE', 'service');
SELECT grant_to_app('SELECT, INSERT, UPDATE', 'catalogue_item');
SELECT grant_to_app('SELECT, INSERT, UPDATE, DELETE', 'person_service');
SELECT grant_to_app('SELECT, INSERT', 'menu');
SELECT grant_to_app('SELECT, INSERT', 'menu_offer');
SELECT grant_to_app('SELECT, INSERT', 'menu_day');
SELECT grant_to_app('SELECT, INSERT', 'rate_card');
SELECT grant_to_app('SELECT, INSERT', 'rate_price');
SELECT grant_to_app('SELECT, INSERT, UPDATE, DELETE', 'holiday');
SELECT grant_to_app('SELECT, INSERT, UPDATE, DELETE', 'log_entry');
SELECT grant_to_app('SELECT, INSERT, DELETE', 'claim');
SELECT grant_to_app('SELECT, INSERT', 'claim_decision');
SELECT grant_to_app('SELECT, INSERT', 'claim_reversal');
SELECT grant_to_app('SELECT, INSERT', 'settlement');
SELECT grant_to_app('SELECT, INSERT, DELETE', 'month_close');
SELECT grant_to_app('SELECT', 'audit_log');

-- The caps of a workspace are set by the platform, not from inside it.
--
-- A free workspace lives under a people cap and a record cap (workspace.people_cap, workspace.row_cap), and an
-- operator may change them for one kitchen. The admin of a workspace may update the workspace row (its name, its
-- time zone, its rules), and until now nothing in the database said that two of its columns are not theirs to
-- change: the application never writes them, but a guard that rests on the application never writing is not a
-- guard. The owner role (the platform, which makes and moves workspaces and sets their limits) may change them;
-- a session of the application role may not, whatever role it holds in the workspace.
--
-- Every change the owner makes is in the audit trail with the workspace row as it was and as it is.

CREATE FUNCTION keep_caps() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF is_app_session()
     AND (NEW.people_cap IS DISTINCT FROM OLD.people_cap OR NEW.row_cap IS DISTINCT FROM OLD.row_cap) THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: the limits of a workspace are set by the platform, not from inside it' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_keep_caps BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION keep_caps();

-- A kitchen without money.
--
-- Whether a kitchen puts a price on its meals is chosen when it is made (workspace.money_enabled) and never
-- changes: not from inside the kitchen, and not by the platform either. A kitchen without money keeps no
-- prices, claims, decisions, reversals, settlements or billed amounts, and the database refuses to hold them
-- whoever is writing, the owner who imports a moved kitchen included. Menus, people, the log, holidays and
-- the rules are the same for both kinds, and a close without an amount is the lock on a month that both
-- can have.

-- The kitchen's own answer, readable by the application role without a role in the workspace (the platform
-- asks it when a kitchen is first served). A database with no workspace yet answers yes: nothing is refused
-- before the kitchen's row exists.
CREATE FUNCTION money_enabled() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce((SELECT money_enabled FROM workspace), true) $$;

CREATE FUNCTION keep_money_enabled() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.money_enabled IS DISTINCT FROM OLD.money_enabled THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: whether a kitchen tracks money is chosen when it is made and cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_keep_money_enabled BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION keep_money_enabled();

CREATE FUNCTION guard_money() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT money_enabled() THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: this kitchen does not track money' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER rate_card_guard_money BEFORE INSERT OR UPDATE OR DELETE ON rate_card
  FOR EACH ROW EXECUTE FUNCTION guard_money();
CREATE TRIGGER rate_price_guard_money BEFORE INSERT OR UPDATE OR DELETE ON rate_price
  FOR EACH ROW EXECUTE FUNCTION guard_money();
CREATE TRIGGER claim_guard_money BEFORE INSERT OR UPDATE OR DELETE ON claim
  FOR EACH ROW EXECUTE FUNCTION guard_money();
CREATE TRIGGER claim_decision_guard_money BEFORE INSERT OR UPDATE OR DELETE ON claim_decision
  FOR EACH ROW EXECUTE FUNCTION guard_money();
CREATE TRIGGER claim_reversal_guard_money BEFORE INSERT OR UPDATE OR DELETE ON claim_reversal
  FOR EACH ROW EXECUTE FUNCTION guard_money();
CREATE TRIGGER settlement_guard_money BEFORE INSERT OR UPDATE OR DELETE ON settlement
  FOR EACH ROW EXECUTE FUNCTION guard_money();

-- A close of a kitchen without money has no amount; a close made by a person in one that tracks money has.
-- (A close with no amount may arrive in a money kitchen by import, as the owner, from a kitchen that had no
-- money: it locks the month and freezes nothing.)
CREATE FUNCTION guard_close() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.billed IS NOT NULL AND NOT money_enabled() THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: this kitchen does not track money, so a close freezes no amount' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.billed IS NULL AND money_enabled() AND is_app_session() THEN
    RAISE EXCEPTION 'ALIMENTATION_RULE: a close in a kitchen that tracks money needs its billed amount' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER month_close_guard_close BEFORE INSERT OR UPDATE ON month_close
  FOR EACH ROW EXECUTE FUNCTION guard_close();

-- No function is executable by everyone.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  app text := (SELECT value FROM meta WHERE key = 'app_role');
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION money_enabled() TO %I', app);
END $$;
