-- ============================================================
-- Migration 167: Motor Tanker (M.T.) vessel type
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Until now every vessel rendered as "M.V." (Motor Vessel). The prefix was never
-- data — it was a hardcoded literal on ~40 surfaces, and titleCaseVesselName()
-- actively STRIPPED any "M.T."/"MT"/"M/T" a surveyor typed, so a tanker was
-- indistinguishable from a cargo vessel and printed M.V. on its report.
--
-- This adds the missing fact. The column stores the rendered literal ('M.V.' /
-- 'M.T.') rather than a separate 'vessel'/'tanker' vocabulary, so every display
-- call site is withVesselPrefix(name, row.vessel_type) with no mapper in between.
--
-- Names themselves stay BARE (no prefix) in vessel_name / vessels.name — that is
-- deliberate and unchanged; the prefix is re-applied at render time.
--
-- DEFAULT 'M.V.' NOT NULL: every existing row keeps today's behaviour exactly,
-- and a forgotten backfill shows up as "still M.V." rather than as a null render.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The column, on the three tables that name a vessel.
--    vessels          — the directory record, the single source of truth
--    jobs             — snapshot, so the ~20 explicit column lists keep working
--                       and offline surfaces need no join
--    cargo_voyages    — same, for the offline-first cargo module
-- ------------------------------------------------------------
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS vessel_type TEXT NOT NULL DEFAULT 'M.V.';
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS vessel_type TEXT NOT NULL DEFAULT 'M.V.';
ALTER TABLE public.cargo_voyages
  ADD COLUMN IF NOT EXISTS vessel_type TEXT NOT NULL DEFAULT 'M.V.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vessels_vessel_type_check') THEN
    ALTER TABLE public.vessels ADD CONSTRAINT vessels_vessel_type_check
      CHECK (vessel_type IN ('M.V.', 'M.T.'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_vessel_type_check') THEN
    ALTER TABLE public.jobs ADD CONSTRAINT jobs_vessel_type_check
      CHECK (vessel_type IN ('M.V.', 'M.T.'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_voyages_vessel_type_check') THEN
    ALTER TABLE public.cargo_voyages ADD CONSTRAINT cargo_voyages_vessel_type_check
      CHECK (vessel_type IN ('M.V.', 'M.T.'));
  END IF;
END $$;

COMMENT ON COLUMN public.vessels.vessel_type IS
  'Rendered prefix: M.V. (Motor Vessel) or M.T. (Motor Tanker). The vessels row is '
  'the single source of truth — changing it PROPAGATES to every job and voyage for '
  'that vessel via propagate_vessel_type(), including rewriting the stored job title.';
COMMENT ON COLUMN public.jobs.vessel_type IS
  'Snapshot of vessels.vessel_type, kept in step by propagate_vessel_type(). Set '
  'directly for jobs with no vessel_id (nullable FK).';
COMMENT ON COLUMN public.cargo_voyages.vessel_type IS
  'Snapshot of vessels.vessel_type for the offline-first cargo module.';

-- ------------------------------------------------------------
-- 2. Propagation: the vessel record is the single truth.
--    Correcting a vessel's type updates every job and voyage for that vessel, and
--    rewrites the prefix baked into the stored job title. jobs.title is stored text
--    of the form "M.V. <vessel> - <job type> - <date>", so only a LEADING prefix is
--    rewritten — the vessel name inside the title is never touched.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_vessel_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.vessel_type IS DISTINCT FROM OLD.vessel_type THEN
    UPDATE public.jobs
       SET vessel_type = NEW.vessel_type,
           title = regexp_replace(title, '^M\.[VT]\.\s+', NEW.vessel_type || ' ')
     WHERE vessel_id = NEW.id
       AND (vessel_type IS DISTINCT FROM NEW.vessel_type
            OR title ~ '^M\.[VT]\.\s+');

    UPDATE public.cargo_voyages
       SET vessel_type = NEW.vessel_type
     WHERE vessel_type IS DISTINCT FROM NEW.vessel_type
       AND lower(vessel_name) = lower(NEW.name);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS propagate_vessel_type_trg ON public.vessels;
CREATE TRIGGER propagate_vessel_type_trg
  AFTER UPDATE OF vessel_type ON public.vessels
  FOR EACH ROW EXECUTE FUNCTION public.propagate_vessel_type();

-- ------------------------------------------------------------
-- 3. Backfill from job titles.
--    Names are stored bare, so the ONLY surviving record of a tanker is the "M.T."
--    literal baked into jobs.title when the job was created. Deliberately requires
--    the dotted/slashed form (M.T. or M/T) — a bare "MT Foo" title is not matched,
--    because "Mt Everest" would be caught by it. Live typing is more permissive;
--    a one-off backfill over historical data should not guess.
-- ------------------------------------------------------------
UPDATE public.vessels v
   SET vessel_type = 'M.T.'
 WHERE v.vessel_type <> 'M.T.'
   AND EXISTS (
     SELECT 1 FROM public.jobs j
      WHERE j.vessel_id = v.id
        AND j.title ~* '^m[./]t[.]?\s'
   );

-- ------------------------------------------------------------
-- 4. The Lila Montreal correction (the job that prompted this change).
--    A Condition Survey on a tanker, created 2026-08-05 and titled "M.V. Lila
--    Montreal - …". Written by name rather than by hardcoded id so it is safe to
--    paste-run against any environment; the trigger above then rewrites the title
--    and stamps the job. Idempotent — a second run is a no-op.
-- ------------------------------------------------------------
UPDATE public.vessels
   SET vessel_type = 'M.T.'
 WHERE lower(name) = 'lila montreal'
   AND vessel_type <> 'M.T.';

-- Safety net for a Lila job that was never linked to the vessel record
-- (jobs.vessel_id is nullable, so the trigger above cannot reach it).
UPDATE public.jobs
   SET vessel_type = 'M.T.',
       title = regexp_replace(title, '^M\.[VT]\.\s+', 'M.T. ')
 WHERE lower(vessel_name) = 'lila montreal'
   AND (vessel_type <> 'M.T.' OR title ~ '^M\.V\.\s+');

-- ------------------------------------------------------------
-- 5. Keep the snapshot honest for every OTHER job already linked to a vessel
--    whose type the backfill in §3 just changed.
-- ------------------------------------------------------------
UPDATE public.jobs j
   SET vessel_type = v.vessel_type,
       title = regexp_replace(j.title, '^M\.[VT]\.\s+', v.vessel_type || ' ')
  FROM public.vessels v
 WHERE j.vessel_id = v.id
   AND (j.vessel_type IS DISTINCT FROM v.vessel_type
        OR (v.vessel_type = 'M.T.' AND j.title ~ '^M\.V\.\s+'));

UPDATE public.cargo_voyages cv
   SET vessel_type = v.vessel_type
  FROM public.vessels v
 WHERE lower(cv.vessel_name) = lower(v.name)
   AND cv.vessel_type IS DISTINCT FROM v.vessel_type;
