-- ============================================================================
-- Migration 176: Pre-Hire Inspection — risk assessment for passenger transfer
--
-- Section 9 established HOW people get on and off offshore (9.1 and its per-method
-- follow-ups), the deck lighting, the stated weather limits and the man-overboard
-- procedure. It never asked for the document that should sit behind all of it: a risk
-- assessment for the transfer itself.
--
-- Placed immediately after the means-of-transfer branch, because the assessment is
-- supposed to be about the method actually in use — a generic one written for a
-- different vessel or a different installation is a finding in itself, which is why the
-- note asks whether it names this vessel and this location.
--
-- Idempotent: fixed UUID + ON CONFLICT DO NOTHING.
-- ============================================================================

-- Make room after the 9.1 branch.
UPDATE public.template_fields SET item_number = '9.3', order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-000000000905';   -- Transfer deck lighting
UPDATE public.template_fields SET item_number = '9.4', order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-000000000906';   -- Operating limits documented
UPDATE public.template_fields SET item_number = '9.5', order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-000000000907';   -- Max significant wave height
UPDATE public.template_fields SET item_number = '9.6', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-000000000908';   -- MOB procedure covering transfer

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001600','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is a risk assessment available for the transfer of passengers to and from offshore?','yes_no_na',5,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'9.2',true,NULL,
   'Ask to see it. Note whether it names this vessel, this transfer method and this location, when it was last reviewed, and who approved it — a generic assessment written for another vessel is worth recording as such.',false)
ON CONFLICT (id) DO NOTHING;
