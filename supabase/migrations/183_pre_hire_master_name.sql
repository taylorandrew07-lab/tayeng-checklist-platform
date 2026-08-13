-- ============================================================================
-- Migration 183: Pre-Hire Inspection — record the Master's name
--
-- Who was in command on the day is part of the record, and it is the first thing you
-- establish when you step aboard — so it opens the crew section rather than being
-- appended to it. Section 4's existing items each move down one.
--
-- Safe against the header trap: a text field is a header candidate, but this label
-- carries no bare "vessel", and is neither "Date" nor "Port".
--
-- Idempotent: fixed UUID + ON CONFLICT DO NOTHING.
-- ============================================================================

-- Make room at the top of the crew section.
UPDATE public.template_fields SET item_number = '4.2', order_index = 1
  WHERE id = 'c41d0000-0000-4000-8000-000000000400';   -- Crew meets the safe manning doc
UPDATE public.template_fields SET item_number = '4.3', order_index = 2
  WHERE id = 'c41d0000-0000-4000-8000-000000000401';   -- Number of crew on board
UPDATE public.template_fields SET item_number = '4.4', order_index = 3
  WHERE id = 'c41d0000-0000-4000-8000-000000000402';   -- Certificates valid and in date
UPDATE public.template_fields SET item_number = '4.5', order_index = 4
  WHERE id = 'c41d0000-0000-4000-8000-000000000405';   -- Hours-of-rest records
UPDATE public.template_fields SET item_number = '4.6', order_index = 5
  WHERE id = 'c41d0000-0000-4000-8000-000000000409';   -- Drug and alcohol policy
UPDATE public.template_fields SET item_number = '4.7', order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-00000000040a';   -- Drill records
UPDATE public.template_fields SET item_number = '4.8', order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-00000000040b';   -- Working language

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001b00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Master''s name','text',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.1',false,NULL,
   'As shown on the certificate of competency sighted at 4.4.',false)
ON CONFLICT (id) DO NOTHING;
