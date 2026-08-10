-- 168_cargo_voyage_shares.sql
--
-- Public, read-only share links for a cargo voyage's DATA ANNEX (readings +
-- charts). One row = one link. The token is generated in the API route with
-- crypto.randomBytes(32) and is the only credential — so it must be treated as
-- a secret: unguessable, revocable, and scoped to exactly ONE voyage.
--
-- What a token does NOT grant:
--   * no Supabase session, no cookie, no auth of any kind
--   * no access to any other voyage, job, client, invoice or photo
--   * no access to the app itself — /r/<token> is served by a Route Handler
--     that returns a standalone HTML document, outside the dashboard layout
-- The public route reads this table with the SERVICE ROLE after validating the
-- token, so no anon RLS policy is needed (or wanted) here.

CREATE TABLE IF NOT EXISTS public.cargo_voyage_shares (
  token          text PRIMARY KEY,
  voyage_id      uuid NOT NULL REFERENCES public.cargo_voyages(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Set to revoke. A revoked link 404s exactly like an unknown one, so a holder
  -- cannot tell "revoked" from "never existed".
  revoked_at     timestamptz,
  -- Optional hard expiry. NULL = no expiry (the link lives until revoked).
  expires_at     timestamptz,
  view_count     integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS cargo_voyage_shares_voyage_idx
  ON public.cargo_voyage_shares(voyage_id);

-- One live link per voyage keeps the surveyor's mental model simple ("the link
-- for this voyage") and means revoking is unambiguous. Revoked rows are kept
-- for the audit trail, so the uniqueness only covers live ones.
CREATE UNIQUE INDEX IF NOT EXISTS cargo_voyage_shares_one_live_idx
  ON public.cargo_voyage_shares(voyage_id) WHERE revoked_at IS NULL;

ALTER TABLE public.cargo_voyage_shares ENABLE ROW LEVEL SECURITY;

-- Who may mint or revoke a link: an admin, or the surveyor who owns the voyage.
-- Creating a link is a DISCLOSURE action — it publishes readings to anyone
-- holding the URL — so office (read-only elsewhere in cargo) is deliberately
-- excluded until that is an explicit decision.
CREATE OR REPLACE FUNCTION public.can_share_cargo_voyage(p_voyage_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.cargo_voyages v
        WHERE v.id = p_voyage_id AND v.owner_id = (SELECT auth.uid())
      );
$$;

DROP POLICY IF EXISTS cargo_shares_select ON public.cargo_voyage_shares;
CREATE POLICY cargo_shares_select ON public.cargo_voyage_shares
  FOR SELECT TO authenticated
  USING (public.can_share_cargo_voyage(voyage_id));

DROP POLICY IF EXISTS cargo_shares_insert ON public.cargo_voyage_shares;
CREATE POLICY cargo_shares_insert ON public.cargo_voyage_shares
  FOR INSERT TO authenticated
  WITH CHECK (public.can_share_cargo_voyage(voyage_id) AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS cargo_shares_update ON public.cargo_voyage_shares;
CREATE POLICY cargo_shares_update ON public.cargo_voyage_shares
  FOR UPDATE TO authenticated
  USING (public.can_share_cargo_voyage(voyage_id))
  WITH CHECK (public.can_share_cargo_voyage(voyage_id));

DROP POLICY IF EXISTS cargo_shares_delete ON public.cargo_voyage_shares;
CREATE POLICY cargo_shares_delete ON public.cargo_voyage_shares
  FOR DELETE TO authenticated
  USING (public.can_share_cargo_voyage(voyage_id));

COMMENT ON TABLE public.cargo_voyage_shares IS
  'Read-only public share links for a cargo voyage data annex. Token = bearer secret, one live link per voyage, revocable. Served by /r/[token] with the service role; grants no app or session access.';
