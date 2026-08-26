-- ============================================================================
-- Migration 199: Pre-Hire Inspection — are the safe working loads marked?
--
-- Section 12, Deck, Hull & Mooring, asked whether the mooring equipment and the
-- cargo securing arrangements were in good order, but never whether the fittings
-- carry their SWL. An unmarked bollard or pad eye is a real finding on a pre-hire:
-- the gear may be sound and still unusable, because nobody on deck can know what
-- it is rated for.
--
-- Two questions, each placed beside the equipment it is about rather than bolted on
-- at the end of the section:
--
--   12.10  Are the safe working loads marked on the bollards, bitts and fairleads?
--            — follows 12.9, the mooring equipment itself.
--   12.13  Are the safe working loads marked and legible on the lashing points and
--          pad eyes?
--            — follows 12.12, the cargo deck and its securing arrangements.
--
-- Everything after each insertion moves down, so the section stays a clean run
-- 12.1 … 12.14 with no holes and no letters. Standard palette: not marked is red.
--
-- Idempotent: the insert is an upsert on a fixed id, and every renumber is an
-- absolute value keyed by field id, so a second run changes nothing.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Make room — renumber from 12.10 down
--
--    Absolute values, applied bottom-up in print order. 12.1 to 12.9 do not move.
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '12.11', order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-000000000a0c';   -- was 12.10 anchors, windlass and cable
UPDATE public.template_fields SET item_number = '12.12', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000001222';   -- was 12.11 cargo deck and securing arrangements
UPDATE public.template_fields SET item_number = '12.14', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000000d06';   -- was 12.12 restricted areas marked and controlled

-- ------------------------------------------------------------
-- 2. The two new questions
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001d00',
   'c41d0000-0000-4000-8000-000000000001',
   'c41d0000-0000-4000-8000-00000000001b',
   'Are the safe working loads marked on the bollards, bitts and fairleads?', 'yes_no_na', 9, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb, NULL, NULL, '12.10', true, NULL,
   'Marked at or beside each fitting, and still legible. 12.9 asks whether the mooring gear is sound; this asks whether the deck can tell what it is rated for. Name any fitting that is unmarked or unreadable in the remarks.', false),
  ('c41d0000-0000-4000-8000-000000001d01',
   'c41d0000-0000-4000-8000-000000000001',
   'c41d0000-0000-4000-8000-00000000001b',
   'Are the safe working loads marked and legible on the lashing points and pad eyes?', 'yes_no_na', 12, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb, NULL, NULL, '12.13', true, NULL,
   'Deck lashing points, pad eyes and securing rings — the SWL marked at each and still readable. Name any that are unmarked in the remarks.', false)
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
-- 3. Refuse to leave the section with two questions on one number
-- ------------------------------------------------------------
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(item_number || ' ×' || n, ', ' ORDER BY item_number)
    INTO dupes
    FROM (SELECT item_number, count(*) AS n
            FROM public.template_fields
           WHERE section_id = 'c41d0000-0000-4000-8000-00000000001b'
             AND coalesce(item_number, '') <> ''
           GROUP BY item_number
          HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-hire Deck, Hull & Mooring left with duplicate item numbers: %', dupes;
  END IF;
END $$;
