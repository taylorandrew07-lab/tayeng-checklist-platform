-- ============================================================
-- Seed: Fuel Transfer Checklist template
-- ------------------------------------------------------------
-- Builds the full "Fuel Transfer Checklist" as a DRAFT template.
-- Source/Delivery type and other control answers drive which
-- sections / questions appear (section-level conditional logic).
--
-- Safe to re-run: it removes ONLY a prior *empty draft* named
-- "Fuel Transfer Checklist" (one with no jobs) and rebuilds it.
-- It NEVER touches the BPTT checklist or any active template.
-- ============================================================

DO $$
DECLARE
  v_template_id uuid := uuid_generate_v4();
  v_creator     uuid;

  -- Sections
  s_header   uuid := uuid_generate_v4();
  s_control  uuid := uuid_generate_v4();
  s_a        uuid := uuid_generate_v4();
  s_tw       uuid := uuid_generate_v4();
  s_st       uuid := uuid_generate_v4();
  s_bv       uuid := uuid_generate_v4();
  s_ship     uuid := uuid_generate_v4();
  s_initial  uuid := uuid_generate_v4();
  s_mid      uuid := uuid_generate_v4();
  s_final    uuid := uuid_generate_v4();
  s_periodic uuid := uuid_generate_v4();
  s_calc     uuid := uuid_generate_v4();
  s_docs     uuid := uuid_generate_v4();

  -- Control fields referenced by conditions / calculations
  f_source          uuid := uuid_generate_v4();
  f_numsamples      uuid := uuid_generate_v4();
  f_mainloc         uuid := uuid_generate_v4();
  f_otherloc        uuid := uuid_generate_v4();
  f_periodic_req    uuid := uuid_generate_v4();
  f_periodic_loc    uuid := uuid_generate_v4();
  f_other_periodic  uuid := uuid_generate_v4();
  f_tolerance       uuid := uuid_generate_v4();

  -- Calculation inputs
  f_ship_usg     uuid := uuid_generate_v4();
  f_supplier_usg uuid := uuid_generate_v4();
BEGIN
  -- Owner: prefer the super admin, fall back to any admin.
  SELECT id INTO v_creator FROM profiles WHERE is_super_admin = true ORDER BY created_at LIMIT 1;
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  END IF;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No admin / super-admin profile found to own the template.';
  END IF;

  -- Remove a prior empty draft of this checklist (never an active one, never one with jobs).
  DELETE FROM checklist_templates
  WHERE name ILIKE 'Fuel Transfer Checklist'
    AND status = 'draft'
    AND id NOT IN (SELECT template_id FROM jobs WHERE template_id IS NOT NULL);

  -- ----------------------------------------------------------
  -- Template
  -- ----------------------------------------------------------
  INSERT INTO checklist_templates (id, name, description, status, allow_surveyor_start, created_by)
  VALUES (
    v_template_id,
    'Fuel Transfer Checklist',
    'Fuel transfer / bunkering survey checklist. The Source/Delivery type and sampling answers at the top control which sections and questions appear.',
    'draft',
    true,
    v_creator
  );

  -- ----------------------------------------------------------
  -- Sections (source-type sections gated at section level)
  -- ----------------------------------------------------------
  INSERT INTO template_sections (id, template_id, title, description, order_index, conditional_logic) VALUES
    (s_header,  v_template_id, 'Header',                          NULL, 0,  NULL),
    (s_control, v_template_id, 'Survey Setup',                    'These answers control which questions appear below.', 1, NULL),
    (s_a,       v_template_id, 'A. Previous Sampling / Analysis', NULL, 2,  NULL),
    (s_tw,      v_template_id, 'B. Source Checks — Tanker Wagon', NULL, 3,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_source::text,'operator','equals','value','tanker_wagon')))),
    (s_st,      v_template_id, 'B. Source Checks — Shore Tank',   NULL, 4,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_source::text,'operator','equals','value','shore_tank')))),
    (s_bv,      v_template_id, 'B. Source Checks — Bunkering Vessel', NULL, 5,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_source::text,'operator','equals','value','bunkering_vessel')))),
    (s_ship,    v_template_id, 'B. Ship / Vessel Tank Checks',    NULL, 6,  NULL),
    (s_initial, v_template_id, 'B. Initial Sample',               NULL, 7,  NULL),
    (s_mid,     v_template_id, 'B. Mid Sample',                   'Shown when 3 samples are taken.', 8,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_numsamples::text,'operator','equals','value','three')))),
    (s_final,   v_template_id, 'B. Final Sample',                 NULL, 9,  NULL),
    (s_periodic,v_template_id, 'B. Periodic 30-Minute Sampling',  NULL, 10,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_req::text,'operator','equals','value','yes')))),
    (s_calc,    v_template_id, 'C. Final Calculation',            NULL, 11, NULL),
    (s_docs,    v_template_id, 'C. Final Documents / Samples',    NULL, 12, NULL);

  -- ----------------------------------------------------------
  -- HEADER
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_header, 'Date',   'date', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'H1', false),
    (uuid_generate_v4(), v_template_id, s_header, 'Vessel', 'text', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'H2', false),
    (uuid_generate_v4(), v_template_id, s_header, 'Port',   'text', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'H3', false),
    (uuid_generate_v4(), v_template_id, s_header, 'Berth',  'text', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'H4', false);

  -- ----------------------------------------------------------
  -- SURVEY SETUP (control fields)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (f_source, v_template_id, s_control, 'Source / Delivery Type', 'dropdown', 0, true,
      '[{"value":"tanker_wagon","label":"Tanker Wagon"},{"value":"shore_tank","label":"Shore Tank"},{"value":"bunkering_vessel","label":"Bunkering Vessel"}]'::jsonb,
      '{}'::jsonb, NULL, 'CRTL1', false, NULL, 'Controls which source-checks section appears.'),

    (f_numsamples, v_template_id, s_control, 'Number of Samples', 'dropdown', 1, true,
      '[{"value":"two","label":"2 Samples"},{"value":"three","label":"3 Samples"}]'::jsonb,
      '{}'::jsonb, NULL, 'CRTL2', false, NULL, 'Choose 3 to show the Mid Sample section.'),

    (f_mainloc, v_template_id, s_control, 'Main Sampling Location', 'dropdown', 2, true,
      '[{"value":"ship_manifold","label":"Ship''s manifold"},{"value":"shore_manifold","label":"Shore manifold"},{"value":"shore_sampling_point","label":"Shore sampling point"},{"value":"other","label":"Other"}]'::jsonb,
      '{}'::jsonb, NULL, 'CRTL3', false, NULL, NULL),

    (f_otherloc, v_template_id, s_control, 'Other Sampling Location', 'text', 3, true,
      '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','other'))),
      'CRTL4', false, NULL, NULL),

    (f_periodic_req, v_template_id, s_control, 'Periodic 30-minute Sampling Required?', 'yes_no', 4, true,
      '[]'::jsonb, '{}'::jsonb, NULL, 'CRTL5', false, NULL, NULL),

    (f_periodic_loc, v_template_id, s_control, 'Periodic Sampling Location', 'dropdown', 5, true,
      '[{"value":"ship_manifold","label":"Ship''s manifold"},{"value":"shore_sampling_point","label":"Shore sampling point"},{"value":"both","label":"Both"},{"value":"other","label":"Other"}]'::jsonb,
      '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_req::text,'operator','equals','value','yes'))),
      'CRTL6', false, NULL, NULL),

    (f_other_periodic, v_template_id, s_control, 'Other Periodic Sampling Location', 'text', 6, true,
      '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','other'))),
      'CRTL7', false, NULL, NULL),

    (f_tolerance, v_template_id, s_control, 'Allowed Difference Tolerance', 'number', 7, false,
      '[]'::jsonb, '{}'::jsonb, NULL, 'CRTL8', false, '%',
      'Reference only. The variance field below is colour-coded green under 1%, amber under 2%, red above.');

  -- ----------------------------------------------------------
  -- A. Previous Sampling / Analysis (always shown)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_a, 'Initial fuel sampling and analysis carried out on commencement of charter', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'A1', true),
    (uuid_generate_v4(), v_template_id, s_a, 'Last sampling and analysis of storage tanks', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'A2', true),
    (uuid_generate_v4(), v_template_id, s_a, 'Last bottom sampling of tanks', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'A3', true),
    (uuid_generate_v4(), v_template_id, s_a, 'Last random analysis of manifold sample', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'A4', true);

  -- ----------------------------------------------------------
  -- B. Tanker Wagon (section gated by source = tanker_wagon)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_tw, 'For delivery from tanker wagons, verification that wagon hatches and manifold seals are intact', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW1', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Tanker wagons allowed to settle for 30 minutes after arrival prior to sounding', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW2', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Tanker wagon volumes certified', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW3', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Initial manual sounding of tanker wagons carried out by surveyor', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW4', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Initial manual sounding of tanker wagons carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW5', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Initial check of free water with water finding paste in tanker wagon', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW6', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Photograph of sounding tape after checking free water posted', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW7', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Initial bottom composite sample taken from tanker wagon compartments', 'yes_no_na', 7, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW8', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Composite samples taken of all tanker wagons', 'yes_no_na', 8, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW9', true),
    (uuid_generate_v4(), v_template_id, s_tw, 'Final visual inspection of tanker wagons', 'yes_no_na', 9, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-TW10', true);

  -- ----------------------------------------------------------
  -- B. Shore Tank (section gated by source = shore_tank)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_st, 'Initial manual sounding of shore tank carried out by surveyor', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST1', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Initial manual sounding of shore tank carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST2', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Initial check of free water with water finding paste in shore tank', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST3', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Photograph of sounding tape after checking free water posted', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST4', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Initial bottom sample taken from shore tank', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST5', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Initial running sample taken from shore tank', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST6', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Final manual sounding of shore tank carried out by surveyor', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST7', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Final manual sounding of shore tank carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 7, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST8', true),
    (uuid_generate_v4(), v_template_id, s_st, 'Final check of free water with water finding paste in shore tank', 'yes_no_na', 8, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-ST9', true);

  -- ----------------------------------------------------------
  -- B. Bunkering Vessel (section gated by source = bunkering_vessel)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_bv, 'Initial manual sounding of bunkering vessel carried out by surveyor', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV1', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Initial manual sounding of bunkering vessel carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV2', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Initial check of free water with water finding paste in bunkering vessel', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV3', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Photograph of sounding tape after checking free water posted', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV4', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Final manual sounding of bunkering vessel carried out by surveyor', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV5', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Final manual sounding of bunkering vessel carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV6', true),
    (uuid_generate_v4(), v_template_id, s_bv, 'Final check of free water with water finding paste in bunkering vessel', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-BV7', true);

  -- ----------------------------------------------------------
  -- B. Ship / Vessel Tank Checks (always shown)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_ship, 'Verification of height(s) of vessel''s sounding tube(s)', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V1', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Initial manual sounding of ship''s tanks carried out by surveyor', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V2', true, 'If no manual sounding was possible, note vessel gauges used in the remarks.'),
    (uuid_generate_v4(), v_template_id, s_ship, 'Initial manual sounding of ship''s tanks carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V3', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Initial check of free water with water finding paste in ship''s tanks', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V4', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Vessel representative confirmation of check of free water with water finding paste in ship''s tanks', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V5', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Vessel selected lowest volume tank for initial loading', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V6', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Transfer rate agreed between ship and shore including initial slow start-up procedure', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V7', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Final manual sounding of ship''s tanks carried out by surveyor', 'yes_no_na', 7, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V8', true, 'If no manual sounding was possible, note vessel gauges used in the remarks.'),
    (uuid_generate_v4(), v_template_id, s_ship, 'Final manual sounding of ship''s tanks carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 8, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V9', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Final check of free water with water finding paste in ship''s tanks', 'yes_no_na', 9, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V10', true, NULL),
    (uuid_generate_v4(), v_template_id, s_ship, 'Vessel representative confirmation of check of free water with water finding paste in ship''s tanks', 'yes_no_na', 10, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-V11', true, NULL);

  -- ----------------------------------------------------------
  -- B. Initial Sample
  --   B-I1A..D gated by main sampling location; B-I2..7 always.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial sample taken at ship''s manifold', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','ship_manifold'))), 'B-I1A', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial sample taken at shore manifold', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_manifold'))), 'B-I1B', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial sample taken at shore sampling point', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_sampling_point'))), 'B-I1C', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial sample taken at other sampling location', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','other'))), 'B-I1D', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Photograph of initial sample', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I2', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Bacteria test of initial sample', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I3', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial manifold samples checked for water content in centrifuge', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I4', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial samples checked for water content in centrifuge', 'yes_no_na', 7, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I5', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Off spec fuel identified in initial sample', 'yes_no_na', 8, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I6', true),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial manifold sample and shore tank / tanker wagon sample sent for analysis', 'yes_no_na', 9, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-I7', true);

  -- ----------------------------------------------------------
  -- B. Mid Sample (section gated by number of samples = 3)
  --   B-M1A..D additionally gated by main sampling location.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid sample taken at ship''s manifold', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','ship_manifold'))), 'B-M1A', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid sample taken at shore manifold', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_manifold'))), 'B-M1B', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid sample taken at shore sampling point', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_sampling_point'))), 'B-M1C', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid sample taken at other sampling location', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','other'))), 'B-M1D', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid manifold samples checked for water content in centrifuge', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-M2', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Photograph of mid sample', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-M3', true),
    (uuid_generate_v4(), v_template_id, s_mid, 'Off spec fuel identified in mid sample', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-M4', true);

  -- ----------------------------------------------------------
  -- B. Final Sample
  --   B-F1A..D gated by main sampling location; B-F2/3 always.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_final, 'Final sample taken at ship''s manifold', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','ship_manifold'))), 'B-F1A', true),
    (uuid_generate_v4(), v_template_id, s_final, 'Final sample taken at shore manifold', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_manifold'))), 'B-F1B', true),
    (uuid_generate_v4(), v_template_id, s_final, 'Final sample taken at shore sampling point', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','shore_sampling_point'))), 'B-F1C', true),
    (uuid_generate_v4(), v_template_id, s_final, 'Final sample taken at other sampling location', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','other'))), 'B-F1D', true),
    (uuid_generate_v4(), v_template_id, s_final, 'Photograph of final sample', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-F2', true),
    (uuid_generate_v4(), v_template_id, s_final, 'Off spec fuel identified in final sample', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, 'B-F3', true);

  -- ----------------------------------------------------------
  -- B. Periodic 30-minute Sampling (section gated by required = yes)
  --   Each item gated by the chosen periodic location.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at ship''s manifold', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','ship_manifold'))), 'B-P1', true),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at shore sampling point', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','shore_sampling_point'))), 'B-P2', true),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at ship''s manifold', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','both'))), 'B-P3', true),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at shore sampling point', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','both'))), 'B-P4', true),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at other location', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','other'))), 'B-P5', true);

  -- ----------------------------------------------------------
  -- C. Final Calculation
  --   Difference and % variance auto-calculate from the figures.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit)
  VALUES
    (f_ship_usg, v_template_id, s_calc, 'Ship''s figure', 'number', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C1A', false, 'USG'),
    (f_supplier_usg, v_template_id, s_calc, 'Shore / Supplier figure', 'number', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C1B', false, 'USG'),
    (uuid_generate_v4(), v_template_id, s_calc, 'Difference (Ship − Supplier)', 'calculated', 2, false, '[]'::jsonb, '{}'::jsonb,
      '{' || f_ship_usg::text || '}-{' || f_supplier_usg::text || '}', NULL, 'C1C', false, 'USG'),
    (uuid_generate_v4(), v_template_id, s_calc, '% Variance vs Supplier', 'calculated', 3, false, '[]'::jsonb,
      jsonb_build_object('display_as','percentage','thresholds',jsonb_build_array(
        jsonb_build_object('max',1.0,'color','green'),
        jsonb_build_object('max',2.0,'color','amber'),
        jsonb_build_object('color','red'))),
      '{' || f_ship_usg::text || '}-{' || f_supplier_usg::text || '}', NULL, 'C1D', false, NULL);

  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_calc, 'Calculation remarks', 'textarea', 4, false, '[]'::jsonb, '{}'::jsonb, NULL, 'C1E', false);

  -- ----------------------------------------------------------
  -- C. Final Documents / Samples (always shown)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, conditional_logic, item_number, with_remarks)
  VALUES
    (uuid_generate_v4(), v_template_id, s_docs, 'Schedule of surveyors samples signed by vessel, including MARPOL sample if provided', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, 'C2', true),
    (uuid_generate_v4(), v_template_id, s_docs, 'MARPOL samples taken in accordance with requirements of MARPOL', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, 'C3', true),
    (uuid_generate_v4(), v_template_id, s_docs, 'MARPOL samples given to vessel', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, 'C4', true),
    (uuid_generate_v4(), v_template_id, s_docs, 'COQ provided by bunker suppliers to the vessel', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, 'C5', true),
    (uuid_generate_v4(), v_template_id, s_docs, 'Analysis of samples verifies compliant with COQ for water content', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, 'C6', true);

  RAISE NOTICE 'Fuel Transfer Checklist created as DRAFT (template id %).', v_template_id;
END $$;
