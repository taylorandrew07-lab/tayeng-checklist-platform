-- ============================================================
-- Migration 140: Brine Transfer — report presentation.
--
-- All four changes are DATA ONLY, confined to the Brine template. No renderer code is
-- touched, so no other checklist can be affected.
--
-- 1. HEADER. The report header is already a two-column block — Vessel / Client / Date /
--    Surveyor on the left, Port / Method of Delivery on the right (JobPDF.tsx:614-628).
--    Brine had nothing to fill the right column because it has no Date, Port or Method of
--    Delivery field. Adding them to Job Details populates it; JobPDF picks them up by
--    label (/\bdate\b/, /\bport\b/, /method.*delivery/) and suppresses them from the body.
--
-- 2. SUB-HEADINGS REMOVED. Every in-section heading field ("Charter history", "Shore
--    side", "Segregation"…) is deleted. The five phase sections plus Job Details and the
--    reconciliation block carry all the structure the report needs.
--
-- 3. DISCLAIMER REMOVED — pdf_disclaimer cleared for this template only.
--
-- 4. VARIANCE ON ONE LINE. 137 had a separate "% Variance" field beneath the Difference.
--    The fuel transfer report instead puts both in a single calculated field: the badge
--    reads "<difference> <unit>: <pct>%". Matching that here — the standalone % field is
--    dropped and display_as/thresholds move onto the Difference itself.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop the disclaimer (this template only)
-- ------------------------------------------------------------
UPDATE public.checklist_templates
   SET pdf_disclaimer = NULL
 WHERE id = 'b21e0000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- 2. Remove every in-section sub-heading
--    (headings never hold answers, so nothing is orphaned)
-- ------------------------------------------------------------
DELETE FROM public.template_fields
 WHERE template_id = 'b21e0000-0000-4000-8000-000000000001'
   AND field_type = 'heading';

-- ------------------------------------------------------------
-- 3. Header fields — Date, Port, Method of Delivery.
--    Job Details already holds Operation (order 0) and Cargo type (order 1).
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
VALUES
  ('b21e0000-0000-4000-8000-000000000210','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000010',
   'Date','date',2,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000211','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000010',
   'Port','text',3,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000212','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000010',
   'Method of Delivery','dropdown',4,true,
   '[{"value":"shore_line","label":"Shore line / jetty"},{"value":"road_tanker_wagon","label":"Road tanker wagon"},{"value":"barge","label":"Barge"},{"value":"ship_to_ship","label":"Ship to ship"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'',false,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Difference and variance on one line, as the fuel transfer report does.
--    The denominator is the LAST {uuid} token in the formula — the shore figure — so the
--    percentage is still measured against shore. Colour bands unchanged: green under 1%,
--    amber 1-2%, red 2%+, on the absolute value.
-- ------------------------------------------------------------
DELETE FROM public.job_field_values
 WHERE field_id = 'b21e0000-0000-4000-8000-000000000194';
DELETE FROM public.template_fields
 WHERE id = 'b21e0000-0000-4000-8000-000000000194';

UPDATE public.template_fields SET
  label      = 'Difference (Ship − Shore)',
  unit       = 'BBLS',
  validation = jsonb_build_object('display_as','percentage','thresholds',jsonb_build_array(
                 jsonb_build_object('max',1.0,'color','green'),
                 jsonb_build_object('max',2.0,'color','amber'),
                 jsonb_build_object('color','red'))),
  help_text  = 'Ship minus shore, with the variance against the shore figure. Negative when the ship received less.'
WHERE id = 'b21e0000-0000-4000-8000-000000000193';

-- ------------------------------------------------------------
-- 5. Restate order for the two sections whose contents changed, so nothing ties.
-- ------------------------------------------------------------
UPDATE public.template_fields AS f SET order_index = v.idx
FROM (VALUES
  ('b21e0000-0000-4000-8000-000000000191', 0),  -- Ship's figure
  ('b21e0000-0000-4000-8000-000000000192', 1),  -- Shore figure
  ('b21e0000-0000-4000-8000-000000000193', 2),  -- Difference (+ variance)
  ('b21e0000-0000-4000-8000-000000000195', 3)   -- item 32, cargo certificate
) AS v(id, idx)
WHERE f.id = v.id::uuid;
