-- ============================================================
-- Migration 014: Job numbering configuration for super admins
-- ============================================================
-- Adds a single-row config table controlling the prefix and zero-padding
-- of generated job numbers. The underlying sequence (job_number_seq) still
-- drives the incrementing counter, so generation is atomic and gap-free.
-- Super admins can adjust prefix, padding, and reset the next number via
-- the admin_* RPC functions below.
-- ============================================================

-- Config table (single row enforced by primary key constraint on a boolean)
CREATE TABLE IF NOT EXISTS public.job_numbering_config (
  id        BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  prefix    TEXT    NOT NULL DEFAULT 'TE-',
  padding   INTEGER NOT NULL DEFAULT 5 CHECK (padding BETWEEN 1 AND 10),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Seed with current defaults if not already present
INSERT INTO public.job_numbering_config (prefix, padding)
VALUES ('TE-', 5)
ON CONFLICT (id) DO NOTHING;

-- RLS: anyone can read (trigger needs it); only super admins can write
ALTER TABLE public.job_numbering_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read job numbering config"
  ON public.job_numbering_config FOR SELECT USING (true);

CREATE POLICY "Super admins can update job numbering config"
  ON public.job_numbering_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
    )
  );

-- ============================================================
-- Update generate_job_number to use prefix and padding from config
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_job_number()
RETURNS TRIGGER AS $$
DECLARE
  cfg RECORD;
BEGIN
  IF NEW.job_number IS NULL THEN
    SELECT * INTO cfg FROM public.job_numbering_config LIMIT 1;
    IF NOT FOUND THEN
      NEW.job_number := 'TE-' || LPAD(nextval('public.job_number_seq')::TEXT, 5, '0');
    ELSE
      NEW.job_number := cfg.prefix || LPAD(nextval('public.job_number_seq')::TEXT, cfg.padding, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: read current config + next number preview (super admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_job_numbering_info()
RETURNS JSONB AS $$
DECLARE
  cfg        RECORD;
  last_val   BIGINT;
  is_called  BOOLEAN;
  next_seq   BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;

  SELECT * INTO cfg FROM public.job_numbering_config LIMIT 1;

  -- Peek at sequence without advancing it
  SELECT s.last_value, s.is_called
  INTO last_val, is_called
  FROM public.job_number_seq s;

  next_seq := CASE WHEN is_called THEN last_val + 1 ELSE last_val END;

  RETURN jsonb_build_object(
    'prefix',       cfg.prefix,
    'padding',      cfg.padding,
    'next_number',  next_seq,
    'preview',      cfg.prefix || LPAD(next_seq::TEXT, cfg.padding, '0')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: update prefix and padding (super admin)
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

  UPDATE public.job_numbering_config
  SET prefix = p_prefix, padding = p_padding, updated_at = NOW(), updated_by = auth.uid();

  SELECT s.last_value, s.is_called INTO last_val, is_called FROM public.job_number_seq s;
  next_seq := CASE WHEN is_called THEN last_val + 1 ELSE last_val END;

  RETURN jsonb_build_object(
    'ok',      true,
    'preview', p_prefix || LPAD(next_seq::TEXT, p_padding, '0')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: set next job number (super admin, with conflict check)
-- next_num is the exact number the NEXT created job will receive.
-- Deleted job numbers are NOT reused — the sequence always increases.
-- If a live job already has that formatted number, the call is rejected.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_next_job_number(next_num INTEGER)
RETURNS JSONB AS $$
DECLARE
  cfg      RECORD;
  proposed TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Access denied: super admin required';
  END IF;
  IF next_num < 1 THEN
    RAISE EXCEPTION 'next_num must be at least 1';
  END IF;

  SELECT * INTO cfg FROM public.job_numbering_config LIMIT 1;
  proposed := cfg.prefix || LPAD(next_num::TEXT, cfg.padding, '0');

  -- Block if any existing job (including deleted/archived) has this number
  IF EXISTS (SELECT 1 FROM public.jobs WHERE job_number = proposed) THEN
    RAISE EXCEPTION 'Job number % is already assigned to an existing checklist', proposed;
  END IF;

  -- setval(seq, val, false) → next nextval() call returns val exactly
  PERFORM setval('public.job_number_seq', next_num, false);

  RETURN jsonb_build_object(
    'ok',           true,
    'next_number',  next_num,
    'preview',      proposed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
