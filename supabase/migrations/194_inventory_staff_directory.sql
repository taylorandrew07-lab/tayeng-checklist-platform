-- ============================================================
-- Migration 194: a names-only staff directory for inventory custody.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- THE GAP. "Who has this gauge?" needs two things the app could not reliably get:
--   1. a picker listing everyone who could take custody, and
--   2. a name to render against inventory_items.held_by.
-- Both were reading public.profiles directly, and profiles RLS does not return
-- what either needs:
--
--   surveyor : own row + ALL admin and surveyor rows ("Surveyors can view
--              surveyor profiles", mig 002) — but NOT office rows.
--   office   : own row only, unless granted personal_docs.view (migs 035/039).
--   admin    : everything.
--
-- So the check-out picker silently omitted office staff for a surveyor — no
-- error, just a shorter list — and any holder the viewer could not read rendered
-- as "Someone". A silently incomplete dropdown is the worst kind: it looks
-- finished.
--
-- WHY NOT JUST WIDEN THE PROFILES POLICY. Because RLS CANNOT HIDE COLUMNS
-- (CLAUDE.md). A SELECT policy broad enough to show office staff to surveyors
-- also hands them email, phone, employee_number and vehicle_number on every
-- staff row — and would give office users the staff list that personal_docs.view
-- currently gates. That is a real widening to solve a display problem.
--
-- THE FIX. One SECURITY DEFINER function returning THREE COLUMNS: id, full_name,
-- role. Nothing else is reachable through it, so the blast radius is a list of
-- names that every one of these people already sees on job pages and in the
-- inbox. profiles RLS is untouched.
-- ============================================================

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.inventory_staff_directory()
RETURNS TABLE (id UUID, full_name TEXT, role TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Same audience as the inventory pages themselves: active admin/surveyor, or
  -- an office user holding inventory.view. Anyone else gets an empty set rather
  -- than an error, so a caller can render "nobody to pick" without special-casing.
  IF NOT (public.is_active_staff() OR public.has_office_permission('inventory.view')) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT p.id, p.full_name, p.role::text
      FROM public.profiles p
     WHERE p.is_active = true
       AND p.role::text IN ('admin', 'surveyor', 'office')
     ORDER BY p.full_name;
END;
$$;

COMMENT ON FUNCTION public.inventory_staff_directory() IS
  'Names only (id, full_name, role) for active staff, for the inventory custody
   picker and for resolving inventory_items.held_by. Deliberately NOT a profiles
   policy: RLS cannot hide columns, and a policy wide enough to fix the picker
   would also expose email, phone and employee numbers. See migration 194.';

REVOKE ALL ON FUNCTION public.inventory_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_staff_directory() TO authenticated;

-- ------------------------------------------------------------
-- Verify (paste into the SQL editor after running)
--
--   -- as an admin: every active staff member, names only
--   SELECT * FROM public.inventory_staff_directory();
--
--   -- confirm it exposes nothing else
--   SELECT pg_get_function_result(oid) FROM pg_proc
--    WHERE proname = 'inventory_staff_directory';
--   -- EXPECT: TABLE(id uuid, full_name text, role text)
--
--   -- confirm anon cannot call it
--   SELECT has_function_privilege('anon', 'public.inventory_staff_directory()', 'EXECUTE');
--   -- EXPECT: false
--
-- `npm run smoke-inventory` asserts a SURVEYOR sees office staff through this,
-- which is the case that was broken and the reason the function exists.
-- ------------------------------------------------------------
