-- ============================================================================
-- Migration 184: Pre-Hire Inspection — manning figures, attached documents,
--                real drydocking dates, and the MOB procedure
--
-- 1. MANNING. "Does the crew meet or exceed the safe manning document?" was a yes/no
--    that threw away the two numbers a reader actually wants. It becomes the required
--    minimum and the actual figure, side by side, so the margin is visible and the
--    reader draws their own conclusion — which is what a facts-only report should do.
--
-- 2. ATTACHED DOCUMENTS. The ship's particulars and the crew list are documents the
--    vessel already holds. Photograph them rather than transcribe them: faster on board,
--    and a photograph of the real document is better evidence than a typed copy of it.
--
-- 3. DRYDOCKING became two proper date fields instead of one free-text box holding both
--    dates. Safe from the header trap only because Date/Port matching is now EXACT —
--    under the old loose word-match, "Date of last drydocking" would have been captured
--    as the report's Date row and deleted from the body.
--
-- 4. MOB. 6.8 asked about recovering a person from the water, which since migration 174
--    is part of what 6.9 and 6.10 cover. It goes, and recovery is folded into the
--    procedure question's note — the manoeuvre, the procedure, and how the person is
--    actually brought aboard are one sequence, not three checklist items.
--
-- 5. LSA and FFA training manuals, and the instructions posted about the vessel.
--
-- 6. Defect reporting becomes defect reporting AND CLOSE-OUT — raising a defect is the
--    easy half; the system is only worth anything if it shows them being closed.
--
-- Stale answers: three fields change type or meaning, so their values are cleared on
-- jobs that have NOT been submitted. A submitted survey is never touched.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; deletes guarded on answers/photos.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Manning: the two figures, not a yes/no
-- ------------------------------------------------------------
DELETE FROM public.job_field_values v USING public.jobs j
 WHERE v.job_id = j.id AND j.submitted_at IS NULL
   AND v.field_id IN ('c41d0000-0000-4000-8000-000000000400',
                      'c41d0000-0000-4000-8000-000000000401',
                      'c41d0000-0000-4000-8000-00000000030a');

UPDATE public.template_fields
   SET label = 'Minimum manning required by the Safe Manning Document',
       field_type = 'number', options = '[]'::jsonb, with_remarks = false,
       help_text = 'The total the document requires.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000400';

UPDATE public.template_fields
   SET label = 'Actual manning level on board',
       field_type = 'number', options = '[]'::jsonb, with_remarks = false,
       help_text = 'Heads counted on the day. Note any shortfall against 4.2, and against which rank, in the findings.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000401';

-- ------------------------------------------------------------
-- 2. Drydocking: two real dates
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Date of last drydocking', field_type = 'date', help_text = NULL
 WHERE id = 'c41d0000-0000-4000-8000-00000000030a';

UPDATE public.template_fields SET item_number = '3.10', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-00000000030b';   -- PSC / flag deficiencies
UPDATE public.template_fields SET item_number = '3.11', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-00000000030c';   -- Previous CMID / OVID report
UPDATE public.template_fields SET item_number = '3.12', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000001212';   -- Class surveys up to date

-- ------------------------------------------------------------
-- 3. MOB: drop the separate recovery question, fold it into the procedure
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id = 'c41d0000-0000-4000-8000-000000000608'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

UPDATE public.template_fields SET item_number = '6.8', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-000000001400';   -- MOB manoeuvre on the bridge
UPDATE public.template_fields
   SET item_number = '6.9', order_index = 10,
       help_text = 'Beyond the bridge card: who does what, how the alarm is raised, who keeps the person in sight, how the passengers are accounted for meanwhile, and how the person is actually recovered from the water — the equipment used and whether the crew have practised it. It should cover a person lost during a transfer as well as one lost on passage.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001401';   -- Written MOB procedure
UPDATE public.template_fields SET item_number = '6.10', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000000609';   -- EPIRB
UPDATE public.template_fields SET item_number = '6.11', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-00000000060a';   -- Pyrotechnics

-- ------------------------------------------------------------
-- 4a. Vessel particulars: stop transcribing the dimensions
--
-- Length overall and breadth are on the particulars sheet being photographed at 2.11.
-- Typing them again on the quayside adds a chance to mistype and nothing else.
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000000206',   -- 2.7 Length overall
         'c41d0000-0000-4000-8000-000000000207'    -- 2.8 Breadth moulded
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

UPDATE public.template_fields SET item_number = '2.7',  order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-000000000208';   -- Maximum draught
UPDATE public.template_fields SET item_number = '2.8',  order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-00000000020a';   -- Gross tonnage
UPDATE public.template_fields SET item_number = '2.9',  order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-00000000020b';   -- Main propulsion and power
UPDATE public.template_fields SET item_number = '2.10', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-00000000020c';   -- Registered owner and manager

-- ------------------------------------------------------------
-- 4. Defect reporting AND close-out
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Is a defect reporting and close-out system in use?',
       help_text = 'How a defect found by the crew is raised, tracked and CLOSED. Ask to see a few recent entries closed out, not just raised — an open list nobody clears is the finding.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001215';

-- ------------------------------------------------------------
-- 5. New fields
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  -- Ship's particulars, photographed rather than transcribed
  ('c41d0000-0000-4000-8000-000000001b01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Ship''s particulars — attach','photo',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.11',false,NULL,
   'Photograph the vessel''s own particulars sheet. Quicker than transcribing it, and a picture of the real document is the better record.',false),

  -- Crew list, likewise
  ('c41d0000-0000-4000-8000-000000001b02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Crew list — attach','photo',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.9',false,NULL,
   'Photograph the crew list as posted or as produced by the Master.',false),

  -- Next drydocking
  ('c41d0000-0000-4000-8000-000000001b03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Next drydocking due','date',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.9',false,NULL,NULL,false),

  -- LSA / FFA manuals and posted instructions
  ('c41d0000-0000-4000-8000-000000001b04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Are the LSA and FFA training manuals on board, with instructions posted throughout the vessel?','yes_no_na',13,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6.12',true,NULL,
   'The training manuals themselves, plus the posted instructions and placards — muster stations, lifejacket donning, liferaft launching, extinguisher use — at the stations they refer to, not filed in the ship''s office.',false)
ON CONFLICT (id) DO NOTHING;
