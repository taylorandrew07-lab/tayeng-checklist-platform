-- ============================================================
-- Migration 138: Brine Transfer Checklist — off-spec chain, N/A coverage,
--                selectable flow-meter units, and a full renumber.
--
-- Reworks the template seeded by 137 after the first walk-through on a real job.
--
-- 1. THE OFF-SPEC CHAIN REPLACES ITEM 22.
--    137 had a single item 22 ("have the charterers been notified the cargo is
--    off-spec?") revealed by an OR across four separate inspection results. That reads
--    poorly on the form — the question appears far from the sample that failed — and it
--    depends on answers in a later section. Every sample question now carries its own
--    escalation, directly beneath it:
--        N   was a sample taken?          → NA shown when N = Yes
--        NA  was it approved?             → NB shown when N = Yes AND NA = No
--        NB  have the charterers been notified that the cargo is off-spec?
--    Item 22 is deleted. Applied to all four sample questions (line sample, first foot,
--    second line sample, periodic samples).
--
-- 2. RENUMBER. Deleting 22 shifts everything after it down one; the form now runs 1..32.
--    Numbers are set explicitly per field id below rather than computed, so there is no
--    ordering hazard and no collision. Stored answers are keyed by field id, so the
--    existing draft job keeps every answer it already has.
--
-- 3. N/A ON THE VESSEL'S SOUNDING AND FLOW-METER ITEMS (old 14, 15, 29, 30). A vessel may
--    have no ATGs — so no manual sounding — and may have no flow meter at all. Those four
--    were strict Yes/No and left the surveyor stuck. Shore-side equivalents keep strict
--    Yes/No; the shore installation always has them.
--
-- 4. ITEM 3 becomes Yes/No/N-A with remarks ("was there previous cargo loaded in the
--    tanks?"), with the cargo itself recorded in the remarks. It was a required free-text
--    box that blocked submission when there simply was no previous cargo.
--
-- 5. FLOW-METER VOLUMES get a unit picker (m³ / litres / US gallons / barrels) — meters
--    are not all calibrated in the same unit. The reconciliation block stays in BBLS.
--
-- Idempotent: safe to re-run. New fields use ON CONFLICT DO NOTHING; updates are by id.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Item 3 — free text → Yes/No/N-A with remarks
-- ------------------------------------------------------------
UPDATE public.template_fields SET
  label       = 'Was there previous cargo loaded in the tanks?',
  field_type  = 'yes_no_na',
  with_remarks = true,
  is_required = true,
  help_text   = 'If Yes, record what the previous cargo was in the remarks.'
WHERE id = 'b21e0000-0000-4000-8000-000000000115';

-- ------------------------------------------------------------
-- 2. N/A on the vessel's sounding + flow-meter items
--    (a vessel may have no ATGs and no flow meter)
-- ------------------------------------------------------------
UPDATE public.template_fields SET field_type = 'yes_no_na'
WHERE id IN (
  'b21e0000-0000-4000-8000-000000000137',  -- initial manual sounding, ship's tanks
  'b21e0000-0000-4000-8000-000000000138',  -- initial photograph, ship's flow meter
  'b21e0000-0000-4000-8000-000000000183',  -- final manual sounding, ship's tanks
  'b21e0000-0000-4000-8000-000000000184'   -- final photograph, ship's flow meter
);

-- ------------------------------------------------------------
-- 3. Second line sample — say "second" on the question itself,
--    so it reads consistently with its sub-item
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Was a second line sample taken at the ship''s manifold on resumption of loading?'
 WHERE id = 'b21e0000-0000-4000-8000-000000000163';

UPDATE public.template_fields
   SET label = 'Was the second line sample visually inspected and approved?'
 WHERE id = 'b21e0000-0000-4000-8000-000000000164';

-- ------------------------------------------------------------
-- 4. Retire item 22 (its four triggers each get their own escalation below)
-- ------------------------------------------------------------
DELETE FROM public.job_field_values
 WHERE field_id = 'b21e0000-0000-4000-8000-000000000149';
DELETE FROM public.template_fields
 WHERE id = 'b21e0000-0000-4000-8000-000000000149';

-- ------------------------------------------------------------
-- 5. Make room, then add the four "charterers notified" escalations.
--    Each is gated on its OWN sample chain: parent = Yes AND approval = No.
--    The parent condition is repeated because conditional logic is evaluated flat
--    against stored values — without it, a B item would surface whenever its A item
--    was blank, including when the sample was never taken.
-- ------------------------------------------------------------
UPDATE public.template_fields SET order_index = 18 WHERE id = 'b21e0000-0000-4000-8000-000000000147';
UPDATE public.template_fields SET order_index = 19 WHERE id = 'b21e0000-0000-4000-8000-000000000148';
UPDATE public.template_fields SET order_index = 6  WHERE id = 'b21e0000-0000-4000-8000-000000000165';
UPDATE public.template_fields SET order_index = 7  WHERE id = 'b21e0000-0000-4000-8000-000000000166';
UPDATE public.template_fields SET order_index = 8  WHERE id = 'b21e0000-0000-4000-8000-000000000167';

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
VALUES
  -- 20B — line sample at commencement not approved
  ('b21e0000-0000-4000-8000-000000000150','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Have the charterers been notified that the cargo is off-spec?','yes_no_na',17,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000145','operator','equals','value','yes'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000146','operator','equals','value','no'))),
   '20B',true,NULL,'Shown because the line sample was not approved. Record when and how the charterers were told.'),

  -- 21B — first foot samples not approved
  ('b21e0000-0000-4000-8000-000000000151','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Have the charterers been notified that the cargo is off-spec?','yes_no_na',20,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000147','operator','equals','value','yes'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000148','operator','equals','value','no'))),
   '21B',true,NULL,'Shown because a first foot sample was not approved. Record when and how the charterers were told.'),

  -- 23B — second line sample not approved
  ('b21e0000-0000-4000-8000-000000000168','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Have the charterers been notified that the cargo is off-spec?','yes_no_na',5,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000163','operator','equals','value','yes'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000164','operator','equals','value','no'))),
   '23B',true,NULL,'Shown because the second line sample was not approved. Record when and how the charterers were told.'),

  -- 24B — periodic samples not satisfactory
  ('b21e0000-0000-4000-8000-000000000169','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Have the charterers been notified that the cargo is off-spec?','yes_no_na',9,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000166','operator','equals','value','yes'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000167','operator','equals','value','no'))),
   '24B',true,NULL,'Shown because a periodic sample was not satisfactory. Record when and how the charterers were told.')
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 6. Flow-meter volume units — a meter may read m³, litres, gallons or barrels.
--    One picker beside each reading, shown under the same condition as the reading.
-- ------------------------------------------------------------
UPDATE public.template_fields SET order_index = 7  WHERE id = 'b21e0000-0000-4000-8000-000000000186';
UPDATE public.template_fields SET order_index = 8  WHERE id = 'b21e0000-0000-4000-8000-000000000187';
UPDATE public.template_fields SET order_index = 9  WHERE id = 'b21e0000-0000-4000-8000-000000000188';
UPDATE public.template_fields SET order_index = 10 WHERE id = 'b21e0000-0000-4000-8000-000000000189';

-- The volume fields no longer claim BBLS in their own right; the picker states the unit.
UPDATE public.template_fields SET unit = NULL
 WHERE id IN ('b21e0000-0000-4000-8000-000000000185','b21e0000-0000-4000-8000-000000000189');

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
VALUES
  ('b21e0000-0000-4000-8000-000000000200','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Ship''s flow meter — unit','dropdown',6,false,
   '[{"value":"bbls","label":"Barrels (BBLS)"},{"value":"m3","label":"Cubic metres (m³)"},{"value":"litres","label":"Litres"},{"value":"usg","label":"US gallons (USG)"}]'::jsonb,
   '{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000184','operator','equals','value','yes'))),
   '',false,NULL,'The unit the ship''s flow meter is calibrated in.'),

  ('b21e0000-0000-4000-8000-000000000201','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Shore flow meter — unit','dropdown',11,false,
   '[{"value":"bbls","label":"Barrels (BBLS)"},{"value":"m3","label":"Cubic metres (m³)"},{"value":"litres","label":"Litres"},{"value":"usg","label":"US gallons (USG)"}]'::jsonb,
   '{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000188','operator','equals','value','yes'))),
   '',false,NULL,'The unit the shipper''s shore flow meter is calibrated in.'),

  -- The reconciliation stays in BBLS, so say so where the surveyor will read it.
  ('b21e0000-0000-4000-8000-000000000202','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Convert both figures to barrels (BBLS) before entering them below.','heading',0,false,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE public.template_fields SET order_index = 1 WHERE id = 'b21e0000-0000-4000-8000-000000000190';

-- ------------------------------------------------------------
-- 7. Renumber 1..32. Set explicitly per field id — no computed sequence, no collisions.
--    Only the numbers after the retired item 22 move.
-- ------------------------------------------------------------
UPDATE public.template_fields AS f SET item_number = v.num
FROM (VALUES
  ('b21e0000-0000-4000-8000-000000000161','22'),   -- was 23  rate increase
  ('b21e0000-0000-4000-8000-000000000163','23'),   -- was 24  second line sample
  ('b21e0000-0000-4000-8000-000000000164','23A'),  -- was 24A
  ('b21e0000-0000-4000-8000-000000000166','24'),   -- was 25  periodic samples
  ('b21e0000-0000-4000-8000-000000000167','24A'),  -- was 25A
  ('b21e0000-0000-4000-8000-000000000170','25'),   -- was 26  hourly shore line inspection
  ('b21e0000-0000-4000-8000-000000000181','26'),   -- was 27
  ('b21e0000-0000-4000-8000-000000000182','27'),   -- was 28
  ('b21e0000-0000-4000-8000-000000000183','28'),   -- was 29
  ('b21e0000-0000-4000-8000-000000000184','29'),   -- was 30
  ('b21e0000-0000-4000-8000-000000000185','29A'),  -- was 30A
  ('b21e0000-0000-4000-8000-000000000187','30'),   -- was 31
  ('b21e0000-0000-4000-8000-000000000188','31'),   -- was 32
  ('b21e0000-0000-4000-8000-000000000189','31A'),  -- was 32A
  ('b21e0000-0000-4000-8000-000000000195','32')    -- was 33  cargo certificate
) AS v(id, num)
WHERE f.id = v.id::uuid;
