-- Control database, version 1.
--
-- The platform's own records: who can sign in, which workspaces exist and where
-- their databases are, the keys that make a workspace's personal data readable,
-- invitations, and daily usage counts. Nothing about a workspace's meals or money
-- lives here, and nothing here names a person other than by their sign-in email.
--
-- The role that runs this file owns every object; the application role named in
-- alimentation.app_role gets the privileges granted at the end.

CREATE TABLE account (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  idp_issuer    text NOT NULL,
  idp_sub       text NOT NULL,
  email         text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (idp_issuer, idp_sub)
);
CREATE UNIQUE INDEX account_email ON account (email);

CREATE TABLE workspace (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  state            text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (state IN ('ACTIVE', 'MIGRATING', 'MOVED', 'WIPING')),
  -- {"kind": "pg-database" | "neon-project" | "external", "data": {...}}
  placement        jsonb NOT NULL,
  -- The workspace database's connection strings, encrypted under the master key.
  dsn_enc          bytea NOT NULL,
  -- The keys that make personal data readable and logs linkable, wrapped by the
  -- master key. Setting these to null is what "destroy the key" means.
  data_key_wrapped bytea,
  log_key_wrapped  bytea,
  time_zone        text NOT NULL DEFAULT 'Asia/Kolkata',
  -- The caps this workspace lives under: see packages/core limits.ts.
  limits           jsonb NOT NULL,
  over_since       date,
  -- When it entered its current state; a move that stalls is found by this.
  state_since      timestamptz NOT NULL DEFAULT now(),
  -- Where the workspace went, after a move.
  moved_to_url     text,
  moved_at         timestamptz,
  created_by       uuid REFERENCES account (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (state = 'WIPING' OR (data_key_wrapped IS NOT NULL AND log_key_wrapped IS NOT NULL))
);

-- Which person an account is, in which workspace, in which role. One human can be
-- both admin and supplier of their own kitchen; each is its own person there.
CREATE TABLE membership (
  account_id   uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  person_id    uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'supplier', 'consumer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, workspace_id, role)
);
CREATE INDEX membership_workspace ON membership (workspace_id);

-- An invitation names an email, a role and the person row waiting for it. Only a
-- hash of the token is kept.
CREATE TABLE invite (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  person_id    uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'supplier', 'consumer')),
  email        text NOT NULL CHECK (email = lower(email)),
  token_hash   bytea NOT NULL UNIQUE,
  -- Made when a workspace arrives from elsewhere: bound to the person who signs in
  -- with a verified matching email, with no link to follow.
  auto         boolean NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_by   uuid REFERENCES account (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_workspace ON invite (workspace_id);

-- A workspace database that has been moved away from and waits out the undo window
-- before it is destroyed. The credentials are kept encrypted, only to destroy it.
-- Its personal data is sealed under the keys kept here, not under the workspace's
-- current ones, so destroying these two is what makes the old copy unreadable.
CREATE TABLE retired_database (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id     uuid NOT NULL,
  placement        jsonb NOT NULL,
  dsn_enc          bytea NOT NULL,
  data_key_wrapped bytea,
  log_key_wrapped  bytea,
  retired_at       timestamptz NOT NULL DEFAULT now(),
  destroy_after    timestamptz NOT NULL,
  destroyed_at     timestamptz
);

CREATE TABLE usage_daily (
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  day          date NOT NULL,
  requests     integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  rejected     integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  PRIMARY KEY (workspace_id, day)
);

-- What happened to workspaces, without saying anything about the people in them.
CREATE TABLE platform_event (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL,
  workspace_id uuid,
  detail       jsonb NOT NULL DEFAULT '{}'
);

-- What remains of a workspace that was wiped: that it was, when, and what was
-- destroyed. No name, no slug, no people.
CREATE TABLE wipe_receipt (
  workspace_id  uuid PRIMARY KEY,
  requested_at  timestamptz NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now(),
  manifest      jsonb NOT NULL,
  digest        text NOT NULL
);

CREATE FUNCTION forbid_change() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: % is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER platform_event_append_only BEFORE UPDATE OR DELETE ON platform_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER wipe_receipt_append_only BEFORE UPDATE OR DELETE ON wipe_receipt
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- No function is executable by everyone.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Privileges for the application role.
DO $$
DECLARE
  app text := current_setting('alimentation.app_role');
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON account, workspace, membership, invite, usage_daily, retired_database TO %I', app);
  EXECUTE format('GRANT SELECT, INSERT ON platform_event, wipe_receipt TO %I', app);
END $$;

-- who may make a kitchen on a shared instance.
--
-- On an instance whose signup is by invitation (SIGNUP=invite), only an email an operator has approved may make
-- a kitchen. Anyone else who is signed in may ask for a place, which writes a row here with their own verified
-- email; an operator approves it, or approves an email in advance, before anyone has asked.
--
--   * One row per email, whichever way it came: `requested_at` is when the person asked (null for an email
--     approved in advance and not yet asked for), `approved_at` when an operator said yes (null while waiting).
--     A row is always one or the other.
--   * An approval is not used up. It lets the email make kitchens up to the instance's limit for one account
--     (MAX_WORKSPACES_PER_ACCOUNT), so there is nothing to mark when a kitchen is made.
--   * The email is the sign-in email in lower case, like account.email, and is not a foreign key to it: an
--     approval may be given to someone who has not yet signed in.
--   * `approved_by` is the operator's account, and goes empty if that account is removed.
--   * Nothing here names anything but an email, and nothing about a kitchen. It is not in the platform events.

CREATE TABLE signup_request (
  email        text PRIMARY KEY CHECK (email = lower(email) AND position('@' IN email) > 1 AND length(email) <= 254),
  requested_at timestamptz,
  approved_at  timestamptz,
  approved_by  uuid REFERENCES account (id) ON DELETE SET NULL,
  CHECK (requested_at IS NOT NULL OR approved_at IS NOT NULL),
  CHECK (approved_by IS NULL OR approved_at IS NOT NULL)
);
CREATE INDEX signup_request_waiting ON signup_request (requested_at) WHERE approved_at IS NULL;

DO $$
DECLARE
  app text := current_setting('alimentation.app_role');
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON signup_request TO %I', app);
END $$;
