-- ============================================================
-- Migration 161: photo competition RLS symmetry (post multi-persona review).
-- Idempotent. Run in Supabase SQL Editor (paste the WHOLE file).
--
--  * Winner storage BYTES were readable by ANY authenticated account (e.g. a
--    client) because the storage winner-read branch lacked the
--    is_competition_entrant() gate that the TABLE winner-read branch has (mig
--    160). A client could list + sign winning images even though the winner
--    metadata rows are hidden from them. Align storage → staff only.
--  * Entry-row DELETE lacked the `placement IS NULL` guard the storage DELETE
--    has (mig 160). If an admin re-opens a judged month, an entrant could delete
--    their own winning ROW (leaving orphaned bytes + a vanished winner). Add it.
-- ============================================================

-- Table DELETE: also require the entry to be unplaced, matching the storage
-- DELETE policy — a placed entry can never be removed by its owner.
DROP POLICY IF EXISTS "Entrant delete own entry" ON public.competition_entries;
CREATE POLICY "Entrant delete own entry" ON public.competition_entries
  FOR DELETE USING (
    placement IS NULL
    AND public.competition_round_open(month)
    AND EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = competition_entries.id AND o.entrant_id = auth.uid()
    )
  );

-- Storage winner-read: gate to competition entrants (staff), matching the table
-- winner-read branch, so winners are visible to STAFF only — not every
-- authenticated account. Owner + admin branches are unchanged.
DROP POLICY IF EXISTS "Comp photos read" ON storage.objects;
CREATE POLICY "Comp photos read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-photos' AND (
      public.is_admin()
      OR (public.is_competition_entrant()
          AND EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL))
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Comp video read" ON storage.objects;
CREATE POLICY "Comp video read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-video' AND (
      public.is_admin()
      OR (public.is_competition_entrant()
          AND EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL))
      OR EXISTS (
        SELECT 1 FROM public.competition_entries e
        JOIN public.competition_entry_owners o ON o.entry_id = e.id
        WHERE e.storage_path = name AND o.entrant_id = auth.uid()
      )
    )
  );
