-- ============================================================================
-- Migration 172: Pre-Hire Inspection — planned maintenance, drills, overall
--                condition, and plain wording about the people carried
--
-- Four changes.
--
-- (a) Planned maintenance was TWO questions in migration 170 (11.12 PMS, 11.13 spares).
--     Running hours were captured but never compared to overhaul intervals, and nothing
--     asked about class survey status, oil analysis, defect reporting or breakdowns.
--
-- (b) Drills were ONE question (4.10, "records up to date?"). Nothing recorded when the
--     last drill was, and — the gap that matters when 20 people are aboard — nothing
--     asked whether the passengers take part in musters and drills at all.
--
-- (c) General condition had no overall record, and nothing on void/tank spaces or the
--     cargo deck, which on a PSV is a real omission.
--
-- (d) WORDING. Migration 170 said "industrial personnel" throughout. Out; the report now
--     says "passengers" in plain English. The legal category still matters in exactly
--     one place — the certificate — because more than 12 PASSENGERS makes a ship a
--     passenger ship under SOLAS, and an OSV is normally endorsed under the SPS Code or
--     the IP Code instead. So 3.4 becomes a dropdown recording which endorsement the
--     certificate actually carries, and every other question just says "passengers".
--
-- Also fixes a real defect in 170: the spare-capacity calculation at 8.2 subtracted from
-- the TOTAL persons permitted including crew, overstating the margin by the size of the
-- crew — on a 20-passenger charter that is the whole question. It now measures against
-- the non-crew allowance.
--
-- +16 fields (176 → 192). Each new block is appended to its section and that section's
-- Photographs field moves to the end, so the numbering stays in reading order. Gaps in
-- order_index are harmless — it only sorts.
--
-- 12.12 uses a Good/Fair/Poor/Not-inspected answer set on a 'yes_no_na' field. That is
-- deliberate: the option LIST is template-driven as of lib/checklist/answerOptions.ts,
-- and this buys the coloured badge and the inline remarks box, which a 'dropdown' does
-- not get. Keep option VALUES short — the PDF badge is a fixed-width cell and falls back
-- to the value when the label runs past four characters ("Not inspected" prints as NI).
--
-- Still no verdict anywhere: 12.12 records the condition observed, which is a fact. It
-- says nothing about suitability for any service.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; UPDATEs keyed on 170's ids.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Move each affected section's Photographs field to the end
-- ------------------------------------------------------------
UPDATE public.template_fields SET order_index = 13, item_number = '5.13'
  WHERE id = 'c41d0000-0000-4000-8000-000000000507';   -- Safety management photos
UPDATE public.template_fields SET order_index = 22, item_number = '11.22'
  WHERE id = 'c41d0000-0000-4000-8000-000000000b0e';   -- Machinery photos
UPDATE public.template_fields SET order_index = 16, item_number = '12.16'
  WHERE id = 'c41d0000-0000-4000-8000-000000000c0b';   -- Hull / deck photos

-- ------------------------------------------------------------
-- 2. New fields
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES

-- ===== Drills → section 5 (Safety Management & Emergency Preparedness) ======
-- Labelled "Date of last …": safe from the report's header regex, because section 1's
-- field labelled exactly 'Date' comes first in flat order and wins the match.
  ('c41d0000-0000-4000-8000-000000001200','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Date of last abandon-ship drill','date',8,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.8',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001201','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Date of last fire drill','date',9,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.9',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001202','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Date of last man-overboard drill','date',10,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.10',false,NULL,NULL,false),
  ('c41d0000-0000-4000-8000-000000001203','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Are drills held at the required frequency?','yes_no_na',11,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'5.11',true,NULL,'Note the interval required by the vessel''s safety management system in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000001204','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-000000000014',
   'Do the passengers take part in musters and drills?','yes_no_na',12,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'5.12',true,NULL,
   'The people being carried are the least familiar with the vessel. Record what they are actually included in — muster only, or full drills.',false),

-- ===== Planned maintenance → section 11 (Machinery, Engine Room & Steering) =
  ('c41d0000-0000-4000-8000-000000001210','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Planned maintenance system in use — name or type','text',15,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.15',false,NULL,
   'Software or paper system, e.g. AMOS, Mesh, or the manager''s own spreadsheets.',false),
  ('c41d0000-0000-4000-8000-000000001211','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Number of overdue critical maintenance jobs','number',16,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.16',false,NULL,
   'As shown by the system itself. Enter 0 if none are overdue.',false),
  ('c41d0000-0000-4000-8000-000000001212','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are the class surveys up to date?','yes_no_na',17,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'11.17',true,NULL,
   'Annual, intermediate and renewal. Record the dates and any postponement in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000001213','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are running hours recorded against the makers'' recommended overhaul intervals?','yes_no_na',18,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.18',true,
   NULL,'The hours themselves are at 11.2 — this asks whether anything compares them to an interval.',false),
  ('c41d0000-0000-4000-8000-000000001214','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Are lube oil and fuel analysis records held and current?','yes_no_na',19,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.19',true,NULL,
   'Note the date of the most recent sample in the remarks.',false),
  ('c41d0000-0000-4000-8000-000000001215','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Is a defect reporting and rectification system in use?','yes_no_na',20,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'11.20',true,NULL,
   'How a defect found by the crew is raised, tracked and closed out.',false),
  ('c41d0000-0000-4000-8000-000000001216','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001a',
   'Were there any breakdowns or periods of downtime in the last 12 months?','yes_no_na',21,false,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'11.21',true,NULL,
   'No is the expected answer, so the colours are reversed. Record what failed and for how long.',false),

-- ===== General condition → section 12 (Hull, Deck & Mooring) ================
  ('c41d0000-0000-4000-8000-000000001220','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Overall condition as observed','yes_no_na',12,false,
   '[{"value":"good","label":"Good","color":"green"},{"value":"fair","label":"Fair","color":"amber"},{"value":"poor","label":"Poor","color":"red"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'12.12',true,NULL,
   'A record of the condition seen on the day, across hull, deck, machinery spaces and accommodation. It is an observation, not an opinion on suitability for any service.',false),
  ('c41d0000-0000-4000-8000-000000001221','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are void and tank spaces in satisfactory condition?','yes_no_na',13,false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"Not inspected","color":"gray"}]'::jsonb,
   '{}'::jsonb,NULL,NULL,'12.13',true,NULL,
   'Answer Not inspected where a space could not be entered — that is a different statement from N/A.',false),
  ('c41d0000-0000-4000-8000-000000001222','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Are the cargo deck area and securing arrangements in good order?','yes_no_na',14,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.14',true,NULL,
   'Deck plating, cargo rails, lashing points and any deck cargo securing equipment.',false),
  ('c41d0000-0000-4000-8000-000000001223','c41d0000-0000-4000-8000-000000000001','c41d0000-0000-4000-8000-00000000001b',
   'Is a general arrangement plan on board?','yes_no_na',15,false,'[]'::jsonb,'{}'::jsonb,NULL,NULL,'12.15',true,NULL,NULL,false)

ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 3. How many people may be carried — said plainly
--
-- More than 12 PASSENGERS makes a ship a passenger ship under SOLAS, needing a Passenger
-- Ship Safety Certificate, which an OSV will rarely hold; offshore crews are normally
-- carried under the SPS Code or the IP Code instead. Which endorsement the certificate
-- carries decides whether ~20 people may be carried at all — so 3.4 records it, as a
-- dropdown (a scalar answer, so it can drive follow-ups later; a multiple_choice never
-- can, because its answers live in value_array). Every other question just says
-- "passengers".
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET label = 'Maximum number of persons permitted on board, including crew',
       help_text = 'The total figure on the certificate — crew and everyone else.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000304';

UPDATE public.template_fields
   SET label = 'Under what endorsement may people other than crew be carried?',
       field_type = 'dropdown',
       options = '[{"value":"passengers","label":"Passengers (Passenger Ship Safety Certificate)"},{"value":"special","label":"SPS Code (special personnel)"},{"value":"ip_code","label":"IP Code, SOLAS ch. XV (offshore workers)"},{"value":"national","label":"Flag-state workboat / small commercial craft code"},{"value":"none","label":"Nothing stated on the certificate"}]'::jsonb,
       with_remarks = false,
       help_text = 'More than 12 passengers makes a ship a passenger ship under SOLAS. An offshore vessel is normally endorsed under one of the other codes instead — record which, and quote the certificate''s own wording at 3.7.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000305';

UPDATE public.template_fields
   SET label = 'Maximum number of passengers permitted, in addition to crew',
       help_text = 'The figure the charter depends on. Quote the certificate''s exact wording in the remarks at 3.7.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000306';

UPDATE public.template_fields
   SET label = 'Number of passengers to be carried on the proposed service'
 WHERE id = 'c41d0000-0000-4000-8000-000000000800';

-- The margin must measure against the passenger allowance (3.5), not the total including
-- crew (3.3). As first written it overstated the spare capacity by the size of the crew.
UPDATE public.template_fields
   SET calculation_formula = '{c41d0000-0000-4000-8000-000000000306}-{c41d0000-0000-4000-8000-000000000800}',
       help_text = 'Passengers permitted (3.5) less the number to be carried (8.1). A negative figure means the proposed complement exceeds the certificate.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000801';

-- ------------------------------------------------------------
-- 4. Plain wording everywhere else
-- ------------------------------------------------------------
-- The template's own description is shown in the New Job picker.
UPDATE public.checklist_templates
   SET description = 'Condition, certification and equipment inspection of a fast crew-supply or platform supply vessel engaged in carrying passengers daily between an offshore location and a river berth. Derived from the IMCA Common Marine Inspection Document (CMID) at the sub-500GT level. Records observed facts only — no recommendations and no assessment of suitability.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000001';

UPDATE public.template_sections
   SET title = 'Passenger Arrangements',
       description = 'Seating, escape, briefing and welfare for the passengers to be carried.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000017';

UPDATE public.template_sections
   SET title = 'Passenger Transfer Arrangements'
 WHERE id = 'c41d0000-0000-4000-8000-000000000018';

UPDATE public.template_fields
   SET label = 'Is the muster list posted and current, and does it include the passengers?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000501';

UPDATE public.template_fields
   SET label = 'Working language used with the passengers'
 WHERE id = 'c41d0000-0000-4000-8000-00000000040b';

UPDATE public.template_fields
   SET label = 'Are lifejackets stowed in, or immediately adjacent to, the passenger seating space?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000605';

UPDATE public.template_fields
   SET label = 'Is the general alarm audible throughout, including in the passenger seating space?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000708';

UPDATE public.template_fields
   SET label = 'Is dedicated seating provided for every passenger?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000802';

UPDATE public.template_fields
   SET label = 'Is fire detection fitted in the passenger space?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000809';

UPDATE public.template_fields
   SET label = 'Number of toilets accessible from the passenger space'
 WHERE id = 'c41d0000-0000-4000-8000-00000000080a';

UPDATE public.template_fields
   SET label = 'Is a manifest of everyone on board prepared for each trip and sent ashore before departure?'
 WHERE id = 'c41d0000-0000-4000-8000-00000000080d';

UPDATE public.template_fields
   SET label = 'Is the stretcher route from the passenger space to the deck clear?'
 WHERE id = 'c41d0000-0000-4000-8000-00000000080f';

UPDATE public.template_fields
   SET label = 'Photographs — passenger arrangements',
       help_text = 'Seating, escape routes, briefing placard and lifejacket stowage.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000810';

UPDATE public.template_fields
   SET label = 'Primary means of passenger transfer offshore'
 WHERE id = 'c41d0000-0000-4000-8000-000000000900';

UPDATE public.template_fields
   SET label = 'Are there access control arrangements for passengers embarking and disembarking daily?',
       help_text = 'Twenty people a day, twice a day, is a different problem from an occasional visitor.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000d05';

-- ------------------------------------------------------------
-- 5. Widen the scope tick-list to name the areas now asked about separately
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET options = '[{"value":"certification","label":"Certification and documentation"},{"value":"crew","label":"Crew, manning and certification"},{"value":"sms","label":"Safety management and emergency preparedness"},{"value":"drills","label":"Drills and muster arrangements"},{"value":"lsa","label":"Life-saving appliances"},{"value":"ffa","label":"Fire fighting appliances"},{"value":"personnel","label":"Passenger arrangements"},{"value":"transfer","label":"Passenger transfer arrangements"},{"value":"nav","label":"Navigation and communications"},{"value":"machinery","label":"Machinery, engine room and steering"},{"value":"pms","label":"Planned maintenance records"},{"value":"hull","label":"Hull, deck and mooring"},{"value":"tanks","label":"Void and tank spaces"},{"value":"pollution","label":"Pollution prevention and security"},{"value":"route","label":"Intended route and local operations"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000f00';
