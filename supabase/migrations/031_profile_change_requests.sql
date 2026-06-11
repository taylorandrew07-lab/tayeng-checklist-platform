-- ============================================================
-- Migration 031: Profile change requests (admin-approved profile edits)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Users request changes to their own profile (name/phone/email); an admin reviews
-- and approves/rejects. The APPLY (writing the target profile + updating the auth
-- email) is done server-side by /api/profile-requests/[id]/review using the
-- service role — clients never write other users' profiles. Mirrors the checklist
-- RLS helpers from migration 002 (is_admin).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_changes JSONB NOT NULL,            -- { field: newValue, ... }
  current_values    JSONB NOT NULL,            -- snapshot for the diff view
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id       UUID REFERENCES public.profiles(id),
  review_comment    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_user ON public.profile_change_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_profile_change_requests_status ON public.profile_change_requests (status);

ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;

-- Users may create and read their OWN requests.
DROP POLICY IF EXISTS "Users insert own change requests" ON public.profile_change_requests;
CREATE POLICY "Users insert own change requests" ON public.profile_change_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own change requests" ON public.profile_change_requests;
CREATE POLICY "Users read own change requests" ON public.profile_change_requests
  FOR SELECT USING (user_id = auth.uid());

-- Users may cancel (delete) their own still-pending request.
DROP POLICY IF EXISTS "Users cancel own pending requests" ON public.profile_change_requests;
CREATE POLICY "Users cancel own pending requests" ON public.profile_change_requests
  FOR DELETE USING (user_id = auth.uid() AND status = 'pending');

-- Admins may read everything (for the approval UI). The status update + profile
-- apply runs through the service-role API route, not direct client writes.
DROP POLICY IF EXISTS "Admins read all change requests" ON public.profile_change_requests;
CREATE POLICY "Admins read all change requests" ON public.profile_change_requests
  FOR SELECT USING (public.is_admin());
