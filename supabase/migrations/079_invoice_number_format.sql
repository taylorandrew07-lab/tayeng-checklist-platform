-- Align invoice numbering with REPORT numbering: YY-MM-NNN (e.g. 26-06-001).
-- A per-fiscal-year sequence that resets to 001 on 1 February — same format and
-- reset rule as report numbers (migration 046). Invoices keep their own counter
-- (invoice_counters), so reports and invoices each have their own 001… run.
--
-- Was: INV-YY/NNNN. Only NEW numbers change; any existing stored numbers are kept.

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT AS $$
DECLARE fy INTEGER; seq INTEGER;
BEGIN
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.invoice_counters (fiscal_year, last_seq) VALUES (fy, 1)
    ON CONFLICT (fiscal_year) DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1, updated_at = NOW()
    RETURNING last_seq INTO seq;
  RETURN to_char(NOW(), 'YY-MM-') || lpad(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Keep the admin preview (Finance → Settings) in the same format.
CREATE OR REPLACE FUNCTION public.get_invoice_counter()
RETURNS TABLE(fiscal_year INT, last_seq INT, next_number TEXT) AS $$
DECLARE fy INT; ls INT;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrators only'; END IF;
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  SELECT c.last_seq INTO ls FROM public.invoice_counters c WHERE c.fiscal_year = fy;
  ls := COALESCE(ls, 0);
  RETURN QUERY SELECT fy, ls, to_char(NOW(), 'YY-MM-') || lpad((ls + 1)::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
