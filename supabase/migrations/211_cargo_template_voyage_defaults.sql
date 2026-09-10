-- ============================================================
-- Migration 211: what a cargo template already knows about the voyage.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- A DRI monitoring voyage is the same three answers every single time: it loads
-- at Point Lisas, it carries DRI B, and it is for Nu-Iron. Surveyors retyped all
-- three dockside on every new voyage, and the spellings drifted ("Pt Lisas",
-- "Point Lisas TT"), which then read as different ports on the client's annex.
--
-- These are DEFAULTS, not constraints. The template pre-fills the New Voyage
-- form; every field stays editable exactly as before, and a voyage that is
-- genuinely different is changed on the spot. Nothing here touches an existing
-- voyage — a voyage snapshots its template at creation and never re-reads it.
--
-- They live on the TEMPLATE rather than in code because the next cargo template
-- is not DRI, and because Andrew must be able to change "DRI B" without a deploy.
-- ============================================================

ALTER TABLE public.cargo_templates
  ADD COLUMN IF NOT EXISTS default_cargo_type     TEXT,
  ADD COLUMN IF NOT EXISTS default_loading_port   TEXT,
  ADD COLUMN IF NOT EXISTS default_discharge_port TEXT,
  -- ON DELETE SET NULL: retiring a client must not take the template with it.
  -- The template then simply has no default client, which is the honest state.
  ADD COLUMN IF NOT EXISTS default_client_id      UUID REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cargo_templates.default_cargo_type IS
  'Pre-fills Cargo Type on New Voyage. A default, never a constraint - the surveyor can type anything.';
COMMENT ON COLUMN public.cargo_templates.default_loading_port IS
  'Pre-fills Loading Port on New Voyage. A default, never a constraint.';
COMMENT ON COLUMN public.cargo_templates.default_discharge_port IS
  'Pre-fills Discharge Port on New Voyage. A default, never a constraint.';
COMMENT ON COLUMN public.cargo_templates.default_client_id IS
  'Pre-selects the Client on New Voyage. Nulled rather than blocking if the client is deleted.';

-- The New Voyage form reads the client NAME through an embed on this FK so the
-- offline text-mode box can be seeded too, and so a renamed client is never
-- stale. mig 052 indexed every other FK on this table; this one needs the same.
CREATE INDEX IF NOT EXISTS idx_cargo_templates_default_client_id
  ON public.cargo_templates (default_client_id);

-- No RLS change. The mig-026 policies are table-wide (admins write, surveyors
-- read active), so new columns are covered by the policies already there.

-- ------------------------------------------------------------
-- Seed the DRI template with the answers it has every time.
-- ------------------------------------------------------------
-- Only fills columns that are still NULL, so this is idempotent AND a re-run
-- can never overwrite a value an admin has since changed in the editor. The
-- client is matched by name and only applied when EXACTLY ONE active client
-- matches - two "Nu-Iron" rows means the wrong one is a coin flip, and a
-- silently wrong client on a voyage is worse than no default at all.
DO $$
DECLARE
  v_client UUID;
  v_rows   INTEGER;
BEGIN
  SELECT id INTO v_client
    FROM public.clients
    WHERE is_active AND name ILIKE '%nu-iron%'
      AND (SELECT COUNT(*) FROM public.clients WHERE is_active AND name ILIKE '%nu-iron%') = 1;

  IF v_client IS NULL THEN
    RAISE NOTICE 'No single active Nu-Iron client found - default client left unset.';
  END IF;

  UPDATE public.cargo_templates
     SET default_cargo_type   = COALESCE(default_cargo_type, 'DRI B'),
         default_loading_port = COALESCE(default_loading_port, 'Point Lisas, Trinidad and Tobago'),
         default_client_id    = COALESCE(default_client_id, v_client)
   WHERE name ILIKE '%DRI%';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RAISE NOTICE 'Voyage defaults applied to % DRI cargo template(s).', v_rows;
END $$;
