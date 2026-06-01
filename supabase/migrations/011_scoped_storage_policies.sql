-- ============================================================
-- Migration 011: Scoped storage read/delete policies
-- Replaces the broad "any authenticated user can read" policy.
-- Run in Supabase SQL Editor.
-- ============================================================

-- Remove the broad authenticated read policy
DROP POLICY IF EXISTS "Authenticated read job photos" ON storage.objects;

-- ── Admin: full read access ─────────────────────────────────
CREATE POLICY "Admin reads all job photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- ── Surveyor: read photos for jobs they are assigned to or created ──
CREATE POLICY "Surveyor reads own job photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE j.id::text = split_part(name, '/', 1)
        AND (j.assigned_to = auth.uid() OR j.created_by = auth.uid())
        AND p.role = 'surveyor'
        AND p.is_active = true
    )
  );

-- ── Client: read photos only for jobs they are explicitly permitted ──
CREATE POLICY "Client reads permitted job photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1
      FROM public.client_users cu
      JOIN public.client_job_permissions cjp ON cjp.client_id = cu.client_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE cu.profile_id = auth.uid()
        AND cjp.job_id::text = split_part(name, '/', 1)
        AND cjp.can_view_checklist_details = true
        AND p.role = 'client'
        AND p.is_active = true
    )
  );
