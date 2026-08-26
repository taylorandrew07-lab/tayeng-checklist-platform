-- ============================================================================
-- Migration 200: Pre-Hire Inspection — a name against the signature
--
-- 15.1 was "Condition observed across hull, deck, machinery spaces and
-- accommodation" — a free-text narrative sitting on top of the signature block.
-- It goes, and the surveyor's NAME takes its place, because 15.2 is a signature
-- and a signature with no name beside it is not attributable on the printed report.
-- Section 15 now reads as a sign-off block and nothing else:
--
--   15.1  Surveyor's name                     (text)
--   15.2  Signature                           (signature, required — unchanged)
--   15.3  Ship's representative at sign-off   (text, unchanged)
--   15.4  Ship's representative signature     (unchanged)
--
-- Migration 182 deleted this same field ("Report prepared by", id …1100) on the
-- grounds that the surveyor already prints in the report HEADER. That is still true,
-- and it is still not the same thing as the name under the pen. Its id is deliberately
-- reused, so any answer that survived 182 lands back on the question it was typed for.
--
-- Nothing is lost from the body of the report: the narrative it replaces was a
-- retyping of the checklist, and the Summary of Findings (migration 182) is built
-- from the answers themselves.
--
-- The label deliberately avoids the bare word "vessel" and is not exactly "Date" or
-- "Port": those are what the PDF hoists into the header block and suppresses from the
-- body (lib/pdf/JobPDF.tsx). "Surveyor's name" matches none of them and prints where
-- it was written.
--
-- LAST of the three pre-hire migrations in this batch on purpose. It is the only one
-- that can fail — a submitted survey holding the narrative blocks the delete — and
-- failing it must not take 198 or 199 down with it.
--
-- Idempotent: the delete is guarded on answers and photos, the insert is an upsert,
-- and the final check refuses to leave two questions wearing 15.1.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Clear the narrative's answers on unsubmitted jobs
--    (the migration 184/197 pattern — a submitted survey is never touched, and its
--    data still blocks the delete below)
-- ------------------------------------------------------------
DELETE FROM public.job_field_values v
 USING public.jobs j
 WHERE v.job_id = j.id
   AND j.submitted_at IS NULL
   AND v.field_id = 'c41d0000-0000-4000-8000-000000001220';   -- 15.1 condition observed

-- ------------------------------------------------------------
-- 2. Remove the narrative
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id = 'c41d0000-0000-4000-8000-000000001220'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 3. The surveyor's name takes 15.1
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001100',
   'c41d0000-0000-4000-8000-000000000001',
   'c41d0000-0000-4000-8000-000000000020',
   'Surveyor''s name', 'text', 0, false,
   '[]'::jsonb, '{}'::jsonb, NULL, NULL, '15.1', false, NULL,
   'The name that goes with the signature below.', false)
ON CONFLICT (id) DO UPDATE SET
  section_id          = EXCLUDED.section_id,
  label               = EXCLUDED.label,
  field_type          = EXCLUDED.field_type,
  order_index         = EXCLUDED.order_index,
  is_required         = EXCLUDED.is_required,
  options             = EXCLUDED.options,
  conditional_logic   = EXCLUDED.conditional_logic,
  item_number         = EXCLUDED.item_number,
  with_remarks        = EXCLUDED.with_remarks,
  help_text           = EXCLUDED.help_text,
  pdf_hide_when_empty = EXCLUDED.pdf_hide_when_empty;

-- ------------------------------------------------------------
-- 4. Refuse to leave two questions on 15.1
--
-- If the removal was blocked, the narrative keeps 15.1 while the name takes the same
-- number. Better to fail loudly than to print a sign-off page with two 15.1s.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.template_fields
              WHERE id = 'c41d0000-0000-4000-8000-000000001220') THEN
    RAISE EXCEPTION
      'Pre-hire 15.1 removal blocked — a submitted survey still holds the condition narrative (field …1220). Move or clear that answer, then re-run.';
  END IF;
END $$;
