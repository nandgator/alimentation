-- A change made through an agent says so.
--
-- A person can give an AI agent a key of its own (the platform keeps the key; see the control database's
-- agent_key). When the agent acts, the application states which agent in the transaction (`app.via`, next to
-- `app.role` and `app.person_id`), and the audit trail records it beside who the change was for. So the
-- people a change affects can read, in History, that an agent made it, and which one, in the same place and
-- the same words as any other change. It is the database that writes it, so no code path can forget.
--
-- Rows written before this have no `via`, and are what they were.

ALTER TABLE audit_log ADD COLUMN via jsonb;

CREATE FUNCTION app_via() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.via', true), '')::jsonb $$;

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  src jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  rid text;
BEGIN
  SELECT string_agg(src ->> k, '|' ORDER BY ord) INTO rid
    FROM unnest(string_to_array(TG_ARGV[0], ',')) WITH ORDINALITY AS t(k, ord);
  INSERT INTO audit_log (table_name, row_id, action, actor, via, before, after)
  VALUES (TG_TABLE_NAME, rid, TG_OP, app_person(), app_via(),
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN NULL;
END $$;

-- As in the first migration: nothing is executable unless it is granted on purpose. The trigger function runs as
-- its owner, so this one needs no grant.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
