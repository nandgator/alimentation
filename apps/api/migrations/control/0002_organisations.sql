-- Control database, version 2: organisations.
--
-- An organisation is a head office over several kitchens. It exists so that one place can see how
-- its kitchens are doing, and it is deliberately narrow: a head-office member is let see each
-- kitchen's totals for the month (how many people, how many meals, what was billed, paid and is owed,
-- what waits to be confirmed) and nothing that names anyone. They are not made a member of a kitchen,
-- and the kitchen's own people, ledgers and notes stay where they were.
--
-- A kitchen shares its totals with at most one organisation, and only because someone who is its
-- admin said so. Either side can end it.

CREATE TABLE organisation (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_by uuid REFERENCES account (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who may see the organisation's totals. There is no other role.
CREATE TABLE organisation_member (
  organisation_id uuid NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, account_id)
);
CREATE INDEX organisation_member_account ON organisation_member (account_id);

CREATE TABLE organisation_kitchen (
  workspace_id    uuid PRIMARY KEY REFERENCES workspace (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisation (id) ON DELETE CASCADE,
  added_by        uuid REFERENCES account (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organisation_kitchen_organisation ON organisation_kitchen (organisation_id);

DO $$
DECLARE
  app text := current_setting('alimentation.app_role');
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON organisation, organisation_member, organisation_kitchen TO %I', app);
END $$;
