-- ============================================================================
-- Migration 179: Pre-Hire Inspection — trim navigation, and move the anchors on deck
--
-- Continues the "ask about practice, not about this charter" pass from 178.
--
--   * The under-keel clearance question loses its qualifiers — either there is a policy
--     or there is not.
--   * The GMDSS question loses "for the area of operation" for the same reason.
--   * Satellite/mobile coverage, night navigation and the bridge manning level are all
--     properties of a particular service rather than of the vessel, and section 14
--     already examines the service. Removed.
--   * The anchors, windlass and cable are deck gear. They were asked about in the
--     navigation section, which is not where anyone inspects them — they belong with
--     the mooring equipment in the deck walk-round, and they move there.
--
-- Section 12 is also put into walk-round order while the anchors are inserted: hull,
-- coatings, closures, rails, decks, ladders, freeing ports, marks, stability, mooring,
-- anchors, cargo deck, tanks, accommodation, plans — and the overall condition summary
-- last, where a summary belongs.
--
-- Idempotent. DELETEs are guarded against any field that already holds an answer or a
-- photo, so this cannot destroy survey data.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Wording
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Is there an under-keel clearance policy?',
       help_text = 'The minimum clearance the company requires, and evidence it is calculated and recorded for shallow-water passages.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a05';

UPDATE public.template_fields
   SET label = 'Is all GMDSS equipment operational?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a07';

-- ------------------------------------------------------------
-- 2. Move the anchors, windlass and cable into the deck section
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET section_id = 'c41d0000-0000-4000-8000-00000000001b',   -- Hull, Deck & Mooring
       label = 'Are the anchors, windlass and cable in good order and ready for use?',
       item_number = '12.11',
       order_index = 10,
       help_text = 'Brake, cable stopper, hawse pipe and chain locker. Check the cable is marked and the anchors are properly secured for sea.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a0c';

-- Section 12 into walk-round order, with the condition summary last.
UPDATE public.template_fields SET item_number = '12.12', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000001222';   -- Cargo deck area and securing
UPDATE public.template_fields SET item_number = '12.13', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-000000001221';   -- Void and tank spaces
UPDATE public.template_fields SET item_number = '12.14', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000000c0a';   -- Accommodation and galley
UPDATE public.template_fields SET item_number = '12.15', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000001223';   -- General arrangement plan
UPDATE public.template_fields SET item_number = '12.16', order_index = 15
  WHERE id = 'c41d0000-0000-4000-8000-000000001220';   -- Overall condition as observed

-- ------------------------------------------------------------
-- 3. The emergency fire pump, tested
--
-- It appeared only as a line on the 7.2 tick-list, which records that it exists. The
-- fire main question covers the MAIN pump — but the emergency pump is the one that has
-- to work when the machinery space is the fire and its own power comes from outside
-- that space. Whether it starts, and whether it makes pressure, is a separate question.
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '7.9',  order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-000000000705';   -- Fixed system in date
UPDATE public.template_fields SET item_number = '7.10', order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-000000001503';   -- Fixed system type and coverage
UPDATE public.template_fields SET item_number = '7.11', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000001504';   -- Last weight / pressure check
UPDATE public.template_fields SET item_number = '7.12', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-000000001505';   -- Release procedure: vent and fuel
UPDATE public.template_fields SET item_number = '7.13', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000001506';   -- Crew familiar with release
UPDATE public.template_fields SET item_number = '7.14', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000000706';   -- Emergency stops and shut-offs
UPDATE public.template_fields SET item_number = '7.15', order_index = 15
  WHERE id = 'c41d0000-0000-4000-8000-000000000707';   -- SCBA cylinder pressures
UPDATE public.template_fields SET item_number = '7.16', order_index = 16
  WHERE id = 'c41d0000-0000-4000-8000-000000000708';   -- General alarm audible

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001900','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Was the emergency fire pump run and found to deliver pressure?','yes_no_na',8,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.8',true,NULL,
   'Started from its own power source outside the machinery space, and run up to pressure at a hydrant. Note how it is started and whether the space it sits in can be reached with the machinery space on fire.',false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Remove the service-specific navigation questions
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000000a09',   -- Satellite / mobile coverage on the route
         'c41d0000-0000-4000-8000-000000000a0a',   -- Night navigation on the river
         'c41d0000-0000-4000-8000-000000000a0b'    -- Bridge manning for the river transit
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);
