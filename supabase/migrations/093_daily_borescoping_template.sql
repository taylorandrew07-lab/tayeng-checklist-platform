-- ============================================================
-- Migration 093: "Taylor Engineering (TT) – Daily Borescoping Report" template
-- Run via the db-migrate runner. Idempotent. Depends on:
--   088 (pdf_include_photos), 090 (client_select enum), 092 (pdf_disclaimer).
--
-- Modelled on our SafetyCulture/iAuditor borescoping template, fixing iAuditor's
-- biggest weakness (unlabeled report photos): pdf_include_photos is ON so photos
-- print captioned and grouped, and each line carries its own Photo + Video Link.
--
-- Seeded as DRAFT on purpose: Section 2 ("Cargo Line Inspection Entry") is meant to
-- be REPEATED once per borescope inspection, and repeatable sections are not built
-- yet (the platform stores one value per field per job — job_field_values has
-- UNIQUE(job_id, field_id)). Keep this template in draft until the repeatable-section
-- engine lands; then flag Section 2 repeatable. All fields/options are final.
--
-- Fixed ids (prefix b0235c09-…) so the structure is stable across edits.
-- ============================================================

INSERT INTO public.checklist_templates
  (id, name, description, status, allow_surveyor_start, pdf_include_photos, pdf_disclaimer, created_by)
SELECT 'b0235c09-0000-4000-8000-000000000001',
       'Taylor Engineering (TT) – Daily Borescoping Report',
       'Daily borescoping inspection report. One Cargo Line Inspection Entry per borescope inspection (each with its own condition, photos and Synology video link). Photos are embedded in the PDF and labelled so a reader can always tell which line they belong to.',
       'draft'::template_status, true, true,
       'This report remains the property of Taylor Engineering Agencies Limited ("Taylor Engineering") and the commissioning client. It reflects conditions observed at the time of inspection and is issued in good faith for their exclusive use. The information herein shall not be reproduced, disclosed, or relied upon by any third party without written consent. This report is submitted without prejudice to the rights and interests of whom it may concern.',
       COALESCE((SELECT id FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
                (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.template_sections (id, template_id, title, description, order_index) VALUES
  ('b0235c09-0000-4000-8000-000000000002','b0235c09-0000-4000-8000-000000000001','Title / Job Details','Completed once at the top of the report.',0),
  ('b0235c09-0000-4000-8000-000000000010','b0235c09-0000-4000-8000-000000000001','Cargo Line Inspection Entry','One block per borescope inspection. (Becomes a repeatable section once that feature ships — duplicate this block per cargo line.)',1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required, options, help_text) VALUES
  -- Section 1 — Title / Job Details
  ('b0235c09-0000-4000-8000-000000000003','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Conducted On','date',0,true,null,null),
  ('b0235c09-0000-4000-8000-000000000004','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Time','time',1,false,null,null),
  ('b0235c09-0000-4000-8000-000000000005','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Vessel Name','text',2,true,null,null),
  ('b0235c09-0000-4000-8000-000000000006','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Port of Registry','text',3,true,null,null),
  ('b0235c09-0000-4000-8000-000000000007','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Gross Tonnes','number',4,true,null,null),
  ('b0235c09-0000-4000-8000-000000000008','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Port / Location','text',5,true,null,null),
  ('b0235c09-0000-4000-8000-000000000009','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Surveyor','text',6,true,null,null),
  ('b0235c09-0000-4000-8000-00000000000a','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Client','client_select',7,true,null,'Pick the commissioning client (or type a name).'),
  ('b0235c09-0000-4000-8000-00000000000b','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000002','Inspection Day Number','number',8,false,null,null),
  -- Section 2 — Cargo Line Inspection Entry (repeated per inspection once that ships)
  ('b0235c09-0000-4000-8000-000000000011','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Cargo Line Name / Description','text',0,true,null,null),
  ('b0235c09-0000-4000-8000-000000000012','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Cargo Line Condition','multiple_choice',1,false,
     '[{"value":"cargo_present","label":"Cargo Present"},{"value":"minor_cargo_present","label":"Minor Cargo Present"},{"value":"residue_present","label":"Residue Present"},{"value":"minor_residue_present","label":"Minor Residue Present"},{"value":"water_present","label":"Water Present"},{"value":"minor_water_present","label":"Minor Water Present"},{"value":"traces_of_water_present","label":"Traces of Water Present"},{"value":"rust_present","label":"Rust Present"},{"value":"minor_rust_present","label":"Minor Rust Present"},{"value":"not_accessible","label":"Not Accessible"},{"value":"clean","label":"Clean"},{"value":"dry","label":"Dry"}]'::jsonb,
     'Select all conditions that apply for this line.'),
  ('b0235c09-0000-4000-8000-000000000013','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Type of Inspection','dropdown',2,true,
     '[{"value":"initial","label":"Initial"},{"value":"interim","label":"Interim"},{"value":"final","label":"Final"}]'::jsonb,null),
  ('b0235c09-0000-4000-8000-000000000014','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Inspection Location','text',3,false,null,null),
  ('b0235c09-0000-4000-8000-000000000015','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Distance','number',4,false,null,null),
  ('b0235c09-0000-4000-8000-000000000016','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Next Steps / Recommendations','text',5,false,null,null),
  ('b0235c09-0000-4000-8000-000000000017','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Comments','textarea',6,false,null,null),
  ('b0235c09-0000-4000-8000-000000000018','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Photos','photo',7,false,null,'Attach this line''s borescope photos — they print under this line in the report.'),
  ('b0235c09-0000-4000-8000-000000000019','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Video Link','video_link',8,false,null,'Paste this line''s Synology video link.'),
  ('b0235c09-0000-4000-8000-00000000001a','b0235c09-0000-4000-8000-000000000001','b0235c09-0000-4000-8000-000000000010','Previous Cargo if known','text',9,false,null,null)
ON CONFLICT (id) DO NOTHING;
