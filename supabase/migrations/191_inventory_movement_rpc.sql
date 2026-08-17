-- ============================================================
-- Migration 191: the ONLY door into the inventory ledger. Idempotent.
-- Run in Supabase SQL Editor (paste the WHOLE file). Requires migration 190.
--
-- Migration 190 gives inventory_movements no INSERT policy at all, for anyone.
-- These SECURITY DEFINER functions are how a movement gets written. They exist
-- for four reasons, and every one of them is load-bearing:
--
--   1. ATOMICITY. A recount reads the current count and writes the delta; a
--      check-out reads held_by and writes custody. Split across two round trips
--      those race.
--   2. LOCKING. Two surveyors taking the last box at the same instant must
--      serialise. A read-modify-write in the client cannot do that.
--   3. AN UNFORGEABLE ACTOR. actor_id is auth.uid() inside the function, never a
--      parameter. The history is worthless if it can be written under someone
--      else's name.
--   4. NO `RETURNING`. Migration 164's lesson: PostgREST's .insert().select()
--      emits INSERT … RETURNING, and Postgres enforces the SELECT policy against
--      the returned row, with an error character-identical to an INSERT-policy
--      failure. These functions never use RETURNING; they return the resulting
--      STOCK state, which every caller is allowed to read.
--
-- WHY THIS IS A SEPARATE FILE FROM 190: 190 is schema the UI reads and the smoke
-- test asserts against. This is behaviour that will be revised. Because the
-- db-migrate runner SILENTLY SKIPS a duplicate version number, revising an RPC
-- can never be an edit to this file — it must be a fresh 192_… containing a
-- CREATE OR REPLACE. Keeping the RPCs alone here makes that next file a clean
-- copy-and-edit rather than a hunt through 400 lines of schema.
-- ============================================================

SET check_function_bodies = off;

-- ============================================================
-- 1. The private state reader
-- ============================================================
--
-- What a caller may see after a write: the resulting stock, not the ledger row.

CREATE OR REPLACE FUNCTION public.inventory_movement_state(p_movement_id UUID, p_warning TEXT)
RETURNS TABLE (
  movement_id      UUID,
  item_id          UUID,
  kind             TEXT,
  qty_units        NUMERIC,
  from_location_id UUID,
  from_qty_units   NUMERIC,
  to_location_id   UUID,
  to_qty_units     NUMERIC,
  total_qty_units  NUMERIC,
  held_by          UUID,
  warning          TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.item_id, m.kind, m.qty_units,
         m.from_location_id,
         (SELECT s.qty_units FROM public.inventory_stock s
           WHERE s.item_id = m.item_id AND s.location_id = m.from_location_id),
         m.to_location_id,
         (SELECT s.qty_units FROM public.inventory_stock s
           WHERE s.item_id = m.item_id AND s.location_id = m.to_location_id),
         COALESCE((SELECT sum(s.qty_units) FROM public.inventory_stock s
                    WHERE s.item_id = m.item_id), 0),
         i.held_by,
         p_warning
    FROM public.inventory_movements m
    JOIN public.inventory_items i ON i.id = m.item_id
   WHERE m.id = p_movement_id;
$$;

-- CRITICAL: this reads inventory_movements BY ID and is SECURITY DEFINER, so it
-- bypasses the "own rows only" policy. Granting it to `authenticated` would hand
-- every surveyor a ledger-read oracle. It is called ONLY from inside the two
-- functions below, where the owner's implicit EXECUTE applies.
REVOKE ALL ON FUNCTION public.inventory_movement_state(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Record a movement
-- ============================================================
--
-- One function for receive | take | move | adjust | check_out | check_in. They
-- share ~90% of the work — auth, item lookup, location validation, locking, the
-- negative guard, idempotency, the insert — and the UI is one modal with a mode
-- switch. Six sibling functions would mean six copies of the negative guard and
-- six places for the auth check to drift, which is exactly what CLAUDE.md's
-- "single-source seams" table exists to prevent.

CREATE OR REPLACE FUNCTION public.inventory_record_movement(
  p_item_id          UUID,
  p_kind             TEXT,
  p_qty_units        NUMERIC DEFAULT NULL,
  p_from_location_id UUID    DEFAULT NULL,
  p_to_location_id   UUID    DEFAULT NULL,
  p_holder_id        UUID    DEFAULT NULL,
  p_counted_units    NUMERIC DEFAULT NULL,   -- 'adjust' only: the ABSOLUTE count
  p_packs            NUMERIC DEFAULT NULL,   -- what the human typed, for history
  p_expiry_date      DATE    DEFAULT NULL,   -- 'receive' only
  p_note             TEXT    DEFAULT NULL,
  p_allow_negative   BOOLEAN DEFAULT false,
  p_client_ref       TEXT    DEFAULT NULL
)
RETURNS TABLE (
  movement_id      UUID,
  item_id          UUID,
  kind             TEXT,
  qty_units        NUMERIC,
  from_location_id UUID,
  from_qty_units   NUMERIC,
  to_location_id   UUID,
  to_qty_units     NUMERIC,
  total_qty_units  NUMERIC,
  held_by          UUID,
  warning          TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid         UUID    := auth.uid();
  v_item        public.inventory_items%ROWTYPE;
  v_qty         NUMERIC := COALESCE(p_qty_units, 0);
  v_from        UUID    := p_from_location_id;
  v_to          UUID    := p_to_location_id;
  v_recount_loc UUID;
  v_have        NUMERIC;
  v_total       NUMERIC;
  v_warn        TEXT;
  v_id          UUID    := gen_random_uuid();
  v_dup         UUID;
  v_lock        UUID;
BEGIN
  -- 1. CALLER. is_active_staff() = active admin|surveyor. Office is read-only
  --    everywhere in this app — do not add is_office() here.
  IF v_uid IS NULL OR NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'You do not have permission to record stock movements.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. IDEMPOTENCY, before anything else. A retry on flaky dock wifi must never
  --    double-take. The client sends one ref per TAP and replays it per attempt.
  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('receive','take','move','adjust','check_out','check_in') THEN
    RAISE EXCEPTION 'Unknown movement type "%".', p_kind USING ERRCODE = '22023';
  END IF;

  -- 3. ITEM. Locked only for custody work, so ordinary consumable traffic never
  --    contends on the item row.
  IF p_kind IN ('check_out','check_in') THEN
    SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  ELSE
    SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item no longer exists.' USING ERRCODE = '23503';
  END IF;
  -- A recount is still allowed on an archived item: you may need to zero it out.
  IF NOT v_item.is_active AND p_kind <> 'adjust' THEN
    RAISE EXCEPTION '% is archived — an admin has to reactivate it first.', v_item.name
      USING ERRCODE = '42501';
  END IF;

  -- 4. KIND / ITEM-KIND agreement, with messages that say what to do instead.
  IF p_kind IN ('check_out','check_in') THEN
    IF v_item.kind <> 'asset' THEN
      RAISE EXCEPTION '% is a consumable — take it, don''t check it out.', v_item.name
        USING ERRCODE = '22023';
    END IF;
    v_qty := 0; v_from := NULL; v_to := NULL;
  ELSIF p_kind = 'take' AND v_item.kind = 'asset' THEN
    RAISE EXCEPTION '% is equipment — check it out instead of taking it.', v_item.name
      USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'adjust' THEN
    v_recount_loc := COALESCE(p_to_location_id, p_from_location_id);
    IF v_recount_loc  IS NULL THEN RAISE EXCEPTION 'A recount needs a location.'   USING ERRCODE = '22023'; END IF;
    IF p_counted_units IS NULL THEN RAISE EXCEPTION 'A recount needs a count.'     USING ERRCODE = '22023'; END IF;
    IF p_counted_units <  0    THEN RAISE EXCEPTION 'A count cannot be negative.'  USING ERRCODE = '22023'; END IF;
    v_from := NULL; v_to := NULL;   -- derived from the delta, under the lock
  END IF;

  IF p_kind IN ('receive','take','move') AND v_qty <= 0 THEN
    RAISE EXCEPTION 'Enter how many.' USING ERRCODE = '22023';
  END IF;

  -- 5. LOCKS, in a DETERMINISTIC order (by location id).
  --
  --    The INSERT … DO NOTHING is required, not defensive: FOR UPDATE on a row
  --    that does not exist locks nothing, so two concurrent takes at a location
  --    with no stock row would both sail past the guard in step 7.
  --
  --    ORDER BY is not optional either. A move Main→Deco and a move Deco→Main on
  --    the same item at the same instant DEADLOCK without it. Rare, real, cheap
  --    to prevent, miserable to diagnose.
  FOR v_lock IN
    SELECT DISTINCT l FROM unnest(ARRAY[v_from, v_to, v_recount_loc]) AS l
     WHERE l IS NOT NULL ORDER BY 1
  LOOP
    INSERT INTO public.inventory_stock (item_id, location_id, qty_units)
    VALUES (p_item_id, v_lock, 0)
    ON CONFLICT (item_id, location_id) DO NOTHING;
    PERFORM 1 FROM public.inventory_stock
      WHERE item_id = p_item_id AND location_id = v_lock FOR UPDATE;
  END LOOP;

  -- 6. RECOUNT delta, computed INSIDE the lock.
  IF p_kind = 'adjust' THEN
    SELECT s.qty_units INTO v_have FROM public.inventory_stock s
      WHERE s.item_id = p_item_id AND s.location_id = v_recount_loc;
    v_have := COALESCE(v_have, 0);
    v_qty  := abs(p_counted_units - v_have);
    -- qty 0 is legal and IS recorded: "counted, matched" is audit value.
    IF v_qty > 0 THEN
      IF p_counted_units > v_have THEN v_to := v_recount_loc; ELSE v_from := v_recount_loc; END IF;
    END IF;
  END IF;

  -- 7. THE NEGATIVE GUARD — under the lock taken in step 5, so the check and the
  --    decrement are atomic.
  --
  --    Neither pure option is right. A hard block stops someone recording
  --    REALITY: the shelf says 6, the surveyor took a box that was never
  --    received into the system, and refusing the entry means the movement is
  --    never recorded and the books stay wrong forever. A silent allow means
  --    nobody ever finds out the books are wrong.
  --
  --    So: the first attempt raises, naming BOTH numbers, and the UI offers
  --    "Record it anyway" which re-calls with p_allow_negative and the SAME
  --    client_ref. Same shape as the deliberate-act gate in mig 189.
  IF v_from IS NOT NULL AND v_qty > 0 THEN
    SELECT s.qty_units INTO v_have FROM public.inventory_stock s
      WHERE s.item_id = p_item_id AND s.location_id = v_from;
    v_have := COALESCE(v_have, 0);
    IF v_have - v_qty < 0 THEN
      IF NOT p_allow_negative THEN
        RAISE EXCEPTION
          'Only % recorded there, but this removes %. Confirm to record it anyway and flag a recount.',
          v_have, v_qty USING ERRCODE = '23514';
      END IF;
      v_warn := 'negative';
    END IF;
  END IF;

  -- 8. An asset is one physical thing: it may not be in two places at once.
  IF v_item.kind = 'asset' AND p_kind IN ('receive','move') THEN
    SELECT COALESCE(sum(s.qty_units), 0) INTO v_total
      FROM public.inventory_stock s WHERE s.item_id = p_item_id;
    IF p_kind = 'receive' AND v_total + v_qty > 1 THEN
      RAISE EXCEPTION '% is already recorded in stock — move it instead of receiving it again.',
        v_item.name USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 9. CUSTODY validation.
  IF p_kind = 'check_out' THEN
    IF p_holder_id IS NULL THEN
      RAISE EXCEPTION 'Who is taking it?' USING ERRCODE = '22023';
    END IF;
    IF v_item.held_by IS NOT NULL THEN
      RAISE EXCEPTION '% is already checked out — check it in first.', v_item.name
        USING ERRCODE = '23505';
    END IF;
    PERFORM 1 FROM public.profiles
      WHERE id = p_holder_id AND is_active = true
        AND role::text IN ('admin','surveyor','office');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That person is not active staff.' USING ERRCODE = '23503';
    END IF;
  ELSIF p_kind = 'check_in' THEN
    IF v_item.held_by IS NULL THEN
      RAISE EXCEPTION '% is not checked out.', v_item.name USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 10. THE ROW. actor_id = auth.uid() and is not a parameter, so it is
  --     unforgeable. Deliberately NO RETURNING (see the header).
  INSERT INTO public.inventory_movements (
    id, item_id, kind, qty_units,
    from_location_id, to_location_id, from_holder_id, to_holder_id,
    packs_at_time, units_per_pack_at_time, expiry_date,
    note, client_ref, actor_id
  ) VALUES (
    v_id, p_item_id, p_kind, v_qty,
    v_from, v_to,
    CASE WHEN p_kind = 'check_in'  THEN v_item.held_by END,
    CASE WHEN p_kind = 'check_out' THEN p_holder_id    END,
    p_packs, v_item.units_per_pack,
    CASE WHEN p_kind = 'receive' THEN p_expiry_date END,
    NULLIF(btrim(COALESCE(p_note, '')), ''), p_client_ref, v_uid
  );
  -- trg_sync_inventory_stock has now applied the delta and moved custody.

  -- 11. Return what the caller CAN read.
  RETURN QUERY SELECT * FROM public.inventory_movement_state(v_id, v_warn);

EXCEPTION WHEN unique_violation THEN
  -- Two retries of the same tap landed concurrently and step 2 saw neither;
  -- uq_inventory_movements_client_ref settled it. Report the winner as success.
  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF v_dup IS NOT NULL THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;
  RAISE;
END;
$$;

-- ============================================================
-- 3. Correct a movement — never delete one
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_reverse_movement(
  p_movement_id UUID,
  p_note        TEXT DEFAULT NULL,
  p_client_ref  TEXT DEFAULT NULL
)
RETURNS TABLE (
  movement_id      UUID,
  item_id          UUID,
  kind             TEXT,
  qty_units        NUMERIC,
  from_location_id UUID,
  from_qty_units   NUMERIC,
  to_location_id   UUID,
  to_qty_units     NUMERIC,
  total_qty_units  NUMERIC,
  held_by          UUID,
  warning          TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_m    public.inventory_movements%ROWTYPE;
  v_id   UUID := gen_random_uuid();
  v_dup  UUID;
  v_lock UUID;
  v_neg  BOOLEAN;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'You do not have permission to correct stock movements.'
      USING ERRCODE = '42501';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_m FROM public.inventory_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That entry no longer exists.' USING ERRCODE = '23503';
  END IF;

  IF v_m.kind = 'correction' THEN
    RAISE EXCEPTION 'That entry is itself a correction — correct the original instead.'
      USING ERRCODE = '22023';
  END IF;

  -- A surveyor undoes their OWN typo, within a day. Anything older, or anyone
  -- else's, is an admin job. This is also what stops the ledger becoming a
  -- surveyor-readable oracle: without it, a surveyor could probe ids and read
  -- other people's movements back through the error messages.
  IF NOT public.is_admin() THEN
    IF v_m.actor_id <> v_uid THEN
      RAISE EXCEPTION 'Only an administrator can correct someone else''s entry.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.created_at < now() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'That entry is more than a day old — ask an admin to correct it.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_lock IN
    SELECT DISTINCT l FROM unnest(ARRAY[v_m.from_location_id, v_m.to_location_id]) AS l
     WHERE l IS NOT NULL ORDER BY 1
  LOOP
    INSERT INTO public.inventory_stock (item_id, location_id, qty_units)
    VALUES (v_m.item_id, v_lock, 0)
    ON CONFLICT (item_id, location_id) DO NOTHING;
    PERFORM 1 FROM public.inventory_stock
      WHERE item_id = v_m.item_id AND location_id = v_lock FOR UPDATE;
  END LOOP;

  -- Mirrored: from/to and the holder pair are swapped, which makes the custody
  -- reversal fall out for free — undoing a check_out produces a row with
  -- from_holder_id set, which the trigger turns into held_by = NULL.
  --
  -- A correction is NEVER blocked on going negative: undoing a wrong `receive`
  -- has to work even if the phantom stock has since been "consumed".
  INSERT INTO public.inventory_movements (
    id, item_id, kind, qty_units,
    from_location_id, to_location_id, from_holder_id, to_holder_id,
    packs_at_time, units_per_pack_at_time,
    note, reverses_movement_id, client_ref, actor_id
  ) VALUES (
    v_id, v_m.item_id, 'correction', v_m.qty_units,
    v_m.to_location_id, v_m.from_location_id,
    v_m.to_holder_id,   v_m.from_holder_id,
    v_m.packs_at_time, v_m.units_per_pack_at_time,
    COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), 'Correction'),
    p_movement_id, p_client_ref, v_uid
  );

  SELECT EXISTS (
    SELECT 1 FROM public.inventory_stock s
     WHERE s.item_id = v_m.item_id AND s.qty_units < 0
  ) INTO v_neg;

  RETURN QUERY SELECT * FROM public.inventory_movement_state(
    v_id, CASE WHEN v_neg THEN 'negative' END);

EXCEPTION WHEN unique_violation THEN
  -- uq_inventory_movements_reversal: already corrected. Idempotent and friendly.
  SELECT m.id INTO v_dup FROM public.inventory_movements m
    WHERE m.reverses_movement_id = p_movement_id;
  IF v_dup IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
    RETURN;
  END IF;
  RAISE;
END;
$$;

-- ============================================================
-- 4. Reconciliation seam
-- ============================================================
--
-- The rollup applies deltas, so it can only drift if something bypasses the
-- trigger. Nothing should — but a ledger is only trustworthy if you can prove
-- the books from it, so here is the proof, runnable on demand.

CREATE OR REPLACE FUNCTION public.inventory_stock_rebuild(p_item_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can rebuild stock.' USING ERRCODE = '42501';
  END IF;

  WITH truth AS (
    SELECT item_id, location_id, sum(delta) AS qty FROM (
      SELECT item_id, to_location_id   AS location_id,  qty_units AS delta
        FROM public.inventory_movements WHERE to_location_id   IS NOT NULL
      UNION ALL
      SELECT item_id, from_location_id AS location_id, -qty_units AS delta
        FROM public.inventory_movements WHERE from_location_id IS NOT NULL
    ) x
    WHERE p_item_id IS NULL OR x.item_id = p_item_id
    GROUP BY item_id, location_id
  )
  INSERT INTO public.inventory_stock (item_id, location_id, qty_units, updated_at)
  SELECT t.item_id, t.location_id, t.qty, now() FROM truth t
  ON CONFLICT (item_id, location_id) DO UPDATE
    SET qty_units = EXCLUDED.qty_units, updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- ============================================================
-- 5. Grants
-- ============================================================
--
-- New functions are EXECUTE-able by PUBLIC by default, which would undo the
-- least-privilege stance of migs 049/058/067.

REVOKE ALL ON FUNCTION public.inventory_record_movement(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_record_movement(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, BOOLEAN, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.inventory_reverse_movement(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_reverse_movement(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.inventory_stock_rebuild(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_stock_rebuild(UUID) TO authenticated;

-- ------------------------------------------------------------
-- NOTE FOR THE NEXT REVISION. These functions have DEFAULT arguments, so
-- changing the signature creates an AMBIGUOUS OVERLOAD rather than replacing the
-- function (mig 189 learned this the hard way). Any future migration that adds
-- or removes a parameter must DROP FUNCTION IF EXISTS the OLD signature
-- explicitly, in full, before creating the new one.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Verify (paste into the SQL editor after running)
--
--   -- all four functions present, and none EXECUTE-able by anon
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'inventory%'
--    ORDER BY p.proname;
--   -- EXPECT: inventory_movement_state has authed = false. The other three true,
--   --         anon false for all four.
--
--   -- exactly one row per function name (no accidental overloads)
--   SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname LIKE 'inventory%' GROUP BY proname HAVING count(*) > 1;
--
--   -- rebuild is a no-op on healthy books: run it, then re-run the drift check
--   -- at the foot of migration 190 and expect 0 rows.
--   -- SELECT public.inventory_stock_rebuild();
-- ------------------------------------------------------------
