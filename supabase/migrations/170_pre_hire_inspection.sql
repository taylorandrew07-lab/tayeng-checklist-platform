-- ============================================================================
-- Migration 170: Pre-Hire Inspection checklist (CMID-derived, <500GT)
--
-- A vessel condition/certification inspection for a small fast PSV or crew-supply
-- vessel, weighted towards what governs carrying industrial personnel on a daily
-- offshore-to-river service. Derived from the IMCA Common Marine Inspection Document
-- at the sub-500GT level, for a vessel already carrying OVID-standard certification.
--
-- THE REPORT RECORDS FACTS ONLY. There is deliberately no recommendation field, no
-- score and no "suitable / not suitable" verdict anywhere in this template. The
-- pdf_preamble says so on page 1. Any opinion belongs in the covering letter over the
-- surveyor's signature, not in a checklist.
--
-- Design for a 3-4 hour attendance: grouped questions ("are they ALL valid?" with the
-- full list in the help text, plus a tick-list of what was individually sighted) keep a
-- clean vessel to ~75 visible items, while a "No" reveals the detail box and a photo
-- field. ~165 fields are authored; most stay hidden.
--
-- Answer types: 'yes_no' for direct-evidence items that must not be waved through as
-- N/A; 'yes_no_na' elsewhere. Colours default to yes=green / no=red / na=grey. An
-- explicit per-option "color" reverses that where No is the desired answer. A fourth
-- option {"value":"ni","label":"Not inspected"} is offered on the items where not
-- seeing something differs materially from it not applying — the option LIST is
-- template-driven as of lib/checklist/answerOptions.ts.
--
-- HEADER TRAP (src/lib/pdf/JobPDF.tsx:545-576): the report finds its Date/Port/Vessel
-- header rows by regex over text/date/dropdown/number/time fields in flat order, and
-- DELETES the winners from the report body. Section 1 therefore comes first and holds
-- fields labelled exactly 'Date' and 'Port', so "Port of registry" and the certificate
-- dates further down lose the race and print normally. No text/number/date/dropdown/
-- time label anywhere in this template contains the bare word "vessel".
--
-- CONDITIONAL TRAP: conditions are FLAT (one and/or per field, no nesting), so every
-- descendant repeats its ancestor's conditions. And a 'multiple_choice' field can never
-- drive a condition — its answers live in value_array, which checkConditionalLogic
-- never reads — which is why the transfer-method gateway (9.1) is a 'dropdown' and the
-- tick-lists gate nothing.
--
-- Idempotent: fixed UUIDs (c41d0000-…) + ON CONFLICT DO NOTHING throughout.
-- Paste-runnable in the Supabase SQL Editor.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Per-template PDF flag: print each photo field's photos under ITS OWN section
--    instead of pooling them onto "Additional Photographs" pages at the back, where
--    nothing tied a defect photo to the item it evidenced. Default false, so every
--    existing report is unchanged.
-- ------------------------------------------------------------
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_photos_inline BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.pdf_photos_inline IS
  'Print each photo field''s photos under its own section in the report PDF, rather than on the end-of-report Additional Photographs pages. Photos in a repeatable section already print per entry regardless of this flag.';

-- ------------------------------------------------------------
-- 2. Job type
-- ------------------------------------------------------------
INSERT INTO public.job_types (name) VALUES ('Pre-Hire Inspection')
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Template
--
-- Seeded ACTIVE, not draft: admin/jobs/new filters on status='active', so a draft
-- template is invisible in the New Job picker (migration 137 shipped draft and needed a
-- manual flip before it could be used).
-- ------------------------------------------------------------
INSERT INTO public.checklist_templates
  (id, name, description, status, allow_surveyor_start, pdf_include_photos,
   pdf_photos_inline, requires_report_number, manual_numbering, pdf_balanced_header,
   default_job_type, color, pdf_preamble, pdf_disclaimer, created_by)
SELECT 'c41d0000-0000-4000-8000-000000000001',
       'Pre-Hire Inspection',
       'Condition, certification and equipment inspection of a fast crew-supply or platform supply vessel engaged in the daily transfer of industrial personnel between an offshore location and a river berth. Derived from the IMCA Common Marine Inspection Document (CMID) at the sub-500GT level. Records observed facts only — no recommendations and no assessment of suitability.',
       'active'::template_status,
       true,   -- allow_surveyor_start: started on board, often before signal returns
       true,   -- pdf_include_photos
       true,   -- pdf_photos_inline: a defect photo prints under the item it evidences
       true,   -- requires_report_number
       true,   -- manual_numbering: dotted CMID numbers (3.1, 3.1A), authored by hand
       true,   -- pdf_balanced_header: 5 header rows split 3/2 rather than 4/1
       'Pre-Hire Inspection',
       'teal',
       'Taylor Engineering Agencies Limited attended the above vessel to carry out a pre-hire inspection. This report records the condition, certification and equipment of the vessel as observed on board on the date stated, together with the inspection particulars and supporting photographs. It is a factual record only: it contains no assessment, recommendation or conclusion as to the vessel''s suitability for any particular service.',
       'This report remains the property of Taylor Engineering Agencies Limited ("Taylor Engineering") and the commissioning client. It reflects conditions observed at the time of survey and is issued in good faith for their exclusive use. The information herein shall not be reproduced, disclosed, or relied upon by any third party without written consent. This report is submitted without prejudice to the rights and interests of whom it may concern.',
       COALESCE((SELECT id FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
                (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Sections
--
-- Section 1 MUST stay at order_index 0 — see the header trap in the file header.
-- The Findings section is gated on 15.3 so that a clean inspection prints no empty
-- findings appendix, and so its fields can be required without blocking submission
-- when there is nothing to record (a repeatable section always resolves to entry 0).
-- ------------------------------------------------------------
INSERT INTO public.template_sections
  (id, template_id, title, description, order_index, is_repeatable, conditional_logic) VALUES
  ('c41d0000-0000-4000-8000-000000000010','c41d0000-0000-4000-8000-000000000001','Survey Details','Completed first. The Date and Port entered here fill the report header.',0,false,NULL),
  ('c41d0000-0000-4000-8000-000000000011','c41d0000-0000-4000-8000-000000000001','Vessel Particulars','From the certificates and the general arrangement.',1,false,NULL),
  ('c41d0000-0000-4000-8000-000000000012','c41d0000-0000-4000-8000-000000000001','Certification & Documentation','Statutory, class and commercial documents.',2,false,NULL),
  ('c41d0000-0000-4000-8000-000000000013','c41d0000-0000-4000-8000-000000000001','Crew, Manning & Certification','Manning against the safe manning document, competency, and rest hours for a daily service.',3,false,NULL),
  ('c41d0000-0000-4000-8000-000000000014','c41d0000-0000-4000-8000-000000000001','Safety Management & Emergency Preparedness','Management system, muster arrangements and emergency response.',4,false,NULL),
  ('c41d0000-0000-4000-8000-000000000015','c41d0000-0000-4000-8000-000000000001','Life-Saving Appliances','Inventory, servicing and stowage against the maximum persons carried.',5,false,NULL),
  ('c41d0000-0000-4000-8000-000000000016','c41d0000-0000-4000-8000-000000000001','Fire Fighting Appliances','Detection, fixed and portable appliances, and emergency shutdowns.',6,false,NULL),
  ('c41d0000-0000-4000-8000-000000000017','c41d0000-0000-4000-8000-000000000001','Industrial Personnel Arrangements','Seating, escape, briefing and welfare for the personnel to be carried.',7,false,NULL),
  ('c41d0000-0000-4000-8000-000000000018','c41d0000-0000-4000-8000-000000000001','Personnel Transfer Arrangements','How personnel get on and off the vessel offshore.',8,false,NULL),
  ('c41d0000-0000-4000-8000-000000000019','c41d0000-0000-4000-8000-000000000001','Navigation & Communications','Bridge equipment, charts and passage planning, GMDSS.',9,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001a','c41d0000-0000-4000-8000-000000000001','Machinery, Engine Room & Steering','Propulsion, power generation, steering and bilge systems.',10,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001b','c41d0000-0000-4000-8000-000000000001','Hull, Deck & Mooring','Structural condition, closing appliances, deck fittings and mooring equipment.',11,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001c','c41d0000-0000-4000-8000-000000000001','Pollution Prevention & Security','MARPOL documentation and records, bunkering, and ISPS arrangements.',12,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001d','c41d0000-0000-4000-8000-000000000001','Intended Route & Local Operations','The service as advised, and what it asks of the vessel.',13,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001e','c41d0000-0000-4000-8000-000000000001','Attendance Summary','What was and was not inspected.',14,false,NULL),
  ('c41d0000-0000-4000-8000-00000000001f','c41d0000-0000-4000-8000-000000000001','Findings — Observations & Deficiencies','Add one entry per matter recorded. Facts only: what was seen, and where.',15,true,
     jsonb_build_object('operator','and','conditions',jsonb_build_array(
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000f02','operator','equals','value','yes')))),
  ('c41d0000-0000-4000-8000-000000000020','c41d0000-0000-4000-8000-000000000001','Surveyor Sign-off','',16,false,NULL)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Fields
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES

-- ===== 1. Survey Details ====================================================
-- 'Date' and 'Port' are named EXACTLY so, and sit in the first section, so they win
-- the header regex ahead of "Port of registry" and the certificate expiry dates.
  ('c41d0000-0000-4000-8000-000000000100','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000010',
   'Date','date',0,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'1.1',false,NULL,'Date of attendance on board.',false),
  ('c41d0000-0000-4000-8000-000000000101','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000010',
   'Port','text',1,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'1.2',false,NULL,'Berth, terminal or anchorage where the inspection took place.',false),
  ('c41d0000-0000-4000-8000-000000000102','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000010',
   'Time boarded','time',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'1.3',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000103','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000010',
   'Time departed','time',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'1.4',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000104','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000010',
   'Persons met on board','textarea',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'1.5',false,NULL,'Name and rank of those who attended the inspection.',true),

-- ===== 2. Vessel Particulars ================================================
-- No label here contains the bare word "vessel" — every one of these is a header
-- candidate type, and "vessel" alone would be swallowed into the header block.
  ('c41d0000-0000-4000-8000-000000000200','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'IMO number','text',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.1',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000201','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Flag','text',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.2',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000202','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Port of registry','text',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.3',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000203','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Call sign','text',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.4',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000204','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Classification society and notation','text',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.5',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000205','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Year built and builder','text',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.6',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000206','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Length overall','number',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.7',false,'m',NULL,false),
  ('c41d0000-0000-4000-8000-000000000207','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Breadth moulded','number',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.8',false,'m',NULL,false),
  ('c41d0000-0000-4000-8000-000000000208','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Maximum draught','number',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.9',false,'m','Governs the river bar and berth — see section 14.',false),
  ('c41d0000-0000-4000-8000-000000000209','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Air draught','number',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.10',false,'m',NULL,false),
  ('c41d0000-0000-4000-8000-00000000020a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Gross tonnage','number',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.11',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000020b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Main propulsion and installed power','text',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.12',false,NULL,'Engine make/model, number of units, total kW, and drive type (screw, waterjet).',false),
  ('c41d0000-0000-4000-8000-00000000020c','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000011',
   'Registered owner and manager','text',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'2.13',false,NULL,NULL,false),

-- ===== 3. Certification & Documentation =====================================
-- The grouped pattern: headline yes/no with the whole list in help_text, a tick-list
-- recording what was individually sighted, then detail + photo revealed on "No".
  ('c41d0000-0000-4000-8000-000000000300','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Are all statutory, flag and class certificates on board, valid and in date?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'3.1',true,NULL,
   'Certificate of Registry · Class certificate · Load Line · Safety Construction · Safety Equipment · Safety Radio · ISM SMC · ISPS ISSC · MLC · IOPP · Tonnage · Minimum Safe Manning Document · Radio Licence · P&I entry · Hull & Machinery · approved Stability Book. Answer once for the set, then tick below what you sighted individually.',false),
  ('c41d0000-0000-4000-8000-000000000301','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Certificates individually sighted','multiple_choice',1,false,
   '[{"value":"registry","label":"Certificate of Registry"},{"value":"class","label":"Class certificate"},{"value":"load_line","label":"Load Line"},{"value":"safety_construction","label":"Safety Construction"},{"value":"safety_equipment","label":"Safety Equipment"},{"value":"safety_radio","label":"Safety Radio"},{"value":"ism_smc","label":"ISM Safety Management Certificate"},{"value":"ism_doc","label":"ISM Document of Compliance (company)"},{"value":"isps","label":"ISPS International Ship Security Certificate"},{"value":"mlc","label":"Maritime Labour Certificate"},{"value":"iopp","label":"IOPP"},{"value":"tonnage","label":"Tonnage certificate"},{"value":"msmd","label":"Minimum Safe Manning Document"},{"value":"radio_licence","label":"Radio licence"},{"value":"pandi","label":"P&I entry certificate"},{"value":"hm","label":"Hull & Machinery insurance"},{"value":"stability","label":"Approved stability book"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'3.2',false,NULL,'Tick every certificate you personally sighted. Records the scope of the check.',false),
  ('c41d0000-0000-4000-8000-000000000302','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Which certificate(s), and what was found?','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000300','operator','equals','value','no'))),
   '3.1A',false,NULL,'Name the certificate, its expiry, and what is outstanding.',true),
  ('c41d0000-0000-4000-8000-000000000303','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Photographs — certification','photo',3,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000300','operator','equals','value','no'))),
   '3.1B',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000304','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Maximum number of persons stated on the certificate','number',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.3',false,'persons','Total persons permitted — crew plus industrial personnel.',false),
  ('c41d0000-0000-4000-8000-000000000305','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Does the certificate expressly permit the carriage of industrial or special personnel?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.4',true,NULL,'Record the wording used on the certificate in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000000306','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Number of industrial personnel permitted','number',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.5',false,'persons',NULL,false),
  ('c41d0000-0000-4000-8000-000000000307','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Operational or trading area stated on the certificate','textarea',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.6',false,NULL,'Quote the limits as written, including any distance-from-safe-haven restriction.',true),
  ('c41d0000-0000-4000-8000-000000000308','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Are there any outstanding conditions of class, memoranda or flag dispensations?','yes_no_na',8,false,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'3.7',true,NULL,'No is the expected answer, so the colours are reversed here.',false),
  ('c41d0000-0000-4000-8000-000000000309','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Details of the outstanding items','textarea',9,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000308','operator','equals','value','yes'))),
   '3.7A',false,NULL,'Reference number, description and due date of each.',true),
  ('c41d0000-0000-4000-8000-00000000030a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Date of last drydocking, and next due','text',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.8',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000030b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Were any Port State Control or flag deficiencies or detentions recorded in the last 12 months?','yes_no_na',11,false,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'3.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000030c','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000012',
   'Is a previous CMID, OVID or OVPQ report available on board?','yes_no_na',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'3.10',true,NULL,'Note the date and inspecting body in the remarks.',false),

-- ===== 4. Crew, Manning & Certification =====================================
  ('c41d0000-0000-4000-8000-000000000400','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Does the crew on board meet or exceed the Minimum Safe Manning Document?','yes_no',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.1',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000401','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Number of crew on board','number',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.2',false,'persons',NULL,false),
  ('c41d0000-0000-4000-8000-000000000402','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Are all certificates of competency, flag endorsements, medicals and STCW training valid and in date?','yes_no_na',2,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'4.3',true,NULL,
   'Master and officers'' CoCs with flag endorsements · ratings'' certificates · seafarer medical certificates · STCW basic safety training · advanced fire fighting · medical first aid · fast rescue craft · offshore survival (HUET/BOSIET) where required.',false),
  ('c41d0000-0000-4000-8000-000000000403','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Crew certificates individually sighted','multiple_choice',3,false,
   '[{"value":"master_coc","label":"Master — CoC + endorsement"},{"value":"co_coc","label":"Chief Officer — CoC + endorsement"},{"value":"ce_coc","label":"Chief Engineer — CoC + endorsement"},{"value":"2e_coc","label":"Second Engineer — CoC + endorsement"},{"value":"ratings","label":"Ratings — certificates"},{"value":"medicals","label":"Seafarer medical certificates"},{"value":"stcw_basic","label":"STCW basic safety training"},{"value":"adv_ff","label":"Advanced fire fighting"},{"value":"med_first_aid","label":"Medical first aid"},{"value":"frc","label":"Fast rescue craft"},{"value":"huet","label":"Offshore survival (HUET / BOSIET)"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'4.4',false,NULL,'Tick every certificate you personally sighted.',false),
  ('c41d0000-0000-4000-8000-000000000404','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Which certificate(s), and what was found?','textarea',4,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000402','operator','equals','value','no'))),
   '4.3A',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000405','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Are hours-of-rest records maintained, and do they show compliance?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.5',true,NULL,'Look specifically at whether the proposed daily round trip can be run within the rest-hour limits on the current manning.',false),
  ('c41d0000-0000-4000-8000-000000000406','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Estimated round-trip duration for the proposed service','number',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.6',false,'hours','Berth to offshore location and back, including transfer time.',false),
  ('c41d0000-0000-4000-8000-000000000407','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Watchkeeping arrangement described for a daily service','textarea',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.7',false,NULL,'How the vessel proposes to crew a daily round trip — watch pattern, additional crew, or crew change ashore.',true),
  ('c41d0000-0000-4000-8000-000000000408','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Is the Master, or an embarked pilot, licensed and experienced for the river transit?','yes_no_na',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.8',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000409','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Is a drug and alcohol policy in place, with testing records?','yes_no_na',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000040a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Are drill records — abandon ship, fire and man overboard — up to date?','yes_no_na',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.10',true,NULL,'Note the date of the most recent of each in the remarks.',false),
  ('c41d0000-0000-4000-8000-00000000040b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000013',
   'Working language used with industrial personnel','text',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'4.11',false,NULL,NULL,false),

-- ===== 5. Safety Management & Emergency Preparedness ========================
  ('c41d0000-0000-4000-8000-000000000500','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is a documented safety management system in use on board?','yes_no_na',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.1',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000501','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is the muster list posted and current, and does it include industrial personnel?','yes_no',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.2',true,NULL,'Both halves matter — a muster list that omits 20 passengers is the finding.',false),
  ('c41d0000-0000-4000-8000-000000000502','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Are emergency stations, escape routes and safety signage clearly marked?','yes_no',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000503','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Are risk assessments, permit-to-work and toolbox-talk records in use?','yes_no_na',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000504','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Is there a documented emergency response plan covering the intended route?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000505','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Are the medical kit, stretcher, oxygen and defibrillator present and in date?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.6',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000506','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Medical evacuation arrangement described','textarea',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.7',false,NULL,'Who is called, from where, and how a casualty leaves the vessel on this route.',true),
  ('c41d0000-0000-4000-8000-000000000507','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Photographs — safety management','photo',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.8',false,NULL,NULL,false),

-- ===== 6. Life-Saving Appliances ============================================
  ('c41d0000-0000-4000-8000-000000000600','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Are all life-saving appliances present, in good condition and within their service dates?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6.1',true,NULL,
   'Liferafts and HRUs · lifebuoys with lights, smoke and buoyant lines · lifejackets with lights and whistles · immersion suits · thermal protective aids · pyrotechnics · line-throwing appliance · EPIRB · SARTs · rescue boat · embarkation ladders.',false),
  ('c41d0000-0000-4000-8000-000000000601','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'LSA items individually verified','multiple_choice',1,false,
   '[{"value":"liferafts","label":"Liferafts"},{"value":"hrus","label":"Hydrostatic release units"},{"value":"lifebuoys","label":"Lifebuoys, lights and smoke"},{"value":"lifejackets","label":"Lifejackets, lights and whistles"},{"value":"immersion","label":"Immersion suits"},{"value":"tpa","label":"Thermal protective aids"},{"value":"pyro","label":"Pyrotechnics"},{"value":"line_thrower","label":"Line-throwing appliance"},{"value":"epirb","label":"EPIRB"},{"value":"sart","label":"SARTs"},{"value":"rescue_boat","label":"Rescue / MOB boat"},{"value":"ladders","label":"Embarkation ladders"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'6.2',false,NULL,'Tick every item you physically checked.',false),
  ('c41d0000-0000-4000-8000-000000000602','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Which item(s), and what was found?','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000600','operator','equals','value','no'))),
   '6.1A',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000603','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Total liferaft capacity','number',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.3',false,'persons','Sum of all rafts. Compare against 3.3 and 8.1.',false),
  ('c41d0000-0000-4000-8000-000000000604','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Total lifejackets on board','number',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.4',false,NULL,'Compare against the maximum persons at 3.3.',false),
  ('c41d0000-0000-4000-8000-000000000605','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Are lifejackets stowed in, or immediately adjacent to, the personnel seating space?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000606','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Are liferaft service and HRU dates in date, with float-free stowage clear?','yes_no',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.6',true,NULL,'Record the service dates in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000000607','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Is a rescue or man-overboard boat fitted and operational?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000608','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Is there a documented and practised means of recovering a person from the water?','yes_no_na',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.8',true,NULL,'Recovery, not just retrieval — how an unconscious person is brought aboard.',false),
  ('c41d0000-0000-4000-8000-000000000609','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Is the EPIRB registration current, with battery and hydrostatic release in date?','yes_no_na',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000060a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Are pyrotechnics in date?','yes_no_na',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.10',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000060b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000015',
   'Photographs — life-saving appliances','photo',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'6.11',false,NULL,NULL,false),

-- ===== 7. Fire Fighting Appliances ==========================================
  ('c41d0000-0000-4000-8000-000000000700','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Are all fire-fighting appliances present, in position, serviced and in date?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.1',true,NULL,
   'Portable extinguishers · fire hoses, nozzles and hydrants · fire main and pump · emergency fire pump · fireman''s outfits · SCBA sets and spare cylinders · EEBDs · fixed machinery-space system · detection and alarm panel · ventilation closures and fire dampers · remote fuel shut-offs · international shore connection.',false),
  ('c41d0000-0000-4000-8000-000000000701','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'FFA items individually verified','multiple_choice',1,false,
   '[{"value":"extinguishers","label":"Portable extinguishers"},{"value":"hoses","label":"Fire hoses and nozzles"},{"value":"hydrants","label":"Hydrants"},{"value":"fire_main","label":"Fire main and pump"},{"value":"emg_pump","label":"Emergency fire pump"},{"value":"fireman_outfit","label":"Fireman''s outfits"},{"value":"scba","label":"SCBA sets and spare cylinders"},{"value":"eebd","label":"EEBDs"},{"value":"fixed_system","label":"Fixed machinery-space system"},{"value":"detection","label":"Detection and alarm panel"},{"value":"dampers","label":"Ventilation closures and dampers"},{"value":"remote_stops","label":"Remote fuel shut-offs"},{"value":"shore_connection","label":"International shore connection"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'7.2',false,NULL,'Tick every item you physically checked.',false),
  ('c41d0000-0000-4000-8000-000000000702','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Which item(s), and what was found?','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000700','operator','equals','value','no'))),
   '7.1A',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000703','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Was the fire detection and alarm panel tested, with no faults or inhibits showing?','yes_no',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000704','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Was the fire main tested, with satisfactory pressure at the furthest hydrant?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000705','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Is the fixed machinery-space system in date, with the release station clear and marked?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.5',true,NULL,'Note the type (CO2, foam, water mist) and last service in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000000706','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Are emergency stops and remote shut-offs marked, and were they tested?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.6',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000707','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Are SCBA cylinder pressures satisfactory, with a compressor or spare cylinders available?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000708','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Is the general alarm audible throughout, including in the personnel seating space?','yes_no',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.8',true,NULL,'Have it sounded while you stand in the personnel space.',false),
  ('c41d0000-0000-4000-8000-000000000709','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000016',
   'Photographs — fire fighting appliances','photo',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'7.9',false,NULL,NULL,false),

-- ===== 8. Industrial Personnel Arrangements =================================
-- The heart of this inspection: everything that governs carrying ~20 people.
  ('c41d0000-0000-4000-8000-000000000800','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Number of persons to be carried on the proposed service','number',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.1',false,'persons',NULL,false),
  ('c41d0000-0000-4000-8000-000000000801','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   -- No colour thresholds: the PDF only applies them to percentage-display calculated
   -- fields (JobPDF.tsx:411), so they would be dead configuration here. The sign of the
   -- number carries the meaning, and the help text says so.
   'Margin against the certified maximum','calculated',1,false,'[]'::jsonb,'{}'::jsonb,
   '{c41d0000-0000-4000-8000-000000000304}-{c41d0000-0000-4000-8000-000000000800}',NULL,'8.2',false,'persons',
   'Certified maximum (3.3) less the number to be carried (8.1). A negative figure means the proposed complement exceeds the certificate.',false),
  ('c41d0000-0000-4000-8000-000000000802','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is dedicated seating provided for every person to be carried?','yes_no',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000803','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Number of fixed seats fitted','number',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.4',false,'seats',NULL,false),
  ('c41d0000-0000-4000-8000-000000000804','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Are the seats fitted with belts or harnesses?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000805','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Were the seats found in good condition?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.6',true,NULL,'Mountings, cushions, belt webbing and buckles.',false),
  ('c41d0000-0000-4000-8000-000000000806','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is the seating space fully enclosed and protected from the weather?','yes_no',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000807','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Are there two independent means of escape from the seating space?','yes_no',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.8',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000808','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Are escape routes unobstructed and marked, with emergency lighting?','yes_no',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000809','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is fire detection fitted in the personnel space?','yes_no_na',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.10',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000080a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Number of toilets accessible from the personnel space','number',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.11',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000080b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Are drinking water and provisions available for the transit duration?','yes_no_na',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.12',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000080c','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is a pre-departure safety briefing given, with a briefing card, placard or video?','yes_no_na',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.13',true,NULL,'Ask to see the briefing material itself, not just the procedure.',false),
  ('c41d0000-0000-4000-8000-00000000080d','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is a personnel manifest prepared for each trip and sent ashore before departure?','yes_no_na',13,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.14',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000080e','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is secured baggage stowage provided, with the seating space free of loose items?','yes_no_na',14,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.15',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-00000000080f','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Is the stretcher route from the personnel space to the deck clear?','yes_no_na',15,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.16',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000810','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000017',
   'Photographs — personnel arrangements','photo',16,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'8.17',false,NULL,'Seating, escape routes, briefing placard and lifejacket stowage.',false),

-- ===== 9. Personnel Transfer Arrangements ===================================
-- 9.1 is a DROPDOWN, not multiple_choice: only a scalar answer can drive the
-- per-method follow-ups below (see the conditional trap in the file header).
  ('c41d0000-0000-4000-8000-000000000900','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Primary means of personnel transfer offshore','dropdown',0,false,
   '[{"value":"gangway","label":"Gangway / walk-to-work system"},{"value":"basket","label":"Personnel transfer basket or carrier"},{"value":"swing_rope","label":"Swing rope"},{"value":"boat_landing","label":"Boat landing / step-across"},{"value":"other","label":"Other"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'9.1',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000901','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Describe the means of transfer','text',1,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','other'))),
   '9.1A',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000902','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is the deck landing area clear, marked, non-slip and adequately lit?','yes_no_na',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','basket'))),
   '9.1B',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000903','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is the gangway or walk-to-work system certified, with current inspection records?','yes_no_na',3,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','gangway'))),
   '9.1C',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000904','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is the transfer area fitted with adequate handholds, guardrails and non-slip surfaces?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','or','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','swing_rope'),
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','boat_landing'))),
   '9.1D',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000905','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is the transfer deck lighting adequate for transfers in darkness?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'9.2',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000906','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Are the operating limits for personnel transfer documented?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'9.3',true,NULL,'Significant wave height, wind speed and any swell-period limit.',false),
  ('c41d0000-0000-4000-8000-000000000907','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Maximum significant wave height stated for transfer','number',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'9.4',false,'m',NULL,false),
  ('c41d0000-0000-4000-8000-000000000908','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Is there a documented man-overboard procedure covering transfer operations?','yes_no_na',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'9.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000909','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000018',
   'Photographs — transfer arrangements','photo',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'9.6',false,NULL,NULL,false),

-- ===== 10. Navigation & Communications ======================================
  ('c41d0000-0000-4000-8000-000000000a00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is all bridge navigational equipment operational?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'10.1',true,NULL,
   'Radar(s) and ARPA · ECDIS · GPS ×2 · gyro · magnetic compass with a current deviation card · autopilot · echo sounder · speed log · AIS · VDR · BNWAS · searchlight · navigation lights and shapes · sound signalling · daylight signalling lamp.',false),
  ('c41d0000-0000-4000-8000-000000000a01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Navigation equipment individually verified','multiple_choice',1,false,
   '[{"value":"radar1","label":"Radar 1"},{"value":"radar2","label":"Radar 2 / ARPA"},{"value":"ecdis","label":"ECDIS"},{"value":"gps","label":"GPS ×2"},{"value":"gyro","label":"Gyro compass"},{"value":"magnetic","label":"Magnetic compass + deviation card"},{"value":"autopilot","label":"Autopilot"},{"value":"echo_sounder","label":"Echo sounder"},{"value":"speed_log","label":"Speed log"},{"value":"ais","label":"AIS"},{"value":"vdr","label":"VDR"},{"value":"bnwas","label":"BNWAS"},{"value":"searchlight","label":"Searchlight"},{"value":"nav_lights","label":"Navigation lights and shapes"},{"value":"sound_signal","label":"Sound signalling"},{"value":"signalling_lamp","label":"Daylight signalling lamp"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'10.2',false,NULL,'Tick every item you saw working.',false),
  ('c41d0000-0000-4000-8000-000000000a02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Which item(s), and what was found?','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000a00','operator','equals','value','no'))),
   '10.1A',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000a03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Are charts and publications held and corrected for the whole intended route, offshore and river?','yes_no',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.3',true,NULL,'Both ends of the route. Check the river approaches specifically.',false),
  ('c41d0000-0000-4000-8000-000000000a04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is a berth-to-berth passage plan prepared for the intended route?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a05','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is an under-keel clearance policy documented for the river bar and berth?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a06','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is bridge visibility clear, with wipers and clearview screens operational?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.6',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a07','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is all GMDSS equipment operational for the area of operation?','yes_no_na',7,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'10.7',true,NULL,
   'VHF DSC ×2 · MF/HF DSC · satellite communications · NAVTEX · EPIRB · SARTs ×2 · portable VHF ×3 · reserve power source and charger.',false),
  ('c41d0000-0000-4000-8000-000000000a08','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'GMDSS equipment individually verified','multiple_choice',8,false,
   '[{"value":"vhf_dsc","label":"VHF DSC ×2"},{"value":"mfhf","label":"MF/HF DSC"},{"value":"satcom","label":"Satellite communications"},{"value":"navtex","label":"NAVTEX"},{"value":"epirb","label":"EPIRB"},{"value":"sart","label":"SARTs ×2"},{"value":"portable_vhf","label":"Portable VHF ×3"},{"value":"reserve_power","label":"Reserve power and charger"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'10.8',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a09','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is satellite or mobile coverage available along the intended route?','yes_no_na',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a0a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Is night navigation on the river intended?','yes_no_na',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.10',true,NULL,'If so, note what the vessel relies on for the unlit stretches.',false),
  ('c41d0000-0000-4000-8000-000000000a0b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Bridge manning level stated for the river transit','text',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.11',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a0c','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Are the anchors, windlass and cable in good order and ready for use?','yes_no_na',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.12',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000a0d','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000019',
   'Photographs — navigation and communications','photo',13,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'10.13',false,NULL,NULL,false),

-- ===== 11. Machinery, Engine Room & Steering ================================
  ('c41d0000-0000-4000-8000-000000000b00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are the main engines, gearboxes and propulsion operational, with no significant leaks?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'11.1',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Main engine running hours','text',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.2',false,NULL,'Per engine, and hours since last major overhaul if known.',false),
  ('c41d0000-0000-4000-8000-000000000b02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Is the engine room clean, with bilges free of oil accumulation?','yes_no',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Were machinery alarms and shutdowns tested and found operational?','yes_no_na',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are main and auxiliary steering operational, with emergency steering tested and the changeover procedure posted?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b05','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are the generators operational, with adequate redundancy?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.6',true,NULL,'Note how many are fitted and how many were running.',false),
  ('c41d0000-0000-4000-8000-000000000b06','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Was the emergency generator or battery tested on load, with emergency lighting operational?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b07','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are the bilge pumping system, alarms and emergency bilge suction operational?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.8',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b08','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are the bow thruster and other manoeuvring aids operational?','yes_no_na',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b09','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Fuel capacity','number',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.10',false,'m³',NULL,false),
  ('c41d0000-0000-4000-8000-000000000b0a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Endurance at service speed','number',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.11',false,'hours',NULL,false),
  ('c41d0000-0000-4000-8000-000000000b0b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Is a planned maintenance system in use, with no overdue critical jobs?','yes_no_na',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.12',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b0c','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are critical spares held on board?','yes_no_na',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.13',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b0d','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are engine room escape routes clear and marked?','yes_no',13,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.14',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000b0e','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Photographs — machinery and steering','photo',14,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.15',false,NULL,NULL,false),

-- ===== 12. Hull, Deck & Mooring =============================================
  ('c41d0000-0000-4000-8000-000000000c00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Is the external hull free of visible damage, indents and significant corrosion?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'12.1',true,NULL,'Above the waterline, from the quay and from the deck.',false),
  ('c41d0000-0000-4000-8000-000000000c01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Is the coating condition satisfactory?','yes_no_na',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.2',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are watertight doors, hatches and closing appliances in good order, with sound seals?','yes_no',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are guardrails, bulwarks and stanchions intact?','yes_no',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are deck surfaces non-slip and in good condition?','yes_no',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.5',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c05','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are access ladders, stairways and handrails in good order?','yes_no',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.6',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c06','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are freeing ports and scuppers clear?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c07','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are the load line and draught marks legible?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.8',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c08','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Is an approved stability book on board, and is the current condition within its limits?','yes_no',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.9',true,NULL,'Ask specifically for the loading condition covering the personnel-carrying case.',false),
  ('c41d0000-0000-4000-8000-000000000c09','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are the mooring equipment, lines and winches in good order?','yes_no_na',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.10',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c0a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are the accommodation and galley clean, with satisfactory housekeeping?','yes_no_na',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.11',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000c0b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Photographs — hull, deck and mooring','photo',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.12',false,NULL,NULL,false),

-- ===== 13. Pollution Prevention & Security ==================================
  ('c41d0000-0000-4000-8000-000000000d00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Are pollution-prevention certificates, plans and records held and current?','yes_no_na',0,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'13.1',true,NULL,
   'IOPP · Oil Record Book · oily water separator and 15ppm alarm · SOPEP and its equipment · spill kit · Garbage Management Plan, record book and placards · sewage treatment or holding · ballast water management plan · IAPP.',false),
  ('c41d0000-0000-4000-8000-000000000d01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Pollution-prevention items individually verified','multiple_choice',1,false,
   '[{"value":"iopp","label":"IOPP certificate"},{"value":"orb","label":"Oil Record Book"},{"value":"ows","label":"OWS and 15ppm alarm"},{"value":"sopep","label":"SOPEP and equipment"},{"value":"spill_kit","label":"Spill kit"},{"value":"garbage","label":"Garbage plan, book and placards"},{"value":"sewage","label":"Sewage treatment or holding"},{"value":"ballast","label":"Ballast water management plan"},{"value":"iapp","label":"IAPP certificate"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'13.2',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000d02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Which item(s), and what was found?','textarea',2,false,'[]'::jsonb,'{}'::jsonb,NULL,
   jsonb_build_object('operator','and','conditions',jsonb_build_array(
     jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000d00','operator','equals','value','no'))),
   '13.1A',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000d03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Is the bunkering procedure documented, with scuppers plugged and save-alls in place?','yes_no_na',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.3',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000d04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Is a ship security plan in place, with a designated security officer?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.4',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000d05','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Are there access control arrangements for personnel embarking and disembarking daily?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.5',true,NULL,'Twenty people a day, twice a day, is a different problem from an occasional visitor.',false),
  ('c41d0000-0000-4000-8000-000000000d06','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Are restricted areas marked and controlled?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.6',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000d07','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Are security drills and records up to date?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000d08','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001c',
   'Photographs — pollution prevention and security','photo',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'13.8',false,NULL,NULL,false),

-- ===== 14. Intended Route & Local Operations ================================
  ('c41d0000-0000-4000-8000-000000000e00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Intended route as advised','textarea',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.1',false,NULL,'Record the route as the charterer described it, in their terms.',true),
  ('c41d0000-0000-4000-8000-000000000e01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Transit time each way','number',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.2',false,'hours',NULL,false),
  ('c41d0000-0000-4000-8000-000000000e02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Distance each way','number',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.3',false,'nm',NULL,false),
  ('c41d0000-0000-4000-8000-000000000e03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Service speed on passage','number',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.4',false,'kn',NULL,false),
  ('c41d0000-0000-4000-8000-000000000e04','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Does the draught permit transit of the river bar and berth at all states of tide?','yes_no_na',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.5',true,NULL,'Compare 2.9 against the charted depths on the approach.',false),
  ('c41d0000-0000-4000-8000-000000000e05','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Is a tidal window required?','yes_no_na',5,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.6',true,NULL,'If so, note the window and who calculates it.',false),
  ('c41d0000-0000-4000-8000-000000000e06','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Does the air draught permit passage of any overhead obstruction on the river?','yes_no_na',6,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.7',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000e07','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Is the berthing arrangement at the river terminal adequate — fenders, bollards, linesmen and safe access ashore?','yes_no_na',7,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.8',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000e08','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Is pilotage compulsory for the river transit?','yes_no_na',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.9',true,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000000e09','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Fuel endurance in days of the proposed service before bunkering','number',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.10',false,'days',NULL,false),
  ('c41d0000-0000-4000-8000-000000000e0a','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Bunkering, fresh water and provisioning arrangements at the river berth','textarea',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.11',false,NULL,NULL,true),
  ('c41d0000-0000-4000-8000-000000000e0b','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001d',
   'Nearest port of refuge, and the towage or breakdown arrangement','textarea',11,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'14.12',false,NULL,NULL,true),

-- ===== 15. Attendance Summary ===============================================
-- 15.3 gates the whole Findings section: a clean inspection prints no findings
-- appendix, and the findings fields can be required without blocking submission when
-- there is nothing to record.
  ('c41d0000-0000-4000-8000-000000000f00','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001e',
   'Areas inspected','multiple_choice',0,false,
   '[{"value":"certification","label":"Certification and documentation"},{"value":"crew","label":"Crew, manning and certification"},{"value":"sms","label":"Safety management and emergency preparedness"},{"value":"lsa","label":"Life-saving appliances"},{"value":"ffa","label":"Fire fighting appliances"},{"value":"personnel","label":"Industrial personnel arrangements"},{"value":"transfer","label":"Personnel transfer arrangements"},{"value":"nav","label":"Navigation and communications"},{"value":"machinery","label":"Machinery, engine room and steering"},{"value":"hull","label":"Hull, deck and mooring"},{"value":"pollution","label":"Pollution prevention and security"},{"value":"route","label":"Intended route and local operations"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'15.1',false,NULL,'The scope record for this attendance.',false),
  ('c41d0000-0000-4000-8000-000000000f01','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001e',
   'Areas not inspected, and why','textarea',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'15.2',false,NULL,'Spaces not entered, systems not run, documents not produced.',true),
  ('c41d0000-0000-4000-8000-000000000f02','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001e',
   'Were any deficiencies or observations recorded during this inspection?','yes_no',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'15.3',false,NULL,'Answering Yes opens the Findings section below.',false),
  ('c41d0000-0000-4000-8000-000000000f03','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001e',
   'Limitations on the inspection','textarea',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'15.4',false,NULL,'Weather, cargo operations in progress, time on board, anything that constrained the attendance.',true),

-- ===== 16. Findings (repeatable) ============================================
-- No field-level conditional logic here: inside a repeatable section a condition
-- evaluates against entry 0 for EVERY entry. Nothing is required either — the section
-- gate at 15.3 does that job.
-- The first 'text' field becomes the entry's name in the report and the editor.
  ('c41d0000-0000-4000-8000-000000001000','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001f',
   'Area / location','text',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,'Where on board, e.g. "Boat deck, starboard side".',false),
  ('c41d0000-0000-4000-8000-000000001001','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001f',
   'Item number referenced','text',1,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,'The checklist item this relates to, e.g. 6.6.',false),
  ('c41d0000-0000-4000-8000-000000001002','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001f',
   'Category','dropdown',2,false,
   '[{"value":"deficiency","label":"Deficiency"},{"value":"observation","label":"Observation"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'',false,NULL,'Deficiency: an item missing, expired or not working. Observation: a condition noted.',false),
  ('c41d0000-0000-4000-8000-000000001003','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001f',
   'What was observed','textarea',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,'State what was seen. Do not record a recommendation.',true),
  ('c41d0000-0000-4000-8000-000000001004','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001f',
   'Photographs','photo',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'',false,NULL,'These print under this finding in the report.',false),

-- ===== 17. Surveyor Sign-off ================================================
-- 'Signed on' rather than 'Date' so it cannot beat 1.1 to the header row.
-- 'Ship''s representative' rather than 'Vessel representative' — a text label
-- containing the bare word "vessel" is swallowed into the header block.
  ('c41d0000-0000-4000-8000-000000001100','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000020',
   'Report prepared by','text',0,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'17.1',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001101','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000020',
   'Signature','signature',1,true,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'17.2',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001102','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000020',
   'Signed on','date',2,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'17.3',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001103','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000020',
   'Ship''s representative present at sign-off','text',3,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'17.4',false,NULL,'Name and rank.',false),
  ('c41d0000-0000-4000-8000-000000001104','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000020',
   'Ship''s representative signature','signature',4,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'17.5',false,NULL,NULL,false)

ON CONFLICT (id) DO NOTHING;

