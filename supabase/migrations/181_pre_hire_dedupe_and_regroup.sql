-- ============================================================================
-- Migration 181: Pre-Hire Inspection — put each question where it is inspected,
--                and stop asking the same thing twice
--
-- The engine-room section had grown a management-system tail: a planned maintenance
-- system, a defect reporting system, class survey status. None of those are inspected in
-- the engine room — they are inspected in the ship's office, against the safety
-- management system and the certificate folder — and asking them twice in two sections
-- is how a report ends up contradicting itself. Likewise the pollution section was half
-- equipment and half paperwork.
--
-- So this migration MOVES rather than duplicates:
--
--   engine room  →  safety management : planned maintenance system, defect reporting
--   engine room  →  certification     : class survey status
--   pollution    →  safety management : the plans and record books (ORB, garbage,
--                                       SOPEP, ballast water). Section 13 keeps only
--                                       the EQUIPMENT — separator, spill kit, sewage.
--
-- Removed outright:
--   11.10 / 11.11  fuel capacity and endurance — commercial figures, not condition
--   11.16          overdue-job COUNT, duplicating the overdue-job question
--   11.18          running hours against overhaul intervals
--   12.13          void and tank spaces
--   9.5            man-overboard procedure "covering transfer operations", which since
--                  migration 174 says the same thing as 6.10. Its transfer angle is
--                  folded into 6.10's note instead.
--   IOPP           was on BOTH the certificate tick-list (3.2) and the pollution one
--   Stability book was on the certificate tick-list AND asked properly at 12.9
--
-- Reworded:
--   11.12 loses "is a PMS in use" and becomes purely the overdue-jobs question, which is
--         the part you can actually establish in the engine room. Colours reversed —
--         overdue critical work is a finding, so Yes is red.
--   11.13 asks for the critical spares LIST as well as the spares, since a locker
--         without a list cannot be checked against anything.
--
-- Idempotent. DELETEs are guarded against any field holding an answer or a photo.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. New questions in Safety Management (section 5)
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001a00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is a planned maintenance system in use?','yes_no_na',15,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'5.15',true,NULL,
   'One system covering the whole vessel. Whether any critical jobs are overdue is asked in the engine room, where you can see them.',false),

  ('c41d0000-0000-4000-8000-000000001a01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Are the environmental plans and record books held and up to date?','yes_no_na',18,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'5.18',true,NULL,
   'Oil Record Book · Garbage Management Plan and record book · SOPEP or SMPEP · Ballast Water Management Plan and record book. Check the last few entries are contemporaneous and signed, not written up in one hand at the end of the month.',false),

  ('c41d0000-0000-4000-8000-000000001a02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Environmental documents individually sighted','multiple_choice',19,false,
   '[{"value":"orb","label":"Oil Record Book"},{"value":"garbage_plan","label":"Garbage Management Plan"},{"value":"garbage_book","label":"Garbage Record Book"},{"value":"placards","label":"Garbage placards posted"},{"value":"sopep","label":"SOPEP / SMPEP"},{"value":"bwmp","label":"Ballast Water Management Plan"},{"value":"bw_record","label":"Ballast Water Record Book"}]'::jsonb,
   '{"allow_other": true}'::jsonb,NULL,NULL,'5.19',false,NULL,'Tick each document you personally sighted.',false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Move the management-system questions out of the engine room
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET section_id = 'c41d0000-0000-4000-8000-000000000014',   -- Safety Management
       label = 'Planned maintenance system in use — name or type',
       item_number = '5.16', order_index = 16
 WHERE id = 'c41d0000-0000-4000-8000-000000001210';

UPDATE public.template_fields
   SET section_id = 'c41d0000-0000-4000-8000-000000000014',   -- Safety Management
       item_number = '5.17', order_index = 17
 WHERE id = 'c41d0000-0000-4000-8000-000000001215';           -- Defect reporting system

UPDATE public.template_fields
   SET section_id = 'c41d0000-0000-4000-8000-000000000012',   -- Certification & Documentation
       item_number = '3.11', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-000000001212';           -- Class surveys up to date

-- ------------------------------------------------------------
-- 3. Engine room: reword what stays, renumber what is left
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Are there any overdue critical maintenance jobs?',
       options = '[{"value":"yes","label":"Yes","color":"red"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb,
       item_number = '11.10', order_index = 9,
       help_text = 'From the maintenance system itself. Record how many and which in the remarks. Overdue critical work is a finding, so Yes is marked red here.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0b';

UPDATE public.template_fields
   SET label = 'Is a critical spares list kept, and are those spares on board?',
       item_number = '11.11', order_index = 10,
       help_text = 'Both halves matter — a spares locker with no list cannot be checked against anything. Spot-check a few items from the list.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0c';

UPDATE public.template_fields SET item_number = '11.12', order_index = 11
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0d';           -- Engine room escape routes
UPDATE public.template_fields SET item_number = '11.13', order_index = 12
 WHERE id = 'c41d0000-0000-4000-8000-000000001214';           -- Lube oil and fuel analysis
UPDATE public.template_fields SET item_number = '11.14', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-000000001216';           -- Breakdowns in the last 12 months

-- ------------------------------------------------------------
-- 4. Pollution section keeps the EQUIPMENT only
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Is the pollution-prevention equipment present and operational?',
       help_text = 'Oily water separator and its 15ppm alarm · SOPEP locker contents · spill kit and containment · sewage treatment or holding tank · garbage segregation and receptacles · save-alls and scupper plugs. The plans and record books behind this equipment are asked at 5.18.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000d00';

UPDATE public.template_fields
   SET label = 'Pollution-prevention equipment individually verified',
       options = '[{"value":"ows","label":"Oily water separator"},{"value":"ppm_alarm","label":"15ppm alarm"},{"value":"sopep_locker","label":"SOPEP locker and contents"},{"value":"spill_kit","label":"Spill kit and containment"},{"value":"sewage","label":"Sewage treatment or holding tank"},{"value":"garbage_bins","label":"Garbage segregation and receptacles"},{"value":"save_alls","label":"Save-alls and scupper plugs"},{"value":"incinerator","label":"Incinerator or compactor"}]'::jsonb,
       help_text = 'Tick each item you physically checked.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000d01';

UPDATE public.template_fields
   SET label = 'Which item(s) of equipment, and what was found?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000d02';

-- ------------------------------------------------------------
-- 5. Certificate tick-list: add IAPP, drop the stability book
--
-- The stability book is asked properly at 12.9, which also establishes the vessel is
-- operating within its limits — a sighting tick adds nothing beside it.
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET options = '[{"value":"registry","label":"Certificate of Registry"},{"value":"class","label":"Class certificate"},{"value":"load_line","label":"Load Line"},{"value":"safety_construction","label":"Safety Construction"},{"value":"safety_equipment","label":"Safety Equipment"},{"value":"safety_radio","label":"Safety Radio"},{"value":"ism_smc","label":"ISM Safety Management Certificate"},{"value":"ism_doc","label":"ISM Document of Compliance (company)"},{"value":"isps","label":"ISPS International Ship Security Certificate"},{"value":"mlc","label":"Maritime Labour Certificate"},{"value":"iopp","label":"IOPP"},{"value":"iapp","label":"IAPP"},{"value":"tonnage","label":"Tonnage certificate"},{"value":"msmd","label":"Minimum Safe Manning Document"},{"value":"radio_licence","label":"Radio licence"},{"value":"pandi","label":"P&I entry certificate"},{"value":"hm","label":"Hull & Machinery insurance"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000301';

UPDATE public.template_fields
   SET help_text = 'Certificate of Registry · Class · Load Line · Safety Construction · Safety Equipment · Safety Radio · ISM SMC and company DOC · ISPS ISSC · MLC · IOPP · IAPP · Tonnage · Minimum Safe Manning Document · Radio Licence · P&I entry · Hull & Machinery. Answer once for the set, then tick below what you sighted individually.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000300';

-- ------------------------------------------------------------
-- 6. Fold the transfer angle into the man-overboard procedure question
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET help_text = 'Beyond the bridge card: who does what, how the alarm is raised, who keeps the person in sight, and how the passengers are accounted for while it happens. It should cover a person lost during a transfer as well as one lost on passage.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001401';

-- ------------------------------------------------------------
-- 7. Section 12: close the gap left by the void/tank question
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '12.13', order_index = 12
 WHERE id = 'c41d0000-0000-4000-8000-000000000c0a';           -- Accommodation and galley
UPDATE public.template_fields SET item_number = '12.14', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-000000001223';           -- General arrangement plan
UPDATE public.template_fields SET item_number = '12.15', order_index = 14
 WHERE id = 'c41d0000-0000-4000-8000-000000001220';           -- Overall condition as observed

-- ------------------------------------------------------------
-- 8. Removals
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000000b09',   -- 11.10 Fuel capacity
         'c41d0000-0000-4000-8000-000000000b0a',   -- 11.11 Endurance at service speed
         'c41d0000-0000-4000-8000-000000001211',   -- 11.16 Overdue critical job COUNT
         'c41d0000-0000-4000-8000-000000001213',   -- 11.18 Running hours vs overhaul intervals
         'c41d0000-0000-4000-8000-000000001221',   -- 12.13 Void and tank spaces
         'c41d0000-0000-4000-8000-000000000908'    -- 9.5   MOB procedure covering transfer
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 9. Remove section 14 — Intended Route & Local Operations
--
-- The last of the charter-specific material. The finished position: this document
-- inspects the vessel and says whether it is being run properly, and says nothing about
-- one intended service. Transit times, tidal windows, the river berth and the bunkering
-- arrangements were all describing a job rather than a ship.
--
-- Fields first (guarded), then the section — template_sections CASCADEs to
-- template_fields, so deleting the section outright would bypass the guard entirely and
-- take answered fields with it. The section is only dropped once it is genuinely empty.
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.section_id = 'c41d0000-0000-4000-8000-00000000001d'
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

DELETE FROM public.template_sections ts
 WHERE ts.id = 'c41d0000-0000-4000-8000-00000000001d'
   AND NOT EXISTS (SELECT 1 FROM public.template_fields f WHERE f.section_id = ts.id);

-- Close the gap the section leaves. Only runs once section 14 is actually gone, so a
-- blocked delete cannot leave two sections sharing an order_index.
UPDATE public.template_sections ts SET order_index = order_index - 1
 WHERE ts.template_id = 'c41d0000-0000-4000-8000-000000000001'
   AND ts.order_index > 13
   AND NOT EXISTS (SELECT 1 FROM public.template_sections x
                    WHERE x.id = 'c41d0000-0000-4000-8000-00000000001d');

-- …and the item numbers behind it: Attendance Summary 15.x → 14.x, Sign-off 17.x → 16.x.
UPDATE public.template_fields SET item_number = '14.1' WHERE id = 'c41d0000-0000-4000-8000-000000000f00';
UPDATE public.template_fields SET item_number = '14.2' WHERE id = 'c41d0000-0000-4000-8000-000000000f01';
UPDATE public.template_fields SET item_number = '14.3' WHERE id = 'c41d0000-0000-4000-8000-000000000f02';
UPDATE public.template_fields SET item_number = '14.4' WHERE id = 'c41d0000-0000-4000-8000-000000000f03';
UPDATE public.template_fields SET item_number = '16.1' WHERE id = 'c41d0000-0000-4000-8000-000000001100';
UPDATE public.template_fields SET item_number = '16.2' WHERE id = 'c41d0000-0000-4000-8000-000000001101';
UPDATE public.template_fields SET item_number = '16.3' WHERE id = 'c41d0000-0000-4000-8000-000000001102';
UPDATE public.template_fields SET item_number = '16.4' WHERE id = 'c41d0000-0000-4000-8000-000000001103';
UPDATE public.template_fields SET item_number = '16.5' WHERE id = 'c41d0000-0000-4000-8000-000000001104';

-- The maximum-draught note pointed at section 14, which no longer exists.
UPDATE public.template_fields
   SET help_text = 'Summer draught from the certificate.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000208';

-- The scope tick-list still offered the route as an area of inspection.
UPDATE public.template_fields
   SET options = '[{"value":"certification","label":"Certification and documentation"},{"value":"crew","label":"Crew, manning and certification"},{"value":"sms","label":"Safety management and emergency preparedness"},{"value":"drills","label":"Drills and muster arrangements"},{"value":"pms","label":"Planned maintenance records"},{"value":"lsa","label":"Life-saving appliances"},{"value":"ffa","label":"Fire fighting appliances"},{"value":"personnel","label":"Passenger arrangements"},{"value":"transfer","label":"Passenger transfer arrangements"},{"value":"nav","label":"Navigation and communications"},{"value":"machinery","label":"Machinery, engine room and steering"},{"value":"hull","label":"Hull, deck and mooring"},{"value":"pollution","label":"Pollution prevention and security"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000f00';

-- The template's own description still described a named service.
UPDATE public.checklist_templates
   SET description = 'Condition, certification and equipment inspection of a fast crew-supply or platform supply vessel carrying passengers. Derived from the IMCA Common Marine Inspection Document (CMID) at the sub-500GT level. Records observed facts only — no recommendations and no assessment of suitability.',
       pdf_preamble = 'Taylor Engineering Agencies Limited attended the above vessel to carry out a pre-hire inspection. This report records the condition, certification and equipment of the vessel as observed on board on the date stated, together with the inspection particulars and supporting photographs. It is a factual record only: it contains no assessment, recommendation or conclusion as to the vessel''s suitability for any particular service.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000001';
