-- ============================================================
-- Migration 217: a case is named by its parts, not by a typed title.
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- cases.title sat above our_vessel / case_type / other_party and always repeated
-- them: a matter typed "Ocean Sun collision" was entered above a row that already
-- held Ocean Sun and Collision. Two places to correct, and the case then read one
-- way on the list and another on the claim.
--
-- The parts are now the name. caseTitle() in lib/cases/title.ts assembles it and
-- is the only thing that does, so correcting the vessel corrects the name on the
-- list, the case page, the claim PDF and the claim filename at once.
--
-- The COLUMN stays, nullable, as a fallback for cases that predate this and have
-- nothing to derive from. Nothing new writes to it. It is not dropped because the
-- case that came off the job model in mig 213 has its only name in there.
-- ============================================================

ALTER TABLE public.cases ALTER COLUMN title DROP NOT NULL;

COMMENT ON COLUMN public.cases.title IS
  'LEGACY typed name. Read only when our_vessel, case_type and other_party are all empty - see caseTitle() in lib/cases/title.ts. Nothing written since mig 217 sets it.';

-- Recover what the job model could not hold. Mig 213 moved one case across with
-- its type sitting in the title and case_type NULL; matched against the same list
-- the New Case form offers, so nothing free-text is guessed at. Only fills a NULL
-- case_type, so a re-run and any later correction both stand.
UPDATE public.cases
   SET case_type = btrim(title)
 WHERE case_type IS NULL
   AND btrim(COALESCE(title, '')) <> ''
   AND lower(btrim(title)) IN (
     'collision', 'allision', 'grounding', 'medical', 'personal injury',
     'cargo damage', 'pollution', 'salvage', 'stowaway', 'wreck removal'
   );
