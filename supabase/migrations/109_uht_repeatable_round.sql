-- ============================================================
-- Migration 109: Ultrasonic Hatch Testing — collapse the four copied test blocks
-- into ONE repeatable "Test round" section. Idempotent.
--
-- The original template (migration 072) carried four identical sections: Initial
-- test + Re-test 1/2/3. They become a single repeatable section, so the rounds are
-- INSTANCES of one field set: a surveyor can add as many re-tests as needed and they
-- render with the repeatable-entry UI (insert / drag / collapse + colour bars). The
-- email summary reads the rounds as instances of the one field set — see
-- src/lib/uht/fields.ts + src/lib/uht/email.ts.
--
-- Data-safe: the only job on this template has every value in the Initial test +
-- Job details (instance 0), which map across unchanged. The re-test field ids
-- (…022–064) carry no answers on any job, so deleting them (FK CASCADE) loses
-- nothing. Re-running is a no-op.
-- ============================================================

-- 1) Turn the Initial-test section into the repeatable round.
UPDATE public.template_sections
   SET title = 'Test round', is_repeatable = true
 WHERE id = '75480000-0000-4000-8000-000000000006';

-- 2) Drop the three copied re-test sections; their fields cascade away
--    (template_fields.section_id REFERENCES template_sections ON DELETE CASCADE).
DELETE FROM public.template_sections
 WHERE id IN (
   '75480000-0000-4000-8000-000000000021',  -- Re-test 1
   '75480000-0000-4000-8000-000000000036',  -- Re-test 2
   '75480000-0000-4000-8000-000000000051'   -- Re-test 3
 );
