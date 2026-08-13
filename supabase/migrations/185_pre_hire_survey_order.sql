-- ============================================================================
-- Migration 185: Pre-Hire Inspection — regrouped into the order the survey is done
--
-- Built from a four-lens review of all 171 questions (structure, duplication, question
-- quality, missing coverage), a synthesis, and an adversarial critique that
-- independently re-enumerated every id. The critique's corrections are applied here;
-- where it disagreed with the synthesis, the critique won.
--
-- THE ORDER now follows the survey rather than the filing cabinet: paperwork in the
-- ship's office (certificates, management systems, emergency documents, crew papers),
-- then the walk from the bridge downward — bridge, passenger spaces, transfer, LSA,
-- FFA, deck, engine room — then findings and sign-off. Safety management comes before
-- crew, as instructed.
--
-- ALL DRILLS ARE IN ONE PLACE. Section 5 items 5.13–5.18 hold every drill question in
-- the template. The duplicate in crew (old 4.7) is deleted; the security drill moves
-- across from the old pollution/security section.
--
-- THE POLLUTION & SECURITY SECTION IS DISSOLVED, five ways: environmental plans and
-- record books to the certificates (as instructed), the hardware to the engine room
-- where you stand when you look at it, the security plan to safety management, the
-- security drill to drills, restricted areas to deck, access control to transfer.
--
-- EIGHT MERGES, each following the rule that a yes/no with a remarks box does not need
-- a second field for its detail: drill records, PMS type, fixed-system type, passenger
-- fire detection, transfer-area handholds, seat count, maximum wave height, plotter
-- updates.
--
-- Corrections applied from the critique:
--   * Machinery alarms keep "and shutdowns" — automatic protective trips are not the
--     manual emergency stops, and narrowing the label would have left engine trips
--     asked nowhere.
--   * The security drill stays a coloured question rather than becoming a date: the
--     Summary of Findings is colour-driven, and a date can never reach it.
--   * with_remarks switched ON for the three fields converted into the answer family,
--     whose help now tells the surveyor to write in that box.
--   * Publications currency kept in the charts question.
--   * Escape routes kept in the emergency-signage question.
--   * Two proposed new questions dropped as compound-splits — the opposite of the
--     merge rule — and the P&I cover question dropped as unanswerable from a
--     certificate of entry.
--   * Pyrotechnics kept: deleting them was justified by an argument that would equally
--     condemn the liferaft and EPIRB questions, which are kept.
--
-- Also applied, from the owner directly: manning recorded BY RANK rather than as head
-- counts; the language question becomes crew nationalities and the working language,
-- stated as fact; the risk-assessment help notes that a JSA may be what the system
-- calls for.
--
-- SAFETY: every DELETE is guarded against the field holding an answer or a photo, and
-- no job_field_values row is ever cleared. Nothing here can destroy survey data.
--
-- NOTE for later: the report renders from the LIVE template at download time, so a
-- restructure rewrites the item numbers of reports already issued. Harmless today (no
-- Pre-Hire job has been submitted); worth a snapshot mechanism before that changes.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. New section: Emergency Preparedness & Drills
-- ------------------------------------------------------------
INSERT INTO public.template_sections (id, template_id, title, description, order_index, is_repeatable, conditional_logic)
VALUES ('c41d0000-0000-4000-8000-000000000021', 'c41d0000-0000-4000-8000-000000000001', 'Emergency Preparedness & Drills', 'Everything for when it goes wrong: muster and alarms, response plans, every drill held on board, passenger evacuation, man overboard and medical.', 4, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Section titles, descriptions and order
-- ------------------------------------------------------------
UPDATE public.template_sections SET title = 'Survey Details', description = 'Completed first. The date and port come from the job record and are not asked again here.', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000000010';
UPDATE public.template_sections SET title = 'Vessel Particulars', description = 'The identity of the ship, transcribed once from her own particulars sheet.', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000011';
UPDATE public.template_sections SET title = 'Certification, Class & Ship’s Documentation', description = 'Everything issued to or held by the vessel: statutory, class and flag certificates, class and inspection history, the environmental plans and record books, the stability book and general arrangement.', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000012';
UPDATE public.template_sections SET title = 'Safety Management', description = 'The management systems the company operates: safety management, risk assessment, maintenance, defect close-out, security, audit standing and incident history.', order_index = 3
 WHERE id = 'c41d0000-0000-4000-8000-000000000014';
UPDATE public.template_sections SET title = 'Emergency Preparedness & Drills', description = 'Everything for when it goes wrong: muster and alarms, response plans, every drill held on board, passenger evacuation, man overboard and medical.', order_index = 4
 WHERE id = 'c41d0000-0000-4000-8000-000000000021';
UPDATE public.template_sections SET title = 'Crew, Manning & Certification', description = 'Manning against the safe manning document, and the competency, rest and policies of the crew on board.', order_index = 5
 WHERE id = 'c41d0000-0000-4000-8000-000000000013';
UPDATE public.template_sections SET title = 'Bridge, Navigation & Communications', description = 'Bridge equipment, charts and their upkeep, passage planning and GMDSS.', order_index = 6
 WHERE id = 'c41d0000-0000-4000-8000-000000000019';
UPDATE public.template_sections SET title = 'Accommodation & Passenger Spaces', description = 'The spaces the passengers occupy and the crew live in, and the numbers the carriage depends on.', order_index = 7
 WHERE id = 'c41d0000-0000-4000-8000-000000000017';
UPDATE public.template_sections SET title = 'Passenger Transfer & Access', description = 'How people get on and off — offshore by the vessel’s transfer method, and alongside over her own means of access.', order_index = 8
 WHERE id = 'c41d0000-0000-4000-8000-000000000018';
UPDATE public.template_sections SET title = 'Life-Saving Appliances', description = 'Inventory, servicing and stowage against the maximum persons carried.', order_index = 9
 WHERE id = 'c41d0000-0000-4000-8000-000000000015';
UPDATE public.template_sections SET title = 'Fire-Fighting Appliances & Detection', description = 'Detection and alarms, portable and fixed appliances, fire main, and emergency shut-offs.', order_index = 10
 WHERE id = 'c41d0000-0000-4000-8000-000000000016';
UPDATE public.template_sections SET title = 'Deck, Hull & Mooring', description = 'Structural condition, closing appliances, deck fittings, mooring and anchoring.', order_index = 11
 WHERE id = 'c41d0000-0000-4000-8000-00000000001b';
UPDATE public.template_sections SET title = 'Machinery, Engine Room & Steering', description = 'Propulsion, steering, power generation, bilge, maintenance state, and the pollution-prevention plant that lives below decks.', order_index = 12
 WHERE id = 'c41d0000-0000-4000-8000-00000000001a';
UPDATE public.template_sections SET title = 'Findings — Observations & Deficiencies', description = 'Anything worth recording that is not already a question above. Photographs of a specific defect belong on that question, not here.', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-00000000001f';
UPDATE public.template_sections SET title = 'Closing & Sign-off', description = 'The whole-vessel observation and the signatures.', order_index = 14
 WHERE id = 'c41d0000-0000-4000-8000-000000000020';

-- ------------------------------------------------------------
-- 3. Every field: section, item number, order, and any change of
--    label / type / options / help / remarks / unit / conditional
-- ------------------------------------------------------------
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000010', item_number = '1.1', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000000102';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000010', item_number = '1.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000103';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000010', item_number = '1.3', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000104';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.1', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000000200';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000201';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.3', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000202';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.4', order_index = 3
 WHERE id = 'c41d0000-0000-4000-8000-000000000203';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.5', order_index = 4
 WHERE id = 'c41d0000-0000-4000-8000-000000000204';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.6', order_index = 5
 WHERE id = 'c41d0000-0000-4000-8000-000000000205';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.7', order_index = 6, label = 'Summer draught'
 WHERE id = 'c41d0000-0000-4000-8000-000000000208';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.8', order_index = 7, unit = 'GT'
 WHERE id = 'c41d0000-0000-4000-8000-00000000020a';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.9', order_index = 8, field_type = 'textarea'
 WHERE id = 'c41d0000-0000-4000-8000-00000000020b';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.10', order_index = 9, label = 'Registered owner, and manager if different', help_text = 'Name both, and state which is which — on a pre-hire the manager is usually the party being inspected.'
 WHERE id = 'c41d0000-0000-4000-8000-00000000020c';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000011', item_number = '2.11', order_index = 10
 WHERE id = 'c41d0000-0000-4000-8000-000000001b01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.1', order_index = 0, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000300';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000301';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.1A', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000302';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.3', order_index = 3
 WHERE id = 'c41d0000-0000-4000-8000-000000000304';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.4', order_index = 4, help_text = 'More than 12 passengers makes a ship a passenger ship under SOLAS. An offshore vessel is normally endorsed under one of the other codes instead — record which, and quote the certificate’s own wording at 3.6.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000305';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.5', order_index = 5, help_text = 'The figure the charter depends on. Quote the certificate’s exact wording in the remarks at 3.6.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000306';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.6', order_index = 6
 WHERE id = 'c41d0000-0000-4000-8000-000000000307';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.7', order_index = 7, options = '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000308';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.7A', order_index = 8
 WHERE id = 'c41d0000-0000-4000-8000-000000000309';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.8', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001212';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.9', order_index = 10
 WHERE id = 'c41d0000-0000-4000-8000-00000000030a';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.10', order_index = 11
 WHERE id = 'c41d0000-0000-4000-8000-000000001b03';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.11', order_index = 12, options = '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000030b';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.12', order_index = 13, options = '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000030c';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.13', order_index = 14, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001a01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.14', order_index = 15
 WHERE id = 'c41d0000-0000-4000-8000-000000001a02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.15', order_index = 16, field_type = 'yes_no_na', label = 'Is an approved stability book on board, including a loading condition covering the personnel-carrying case?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c08';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000012', item_number = '3.16', order_index = 17, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001223';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000014', item_number = '4.1', order_index = 0, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000500';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000014', item_number = '4.2', order_index = 1, help_text = 'Take note of what the vessel’s own safety management system requires — some use a job safety analysis (JSA) rather than a risk assessment, and either is right if it is the one the system calls for. Record which is used, and whether the records are being completed.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000503';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000014', item_number = '4.5', order_index = 4, help_text = 'Name the system in the remarks — software or paper, e.g. AMOS, Mesh, or the manager’s own spreadsheets. One system covering the whole vessel. Whether any critical jobs are overdue is asked at 13.11, in the engine room where you can see them.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001a00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000014', item_number = '4.6', order_index = 5, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001215';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000014', item_number = '4.7', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d04';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.1', order_index = 0, field_type = 'yes_no_na', help_text = 'Both halves matter — a muster list that omits twenty passengers is the finding. Record in the remarks the passengers’ muster station and the crew member named to marshal them.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000501';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.2', order_index = 1, field_type = 'yes_no_na', label = 'Are emergency stations, escape routes, safety signage and the posted safety instructions in place and legible?', help_text = 'Muster stations and their signage, escape routes and their marking, plus the posted instructions and placards at the stations they refer to — lifejacket donning, liferaft launching, extinguisher use — not filed in the ship’s office. The manuals behind them are at 10.10.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000502';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.3', order_index = 2, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000504';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.5', order_index = 4, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001700';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.6', order_index = 5, help_text = 'By name or by rank on the muster list, not “whoever is free”. Record who it is. Whether the list is posted and current is at 5.1.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001701';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.7', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001400';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.8', order_index = 7, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001401';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.9', order_index = 8, label = 'Is the medical locker complete and within its expiry dates?', help_text = 'Medical kit · stretcher · oxygen · defibrillator · ship captain’s medical guide. Record in the remarks which of these are carried and any expiry found — a vessel may lawfully carry no defibrillator, and that is a fact, not a deficiency.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000505';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.10', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000506';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.11', order_index = 10, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000080f';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.12', order_index = 11, field_type = 'yes_no_na', label = 'Was the general alarm sounded and heard in the passenger seating space?', help_text = 'Have it sounded while you stand in the passenger space. “Audible throughout” is not something you can verify; whether you heard it where the passengers sit is.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000708';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.13', order_index = 12
 WHERE id = 'c41d0000-0000-4000-8000-000000001200';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.14', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-000000001201';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.15', order_index = 14
 WHERE id = 'c41d0000-0000-4000-8000-000000001202';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.16', order_index = 15, label = 'Are security drills held and recorded?', help_text = 'Kept as a coloured question rather than a date: a date never reaches the Summary of Findings, and a vessel that has never held a security drill must appear there. Note the date of the last one in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d07';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.17', order_index = 16, help_text = 'Abandon ship, fire, man overboard and security. Note the interval the vessel’s safety management system requires, and record any drill type not held at all, in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001203';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000021', item_number = '5.18', order_index = 17, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001204';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.1', order_index = 0, help_text = 'As shown on the certificate of competency sighted at 6.5.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001b00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.2', order_index = 1, field_type = 'textarea', label = 'Minimum manning required by the Safe Manning Document — by rank', help_text = 'The ranks the document requires, with their STCW regulation, exactly as written: e.g. “1 Master II/2, 1 Chief Officer II/2, 2 Officers II/1, 1 Chief Engineer III/2”. It is the ranks that matter, not the head count.', unit = NULL
 WHERE id = 'c41d0000-0000-4000-8000-000000000400';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.3', order_index = 2, field_type = 'textarea', label = 'Actual manning on board — by rank', help_text = 'The ranks actually carried on the day: e.g. “1 Master, 1 Chief Officer, 3 Officers, 1 Chief Engineer”. Where the vessel carries more than the minimum, this is what shows it.', unit = NULL
 WHERE id = 'c41d0000-0000-4000-8000-000000000401';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.5', order_index = 4, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000402';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.6', order_index = 5, help_text = 'Check the last month of records against the watch pattern actually worked. Answer No if the records are not kept, or if they show breaches — say which in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000405';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.7', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000409';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.8', order_index = 7, field_type = 'textarea', label = 'Crew nationalities and the vessel’s working language', help_text = 'State both as facts: the nationalities carried, and the language the crew work in. It is for the client to decide what that means for the passengers they intend to carry — record it, draw no conclusion.'
 WHERE id = 'c41d0000-0000-4000-8000-00000000040b';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000013', item_number = '6.9', order_index = 8
 WHERE id = 'c41d0000-0000-4000-8000-000000001b02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.1', order_index = 0, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000a01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.1A', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000a02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.3', order_index = 3, field_type = 'yes_no_na', label = 'Are the charts and publications for the vessel’s trading area held on board, with the publications current for the year?', help_text = 'Carriage and publication currency — ALRS, tide tables, the almanac, the Mariner’s Handbook. How chart corrections arrive is asked per system below, because it differs completely between ECDIS, a plotter and paper.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a03';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.4', order_index = 4
 WHERE id = 'c41d0000-0000-4000-8000-000000001300';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.5', order_index = 5, label = 'How are the chart updates received and applied?', help_text = 'Who supplies them, how often they arrive, by what means, and who loads them. Card, download or subscription. Record the chart source and version if shown.', conditional_logic = jsonb_build_object('operator','or','conditions',jsonb_build_array(
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter_paper')))
 WHERE id = 'c41d0000-0000-4000-8000-000000001301';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.6', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, conditional_logic = jsonb_build_object('operator','or','conditions',jsonb_build_array(
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper')))
 WHERE id = 'c41d0000-0000-4000-8000-000000001302';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.7', order_index = 7, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, conditional_logic = jsonb_build_object('operator','or','conditions',jsonb_build_array(
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','paper'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','ecdis_paper'),
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000001300','operator','equals','value','plotter_paper')))
 WHERE id = 'c41d0000-0000-4000-8000-000000001304';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.8', order_index = 8, label = 'Date of the last chart correction or update applied', help_text = 'Whatever the system: the Notice number for paper, the update edition for ECDIS, the card or download date for a plotter. Record “no record held” if there is none.', conditional_logic = NULL
 WHERE id = 'c41d0000-0000-4000-8000-000000001305';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.9', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a04';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.10', order_index = 10, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a05';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.11', order_index = 11, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a06';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.12', order_index = 12, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a07';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000019', item_number = '7.13', order_index = 13
 WHERE id = 'c41d0000-0000-4000-8000-000000000a08';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.1', order_index = 0, label = 'Number of passengers to be carried on the intended service', unit = 'persons'
 WHERE id = 'c41d0000-0000-4000-8000-000000000800';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.2', order_index = 1, field_type = 'yes_no_na', label = 'Is the number of passengers to be carried within the certified maximum?', help_text = 'Passengers permitted (3.5) against the number to be carried (8.1). State the margin in the remarks; a negative margin — more to be carried than the certificate permits — is the finding.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, with_remarks = true, unit = NULL, calculation_formula = NULL
 WHERE id = 'c41d0000-0000-4000-8000-000000000801';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.3', order_index = 2, field_type = 'yes_no_na', help_text = 'State the number of fixed seats fitted in the remarks, and compare it against 8.1.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000802';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.4', order_index = 3, help_text = 'Depends on the code the vessel is built to, so No is amber rather than red: it is a design fact, recorded, not a deficiency.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"amber"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000804';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.5', order_index = 4, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000805';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.6', order_index = 5, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000806';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.7', order_index = 6, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000807';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.8', order_index = 7, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000808';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.9', order_index = 8, unit = 'toilets'
 WHERE id = 'c41d0000-0000-4000-8000-00000000080a';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.10', order_index = 9, label = 'Is drinking water available in or adjacent to the passenger seating space?', help_text = 'Provisions carried, if any, into the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000080b';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.11', order_index = 10, label = 'Is passenger safety briefing material held on board — card, placard or video?', help_text = 'Ask to see it. Record in the remarks when the briefing is given and by whom.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000080c';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.12', order_index = 11, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000080d';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.13', order_index = 12, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000080e';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000017', item_number = '8.15', order_index = 14, label = 'Are the accommodation and galley clean and free of accumulated refuse?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c0a';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.1', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000000900';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.1A', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000901';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.2', order_index = 2, label = 'Is the transfer area clear, marked, non-slip and fitted with handholds and guardrails?', help_text = 'The deck area where people actually land or step across, whatever the method. Lighting is asked at 9.4.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, conditional_logic = NULL
 WHERE id = 'c41d0000-0000-4000-8000-000000000902';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.3', order_index = 3, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, conditional_logic = jsonb_build_object('operator','and','conditions',jsonb_build_array(
       jsonb_build_object('field_id','c41d0000-0000-4000-8000-000000000900','operator','equals','value','gangway')))
 WHERE id = 'c41d0000-0000-4000-8000-000000000903';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.4', order_index = 4, label = 'Is fixed lighting fitted over the transfer area, and was it seen working?', help_text = '“Adequate” is a judgement; fitted and working is a fact.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000905';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.5', order_index = 5, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001600';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.6', order_index = 6, help_text = 'Significant wave height, wind speed and any swell-period limit. Record the stated figures in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000906';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000018', item_number = '9.9', order_index = 9, label = 'Is access to the vessel controlled and recorded when passengers embark and disembark?', help_text = 'Twenty people a day, twice a day, is a different problem from an occasional visitor. Who keeps the watch, what is checked against the manifest, and where it is logged. The manifest itself is at 8.12.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d05';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.1', order_index = 0, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000600';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000601';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.1A', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000602';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.3', order_index = 3, help_text = 'Sum of all rafts. The comparison against the certified maximum is asked at 10.5.', unit = 'persons'
 WHERE id = 'c41d0000-0000-4000-8000-000000000603';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.4', order_index = 4, help_text = 'The comparison against the certified maximum is asked at 10.5.', unit = 'lifejackets'
 WHERE id = 'c41d0000-0000-4000-8000-000000000604';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.6', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000605';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.7', order_index = 7, field_type = 'yes_no_na', help_text = 'Record the service dates in the remarks, and check the painter is made fast and the weak link intact.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000606';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.8', order_index = 8, help_text = 'If no rescue or man-overboard boat is carried, answer N/A and record that in the remarks — the absence is a fact, not a deficiency on a vessel not required to carry one. Answer No only when one is fitted and was not operational.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000607';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.9', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000609';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.10', order_index = 10, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000060a';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000015', item_number = '10.11', order_index = 11, label = 'Are the LSA and FFA training manuals on board?', help_text = 'The manuals themselves. The instructions posted about the vessel are asked at 5.2.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001b04';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.1', order_index = 0, label = 'Are the portable fire-fighting appliances present, in position, serviced and in date?', help_text = 'Portable extinguishers · fire hoses, nozzles and hydrants · fireman’s outfits · EEBDs · international shore connection. The fire main, the emergency fire pump, detection, the fixed system, the remote shut-offs and the SCBA sets each have their own question below. Answer once for the set, then tick what you checked.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000700';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000000701';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.1A', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000000702';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.3', order_index = 3, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000703';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.4', order_index = 4, field_type = 'yes_no_na', label = 'Is fire detection fitted throughout, including the passenger seating space?', help_text = 'List the spaces covered in the remarks — machinery space, accommodation, galley, passenger seating space, store rooms, steering gear — and name anything conspicuously not covered.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, with_remarks = true
 WHERE id = 'c41d0000-0000-4000-8000-000000001500';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.5', order_index = 5, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001501';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.6', order_index = 6
 WHERE id = 'c41d0000-0000-4000-8000-000000001502';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.7', order_index = 7, label = 'Was the fire main run, with a jet produced at the furthest hydrant?', help_text = 'Record the pressure and how many hydrants were opened in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000704';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.8', order_index = 8, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001900';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.9', order_index = 9, label = 'Is the fixed machinery-space system within its service date, with the release station clear and marked?', help_text = 'Note the type — CO2, foam, water mist or clean agent — the number of cylinders or quantity held, and the spaces it covers, in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000705';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.10', order_index = 10
 WHERE id = 'c41d0000-0000-4000-8000-000000001504';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.11', order_index = 11, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001505';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.12', order_index = 12, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001506';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.13', order_index = 13, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000706';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000016', item_number = '11.14', order_index = 14, label = 'Are all SCBA cylinders at or above their marked charged pressure, with a compressor or spare cylinders carried?', help_text = 'Record the lowest cylinder reading in the remarks, and whether spares or a compressor are carried.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000707';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.1', order_index = 0, label = 'Is the external hull above the waterline free of visible damage, indents or wastage?', help_text = 'Above the waterline, from the quay and from the deck. Record the extent and location of anything found in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.2', order_index = 1, label = 'Is the coating intact, with no areas of breakdown or bare steel showing?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.3', order_index = 2, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.4', order_index = 3, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c03';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.5', order_index = 4, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c04';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.6', order_index = 5, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c05';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.7', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c06';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.8', order_index = 7, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c07';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.9', order_index = 8, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000c09';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.10', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000a0c';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.11', order_index = 10, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001222';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001b', item_number = '12.12', order_index = 11, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d06';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.1', order_index = 0, label = 'Are the main engines, gearboxes and propulsion operational, with no oil or water leaks observed?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.2', order_index = 1, label = 'Running hours shown on each main engine counter', help_text = 'Per engine, e.g. P 12,430 / S 12,105. Hours since last major overhaul, if known, belong in 13.1’s remarks.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000b01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.3', order_index = 2, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.4', order_index = 3, help_text = 'The automatic protective trips — low lube oil pressure, high jacket water temperature — and the bilge alarms. The MANUAL emergency stops and remote shut-offs are a different check, at 11.13.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b03';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.5', order_index = 4, label = 'Were the main and auxiliary steering gear operated and found working, with the changeover instructions posted?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b04';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.6', order_index = 5, label = 'Are all generators fitted operational?', help_text = 'Record how many are fitted and how many were running in the remarks.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b05';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.7', order_index = 6, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b06';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.8', order_index = 7, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b07';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.9', order_index = 8, label = 'Are the bow thruster and any other manoeuvring aids fitted operational?', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b08';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.10', order_index = 9, options = '[{"value":"yes","label":"Yes","color":"red"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0b';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.11', order_index = 10, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0c';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.12', order_index = 11, field_type = 'yes_no_na', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000b0d';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.13', order_index = 12, options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001214';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.14', order_index = 13, options = '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000001216';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.15', order_index = 14, help_text = 'Oily water separator and its 15ppm alarm · SOPEP locker contents · spill kit and containment · sewage treatment or holding tank · garbage segregation and receptacles · save-alls and scupper plugs. The plans and record books behind this equipment are asked at 3.13.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d00';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.16', order_index = 15
 WHERE id = 'c41d0000-0000-4000-8000-000000000d01';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.15A', order_index = 16
 WHERE id = 'c41d0000-0000-4000-8000-000000000d02';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001a', item_number = '13.17', order_index = 17, label = 'Is the bunkering procedure documented?', help_text = 'The written procedure and the checklist used on the day — pre-transfer checks, agreed signals, watchkeeping and the shut-down. The save-alls and scupper plugs themselves are at 13.16.', options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-000000000d03';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001f', item_number = '', order_index = 0
 WHERE id = 'c41d0000-0000-4000-8000-000000001000';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001f', item_number = '', order_index = 1, help_text = 'The checklist item this relates to, e.g. 10.7.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001001';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001f', item_number = '', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000001002';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001f', item_number = '', order_index = 3
 WHERE id = 'c41d0000-0000-4000-8000-000000001003';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-00000000001f', item_number = '', order_index = 4
 WHERE id = 'c41d0000-0000-4000-8000-000000001004';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000020', item_number = '15.1', order_index = 0, field_type = 'textarea', label = 'Condition observed across hull, deck, machinery spaces and accommodation', help_text = 'A record of what was seen on the day. State conditions, not conclusions — no view on suitability for any service.', options = '[]'::jsonb, with_remarks = false
 WHERE id = 'c41d0000-0000-4000-8000-000000001220';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000020', item_number = '15.2', order_index = 1
 WHERE id = 'c41d0000-0000-4000-8000-000000001101';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000020', item_number = '15.3', order_index = 2
 WHERE id = 'c41d0000-0000-4000-8000-000000001103';
UPDATE public.template_fields SET section_id = 'c41d0000-0000-4000-8000-000000000020', item_number = '15.4', order_index = 3
 WHERE id = 'c41d0000-0000-4000-8000-000000001104';

-- ------------------------------------------------------------
-- 4. New questions
-- ------------------------------------------------------------
INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required,
   options, validation, calculation_formula, conditional_logic, item_number,
   with_remarks, unit, help_text, pdf_hide_when_empty)
VALUES
  ('c41d0000-0000-4000-8000-000000001c01', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000014',
   'Are there any outstanding non-conformities or observations from internal or external ISM audit?', 'yes_no_na', 2, false,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '4.3', true, NULL, 'The equivalent of a condition of class, against the management system. Ask for the last internal audit and the last external ISM audit, and whether anything raised is still open. No is the expected answer, so the colours are reversed. Record the reference, the finding and its due date in the remarks.', false),
  ('c41d0000-0000-4000-8000-000000001c02', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000014',
   'Have any accidents, injuries or near-misses been recorded in the last 12 months?', 'yes_no_na', 3, false,
   '[{"value":"yes","label":"Yes","color":"amber"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '4.4', true, NULL, 'Ask which log or system they are recorded in and to see the last twelve months. No is the expected answer, so the colours are reversed. Record what happened and when. If nothing is recorded anywhere, say so in the remarks — that is itself the fact.', false),
  ('c41d0000-0000-4000-8000-000000001c03', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000021',
   'Is a damage control plan on board, with a flooding response procedure in the safety management system?', 'yes_no_na', 3, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '5.4', true, NULL, 'Fire, abandon ship and man overboard each have a procedure; flooding after contact or grounding is the one that usually does not. Ask for the damage control plan or booklet and for the SMS procedure that goes with it.', false),
  ('c41d0000-0000-4000-8000-000000001c04', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000013',
   'Is the manning on board at or above the Safe Manning Document, rank for rank?', 'yes_no_na', 3, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '6.4', true, NULL, '6.2 and 6.3 are free text, and text never appears in the Summary of Findings. This is the question that records a shortfall. Compare rank for rank, not head for head, and name any rank short in the remarks.', false),
  ('c41d0000-0000-4000-8000-000000001c05', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000017',
   'Is there a public address or other means of giving spoken emergency instructions in the passenger seating space?', 'yes_no_na', 13, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '8.14', true, NULL, '5.12 confirms the alarm can be heard there. This asks whether anyone can then tell twenty people who have never been aboard what to do about it — the hinge of the evacuation procedure at 5.5. A PA, a talkback, or a crew member stationed in the space; say which.', false),
  ('c41d0000-0000-4000-8000-000000001c06', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000018',
   'Are lifejackets or work vests and helmets provided for passengers during transfer, in sufficient number for those carried?', 'yes_no_na', 7, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '9.7', true, NULL, 'Section 9 establishes the method, the risk assessment, the lighting and the limits, but not what the person swinging over the water is wearing. Count against the number to be carried at 8.1. The lifejackets stowed in the seating space are a different set, asked at 10.6.', false),
  ('c41d0000-0000-4000-8000-000000001c07', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000018',
   'Is the vessel’s own means of access from the quay in good order, with a safety net and a lifebuoy with line at the access point?', 'yes_no_na', 8, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '9.8', true, NULL, 'Twenty people cross it twice a day. The vessel’s own gangway or accommodation ladder, its rigging and securing, the safety net beneath it, and a lifebuoy with line at the head. Offshore transfer is 9.1–9.7; internal ladders and stairways are 12.6.', false),
  ('c41d0000-0000-4000-8000-000000001c08', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000015',
   'Is there survival craft and lifejacket capacity for the maximum persons permitted on board?', 'yes_no_na', 5, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '10.5', true, NULL, '10.3 and 10.4 are numbers, and a number never appears in the Summary of Findings. Compare both against 3.3. If one is short and the other is not, say which in the remarks.', false),
  ('c41d0000-0000-4000-8000-000000001c09', 'c41d0000-0000-4000-8000-000000000001', 'c41d0000-0000-4000-8000-000000000016',
   'Is a fire control plan posted, with a copy held in a marked container outside the accommodation?', 'yes_no_na', 15, false,
   '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"amber"}]'::jsonb, '{}'::jsonb, NULL, NULL, '11.15', true, NULL, 'The one document a shore fire brigade needs. Posted where the crew fight the fire, and a duplicate in a marked weathertight container outside the accommodation for people arriving from ashore. The general arrangement plan at 3.16 is a different document.', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Merged-away questions
--
-- Guarded: a field that already holds an answer or a photo is left alone rather than
-- destroyed. Nothing clears job_field_values.
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-00000000040a',  -- 4.7 drill records — duplicate of the drills block; merged into 1203
         'c41d0000-0000-4000-8000-000000001210',  -- 5.16 PMS name/type — the remarks box on 1a00 already takes it
         'c41d0000-0000-4000-8000-000000001503',  -- 7.10 fixed-system type — merged into 0705’s remarks
         'c41d0000-0000-4000-8000-000000000809',  -- 8.10 passenger-space fire detection — strict subset of 1500
         'c41d0000-0000-4000-8000-000000000904',  -- 9.1D transfer-area handholds — same deck as 0902, merged
         'c41d0000-0000-4000-8000-000000000803',  -- 8.4 seat count — stated in 0802’s remarks
         'c41d0000-0000-4000-8000-000000000907',  -- 9.5 max Hs — one of the three limits 0906 already asks for
         'c41d0000-0000-4000-8000-000000001303'   -- 10.7 plotter updates — same question as 1301, now one field
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 6. Retire the emptied Pollution Prevention & Security section
--
-- Fields first (they were moved above, so it should already be empty); the section is
-- dropped only once nothing is left in it, because template_sections CASCADEs to
-- template_fields and dropping it while occupied would bypass every guard above.
-- ------------------------------------------------------------
DELETE FROM public.template_sections ts
 WHERE ts.id = 'c41d0000-0000-4000-8000-00000000001c'
   AND NOT EXISTS (SELECT 1 FROM public.template_fields f WHERE f.section_id = ts.id);
