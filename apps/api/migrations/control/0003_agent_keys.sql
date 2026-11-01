-- Control database, version 3: keys for AI agents.
--
-- A person makes a key for an agent to use in one kitchen, as one of the roles they hold there, with some of
-- three scopes: read, log (add and withdraw entries) and claims (say a payment was made). It acts as that
-- person in that role and no further: what the kitchen's rules and its database refuse a person, they refuse
-- the agent. Only a hash of the token is kept, so a key shown once cannot be shown again. A key ends when it
-- is revoked, when it expires, or when its person is no longer in that role in that kitchen.

CREATE TABLE agent_key (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  account_id   uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('admin', 'supplier', 'consumer')),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  scopes       text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'log', 'claims'] AND 'read' = ANY (scopes)),
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX agent_key_person ON agent_key (account_id, workspace_id);
CREATE INDEX agent_key_workspace ON agent_key (workspace_id);

DO $$
DECLARE
  app text := current_setting('alimentation.app_role');
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agent_key TO %I', app);
END $$;
