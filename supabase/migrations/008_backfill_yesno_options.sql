-- ============================================================
-- Migration 008: Backfill yes_no / yes_no_na fields with default color options
-- Idempotent: only updates fields that have no options set.
-- ============================================================

UPDATE template_fields
SET options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"}]'::jsonb
WHERE field_type = 'yes_no'
  AND (options IS NULL OR options = '[]'::jsonb OR jsonb_array_length(options) = 0);

UPDATE template_fields
SET options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"red"},{"value":"na","label":"N/A","color":"gray"}]'::jsonb
WHERE field_type = 'yes_no_na'
  AND (options IS NULL OR options = '[]'::jsonb OR jsonb_array_length(options) = 0);
