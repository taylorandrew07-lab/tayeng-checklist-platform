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
--   15.1  Surveyor's name    — added by migration 200 one day ago, no longer wanted
--   15.2  Signature          — the surveyor's own, and the ONLY required field on
--                              the whole template
--
-- ⚠️ NOTHING ON THIS TEMPLATE IS REQUIRED ANY MORE. The signature was the last one
-- (migrations 173–185 stripped the rest deliberately, so a form could never refuse to
-- submit at the quayside). The surveyor still reaches the report through the job
-- record — the header prints the Surveyor row from job_surveyors — but no field on
-- the form now forces anything to be filled in before submit.
--
-- ⚠️ A SIGNATURE FIELD IS THE FIRST DELETE HERE THAT CAN DESTROY SIGNED DATA SILENTLY.
-- job_signatures.field_id is ON DELETE CASCADE (migration 001), so dropping a
-- signature field takes every signature ever captured on it with it — on submitted,
-- issued reports included, with no error. The guarded-delete pattern used by
-- migrations 182/184/197/200 checks job_field_values and job_photos only, which would
-- not have caught this. The delete below is guarded on job_signatures as well.
--
-- Idempotent: guarded deletes, absolute renumbering keyed by field id, and a final
-- check that refuses to leave two questions on one number.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Clear the surveyor's own answers on unsubmitted jobs
--    (the migration 184/197/200 pattern — a submitted survey is never touched, and
--    its data still blocks the deletes below)
-- ------------------------------------------------------------
DELETE FROM public.job_field_values v
 USING public.jobs j
 WHERE v.job_id = j.id
   AND j.submitted_at IS NULL
   AND v.field_id IN (
         'c41d0000-0000-4000-8000-000000001100',   -- 15.1 Surveyor's name
         'c41d0000-0000-4000-8000-000000001101'    -- 15.2 Signature (surveyor)
       );

DELETE FROM public.job_signatures s
 USING public.jobs j
 WHERE s.job_id = j.id
   AND j.submitted_at IS NULL
   AND s.field_id = 'c41d0000-0000-4000-8000-000000001101';

-- ------------------------------------------------------------
-- 2. Remove both surveyor rows
--
-- The job_signatures guard is the one that matters: without it the FK would cascade
-- a signed report's signature away without a word.
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
--
-- If either delete was blocked, the surveyor row keeps 15.1 or 15.2 while the ship's
-- representative takes the same number. Fail loudly rather than print it twice — and
-- name job_signatures, because that is the blocker nobody expects.
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
      'Pre-hire sign-off removal blocked — a submitted survey still holds data (an answer, a photo, or a SIGNATURE in job_signatures) on: %', survivors;
  END IF;
END $$;
