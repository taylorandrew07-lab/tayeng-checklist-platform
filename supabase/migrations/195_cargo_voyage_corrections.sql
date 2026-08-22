-- ============================================================
-- Migration 195: super-admin corrections layer for cargo voyages
--
-- WHY A SEPARATE TABLE, and not simply editing cargo_voyages.doc:
--
-- Cargo sync is PUSH-ONLY and pushVoyage() upserts the WHOLE document
-- (lib/cargo/sync.ts) with no merge and no revision check. Anything written
-- into `doc` is replaced wholesale by whatever is on the surveyor's device on
-- his next push — and that push is not triggered by him editing anything:
-- putVoyage() stamps updatedAt unconditionally and the workspace saves on
-- unmount/pagehide, so merely OPENING a voyage marks it dirty and the 60-second
-- background loop pushes it. A correction typed at 09:00 can be gone by 09:01,
-- silently, with nothing to recover from.
--
-- Corrections therefore live here, in a table pushVoyage never names, and are
-- merged over the document at READ time (lib/cargo/corrections.ts). Same
-- principle that makes jobs linkage (mig 085) and cargo_report_register
-- (mig 063) survive push-only sync. NOTHING on the surveyor's device changes.
--
-- Idempotent; paste-runnable in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cargo_voyage_corrections (
  -- One row per voyage. Also lets PostgREST resolve
  -- `corrections:cargo_voyage_corrections(patch)` as a to-one embed.
  voyage_id     TEXT PRIMARY KEY REFERENCES public.cargo_voyages(id) ON DELETE CASCADE,

  -- { fields: { vesselName: {value, from, at, by} , ... },
  --   readings: { "date|period|hold|typeId|pointId": {value, from, at, by} } }
  -- The allow-list is enforced in app code (CORRECTABLE_FIELDS); the column is
  -- deliberately schemaless so a new correctable field needs no migration.
  patch         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Append-only history: [{ at, by, byName, field, from, to }]. The client is
  -- shown the corrected value with no marker, by decision — so this is the only
  -- way a corrected report can be explained afterwards. Keep it.
  log           JSONB NOT NULL DEFAULT '[]'::jsonb,

  corrected_by  UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_cargo_voyage_corrections_updated_at ON public.cargo_voyage_corrections;
CREATE TRIGGER update_cargo_voyage_corrections_updated_at
  BEFORE UPDATE ON public.cargo_voyage_corrections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.cargo_voyage_corrections ENABLE ROW LEVEL SECURITY;

-- WRITE: super admin only, and enforced by the DATABASE rather than by the UI.
-- This works only because the table is new and carries no pre-existing
-- "admins have full access" policy — RLS policies are OR'd, so adding a
-- super-admin policy to cargo_voyages would grant nothing and narrowing the
-- existing admin policy there would break job linking, the cloud delete and
-- can_share_cargo_voyage(). cargo_voyages is deliberately left alone.
DROP POLICY IF EXISTS "Super admin writes cargo corrections" ON public.cargo_voyage_corrections;
CREATE POLICY "Super admin writes cargo corrections" ON public.cargo_voyage_corrections
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- READ: exactly whoever can already read the voyage. The subquery runs under the
-- caller's own RLS, so this inherits admin / owner / office / client visibility
-- without restating any of it. Without it, a corrected vessel name would show
-- for the super admin and revert for everyone else.
DROP POLICY IF EXISTS "Read cargo corrections with the voyage" ON public.cargo_voyage_corrections;
CREATE POLICY "Read cargo corrections with the voyage" ON public.cargo_voyage_corrections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cargo_voyages v WHERE v.id = voyage_id));

COMMENT ON TABLE public.cargo_voyage_corrections IS
  'Super-admin corrections merged over cargo_voyages.doc at READ time. Lives outside doc because push-only sync overwrites the whole document on every surveyor push.';
