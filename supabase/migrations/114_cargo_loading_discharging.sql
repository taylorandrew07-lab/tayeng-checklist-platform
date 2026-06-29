-- ============================================================
-- Migration 114: generalise "Extended Cargo Loadout" into Cargo Loading /
-- Cargo Discharging, with a cargo-type question. Idempotent.
--
-- The old "Extended Cargo Loadout" type was too specific. We:
--  - rename it to the generic "Cargo Loading" (and carry existing jobs across, since
--    jobs.job_type stores the type *name* as text, not a FK).
--  - add a matching "Cargo Discharging" type for the discharge side.
--  - add jobs.cargo_type: the product being loaded/discharged (e.g. Methanol, Crude
--    Oil, Urea). Free text so it's not tied to a fixed list.
-- ============================================================

-- Rename the type, but only if "Cargo Loading" doesn't already exist (so a re-run is safe).
UPDATE public.job_types SET name = 'Cargo Loading'
  WHERE name = 'Extended Cargo Loadout'
  AND NOT EXISTS (SELECT 1 FROM public.job_types WHERE name = 'Cargo Loading');

-- Carry any existing jobs over to the new name.
UPDATE public.jobs SET job_type = 'Cargo Loading' WHERE job_type = 'Extended Cargo Loadout';

-- If both names somehow coexist (e.g. the rename was blocked by a pre-existing
-- "Cargo Loading"), drop the now-orphaned old type.
DELETE FROM public.job_types WHERE name = 'Extended Cargo Loadout';

-- Ensure both generic types exist (covers a fresh DB that never had the old type).
INSERT INTO public.job_types (name)
  SELECT v.name FROM (VALUES ('Cargo Loading'), ('Cargo Discharging')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types jt WHERE jt.name = v.name);

-- The product being loaded/discharged. Free text.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cargo_type TEXT;
