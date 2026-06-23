-- Rename the "Draft Survey" job type to the British spelling "Draught Survey"
-- everywhere it is referenced by name. Idempotent (no-op once renamed).
UPDATE public.job_types    SET name = 'Draught Survey'     WHERE name = 'Draft Survey';
UPDATE public.jobs         SET job_type = 'Draught Survey' WHERE job_type = 'Draft Survey';
UPDATE public.client_rates SET job_type = 'Draught Survey' WHERE job_type = 'Draft Survey';
