-- ============================================================
-- Migration 034: Close the admin→super-admin insert path + tighten grants
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Re-audit follow-ups:
--  1. CRITICAL: a regular admin could DELETE a non-admin profile then INSERT a
--     replacement with is_super_admin=true (the 002 "Admins can insert profiles"
--     policy had no value restriction). Nothing legitimate inserts profiles from
--     the client — they're created by the handle_new_user trigger and the
--     service-role create-user route (both bypass RLS) — so we DROP the policy.
--  2. Tighten the surveyor client-permission grant: only the job's own client,
--     only a job the surveyor created AND is assigned to, and status-visibility
--     only (never the full PDF / checklist details).
--  3. Pin created_at on self profile update.
--  4. Restrict photo buckets to image MIME types.
-- ============================================================

-- 1. Remove authenticated INSERT access to profiles entirely.
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;

-- 2. Re-scope the surveyor client-permission grant (supersedes migration 033's).
DROP POLICY IF EXISTS "Surveyors grant client access to own jobs" ON public.client_job_permissions;
CREATE POLICY "Surveyors grant client access to own jobs" ON public.client_job_permissions
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND can_view_pdf = false
    AND can_view_checklist_details = false
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.created_by = auth.uid()
        AND j.assigned_to = auth.uid()
        AND j.client_id = client_job_permissions.client_id
    )
  );

-- 3. Pin created_at too on the safe self-update policy.
DROP POLICY IF EXISTS "Users can update safe own profile fields" ON public.profiles;
CREATE POLICY "Users can update safe own profile fields" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role           = (SELECT role           FROM public.profiles WHERE id = auth.uid())
    AND is_active      = (SELECT is_active      FROM public.profiles WHERE id = auth.uid())
    AND is_super_admin = (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid())
    AND email          = (SELECT email          FROM public.profiles WHERE id = auth.uid())
    AND created_at     = (SELECT created_at     FROM public.profiles WHERE id = auth.uid())
  );

-- 4. Photo buckets only accept images (the app uploads compressed JPEGs).
UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  WHERE id IN ('job-photos', 'cargo-photos');
