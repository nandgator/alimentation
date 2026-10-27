-- Everyone can see what was done to their own records.
--
-- The audit trail was readable by the admin alone. That left a member with no way to see that an
-- entry of theirs had been removed, or a claim withdrawn, or a closed month reopened: the person
-- the change affects was the one person who could not see it. These two policies close that gap
-- in the database, so no screen has to remember to.
--
--   * a member reads the trail of their own entries, claims, decisions, settlements, month
--     closes and own person row, and of the prices, rules and holidays everyone is billed by;
--   * the supplier reads the trail of everything they can already read (entries, claims,
--     decisions, settlements, closes, prices, rules and holidays), but not of people.
--
-- Nothing else changes: the trail is still written only by the database, never edited, and the
-- admin still reads all of it.

CREATE POLICY audit_member_read ON audit_log FOR SELECT USING (
  app_role() = 'consumer' AND (
    (table_name = 'log_entry'
       AND (coalesce(after, before) ->> 'person_id' = app_person()::text
            OR coalesce(after, before) ->> 'all_consumers' = 'true'))
    OR (table_name IN ('claim', 'settlement', 'month_close')
       AND coalesce(after, before) ->> 'consumer_id' = app_person()::text)
    OR (table_name IN ('claim_decision', 'claim_reversal')
       AND EXISTS (SELECT 1 FROM claim c WHERE c.id::text = audit_log.row_id AND c.consumer_id = app_person()))
    OR (table_name = 'person' AND row_id = app_person()::text)
    OR table_name IN ('rate_card', 'policy_version', 'holiday')));

CREATE POLICY audit_supplier_read ON audit_log FOR SELECT USING (
  app_role() = 'supplier' AND table_name IN
    ('log_entry', 'claim', 'claim_decision', 'claim_reversal', 'settlement', 'month_close',
     'rate_card', 'policy_version', 'holiday'));
