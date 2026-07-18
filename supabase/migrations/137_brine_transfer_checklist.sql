-- ============================================================
-- Migration 137: Brine Transfer Checklist
--
-- Transcribed from the "Brine Transfer Checklist" paper form (Taylor Engineering
-- Agencies Limited). Structure follows the recovered BPTT Fuel Transfer seed
-- (deleted migration 017, commit c832246) — the same reconciliation pattern of a
-- signed Difference plus a colour-banded % Variance.
--
-- Depends on: 003 (yes_no_na, item_number), 088 (pdf_include_photos),
--             092 (pdf_disclaimer), 094 (is_repeatable), 131 (default_job_type),
--             136 (requires_report_number).
--
-- Also adds checklist_templates.manual_numbering. The template builder normally
-- auto-numbers each section 1..n and re-stamps on EVERY edit; this form numbers
-- 1..33 CONTINUOUSLY across five phases and uses lettered conditional sub-items
-- (1A, 6B, 20A), so that behaviour would destroy it. See lib/checklist/itemNumbering.
--
-- Fixed ids (prefix b21e0000-…) so conditional_logic can reference fields directly
-- and the structure stays stable across edits.
-- Idempotent: safe to re-run; existing rows are left untouched.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Manual item numbering flag (default false = existing behaviour everywhere)
-- ------------------------------------------------------------
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS manual_numbering BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.manual_numbering IS
  'When true the builder keeps item_number exactly as authored instead of auto-numbering each section 1..n. For templates transcribed from a paper form (lettered sub-items, numbering that runs across sections).';

-- The recovered BPTT Fuel Transfer seed used C1A..C1D for its reconciliation block,
-- and migration 128 had to repair 'A 1'-style numbers, so that template numbers by
-- hand too — protect it from the same re-stamping.
UPDATE public.checklist_templates
   SET manual_numbering = true
 WHERE name ILIKE '%fuel transfer%'
   AND manual_numbering = false;

-- ------------------------------------------------------------
-- 2. Job type
-- ------------------------------------------------------------
INSERT INTO public.job_types (name) VALUES ('Brine Transfer')
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Template
-- ------------------------------------------------------------
INSERT INTO public.checklist_templates
  (id, name, description, status, allow_surveyor_start, pdf_include_photos,
   requires_report_number, manual_numbering, default_job_type, pdf_disclaimer, created_by)
SELECT 'b21e0000-0000-4000-8000-000000000001',
       'Brine Transfer Checklist',
       'Liquid-bulk brine transfer survey, worked top to bottom on site: pre-loading charter and segregation checks, initial shore and vessel readings, mid-loading sampling, final readings, and the ship-versus-shore reconciliation. Covers both loading and discharging.',
       'draft'::template_status,
       true,   -- allow_surveyor_start: loadouts are often started in the field
       true,   -- pdf_include_photos: flow-meter and sounding photos belong in the report
       true,   -- requires_report_number
       true,   -- manual_numbering: 1..33 across phases, with lettered sub-items
       'Brine Transfer',
       'This report remains the property of Taylor Engineering Agencies Limited ("Taylor Engineering") and the commissioning client. It reflects conditions observed at the time of survey and is issued in good faith for their exclusive use. The information herein shall not be reproduced, disclosed, or relied upon by any third party without written consent. This report is submitted without prejudice to the rights and interests of whom it may concern.',
       COALESCE((SELECT id FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
                (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Sections (the five phases, plus job details and the repeatable hourly log)
-- ------------------------------------------------------------
INSERT INTO public.template_sections (id, template_id, title, description, order_index, is_repeatable) VALUES
  ('b21e0000-0000-4000-8000-000000000010','b21e0000-0000-4000-8000-000000000001','Job Details','Completed once, before work starts.',0,false),
  ('b21e0000-0000-4000-8000-000000000011','b21e0000-0000-4000-8000-000000000001','Pre-Loading','Charter history, tank nomination, segregation and spill readiness.',1,false),
  ('b21e0000-0000-4000-8000-000000000012','b21e0000-0000-4000-8000-000000000001','Initial','Shore and vessel readings, agreements, first foot and line samples.',2,false),
  ('b21e0000-0000-4000-8000-000000000013','b21e0000-0000-4000-8000-000000000001','Mid Loading','Rate increase, resumption samples and periodic monitoring.',3,false),
  ('b21e0000-0000-4000-8000-000000000014','b21e0000-0000-4000-8000-000000000001','Hourly Shore Line Inspection','Item 26 — add one entry per hourly inspection of the shore loading line.',4,true),
  ('b21e0000-0000-4000-8000-000000000015','b21e0000-0000-4000-8000-000000000001','Final','Final soundings and flow meter readings, ship then shore.',5,false),
  ('b21e0000-0000-4000-8000-000000000016','b21e0000-0000-4000-8000-000000000001','After Loading / Reconciliation','Ship versus shore figures and the cargo certificate.',6,false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Fields
--
-- Answer types: 'yes_no' = strict Yes/No (used for direct-evidence items such as
-- soundings and flow-meter photographs, so nothing can be waved through as N/A);
-- 'yes_no_na' = Yes/No/N-A. Colours default to yes=green / no=red / na=grey; an
-- explicit per-option "color" reverses that where No is the desired answer.
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
VALUES

-- ===== Job Details =========================================================
  ('b21e0000-0000-4000-8000-000000000100','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000010',
   'Operation','dropdown',0,true,
   '[{"value":"loading","label":"Loading"},{"value":"discharging","label":"Discharging"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'',false,NULL,
   'Loading is listed first as it covers almost every job. Pick Discharging only when the vessel is discharging brine.'),

  ('b21e0000-0000-4000-8000-000000000101','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000010',
   'Cargo type','text',1,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,
   'The product being transferred, e.g. the grade or description of the brine.'),

-- ===== PRE-LOADING =========================================================
  ('b21e0000-0000-4000-8000-000000000110','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Charter history','heading',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000111','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Was tank cleaning completed at the end of the previous charter?','yes_no_na',1,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'1',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000112','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Did the previous charterer''s tank cleaning procedure include a line displacement with brine?','yes_no_na',2,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000111','operator','equals','value','yes'))),
   '1A',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000113','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Is this the first loadout of liquid bulk cargo under the current charter?','yes_no_na',3,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'2',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000114','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Tank nomination & this loadout''s cargo history','heading',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000115','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'What was the previous cargo loaded in the tanks?','text',5,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'3',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000116','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Was tank cleaning carried out prior to loading this cargo?','yes_no_na',6,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'4',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000117','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Did that tank cleaning include a line displacement with brine?','yes_no_na',7,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000116','operator','equals','value','yes'))),
   '4A',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000118','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Which cargo tanks are nominated to load this cargo?','text',8,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'5',false,NULL,
   'List the nominated tanks, e.g. 1P, 1S, 2P. Items 19 to 21 below are answered for the tanks listed here.'),

  ('b21e0000-0000-4000-8000-000000000119','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Segregation','heading',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  -- Reverse colours: a single cargo type is the lower-risk answer, so No reads green.
  ('b21e0000-0000-4000-8000-000000000120','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Is more than one cargo type being loaded?','yes_no_na',10,true,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6',true,NULL,
   'Yes opens the segregation checks below.'),

  ('b21e0000-0000-4000-8000-000000000121','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Are segregated loading lines, pumps and manifolds (including discharge lines) being used for each product type?','yes_no_na',11,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000120','operator','equals','value','yes'))),
   '6A',true,NULL,NULL),

  -- Second-level branch. Conditions are evaluated flat against stored values, so the
  -- parent's own condition (6 = Yes) must be repeated here — otherwise 6B would show
  -- whenever 6A is blank, including when 6 = No and 6A never appeared.
  ('b21e0000-0000-4000-8000-000000000122','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Has cross-contamination been evaluated by the shipper and advised to the charterer?','yes_no_na',12,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000120','operator','equals','value','yes'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000121','operator','equals','value','no'))),
   '6B',true,NULL,
   'Shown when a segregated system is not in use.'),

  ('b21e0000-0000-4000-8000-000000000123','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Notification','heading',13,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000124','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Have the above questions been notified to charterers prior to loading?','yes_no_na',14,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'7',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000125','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Spill response','heading',15,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000126','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000011',
   'Are spill kits (including containment booms) available and ready to deploy on ship and shore for oil-based cargoes?','yes_no_na',16,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'8',true,NULL,
   'N/A when the cargo is not oil-based.'),

-- ===== INITIAL =============================================================
  ('b21e0000-0000-4000-8000-000000000130','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Shore side','heading',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000131','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has an initial manual sounding/ullage of the shore tank been carried out by the surveyor using a calibrated sounding tape?','yes_no',1,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'9',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000132','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has an initial photograph of the shore flow meter been taken?','yes_no',2,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'10',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000133','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Is the shipper''s shore flow meter calibration certificate up to date and calibrated for the cargo''s specific gravity?','yes_no_na',3,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'11',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000134','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Have the shore loading lines been inspected, serial numbers verified against certificates, and pressure tested within the last 12 months?','yes_no_na',4,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'12',true,NULL,
   'Note any defects such as bulges in the remarks.'),

  ('b21e0000-0000-4000-8000-000000000135','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Vessel','heading',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000136','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Have the height(s) of the vessel''s sounding tube(s) been verified?','yes_no_na',6,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'13',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000137','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has an initial manual sounding/ullage of the ship''s tanks been carried out by the surveyor using a calibrated sounding tape?','yes_no',7,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'14',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000138','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has an initial photograph of the ship''s flow meter been taken?','yes_no',8,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'15',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000139','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Is the ship''s flow meter calibration certificate up to date and calibrated for the cargo''s specific gravity?','yes_no_na',9,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'16',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000140','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Were the vessel loading lines inspected via borescope and found fit to load cargo?','yes_no_na',10,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'17',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000141','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Agreements','heading',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000142','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has the transfer rate been agreed between ship and shore, including the initial slow start-up procedure?','yes_no_na',12,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'18',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000143','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Has the tank loading sequence been agreed, with each tank to load an initial first foot individually?','yes_no_na',13,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'19',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000144','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'First foot & line samples','heading',14,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000145','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Was a line sample taken at the ship''s manifold at commencement of loading?','yes_no_na',15,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'20',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000146','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Was the line sample visually inspected and approved?','yes_no_na',16,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000145','operator','equals','value','yes'))),
   '20A',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000147','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Was a first foot sample taken from each tank?','yes_no_na',17,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'21',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000148','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Were the first foot samples visually inspected and approved?','yes_no_na',18,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000147','operator','equals','value','yes'))),
   '21A',true,NULL,NULL),

  -- Off-spec escalation. Appears as soon as ANY inspection comes back not-approved
  -- (20A, 21A, 24A or 25A); stays hidden while every inspection passes. The OR is
  -- evaluated against stored values, so it works across sections — 24A and 25A live
  -- in Mid Loading, later in the form than this item.
  ('b21e0000-0000-4000-8000-000000000149','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000012',
   'Have the charterers been notified that the cargo is off-spec?','yes_no_na',19,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000146','operator','equals','value','no'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000148','operator','equals','value','no'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000164','operator','equals','value','no'),
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000167','operator','equals','value','no'))),
   '22',true,NULL,
   'Shown only because a sample was not approved. Record when and how the charterers were told.'),

-- ===== MID LOADING =========================================================
  ('b21e0000-0000-4000-8000-000000000160','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Rate increase','heading',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000161','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Has the increased loading rate been agreed between ship and shore, and the shore loading lines and connections inspected immediately on ramp-up?','yes_no_na',1,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'23',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000162','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Resumption samples','heading',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000163','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Was a line sample taken at the ship''s manifold on resumption of loading?','yes_no_na',3,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'24',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000164','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Was the 2nd line sample visually inspected and approved?','yes_no_na',4,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000163','operator','equals','value','yes'))),
   '24A',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000165','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Periodic monitoring','heading',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000166','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Were periodic samples taken at the ship''s manifold during loading?','yes_no_na',6,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'25',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000167','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000013',
   'Were the periodic samples visually inspected and found satisfactory?','yes_no_na',7,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000166','operator','equals','value','yes'))),
   '25A',true,NULL,NULL),

-- ===== HOURLY SHORE LINE INSPECTION (repeatable) ===========================
-- Item 26 on the paper form ("note times"). One entry per hourly inspection.
--
-- Deliberately contains NO conditional fields: conditions inside a repeatable section
-- are evaluated against the first entry only.
--
-- Nothing here is required, on purpose. A repeatable section always resolves to at
-- least one entry (entryOrder.resolveEntryOrder returns [0] when empty), and the
-- submit validator checks every entry — so a required field here would block submission
-- on any job with no hourly inspections at all (a short loadout, or a discharging job).
  ('b21e0000-0000-4000-8000-000000000170','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000014',
   'Time of inspection','time',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'26',false,NULL,
   'Add one entry per hourly inspection of the shore loading line. Leave empty if none were carried out.'),

  ('b21e0000-0000-4000-8000-000000000171','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000014',
   'Shore loading line inspected and found satisfactory?','yes_no_na',1,false,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000172','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000014',
   'Observations / defects','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000173','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000014',
   'Photo','photo',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

-- ===== FINAL ===============================================================
  ('b21e0000-0000-4000-8000-000000000180','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Vessel','heading',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000181','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Have the lines been blown through and verified after completion of discharge?','yes_no_na',1,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'27',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000182','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Has the cargo line been disconnected from the ship''s manifold prior to commencement of final soundings/ullages?','yes_no_na',2,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'28',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000183','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Has a final manual sounding/ullage of the ship''s tanks been carried out by the surveyor using a calibrated sounding tape?','yes_no',3,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'29',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000184','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Has a final photograph of the ship''s flow meter been taken?','yes_no',4,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'30',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000185','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'What is the volume from the ship''s flow meter?','number',5,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000184','operator','equals','value','yes'))),
   '30A',false,'BBLS',NULL),

  ('b21e0000-0000-4000-8000-000000000186','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Shore side','heading',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000187','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Has a final manual sounding/ullage of the shore tank been carried out by the surveyor using a calibrated sounding tape?','yes_no',7,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'31',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000188','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'Has a final photograph of the shipper''s shore flow meter been taken?','yes_no',8,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'32',true,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000189','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000015',
   'What is the volume from the shipper''s shore flow meter?','number',9,false,
   '[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','b21e0000-0000-4000-8000-000000000188','operator','equals','value','yes'))),
   '32A',false,'BBLS',NULL),

-- ===== AFTER LOADING / RECONCILIATION ======================================
-- Mirrors the recovered BPTT reconciliation block: a signed Difference plus a
-- colour-banded % Variance. The percentage denominator is the LAST {uuid} token in
-- the formula, i.e. the shore figure — so the variance is measured against shore.
  ('b21e0000-0000-4000-8000-000000000190','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Final calculation of liquid bulk delivered','heading',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,NULL),

  ('b21e0000-0000-4000-8000-000000000191','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Ship''s figure','number',1,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,'BBLS',NULL),

  ('b21e0000-0000-4000-8000-000000000192','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Shore figure','number',2,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,'BBLS',NULL),

  ('b21e0000-0000-4000-8000-000000000193','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Difference (Ship − Shore)','calculated',3,false,'[]'::jsonb,'{}'::jsonb,
   '{b21e0000-0000-4000-8000-000000000191}-{b21e0000-0000-4000-8000-000000000192}',
   NULL,'',false,'BBLS',
   'Negative when the ship received less than the shore figure.'),

  ('b21e0000-0000-4000-8000-000000000194','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   '% Variance vs shore figure','calculated',4,false,'[]'::jsonb,
   jsonb_build_object('display_as','percentage','thresholds',jsonb_build_array(
     jsonb_build_object('max',1.0,'color','green'),
     jsonb_build_object('max',2.0,'color','amber'),
     jsonb_build_object('color','red'))),
   '{b21e0000-0000-4000-8000-000000000191}-{b21e0000-0000-4000-8000-000000000192}',
   NULL,'',false,'BBLS',
   'Green under 1%, amber 1–2%, red 2% and above, on the size of the variance either way.'),

  ('b21e0000-0000-4000-8000-000000000195','b21e0000-0000-4000-8000-000000000001','b21e0000-0000-4000-8000-000000000016',
   'Has the cargo certificate been issued and signed by the vessel, surveyor and shipper representatives?','yes_no',5,true,
   '[]'::jsonb,'{}'::jsonb,NULL,NULL,'33',true,NULL,NULL)

ON CONFLICT (id) DO NOTHING;
