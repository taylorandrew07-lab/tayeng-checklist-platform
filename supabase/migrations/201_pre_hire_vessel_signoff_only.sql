-- ============================================================================
-- Migration 201: Pre-Hire Inspection — the vessel signs, and only the vessel
--
-- Section 15 loses BOTH surveyor rows. Only the ship's representative signs off
-- the attendance now:
--
--   15.1  Ship's representative present at sign-off   (was 15.3)
--   15.2  Ship's representative signature             (was 15.4)
--
-- Removed:
--   15.1  Surveyor's name    — added by migration 200 hours earlier, not wanted
--   15.2  Signature          — the surveyor's own, and the ONLY required field on
--                              the whole template
--
-- ⚠️ NOTHING ON THIS TEMPLATE IS REQUIRED ANY MORE. The signature was the last one
-- (migrations 173–185 stripped the rest deliberately, so a form could never refuse to
-- submit at the quayside). The surveyor still reaches the report through the job
-- record — the header prints the Surveyor row from job_surveyors — but no field on
-- the form now forces anything before submit.
--
-- ⚠️ A SIGNATURE FIELD IS THE FIRST DELETE HERE THAT CAN DESTROY SIGNED DATA SILENTLY.
-- job_signatures.field_id is ON DELETE CASCADE (migration 001), so dropping a signature
-- field takes every signature ever captured on it — on submitted, issued reports
-- included, with no error. The guarded-delete pattern of migrations 182/184/197/200
-- checks job_field_values and job_photos only and would NOT have caught this.
--
-- THIS DELETE IS DELIBERATELY DESTRUCTIVE, and here is exactly what it destroys.
-- The first cut of this migration cleared only UNSUBMITTED jobs and asserted the rest;
-- it failed on its first run, which is how the following was established by querying
-- the live database rather than assumed:
--
--   * Exactly one Pre-Hire job exists: TEAL C/L #1280, "M.V. Navigator - Pre-Hire
--     Inspection - 21-07-2025", report 26-08-263, submitted 2026-08-26 13:39Z,
--     workflow_status report_ready.
--   * It holds one answer on 15.1 — the text "Captain Andrew Taylor".
--   * It holds one signature on 15.2, drawn 2026-08-26 17:56Z, minutes before the
--     instruction to remove the field arrived. Backed up before this ran.
--   * No photos hang off either field. No other job touches either field.
--
-- So the data removed below is the surveyor's own entry on the survey he was working
-- on when he asked for the rows to go. Being submitted does not protect it, because
-- removing the question IS the instruction — but a future migration must not copy this
-- clause blindly. Query first, state what dies, then write the DELETE.
--
-- The report renders from the LIVE template at download time (there is no snapshot),
-- so re-downloading 26-08-263 after this prints the vessel sign-off alone. Any PDF
-- already delivered to the client is a file and is unaffected.
--
-- Idempotent: guarded deletes, absolute renumbering keyed by field id, and a final
-- check that refuses to leave two questions on one number.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Clear the surveyor's entries — see the note above for exactly what this is
-- ------------------------------------------------------------
DELETE FROM public.job_field_values
 WHERE field_id IN (
         'c41d0000-0000-4000-8000-000000001100',   -- 15.1 Surveyor's name
         'c41d0000-0000-4000-8000-000000001101'    -- 15.2 Signature (surveyor)
       );

DELETE FROM public.job_signatures
 WHERE field_id = 'c41d0000-0000-4000-8000-000000001101';

-- ------------------------------------------------------------
-- 2. Remove both surveyor rows
--
-- Still guarded — on job_photos too, which nothing above clears. If a photo were
-- hanging off either field the delete would no-op and step 5 would fail loudly,
-- rather than the FK quietly taking the photo with it.
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000001100',
         'c41d0000-0000-4000-8000-000000001101'
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos     p WHERE p.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_signatures s WHERE s.field_id = tf.id);

-- ------------------------------------------------------------
-- 3. The ship's representative moves up to 15.1 / 15.2
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '15.1', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000001103';   -- was 15.3 ship's representative
UPDATE public.template_fields SET item_number = '15.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000001104';   -- was 15.4 ship's representative signature

-- ------------------------------------------------------------
-- 4. The section is the vessel's now, and says so
-- ------------------------------------------------------------
UPDATE public.template_sections
   SET title = 'Vessel Sign-off',
       description = 'Signed by the vessel''s representative, acknowledging the attendance.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000020';

-- ------------------------------------------------------------
-- 5. Refuse to leave two questions on one number
-- ------------------------------------------------------------
DO $$
DECLARE survivors TEXT;
BEGIN
  SELECT string_agg(item_number || ' — ' || label, '; ' ORDER BY item_number)
    INTO survivors
    FROM public.template_fields
   WHERE id IN ('c41d0000-0000-4000-8000-000000001100',
                'c41d0000-0000-4000-8000-000000001101');
  IF survivors IS NOT NULL THEN
    RAISE EXCEPTION
      'Pre-hire sign-off removal blocked — a photo still hangs off: %', survivors;
  END IF;
END $$;
