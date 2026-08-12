-- ============================================================================
-- Migration 177: Pre-Hire Inspection — passenger evacuation, and one question out
--
-- (a) ADD a written passenger-evacuation procedure, plus the person responsible for
--     marshalling them. Section 5 asked whether the muster list includes the passengers
--     (5.2) and whether they take part in drills (5.12), and section 8 covered the
--     escape routes out of the passenger space — but nothing asked for the procedure
--     that ties those together: who leads twenty people who have never been aboard
--     before to a muster station, how they are accounted for, and how that count reaches
--     the bridge. Appended to section 5 so the emergency-readiness items read together.
--
-- (b) REMOVE 9.5, the maximum significant wave height figure. A specific Hs limit is
--     agreed with the charterer when the contract is placed, not established at a
--     pre-hire inspection. The question that matters — whether operating limits are
--     documented at all — stays, and its note still lists what those limits cover.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; the DELETE is guarded so it cannot
-- destroy an answer or a photo if a job has already been started.
-- ============================================================================

-- ------------------------------------------------------------
-- (a) Passenger evacuation → section 5
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001700','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is there a written procedure for evacuating and accounting for the passengers?','yes_no_na',13,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'5.13',true,NULL,
   'How they are led from the passenger space to the muster station, who counts them against the manifest, how that count reaches the bridge, and how they are assisted into the survival craft. Note whether it covers evacuation both at sea and alongside.',false),

  ('c41d0000-0000-4000-8000-000000001701','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is a crew member designated to muster and marshal the passengers?','yes_no_na',14,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'5.14',true,NULL,
   'By name or by rank on the muster list, not "whoever is free". Record who it is.',false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- (b) Remove the maximum significant wave height figure (9.5)
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id = 'c41d0000-0000-4000-8000-000000000907'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- Close the gap it leaves: the man-overboard procedure moves up to 9.5.
UPDATE public.template_fields SET item_number = '9.5', order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-000000000908'
    AND NOT EXISTS (SELECT 1 FROM public.template_fields x
                     WHERE x.id = 'c41d0000-0000-4000-8000-000000000907');
