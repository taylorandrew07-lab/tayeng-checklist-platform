-- ============================================================
-- Migration 160: harden the photo competition (mig 159) after an adversarial
-- review. Idempotent. Run in Supabase SQL Editor (paste the WHOLE file).
--
-- Fixes:
--  * BLIND-JUDGING LEAK (critical): entry storage paths embedded the entrant's
--    uid ({uid}/{file}). An admin can read every entry row + its storage_path,
--    so the path prefix mapped straight to a staff name, defeating blind
--    judging by construction. New uploads use an OPAQUE random key; storage
--    read/delete is now authorized by the owner-link JOIN, not the path prefix,
--    so the path carries no identity. (Existing rows keep working — policies
--    match on storage_path, whatever its shape.)
--  * Entrants could delete their OWN file bytes after a round closed / was
--    placed (storage DELETE had no round guard) — could wipe a winning image.
--  * Entrants could INSERT new entries after a round was closed/judging.
--  * Entrant UPDATE could mutate month/storage_path/media_type/placement; now
--    only the caption is entrant-editable (BEFORE UPDATE trigger).
--  * RLS subqueries qualify the outer id explicitly (was correct but fragile).
-- ============================================================

-- Only the caption is entrant-editable; every other column is pinned to its old
-- value. Admins AND the service-role reveal route (auth.uid() IS NULL, used by
-- /api/competition/judge to set placements) are exempt.
CREATE OR REPLACE FUNCTION public.lock_competition_entry_columns()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.month        := OLD.month;
    NEW.storage_path := OLD.storage_path;
    NEW.media_type   := OLD.media_type;
    NEW.size_bytes   := OLD.size_bytes;
    NEW.content_type := OLD.content_type;
    NEW.filename     := OLD.filename;
    NEW.captured_at  := OLD.captured_at;
    NEW.placement    := OLD.placement;
    NEW.placed_at    := OLD.placed_at;
    NEW.winner_name  := OLD.winner_name;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lock_competition_entry_columns ON public.competition_entries;
CREATE TRIGGER trg_lock_competition_entry_columns
  BEFORE UPDATE ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION public.lock_competition_entry_columns();

-- ------------------------------------------------------------
-- Table policies — re-created with a round-open guard on INSERT and the outer
-- id qualified in every owner-link subquery.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Read competition entries" ON public.competition_entries;
CREATE POLICY "Read competition entries" ON public.competition_entries
  FOR SELECT USING (
    public.is_admin()
    OR (placement IS NOT NULL AND public.is_competition_entrant())
    OR EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = competition_entries.id AND o.entrant_id = auth.uid()
    )
  );

-- Entrants can only add entries while the current round is open.
DROP POLICY IF EXISTS "Entrant insert entry" ON public.competition_entries;
CREATE POLICY "Entrant insert entry" ON public.competition_entries
  FOR INSERT WITH CHECK (
    public.is_competition_entrant()
    AND placement IS NULL AND winner_name IS NULL
    AND public.competition_round_open(month)
  );

DROP POLICY IF EXISTS "Entrant update own entry" ON public.competition_entries;
CREATE POLICY "Entrant update own entry" ON public.competition_entries
  FOR UPDATE USING (
    public.competition_round_open(month) AND EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = competition_entries.id AND o.entrant_id = auth.uid()
    )
  ) WITH CHECK (placement IS NULL AND winner_name IS NULL);

DROP POLICY IF EXISTS "Entrant delete own entry" ON public.competition_entries;
CREATE POLICY "Entrant delete own entry" ON public.competition_entries
  FOR DELETE USING (
    public.competition_round_open(month) AND EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = competition_entries.id AND o.entrant_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Storage — authorize by the owner-link JOIN instead of the path prefix, so the
-- object name no longer needs to (and no longer does) encode the owner. Reading
-- the BYTES as an admin is fine; the identity must not live in the path string.
-- ------------------------------------------------------------

-- competition-photos
DROP POLICY IF EXISTS "Comp photos insert own" ON storage.objects;
CREATE POLICY "Comp photos insert own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'competition-photos' AND (public.is_competition_entrant() OR public.is_admin())
  );

DROP POLICY IF EXISTS "Comp photos read" ON storage.objects;
CREATE POLICY "Comp photos read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-photos' AND (
      public.is_admin()
      OR EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
      )
    )
  );

-- Owner may delete their OWN file only while the round is open and the entry is
-- unplaced — can't wipe a placed/closed image. Admin may always delete.
DROP POLICY IF EXISTS "Comp photos delete own or admin" ON storage.objects;
CREATE POLICY "Comp photos delete own or admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'competition-photos' AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
          AND e.placement IS NULL AND public.competition_round_open(e.month)
      )
    )
  );

-- competition-video (mirror of photos)
DROP POLICY IF EXISTS "Comp video insert own" ON storage.objects;
CREATE POLICY "Comp video insert own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'competition-video' AND (public.is_competition_entrant() OR public.is_admin())
  );

DROP POLICY IF EXISTS "Comp video read" ON storage.objects;
CREATE POLICY "Comp video read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-video' AND (
      public.is_admin()
      OR EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL)
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Comp video delete own or admin" ON storage.objects;
CREATE POLICY "Comp video delete own or admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'competition-video' AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
          AND e.placement IS NULL AND public.competition_round_open(e.month)
      )
    )
  );
