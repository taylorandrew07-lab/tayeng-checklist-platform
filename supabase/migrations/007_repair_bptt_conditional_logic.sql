-- Repair BPTT conditional logic: ensure Bunker Vessel Name fields reference
-- the current Method of Delivery field ID in each template.
-- Idempotent: re-running is safe.

DO $$
DECLARE
  r RECORD;
  mod_field_id uuid;
  bunker_field_id uuid;
BEGIN
  -- Find all templates that have a field labelled like "Method of Delivery"
  FOR r IN
    SELECT DISTINCT tf.template_id
    FROM template_fields tf
    WHERE tf.label ILIKE '%Method of Delivery%'
  LOOP
    -- Get the Method of Delivery field ID for this template
    SELECT tf.id INTO mod_field_id
    FROM template_fields tf
    WHERE tf.template_id = r.template_id
      AND tf.label ILIKE '%Method of Delivery%'
    LIMIT 1;

    IF mod_field_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Find the Bunker Vessel Name field for this template
    SELECT tf.id INTO bunker_field_id
    FROM template_fields tf
    WHERE tf.template_id = r.template_id
      AND tf.label ILIKE '%Bunker Vessel Name%'
    LIMIT 1;

    IF bunker_field_id IS NULL THEN
      RAISE NOTICE 'Template %: no Bunker Vessel Name field found — skipping', r.template_id;
      CONTINUE;
    END IF;

    RAISE NOTICE 'Template %: updating Bunker Vessel Name (%) conditional_logic to reference Method of Delivery (%)',
      r.template_id, bunker_field_id, mod_field_id;

    UPDATE template_fields
    SET conditional_logic = jsonb_build_object(
      'operator', 'and',
      'conditions', jsonb_build_array(
        jsonb_build_object(
          'field_id', mod_field_id::text,
          'operator', 'equals',
          'value', 'bunker_vessel'
        )
      )
    )
    WHERE id = bunker_field_id;

  END LOOP;

  RAISE NOTICE 'Migration 007 complete.';
END;
$$;
