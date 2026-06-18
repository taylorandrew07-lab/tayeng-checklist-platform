-- ============================================================
-- Migration 066: Make issue_cargo_report_number idempotent per voyage
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- Before: every click of "Issue official number" called nextval() on the shared
-- job_number_seq and inserted a new register row — so a double-click, a reload race,
-- or two staff (office + admin) on the same voyage could issue TWO numbers for one
-- voyage, each burning a number from the gap-free company-wide job/report series.
--
-- After: if a number has already been issued for the voyage, the RPC RETURNS that
-- existing number (reused=true) instead of consuming another. One number per voyage.
-- Authorization + numbering logic are otherwise unchanged from migration 063.
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_cargo_report_number(
  p_voyage_id TEXT,
  p_vessel    TEXT,
  p_voyage_no TEXT,
  p_sections  JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  cfg      RECORD;
  num      TEXT;
  rid      UUID;
  uname    TEXT;
  existing RECORD;
BEGIN
  IF NOT (public.is_active_staff() OR public.has_office_permission('cargo.view')) THEN
    RAISE EXCEPTION 'Access denied: staff or office cargo permission required';
  END IF;

  -- Idempotent per voyage: reuse the first number already issued for this voyage
  -- rather than consuming another from the shared series.
  IF p_voyage_id IS NOT NULL THEN
    SELECT id, report_number, issued_at INTO existing
    FROM public.cargo_report_register
    WHERE voyage_id = p_voyage_id
    ORDER BY issued_at ASC
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'id', existing.id, 'report_number', existing.report_number, 'issued_at', existing.issued_at, 'reused', true);
    END IF;
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

REVOKE EXECUTE ON FUNCTION public.issue_cargo_report_number(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_cargo_report_number(TEXT, TEXT, TEXT, JSONB) TO authenticated;
