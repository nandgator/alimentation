-- A person may carry the kitchen's own code for them.
--
-- A kitchen that already keeps a list somewhere else (a room number, a staff number, a member number) can
-- bring it in with a file of people. The code is what a later file is matched on, so the same file can be
-- brought again to change what is there and not to add everyone twice.
--
--   * The code is plain text and not ciphertext, on purpose. It has to be unique, and ciphertext cannot be
--     compared. It is a code the kitchen chose, not a name, an email or a number to call, and a CHECK keeps
--     it to letters, digits and a few marks so that none of those fits. It is in the audit trail as it is,
--     and so in a copy of the workspace taken to move it.
--   * It is unique within the kitchen (one database is one kitchen), and several people may have none.
--   * Once set it never changes and is never cleared, so that a file cannot quietly point at someone else.
--     Setting it on a person who has none is allowed, once.
--
-- The audit trigger of the person table copies the row as it is, so the code is in the trail without a
-- change here, and the read-only trigger of the table refuses every write to the column while the
-- workspace is being moved.

ALTER TABLE person ADD COLUMN external_key text
  CONSTRAINT person_external_key_form CHECK (external_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,63}$');

CREATE UNIQUE INDEX person_external_key ON person (external_key) WHERE external_key IS NOT NULL;

CREATE FUNCTION keep_external_key() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.external_key IS NOT NULL AND NEW.external_key IS DISTINCT FROM OLD.external_key THEN
    RAISE EXCEPTION 'ALIMENTATION_IMMUTABLE: a person''s key cannot be changed once it is set' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_keep_external_key BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION keep_external_key();

-- One line in the audit trail for a whole import, beside the rows it changed: how it was meant to be read
-- (merge or overwrite), how many people it added and changed, and a hash of the file. The file itself is
-- kept nowhere. Written here, by the database, for the same reason the rest of the trail is: the
-- application role may not write the table, so no code path can write a different line or forget it.
CREATE FUNCTION record_person_import(p_detail jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF is_app_session() THEN
    IF app_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'only the admin can import people' USING ERRCODE = '42501';
    END IF;
    IF (SELECT read_only FROM workspace) THEN
      RAISE EXCEPTION 'ALIMENTATION_RULE: this workspace is read-only while it is moved' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  INSERT INTO audit_log (table_name, row_id, action, actor, via, before, after)
  VALUES ('person_import', coalesce(p_detail ->> 'fileHash', ''), 'IMPORT', app_person(), app_via(), NULL, p_detail);
END $$;

-- As in the first migration: nothing is executable unless it is granted on purpose.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
DECLARE
  app text := (SELECT value FROM meta WHERE key = 'app_role');
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION record_person_import(jsonb) TO %I', app);
END $$;
