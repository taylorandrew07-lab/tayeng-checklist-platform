-- Admin controls for invoice auto-numbering. Numbers are INV-YY/NNNN with an annual
-- sequence (fiscal year starts February), stored in invoice_counters. That table has
-- no public API access by design, so reading/setting "where we are" in the sequence
-- goes through these admin-guarded SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION public.get_invoice_counter()
RETURNS TABLE(fiscal_year INT, last_seq INT, next_number TEXT) AS $$
DECLARE fy INT; ls INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrators only'; END IF;
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  SELECT c.last_seq INTO ls FROM public.invoice_counters c WHERE c.fiscal_year = fy;
  ls := COALESCE(ls, 0);
  RETURN QUERY SELECT fy, ls, 'INV-' || to_char(NOW(), 'YY') || '/' || lpad((ls + 1)::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Set the last-used sequence for the current fiscal year (so the NEXT number is
-- p_last_seq + 1). Pass 0 to restart numbering from INV-YY/0001.
CREATE OR REPLACE FUNCTION public.set_invoice_counter(p_last_seq INT)
RETURNS VOID AS $$
DECLARE fy INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrators only'; END IF;
  IF p_last_seq IS NULL OR p_last_seq < 0 THEN RAISE EXCEPTION 'Sequence must be 0 or greater'; END IF;
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.invoice_counters (fiscal_year, last_seq) VALUES (fy, p_last_seq)
    ON CONFLICT (fiscal_year) DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_invoice_counter() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_invoice_counter(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_counter() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_invoice_counter(INT) TO authenticated;
