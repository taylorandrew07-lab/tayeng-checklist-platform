-- ============================================================================
-- Migration 175: Pre-Hire Inspection — fixed fire-fighting and fire detection
--
-- Section 7 already asked whether the detection panel was tested and whether the fixed
-- machinery-space system was in date with its release station clear. Both are one
-- question deep: they establish that the equipment exists and is not overdue, but not
-- what it covers, how it is released, or whether anyone has been trained to do it.
--
-- Detection gains: which spaces are covered, whether the alarm repeats where the watch
-- actually is, and when the system was last properly tested rather than lamp-tested.
--
-- Fixed system gains: the medium and what it protects, when the cylinders were last
-- weighed or pressure-checked, whether the ventilation closures and fuel shut-offs are
-- part of the release procedure, and whether the crew know how to do it. A CO2 system
-- released into a space still being ventilated does nothing at all, and that is a
-- procedure question, not a certificate question.
--
-- The two blocks are placed with their existing questions — detection after 7.3, fixed
-- system after the current 7.5 — so each area reads as one thought.
--
-- (7.2's "add your own item" box needs nothing here: migration 173 switched
-- validation.allow_other on for every tick-list in this template.)
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
-- ============================================================================

-- Renumber the tail of section 7 to make room for both blocks.
UPDATE public.template_fields SET item_number = '7.7',  order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-000000000704';   -- Fire main pressure at furthest hydrant
UPDATE public.template_fields SET item_number = '7.8',  order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-000000000705';   -- Fixed system in date, station clear
UPDATE public.template_fields SET item_number = '7.13', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000000706';   -- Emergency stops and remote shut-offs
UPDATE public.template_fields SET item_number = '7.14', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000000707';   -- SCBA cylinder pressures
UPDATE public.template_fields SET item_number = '7.15', order_index = 15
  WHERE id = 'c41d0000-0000-4000-8000-000000000708';   -- General alarm audible

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES

-- ===== Fire detection (follows 7.3, the panel test) =========================
  ('c41d0000-0000-4000-8000-000000001500','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Which spaces are covered by fire detection?','text',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.4',false,NULL,
   'Machinery space, accommodation, galley, passenger space, store rooms. Note anything conspicuously not covered.',false),
  ('c41d0000-0000-4000-8000-000000001501','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Does the fire alarm repeat on the bridge or at the manned control position?','yes_no_na',5,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.5',true,NULL,
   'A panel that only sounds in an unmanned space is not a detection system anyone will hear.',false),
  ('c41d0000-0000-4000-8000-000000001502','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Date of the last full test or service of the detection system','text',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.6',false,NULL,
   'A full test of the detector heads, not the panel''s own lamp test. Note who carried it out.',false),

-- ===== Fixed fire-fighting (follows 7.8, the in-date check) =================
  ('c41d0000-0000-4000-8000-000000001503','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Type of fixed fire-fighting system, and the spaces it protects','text',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.9',false,NULL,
   'CO2, foam, water mist or clean agent; the number of cylinders or the quantity held; and which spaces it covers.',false),
  ('c41d0000-0000-4000-8000-000000001504','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Date of the last weight or pressure check of the fixed system','text',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.10',false,NULL,
   'Cylinders are weighed or pressure-tested on a cycle; the certificate on the door is not the same thing as the check.',false),
  ('c41d0000-0000-4000-8000-000000001505','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Does the release procedure cover shutting down ventilation and fuel to the space?','yes_no_na',11,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.11',true,NULL,
   'Closures, dampers, fans and quick-closing valves — whether interlocked or listed as steps. An agent released into a ventilated space does nothing.',false),
  ('c41d0000-0000-4000-8000-000000001506','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Are the crew familiar with the release procedure, including the head count before release?','yes_no_na',12,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.12',true,NULL,
   'Ask an officer to talk you through it. Record who you asked in the remarks.',false)
ON CONFLICT (id) DO NOTHING;
