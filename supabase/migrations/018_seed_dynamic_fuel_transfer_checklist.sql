-- ============================================================
-- Seed: Fuel Transfer Checklist (DYNAMIC, single template)
-- ------------------------------------------------------------
-- One template that re-words shared questions based on the
-- selected Source/Delivery Type and Sampling Location, using
-- the app's {field-uuid} dynamic-label engine.
--
-- Shared source questions use {sourceField} -> "tanker wagon" /
-- "shore tank" / "bunkering vessel". Sample-location questions use
-- {mainLocField}; the "Other" option defers to the typed text via
-- the option's useFieldId. Source-specific questions use
-- conditional visibility (equals), shared ones use is_not_empty.
--
-- Safe to re-run: removes ONLY a prior empty draft named "Fuel
-- Transfer Checklist" (no jobs) and rebuilds. Never touches BPTT
-- or any active template.
-- ============================================================

DO $$
DECLARE
  v_template_id uuid := uuid_generate_v4();
  v_creator     uuid;

  -- Sections
  s_header    uuid := uuid_generate_v4();
  s_control   uuid := uuid_generate_v4();
  s_a         uuid := uuid_generate_v4();
  s_prelim    uuid := uuid_generate_v4();
  s_sound     uuid := uuid_generate_v4();
  s_ship1     uuid := uuid_generate_v4();
  s_initial   uuid := uuid_generate_v4();
  s_mid       uuid := uuid_generate_v4();
  s_final     uuid := uuid_generate_v4();
  s_periodic  uuid := uuid_generate_v4();
  s_srcfinal  uuid := uuid_generate_v4();
  s_ship2     uuid := uuid_generate_v4();
  s_calc      uuid := uuid_generate_v4();
  s_docs      uuid := uuid_generate_v4();

  -- Control / referenced fields
  f_source         uuid := uuid_generate_v4();
  f_numsamples     uuid := uuid_generate_v4();
  f_mainloc        uuid := uuid_generate_v4();
  f_otherloc       uuid := uuid_generate_v4();
  f_periodic_req   uuid := uuid_generate_v4();
  f_periodic_loc   uuid := uuid_generate_v4();
  f_other_periodic uuid := uuid_generate_v4();
  f_tolerance      uuid := uuid_generate_v4();
  f_ship_usg       uuid := uuid_generate_v4();
  f_supplier_usg   uuid := uuid_generate_v4();
BEGIN
  -- Owner: prefer super admin, else any admin.
  SELECT id INTO v_creator FROM profiles WHERE is_super_admin = true ORDER BY created_at LIMIT 1;
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator FROM profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  END IF;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No admin / super-admin profile found to own the template.';
  END IF;

  -- Remove a prior empty draft of this checklist (never active, never one with jobs).
  DELETE FROM checklist_templates
  WHERE name ILIKE 'Fuel Transfer Checklist'
    AND status = 'draft'
    AND id NOT IN (SELECT template_id FROM jobs WHERE template_id IS NOT NULL);

  INSERT INTO checklist_templates (id, name, description, status, allow_surveyor_start, created_by)
  VALUES (
    v_template_id,
    'Fuel Transfer Checklist',
    'Dynamic fuel transfer / bunkering survey checklist. Shared questions automatically re-word and show/hide based on the Source/Delivery Type, number of samples, sampling location, and periodic sampling answers in Survey Setup.',
    'draft',
    true,
    v_creator
  );

  -- ----------------------------------------------------------
  -- Sections
  -- ----------------------------------------------------------
  INSERT INTO template_sections (id, template_id, title, description, order_index, conditional_logic) VALUES
    (s_header,   v_template_id, 'Header', NULL, 0, NULL),
    (s_control,  v_template_id, 'Survey Setup', 'These answers drive the wording and which questions appear below.', 1, NULL),
    (s_a,        v_template_id, 'A. Previous Sampling / Analysis', NULL, 2, NULL),
    (s_prelim,   v_template_id, 'B. Source Preliminary Checks', NULL, 3,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_source::text,'operator','equals','value','tanker_wagon')))),
    (s_sound,    v_template_id, 'B. Source Sounding & Sampling', NULL, 4, NULL),
    (s_ship1,    v_template_id, 'B. Ship / Vessel Tank — Initial Checks', NULL, 5, NULL),
    (s_initial,  v_template_id, 'B. Initial Sample', NULL, 6, NULL),
    (s_mid,      v_template_id, 'B. Mid Sample', 'Shown when 3 samples are taken.', 7,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_numsamples::text,'operator','equals','value','three')))),
    (s_final,    v_template_id, 'B. Final Sample', NULL, 8, NULL),
    (s_periodic, v_template_id, 'B. Periodic 30-Minute Sampling', NULL, 9,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_req::text,'operator','equals','value','yes')))),
    (s_srcfinal, v_template_id, 'B. Source Final Checks', NULL, 10, NULL),
    (s_ship2,    v_template_id, 'B. Ship / Vessel Tank — Final Checks', NULL, 11, NULL),
    (s_calc,     v_template_id, 'C. Final Calculation', NULL, 12, NULL),
    (s_docs,     v_template_id, 'C. Final Documents / MARPOL / COQ', NULL, 13, NULL);

  -- ----------------------------------------------------------
  -- HEADER
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_header, 'Date',   'date', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'H1', false, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_header, 'Vessel', 'text', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'H2', false, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_header, 'Port',   'text', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'H3', false, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_header, 'Berth',  'text', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'H4', false, NULL, NULL);

  -- ----------------------------------------------------------
  -- SURVEY SETUP (control fields)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (f_source, v_template_id, s_control, 'Source / Delivery Type', 'dropdown', 0, true,
      '[{"value":"tanker_wagon","label":"tanker wagon"},{"value":"shore_tank","label":"shore tank"},{"value":"bunkering_vessel","label":"bunkering vessel"}]'::jsonb,
      '{}'::jsonb, NULL, NULL, 'CRTL1', false, NULL, 'Drives source-specific questions and the wording of shared questions.'),

    (f_numsamples, v_template_id, s_control, 'Number of Samples', 'dropdown', 1, true,
      '[{"value":"two","label":"2 Samples"},{"value":"three","label":"3 Samples"}]'::jsonb,
      '{}'::jsonb, NULL, NULL, 'CRTL2', false, NULL, 'Choose 3 to show the Mid Sample section.'),

    (f_mainloc, v_template_id, s_control, 'Main Sampling Location', 'dropdown', 2, true,
      jsonb_build_array(
        jsonb_build_object('value','ship_manifold','label','ship''s manifold'),
        jsonb_build_object('value','shore_manifold','label','shore manifold'),
        jsonb_build_object('value','shore_sampling_point','label','shore sampling point'),
        jsonb_build_object('value','other','label','other','useFieldId',f_otherloc::text)),
      '{}'::jsonb, NULL, NULL, 'CRTL3', false, NULL, 'Sets the wording of the Initial/Mid/Final sample questions.'),

    (f_otherloc, v_template_id, s_control, 'Other Sampling Location', 'text', 3, true,
      '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_mainloc::text,'operator','equals','value','other'))),
      'CRTL4', false, NULL, 'Typed here and used in the sample question wording.'),

    (f_periodic_req, v_template_id, s_control, 'Periodic 30-minute Sampling Required?', 'dropdown', 4, true,
      '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]'::jsonb,
      '{}'::jsonb, NULL, NULL, 'CRTL5', false, NULL, NULL),

    (f_periodic_loc, v_template_id, s_control, 'Periodic Sampling Location', 'dropdown', 5, true,
      jsonb_build_array(
        jsonb_build_object('value','ship_manifold','label','ship''s manifold'),
        jsonb_build_object('value','shore_sampling_point','label','shore sampling point'),
        jsonb_build_object('value','both','label','Both'),
        jsonb_build_object('value','other','label','other','useFieldId',f_other_periodic::text)),
      '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_req::text,'operator','equals','value','yes'))),
      'CRTL6', false, NULL, NULL),

    (f_other_periodic, v_template_id, s_control, 'Other Periodic Sampling Location', 'text', 6, true,
      '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','other'))),
      'CRTL7', false, NULL, NULL),

    (f_tolerance, v_template_id, s_control, 'Allowed Difference Tolerance', 'number', 7, false,
      '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'CRTL8', false, '%',
      'Reference only. The % variance below is colour-coded green under 1%, amber under 2%, red above.');

  -- ----------------------------------------------------------
  -- A. Previous Sampling / Analysis (always)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_a, 'Initial fuel sampling and analysis carried out on commencement of charter', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'A1', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_a, 'Last sampling and analysis of storage tanks', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'A2', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_a, 'Last bottom sampling of tanks', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'A3', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_a, 'Last random analysis of manifold sample', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'A4', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Source Preliminary Checks (section gated: source = tanker_wagon)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_prelim, 'For delivery from tanker wagons, verification that wagon hatches and manifold seals are intact', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B1', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_prelim, 'Tanker wagons allowed to settle for 30 minutes after arrival prior to sounding', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B2', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_prelim, 'Tanker wagon volumes certified', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B3', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Source Sounding & Sampling
  --   Shared (dynamic) items visible once source is selected;
  --   source-specific items gated by equals.
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial manual sounding of {' || f_source::text || '} carried out by surveyor', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B4', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial manual sounding of {' || f_source::text || '} carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B5', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial check of free water with water finding paste in {' || f_source::text || '}', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B6', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Photograph of sounding tape after checking of free water posted', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B7', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial bottom composite sample taken from tanker wagon compartments', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','equals','value','tanker_wagon'))), 'B8', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial bottom sample taken from shore tank', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','equals','value','shore_tank'))), 'B9', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial running sample taken from shore tank', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','equals','value','shore_tank'))), 'B10', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial samples checked for water content in centrifuge', 'yes_no_na', 7, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B11', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Composite samples taken of all tanker wagons', 'yes_no_na', 8, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','equals','value','tanker_wagon'))), 'B12', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_sound, 'Initial manifold sample and {' || f_source::text || '} sample sent for analysis', 'yes_no_na', 9, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B13', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Ship / Vessel Tank — Initial Checks (always)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_ship1, 'Verification of height(s) of vessel''s sounding tube(s)', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B14', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Initial manual sounding of ship''s tanks carried out by surveyor', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B15', true, NULL, 'If no manual sounding was possible, note vessel gauges used in the remarks.'),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Initial manual sounding of ship''s tanks carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B16', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Initial check of free water with water finding paste in ship''s tanks', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B17', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Vessel representative confirmation of check of free water with water finding paste in ship''s tanks', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B18', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Vessel selected lowest volume tank for initial loading', 'yes_no_na', 5, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B19', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship1, 'Transfer rate agreed between ship and shore including initial slow start-up procedure', 'yes_no_na', 6, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B20', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Initial Sample (B21 dynamic location)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial sample taken at {' || f_mainloc::text || '}', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','is_not_empty','value',''))), 'B21', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_initial, 'Photograph of initial sample', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B22', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_initial, 'Bacteria test of initial sample', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B23', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_initial, 'Initial manifold samples checked for water content in centrifuge', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B24', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_initial, 'Off spec fuel identified in initial sample', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B25', true, NULL, 'If YES, record details in remarks: water, sediment, haze, appearance, colour or contamination.');

  -- ----------------------------------------------------------
  -- B. Mid Sample (section gated: number of samples = 3)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid sample taken at {' || f_mainloc::text || '}', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','is_not_empty','value',''))), 'B26', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_mid, 'Mid manifold samples checked for water content in centrifuge', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B27', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_mid, 'Photograph of mid sample', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B28', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_mid, 'Off spec fuel identified in mid sample', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B29', true, NULL, 'If YES, record details in remarks: water, sediment, haze, appearance, colour or contamination.');

  -- ----------------------------------------------------------
  -- B. Final Sample (B30 dynamic location)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_final, 'Final sample taken at {' || f_mainloc::text || '}', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_mainloc::text,'operator','is_not_empty','value',''))), 'B30', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_final, 'Photograph of final sample', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B31', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_final, 'Off spec fuel identified in final sample', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B32', true, NULL, 'If YES, record details in remarks: water, sediment, haze, appearance, colour or contamination.');

  -- ----------------------------------------------------------
  -- B. Periodic 30-Minute Sampling (section gated: required = yes)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at ship''s manifold', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','or','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','ship_manifold'),
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','both'))), 'B33', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at shore sampling point', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','or','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','shore_sampling_point'),
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','both'))), 'B34', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_periodic, 'Periodical 30-minute sampling at {' || f_periodic_loc::text || '}', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(
        jsonb_build_object('field_id',f_periodic_loc::text,'operator','equals','value','other'))), 'B35', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Source Final Checks (shared dynamic + tanker-wagon only)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_srcfinal, 'Final manual sounding of {' || f_source::text || '} carried out by surveyor', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B36', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_srcfinal, 'Final manual sounding of {' || f_source::text || '} carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B37', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_srcfinal, 'Final check of free water with water finding paste in {' || f_source::text || '}', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','is_not_empty','value',''))), 'B38', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_srcfinal, 'Final visual inspection of tanker wagons', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL,
      jsonb_build_object('operator','and','conditions',jsonb_build_array(jsonb_build_object('field_id',f_source::text,'operator','equals','value','tanker_wagon'))), 'B39', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- B. Ship / Vessel Tank — Final Checks (always)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_ship2, 'Final manual sounding of ship''s tanks carried out by surveyor', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B40', true, NULL, 'If no manual sounding was possible, note vessel gauges used in the remarks.'),
    (uuid_generate_v4(), v_template_id, s_ship2, 'Final manual sounding of ship''s tanks carried out using surveyor''s calibrated sounding tape', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B41', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship2, 'Final check of free water with water finding paste in ship''s tanks', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B42', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_ship2, 'Vessel representative confirmation of check of free water with water finding paste in ship''s tanks', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'B43', true, NULL, NULL);

  -- ----------------------------------------------------------
  -- C. Final Calculation
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (f_ship_usg, v_template_id, s_calc, 'Ship''s figure', 'number', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C1', false, 'USG', NULL),
    (f_supplier_usg, v_template_id, s_calc, 'Shore / Supplier figure', 'number', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C2', false, 'USG', NULL),
    (uuid_generate_v4(), v_template_id, s_calc, 'Difference (Ship − Supplier)', 'calculated', 2, false, '[]'::jsonb, '{}'::jsonb,
      '{' || f_ship_usg::text || '}-{' || f_supplier_usg::text || '}', NULL, 'C3', false, 'USG', NULL),
    (uuid_generate_v4(), v_template_id, s_calc, '% Variance vs Supplier (tolerance check)', 'calculated', 3, false, '[]'::jsonb,
      jsonb_build_object('display_as','percentage','thresholds',jsonb_build_array(
        jsonb_build_object('max',1.0,'color','green'),
        jsonb_build_object('max',2.0,'color','amber'),
        jsonb_build_object('color','red'))),
      '{' || f_ship_usg::text || '}-{' || f_supplier_usg::text || '}', NULL, 'C4', false, NULL,
      'Green within 1%, amber within 2%, red over 2%.'),
    (uuid_generate_v4(), v_template_id, s_calc, 'Calculation remarks', 'textarea', 4, false, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C5', false, NULL, 'Required if the difference is outside tolerance.');

  -- ----------------------------------------------------------
  -- C. Final Documents / MARPOL / COQ (always)
  -- ----------------------------------------------------------
  INSERT INTO template_fields
    (id, template_id, section_id, label, field_type, order_index, is_required, options, validation, calculation_formula, conditional_logic, item_number, with_remarks, unit, help_text)
  VALUES
    (uuid_generate_v4(), v_template_id, s_docs, 'Schedule of surveyors samples signed by vessel, including MARPOL sample if provided', 'yes_no_na', 0, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C6', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_docs, 'MARPOL samples taken in accordance with requirements of MARPOL', 'yes_no_na', 1, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C7', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_docs, 'MARPOL samples given to vessel', 'yes_no_na', 2, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C8', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_docs, 'COQ provided by bunker suppliers to the vessel', 'yes_no_na', 3, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C9', true, NULL, NULL),
    (uuid_generate_v4(), v_template_id, s_docs, 'Analysis of samples verifies compliant with COQ for water content', 'yes_no_na', 4, true, '[]'::jsonb, '{}'::jsonb, NULL, NULL, 'C10', true, NULL, NULL);

  RAISE NOTICE 'Dynamic Fuel Transfer Checklist created as DRAFT (template id %).', v_template_id;
END $$;
