-- ============================================================
-- Migration 187 — Vessel dedupe AUDIT. Deliberately NON-DESTRUCTIVE.
--
-- Surveyors typed the voyage into the vessel name ("Chaconia (V086)"), and
-- findOrCreateVessel matches on the WHOLE name (ilike), so every voyage created its own
-- vessel row. The directory has been accumulating one bogus vessel per voyage, each with
-- its own jobs, documents and cargo voyages hanging off it.
--
-- Migration 186 cleaned jobs.vessel_name. This migration does NOT clean vessels — it
-- only writes down what a merge WOULD do, so Andrew can read it first.
--
-- WHY THIS IS SPLIT OUT. Migrations auto-apply on push (the db-migrate Action), so a
-- "-- DRY RUN FIRST" comment inside an applied file is a fiction — pushing it runs the
-- whole thing. And of the three FKs to public.vessels, ONE IS ON DELETE CASCADE:
--     vessel_documents.vessel_id  -> ON DELETE CASCADE   (mig 029:21)
--     jobs.vessel_id              -> ON DELETE SET NULL  (mig 057:20)
--     cargo_voyages.vessel_id     -> ON DELETE SET NULL  (mig 057:21)
-- So deleting a vessel with a wrong survivor mapping silently destroys that vessel's
-- entire document library, with no error and no undo. That is not a decision a migration
-- gets to make on its own.
--
-- The merge itself is migration 188, written after this table is reviewed, and it acts
-- only on rows where approved = true.
--
-- Re-runnable: recomputes the facts on every apply but never resets an approval.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vessel_dedupe_audit (
  loser_id         UUID PRIMARY KEY REFERENCES public.vessels(id) ON DELETE CASCADE,
  loser_name       TEXT NOT NULL,
  clean_name       TEXT NOT NULL,
  extracted_voyage TEXT,
  survivor_id      UUID REFERENCES public.vessels(id) ON DELETE SET NULL,
  survivor_name    TEXT,
  -- 'merge'  — a clean vessel of that name already exists: repoint, then delete the loser.
  -- 'rename' — no clean twin: just rename the loser in place. No delete, no cascade risk.
  action           TEXT NOT NULL CHECK (action IN ('merge', 'rename')),
  doc_count        INTEGER NOT NULL DEFAULT 0,
  job_count        INTEGER NOT NULL DEFAULT 0,
  voyage_count     INTEGER NOT NULL DEFAULT 0,
  approved         BOOLEAN NOT NULL DEFAULT false,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vessel_dedupe_audit IS
  'Proposed cleanup of vessel rows whose name carries a voyage token ("Chaconia (V086)").
   Written by migration 187, ACTED ON by migration 188 and only where approved = true.
   Nothing here is applied automatically: vessel_documents.vessel_id cascades on delete,
   so a wrong survivor mapping would destroy a document library silently.';

COMMENT ON COLUMN public.vessel_dedupe_audit.action IS
  'merge = a clean vessel of this name exists, so repoint children and delete the loser.
   rename = no clean twin exists, so just rename in place — no delete, no cascade risk.';

ALTER TABLE public.vessel_dedupe_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read vessel dedupe audit" ON public.vessel_dedupe_audit;
CREATE POLICY "Admins read vessel dedupe audit" ON public.vessel_dedupe_audit
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins approve vessel dedupe audit" ON public.vessel_dedupe_audit;
CREATE POLICY "Admins approve vessel dedupe audit" ON public.vessel_dedupe_audit
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Populate ───────────────────────────────────────────────────────────────
-- Same anchored pattern as migration 186: a parenthetical at the END containing only a
-- V-token and digits. "(Final)", "(Hull 4)" and "Ocean Star 7" never match, and the
-- cargo-style "(V-2026-014)" is left alone rather than half-parsed.
--
-- The survivor is matched case-insensitively on the cleaned name and must not itself be
-- polluted. LEFT JOIN, so a loser with no clean twin still gets a row — as a 'rename',
-- which is the safer half of this cleanup and needs no delete at all.
WITH dirty AS (
  SELECT v.id, v.name,
         btrim(regexp_replace(v.name, '\s*\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$', '')) AS clean_name,
         public.normalise_voyage(
           substring(v.name from '\(\s*([Vv][-._ ]?[0-9]+)\s*\)\s*$')) AS extracted_voyage
    FROM public.vessels v
   WHERE v.name ~ '\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$'
),
paired AS (
  SELECT d.id AS loser_id, d.name AS loser_name, d.clean_name, d.extracted_voyage,
         s.id AS survivor_id, s.name AS survivor_name
    FROM dirty d
    LEFT JOIN LATERAL (
      SELECT v2.id, v2.name FROM public.vessels v2
       WHERE lower(v2.name) = lower(d.clean_name)
         AND v2.id <> d.id
         AND v2.name !~ '\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$'
       ORDER BY v2.created_at
       LIMIT 1
    ) s ON true
   WHERE d.clean_name <> ''
)
INSERT INTO public.vessel_dedupe_audit
  (loser_id, loser_name, clean_name, extracted_voyage, survivor_id, survivor_name,
   action, doc_count, job_count, voyage_count)
SELECT p.loser_id, p.loser_name, p.clean_name, p.extracted_voyage,
       p.survivor_id, p.survivor_name,
       CASE WHEN p.survivor_id IS NULL THEN 'rename' ELSE 'merge' END,
       (SELECT count(*) FROM public.vessel_documents d WHERE d.vessel_id = p.loser_id),
       (SELECT count(*) FROM public.jobs j             WHERE j.vessel_id = p.loser_id),
       (SELECT count(*) FROM public.cargo_voyages c    WHERE c.vessel_id = p.loser_id)
  FROM paired p
ON CONFLICT (loser_id) DO UPDATE SET
  loser_name       = EXCLUDED.loser_name,
  clean_name       = EXCLUDED.clean_name,
  extracted_voyage = EXCLUDED.extracted_voyage,
  survivor_id      = EXCLUDED.survivor_id,
  survivor_name    = EXCLUDED.survivor_name,
  action           = EXCLUDED.action,
  doc_count        = EXCLUDED.doc_count,
  job_count        = EXCLUDED.job_count,
  voyage_count     = EXCLUDED.voyage_count;
  -- approved is deliberately NOT touched: re-running this must never un-approve, and
  -- must never silently approve.

-- ── Read this before writing migration 188 ─────────────────────────────────
-- SELECT action, loser_name, clean_name, extracted_voyage, survivor_name,
--        doc_count, job_count, voyage_count, approved
--   FROM public.vessel_dedupe_audit
--  ORDER BY action, clean_name;
--
-- Approve everything that looks right:
--   UPDATE public.vessel_dedupe_audit SET approved = true, reviewed_at = now();
-- Or a single row:
--   UPDATE public.vessel_dedupe_audit SET approved = true, reviewed_at = now()
--    WHERE loser_name = 'Chaconia (V086)';
--
-- Pay attention to any 'merge' row with a non-zero doc_count: those documents are the
-- ones the CASCADE would take if the survivor mapping were wrong.
