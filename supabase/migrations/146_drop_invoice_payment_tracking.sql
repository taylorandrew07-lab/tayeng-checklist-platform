-- ============================================================
-- Migration 146: retire invoice PAYMENT TRACKING. Idempotent.
-- Run in Supabase SQL Editor (paste the WHOLE file), or let the db-migrate
-- Action apply it on push.
--
-- Payment state is no longer tracked anywhere. invoices.status collapses from
-- five values to two:
--
--   draft / sent / paid / overdue  ->  active   (a live invoice)
--   void                           ->  void     (cancelled; unchanged)
--
-- Consequently there is no "paid", "outstanding" or "overdue" any more, so the
-- billing RPCs that computed them are rewritten to report what still has meaning:
-- total INVOICED per currency, and total BILLED per client.
--
-- COLUMNS ARE KEPT, NOT DROPPED: sent_at / paid_at / last_reminded_at stay on the
-- table as historical record (nothing writes them from now on). due_date STAYS and
-- is still written/printed — it is a document field ("payment due by"), it just no
-- longer drives an overdue calculation.
--
-- Companion to migration 145 (the 4-state job lifecycle). Unlike 145, public.invoices
-- carries NO admin-guard triggers (only update_invoices_updated_at and
-- invoices_set_number), so the remap below needs no DISABLE TRIGGER dance.
-- ============================================================

-- ── 1. Drop the old CHECK (inline + unnamed in mig 043, so Postgres auto-named
--       it invoices_status_check). Belt and braces: drop ANY check constraint on
--       the table whose definition still mentions the retired values.
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.invoices'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%draft%'
  LOOP
    EXECUTE format('ALTER TABLE public.invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- ── 2. Row remap ────────────────────────────────────────────────────────────
UPDATE public.invoices SET status = 'active'
 WHERE status IN ('draft','sent','paid','overdue');

-- Safety net: anything unexpected becomes 'active' rather than blocking the
-- ADD CONSTRAINT below. 'void' is deliberately preserved.
UPDATE public.invoices SET status = 'active'
 WHERE status IS NULL OR status NOT IN ('active','void');

-- ── 3. Normalizer: a stale client writing a retired status must not 500 ─────
-- Same guard as migration 145 used for jobs — an open tab or cached bundle still
-- running the pre-146 UI may POST status='sent'/'paid'. Map it instead of raising.
CREATE OR REPLACE FUNCTION public.normalize_invoice_status(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IN ('draft','sent','paid','overdue') THEN 'active'
              WHEN p = 'void' THEN 'void'
              WHEN p IS NULL THEN 'active'
              ELSE p END;
$$;

CREATE OR REPLACE FUNCTION public.invoices_normalize_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.status := COALESCE(public.normalize_invoice_status(NEW.status), 'active');
  RETURN NEW;
END;
$$;

-- Name sorts before invoices_set_number / update_invoices_updated_at so the
-- normalized value is what every later BEFORE trigger and the CHECK observe.
DROP TRIGGER IF EXISTS invoices_aa_normalize_status ON public.invoices;
CREATE TRIGGER invoices_aa_normalize_status
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_normalize_status();

-- ── 4. The 2-state CHECK + the new default ─────────────────────────────────
ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('active','void'));

ALTER TABLE public.invoices ALTER COLUMN status SET DEFAULT 'active';

-- ── 5. Billing per currency — paid/outstanding/overdue/draft are gone ───────
-- RETURNS TABLE changes shape, so the function must be dropped, not replaced.
DROP FUNCTION IF EXISTS public.metrics_billing();
CREATE FUNCTION public.metrics_billing()
RETURNS TABLE (currency text, invoiced numeric, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    i.currency::text,
    COALESCE(sum(i.total) FILTER (WHERE i.status <> 'void'), 0),
    count(*) FILTER (WHERE i.status <> 'void')::bigint
  FROM public.invoices i
  GROUP BY i.currency;
$$;

-- ── 6. Per-client totals: "outstanding" is meaningless now, so this becomes
--       total BILLED per client. Renamed so the name can't mislead later.
DROP FUNCTION IF EXISTS public.metrics_client_outstanding();
CREATE FUNCTION public.metrics_client_billed()
RETURNS TABLE (client_id uuid, name text, currency text, amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT i.client_id, COALESCE(c.name, 'Unknown client'), i.currency::text, COALESCE(sum(i.total), 0)
  FROM public.invoices i
  LEFT JOIN public.clients c ON c.id = i.client_id
  WHERE i.client_id IS NOT NULL
    AND i.status <> 'void'
  GROUP BY i.client_id, c.name, i.currency;
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_billing()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.metrics_client_billed() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_billing()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.metrics_client_billed() TO authenticated;

-- ── 7. Analytics RPC: drop overdueCount (mig 145 body, one key removed) ─────
CREATE OR REPLACE FUNCTION public.metrics_analytics(p_months_back int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH
j AS (
  SELECT id, job_type, client_id, workflow_status, is_overtime,
         COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS eff_date
  FROM public.jobs
),
cur AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)::date AS m),
kpis AS (
  SELECT jsonb_build_object(
    'totalJobs',       count(*),
    'openJobs',        count(*) FILTER (WHERE workflow_status <> 'closed'),
    'thisMonth',       count(*) FILTER (WHERE date_trunc('month', eff_date)::date = (SELECT m FROM cur)),
    'awaitingInvoice', count(*) FILTER (WHERE workflow_status = 'invoice_ready'
                          AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.job_id = j.id)),
    'otJobs',          count(*) FILTER (WHERE is_overtime)
  ) AS data FROM j
),
by_type AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', t, 'count', c) ORDER BY c DESC, t), '[]'::jsonb) AS data
  FROM (SELECT COALESCE(NULLIF(job_type, ''), 'Unspecified') AS t, count(*) AS c FROM j GROUP BY 1) x
),
by_month AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ym', to_char(m, 'YYYY-MM'), 'count', c) ORDER BY m), '[]'::jsonb) AS data
  FROM (
    SELECT date_trunc('month', eff_date)::date AS m, count(*) AS c
    FROM j
    WHERE eff_date >= (date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)
                       - make_interval(months => GREATEST(p_months_back, 1) - 1))::date
    GROUP BY 1
  ) mm
),
jc AS (SELECT client_id, count(*) AS jobs FROM j WHERE client_id IS NOT NULL GROUP BY client_id),
rev AS (SELECT client_id, currency::text AS currency, sum(total) AS amount
        FROM public.invoices WHERE status <> 'void' AND client_id IS NOT NULL GROUP BY client_id, currency),
top_clients AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', jc.client_id,
    'name',      COALESCE(c.name, 'Unknown'),
    'jobs',      jc.jobs,
    'revenue',   COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', r.currency, 'amount', r.amount))
                           FROM rev r WHERE r.client_id = jc.client_id), '[]'::jsonb)
  ) ORDER BY jc.jobs DESC), '[]'::jsonb) AS data
  FROM jc LEFT JOIN public.clients c ON c.id = jc.client_id
)
SELECT jsonb_build_object(
  'kpis',       (SELECT data FROM kpis),
  'byType',     (SELECT data FROM by_type),
  'byMonth',    (SELECT data FROM by_month),
  'topClients', (SELECT data FROM top_clients)
);
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_analytics(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_analytics(int) TO authenticated;

-- ── 8. The status/due_date index no longer serves an overdue lookup ─────────
DROP INDEX IF EXISTS public.idx_invoices_status;
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status);

-- ── 9. Verify (run these after) ────────────────────────────────────────────
-- SELECT status, count(*) FROM public.invoices GROUP BY 1;   -> only active / void
-- SELECT * FROM public.metrics_billing();
-- SELECT * FROM public.metrics_client_billed();
