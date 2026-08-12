-- ============================================================================
-- Migration 180: Pre-Hire Inspection — two defects found by auditing the live template
--
-- (a) 10.4 "What does the vessel navigate on?" would have been DELETED from the report.
--
--     It is a dropdown, which is a header-candidate type, and its label contains the
--     bare word "vessel" with none of the qualifiers that mark a descriptor field
--     (isSurveyedVesselNameField, src/lib/utils/index.ts). So JobPDF would have taken it
--     for the vessel-name field, promoted it to the header block, and suppressed it from
--     the body — and because it is the gateway for four conditional follow-ups, those
--     would have printed underneath with no question above them.
--
--     Exactly the trap documented in migration 170's header, walked into by the
--     migration that added the chart-system branch. Renamed to carry no bare "vessel",
--     in the same style as 9.1 "Primary means of passenger transfer offshore".
--
-- (b) 1.1 Date survived migration 173 and now collides with Time boarded at 1.1.
--
--     This is the DELETE guard behaving correctly, not failing: the field had an answer,
--     so it refused to destroy it. The answer is on a not-yet-submitted test job
--     ("M.V. Test Vessel", created while the form was being reviewed) and its value is
--     identical to that job's scheduled_date — the very duplication the change removes.
--
--     So: drop the redundant answers on jobs that have NOT been submitted, then let the
--     same guarded DELETE run. A submitted survey's data is still untouchable — if one
--     exists, the field simply stays and the collision must be resolved by hand.
-- ============================================================================

-- ------------------------------------------------------------
-- (a) Keep the chart-system gateway out of the header
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Primary means of navigation'
 WHERE id = 'c41d0000-0000-4000-8000-000000001300';

-- ------------------------------------------------------------
-- (b) Retire the duplicated Date field
-- ------------------------------------------------------------
-- The report header takes the date from jobs.scheduled_date, so these answers are
-- redundant by construction. Only ever on an unsubmitted job.
DELETE FROM public.job_field_values v
 USING public.jobs j
 WHERE v.job_id = j.id
   AND v.field_id = 'c41d0000-0000-4000-8000-000000000100'
   AND j.submitted_at IS NULL;

DELETE FROM public.template_fields tf
 WHERE tf.id = 'c41d0000-0000-4000-8000-000000000100'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);
