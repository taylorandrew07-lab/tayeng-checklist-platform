-- ============================================================
-- Migration 074: convert the Ultrasonic Hatch Testing hold + bilges fields
-- from yes_no to the new pass_fail type (Pass = green, Fail = red).
-- Idempotent (the field_type='yes_no' guard makes a re-run a no-op). The
-- "Further re-test required?" toggle stays yes_no (it's a control, not a result).
-- Safe: the UHT template has no jobs yet, so no answer data needs migrating.
-- ============================================================

UPDATE public.template_fields
  SET field_type = 'pass_fail',
      options = '[{"value":"pass","label":"Pass","color":"green"},{"value":"fail","label":"Fail","color":"red"}]'::jsonb
  WHERE template_id = '75480000-0000-4000-8000-000000000001'
    AND field_type = 'yes_no'
    AND (label LIKE 'Hold %' OR label = 'Bilges clean & dry');
