-- SECURITY FIX (Supabase advisor: rls_disabled_in_public).
-- The numbering counter tables were created without Row-Level Security, leaving
-- them readable/writable by anyone with the anon key via PostgREST.
--
-- They are written ONLY by SECURITY DEFINER functions — next_report_number(),
-- next_invoice_number(), get_invoice_counter(), set_invoice_counter() — which run
-- as the table owner and therefore BYPASS RLS. Nothing in the app reads them
-- directly. So enabling RLS with NO policy is exactly right: it denies all direct
-- API access while the numbering functions keep working untouched.
ALTER TABLE public.report_counters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
