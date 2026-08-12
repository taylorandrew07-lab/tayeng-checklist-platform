-- ============================================================================
-- Migration 174: Pre-Hire Inspection — man-overboard manoeuvre and procedure
--
-- The life-saving section covered the EQUIPMENT and, at 6.8, recovering a person from
-- the water. It never asked about the manoeuvre that gets the ship back to them: the
-- turn itself, displayed on the bridge where the officer of the watch can reach it in
-- the first seconds, and the written procedure behind it in the safety management
-- system. On a vessel carrying 20 passengers on open deck twice a day, that is the
-- likeliest emergency of all, so it gets its own two questions rather than living
-- inside "a documented and practised means of recovery".
--
-- Placed immediately after 6.8 so the three read in the order they would happen:
-- manoeuvre, procedure, recovery.
--
-- (The "add your own item" box asked for on 6.2 needs nothing here — migration 173
-- switched validation.allow_other on for every tick-list in this template, 6.2 included.)
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
-- ============================================================================

-- Make room after 6.8 (EPIRB and pyrotechnics move down two).
UPDATE public.template_fields SET item_number = '6.11', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000000609';   -- EPIRB registration and battery
UPDATE public.template_fields SET item_number = '6.12', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-00000000060a';   -- Pyrotechnics in date

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001400','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Is a man-overboard manoeuvre displayed on the bridge?','yes_no_na',9,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6.9',true,NULL,
   'A card or placard at the conning position showing the turn to be used — Williamson, Anderson or Scharnov. Note which, and where it is posted.',false),

  ('c41d0000-0000-4000-8000-000000001401','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Is there a written man-overboard procedure in the safety management system?','yes_no_na',10,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6.10',true,NULL,
   'Beyond the bridge card: who does what, how the alarm is raised, who keeps the person in sight, and how the passengers are accounted for while it happens.',false)
ON CONFLICT (id) DO NOTHING;
