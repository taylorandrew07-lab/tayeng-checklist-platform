-- ============================================================
-- Migration 046: Report number format → dashes (YY-MM-NNN)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The real Taylor Engineering documents use YY-MM-NNN (e.g. 26-03-050). The
-- original generator emitted slashes (YY/MM/NNN); switch it to dashes so new
-- jobs match the documents and the tracker's "Number reports" fill tool.
-- Existing slash-format numbers are left as-is (edit them inline if desired).
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_report_number()
RETURNS TEXT AS $$
DECLARE fy INTEGER; seq INTEGER;
BEGIN
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.report_counters (fiscal_year, last_seq) VALUES (fy, 1)
    ON CONFLICT (fiscal_year) DO UPDATE SET last_seq = public.report_counters.last_seq + 1, updated_at = NOW()
    RETURNING last_seq INTO seq;
  RETURN to_char(NOW(), 'YY-MM-') || lpad(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
