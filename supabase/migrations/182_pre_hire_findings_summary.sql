-- ============================================================================
-- Migration 182: Pre-Hire Inspection — an automatic list of the defects, and the
--                end of the form that asked for things already known
--
-- (a) THE DEFECT LIST. The report now opens with a "Summary of Findings" built from the
--     answers themselves: every question whose answer reads as a finding, with its item
--     number, the question, the remark and the answer badge. Nothing is typed twice, and
--     nothing can be forgotten off the list.
--
--     The rule is the ANSWER COLOUR, not the word "No" — because several questions are
--     deliberately reversed (outstanding conditions of class, overdue maintenance, PSC
--     deficiencies, breakdowns) where YES is the problem and No is green. Listing every
--     "No" would report those backwards and miss the real findings. Red and amber are
--     findings; green is not; grey is N/A. N/I is amber, so an item nobody could inspect
--     appears too — it is an open question, not a pass.
--
-- (b) SECTION 15, Attendance Summary, is removed. Areas inspected, areas not inspected
--     and the limitations were being retyped when the checklist already records all of
--     it: an unanswered question, or one marked N/I, IS the record of what was not
--     inspected.
--
--     Its 14.3 also gated the Findings section — which is why Findings was invisible and
--     the form appeared to jump from 13 to Sign-off. With the gate gone, Findings is
--     always shown. Nothing in it is required, so it costs nothing when empty.
--
-- (c) SIGN-OFF loses "Report prepared by" and "Signed on". The surveyor is on the job
--     record and already prints in the report header; the date is the survey date, which
--     is also already in the header. Both were double entry.
--
-- Idempotent. Field deletes are guarded against any answer or photo; the section is only
-- dropped once genuinely empty, because template_sections CASCADEs to template_fields
-- and deleting it outright would bypass that guard.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Turn on the summary
-- ------------------------------------------------------------
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_deficiency_summary BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.pdf_deficiency_summary IS
  'Open the report with an auto-built Summary of Findings: every answer whose resolved colour is red or amber, in checklist order. Colour-driven so deliberately reversed questions (where Yes is the finding) are captured correctly.';

UPDATE public.checklist_templates
   SET pdf_deficiency_summary = true
 WHERE id = 'c41d0000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- 2. Findings is no longer gated
-- ------------------------------------------------------------
UPDATE public.template_sections
   SET conditional_logic = NULL,
       description = 'Anything worth recording that is not already a question above — an observation in passing, or a defect that spans several items. Photographs of a specific defect belong on that question, not here.'
 WHERE id = 'c41d0000-0000-4000-8000-00000000001f';

-- ------------------------------------------------------------
-- 3. Remove the Attendance Summary section
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.section_id = 'c41d0000-0000-4000-8000-00000000001e'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

DELETE FROM public.template_sections ts
 WHERE ts.id = 'c41d0000-0000-4000-8000-00000000001e'
   AND NOT EXISTS (SELECT 1 FROM public.template_fields f WHERE f.section_id = ts.id);

-- ------------------------------------------------------------
-- 4. Sign-off: drop what the job record already knows
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000001100',   -- Report prepared by → job_surveyors
         'c41d0000-0000-4000-8000-000000001102'    -- Signed on         → jobs.scheduled_date
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 5. Close the gaps left behind
--
-- Guarded on the section actually being gone, so a blocked delete cannot leave two
-- sections sharing an order_index.
-- ------------------------------------------------------------
UPDATE public.template_sections ts SET order_index = order_index - 1
 WHERE ts.template_id = 'c41d0000-0000-4000-8000-000000000001'
   AND ts.order_index > 13
   AND NOT EXISTS (SELECT 1 FROM public.template_sections x
                    WHERE x.id = 'c41d0000-0000-4000-8000-00000000001e');

UPDATE public.template_fields SET item_number = '15.1', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000001101';           -- Signature
UPDATE public.template_fields SET item_number = '15.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000001103';           -- Ship's representative
UPDATE public.template_fields SET item_number = '15.3', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000001104';           -- Ship's rep signature
