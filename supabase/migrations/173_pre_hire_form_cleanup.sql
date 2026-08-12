-- ============================================================================
-- Migration 173: Pre-Hire Inspection — form cleanup after a first read-through
--
-- Six changes, all data.
--
-- 1. DROP the 11 per-section "Photographs" fields. Photos now attach to ANY question
--    (job_photos.field_id has never required a photo-type field), so evidence sits with
--    the item it evidences instead of in a bucket at the end of the section. The
--    Findings section keeps its Photographs field — there, the whole entry IS the
--    subject, so a dedicated field is the natural home.
--
-- 2. DROP 1.1 Date and 1.2 Port. The job record already holds both — jobs.scheduled_date
--    and jobs.port_location (migration 153) — and the report header now falls back to
--    them, so there is nothing left to type twice. The checklist audit has flagged this
--    as DOUBLE-ENTRY since the template was seeded.
--
--    This is only safe because JobPDF's header lookup was tightened at the same time to
--    match the EXACT labels 'Date' and 'Port'. Under the old loose /\bdate\b/ and
--    /\bport\b/ patterns, removing these fields would have handed the header rows to
--    "Date of last drydocking" (3.8) and "Port of registry" (2.3) — and the winner is
--    suppressed from the report body, so those questions would have silently vanished.
--
-- 3. DROP 2.10 Air draught.
--
-- 4. Renumber sections 1 and 2 to close the gaps left by the three removals.
--
-- 5. "Not inspected" becomes N/I, in amber. It is an open item someone still has to
--    close — a different thing from N/A ("does not apply here") — so it should catch the
--    eye rather than fade into grey.
--
-- 6. Every tick-list gains a free-text "Other" box (validation.allow_other), so a
--    certificate or item that is not on the list can still be recorded on the day.
--
-- Idempotent throughout. Guarded: the DELETEs refuse to run for any field that already
-- holds an answer or a photo, so this can never destroy survey data if a job has been
-- started against the template.
-- ============================================================================

-- ------------------------------------------------------------
-- 1-3. Remove the fields that are no longer wanted
--
-- The guard matters: DELETE would cascade job_field_values / job_photos. Anything that
-- has been answered or photographed is left in place rather than silently destroyed.
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         -- Per-section Photographs fields (the Findings one is deliberately not here)
         'c41d0000-0000-4000-8000-000000000303',  -- 3.1B  certification
         'c41d0000-0000-4000-8000-000000000507',  -- 5.13  safety management
         'c41d0000-0000-4000-8000-00000000060b',  -- 6.11  life-saving appliances
         'c41d0000-0000-4000-8000-000000000709',  -- 7.9   fire fighting appliances
         'c41d0000-0000-4000-8000-000000000810',  -- 8.17  passenger arrangements
         'c41d0000-0000-4000-8000-000000000909',  -- 9.6   transfer arrangements
         'c41d0000-0000-4000-8000-000000000a0d',  -- 10.13 navigation and communications
         'c41d0000-0000-4000-8000-000000000b0e',  -- 11.22 machinery and steering
         'c41d0000-0000-4000-8000-000000000c0b',  -- 12.16 hull, deck and mooring
         'c41d0000-0000-4000-8000-000000000d08',  -- 13.8  pollution prevention and security
         -- Already held on the job record
         'c41d0000-0000-4000-8000-000000000100',  -- 1.1   Date      → jobs.scheduled_date
         'c41d0000-0000-4000-8000-000000000101',  -- 1.2   Port      → jobs.port_location
         -- Not wanted
         'c41d0000-0000-4000-8000-000000000209',  -- 2.10  Air draught
         -- Crew: you sample a few crew and check their folders, you do not enumerate
         -- every certificate on a tick-list — so the list becomes the note on 4.3, and
         -- anything missing goes in that question's remarks.
         'c41d0000-0000-4000-8000-000000000403',  -- 4.4   Crew certificates tick-list
         'c41d0000-0000-4000-8000-000000000404',  -- 4.3A  Which crew certificate(s)…
         -- Asked again, better, in section 14 (Intended Route & Local Operations)
         'c41d0000-0000-4000-8000-000000000406',  -- 4.6   Estimated round-trip duration
         'c41d0000-0000-4000-8000-000000000407',  -- 4.7   Watchkeeping arrangement
         'c41d0000-0000-4000-8000-000000000408'   -- 4.8   Master/pilot for the river transit
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 4. Close the numbering gaps
-- ------------------------------------------------------------
-- Section 1 — Survey Details: 1.3/1.4/1.5 → 1.1/1.2/1.3
UPDATE public.template_fields SET item_number = '1.1', order_index = 0
  WHERE id = 'c41d0000-0000-4000-8000-000000000102';   -- Time boarded
UPDATE public.template_fields SET item_number = '1.2', order_index = 1
  WHERE id = 'c41d0000-0000-4000-8000-000000000103';   -- Time departed
UPDATE public.template_fields SET item_number = '1.3', order_index = 2
  WHERE id = 'c41d0000-0000-4000-8000-000000000104';   -- Persons met on board

UPDATE public.template_sections
   SET description = 'Completed first. The date and port come from the job record and are not asked again here.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000010';

-- Section 2 — Vessel Particulars: everything after Air draught moves up one.
UPDATE public.template_fields SET item_number = '2.10', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-00000000020a';   -- Gross tonnage
UPDATE public.template_fields SET item_number = '2.11', order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-00000000020b';   -- Main propulsion and installed power
UPDATE public.template_fields SET item_number = '2.12', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-00000000020c';   -- Registered owner and manager

-- Section 4 — Crew: 4.4 (tick-list), 4.3A, 4.6, 4.7 and 4.8 are gone; close the gaps.
UPDATE public.template_fields SET item_number = '4.4', order_index = 3
  WHERE id = 'c41d0000-0000-4000-8000-000000000405';   -- Hours-of-rest records
UPDATE public.template_fields SET item_number = '4.5', order_index = 4
  WHERE id = 'c41d0000-0000-4000-8000-000000000409';   -- Drug and alcohol policy
UPDATE public.template_fields SET item_number = '4.6', order_index = 5
  WHERE id = 'c41d0000-0000-4000-8000-00000000040a';   -- Drill records
UPDATE public.template_fields SET item_number = '4.7', order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-00000000040b';   -- Working language

-- 4.3 now carries the whole check: sample a few crew, and record anything missing in its
-- own remarks. The expected documents are listed in the note.
UPDATE public.template_fields
   SET label = 'Are the crew''s certificates, endorsements, medicals and training valid and in date?',
       help_text = 'Review the folders of a random sample of the crew rather than every person. Expect: certificate of competency with flag endorsement · seafarer medical certificate · STCW basic safety training · advanced fire fighting · medical first aid · fast rescue craft · offshore survival (HUET/BOSIET) where required. Record anything missing or expired, and whose it was, in the remarks.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000402';

UPDATE public.template_sections
   SET description = 'Manning against the safe manning document, and the competency of a sampled crew.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000013';

-- 5.7 was a free-text "describe the medevac arrangement". The answerable question is
-- simply whether round-the-clock medical support can be reached; who provides it goes in
-- the remarks. pdf_hide_when_empty is cleared so an unanswered one still prints "—",
-- which is the proof the question was asked.
UPDATE public.template_fields
   SET label = 'Does the vessel have access to 24-hour emergency medical support?',
       field_type = 'yes_no_na',
       with_remarks = true,
       pdf_hide_when_empty = false,
       options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
       help_text = 'Radio medical advice, a retained doctor, or the charterer''s duty medic. Name the provider and how they are reached in the remarks.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000506';

-- 14.7 asked whether the air draught clears any overhead obstruction. The measurement is
-- gone but the question stands on its own, so it stays — reworded to be self-contained.
UPDATE public.template_fields
   SET label = 'Is there adequate clearance under any overhead obstruction on the river?',
       help_text = 'Bridges, cableways or pipe crossings on the intended transit.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000e06';

-- ------------------------------------------------------------
-- 4b. Charts: what the vessel actually navigates on, and how it keeps it current
--
-- 10.3 asked whether charts were "held and corrected", which a vessel can answer Yes to
-- whether it runs type-approved ECDIS, a plotter bought off the shelf, or a folio of
-- paper. How the corrections arrive is the part that shows whether it is really being
-- kept up — and it differs completely per system, so the gateway branches.
--
-- The gateway is a DROPDOWN: only a scalar answer can drive conditional logic
-- (a multiple_choice answer lives in value_array, which the evaluator never reads).
-- Conditions are flat — one operator per field — so each follow-up uses a single OR
-- across the values it applies to.
-- ------------------------------------------------------------
-- Make room after 10.3.
UPDATE public.template_fields SET item_number = '10.10', order_index = 10 WHERE id = 'c41d0000-0000-4000-8000-000000000a04';
UPDATE public.template_fields SET item_number = '10.11', order_index = 11 WHERE id = 'c41d0000-0000-4000-8000-000000000a05';
UPDATE public.template_fields SET item_number = '10.12', order_index = 12 WHERE id = 'c41d0000-0000-4000-8000-000000000a06';
UPDATE public.template_fields SET item_number = '10.13', order_index = 13 WHERE id = 'c41d0000-0000-4000-8000-000000000a07';
UPDATE public.template_fields SET item_number = '10.14', order_index = 14 WHERE id = 'c41d0000-0000-4000-8000-000000000a08';
UPDATE public.template_fields SET item_number = '10.15', order_index = 15 WHERE id = 'c41d0000-0000-4000-8000-000000000a09';
UPDATE public.template_fields SET item_number = '10.16', order_index = 16 WHERE id = 'c41d0000-0000-4000-8000-000000000a0a';
UPDATE public.template_fields SET item_number = '10.17', order_index = 17 WHERE id = 'c41d0000-0000-4000-8000-000000000a0b';
UPDATE public.template_fields SET item_number = '10.18', order_index = 18 WHERE id = 'c41d0000-0000-4000-8000-000000000a0c';

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001300','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'What does the vessel navigate on?','dropdown',4,false,
   '[{"value":"ecdis","label":"ECDIS (type-approved), paperless"},{"value":"ecdis_paper","label":"ECDIS with paper charts as backup"},{"value":"plotter","label":"Chart plotter (not type-approved)"},{"value":"plotter_paper","label":"Chart plotter with paper charts"},{"value":"paper","label":"Paper charts only"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'10.4',false,NULL,
   'A chart plotter is not a type-approved ECDIS and does not discharge the carriage requirement on its own — record what is actually fitted.',false),

  -- ECDIS branch
  ('c41d0000-0000-4000-8000-000000001301','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'How are the ECDIS chart updates received and applied?','textarea',5,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'))),
   '10.5',false,NULL,'Who supplies them, how often they arrive, by what means, and who loads them. Note the date of the last update applied.',true),
  ('c41d0000-0000-4000-8000-000000001302','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Are the ENC permits and chart licences current for the intended route?','yes_no_na',6,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'))),
   '10.6',true,NULL,'A licence that expires mid-charter takes the cells with it. Note the expiry in the remarks.',false),

  -- Chart plotter branch
  ('c41d0000-0000-4000-8000-000000001303','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'How are the chart plotter''s updates obtained and applied?','textarea',7,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter_paper'))),
   '10.7',false,NULL,'Card, download or subscription; who does it and when it was last done. Record the chart source and version if shown.',true),

  -- Paper branch
  ('c41d0000-0000-4000-8000-000000001304','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Are Notices to Mariners corrections applied and up to date?','yes_no_na',8,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','paper'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter_paper'))),
   '10.8',true,NULL,'Check the correction log against the charts covering the intended route, not the folio as a whole.',false),
  ('c41d0000-0000-4000-8000-000000001305','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Date of the last chart correction applied','text',9,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','paper'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter_paper'))),
   '10.9',false,NULL,'And the Notice number it came from, if shown.',false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. "Not inspected" → N/I, in amber
--
-- Rewrites the option in place, preserving list order, on every field of this template
-- that offers it. WITH ORDINALITY keeps Yes/No/N-A/N-I in the order they were authored.
-- ------------------------------------------------------------
UPDATE public.template_fields tf
   SET options = (
         SELECT jsonb_agg(
                  CASE WHEN o->>'value' = 'ni'
                       THEN jsonb_build_object('value','ni','label','N/I','color','amber')
                       ELSE o END
                  ORDER BY ord)
           FROM jsonb_array_elements(tf.options) WITH ORDINALITY AS t(o, ord)
       )
 WHERE tf.template_id = 'c41d0000-0000-4000-8000-000000000001'
   AND tf.options @> '[{"value":"ni"}]'::jsonb;

-- ------------------------------------------------------------
-- 6. Let every tick-list take a write-in answer
--
-- The lists name what is usually carried; a vessel that holds something else must still
-- be recordable without editing the template on the quayside.
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET validation = COALESCE(validation, '{}'::jsonb) || '{"allow_other": true}'::jsonb
 WHERE template_id = 'c41d0000-0000-4000-8000-000000000001'
   AND field_type = 'multiple_choice';
