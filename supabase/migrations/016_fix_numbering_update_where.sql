-- ============================================================
-- Migration 016: Fix "UPDATE requires a WHERE clause" in numbering RPCs
-- ============================================================
-- The job_numbering_config table is a single-row table keyed on id = true.
-- admin_update_job_numbering_config previously issued an UPDATE with no WHERE
-- clause, which Postgres' safe-update guard rejects. Add WHERE id = true.
-- Also makes the update resilient if the seed row is somehow missing (upsert).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_update_job_numbering_config(
  p_prefix  TEXT,
  p_padding INTEGER
)
RETURNS JSONB AS $$
DECLARE
  last_val  BIGINT;
  is_called BOOLEAN;
  next_seq  BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;
  IF length(trim(p_prefix)) = 0 THEN
    RAISE EXCEPTION 'Prefix cannot be empty';
  END IF;
  IF p_padding < 1 OR p_padding > 10 THEN
    RAISE EXCEPTION 'Padding must be between 1 and 10';
  END IF;

  -- Single-row table keyed on id = true. Upsert so it works even if the row is absent.
  INSERT INTO public.job_numbering_config (id, prefix, padding, updated_at, updated_by)
  VALUES (true, p_prefix, p_padding, NOW(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET prefix = EXCLUDED.prefix,
        padding = EXCLUDED.padding,
        updated_at = NOW(),
        updated_by = auth.uid();

  SELECT s.last_value, s.is_called INTO last_val, is_called FROM public.job_number_seq s;
  next_seq := CASE WHEN is_called THEN last_val + 1 ELSE last_val END;

  RETURN jsonb_build_object(
    'ok',      true,
    'preview', p_prefix || LPAD(next_seq::TEXT, p_padding, '0')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
