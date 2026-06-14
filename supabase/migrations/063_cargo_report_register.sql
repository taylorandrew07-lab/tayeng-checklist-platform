-- ============================================================
-- Migration 063: DRI report register (official numbering, shared with jobs)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- When staff issue a DRI Production Report they assign it an official number from
-- the SAME series as job/checklist numbers (job_number_seq + job_numbering_config),
-- so all company documents share one gap-free sequence. Issued reports are listed
-- in a register (admin + office). No locking/versioning — a register entry simply
-- records that a numbered report was issued for a voyage.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cargo_report_register (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number     TEXT NOT NULL UNIQUE,
  voyage_id         TEXT REFERENCES public.cargo_voyages(id) ON DELETE SET NULL,
  vessel_name       TEXT,
  voyage_number     TEXT,
  included_sections JSONB,                                  -- snapshot of ticked sections at issue
  issued_by         UUID REFERENCES public.profiles(id),
  issued_by_name    TEXT,                                   -- captured at issue so the list needs no profiles join
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cargo_report_register_voyage ON public.cargo_report_register(voyage_id);
CREATE INDEX IF NOT EXISTS idx_cargo_report_register_issued_at ON public.cargo_report_register(issued_at DESC);

-- ------------------------------------------------------------
-- Issue a number atomically from the shared job sequence + insert a register row.
-- SECURITY DEFINER (owned by postgres) so it bypasses RLS for the INSERT and the
-- sequence read; authorization is checked explicitly inside.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_cargo_report_number(
  p_voyage_id TEXT,
  p_vessel    TEXT,
  p_voyage_no TEXT,
  p_sections  JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  cfg   RECORD;
  num   TEXT;
  rid   UUID;
  uname TEXT;
BEGIN
  IF NOT (public.is_active_staff() OR public.has_office_permission('cargo.view')) THEN
    RAISE EXCEPTION 'Access denied: staff or office cargo permission required';
  END IF;

  SELECT * INTO cfg FROM public.job_numbering_config LIMIT 1;
  IF NOT FOUND THEN
    num := 'TE-' || LPAD(nextval('public.job_number_seq')::TEXT, 5, '0');
  ELSE
    num := cfg.prefix || LPAD(nextval('public.job_number_seq')::TEXT, cfg.padding, '0');
  END IF;

  SELECT COALESCE(display_title, full_name) INTO uname FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.cargo_report_register (report_number, voyage_id, vessel_name, voyage_number, included_sections, issued_by, issued_by_name)
  VALUES (num, p_voyage_id, p_vessel, p_voyage_no, p_sections, auth.uid(), uname)
  RETURNING id INTO rid;

  RETURN jsonb_build_object('ok', true, 'id', rid, 'report_number', num, 'issued_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- RLS: staff + office-with-permission may READ the register. Writes happen only
-- through the SECURITY DEFINER function above (no direct INSERT policy needed).
-- Admins may manage rows directly (corrections).
-- ------------------------------------------------------------
ALTER TABLE public.cargo_report_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage cargo_report_register" ON public.cargo_report_register;
CREATE POLICY "Admins manage cargo_report_register" ON public.cargo_report_register
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff read cargo_report_register" ON public.cargo_report_register;
CREATE POLICY "Staff read cargo_report_register" ON public.cargo_report_register
  FOR SELECT USING (public.is_active_staff() OR public.has_office_permission('cargo.view'));

-- Lock down execute (matches migration 058 convention) then grant to authenticated.
REVOKE EXECUTE ON FUNCTION public.issue_cargo_report_number(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_cargo_report_number(TEXT, TEXT, TEXT, JSONB) TO authenticated;
