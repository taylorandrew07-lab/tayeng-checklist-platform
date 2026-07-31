-- ============================================================
-- Migration 164: fix staff self-upload to the photo competition.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- SYMPTOM: every non-admin entrant (surveyor/office) got
--   new row violates row-level security policy for table "competition_entries"
-- on every upload, on every device, since mig 159. Only admins could enter —
-- which is why it went unnoticed: the on-behalf tool was an admin session.
--
-- CAUSE: it was never the INSERT policy. uploadEntry() did
--   .insert({...}).select('*').single()
-- and the chained .select() makes PostgREST emit INSERT … RETURNING *. Postgres
-- enforces the table's SELECT policy against a RETURNING row (as a with-check
-- whose failure message is character-identical to an INSERT-policy failure).
-- The SELECT policy authorises an entrant via the competition_entry_owners
-- link — which is written on the NEXT statement, and cannot go first because
-- entry_id is a FK to the entry. So a brand-new entry is invisible to its own
-- author, and its own RETURNING clause rejects it. All three read arms are
-- false at that instant: not an admin, placement IS NULL (the INSERT policy
-- requires it), no owner link yet.
--
-- FIX: write the entry and its owner link in ONE call, server-side. NO POLICY
-- IS CHANGED — blind judging is untouched: no entrant id is added to
-- competition_entries, and admins still get no SELECT on the owner link. (A
-- policy-level fix would have to make a fresh row visible to its author, which
-- means storing the author on the row — exactly what mig 159 exists to avoid.)
--
-- This also makes the pair ATOMIC. The old two-step had an unreachable
-- compensating delete: if the owner-link insert failed, the recovery
--   delete from competition_entries where id = …
-- was itself denied (entrant DELETE needs an owner link, which is what just
-- failed to write) and PostgREST reports no error for a delete matching zero
-- rows — so it "succeeded" and left an entry nobody owned: invisible to the
-- entrant, visible in the blind judging gallery, and stamped 'Unknown' if it
-- won. That path is now impossible.
-- ============================================================

-- Submit one entry for the CURRENT month as the calling entrant.
--
-- SECURITY DEFINER, but it grants nothing the caller didn't already have: it
-- re-applies the same two gates as the "Entrant insert entry" policy
-- (is_competition_entrant + competition_round_open), and auth.uid() still
-- resolves to the CALLER (it reads the request JWT, not the function owner).
--
-- Note the deliberate absence of RETURNING on the INSERT: the id is generated
-- up front and the row is read back only AFTER the owner link exists. So the
-- function is correct even if the definer did not bypass RLS — the read that
-- used to fail now passes on its own merits.
CREATE OR REPLACE FUNCTION public.competition_submit_entry(
  p_storage_path TEXT,
  p_media_type   TEXT        DEFAULT 'photo',
  p_content_type TEXT        DEFAULT NULL,
  p_size_bytes   BIGINT      DEFAULT NULL,
  p_filename     TEXT        DEFAULT NULL,
  p_caption      TEXT        DEFAULT NULL,
  p_captured_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS SETOF public.competition_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_month DATE := date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain'))::date;
  v_id    UUID := gen_random_uuid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_competition_entrant() THEN
    RAISE EXCEPTION 'You are not eligible to enter the photo competition.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.competition_round_open(v_month) THEN
    RAISE EXCEPTION 'This month is closed for entries.' USING ERRCODE = '42501';
  END IF;
  IF p_media_type IS NULL OR p_media_type NOT IN ('photo', 'video') THEN
    RAISE EXCEPTION 'Unsupported media type.' USING ERRCODE = '22023';
  END IF;
  IF p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'Missing storage path.' USING ERRCODE = '22023';
  END IF;

  -- month is set here AND by trg_set_competition_entry_month (which pins it to
  -- the current POS month for non-admins regardless). placement / winner_name
  -- are not parameters at all, so this function can never pre-place an entry.
  INSERT INTO public.competition_entries
    (id, month, media_type, storage_path, content_type, size_bytes, filename, caption, captured_at)
  VALUES
    (v_id, v_month, p_media_type, p_storage_path, p_content_type, p_size_bytes,
     p_filename, NULLIF(btrim(COALESCE(p_caption, '')), ''), p_captured_at);

  INSERT INTO public.competition_entry_owners (entry_id, entrant_id)
  VALUES (v_id, v_uid);

  -- Both rows exist now, so this read satisfies "Read competition entries" via
  -- the owner-link arm. Either the whole entry lands, or none of it does.
  RETURN QUERY SELECT * FROM public.competition_entries WHERE id = v_id;
END;
$$;

-- New functions are EXECUTE-able by PUBLIC by default, which would undo mig
-- 058/067's least-privilege stance. Entrants are authenticated staff.
REVOKE ALL ON FUNCTION public.competition_submit_entry(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_submit_entry(TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ)
  TO authenticated;

-- ------------------------------------------------------------
-- Let a failed upload clean up after itself.
--
-- uploadEntry uploads the BYTES first, then writes the row. When the row failed,
-- the rollback (storage.remove) was denied too: the storage DELETE policy (mig
-- 160) authorises via an entries+owners join that never existed. supabase-js
-- resolves with { error } rather than throwing, so the trailing .catch() caught
-- nothing and reported nothing — every failed attempt stranded its bytes.
--
-- Add a narrow branch: you may delete an object YOU uploaded that has no entry
-- row. An orphan is by definition not an entry, so no placed or winning image
-- is reachable through it.
--
-- storage.objects renamed owner (UUID) → owner_id (TEXT) across Supabase
-- versions; detect it rather than assuming.
-- ------------------------------------------------------------
DO $$
DECLARE
  owner_col TEXT;
  bucket    TEXT;
BEGIN
  SELECT column_name INTO owner_col
  FROM information_schema.columns
  WHERE table_schema = 'storage' AND table_name = 'objects'
    AND column_name IN ('owner_id', 'owner')
  ORDER BY CASE column_name WHEN 'owner_id' THEN 0 ELSE 1 END
  LIMIT 1;

  IF owner_col IS NULL THEN
    RAISE NOTICE 'storage.objects has no owner column — skipping orphan-cleanup branch';
    RETURN;
  END IF;

  FOREACH bucket IN ARRAY ARRAY['competition-photos', 'competition-video'] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %I ON storage.objects;
      CREATE POLICY %I ON storage.objects
        FOR DELETE USING (
          bucket_id = %L AND (
            public.is_admin()
            OR EXISTS (
              SELECT 1 FROM public.competition_entries e
              JOIN public.competition_entry_owners o ON o.entry_id = e.id
              WHERE e.storage_path = name AND o.entrant_id = auth.uid()
                AND e.placement IS NULL AND public.competition_round_open(e.month)
            )
            OR (
              %I::text = auth.uid()::text
              AND NOT EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name)
            )
          )
        );
    $f$,
      CASE bucket WHEN 'competition-photos' THEN 'Comp photos delete own or admin'
                  ELSE 'Comp video delete own or admin' END,
      CASE bucket WHEN 'competition-photos' THEN 'Comp photos delete own or admin'
                  ELSE 'Comp video delete own or admin' END,
      bucket, owner_col);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- After running, find the bytes already stranded by this bug (delete them from
-- the Storage UI / as service role — the objects are real, the entries are not):
--
--   SELECT o.bucket_id, o.name, o.created_at, o.metadata->>'size' AS bytes
--   FROM storage.objects o
--   WHERE o.bucket_id IN ('competition-photos', 'competition-video')
--     AND NOT EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = o.name)
--   ORDER BY o.created_at DESC;
--
-- And confirm nothing lost its owner link (expect 0):
--
--   SELECT count(*) FROM public.competition_entries e
--   WHERE NOT EXISTS (SELECT 1 FROM public.competition_entry_owners o WHERE o.entry_id = e.id);
-- ------------------------------------------------------------
